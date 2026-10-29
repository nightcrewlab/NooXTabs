'use strict';
const path = require('path');
const { app, screen, powerMonitor, globalShortcut, Menu, clipboard } = require('electron');
const { HostWindow } = require('./hostWindow');
const { ExplorerWatcher } = require('./watcher');
const { Ghost } = require('./ghost');
const explorer = require('./native/explorer');
const w32 = require('./native/win32');
const settings = require('./settings');
const session = require('./session');

class WindowManager {
  constructor() {
    this.hosts = new Set();
    this.lastActive = null;
    this.quitting = false;
    this.restoring = false;
    this.closedTabs = [];   // geri açılabilir kapatılmış sekmeler (en yeni sonda)
    this.saveTimer = null;
    this.boundsTimer = null;
    this.ghost = new Ghost();
    this.watcher = new ExplorerWatcher({
      onExternal: (hwnd, originFg) => this.capture(hwnd, originFg),
      isManaged: (hwnd) => this.isManaged(hwnd),
    });
    this.watcher.autoCapture = this.externalMode !== 'off';

    // Dışarıdan (ör. Gezgin'den) dosya/klasör sürüklenirken sekme çubuğunun bırakma kabul etmesi için
    this.wasDown = false;
    this.pressOutsideBar = false;
    this.shortcutsOn = false;

    // Görev çubuğunda Gezgin gibi görünsün: pencere simgesi explorer.exe simgesi (kimlik gruplaması main.js'de)
    this.explorerIcon = null;
    if (settings.get('groupWithExplorer')) {
      const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
      app.getFileIcon(exe, { size: 'large' }).then((img) => {
        if (img.isEmpty()) return;
        this.explorerIcon = img;
        for (const h of this.hosts) if (!h.win.isDestroyed()) h.win.setIcon(img);
      }).catch(() => {});
    }
    this.dndTimer = setInterval(() => this.dndTick(), 40);

    // Ekran kilidi açılınca / uykudan dönünce de Gezgin içerikleri bozuk kalabiliyor
    this.onWake = () => { for (const h of this.hosts) if (!h.win.isDestroyed()) h.tabs.refresh(); };
    powerMonitor.on('unlock-screen', this.onWake);
    powerMonitor.on('resume', this.onWake);
  }

  // 'new-window' | 'last-window' | 'off'
  get externalMode() { return settings.get('externalMode'); }
  setExternalMode(mode) {
    settings.set('externalMode', mode);
    this.watcher.autoCapture = mode !== 'off';
  }

  // ---- Klavye kısayolları ----
  // Sadece NooXTabs penceresi (ya da içindeki Gezgin) ön plandayken kayıtlı olur; başka uygulamalara karışmaz.
  // Global kısayol olduğu için Gezgin odaktayken de çalışır.
  updateShortcuts() {
    const on = !!this.hostOfForeground(w32.foregroundWindow());
    if (on === this.shortcutsOn) return;
    this.shortcutsOn = on;
    if (on) this.registerShortcuts(); else globalShortcut.unregisterAll();
  }

  registerShortcuts() {
    const reg = (acc, fn) => {
      try {
        globalShortcut.register(acc, () => {
          const h = this.hostOfForeground(w32.foregroundWindow());
          if (h) fn(h);
        });
      } catch { /* başka uygulama tutuyorsa atla */ }
    };
    reg('Ctrl+T', (h) => h.tabs.newTab());
    reg('Ctrl+W', (h) => h.tabs.closeActive());
    reg('Ctrl+Tab', (h) => h.tabs.cycle(1));
    reg('Ctrl+Shift+Tab', (h) => h.tabs.cycle(-1));
    reg('Ctrl+Shift+T', (h) => this.reopenClosed(h));
    for (let i = 1; i <= 9; i++) reg(`Ctrl+${i}`, (h) => h.tabs.activateIndex(i === 9 ? -1 : i - 1));
  }

  // ---- Sekme sağ tık menüsü ----
  showTabMenu(host, id) {
    if (!host) return;
    const tab = host.tabs.tabs.find((t) => t.id === id);
    if (!tab) return;
    const count = host.tabs.count();
    const index = host.tabs.tabs.indexOf(tab);
    const path = tab.loc && tab.loc.path;
    Menu.buildFromTemplate([
      { label: 'Yeni sekme', click: () => host.tabs.newTab() },
      { label: 'Sekmeyi çoğalt', enabled: !!(tab.loc && tab.loc.target), click: () => host.tabs.duplicate(id) },
      { label: 'Yeni pencerede aç', enabled: count > 1, click: () => this.moveToNewWindow(host, id) },
      { label: 'Yolu kopyala', enabled: !!path, click: () => clipboard.writeText(path) },
      { type: 'separator' },
      { label: 'Sekmeyi kapat', click: () => host.tabs.close(id) },
      { label: 'Diğer sekmeleri kapat', enabled: count > 1, click: () => host.tabs.closeOthers(id) },
      { label: 'Sağdaki sekmeleri kapat', enabled: index < count - 1, click: () => host.tabs.closeRight(id) },
    ]).popup({ window: host.win });
  }

  moveToNewWindow(src, id) {
    if (src.tabs.count() < 2) return;
    const b = this.detachBounds(src);
    const nh = this.createHost(this.fitToDisplay({ x: b.x + 40, y: b.y + 40, width: b.width, height: b.height }));
    src.tabs.transferTo(id, nh.tabs);
  }

  // Ayrılan sekmenin penceresi kaynağın NORMAL boyutunu alır (büyütülmüş / tam ekran boyutunu değil)
  detachBounds(src) {
    const b = src.win.isMaximized() || src.win.isFullScreen() ? src.win.getNormalBounds() : src.win.getBounds();
    const wb = settings.get('windowBounds');
    const a = screen.getDisplayMatching(b).workArea;
    // Normal boyut da ekranı kaplıyorsa (ör. hiç küçültülmemiş pencere) makul bir boyuta indir
    if (b.width >= a.width - 16 || b.height >= a.height - 16) {
      const w = wb && wb.width < a.width - 16 ? wb.width : Math.round(a.width * 0.7);
      const h = wb && wb.height < a.height - 16 ? wb.height : Math.round(a.height * 0.75);
      return { x: b.x, y: b.y, width: w, height: h };
    }
    return b;
  }

  // Pencereyi bulunduğu ekranın çalışma alanına sığdır
  fitToDisplay(b) {
    const a = screen.getDisplayNearestPoint({ x: Math.round(b.x + Math.min(b.width, 200) / 2), y: Math.round(b.y + 10) }).workArea;
    const width = Math.min(b.width, a.width);
    const height = Math.min(b.height, a.height);
    const x = Math.round(Math.max(a.x, Math.min(b.x, a.x + a.width - width)));
    const y = Math.round(Math.max(a.y, Math.min(b.y, a.y + a.height - height)));
    return { x, y, width, height };
  }

  // Sol tuş sekme çubuğu DIŞINDA basılıp çubuğun üstüne gelinirse (dışarıdan sürükleme) çubuğu "bırakılabilir" yap.
  // Çubuk normalde pencere sürükleme bölgesi olduğu için bırakma olaylarını yutabilir.
  dndTick() {
    this.updateShortcuts();
    const down = w32.isLeftDown();
    const p = screen.getCursorScreenPoint();
    if (down && !this.wasDown) {
      this.pressOutsideBar = ![...this.hosts].some((h) => h.isOverTabBar(p.x, p.y));
    }
    this.wasDown = down;
    for (const h of this.hosts) {
      if (h.win.isDestroyed()) continue;
      const want = down && this.pressOutsideBar && h.isOverTabBar(p.x, p.y);
      if (want !== h.dndArmed) {
        h.dndArmed = want;
        h.win.webContents.send('dnd:arm', want);
      }
    }
  }

  // opts verilmezse son kullanılan pencere boyutu (ve büyütülmüşlük) uygulanır; diğer pencerelerin üstüne tam oturmasın diye hafif kaydırılır.
  // Açıkça boyut verilirse (sekme ayırma, oturum geri yükleme) olduğu gibi kullanılır.
  createHost(opts = {}) {
    const o = { ...opts };
    let maximize = false;
    if (!o.noRemember && o.width === undefined) {
      const wb = settings.get('windowBounds');
      if (wb && wb.width && wb.height) {
        o.width = wb.width;
        o.height = wb.height;
        maximize = !!wb.maximized;
        const ref = this.liveHost();
        if (ref && !ref.win.isMaximized() && !ref.win.isMinimized() && !maximize) {
          const b = ref.win.getBounds();
          const a = screen.getDisplayMatching(b).workArea;
          const x = b.x + 30;
          const y = b.y + 30;
          if (x + o.width <= a.x + a.width && y + o.height <= a.y + a.height) { o.x = x; o.y = y; }
        }
      }
    }
    const h = new HostWindow(this, o);
    if (maximize) h.win.maximize();
    this.hosts.add(h);
    this.lastActive = h;
    return h;
  }

  // ---- Pencere boyutunu hatırlama ----
  rememberBounds(h) {
    if (this.quitting || this.restoring) return;
    clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => this.saveBounds(h), 400);
  }

  saveBounds(h) {
    if (this.quitting || this.restoring) return;
    if (h.win.isDestroyed() || h.win.isMinimized() || h.win.isFullScreen()) return;
    const b = h.win.getNormalBounds(); // büyütülmüşken bile normal (geri yüklenmiş) boyut
    settings.set('windowBounds', { width: b.width, height: b.height, maximized: h.win.isMaximized() });
  }

  remove(h) {
    this.hosts.delete(h);
    if (this.lastActive === h) this.lastActive = [...this.hosts].pop() || null;
    // Son pencere kullanıcı tarafından kapatıldı: açılışta otomatik geri yüklenmesin
    if (this.hosts.size === 0 && !this.quitting && !this.restoring) {
      clearTimeout(this.saveTimer);
      session.markClosedByUser();
    }
  }

  // ---- Kapatılan sekmeler ----
  pushClosed(entry) {
    if (!entry || !entry.target) return;
    const last = this.closedTabs[this.closedTabs.length - 1];
    if (last && last.target === entry.target) return;
    this.closedTabs.push(entry);
    if (this.closedTabs.length > 25) this.closedTabs.shift();
  }

  // Son kapatılan sekmeyi bu pencerede yeniden aç
  async reopenClosed(host) {
    const entry = this.closedTabs.pop();
    if (!entry || !host) return null;
    return host.tabs.newTab(entry.target);
  }

  // ---- Oturum ----
  scheduleSave() {
    if (this.quitting || this.restoring) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 1500);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    const windows = [...this.hosts].filter((h) => !h.win.isDestroyed()).map((h) => h.snapshot())
      .filter((w) => w.tabs.length > 0);
    if (windows.length === 0) return; // boşsa son geçerli oturumu koru
    session.save({ windows, closedByUser: false, savedAt: Date.now() });
  }

  // Otomatik geri yükleme gerekli mi? (auto: kullanıcı son pencereyi kendi kapattıysa hayır)
  hasSession(auto) {
    const s = session.load();
    return !!(s && s.windows && s.windows.length && !(auto && s.closedByUser));
  }

  // Kayıtlı pencereleri ve sekmeleri sırayla yeniden aç (Gezgin'ler birbirine karışmasın diye ardışık)
  async restoreSession() {
    const s = session.load();
    if (!s || !s.windows || !s.windows.length) return false;
    this.restoring = true;
    try {
      for (const wd of s.windows) {
        const h = this.createHost({ ...this.usableBounds(wd.bounds), noRemember: true });
        if (wd.maximized) h.win.maximize();
        let activeId = null;
        for (let i = 0; i < wd.tabs.length; i++) {
          const id = await h.tabs.newTab(wd.tabs[i].target);
          if (id && i === wd.active) activeId = id;
        }
        if (activeId) h.tabs.activate(activeId);
        else if (h.tabs.count() === 0 && !h.win.isDestroyed()) h.win.close();
      }
    } finally {
      this.restoring = false;
    }
    if (this.hosts.size === 0) this.newWindow();
    this.scheduleSave();
    return true;
  }

  // Kayıtlı konum hiçbir ekrana denk gelmiyorsa (ekran çıkarıldı) konumu bırak, boyut kalsın
  usableBounds(b) {
    if (!b) return {};
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    return visible ? b : { width: b.width, height: b.height };
  }

  hostFor(sender) {
    for (const h of this.hosts) {
      if (!h.win.isDestroyed() && h.win.webContents.id === sender.id) return h;
    }
    return null;
  }

  liveHost() {
    if (this.lastActive && !this.lastActive.win.isDestroyed()) return this.lastActive;
    return [...this.hosts].find((h) => !h.win.isDestroyed()) || null;
  }

  surface(h) {
    if (h.win.isMinimized()) h.win.restore();
    h.win.show();
    h.win.moveTop();
  }

  // Yeni pencere + ilk sekme
  newWindow() {
    const h = this.createHost();
    h.win.webContents.once('did-finish-load', () => h.tabs.newTab());
    return h;
  }

  // Açık pencere varsa öne getir, yoksa yenisini aç
  openWindow() {
    const h = this.liveHost();
    if (h) { this.surface(h); h.win.focus(); } else this.newWindow();
  }

  isManaged(hwnd) {
    for (const h of this.hosts) if (h.tabs.has(hwnd)) return true;
    return false;
  }

  // Bu ön plan penceresi (host ya da içindeki bir Gezgin sekmesi) hangi NooXTabs penceresine ait?
  hostOfForeground(fg) {
    if (!fg) return null;
    for (const h of this.hosts) {
      if (h.win.isDestroyed()) continue;
      if (h.hwnd() === fg || h.tabs.has(fg)) return h;
    }
    return null;
  }

  // Yeni açılan Gezgin'i yakala:
  //  - NooXTabs içinden açıldıysa (kaynak ön plan pencere bizimse) o pencereye sekme olur
  //  - dışarıdan açıldıysa (masaüstü, Win+E...) ayara göre yeni pencerede ya da son pencerede
  capture(hwnd, originFg = 0) {
    if (this.isManaged(hwnd)) return;
    const mode = this.externalMode;
    if (mode === 'off') { explorer.reveal(hwnd); return; }

    const originHost = this.hostOfForeground(originFg);
    if (originHost) { this.surface(originHost); originHost.tabs.adopt(hwnd); return; }

    if (mode === 'last-window') {
      let h = this.liveHost();
      if (!h) h = this.createHost(); else this.surface(h);
      h.tabs.adopt(hwnd);
      return;
    }
    this.createHost().tabs.adopt(hwnd); // 'new-window'
  }

  // Tepsi menüsü: açık olan tüm Gezgin pencerelerini tek pencerede sekmeye al
  captureExisting() {
    const list = explorer.listWindows().filter((h) => explorer.isVisible(h) && !this.isManaged(h));
    if (!list.length) return;
    let host = this.liveHost();
    if (!host) host = this.createHost(); else this.surface(host);
    for (const hwnd of list) host.tabs.adopt(hwnd);
  }

  // Sürüklenen sekme bırakıldı: başka pencerenin çubuğuna → birleştir, boşluğa → yeni pencere
  dropTab(src, id) {
    this.ghost.hide();
    if (!src) return;
    const p = screen.getCursorScreenPoint();

    const target = [...this.hosts].find((h) => h !== src && h.isOverTabBar(p.x, p.y));
    if (target) {
      src.tabs.transferTo(id, target.tabs);
      this.surface(target);
      return;
    }

    if (src.tabs.count() > 1) {
      const b = this.detachBounds(src);
      const nh = this.createHost(this.fitToDisplay({ x: p.x - 100, y: p.y - 20, width: b.width, height: b.height }));
      src.tabs.transferTo(id, nh.tabs);
      return;
    }

    // Tek sekmeli pencerede sekmeyi dışarı bırakmak pencereyi taşır (büyütülmüşse önce normal boyuta döner)
    if (src.win.isFullScreen()) src.win.setFullScreen(false);
    if (src.win.isMaximized()) {
      const b = this.detachBounds(src);
      src.win.unmaximize();
      src.win.setBounds(this.fitToDisplay({ x: p.x - 100, y: p.y - 20, width: b.width, height: b.height }));
    } else {
      src.win.setPosition(Math.round(p.x - 100), Math.round(p.y - 20));
    }
    src.tabs.layout();
  }

  beginQuit() {
    if (!this.restoring) this.saveNow(); // kapanma sırasındaki değişiklikler oturumu bozmasın: önce kaydet
    this.quitting = true;
    clearInterval(this.dndTimer);
    globalShortcut.unregisterAll();
    powerMonitor.removeListener('unlock-screen', this.onWake);
    powerMonitor.removeListener('resume', this.onWake);
    this.watcher.stop();
    this.ghost.destroy();
  }
}

module.exports = { WindowManager };
