const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printTicket: (data) => ipcRenderer.send('print-ticket', data),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  discoverLanServers: () => ipcRenderer.invoke('discover-lan-servers'),
  saveNetworkConfig: (config) => ipcRenderer.invoke('save-network-config', config),
});

console.log('POSVEN3 preload listo');
