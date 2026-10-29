'use strict';
// Gerçek explorer.exe pencerelerini bulma, "gömme" (owner + çerçevesiz, host'un üstünde takip), yerleştirme, bırakma.
//
// Neden SetParent değil? Windows 10 Gezgini child pencere olunca doğru çizilmiyor / boyutlanmıyor.
// Bunun yerine Gezgin çerçevesiz üst düzey pencere olarak kalır ve host'un "owned" penceresi yapılır:
//  - her zaman host'un üstünde durur, host küçülünce gizlenir, host kapanınca yok olur
//  - görev çubuğunda ayrı düğme çıkmaz (WS_EX_TOOLWINDOW)
//  - konumu host'un içerik alanına eşitlenir
const { spawn } = require('child_process');
const w = require('./win32');
const { parseAddress } = require('./address');
const { C } = w;

const EXPLORER_CLASS = 'CabinetWClass';
const saved = new Map();      // hwnd -> { style, ex } (gömülmeden önceki stiller)
const concealed = new Map();  // hwnd -> özgün ex stil (gizlenmiş / alfa=0 pencereler)
const DEBUG = !!process.env.NOOX_DEBUG;

function listWindows() { return w.findWindows(EXPLORER_CLASS); }

// Yeni bir Gezgin penceresi başlat (HWND'yi izleyici bulur: watcher.js)
function launch(dir = process.env.USERPROFILE) {
  const child = spawn('explorer.exe', [`/n,/e,"${dir}"`], {
    windowsVerbatimArguments: true,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (e) => console.error('[NooXTabs] explorer.exe başlatılamadı:', e.message));
  child.unref();
}

// Pencereyi host'a bağla. Zaten gömülü bir pencere başka host'a aktarılırken de çağrılır (idempotent).
function embed(hwnd, host, rect) {
  const first = !saved.has(hwnd);
  w.show(hwnd, C.SW_RESTORE); // büyütülmüş durumdan çık
  if (first) {
    saved.set(hwnd, { style: w.getStyle(hwnd), ex: concealed.get(hwnd) ?? w.getExStyle(hwnd) });
    // Pencere görev çubuğuna zaten düğme eklemiş olabilir. Stil/owner değişince düğme kalkmıyor:
    // önce gizle, sonra (aşağıda place ile) tekrar göster. Böylece kabuk düğmeyi/önizlemeyi kaldırır.
    w.show(hwnd, C.SW_HIDE);
  }

  const style = w.getStyle(hwnd);
  const ex = w.getExStyle(hwnd);
  const strip = C.WS_CAPTION | C.WS_THICKFRAME | C.WS_SYSMENU | C.WS_MINIMIZEBOX | C.WS_MAXIMIZEBOX;
  w.setStyle(hwnd, (style & ~strip) >>> 0);
  w.setExStyle(hwnd, ((ex & ~C.WS_EX_APPWINDOW) | C.WS_EX_TOOLWINDOW) >>> 0);
  w.setOwner(hwnd, host);
  place(hwnd, rect, true);
  scheduleRedraw(hwnd);
  // Yeni Gezgin kendi hatırladığı boyutta açılıp büyük alana yerleşince DirectUI yeni alanı hemen çizmiyor (beyazlık).
  // Saydamken yeniden düzen yaptır (nudge), ilk tam çizim bitince göster.
  if (concealed.has(hwnd)) {
    setTimeout(() => { if (w.isWindow(hwnd)) nudge(hwnd, rect); }, 40);
    setTimeout(() => reveal(hwnd), 130);
  }
}

// Gizli (aktif olmayan) sekmeyi göstermeden yeni boyuta al: etkinleştirilince büyüme/çizim gecikmesi (beyazlık) olmasın
function presize(hwnd, r) {
  const clip = r.clipTop || 0;
  const f = C.SWP_NOZORDER | C.SWP_NOACTIVATE | C.SWP_ASYNCWINDOWPOS;
  w.setPos(hwnd, 0, r.x, r.y - clip, r.width, r.height + clip, f);
  if (clip > 0) w.setRegion(hwnd, 0, clip, r.width, r.height + clip, false);
}

// Gezgin'i host'un içerik alanına oturt ve göster (rect: ekran koordinatları, fiziksel piksel)
// frame=true: çerçeve yeniden hesaplanır (sadece gömme/bırakmada). Rutin yerleştirmede async:
// Gezgin'in arayüz iş parçacığı meşgulse ana süreç donmasın, pahalı çerçeve hesabı da tekrarlanmasın.
// r.clipTop: Gezgin'in boş kalan başlık satırının yüksekliği. Pencereyi bu kadar yukarı alıp
// üst kısmını bölgeyle kırparız; hem boş şerit hem de orada oluşan çizim artıkları görünmez.
function place(hwnd, r, frame = false) {
  const clip = r.clipTop || 0;
  const flags = C.SWP_NOACTIVATE | C.SWP_SHOWWINDOW | (frame ? C.SWP_FRAMECHANGED : C.SWP_ASYNCWINDOWPOS);
  w.setPos(hwnd, C.HWND_TOP, r.x, r.y - clip, r.width, r.height + clip, flags);
  if (clip > 0) w.setRegion(hwnd, 0, clip, r.width, r.height + clip, frame);
}

// Gömme sonrası Gezgin ilk çizimlerini tamamlayamıyor (beyazlık / kopya görüntü): kısa süre sonra zorla yeniden çizdir
function scheduleRedraw(hwnd) {
  for (const ms of [80, 400]) {
    setTimeout(() => { if (w.isWindow(hwnd)) w.redraw(hwnd); }, ms);
  }
}

// Yeni açılan Gezgin'i, ekranda ilk kare görünmeden tamamen saydam yap (alfa=0). Gömülünce reveal() ile gösterilir.
function conceal(hwnd) {
  if (concealed.has(hwnd) || !w.isWindow(hwnd)) return;
  const ex = w.getExStyle(hwnd);
  concealed.set(hwnd, ex);
  w.setExStyle(hwnd, (ex | C.WS_EX_LAYERED) >>> 0);
  w.setAlpha(hwnd, 0);
}

function reveal(hwnd) {
  if (!concealed.has(hwnd)) return;
  concealed.delete(hwnd);
  if (!w.isWindow(hwnd)) return;
  w.setAlpha(hwnd, 255);
  w.setExStyle(hwnd, (w.getExStyle(hwnd) & ~C.WS_EX_LAYERED) >>> 0);
  w.redraw(hwnd);
}

function revealAll() { for (const h of [...concealed.keys()]) reveal(h); }

// Gezgin'in doğrudan alt pencerelerinin yerleşimi (ribbon sabitleme/açma gibi iç düzen değişimini yakalamak için)
function layoutSignature(hwnd) {
  const top = w.getRect(hwnd);
  return w.childrenInfo(hwnd)
    .filter((c) => c.vis)
    .map((c) => `${c.cls}|${c.l - top.left},${c.t - top.top},${c.r - c.l},${c.b - c.t}`)
    .join(';');
}

// Gezgin'in açık konumu: adres çubuğu (ToolbarWindow32) metninden okunur.
// cache: sekme başına { addr, nextTry } (adres çubuğu HWND'sini tekrar aramamak için)
function readLocation(hwnd, cache) {
  let loc = null;
  if (cache.addr && w.isWindow(cache.addr)) loc = parseAddress(w.getTitle(cache.addr));
  if (loc) return loc;

  cache.addr = 0;
  const bars = w.findDescendants(hwnd, 'ToolbarWindow32');
  for (const tb of bars) {
    loc = parseAddress(w.getTitle(tb));
    if (loc) { cache.addr = tb; return loc; }
  }
  if (DEBUG) {
    console.log('[NooXTabs] adres çubuğu bulunamadı. ToolbarWindow32 metinleri:',
      bars.map((tb) => JSON.stringify(w.getTitle(tb))).join(' | ') || '(yok)');
  }
  return null;
}

function describeChildren(hwnd) {
  const top = w.getRect(hwnd);
  return w.childrenInfo(hwnd)
    .map((c) => `  ${c.vis ? '+' : '-'} ${c.cls} x=${c.l - top.left} y=${c.t - top.top} w=${c.r - c.l} h=${c.b - c.t}`)
    .join('\n');
}

// Gezgin iç düzeni değişince (ör. ribbon sabitlendi) çerçeveyi/yerleşimi yeniden hesaplattır:
// boyutu 1 px oynatıp geri al + bölgeyi yenile + yeniden çiz
function nudge(hwnd, r) {
  const clip = r.clipTop || 0;
  const f = C.SWP_NOZORDER | C.SWP_NOACTIVATE;
  w.setPos(hwnd, 0, r.x, r.y - clip, r.width + 1, r.height + clip, f);
  w.setPos(hwnd, 0, r.x, r.y - clip, r.width, r.height + clip, f);
  if (clip > 0) w.setRegion(hwnd, 0, clip, r.width, r.height + clip, true);
  w.redraw(hwnd);
}

function hide(hwnd) { w.show(hwnd, C.SW_HIDE); }
function focus(hwnd) { w.foreground(hwnd); }
function requestClose(hwnd) { w.postMessage(hwnd, C.WM_CLOSE); }

// Pencereyi tekrar bağımsız, normal bir Gezgin penceresi yap (uygulama kapanırken kullanılır)
function release(hwnd, r) {
  const s = saved.get(hwnd);
  w.show(hwnd, C.SW_HIDE);
  w.setOwner(hwnd, 0);
  w.clearRegion(hwnd);
  if (s) {
    w.setStyle(hwnd, s.style);
    w.setExStyle(hwnd, s.ex);
    saved.delete(hwnd);
  }
  w.setPos(hwnd, C.HWND_TOP, r.x, r.y, r.width, r.height, C.SWP_FRAMECHANGED | C.SWP_SHOWWINDOW);
  // Stil değişince Gezgin içeriğini çizmeyebiliyor: boyutu 1 px oynatıp geri al + yeniden çiz
  const f = C.SWP_NOZORDER | C.SWP_NOACTIVATE;
  w.setPos(hwnd, 0, r.x, r.y, r.width + 1, r.height, f);
  w.setPos(hwnd, 0, r.x, r.y, r.width, r.height, f);
  w.redraw(hwnd);
}

module.exports = {
  listWindows, launch, embed, place, presize, hide, focus, requestClose, release,
  readLocation, conceal, reveal, revealAll, layoutSignature, describeChildren, nudge, DEBUG,
  getTitle: w.getTitle,
  isAlive: w.isWindow,
  isVisible: w.isVisible,
};
