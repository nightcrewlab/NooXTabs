'use strict';
// "Windows ile başlat": kayıt defterine (HKCU\...\Run) --hidden argümanıyla yazılır (tepside başlar, pencere açmaz).
const { app } = require('electron');

const NAME = 'NooXTabs'; // kayıt değeri adı (kaldırıcı da bunu siler: build/installer.nsh)

function apply(on) {
  // Paketli sürümde doğrudan exe; geliştirme modunda electron.exe + proje yolu
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args, name: NAME });
}

module.exports = { apply };
