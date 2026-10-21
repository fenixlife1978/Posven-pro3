const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printTicket: (data) => ipcRenderer.send('print-ticket', data),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  chooseNetwork: (config) => ipcRenderer.send('network-config-selected', config),
});

console.log('✅ Preload script cargado correctamente');
