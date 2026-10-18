const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow = null;
let splashWindow = null;

// ============================================================
// PROTOCOLO SEGURO 'app' (VITAL PARA EL EXPORT ESTÁTICO)
// ============================================================
// El export de Next.js genera rutas ABSOLUTAS (/ _next/static/...) en el HTML.
// Con loadFile() / file:// esas rutas apuntan a la raíz del disco y NO cargan,
// produciendo pantalla en blanco. El protocolo 'app' sirve los archivos desde
// la carpeta 'out' dentro del ASAR resolviendo esas rutas correctamente.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function resolveOutPath() {
  // main.js vive en la raíz del ASAR (package.json "main": "main.js"), por lo
  // que el bundle Next está en <raíz>/out. Probar variantes (asar, asar.unpacked,
  // resourcesPath) por si electron-builder extrajo los assets.
  const candidates = [
    path.join(__dirname, 'out'),
    path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'out'),
    path.join(process.resourcesPath || '', 'app', 'out'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0];
}

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

function createWindow() {
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:9002').catch((err) => {
      fatalError('Error cargando app (dev)', String(err));
    });
  } else {
    // ✅ Cargar vía protocolo 'app' (como en el proyecto que funciona), no loadFile.
    mainWindow.loadURL('app://-');
  }

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

app.whenReady().then(() => {
  // ✅ Manejador del protocolo 'app': sirve los archivos del out/ resolviendo
  // las rutas absolutas del export estático de Next.js.
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    } else if (!path.extname(pathname)) {
      pathname = path.join(pathname, 'index.html');
    }

    const outDir = resolveOutPath();
    const filePath = path.join(outDir, pathname);
    if (!fs.existsSync(filePath)) {
      console.error('📁 Archivo no encontrado:', filePath);
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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