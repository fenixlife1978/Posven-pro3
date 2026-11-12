const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const https = require('https');
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

const DEFAULT_PORT = 4580;

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
<div id="hostBox" class="field hidden"><label for="host">IP del equipo servidor</label><input id="host" placeholder="192.168.1.100" inputmode="decimal"><div class="hint">Usa la IP local que muestra POSVEN3 en la computadora servidor.</div><label for="fingerprint" style="margin-top:12px">Huella SHA-256 del certificado</label><input id="fingerprint" placeholder="Pega aquí la huella de 64 caracteres"><div class="hint">Debe coincidir exactamente con la huella mostrada en el servidor. No aceptes una huella enviada por un desconocido.</div></div>
<div class="field"><label for="port">Puerto</label><input id="port" type="number" min="1024" max="65535" value="4580"></div>
<div id="error"></div><button id="save">Guardar y continuar</button>
<p class="hint">Recomendación: reserva la IP del servidor en el router para evitar que cambie.</p>
</main><script>
const hostBox=document.getElementById('hostBox');document.querySelectorAll('input[name="mode"]').forEach(el=>el.addEventListener('change',()=>{hostBox.classList.toggle('hidden',document.querySelector('input[name="mode"]:checked').value!=='client')}));
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
  if (![pfxPath, cerPath, passwordPath].every(file => fs.existsSync(file))) {
    const password = crypto.randomBytes(32).toString('base64url');
    const safePfx = pfxPath.replace(/'/g, "''");
    const safeCer = cerPath.replace(/'/g, "''");
    const ps = "$ErrorActionPreference='Stop'; $cert=New-SelfSignedCertificate -Subject 'CN=POSVEN3-LAN' -DnsName @('localhost',$env:COMPUTERNAME) -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5); $pwd=ConvertTo-SecureString '" + password + "' -AsPlainText -Force; Export-PfxCertificate -Cert $cert -FilePath '" + safePfx + "' -Password $pwd | Out-Null; Export-Certificate -Cert $cert -FilePath '" + safeCer + "' -Type CERT | Out-Null";
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
  if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
    entry = { startedAt: now, attempts: 0 };
    loginAttemptsByIp.set(key, entry);
  }
  if (loginAttemptsByIp.size > 5000) {
    for (const [ip, item] of loginAttemptsByIp) {
      if (now - item.startedAt >= LOGIN_WINDOW_MS) loginAttemptsByIp.delete(ip);
    }
    // Nunca borrar contadores activos para liberar espacio: eso permitiría
    // reiniciar el límite provocando solicitudes desde muchas IP distintas.
    if (!loginAttemptsByIp.has(key) && loginAttemptsByIp.size >= 5000) return Math.ceil(LOGIN_WINDOW_MS / 1000);
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
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', ...getLanIPv4Addresses()]);
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
    handler(request, response);
  });
  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(port, '0.0.0.0', resolve);
  });
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

app.on('before-quit', () => {
  if (nextServer) { try { nextServer.close(); } catch {} nextServer = null; }
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
