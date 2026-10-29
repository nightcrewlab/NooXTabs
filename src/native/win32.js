'use strict';
// user32.dll çağrıları (koffi ile). Tüm HWND değerleri JS Number olarak taşınır.
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

koffi.proto('int EnumWindowsProc(intptr hwnd, intptr lParam)');

const _EnumWindows = user32.func('int EnumWindows(EnumWindowsProc *cb, intptr lParam)');
const _GetClassNameW = user32.func('int GetClassNameW(intptr hwnd, void *buf, int max)');
const _GetWindowTextW = user32.func('int GetWindowTextW(intptr hwnd, void *buf, int max)');
const _FindWindowExW = user32.func('intptr FindWindowExW(intptr parent, intptr after, str16 cls, str16 title)');
const _IsWindow = user32.func('int IsWindow(intptr hwnd)');
const _IsWindowVisible = user32.func('int IsWindowVisible(intptr hwnd)');
const _GetWindowLongW = user32.func('int32 GetWindowLongW(intptr hwnd, int idx)');
const _SetWindowLongW = user32.func('int32 SetWindowLongW(intptr hwnd, int idx, int32 val)');
const _SetParent = user32.func('intptr SetParent(intptr child, intptr parent)');
const _SetWindowPos = user32.func('int SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)');
const _ShowWindow = user32.func('int ShowWindow(intptr hwnd, int cmd)');
const _PostMessageW = user32.func('int PostMessageW(intptr hwnd, uint32 msg, uintptr wp, intptr lp)');
const _SetFocus = user32.func('intptr SetFocus(intptr hwnd)');
const _SetWindowLongPtrW = user32.func('intptr SetWindowLongPtrW(intptr hwnd, int idx, intptr val)');
const _RedrawWindow = user32.func('int RedrawWindow(intptr hwnd, void *rect, intptr rgn, uint32 flags)');
const _CreateRectRgn = gdi32.func('intptr CreateRectRgn(int l, int t, int r, int b)');
const _SetWindowRgn = user32.func('int SetWindowRgn(intptr hwnd, intptr rgn, int redraw)');
const _GetForegroundWindow = user32.func('intptr GetForegroundWindow()');
const _SetLayeredWindowAttributes = user32.func('int SetLayeredWindowAttributes(intptr hwnd, uint32 key, uint8 alpha, uint32 flags)');
koffi.proto('void WinEventProc(intptr hook, uint32 event, intptr hwnd, int32 idObject, int32 idChild, uint32 thread, uint32 time)');
const _SetWinEventHook = user32.func('intptr SetWinEventHook(uint32 evMin, uint32 evMax, intptr hmod, WinEventProc *cb, uint32 pid, uint32 tid, uint32 flags)');
const _UnhookWinEvent = user32.func('int UnhookWinEvent(intptr hook)');
koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const _GetWindowRect = user32.func('int GetWindowRect(intptr hwnd, _Out_ RECT *rect)');
const _GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vk)');
const _SetForegroundWindow = user32.func('int SetForegroundWindow(intptr hwnd)');

const C = {
  GWL_STYLE: -16,
  GWL_EXSTYLE: -20,
  GWLP_HWNDPARENT: -8,
  WS_POPUP: 0x80000000,
  WS_CHILD: 0x40000000,
  WS_VISIBLE: 0x10000000,
  WS_CLIPSIBLINGS: 0x04000000,
  WS_CAPTION: 0x00C00000,
  WS_SYSMENU: 0x00080000,
  WS_THICKFRAME: 0x00040000,
  WS_MINIMIZEBOX: 0x00020000,
  WS_MAXIMIZEBOX: 0x00010000,
  WS_EX_WINDOWEDGE: 0x00000100,
  WS_EX_APPWINDOW: 0x00040000,
  WS_EX_TOOLWINDOW: 0x00000080,
  WS_EX_LAYERED: 0x00080000,
  SWP_NOZORDER: 0x0004,
  SWP_NOACTIVATE: 0x0010,
  SWP_FRAMECHANGED: 0x0020,
  SWP_SHOWWINDOW: 0x0040,
  SWP_ASYNCWINDOWPOS: 0x4000,
  SW_HIDE: 0,
  SW_SHOW: 5,
  SW_RESTORE: 9,
  WM_CLOSE: 0x0010,
  HWND_TOP: 0,
};

function enumWindows() {
  const out = [];
  const cb = koffi.register((h) => { out.push(Number(h)); return 1; }, 'EnumWindowsProc *');
  try { _EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return out;
}

// Sadece belirli sınıftaki üst düzey pencereleri listeler (EnumWindows'tan çok daha ucuz)
function findWindows(cls) {
  const out = [];
  let h = 0;
  for (let i = 0; i < 500; i++) {
    h = Number(_FindWindowExW(0, h, cls, null));
    if (!h) break;
    out.push(h);
  }
  return out;
}

function getRect(h) {
  const r = {};
  _GetWindowRect(h, r);
  return r;
}

// Doğrudan alt pencereler (sınıf, görünürlük, ekran dikdörtgeni)
function childrenInfo(parent) {
  const out = [];
  let h = 0;
  for (let i = 0; i < 64; i++) {
    h = Number(_FindWindowExW(parent, h, null, null));
    if (!h) break;
    const r = getRect(h);
    out.push({ h, cls: readWide(_GetClassNameW, h), vis: !!_IsWindowVisible(h), l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  return out;
}

// WinEvent kancası (OUTOFCONTEXT: geri çağrı bu iş parçacığında, mesaj döngüsünde çalışır).
// flags: 0x2 = kendi sürecimizin olaylarını atla. Kurulamazsa null döner.
function hookEvents(evMin, evMax, flags, onEvent) {
  const cb = koffi.register((_hook, ev, hwnd, idObject, idChild) => {
    if (idObject !== 0 || idChild !== 0) return; // sadece pencerelerin kendisi
    try { onEvent(ev, Number(hwnd)); } catch (e) { console.error('[NooXTabs] olay hatası:', e); }
  }, 'WinEventProc *');
  const h = Number(_SetWinEventHook(evMin, evMax, 0, cb, 0, 0, flags));
  if (!h) { koffi.unregister(cb); return null; }
  return { stop() { _UnhookWinEvent(h); koffi.unregister(cb); } };
}

// Tüm alt pencereler arasında (iç içe) verilen sınıftakileri bul
function findDescendants(root, cls, max = 600) {
  const out = [];
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < max) {
    const node = queue.shift();
    let h = 0;
    for (let i = 0; i < 128; i++) {
      h = Number(_FindWindowExW(node, h, null, null));
      if (!h) break;
      seen++;
      if (readWide(_GetClassNameW, h) === cls) out.push(h);
      queue.push(h);
    }
  }
  return out;
}

function readWide(fn, hwnd) {
  const buf = Buffer.alloc(1024);
  const n = fn(hwnd, buf, 512);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

module.exports = {
  C,
  enumWindows,
  findWindows,
  getClassName: (h) => readWide(_GetClassNameW, h),
  getTitle: (h) => readWide(_GetWindowTextW, h),
  isWindow: (h) => !!_IsWindow(h),
  isVisible: (h) => !!_IsWindowVisible(h),
  getStyle: (h) => _GetWindowLongW(h, C.GWL_STYLE) >>> 0,
  setStyle: (h, v) => _SetWindowLongW(h, C.GWL_STYLE, v | 0),
  getExStyle: (h) => _GetWindowLongW(h, C.GWL_EXSTYLE) >>> 0,
  setExStyle: (h, v) => _SetWindowLongW(h, C.GWL_EXSTYLE, v | 0),
  setParent: (h, p) => Number(_SetParent(h, p)),
  setPos: (h, after, x, y, w, hgt, flags) => !!_SetWindowPos(h, after, x, y, w, hgt, flags),
  show: (h, cmd) => !!_ShowWindow(h, cmd),
  postMessage: (h, msg, wp = 0, lp = 0) => !!_PostMessageW(h, msg, wp, lp),
  setFocus: (h) => Number(_SetFocus(h)),
  setOwner: (h, owner) => Number(_SetWindowLongPtrW(h, C.GWLP_HWNDPARENT, owner)),
  // Pencereyi (pencere koordinatlarında) dikdörtgen bölgeyle kırp; sistem bölgenin sahibi olur
  setRegion: (h, l, t, r, b, redraw) => !!_SetWindowRgn(h, _CreateRectRgn(l, t, r, b), redraw ? 1 : 0),
  clearRegion: (h) => !!_SetWindowRgn(h, 0, 1),
  redraw: (h) => !!_RedrawWindow(h, null, 0, 0x1 | 0x4 | 0x80 | 0x100 | 0x400), // INVALIDATE|ERASE|ALLCHILDREN|UPDATENOW|FRAME
  getRect,
  childrenInfo,
  findDescendants,
  hookEvents,
  foregroundWindow: () => Number(_GetForegroundWindow()),
  setAlpha: (h, a) => !!_SetLayeredWindowAttributes(h, 0, a, 2), // LWA_ALPHA
  isLeftDown: () => (_GetAsyncKeyState(0x01) & 0x8000) !== 0,
  foreground: (h) => !!_SetForegroundWindow(h),
};
