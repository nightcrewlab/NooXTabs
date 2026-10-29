'use strict';
// Oturum (açık pencereler + sekmeler) kaydı: userData/session.json
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let file = null;
const filePath = () => (file ||= path.join(app.getPath('userData'), 'session.json'));

function load() {
  try { return JSON.parse(fs.readFileSync(filePath(), 'utf8')); } catch { return null; }
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    const tmp = filePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath()); // yarım yazılmış dosya kalmasın
  } catch (e) { console.error('[NooXTabs] oturum kaydedilemedi:', e.message); }
}

// Kullanıcı son pencereyi kendi kapattı: açılışta otomatik geri yüklenmesin (tepsiden elle yüklenebilir)
function markClosedByUser() {
  const s = load();
  if (s && s.windows && s.windows.length) { s.closedByUser = true; save(s); }
}

module.exports = { load, save, markClosedByUser };
