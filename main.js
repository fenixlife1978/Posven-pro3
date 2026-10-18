const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow = null;
let splashWindow = null;

// En producción, los archivos del renderer viven dentro del ASAR en la misma
// carpeta que el main.js. Buscamos primero dentro del ASAR y, como fallback
// defensivo, también en la carpeta descomprimida (asarUnpack) por si los
// binarios de módulos nativos (ej. node-thermal-printer) fueron extraídos.
function resolveOutIndexPath() {
  const candidates = [
    path.join(__dirname, 'out', 'index.html'),
    path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'out', 'index.html'),
    path.join(process.resourcesPath || '', 'app', 'out', 'index.html'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[0]; // devuelve la ruta "esperada" aunque no exista, para logging
}

function fatalError(title, detail) {
  // Cuando algo crítico falla, mostramos un dialog nativo ANTES de cerrar
  // la app. Evita la "pantalla en blanco" silenciosa.
  try {
    dialog.showErrorBox(title, detail);
  } catch (e) {
    // Si ni siquiera el dialog funciona, lo dejamos en stderr.
    console.error('[FATAL]', title, detail);
  }
}

function showSplash() {
  // Ventana ligera mientras la app pesada carga. Evita la sensación de
  // "pantalla en blanco" en máquinas lentas.
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
  // Cierra splash si por alguna razón sigue abierto (defensivo)
  closeSplash();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'public/posven-logo.png'),
    title: 'PosVEN Pro - Punto de Venta',
    show: false,                            // No muestra hasta ready-to-show (evita flash blanco)
    backgroundColor: '#E6E1D3',             // Color base mientras carga
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,          // POS no debe pausar en segundo plano
    },
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:9002').catch((err) => {
      fatalError('Error cargando app (dev)', String(err));
    });
  } else {
    const indexPath = resolveOutIndexPath();
    if (!fs.existsSync(indexPath)) {
      // ⚠️ ESTE es el escenario típico de "pantalla en blanco":
      // el instalador se generó pero el bundle Next.js no se empaquetó.
      fatalError(
        'No se encontró el bundle de la app',
        `Se esperaba:\n${indexPath}\n\nEsto suele pasar si el build de Next.js (npm run build) falló o no se ejecutó antes de electron-builder. Reinstala la aplicación.`
      );
      app.quit();
      return;
    }
    mainWindow.loadFile(indexPath).catch((err) => {
      fatalError('Error cargando la app', `No se pudo cargar ${indexPath}\n\n${String(err)}`);
    });
  }

  // Si la página tarda demasiado en estar lista, mostramos splash
  // como red de seguridad (caso de disco lento o primera ejecución).
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

  // Si la página falla (render process crashed), intentamos recargar una vez
  // y, si vuelve a fallar, mostramos un error visible.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details);
    fatalError(
      'La app se cerró inesperadamente',
      `Motivo: ${details.reason || 'desconocido'}\nCódigo: ${details.exitCode ?? 'n/a'}\n\nSi el problema persiste, contacta a soporte.`
    );
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode !== -3) { // -3 = ABORTED, no es un error real
      fatalError('No se pudo cargar la app', `${errorDescription} (código ${errorCode})\nURL: ${validatedURL}`);
    }
  });

  // Links externos se abren en el navegador del sistema, no en la app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (!isDev) {
    mainWindow.setMenu(null);
    // Auto-update: si falla, no tumbamos la app (solo logueamos).
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error('Update error:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Fallback único: usamos whenReady() (forma moderna) y mantenemos on('ready')
// por si la versión de electron es vieja.
if (typeof app.whenReady === 'function') {
  app.whenReady().then(createWindow);
} else {
  app.on('ready', createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
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
