'use strict';
const { ipcMain } = require('electron');

function registerIpc(manager) {
  const host = (e) => manager.hostFor(e.sender);

  ipcMain.handle('tabs:new', (e) => host(e)?.tabs.newTab());
  ipcMain.handle('tabs:activate', (e, id) => host(e)?.tabs.activate(id));
  ipcMain.handle('tabs:close', (e, id) => host(e)?.tabs.close(id));
  ipcMain.handle('tabs:state', (e) => host(e)?.tabs.state() ?? { activeId: null, tabs: [] });
  ipcMain.handle('tabs:reorder', (e, ids) => host(e)?.tabs.reorder(ids));
  ipcMain.handle('tabs:menu', (e, id) => manager.showTabMenu(host(e), id));
  ipcMain.handle('tabs:duplicate', (e, id) => host(e)?.tabs.duplicate(id));
  ipcMain.handle('tabs:reopen', (e) => manager.reopenClosed(host(e)));
  ipcMain.handle('tabs:openPaths', (e, paths) => host(e)?.tabs.openPaths(paths));
  ipcMain.handle('tabs:detach', (e, id) => manager.dropTab(host(e), id));

  // Sürükleme güvenliği: fare olayları Gezgin üzerinde kesilse bile imleç ve tuş durumu buradan okunur
  ipcMain.handle('drag:cursor', (e) => host(e)?.cursor());

  ipcMain.handle('ghost:warm', () => manager.ghost.ensure());
  ipcMain.handle('ghost:show', (_e, title) => manager.ghost.show(String(title ?? '')));
  ipcMain.handle('ghost:hide', () => manager.ghost.hide());
}

module.exports = { registerIpc };
