const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'public/posven-logo.png'),
    title: "PosVEN Pro - Punto de Venta",
    show: false,
    backgroundColor: '#E6E1D3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:9002').catch((err) => {
      console.error("❌ Error cargando URL de desarrollo:", err);
    });
  } else {
    // En producción, cargamos desde el ASAR empaquetado (out/ está en la raíz del ASAR)
    const indexPath = path.join(__dirname, 'out/index.html');
    
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath).catch((err) => {
        console.error("❌ Error cargando index.html:", err);
      });
    } else {
      console.error("❌ ERROR CRÍTICO: No se encontró index.html en:", indexPath);
    }
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  if (!isDev) {
    mainWindow.setMenu(null);
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error("Update error:", err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

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