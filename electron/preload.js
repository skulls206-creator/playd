const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API for the renderer process (the PWA)
contextBridge.exposeInMainWorld('playdDesktop', {
  // Discord RPC
  updateRichPresence: (data) => {
    ipcRenderer.send('rpc-update', data);
  },
  clearRichPresence: () => {
    ipcRenderer.send('rpc-clear');
  },

  // Media key events from OS (e.g., keyboard play/pause)
  onMediaKey: (callback) => {
    ipcRenderer.on('media-key', (event, action) => {
      callback(action);
    });
  },

  // Check if running in Electron
  isElectron: true,
});
