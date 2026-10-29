'use strict';
const { app, nativeTheme } = require('electron');
const { WindowManager } = require('./src/windowManager');
const { registerIpc } = require('./src/ipc');
const { createTray } = require('./src/tray');
const settings = require('./src/settings');
const autostart = require('./src/autostart');

let manager = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => manager && manager.openWindow());
  app.on('window-all-closed', () => { /* tepside çalışmaya devam et (otomatik yakalama için) */ });
  app.on('before-quit', () => manager && manager.beginQuit());

  app.whenReady().then(() => {
    // Aynı AppUserModelID'yi paylaşan pencereler görev çubuğunda tek düğmede gruplanır:
    // Gezgin'in kimliğini kullanırsak NooXTabs pencereleri (sabitlediysen) normal Gezgin simgesinin altında görünür.
    app.setAppUserModelId(settings.get('groupWithExplorer') ? 'Microsoft.Windows.Explorer' : 'com.noox.tabs');
    nativeTheme.themeSource = 'dark';
    if (settings.get('startWithWindows')) autostart.apply(true); // yol değişmişse (güncelleme/yeniden kurulum) kaydı tazele
    manager = new WindowManager();
    registerIpc(manager);
    createTray(manager);
    if (!process.argv.includes('--hidden')) { // Windows ile açılışta sadece tepside
      if (settings.get('restoreSession') && manager.hasSession(true)) manager.restoreSession();
      else manager.newWindow();
    }
  });
}
