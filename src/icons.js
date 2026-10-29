'use strict';
// Sekme simgesi: açık klasörün gerçek Windows simgesi (app.getFileIcon), veri URL'si olarak önbelleğe alınır.
const { app } = require('electron');

const cache = new Map();
const MAX = 300;

// Yolu olmayan özel konumlar için bilinen klasör eşlemesi
const KNOWN = {
  'shell:Desktop': 'desktop', 'shell:Downloads': 'downloads', 'shell:Personal': 'documents',
  'shell:My Pictures': 'pictures', 'shell:My Music': 'music', 'shell:My Video': 'videos',
};

function pathFor(loc) {
  if (loc.path) return loc.path;
  const key = KNOWN[loc.target];
  if (key) { try { return app.getPath(key); } catch { /* genel simgeye düş */ } }
  return app.getPath('temp'); // genel sarı klasör simgesi
}

async function getIcon(loc) {
  if (!loc) return null;
  const p = pathFor(loc);
  if (cache.has(p)) return cache.get(p);
  try {
    const img = await app.getFileIcon(p, { size: 'normal' });
    const url = img.isEmpty() ? null : img.toDataURL();
    cache.set(p, url);
    if (cache.size > MAX) cache.delete(cache.keys().next().value);
    return url;
  } catch {
    return null;
  }
}

module.exports = { getIcon };
