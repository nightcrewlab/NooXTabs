'use strict';
// Sekmeyi pencere dışına sürüklerken imleci takip eden hayalet sekme (tarayıcılardaki gibi).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const W = 220;
const H = 44;

class Ghost {
  constructor() {
    this.win = null;
    this.loaded = false;
    this.title = '';
    this.timer = null;
    this.idleTimer = null;
  }

  // Sürükleme başlarken çağrılır: pencere hazır olsun. Boşta kalınca bellek için kapatılır.
  ensure() {
    clearTimeout(this.idleTimer);
    if (this.win && !this.win.isDestroyed()) return;
    this.loaded = false;
    this.win = new BrowserWindow({
      width: W, height: H, show: false, frame: false, transparent: true,
      resizable: false, movable: false, focusable: false, skipTaskbar: true,
      hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    });
    this.win.setIgnoreMouseEvents(true);
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.webContents.once('did-finish-load', () => { this.loaded = true; this.applyTitle(); });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'ghost.html'));
  }

  applyTitle() {
    if (!this.loaded || this.win.isDestroyed()) return;
    this.win.webContents
      .executeJavaScript(`document.getElementById('t').textContent = ${JSON.stringify(this.title)}`)
      .catch(() => {});
  }

  follow() {
    if (!this.win || this.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    this.win.setBounds({ x: Math.round(p.x - 28), y: Math.round(p.y - 22), width: W, height: H });
  }

  show(title) {
    this.ensure();
    this.title = title || '';
    this.applyTitle();
    this.follow();
    this.win.showInactive();
    if (!this.timer) this.timer = setInterval(() => this.follow(), 16);
  }

  hide() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.win && !this.win.isDestroyed()) this.win.hide();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 20000); // 20 sn kullanılmazsa süreci kapat (bellek)
  }

  destroy() {
    clearTimeout(this.idleTimer);
    this.hide();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { Ghost };
