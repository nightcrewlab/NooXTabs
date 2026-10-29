'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// externalMode: 'new-window' (yeni NooXTabs penceresi) | 'last-window' (son pencereye sekme) | 'off' (yakalama)
const defaults = { externalMode: 'new-window', startWithWindows: false, restoreSession: true, groupWithExplorer: true };
let data = null;
let file = null;

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...defaults, ...parsed };
    if (parsed.externalMode === undefined && parsed.autoCapture === false) data.externalMode = 'off'; // eski ayardan taşı
  } catch { data = { ...defaults }; }
}

function get(key) { if (!data) load(); return data[key]; }

function set(key, value) {
  if (!data) load();
  data[key] = value;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) { console.error('[NooXTabs] ayarlar kaydedilemedi:', e.message); }
}

module.exports = { get, set };
