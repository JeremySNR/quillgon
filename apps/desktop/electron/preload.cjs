const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novel', {
  platform: process.platform,
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  reveal: (p) => ipcRenderer.send('reveal', p),
});
