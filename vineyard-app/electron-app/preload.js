/**
 * Preload script - Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get application info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // File operations
  selectFiles: (options) => ipcRenderer.invoke('select-files', options),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  
  // Platform info
  platform: process.platform,
  isElectron: true,
  
  // Receive messages from main process
  onMessage: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  }
});

console.log('✅ Preload script loaded');
