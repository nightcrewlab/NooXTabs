'use strict';
// Yeni açılan Gezgin pencerelerini izler.
//  - Uygulamanın kendi istediği pencereler (yeni sekme): request() ile beklenir, o sekmeye verilir.
//  - Dışarıdan açılanlar (Win+E, masaüstü, klasör açma...): yakalama açıksa onExternal(hwnd, kaynakPencere) ile bildirilir.
//
// İlk kare görünmesin diye: WinEvent kancasıyla Gezgin penceresi OLUŞTUĞU AN tamamen saydam yapılır (conceal),
// gömüldükten sonra gösterilir (reveal). Kanca kurulamazsa sadece yoklama çalışır (ilk kare görünebilir).
const explorer = require('./native/explorer');
const w = require('./native/win32');

const IDLE_MS = 250;
const FAST_MS = 15;
const REQUEST_TIMEOUT_MS = 8000;
const CONCEAL_TIMEOUT_MS = 1500; // gizlenen pencere bu sürede işlenmezse geri göster (donma güvenliği)

const EVENT_SYSTEM_FOREGROUND = 0x0003;
const EVENT_OBJECT_CREATE = 0x8000;
const EVENT_OBJECT_DESTROY = 0x8001;
const EVENT_OBJECT_SHOW = 0x8002;

class ExplorerWatcher {
  constructor({ onExternal, isManaged }) {
    this.onExternal = onExternal;
    this.isManaged = isManaged;
    this.autoCapture = true;
    this.pending = [];
    this.known = new Set(explorer.listWindows()); // başlangıçta açık olanlar yakalanmaz
    this.concealedAt = new Map();
    this.fgHistory = [];                           // en yeni başta: son ön plan pencereleri
    this.hooks = [];
    this.timer = null;
    this.stopped = false;

    this.installHooks();
    this.noteForeground(w.foregroundWindow());
    this.schedule();
  }

  installHooks() {
    try {
      const fg = w.hookEvents(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, 0, (_ev, hwnd) => this.noteForeground(hwnd));
      const win = w.hookEvents(EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW, 0x2, (ev, hwnd) => this.onWindowEvent(ev, hwnd));
      this.hooks = [fg, win].filter(Boolean);
      if (this.hooks.length < 2) console.error('[NooXTabs] WinEvent kancası kısmen kurulamadı; yoklamaya güveniliyor');
    } catch (e) {
      console.error('[NooXTabs] WinEvent kancası kurulamadı, yoklamaya dönülüyor:', e.message);
    }
  }

  noteForeground(hwnd) {
    if (!hwnd || this.fgHistory[0] === hwnd) return;
    this.fgHistory.unshift(hwnd);
    if (this.fgHistory.length > 6) this.fgHistory.length = 6;
  }

  // Yeni pencerenin açılmasından hemen ÖNCE ön planda olan pencere (nereden açıldığını anlamak için)
  origin(hwnd) { return this.fgHistory.find((x) => x !== hwnd) || 0; }

  onWindowEvent(ev, hwnd) {
    if (this.stopped || ev === EVENT_OBJECT_DESTROY) return;
    if (this.known.has(hwnd) || this.concealedAt.has(hwnd) || this.isManaged(hwnd)) return;
    if (w.getClassName(hwnd) !== 'CabinetWClass') return;
    if (!this.pending.length && !this.autoCapture) return; // yakalanmayacak: dokunma
    explorer.conceal(hwnd);
    this.concealedAt.set(hwnd, Date.now());
    this.schedule(0);
  }

  // Yeni bir Gezgin penceresi başlat; HWND bulununca çözülür (bulunamazsa null)
  request(dir) {
    return new Promise((resolve) => {
      const req = { resolve, timer: null };
      req.timer = setTimeout(() => {
        this.pending = this.pending.filter((r) => r !== req);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      this.pending.push(req);
      explorer.launch(dir);
      this.schedule(0);
    });
  }

  scan() {
    const cur = explorer.listWindows();
    const curSet = new Set(cur);
    for (const h of [...this.known]) if (!curSet.has(h)) this.known.delete(h); // HWND yeniden kullanımına karşı
    for (const h of [...this.concealedAt.keys()]) {
      if (!curSet.has(h)) { this.concealedAt.delete(h); explorer.reveal(h); }
    }

    for (const h of cur) {
      if (this.known.has(h)) continue;
      if (!explorer.isVisible(h)) continue; // henüz görünmeyen pencere bir sonraki taramada
      this.known.add(h);
      this.concealedAt.delete(h); // bundan sonrası gömme (reveal) ya da reveal ile biter

      const req = this.pending.shift();
      if (req) { clearTimeout(req.timer); req.resolve(h); continue; }
      if (this.autoCapture && !this.isManaged(h)) this.onExternal(h, this.origin(h));
      else explorer.reveal(h);
    }

    const now = Date.now();
    for (const [h, t] of [...this.concealedAt]) {
      if (now - t > CONCEAL_TIMEOUT_MS) { this.concealedAt.delete(h); this.known.add(h); explorer.reveal(h); }
    }
  }

  schedule(delay) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const ms = delay ?? (this.pending.length || this.concealedAt.size ? FAST_MS : IDLE_MS);
    this.timer = setTimeout(() => {
      try { this.scan(); } catch (e) { console.error('[NooXTabs] izleyici hatası:', e); }
      this.schedule();
    }, ms);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const r of this.pending) clearTimeout(r.timer);
    this.pending = [];
    for (const h of this.hooks) { try { h.stop(); } catch { /* yoksay */ } }
    this.hooks = [];
    explorer.revealAll(); // saydam kalan pencere olmasın
  }
}

module.exports = { ExplorerWatcher };
