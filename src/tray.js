'use strict';
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const settings = require('./settings');
const autostart = require('./autostart');

function createTray(manager) {
  // ICO: Windows tepsi için ekran ölçeğine uygun boyutu (16/24/32 px sade sürüm) kendisi seçer
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.ico')));
  tray.setToolTip('NooXTabs');

  const modeItem = (label, mode) => ({
    label,
    type: 'radio',
    checked: manager.externalMode === mode,
    click: () => manager.setExternalMode(mode),
  });

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Yeni pencere', click: () => manager.newWindow() },
    { type: 'separator' },
    {
      label: 'Dışarıdan açılan klasörler',
      submenu: [
        modeItem('Yeni NooXTabs penceresinde aç', 'new-window'),
        modeItem('Son NooXTabs penceresine sekme olarak ekle', 'last-window'),
        modeItem('Yakalama (normal Gezgin penceresi)', 'off'),
        { type: 'separator' },
        { label: 'NooXTabs içinden açılanlar o pencereye sekme olur', enabled: false },
      ],
    },
    { label: 'Açık Gezgin pencerelerini şimdi yakala', click: () => manager.captureExisting() },
    { type: 'separator' },
    {
      label: 'Oturumu hatırla (çıkışta Gezgin\'ler kapanır, açılışta geri gelir)',
      type: 'checkbox',
      checked: !!settings.get('restoreSession'),
      click: (item) => settings.set('restoreSession', item.checked),
    },
    { label: 'Son oturumu geri yükle', click: () => manager.restoreSession() },
    { type: 'separator' },
    {
      label: 'Windows ile başlat',
      type: 'checkbox',
      checked: !!settings.get('startWithWindows'),
      click: (item) => { settings.set('startWithWindows', item.checked); autostart.apply(item.checked); },
    },
    {
      label: 'Görev çubuğunda Gezgin simgesi altında grupla (yeniden başlatınca)',
      type: 'checkbox',
      checked: !!settings.get('groupWithExplorer'),
      click: (item) => settings.set('groupWithExplorer', item.checked),
    },
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() },
  ]));

  tray.on('click', () => manager.openWindow());
  return tray;
}

module.exports = { createTray };
