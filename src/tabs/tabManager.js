'use strict';
const fs = require('fs');
const path = require('path');
const explorer = require('../native/explorer');

let seq = 1; // sekme id'leri tüm pencereler arasında benzersiz
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FULL_LOCATION_EVERY = 6; // aktif olmayan sekmelerin konumu her 6. yoklamada (≈3 sn) güncellenir
const PRESIZE_DELAY = 250;     // boyutlandırma durulunca gizli sekmeler de yeni boyuta alınır
const sizeKey = (r) => `${r.width}x${r.height}x${r.clipTop || 0}`;

class TabManager {
  constructor({ getHost, getRect, requestExplorer, onChange, onEmpty, onClosed, isVisible, getIcon }) {
    this.getHost = getHost;
    this.getRect = getRect;
    this.requestExplorer = requestExplorer;
    this.onChange = onChange;
    this.onEmpty = onEmpty;
    this.onClosed = onClosed;
    this.isVisible = isVisible || (() => true);
    this.getIcon = getIcon;
    this.refreshTimers = [];
    this.presizeTimer = null;
    this.tabs = [];
    this.activeId = null;
    this.opening = false;
    this.destroyed = false;
    this.pollCount = 0;
    this.timer = setInterval(() => this.poll(), 500);
    this.layoutTimer = setInterval(() => this.checkActiveLayout(), 250);
  }

  state() {
    return {
      activeId: this.activeId,
      tabs: this.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        path: t.loc ? t.loc.path || t.loc.display : '', // ipucu için tam yol / görünen ad
        icon: t.icon || null,                            // klasör simgesi (veri URL'si)
      })),
    };
  }

  emit() { if (!this.destroyed) this.onChange(this.state()); }
  count() { return this.tabs.length; }
  has(hwnd) { return this.tabs.some((t) => t.hwnd === hwnd); }

  // Yeni Gezgin başlat ve sekme olarak ekle (afterId verilirse o sekmenin hemen yanına)
  async newTab(dir, afterId) {
    if (this.opening) return null;
    this.opening = true;
    try {
      const hwnd = await this.requestExplorer(dir);
      if (!hwnd) { console.error('[NooXTabs] Gezgin penceresi bulunamadı'); return null; }
      if (this.destroyed) return null;
      return this.adopt(hwnd, afterId);
    } finally {
      this.opening = false;
    }
  }

  // Sürükle-bırak ile gelen yollar: klasör ise o klasör, dosya ise bulunduğu klasör yeni sekmede açılır
  async openPaths(paths) {
    const dirs = [];
    for (const p of (Array.isArray(paths) ? paths : []).slice(0, 10)) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
      try { dirs.push(fs.statSync(p).isDirectory() ? p : path.dirname(p)); } catch { /* yoksay */ }
    }
    for (const d of new Set(dirs)) {
      while (this.opening) await sleep(50);
      await this.newTab(d);
    }
  }

  // Sekmeyi çoğalt: aynı konumu hemen yanında yeni sekmede aç
  async duplicate(id) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return null;
    this.refreshLocation(t);
    const target = t.loc && t.loc.target;
    if (!target) return null; // konumu bilinmiyor / geri açılamayan sanal konum
    while (this.opening) await sleep(50);
    return this.newTab(target, id);
  }

  // Var olan bir Gezgin penceresini sekme olarak al (otomatik yakalama)
  adopt(hwnd, afterId) {
    const tab = { id: seq++, hwnd, title: explorer.getTitle(hwnd) || 'Gezgin', loc: null, locCache: {} };
    this.addTab(tab);
    if (afterId) {
      const from = this.tabs.findIndex((t) => t.id === tab.id);
      const to = this.tabs.findIndex((t) => t.id === afterId);
      if (from !== -1 && to !== -1) {
        this.tabs.splice(from, 1);
        this.tabs.splice(to + 1, 0, tab);
        this.emit();
      }
    }
    return tab.id;
  }

  addTab(tab) {
    if (!tab.locCache) tab.locCache = {};
    const rect = this.getRect();
    explorer.embed(tab.hwnd, this.getHost(), rect);
    tab.size = sizeKey(rect);
    this.tabs.push(tab);
    this.refreshLocation(tab);
    this.activate(tab.id);
    this.refresh(); // yeni yerleşen / başka pencereden gelen Gezgin'i yeni boyutunda tamamen çizdir
  }

  activate(id, focus = true) {
    const target = this.tabs.find((t) => t.id === id);
    if (!target) return;
    this.activeId = id;
    target.sig = undefined;
    target.quietUntil = Date.now() + 900;
    const rect = this.getRect();
    const key = sizeKey(rect);
    const stale = target.size !== key; // gizliyken boyutu değişmemiş: gösterince yeniden düzen gerekir
    target.size = key;
    // Önce yenisini göster, sonra diğerlerini gizle: arada boş (host arka planı) kare görünmesin
    explorer.place(target.hwnd, rect);
    for (const t of this.tabs) if (t.id !== id) explorer.hide(t.hwnd);
    if (focus) explorer.focus(target.hwnd);
    if (stale) this.refresh();
    this.emit();
  }

  // ---- Kısayollar / menü işlemleri ----
  closeActive() { if (this.activeId != null) this.close(this.activeId); }

  // delta: +1 sonraki, -1 önceki (baştan/sondan döner)
  cycle(delta) {
    const n = this.tabs.length;
    if (n < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + delta + n) % n].id);
  }

  // index: 0 tabanlı; -1 = son sekme (Ctrl+9)
  activateIndex(index) {
    const t = index < 0 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (t) this.activate(t.id);
  }

  closeOthers(id) { for (const t of [...this.tabs]) if (t.id !== id) this.close(t.id); }

  closeRight(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    for (const t of this.tabs.slice(i + 1)) this.close(t.id);
  }

  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [tab] = this.tabs.splice(i, 1);
    this.refreshLocation(tab);
    this.noteClosed(tab);
    explorer.requestClose(tab.hwnd);
    this.afterRemove(tab.id, i);
  }

  // Sekmeyi (Gezgin penceresini kapatmadan) başka bir pencerenin sekme yöneticisine aktar.
  // Önce hedefe bağlanır, sonra kaynak güncellenir: kaynak boşalıp kapanırken Gezgin onunla yok olmasın.
  transferTo(id, target) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1 || target === this) return;
    const [tab] = this.tabs.splice(i, 1);
    target.addTab(tab);
    this.afterRemove(tab.id, i, false);
  }

  afterRemove(removedId, index, focus = true) {
    if (this.tabs.length === 0) {
      this.activeId = null;
      this.emit();
      if (this.onEmpty) this.onEmpty();
      return;
    }
    if (this.activeId === removedId) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activate(next.id, focus);
    } else {
      this.emit();
    }
  }

  // ids: yeni sıradaki sekme id'leri
  reorder(ids) {
    const map = new Map(this.tabs.map((t) => [t.id, t]));
    const next = ids.map((id) => map.get(id)).filter(Boolean);
    if (next.length === this.tabs.length) this.tabs = next;
    this.emit();
  }

  // rect verilirse (ör. will-resize) o alana, verilmezse güncel alana yerleştir
  layout(rect) {
    if (this.destroyed) return;
    const r = rect || this.getRect();
    const t = this.tabs.find((x) => x.id === this.activeId);
    if (t) { t.sig = undefined; t.quietUntil = Date.now() + 900; t.size = sizeKey(r); explorer.place(t.hwnd, r); }
    if (this.tabs.length > 1) {
      clearTimeout(this.presizeTimer);
      this.presizeTimer = setTimeout(() => this.presizeHidden(), PRESIZE_DELAY);
    }
  }

  // Aktif olmayan sekmeleri (gizli kalarak) güncel alana al
  presizeHidden() {
    if (this.destroyed || !this.isVisible()) return;
    const rect = this.getRect();
    const key = sizeKey(rect);
    for (const t of this.tabs) {
      if (t.id === this.activeId || t.size === key || !explorer.isAlive(t.hwnd)) continue;
      explorer.presize(t.hwnd, rect);
      t.size = key;
    }
  }

  // Pencere görev çubuğundan geri gelince / ekran kilidi açılınca Gezgin içeriği (DirectUI) yeniden çizilmeyebilir:
  // aktif sekmenin boyutunu 1 px oynatıp geri alarak düzeni ve çizimi yeniden tetikle.
  refresh() {
    if (this.destroyed) return;
    for (const t of this.refreshTimers) clearTimeout(t);
    const run = () => {
      if (this.destroyed || !this.isVisible()) return; // simge durumundayken konum geçersiz, dokunma
      const t = this.tabs.find((x) => x.id === this.activeId);
      if (!t || !explorer.isAlive(t.hwnd)) return;
      t.sig = undefined;
      t.quietUntil = Date.now() + 900;
      explorer.nudge(t.hwnd, this.getRect());
    };
    this.refreshTimers = [setTimeout(run, 60), setTimeout(run, 300), setTimeout(run, 900)];
  }

  // Host'a tıklanınca odağı aktif Gezgin'e ver
  focusActive() {
    const t = this.tabs.find((x) => x.id === this.activeId);
    if (t) explorer.focus(t.hwnd);
  }

  // ---- Konum (açık klasör) ----

  // Sekmenin açık klasörünü adres çubuğundan oku. Değiştiyse true.
  refreshLocation(t) {
    const now = Date.now();
    if (!t.loc && t.locCache.nextTry && now < t.locCache.nextTry) return false;
    let loc = null;
    try { loc = explorer.readLocation(t.hwnd, t.locCache); } catch { return false; }
    if (!loc) { t.locCache.nextTry = now + 3000; return false; }
    t.locCache.nextTry = 0;
    if (t.loc && t.loc.display === loc.display && t.loc.target === loc.target) return false;
    t.loc = loc;
    this.loadIcon(t);
    if (explorer.DEBUG) console.log(`[NooXTabs] konum: ${loc.display} -> ${loc.target || '(açılamaz)'}`);
    return true;
  }

  // Konumun simgesini asenkron yükle; hazır olunca sekmeyi güncelle
  loadIcon(t) {
    if (!this.getIcon || !t.loc) return;
    const loc = t.loc;
    this.getIcon(loc).then((url) => {
      if (this.destroyed || t.loc !== loc || url === t.icon) return;
      t.icon = url;
      this.emit();
    }).catch(() => {});
  }

  // Kapanan sekmeyi "geri aç" yığınına bildir
  noteClosed(tab) {
    if (!this.onClosed || !tab.loc || !tab.loc.target) return;
    this.onClosed({ target: tab.loc.target, display: tab.loc.display, title: tab.title });
  }

  // Oturum kaydı için: geri açılabilen sekmeler ve aktif olanın sırası
  snapshot() {
    const keep = this.tabs.filter((t) => t.loc && t.loc.target);
    const active = Math.max(0, keep.findIndex((t) => t.id === this.activeId));
    return { tabs: keep.map((t) => ({ target: t.loc.target })), active };
  }

  // ---- Düzen ----

  // Gezgin iç düzeni değişti mi (ör. ribbon sabitlendi → üstte gri boşluk)? Değişim durulunca çerçeveyi yeniden hesaplat.
  checkActiveLayout() {
    if (this.destroyed) return;
    const t = this.tabs.find((x) => x.id === this.activeId);
    if (!t || Date.now() < (t.quietUntil || 0)) return;
    let sig;
    try { sig = explorer.layoutSignature(t.hwnd); } catch { return; }
    if (t.sig === undefined) { t.sig = sig; t.settling = false; return; }
    if (sig !== t.sig) {
      if (explorer.DEBUG) console.log('[NooXTabs] Gezgin düzeni değişti:\n' + explorer.describeChildren(t.hwnd));
      t.sig = sig;
      t.settling = true;
      return;
    }
    if (t.settling) {
      t.settling = false;
      explorer.nudge(t.hwnd, this.getRect());
      t.sig = undefined;
      t.quietUntil = Date.now() + 900;
    }
  }

  // Kapanan pencereleri temizle, başlık ve konumları güncelle
  poll() {
    this.pollCount++;
    const full = this.pollCount % FULL_LOCATION_EVERY === 0;
    let changed = false;
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const t = this.tabs[i];
      if (!explorer.isAlive(t.hwnd)) {
        this.tabs.splice(i, 1);
        this.noteClosed(t); // Gezgin içinden kapatıldı (Alt+F4 vb.): son bilinen konumla geri açılabilsin
        this.afterRemove(t.id, i);
        return;
      }
      const title = explorer.getTitle(t.hwnd) || 'Gezgin';
      if (title !== t.title) { t.title = title; changed = true; }
      if ((t.id === this.activeId || full || !t.loc) && this.refreshLocation(t)) changed = true;
    }
    if (changed) this.emit();
  }

  // Pencere kapanırken: tüm Gezgin pencerelerini kapat
  closeAll() {
    for (const t of this.tabs) { this.refreshLocation(t); this.noteClosed(t); explorer.requestClose(t.hwnd); }
    this.tabs = [];
    this.activeId = null;
  }

  // Uygulama kapanırken: Gezgin pencerelerini kapatmadan normal pencereye geri ver
  releaseAll() {
    const rect = this.getRect();
    for (const t of this.tabs) explorer.release(t.hwnd, rect);
    this.tabs = [];
    this.activeId = null;
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    clearInterval(this.layoutTimer);
    clearTimeout(this.presizeTimer);
    for (const t of this.refreshTimers) clearTimeout(t);
  }
}

module.exports = { TabManager };
