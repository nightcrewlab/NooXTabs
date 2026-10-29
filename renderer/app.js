'use strict';
const api = window.tabsApi;
const tabsEl = document.getElementById('tabs');

const BAR_H = 40;          // sekme çubuğu yüksekliği (px)
const DETACH_DY = 50;      // çubuğun bu kadar altına/üstüne çekilirse ayrılır
const DRAG_THRESHOLD = 5;  // sürükleme başlangıç eşiği (px)
const POLL_MS = 30;        // imleç/tuş durumu yedek yoklaması
const STALE_MS = 80;       // bu kadar süre olay gelmezse yoklamadaki konumu kullan

let current = { tabs: [], activeId: null };
let dragging = false;

const tabEls = new Map(); // id -> sekme öğesi (her durum güncellemesinde yeniden oluşturulmaz: titreme / simge yanıp sönmesi olmaz)

function createTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = String(id);
  el.addEventListener('pointerdown', (e) => onPointerDown(e, el, id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) api.close(id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); api.tabMenu(id); });

  const ico = document.createElement('img');
  ico.className = 'ico';
  ico.alt = '';
  ico.draggable = false;
  ico.hidden = true;

  const title = document.createElement('span');

  const x = document.createElement('button');
  x.className = 'close';
  x.textContent = '✕';
  x.title = 'Sekmeyi kapat';
  x.addEventListener('click', (e) => { e.stopPropagation(); api.close(id); });

  el.append(ico, title, x);
  return el;
}

function render(state) {
  current = state;
  if (dragging) return; // sürüklerken yeniden çizme; bırakınca ana süreç yeni durumu gönderir

  const alive = new Set(state.tabs.map((t) => t.id));
  for (const [id, el] of tabEls) if (!alive.has(id)) { el.remove(); tabEls.delete(id); }

  let prev = null;
  for (const t of state.tabs) {
    let el = tabEls.get(t.id);
    if (!el) { el = createTab(t.id); tabEls.set(t.id, el); }

    el.classList.toggle('active', t.id === state.activeId);
    const tip = t.path || t.title; // ipucu: tam yol
    if (el.title !== tip) el.title = tip;
    const [ico, title] = el.children;
    if (title.textContent !== t.title) title.textContent = t.title;
    const src = t.icon || '';
    if (ico.dataset.src !== src) {
      ico.dataset.src = src;
      if (src) ico.src = src; else ico.removeAttribute('src');
      ico.hidden = !src;
    }

    // Sırayı sadece gerekiyorsa düzelt (DOM'u gereksiz yere oynatma)
    const want = prev ? prev.nextElementSibling : tabsEl.firstElementChild;
    if (want !== el) tabsEl.insertBefore(el, want);
    prev = el;
  }
}

function canDetach(cx, cy) {
  return cy > BAR_H + DETACH_DY || cy < -DETACH_DY || cx < -60 || cx > window.innerWidth + 60;
}

function onPointerDown(e, el, id) {
  if (e.button !== 0 || e.target.closest('.close')) return;
  try { el.setPointerCapture(e.pointerId); } catch { /* yoksay */ }

  const startX = e.clientX;
  const startY = e.clientY;
  const grab = e.clientX - el.getBoundingClientRect().left;
  let moved = false;
  let finished = false;
  let lastEvt = performance.now();
  let last = { cx: e.clientX, cy: e.clientY, sx: e.screenX, sy: e.screenY };
  let polling = false;
  let ghostOn = false;

  // Sekmeyi (cx, cy) istemci konumuna göre sürükle
  const apply = (cx, cy) => {
    if (!moved) {
      if (Math.hypot(cx - startX, cy - startY) < DRAG_THRESHOLD) return;
      moved = true;
      dragging = true;
      el.classList.add('dragging');
      api.ghostWarm(); // hayalet pencere dışarı çıkmadan hazır olsun
    }
    const tr = tabsEl.getBoundingClientRect();
    const rawLeft = cx - grab - tr.left;
    // Sıra, sınırlanmamış (ham) konuma göre belirlenir: sınırlarsak geniş bir sekme, kendinden dar olan
    // baştaki/sondaki sekmeyi hiçbir zaman geçemez. Sınırlama sadece görsel konum için.
    const center = rawLeft + el.offsetWidth / 2;
    const left = Math.max(0, Math.min(rawLeft, Math.max(0, tabsEl.offsetWidth - el.offsetWidth)));
    const others = [...tabsEl.children].filter((c) => c !== el);
    const before = others.find((c) => c.offsetLeft + c.offsetWidth / 2 > center) || null;
    if (before !== el.nextElementSibling) {
      tabsEl.insertBefore(el, before);
      // DOM'da yer değiştirmek işaretçi yakalamasını düşürür; geri al (düşse bile yoklama sürüklemeyi sürdürür)
      try { el.setPointerCapture(e.pointerId); } catch { /* yoksay */ }
    }

    el.style.transform = `translateX(${left - el.offsetLeft}px)`;
    const out = canDetach(cx, cy);
    if (out !== ghostOn) {
      ghostOn = out;
      el.classList.toggle('detaching', out);
      if (out) api.ghostShow(el.querySelector('span').textContent);
      else api.ghostHide();
    }
  };

  const move = (ev) => {
    lastEvt = performance.now();
    last = { cx: ev.clientX, cy: ev.clientY, sx: ev.screenX, sy: ev.screenY };
    apply(last.cx, last.cy);
  };

  const end = (cancelled) => {
    if (finished) return;
    finished = true;
    clearInterval(poller);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    try { el.releasePointerCapture(e.pointerId); } catch { /* yoksay */ }

    if (!moved) { if (!cancelled) api.activate(id); return; }

    dragging = false;
    el.classList.remove('dragging', 'detaching');
    el.style.transform = '';

    if (!cancelled && canDetach(last.cx, last.cy)) {
      api.detach(id); // ana süreç: başka pencereye birleştir / yeni pencere aç (hayaleti de kapatır)
    } else {
      if (ghostOn) api.ghostHide();
      const ids = [...tabsEl.children].map((c) => Number(c.dataset.id));
      api.reorder(ids).then(() => api.activate(id));
    }
  };
  const up = () => end(false);
  const cancel = () => end(true);

  // Yedek: fare olayları Gezgin penceresi üzerinde kesilirse imleç/tuş durumunu ana süreçten oku
  const poller = setInterval(async () => {
    if (finished || polling) return;
    polling = true;
    try {
      const c = await api.cursor();
      if (finished) return;
      last = { cx: c.cx, cy: c.cy, sx: c.sx, sy: c.sy };
      if (!c.down) { end(false); return; }
      if (performance.now() - lastEvt > STALE_MS) apply(c.cx, c.cy);
    } catch { /* yoksay */ } finally { polling = false; }
  }, POLL_MS);

  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
}

document.getElementById('add').addEventListener('click', () => api.newTab());
api.onState(render);
api.getState().then(render);

// ---- Dışarıdan (ör. Gezgin'den) klasör/dosya sürükleyip çubuğa bırakma: yeni sekmede aç ----
const bar = document.getElementById('bar');
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

// Ana süreç, dışarıdan bir sürükleme çubuğun üstüne gelince çubuğu "bırakılabilir" (no-drag) yapar
api.onDndArm((on) => document.body.classList.toggle('dnd', on));

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  bar.classList.add('drop');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy'; // kaynağı taşıma/silme: sadece yolu alıyoruz
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) bar.classList.remove('drop');
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  bar.classList.remove('drop');
  document.body.classList.remove('dnd');
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  if (paths.length) api.openPaths(paths);
});
