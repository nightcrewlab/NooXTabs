'use strict';
// Gezgin adres çubuğunun (breadcrumb ToolbarWindow32) pencere metnini ayrıştırır.
// Metin "Adres: C:\Users\PC" biçimindedir (önek dile göre değişir). Saf JS: FFI yok, test edilebilir.

const ADDRESS_WORDS = [
  'address', 'adres', 'adresse', 'dirección', 'direccion', 'indirizzo', 'endereço', 'endereco',
  'адрес', 'アドレス', '地址', '주소',
];

// Adres çubuğunda yol yerine görünen ad ile gösterilen özel konumlar -> explorer.exe'nin açabileceği hedef
const SPECIAL = new Map([
  ['bu bilgisayar', 'shell:MyComputerFolder'], ['this pc', 'shell:MyComputerFolder'],
  ['my computer', 'shell:MyComputerFolder'], ['computer', 'shell:MyComputerFolder'],
  ['hızlı erişim', 'shell:::{679F85CB-0220-4080-B29B-5540CC05AAB6}'],
  ['quick access', 'shell:::{679F85CB-0220-4080-B29B-5540CC05AAB6}'],
  ['ağ', 'shell:NetworkPlacesFolder'], ['network', 'shell:NetworkPlacesFolder'],
  ['geri dönüşüm kutusu', 'shell:RecycleBinFolder'], ['recycle bin', 'shell:RecycleBinFolder'],
  ['denetim masası', 'shell:ControlPanelFolder'], ['control panel', 'shell:ControlPanelFolder'],
  ['masaüstü', 'shell:Desktop'], ['desktop', 'shell:Desktop'],
  ['indirilenler', 'shell:Downloads'], ['downloads', 'shell:Downloads'],
  ['belgeler', 'shell:Personal'], ['documents', 'shell:Personal'],
  ['resimler', 'shell:My Pictures'], ['pictures', 'shell:My Pictures'],
  ['müzikler', 'shell:My Music'], ['music', 'shell:My Music'],
  ['videolar', 'shell:My Video'], ['videos', 'shell:My Video'],
  ['3d nesneler', 'shell:3D Objects'], ['3d objects', 'shell:3D Objects'],
  ['kitaplıklar', 'shell:Libraries'], ['libraries', 'shell:Libraries'],
]);

// -> { display, path|null, target|null } ya da null (adres çubuğu metni değil)
function parseAddress(text) {
  const m = /^([^:]{1,30}):\s+(.+)$/.exec(String(text || '').trim());
  if (!m) return null;
  const prefix = m[1].trim().toLocaleLowerCase('tr');
  const rest = m[2].trim();

  if (/^[A-Za-z]:\\/.test(rest) || /^\\\\/.test(rest)) {
    return { display: rest, path: rest, target: rest };
  }
  for (const key of [rest.toLocaleLowerCase('tr'), rest.toLowerCase()]) {
    if (SPECIAL.has(key)) return { display: rest, path: null, target: SPECIAL.get(key) };
  }
  // Adres çubuğu ama bilinmeyen sanal konum: gösterilir, geri açılamaz
  if (ADDRESS_WORDS.includes(prefix)) return { display: rest, path: null, target: null };
  return null;
}

module.exports = { parseAddress };
