'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('tabsApi', {
  newTab: () => ipcRenderer.invoke('tabs:new'),
  activate: (id) => ipcRenderer.invoke('tabs:activate', id),
  close: (id) => ipcRenderer.invoke('tabs:close', id),
  reorder: (ids) => ipcRenderer.invoke('tabs:reorder', ids),
  detach: (id) => ipcRenderer.invoke('tabs:detach', id),
  tabMenu: (id) => ipcRenderer.invoke('tabs:menu', id),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
  reopenTab: () => ipcRenderer.invoke('tabs:reopen'),
  openPaths: (paths) => ipcRenderer.invoke('tabs:openPaths', paths),
  pathFor: (file) => webUtils.getPathForFile(file), // sürüklenen dosya/klasörün gerçek yolu
  cursor: () => ipcRenderer.invoke('drag:cursor'),
  ghostWarm: () => ipcRenderer.invoke('ghost:warm'),
  ghostShow: (title) => ipcRenderer.invoke('ghost:show', title),
  ghostHide: () => ipcRenderer.invoke('ghost:hide'),
  getState: () => ipcRenderer.invoke('tabs:state'),
  onState: (cb) => ipcRenderer.on('tabs:state', (_e, state) => cb(state)),
  onDndArm: (cb) => ipcRenderer.on('dnd:arm', (_e, on) => cb(!!on)),
});
