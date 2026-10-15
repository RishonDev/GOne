'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gone', {
  state: () => ipcRenderer.invoke('state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, t) => cb(t)),
  onRenderTray: (cb) => ipcRenderer.on('render-tray', (_e, n) => cb(n)),
  api: (ns, fn, args) => ipcRenderer.invoke('api', ns, fn, args),
  auth: {
    setCreds: (id, secret) => ipcRenderer.invoke('auth:setCreds', id, secret),
    importJson: (text) => ipcRenderer.invoke('auth:import', text),
    setMail: (email, pass) => ipcRenderer.invoke('auth:mail', email, pass),
    signIn: () => ipcRenderer.invoke('auth:signin'),
    signOut: () => ipcRenderer.invoke('auth:signout'),
  },
  openWeb: (url) => ipcRenderer.send('open-web', url),
  openLink: (url) => ipcRenderer.send('open-link', url),
  setSetting: (k, v) => ipcRenderer.send('setting', k, v),
  clearFeed: () => ipcRenderer.send('clear-feed'),
  sendIcons: (map) => ipcRenderer.send('icons', map),
  sendTrayIcon: (url) => ipcRenderer.send('tray-icon', url),
});
