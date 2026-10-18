const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printTicket: (data) => ipcRenderer.send('print-ticket', data),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});

console.log('✅ Preload script cargado correctamente');