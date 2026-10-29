'use strict';
// Tek bir NooXTabs penceresi: sekme çubuğu (renderer) + içine oturan Gezgin pencereleri (TabManager)
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { TabManager } = require('./tabs/tabManager');
const settings = require('./settings');
const { getIcon } = require('./icons');
const w32 = require('./native/win32');

const ROOT = path.join(__dirname, '..');
const TAB_BAR_H = 40;     // DIP, sekme çubuğu yüksekliği
const RESIZE_INSET = 8;   // DIP, kenarlarda boyutlandırma tutamaçları için boşluk
// Win10 Gezgin'in başlığı kaldırılınca boş kalan satırın yüksekliği (100% ölçekte px = 23 + 4 + 4).
// Boş şerit kalırsa artır, ribbon sekmeleri kesiliyorsa azalt.
const EXPLORER_TITLE_ROW = 31;

class HostWindow {
  constructor(manager, opts = {}) {
    this.manager = manager;
    this.dndArmed = false;

    const winOpts = {
      width: opts.width || 1200,
      height: opts.height || 760,
      minWidth: 640,
      minHeight: 420,
      backgroundColor: '#191919',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#202020', symbolColor: '#ffffff', height: TAB_BAR_H },
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(ROOT, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    };
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      winOpts.x = Math.round(opts.x);
      winOpts.y = Math.round(opts.y);
    }
    this.win = new BrowserWindow(winOpts);
    if (manager.explorerIcon) this.win.setIcon(manager.explorerIcon);
    // Pencere başlığı = aktif sekmenin klasör adı (görev çubuğu önizlemesi, Alt+Tab); sayfa başlığı ezmesin
    this.win.on('page-title-updated', (e) => e.preventDefault());

    this.tabs = new TabManager({
      getHost: () => this.hwnd(),
      getRect: () => this.contentRect(),
      requestExplorer: (dir) => manager.watcher.request(dir),
      onChange: (state) => {
        if (!this.win.isDestroyed()) {
          this.win.webContents.send('tabs:state', state);
          const active = state.tabs.find((t) => t.id === state.activeId);
          this.win.setTitle(active ? active.title : 'NooXTabs');
        }
        manager.scheduleSave();
      },
      onClosed: (entry) => manager.pushClosed(entry),
      getIcon,
      isVisible: () => !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized(),
      onEmpty: () => { if (!this.win.isDestroyed()) this.win.close(); },
    });

    const relayout = () => this.tabs.layout();
    ['resize', 'move', 'moved', 'maximize', 'unmaximize', 'restore', 'show', 'enter-full-screen', 'leave-full-screen']
      .forEach((ev) => this.win.on(ev, relayout));
    // Görev çubuğundan geri gelince / yeniden gösterilince Gezgin içeriğini yeniden çizdir
    // Büyütme / tam ekran gibi ani büyük boyut değişimlerinde de Gezgin yeni alanı çizmeyebiliyor (beyazlık)
    ['restore', 'show', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
      .forEach((ev) => this.win.on(ev, () => this.tabs.refresh()));
    this.onMetrics = relayout;
    screen.on('display-metrics-changed', this.onMetrics);

    // Boyutlandırırken Gezgin'i pencereden ÖNCE yeni boyuta al (beyaz boşlukları azaltır)
    this.win.on('will-resize', (_e, nb) => this.tabs.layout(this.contentRect(nb)));

    this.win.on('focus', () => { manager.lastActive = this; this.handoffFocus(); });

    // Pencere boyutunu hatırla (Windows gibi: sonraki pencereler aynı boyutta açılır)
    ['resize', 'maximize', 'unmaximize'].forEach((ev) => this.win.on(ev, () => manager.rememberBounds(this)));

    this.win.on('close', () => {
      manager.saveBounds(this); // pencere hâlâ geçerliyken son boyutu kaydet
      if (manager.quitting) {
        // Çıkış: oturum hatırlanıyorsa Gezgin'ler kapanır (açılışta geri gelir), değilse normal pencere olarak açık kalır
        if (settings.get('restoreSession')) this.tabs.closeAll(); else this.tabs.releaseAll();
      } else {
        this.tabs.closeAll(); // pencereyi kapatmak sekmeleri kapatır
      }
    });
    this.win.on('closed', () => {
      screen.removeListener('display-metrics-changed', this.onMetrics);
      this.tabs.destroy();
      manager.remove(this);
    });

    this.win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    this.win.webContents.once('did-finish-load', relayout);
  }

  // Oturum kaydı: pencere konumu/boyutu + geri açılabilen sekmeler
  snapshot() {
    const s = this.tabs.snapshot();
    return { bounds: this.win.getNormalBounds(), maximized: this.win.isMaximized(), tabs: s.tabs, active: s.active };
  }

  // Host HWND (Number)
  hwnd() {
    if (!this._hwnd) {
      const b = this.win.getNativeWindowHandle();
      this._hwnd = Number(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); // pencere ömrü boyunca sabit
    }
    return this._hwnd;
  }

  // Gezgin'in yerleşeceği alan: içerik alanı (sekme çubuğu hariç), EKRAN koordinatları, fiziksel piksel
  contentRect(bounds) {
    if (this.win.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0, clipTop: 0 };
    const cb = bounds || this.win.getContentBounds(); // DIP
    const inset = this.win.isMaximized() || this.win.isFullScreen() ? 0 : RESIZE_INSET;
    const rect = screen.dipToScreenRect(this.win, {
      x: cb.x + inset,
      y: cb.y + TAB_BAR_H,
      width: Math.max(0, cb.width - inset * 2),
      height: Math.max(0, cb.height - TAB_BAR_H - inset),
    });
    const sf = screen.getDisplayMatching(this.win.getBounds()).scaleFactor;
    rect.clipTop = Math.round(EXPLORER_TITLE_ROW * sf);
    return rect;
  }

  // Sekme çubuğuna tıklanınca odağı hemen Gezgin'e devret.
  // Fare basılıyken (tıklama/sürükleme) bekle, bırakılınca ve pencere yerinde duruyorsa devret.
  handoffFocus() {
    const start = JSON.stringify(this.win.getBounds());
    let n = 0;
    const t = setInterval(() => {
      if (this.win.isDestroyed() || ++n > 60) return clearInterval(t);
      if (w32.isLeftDown()) return;
      clearInterval(t);
      if (this.win.isFocused() && JSON.stringify(this.win.getBounds()) === start) this.tabs.focusActive();
    }, 30);
  }

  // İmleç konumu (ekran + bu pencerenin istemci koordinatı, DIP) ve sol tuş durumu
  cursor() {
    const p = screen.getCursorScreenPoint();
    const cb = this.win.getContentBounds();
    return { sx: p.x, sy: p.y, cx: p.x - cb.x, cy: p.y - cb.y, down: w32.isLeftDown() };
  }

  // Ekran noktası (DIP) bu pencerenin sekme çubuğunun üstünde mi?
  isOverTabBar(sx, sy) {
    if (this.win.isDestroyed() || this.win.isMinimized() || !this.win.isVisible()) return false;
    const b = this.win.getBounds();
    return sx >= b.x && sx <= b.x + b.width && sy >= b.y && sy <= b.y + TAB_BAR_H + 6;
  }
}

module.exports = { HostWindow, TAB_BAR_H };
