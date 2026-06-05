'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openLogin: () => ipcRenderer.invoke('open-login'),
  logout: () => ipcRenderer.invoke('logout'),
  onAuthOk: (cb) => ipcRenderer.on('auth-ok', () => cb()),
  getChildren: () => ipcRenderer.invoke('get-children'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  chooseOutput: () => ipcRenderer.invoke('choose-output'),
  loadState: (outDir) => ipcRenderer.invoke('load-state', outDir),
  sessionOpen: (payload) => ipcRenderer.invoke('session-open', payload),
  indexEnqueue: (payload) => ipcRenderer.invoke('index-enqueue', payload),
  indexApi: (payload) => ipcRenderer.invoke('index-api', payload),
  indexStop: () => ipcRenderer.invoke('index-stop'),
  downloadStart: (payload) => ipcRenderer.invoke('download-start', payload),
  downloadStop: () => ipcRenderer.invoke('download-stop'),
  onDownloadProgress: (cb) =>
    ipcRenderer.on('download-progress', (_e, p) => cb(p)),
  onDownloadItem: (cb) =>
    ipcRenderer.on('download-item', (_e, it) => cb(it)),
});
