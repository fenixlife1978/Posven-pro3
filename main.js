const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow = null;
let splashWindow = null;
let nextServer = null;
let nextApplication = null;

function fatalError(title, detail) {
  try {
    dialog.showErrorBox(title, detail);
  } catch (e) {
    console.error('[FATAL]', title, detail);
  }
}

function showSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 420,
      height: 280,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      backgroundColor: '#E6E1D3',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const splashHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:#E6E1D3;font-family:system-ui,sans-serif;color:#1f2937;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
  .logo{font-size:34px;font-weight:900;letter-spacing:1px}
  .sub{font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:2px}
  .bar{width:220px;height:6px;background:rgba(0,0,0,.08);border-radius:3px;overflow:hidden;margin-top:8px}
  .bar::before{content:"";display:block;width:40%;height:100%;background:linear-gradient(90deg,transparent,#6366f1,transparent);animation:slide 1.2s linear infinite}
  @keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
</style></head><body>
  <div class="logo">PosVEN Pro</div>
  <div class="sub">Cargando sistema…</div>
  <div class="bar"></div>
</body></html>`)}`;
    splashWindow.loadURL(splashHtml);
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (e) {
    console.warn('No se pudo mostrar splash:', e);
  }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function createWindow(serverPort) {
  closeSplash();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'public/posven-logo.png'),
    title: 'PosVEN Pro - Punto de Venta',
    show: false,
    backgroundColor: '#E6E1D3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const appUrl = isDev ? 'http://localhost:9002' : 'http://127.0.0.1:' + serverPort;
  mainWindow.loadURL(appUrl).catch((err) => {
    fatalError('Error cargando POSVEN-PRO3', String(err));
  });

  const readyTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showSplash();
    }
  }, 1500);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(readyTimeout);
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode !== -3) {
      fatalError('No se pudo cargar la app', `${errorDescription} (código ${errorCode})\nURL: ${validatedURL}`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details);
    fatalError(
      'La app se cerró inesperadamente',
      `Motivo: ${details.reason || 'desconocido'}\nCódigo: ${details.exitCode ?? 'n/a'}\n\nSi el problema persiste, contacta a soporte.`
    );
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('🖥️ Renderizado:', message);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (!isDev) {
    mainWindow.setMenu(null);
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error('Update error:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startLocalNextServer() {
  // La configuración se guarda fuera del instalador para no incrustar secretos.
  const envPath = path.join(app.getPath('userData'), '.env');
  dotenv.config({ path: envPath });
  process.env.TURSO_MIGRATION_BUILD = '1';

  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.warn('Faltan credenciales Turso en ' + envPath);
  }

  const next = require('next');
  nextApplication = next({ dev: false, dir: app.getAppPath() });
  await nextApplication.prepare();

  const handler = nextApplication.getRequestHandler();
  nextServer = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(0, '127.0.0.1', resolve);
  });
  const address = nextServer.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el servidor local de POSVEN-PRO3.');
  return address.port;
}

app.whenReady().then(async () => {
  try {
    if (app.isPackaged) {
      const port = await startLocalNextServer();
      createWindow(port);
    } else {
      createWindow(0);
    }

    app.on('activate', () => {
      if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
        if (app.isPackaged && nextServer?.address()) {
          const address = nextServer.address();
          createWindow(address && typeof address !== 'string' ? address.port : 0);
        } else {
          createWindow(0);
        }
      }
    });
  } catch (error) {
    fatalError('No se pudo iniciar POSVEN-PRO3', String(error));
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    try { nextServer.close(); } catch {}
    nextServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Lógica de Impresión Térmica
ipcMain.on('print-ticket', (event, printData) => {
  const options = {
    preview: false,
    width: '80mm',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    printerName: 'Roccia RC-8002',
    timeOutPerLine: 400,
    silent: true,
  };

  PosPrinter.print(printData, options)
    .then(() => {
      console.log('✅ Impresión completada en Roccia RC-8002');
    })
    .catch((error) => {
      console.error('❌ Error de hardware en Roccia:', error);
    });
});

// Exponer versión de la app
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});