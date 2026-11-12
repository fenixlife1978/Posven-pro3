const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const https = require('https');
const dgram = require('dgram');
const crypto = require('crypto');
const { X509Certificate } = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow = null;
let splashWindow = null;
let setupWindow = null;
let nextServer = null;
let nextApplication = null;
let networkConfig = null;
let setupResolver = null;
let serverTls = null;
let trustedServerFingerprint = null;
let lanDiscoveryServer = null;

const DEFAULT_PORT = 4580;

// Una solicitud solo se considera drenada cuando terminó el handler de Next
// y la respuesta HTTP terminó o el cliente desconectó. El cierre nunca debe
// cancelar una transacción SQLite que siga ejecutándose en el handler.
const activeHttpRequests = new Set();
const activeHttpRequestWaiters = [];
const SHUTDOWN_WARNING_MS = 30000;

function trackHttpRequest(request, response, handler) {
  const state = { handlerDone: false, responseDone: false };
  activeHttpRequests.add(state);
  const releaseIfDone = () => {
    if (!state.handlerDone || !state.responseDone || !activeHttpRequests.delete(state)) return;
    if (activeHttpRequests.size === 0) {
      while (activeHttpRequestWaiters.length) activeHttpRequestWaiters.shift()();
    }
  };
  response.once('finish', () => { state.responseDone = true; releaseIfDone(); });
  response.once('close', () => { state.responseDone = true; releaseIfDone(); });

  try {
    Promise.resolve(handler(request, response))
      .catch(error => {
        console.error('[HTTP] Error no controlado en handler Next.js:', error);
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ ok: false, error: 'Error interno del servidor POSVEN3.' }));
        } else if (!response.destroyed) {
          response.destroy(error);
        }
      })
      .finally(() => { state.handlerDone = true; releaseIfDone(); });
  } catch (error) {
    state.handlerDone = true;
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: false, error: 'Error interno del servidor POSVEN3.' }));
    }
    releaseIfDone();
  }
}

function waitForActiveHttpRequests() {
  if (activeHttpRequests.size === 0) return Promise.resolve();
  return new Promise(resolve => activeHttpRequestWaiters.push(resolve));
}

function fatalError(title, detail) {
  try { dialog.showErrorBox(title, detail); }
  catch (error) { console.error('[FATAL]', title, detail, error); }
}

function isPrivateIPv4(value) {
  const ip = String(value || '').replace(/^::ffff:/i, '');
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254);
}

function isAllowedLanAddress(value) {
  const address = String(value || '').toLowerCase();
  if (address === '::1' || address === '::ffff:127.0.0.1') return true;
  if (isPrivateIPv4(address)) return true;
  return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

function getLanIPv4Addresses() {
  const found = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal && isPrivateIPv4(item.address)) found.push(item.address);
    }
  }
  return [...new Set(found)];
}

const LAN_DISCOVERY_PORT = 4581;
const LAN_DISCOVERY_REQUEST = 'POSVEN3_DISCOVER_V1';

function startLanDiscovery(port) {
  if (lanDiscoveryServer) { try { lanDiscoveryServer.close(); } catch {} }
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const lastResponseByIp = new Map();
  socket.on('error', error => console.warn('[LAN discovery] UDP:', error.message));
  socket.on('message', (message, remote) => {
    if (message.length !== Buffer.byteLength(LAN_DISCOVERY_REQUEST) ||
        message.toString('utf8') !== LAN_DISCOVERY_REQUEST ||
        !isAllowedLanAddress(remote.address)) return;
    const now = Date.now();
    for (const [ip, timestamp] of lastResponseByIp) {
      if (now - timestamp > 60000) lastResponseByIp.delete(ip);
    }
    if (now - (lastResponseByIp.get(remote.address) || 0) < 750) return;
    // Bound memory even if a LAN client sends requests with many source IPs.
    if (!lastResponseByIp.has(remote.address) && lastResponseByIp.size >= 512) return;
    lastResponseByIp.set(remote.address, now);
    const response = Buffer.from(JSON.stringify({
      // UDP discovery is intentionally unauthenticated: advertise only
      // connection coordinates, never the TLS trust anchor.
      protocol: LAN_DISCOVERY_REQUEST, port: Number(port), addresses: getLanIPv4Addresses(),
      serverName: os.hostname(),
    }));
    socket.send(response, remote.port, remote.address, error => {
      if (error) console.warn('[LAN discovery] Respuesta fallida:', error.message);
    });
  });
  socket.bind(LAN_DISCOVERY_PORT, '0.0.0.0', () => { try { socket.setBroadcast(true); } catch {} });
  lanDiscoveryServer = socket;
}

function discoverLanServers(timeoutMs = 2200) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch {}
      resolve([...found.values()]);
    };
    socket.on('error', finish);
    socket.on('message', message => {
      try {
        const data = JSON.parse(message.toString('utf8'));
        const port = Number(data?.port);
        const addresses = [...new Set((Array.isArray(data?.addresses) ? data.addresses : [])
          .map(String).filter(ip => isPrivateIPv4(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.')))];
        if (data?.protocol !== LAN_DISCOVERY_REQUEST || !Number.isInteger(port) || port < 1024 || port > 65535 ||
            !addresses.length) return;
        const serverName = String(data.serverName || 'POSVEN3').slice(0, 80);
        const key = serverName + '|' + addresses.join(',') + '|' + port;
        found.set(key, { addresses, port, serverName });
      } catch {}
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.send(Buffer.from(LAN_DISCOVERY_REQUEST), LAN_DISCOVERY_PORT, '255.255.255.255', error => { if (error) finish(); });
      } catch { finish(); }
    });
    setTimeout(finish, Math.max(500, Math.min(5000, Number(timeoutMs) || 2200)));
  });
}

function readNetworkConfig() {
  const filename = path.join(app.getPath('userData'), 'posven-network.json');
  try {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (value?.mode === 'server') {
      const port = Number(value.port || DEFAULT_PORT);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) return { mode: 'server', port };
    }
    if (value?.mode === 'client') {
      const host = String(value.host || '').trim();
      const port = Number(value.port || DEFAULT_PORT);
      const fingerprint = String(value.fingerprint || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
      if (isPrivateIPv4(host) && Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[a-f0-9]{64}$/.test(fingerprint)) {
        return { mode: 'client', host, port, fingerprint };
      }
    }
  } catch {}
  return null;
}

function saveNetworkConfig(value) {
  const port = Number(value?.port || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('El puerto debe estar entre 1024 y 65535.');
  let config;
  if (value?.mode === 'server') {
    config = { mode: 'server', port };
  } else if (value?.mode === 'client') {
    const host = String(value?.host || '').trim();
    if (!isPrivateIPv4(host) || host.startsWith('127.') || host.startsWith('169.254.')) {
      throw new Error('Indique la IP privada IPv4 del equipo servidor (por ejemplo, 192.168.1.100).');
    }
    const fingerprint = String(value?.fingerprint || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Ingrese la huella SHA-256 del certificado que muestra el servidor POSVEN3.');
    config = { mode: 'client', host, port, fingerprint };
  } else {
    throw new Error('Seleccione si este equipo será servidor o cliente.');
  }
  const filename = path.join(app.getPath('userData'), 'posven-network.json');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  return config;
}

function showNetworkSetup() {
  return new Promise((resolve) => {
    setupResolver = resolve;
    setupWindow = new BrowserWindow({
      width: 560, height: 620, resizable: false, minimizable: false, maximizable: false,
      title: 'Configuración de red POSVEN3', backgroundColor: '#f3f4f6', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
    });
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>POSVEN3 · Red local</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#f3f4f6;color:#172033;font:15px Segoe UI,Arial,sans-serif}
main{max-width:480px;margin:auto;background:white;border:1px solid #d9dee8;border-radius:14px;padding:25px;box-shadow:0 8px 28px #17203312}
h1{margin:0 0 7px;font-size:25px}p{color:#64748b;line-height:1.5}.choice{display:flex;gap:12px;align-items:flex-start;border:1px solid #dbe2ec;border-radius:10px;padding:14px;margin:12px 0;cursor:pointer}.choice input{margin-top:4px}.choice strong{display:block;margin-bottom:4px}.field{margin:15px 0}.field label{display:block;font-weight:600;margin-bottom:7px}.field input{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}.hint{font-size:12px;color:#64748b}.hidden{display:none}button{width:100%;border:0;border-radius:9px;padding:13px;background:#174ea6;color:white;font-weight:700;font-size:15px;cursor:pointer;margin-top:10px}#error{color:#b91c1c;min-height:22px;font-size:13px}
</style></head><body><main>
<h1>Configurar POSVEN3</h1><p>Selecciona cómo se conectará esta computadora. La base de datos SQLite estará únicamente en el equipo servidor.</p>
<label class="choice"><input type="radio" name="mode" value="server" checked><span><strong>Este equipo será el SERVIDOR</strong><span class="hint">Aloja SQLite y permite que las demás cajas se conecten por la red local.</span></span></label>
<label class="choice"><input type="radio" name="mode" value="client"><span><strong>Este equipo será CLIENTE</strong><span class="hint">Se conecta a la base de datos del servidor. No crea una base de datos independiente.</span></span></label>
<div id="hostBox" class="field hidden"><label for="host">IP del equipo servidor</label><input id="host" placeholder="192.168.1.100" inputmode="decimal"><div class="hint">Usa la IP local que muestra POSVEN3 en la computadora servidor.</div><button type="button" id="discover" style="background:#0f766e">Buscar servidor automáticamente en la LAN</button><div class="hint" id="discoveryStatus" aria-live="polite"></div><select id="serverChoice" class="hidden" aria-label="Seleccionar servidor encontrado" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin-top:8px"></select><label for="fingerprint" style="margin-top:12px">Huella SHA-256 del certificado</label><input id="fingerprint" placeholder="Pega aquí la huella de 64 caracteres"><div class="hint">Debe coincidir exactamente con la huella mostrada en el servidor. No aceptes una huella enviada por un desconocido.</div></div>
<div class="field"><label for="port">Puerto</label><input id="port" type="number" min="1024" max="65535" value="4580"></div>
<div id="error"></div><button id="save">Guardar y continuar</button>
<p class="hint">Recomendación: reserva la IP del servidor en el router para evitar que cambie.</p>
</main><script>
document.getElementById('discover').addEventListener('click',async()=>{const status=document.getElementById('discoveryStatus');const choice=document.getElementById('serverChoice');status.textContent='Buscando equipos POSVEN3 en esta red…';choice.classList.add('hidden');try{const servers=await window.electronAPI.discoverLanServers();if(!servers.length){status.textContent='No se encontró servidor. Verifica que esté encendido y que el firewall permita UDP 4581.';return;}choice.innerHTML='';servers.forEach((server,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=server.serverName+' — '+server.addresses.join(', ');choice.appendChild(option);});const apply=()=>{const chosen=servers[Number(choice.value)||0];document.getElementById('host').value=chosen.addresses[0];document.getElementById('port').value=chosen.port;document.getElementById('fingerprint').value='';document.querySelector('input[name="mode"][value="client"]').checked=true;hostBox.classList.remove('hidden');status.textContent='Servidor encontrado: '+chosen.serverName+'. La dirección se completó automáticamente; introduce manualmente la huella SHA-256 que ves en la pantalla del servidor.';};choice.onchange=apply;if(servers.length>1){choice.classList.remove('hidden');status.textContent='Se encontraron '+servers.length+' servidores. Selecciona el equipo correcto y compara su huella TLS.';}apply();}catch(e){status.textContent=e.message||'No se pudo buscar el servidor.';}});\n\nconst hostBox=document.getElementById('hostBox');document.querySelectorAll('input[name="mode"]').forEach(el=>el.addEventListener('change',()=>{hostBox.classList.toggle('hidden',document.querySelector('input[name="mode"]:checked').value!=='client')}));
document.getElementById('save').addEventListener('click',async()=>{const mode=document.querySelector('input[name="mode"]:checked').value;const host=document.getElementById('host').value.trim();const fingerprint=document.getElementById('fingerprint').value.trim();const port=Number(document.getElementById('port').value);const error=document.getElementById('error');error.textContent='';try{await window.electronAPI.saveNetworkConfig({mode,host,port,fingerprint})}catch(e){error.textContent=e.message||'No se pudo guardar la configuración.'}});
</script></body></html>`;
    setupWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    setupWindow.on('closed', () => {
      setupWindow = null;
      if (setupResolver) { setupResolver(null); setupResolver = null; }
    });
  });
}

ipcMain.handle('save-network-config', (event, value) => {
  if (!setupWindow || event.sender !== setupWindow.webContents) throw new Error('Solicitud de configuración no autorizada.');
  const config = saveNetworkConfig(value);
  const resolve = setupResolver;
  setupResolver = null;
  if (resolve) resolve(config);
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  return { ok: true };
});

ipcMain.handle('discover-lan-servers', () => discoverLanServers());

ipcMain.handle('get-network-info', () => ({
  mode: networkConfig?.mode || 'unknown',
  port: networkConfig?.port || null,
  serverHost: networkConfig?.mode === 'client' ? networkConfig.host : null,
  addresses: networkConfig?.mode === 'server' ? getLanIPv4Addresses() : [],
}));

function normalizeFingerprint(value) { return String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase(); }

function getCertificateFingerprint(certPem) { return normalizeFingerprint(new X509Certificate(certPem).fingerprint256); }

function ensureServerTls() {
  if (process.platform !== 'win32') throw new Error('La generación automática del certificado TLS requiere Windows.');
  const dataDir = path.join(app.getPath('userData'), 'security');
  fs.mkdirSync(dataDir, { recursive: true });
  const pfxPath = path.join(dataDir, 'posven3-server.pfx');
  const cerPath = path.join(dataDir, 'posven3-server.cer');
  const passwordPath = path.join(dataDir, 'posven3-server.pass');
  const tlsFiles = [pfxPath, cerPath, passwordPath];
  if (!tlsFiles.every(file => fs.existsSync(file))) {
    // Recover cleanly from an interrupted first-time certificate setup.
    // Export-PfxCertificate/Export-Certificate may refuse existing partial
    // outputs, so regenerate the set as one unit rather than mixing files.
    for (const file of tlsFiles) fs.rmSync(file, { force: true });
    const password = crypto.randomBytes(32).toString('base64url');
    const safePfx = pfxPath.replace(/'/g, "''");
    const safeCer = cerPath.replace(/'/g, "''");
    const ps = "$ErrorActionPreference='Stop'; $cert=New-SelfSignedCertificate -Subject 'CN=POSVEN3-LAN' -DnsName @('localhost',$env:COMPUTERNAME) -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy Exportable -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5); $pwd=ConvertTo-SecureString '" + password + "' -AsPlainText -Force; Export-PfxCertificate -Cert $cert -FilePath '" + safePfx + "' -Password $pwd | Out-Null; Export-Certificate -Cert $cert -FilePath '" + safeCer + "' -Type CERT | Out-Null";
    const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps], { encoding:'utf8', windowsHide:true });
    if (result.status !== 0 || !fs.existsSync(pfxPath) || !fs.existsSync(cerPath)) throw new Error('No se pudo generar el certificado TLS local: ' + String(result.stderr || result.stdout || 'PowerShell falló.'));
    fs.writeFileSync(passwordPath, password, { encoding:'utf8', mode:0o600 });
  }
  const certPem = fs.readFileSync(cerPath);
  return { pfx:fs.readFileSync(pfxPath), passphrase:fs.readFileSync(passwordPath,'utf8'), certPem, fingerprint:getCertificateFingerprint(certPem) };
}

function configurePinnedCertificate(fingerprint, allowedHosts) {
  const expected = normalizeFingerprint(fingerprint);
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('No existe una huella TLS válida para esta conexión.');
  trustedServerFingerprint = expected;
  const { session } = require('electron');
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    try {
      const host = String(request.hostname || '').toLowerCase();
      const actual = getCertificateFingerprint(request.certificate.data);
      callback(allowedHosts.has(host) && actual === trustedServerFingerprint ? 0 : -2);
    } catch { callback(-2); }
  });
}
function showSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 420, height: 280, frame: false, transparent: false, resizable: false, movable: false,
      alwaysOnTop: true, backgroundColor: '#E6E1D3',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#E6E1D3;font-family:system-ui,sans-serif;color:#1f2937;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.logo{font-size:34px;font-weight:900;letter-spacing:1px}.sub{font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:2px}
.bar{width:220px;height:6px;background:rgba(0,0,0,.08);border-radius:3px;overflow:hidden;margin-top:8px}.bar:before{content:"";display:block;width:40%;height:100%;background:linear-gradient(90deg,transparent,#6366f1,transparent);animation:slide 1.2s linear infinite}@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
</style></head><body><div class="logo">PosVEN Pro</div><div class="sub">Cargando sistema…</div><div class="bar"></div></body></html>`;
    splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (error) { console.warn('No se pudo mostrar splash:', error); }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) { splashWindow.close(); splashWindow = null; }
}

function createWindow(appUrl) {
  closeSplash();
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 768,
    icon: path.join(__dirname, 'public/posven-logo.png'), title: 'PosVEN Pro - Punto de Venta',
    show: false, backgroundColor: '#E6E1D3', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true,
      webSecurity: true, spellcheck: false, backgroundThrottling: false,
    },
  });
  mainWindow.loadURL(appUrl).catch(error => fatalError('Error cargando POSVEN3', String(error)));
  const readyTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showSplash();
  }, 1500);
  mainWindow.once('ready-to-show', () => {
    clearTimeout(readyTimeout); closeSplash(); mainWindow.show(); mainWindow.focus();
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode !== -3) fatalError('No se pudo cargar POSVEN3', errorDescription + ' (código ' + errorCode + ')\nURL: ' + validatedURL);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details);
    fatalError('La app se cerró inesperadamente', 'Motivo: ' + (details.reason || 'desconocido') + '\nCódigo: ' + (details.exitCode ?? 'n/a'));
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => console.log('🖥️ Renderizado:', message));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (app.isPackaged) {
    mainWindow.setMenu(null);
    autoUpdater.checkForUpdatesAndNotify().catch(error => console.error('Update error:', error));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Limitador de intentos de autenticación por IP en el proceso servidor.
// No almacena credenciales y se reinicia únicamente al reiniciar el servidor.
const loginAttemptsByIp = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkLoginRateLimit(remoteAddress) {
  const now = Date.now();
  const key = String(remoteAddress || 'unknown').replace(/^::ffff:/i, '');
  let entry = loginAttemptsByIp.get(key);

  if (entry && now - entry.startedAt >= LOGIN_WINDOW_MS) {
    loginAttemptsByIp.delete(key);
    entry = undefined;
  }

  if (!entry) {
    // Bound memory even if an attacker connects through many source IPs.
    // Expire old windows first; never evict active counters to make room.
    if (loginAttemptsByIp.size >= 5000) {
      for (const [ip, item] of loginAttemptsByIp) {
        if (now - item.startedAt >= LOGIN_WINDOW_MS) loginAttemptsByIp.delete(ip);
      }
      if (loginAttemptsByIp.size >= 5000) return Math.ceil(LOGIN_WINDOW_MS / 1000);
    }
    entry = { startedAt: now, attempts: 0 };
    loginAttemptsByIp.set(key, entry);
  }

  if (entry.attempts >= LOGIN_MAX_ATTEMPTS) {
    return Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - entry.startedAt)) / 1000));
  }
  entry.attempts += 1;
  return 0;
}

async function startLocalNextServer(port) {
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.POSVEN_SQLITE_PATH = path.join(dataDir, 'posven-pro3.sqlite');

  const next = require('next');
  nextApplication = next({ dev: false, dir: app.getAppPath() });
  await nextApplication.prepare();
  const handler = nextApplication.getRequestHandler();
  serverTls = ensureServerTls();
  nextServer = https.createServer({ pfx:serverTls.pfx, passphrase:serverTls.passphrase, minVersion:'TLSv1.2' }, (request, response) => {
    const hostHeader = String(request.headers.host || '').trim().toLowerCase();
    let requestHost = '';
    let requestPort = 0;
    try {
      const parsedHost = new URL('https://' + hostHeader);
      requestHost = parsedHost.hostname.replaceAll('[', '').replaceAll(']', '');
      requestPort = Number(parsedHost.port || 443);
    } catch {}
    const configuredPort = Number(port);
    // Recalcular las IP locales en cada petición para admitir cambios DHCP
    // sin reiniciar el servidor ni aceptar hosts ajenos a las interfaces LAN.
    const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', ...getLanIPv4Addresses()]);
    if (!allowedHosts.has(requestHost) || requestPort !== configuredPort) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: false, error: 'Host no autorizado para el servidor POSVEN3.' }));
      return;
    }
    const requestPath = request.url?.split('?')[0] || '/';
    const isApiMutation = requestPath.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(String(request.method || 'GET').toUpperCase());
    if (isApiMutation) {
      const origin = String(request.headers.origin || '').trim();
      let originMatchesHost = false;
      try {
        const parsedOrigin = new URL(origin);
        originMatchesHost = parsedOrigin.protocol === 'https:' && parsedOrigin.host.toLowerCase() === hostHeader;
      } catch {}
      if (!originMatchesHost) {
        response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: false, error: 'Origen no autorizado para modificar datos de POSVEN3.' }));
        return;
      }
    }
    const remote = request.socket.remoteAddress || '';
    if (!isAllowedLanAddress(remote)) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: false, error: 'Acceso permitido únicamente desde la red local.' }));
      return;
    }
    if (request.url?.split('?')[0] === '/api/auth/login' && request.method === 'POST') {
      const retryAfter = checkLoginRateLimit(remote);
      if (retryAfter > 0) {
        response.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': String(retryAfter),
        });
        response.end(JSON.stringify({ error: 'Demasiados intentos de inicio de sesión desde este equipo. Intenta nuevamente más tarde.' }));
        return;
      }
    }
    trackHttpRequest(request, response, handler);
  });
  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(port, '0.0.0.0', resolve);
  });
  startLanDiscovery(port);
  const address = nextServer.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el servidor LAN de POSVEN3.');
  return address.port;
}

async function verifyServer(host, port, expectedFingerprint) {
  const expected = normalizeFingerprint(expectedFingerprint);
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Falta la huella de seguridad del servidor.');
  const url = 'https://' + host + ':' + port + '/api/pos/health';
  const body = await new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized:false, timeout:6000, minVersion:'TLSv1.2' }, response => {
      const peer = response.socket.getPeerCertificate(true);
      const actual = peer?.raw ? normalizeFingerprint(crypto.createHash('sha256').update(peer.raw).digest('hex')) : '';
      if (actual !== expected) { response.destroy(new Error('La huella TLS del servidor no coincide. Conexión rechazada.')); return; }
      let raw=''; response.setEncoding('utf8'); response.on('data', chunk => raw += chunk);
      response.on('end', () => { try { if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('El servidor respondió con HTTP ' + response.statusCode + '.'); resolve(JSON.parse(raw)); } catch(error) { reject(error); } });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado al verificar el servidor.')));
    req.on('error', reject);
  });
  if (body?.ok !== true || body?.database !== 'sqlite') throw new Error('La IP indicada no corresponde a un servidor POSVEN3 SQLite disponible.');
  return url.replace('/api/pos/health', '');
}

app.whenReady().then(async () => {
  try {
    if (!app.isPackaged) {
      process.env.POSVEN_SQLITE_PATH ||= path.join(app.getPath('userData'), 'data', 'posven-pro3-dev.sqlite');
      createWindow('http://localhost:9002');
      return;
    }

    networkConfig = readNetworkConfig() || await showNetworkSetup();
    if (!networkConfig) { app.quit(); return; }

    if (networkConfig.mode === 'server') {
      const port = await startLocalNextServer(networkConfig.port);
      configurePinnedCertificate(serverTls.fingerprint, new Set(['localhost','127.0.0.1','::1',...getLanIPv4Addresses()]));
      createWindow('https://127.0.0.1:' + port);
      const addresses = getLanIPv4Addresses();
      dialog.showMessageBox({
        type: 'info', title: 'Servidor POSVEN3 activo',
        message: 'Esta computadora está funcionando como servidor local.',
        detail: 'Direcciones para conectar las PC clientes:\n' +
          (addresses.length ? addresses.map(ip => 'https://' + ip + ':' + port).join('\n') : 'No se detectó una IP privada IPv4. Verifica la conexión de red.') +
          '\n\nHuella SHA-256 del certificado (compártela por un canal seguro):\n' + serverTls.fingerprint.match(/.{1,2}/g).join(':') + '\n\nMantén esta computadora encendida para que las demás cajas puedan operar.',
      });
    } else {
      let url;
      try {
        url = await verifyServer(networkConfig.host, networkConfig.port, networkConfig.fingerprint);
        configurePinnedCertificate(networkConfig.fingerprint, new Set([networkConfig.host]));
      } catch (connectionError) {
        await dialog.showMessageBox({
          type: 'warning',
          title: 'Servidor POSVEN3 no localizado',
          message: 'No se pudo conectar con ' + networkConfig.host + ':' + networkConfig.port + '.',
          detail: 'Comprueba que la PC servidor esté encendida y en la misma red. Si cambió su IP, actualiza aquí la dirección para volver a conectar.',
          buttons: ['Configurar conexión', 'Salir'],
          defaultId: 0,
          cancelId: 1,
        }).then(async result => {
          if (result.response === 0) networkConfig = await showNetworkSetup();
          else networkConfig = null;
        });
        if (!networkConfig) { app.quit(); return; }
        if (networkConfig.mode === 'server') {
          const port = await startLocalNextServer(networkConfig.port);
          configurePinnedCertificate(serverTls.fingerprint, new Set(['localhost','127.0.0.1','::1',...getLanIPv4Addresses()]));
          createWindow('https://127.0.0.1:' + port);
          const addresses = getLanIPv4Addresses();
          dialog.showMessageBox({
            type: 'info', title: 'Servidor POSVEN3 activo',
            message: 'Esta computadora está funcionando como servidor local.',
            detail: 'Direcciones para conectar las PC clientes:\n' +
              (addresses.length ? addresses.map(ip => 'https://' + ip + ':' + port).join('\n') : 'No se detectó una IP privada IPv4. Verifica la conexión de red.') +
              '\n\nHuella SHA-256 del certificado (compártela por un canal seguro):\n' + serverTls.fingerprint.match(/.{1,2}/g).join(':') +
              '\n\nMantén esta computadora encendida para que las demás cajas puedan operar.',
          });
          return;
        }
        url = await verifyServer(networkConfig.host, networkConfig.port, networkConfig.fingerprint);
        configurePinnedCertificate(networkConfig.fingerprint, new Set([networkConfig.host]));
      }
      createWindow(url);
    }

    app.on('activate', () => {
      if (mainWindow === null && networkConfig) {
        if (networkConfig.mode === 'client') createWindow('https://' + networkConfig.host + ':' + networkConfig.port);
        else if (nextServer?.address()) createWindow('https://127.0.0.1:' + networkConfig.port);
      }
    });
  } catch (error) {
    fatalError('No se pudo iniciar POSVEN3', String(error));
    app.quit();
  }
});

// Cierre ordenado del servidor local antes de terminar Electron.
// Primero deja de aceptar conexiones nuevas, permite terminar las solicitudes
// activas y después libera el servidor Next.js. SQLite se cierra al finalizar
// el proceso, una vez que ya no quedan manejadores HTTP ejecutándose.
async function shutdownLocalServer() {
  if (lanDiscoveryServer) {
    try { lanDiscoveryServer.close(); } catch (error) { console.warn('[SHUTDOWN] UDP discovery:', error); }
    lanDiscoveryServer = null;
  }
  const server = nextServer;
  nextServer = null;

  if (server?.listening) {
    const serverClosed = new Promise((resolve) => {
      try {
        // Detiene nuevas conexiones; las solicitudes ya admitidas siguen vivas.
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
            console.error('[SHUTDOWN] Error cerrando servidor HTTPS:', error);
          }
          resolve();
        });
        // Las conexiones keep-alive sin solicitudes no deben bloquear el cierre.
        server.closeIdleConnections?.();
      } catch (error) {
        console.error('[SHUTDOWN] No se pudo iniciar el cierre HTTPS:', error);
        resolve();
      }
    });

    let warningTimer;
    const warningElapsed = new Promise(resolve => {
      warningTimer = setTimeout(() => resolve(true), SHUTDOWN_WARNING_MS);
    });
    const drained = await Promise.race([
      waitForActiveHttpRequests().then(() => true),
      warningElapsed,
    ]);
    clearTimeout(warningTimer);

    if (!drained) {
      console.warn('[SHUTDOWN] Continúan solicitudes HTTP activas:', activeHttpRequests.size);
      await dialog.showMessageBox({
        type: 'warning',
        title: 'POSVEN3 está terminando operaciones',
        message: 'Hay operaciones que todavía no han terminado.',
        detail: 'El servidor seguirá esperando sin interrumpir las solicitudes ni las transacciones SQLite. No apagues el equipo ni fuerces el cierre mientras se completa este proceso.',
        buttons: ['Continuar esperando'],
        defaultId: 0,
        noLink: true,
      });
      await waitForActiveHttpRequests();
    }

    // Solo después de que los handlers terminaron se eliminan sockets
    // keep-alive restantes. Nunca se abortan conexiones con operaciones activas.
    server.closeAllConnections?.();
    await serverClosed;
  }

  const application = nextApplication;
  nextApplication = null;
  if (application && typeof application.close === 'function') {
    try {
      await application.close();
    } catch (error) {
      console.error('[SHUTDOWN] Error cerrando Next.js:', error);
    }
  }

  serverTls = null;
  trustedServerFingerprint = null;
}

let shutdownStarted = false;
let shutdownComplete = false;

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;

  shutdownLocalServer()
    .catch((error) => console.error('[SHUTDOWN] Cierre local incompleto:', error))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('print-ticket', (_event, printData) => {
  const options = {
    preview: false, width: '80mm', margins: { top: 0, bottom: 0, left: 0, right: 0 },
    printerName: 'Roccia RC-8002', timeOutPerLine: 400, silent: true,
  };
  PosPrinter.print(printData, options)
    .then(() => console.log('✅ Impresión completada en Roccia RC-8002'))
    .catch(error => console.error('❌ Error de hardware en Roccia:', error));
});

ipcMain.handle('get-app-version', () => app.getVersion());
