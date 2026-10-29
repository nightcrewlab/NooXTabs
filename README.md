# NooXTabs

Windows 10 için **Windows 11 tarzı sekmeli Dosya Gezgini**. Gerçek `explorer.exe` pencerelerini tek bir modern pencerenin içine sekme olarak gömer. Koyu tema öncelikli, açık tema uyumlu.

> Not: Proje adı çalışma adıdır, istediğin zaman değiştirilebilir.

---

## Amaç

- Windows 10'da Dosya Gezgini'ne tarayıcı gibi sekme eklemek
- Kendi dosya yöneticisi yazmak yerine **gerçek Gezgin'i** kullanmak (sağ tık menüsü, kabuk uzantıları, kopyalama diyalogları, arama hepsi hazır gelir)
- Sekme çubuğunu ve pencere çerçevesini modern, Windows 11 hissinde çizmek

## Özellikler (hedef)

- [x] Özel başlık çubuğu (frameless) içinde sekme çubuğu
- [x] Yeni sekme (`Ctrl+T`), sekme kapat (`Ctrl+W`), sekmeler arası geçiş (`Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1..9`); Gezgin odaktayken de çalışır
- [x] Orta tıkla sekme kapatma
- [x] Sekme başlığı ve klasör simgesi açık klasörü takip eder
- [x] Sekme sağ tık menüsü (çoğalt, yeni pencerede aç, yolu kopyala, kapat, diğerlerini / sağdakileri kapat)
- [x] Sürükle-bırak ile sekme sıralama
- [x] Sekmeyi pencere dışına sürükleyip yeni NooXTabs penceresi olarak ayırma (hayalet sekme imleci takip eder)
- [x] Sekmeyi başka NooXTabs penceresinin çubuğuna bırakıp birleştirme
- [x] Dışarıdan açılan Gezgin pencerelerini (Win+E, klasör açma) otomatik sekmeye yakalama
- [ ] Koyu / açık tema, varsayılan koyu, sistem temasını takip seçeneği
- [ ] Son kapatılan sekmeyi geri açma (`Ctrl+Shift+T`)
- [ ] Oturum geri yükleme (kapanırken açık sekmeleri hatırla)
- [x] Sistem tepsisi ve Windows ile başlatma seçeneği
- [x] Sekme üzerinde tam yol ipucu
- [x] Kapatılan sekmeyi geri açma (`Ctrl+Shift+T`)
- [x] Görev çubuğunda Gezgin simgesi altında gruplama (aynı AppUserModelID, Gezgin simgesi, pencere başlığı = aktif klasör)
- [x] Pencere boyutunu hatırlama (yeni pencereler son boyutla açılır)
- [x] Oturum geri yükleme (pencereler, konumlar ve sekmeler)
- [x] Gezgin'den klasör sürükleyip sekme çubuğuna bırakınca yeni sekmede açma
- [x] Dışarıdan açılan klasörler için seçenek: yeni pencere / son pencereye sekme / yakalama

## Nasıl Çalışır?

NooXTabs ayrı bir uygulamadır. Kendi penceresini çizer, her sekme bu pencerenin içine oturan gerçek bir Gezgin penceresidir.

1. **Yeni Gezgin**: `explorer.exe /n,/e,"<yol>"` ile başlatılır. Pencereyi bulmayı `watcher.js` yapar (`FindWindowExW` ile `CabinetWClass` taraması).
2. **Gömme**: Windows 10'da `SetParent` ile child yapılan Gezgin doğru çizilmediği için kullanılmaz. Bunun yerine Gezgin çerçevesiz bir üst düzey pencere olarak kalır ve host pencerenin **owned** penceresi yapılır (owner ilişkisi). Böylece her zaman host'un üstünde durur, host kapanınca onunla yok olur, görev çubuğunda ayrı düğme çıkmaz.
3. **Yerleştirme**: Host'un içerik alanının ekran koordinatları hesaplanır, taşıma/boyutlandırma olaylarında Gezgin aynı alana oturtulur.
4. **Sekme geçişi**: Aktif olmayan sekmeler `ShowWindow(SW_HIDE)` ile gizlenir.
5. **Yol takibi**: Sekme başlığı Gezgin penceresinin başlığından, açık klasörün tam yolu ise adres çubuğunun (`ToolbarWindow32`) pencere metninden okunur (`address.js`). Masaüstü, İndirilenler, Bu bilgisayar gibi adla görünen konumlar `shell:` hedefine çevrilir. Yol sekme ipucunda görünür, oturum kaydı ve "kapatılan sekmeyi geri aç" bundan beslenir.
6. **Otomatik yakalama**: Arka planda tepside çalışır. Yeni Gezgin penceresi, oluşturulduğu anda (WinEvent kancası) tamamen saydam yapılır, böylece ilk kare görünmez; gömüldükten sonra gösterilir. NooXTabs içinden açılanlar (Win+E, "yeni pencerede aç") o pencereye sekme olur. Dışarıdan açılanlar (masaüstü vb.) tepsi menüsündeki ayara göre yeni NooXTabs penceresinde, son pencerede sekme olarak ya da normal Gezgin olarak açılır.
7. **Sürükleme**: Sekme çubuğunda sırala. Çubuğun dışına çekince imleci hayalet sekme takip eder. Başka NooXTabs penceresinin çubuğuna bırakırsan birleşir, boşluğa bırakırsan yeni pencere olur (tek sekmeli pencerede pencere taşınır).
8. **Kapatma**: Pencereyi kapatmak sekmeleri (Gezgin pencerelerini) kapatır. Tepsiden **Çıkış** ise Gezgin pencerelerini kapatmadan normal pencereye geri verir.

## Teknoloji

| Katman | Seçim |
|---|---|
| Uygulama kabuğu | Electron (frameless pencere) |
| Arayüz | HTML + CSS + JS (CSS değişkenli tema sistemi) |
| Win32 erişimi | `koffi` (FFI) ile `user32.dll` çağrıları |
| Klasör/yol takibi | `Shell.Application` COM (PowerShell köprüsü ya da yardımcı süreç) |
| Paketleme | `electron-builder` |

Yedek plan: Electron ile gömme güvenilir çıkmazsa host kısmı **C# WPF** (`HwndHost`) ile yazılır. Bu yüzden ilk adım bir fizibilite denemesidir (aşağıya bak).

## Tema

- CSS değişkenleri `:root` altında, `data-theme="dark" | "light"` ile değişir
- Varsayılan: **koyu**
- Seçenekler: Koyu, Açık, Sistemi takip et (`nativeTheme.shouldUseDarkColors`)
- Windows 10'da Mica yok; arka plan düz renk ya da hafif `acrylic` ile yapılır
- Başlık çubuğu butonları (küçült, büyüt, kapat) özel çizilir, Windows 11 stilinde

## Bilinen Riskler

- **Gömme yöntemi (owner + çerçevesiz pencere) resmi bir "gömme" değil.** Gezgin gerçek bir child pencere olmadığı için pencere taşınırken bir kare geriden gelebilir.
- **Gömülü Gezgin'in içi sistem temasını kullanır.** Dosya listesi ve gezinti bölmesinin rengini uygulama değiştiremez. Windows 10'da sistem koyu modu açıksa Gezgin büyük oranda koyu görünür. Bizim kontrol ettiğimiz yer sekme çubuğu, başlık ve çerçevedir.
- **Odak yönetimi**: Gömülü pencereye tıklayınca odak onun içinde kalır, `Ctrl+T` gibi kısayollar için global klavye kancası (hook) gerekebilir.
- **Explorer çökmesi**: `explorer.exe` yeniden başlarsa gömülü pencereler gider. Algılayıp sekmeleri geri açmak gerekir.
- **Yüksek DPI ve çoklu monitör**: Boyut hesapları DPI'a duyarlı yapılmalı.
- Antivirüsler `SetParent`/pencere kancası davranışına bazen şüpheyle bakabilir.

## Geliştirme Planı

Dosya dosya ilerleyeceğiz.

1. **Fizibilite**: Tek bir Electron penceresi içine tek bir Gezgin penceresini gömmek, boyutlandırmak, kapatmak
2. **Çoklu sekme**: Sekme çubuğu, ekleme, silme, geçiş, gizleme/gösterme
3. **Yol takibi**: Sekme başlığı ve ikonu
4. **Tema ve özel başlık çubuğu**: Koyu/açık, pencere butonları
5. **Kısayollar ve odak**: Global kısayollar, odak sorunlarının çözümü
6. **Sürükle-bırak**: Sıralama, sekme ayırma, dışarıdan pencere yakalama
7. **Oturum ve ayarlar**: Geri yükleme, tepsi, başlangıçta çalıştır
8. **Paketleme**: Kurulum dosyası

## Dosya Yapısı

```
NooXTabs/
├─ package.json
├─ main.js                  # Başlangıç, tek örnek kilidi
├─ preload.js               # Güvenli köprü (IPC)
├─ assets/icon.png          # Uygulama ve tepsi ikonu
├─ src/
│  ├─ windowManager.js      # Tüm pencereler, yakalama, sekme bırakma (birleştir/ayır)
│  ├─ hostWindow.js         # Tek NooXTabs penceresi
│  ├─ watcher.js            # Yeni Gezgin pencerelerini izler
│  ├─ ghost.js              # Sürüklerken imleci takip eden hayalet sekme
│  ├─ tray.js               # Tepsi menüsü
│  ├─ ipc.js                # Renderer <-> ana süreç
│  ├─ settings.js           # Ayarlar (dışarıdan açılanlar, oturumu hatırla, Windows ile başlat)
│  ├─ session.js            # Oturum kaydı (session.json)
│  ├─ native/
│  │  ├─ win32.js           # koffi ile user32 çağrıları
│  │  ├─ address.js         # Adres çubuğu metnini ayrıştırma (konum okuma)
│  │  └─ explorer.js        # Gezgin başlatma, gömme, yerleştirme, bırakma
│  └─ tabs/
│     └─ tabManager.js      # Pencere başına sekme durumu
├─ renderer/
│  ├─ index.html, app.js    # Sekme çubuğu arayüzü
│  ├─ ghost.html            # Hayalet sekme
│  └─ styles/               # base.css, ghost.css
└─ README.md
```

## Kısayollar

Sadece NooXTabs penceresi (ya da içindeki Gezgin) ön plandayken etkindir, başka uygulamalara karışmaz.

| Kısayol | İşlev |
|---|---|
| `Ctrl+T` | Yeni sekme |
| `Ctrl+W` | Sekmeyi kapat |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Sonraki / önceki sekme |
| `Ctrl+1..8` | N. sekmeye git |
| `Ctrl+9` | Son sekmeye git |
| `Ctrl+Shift+T` | Kapatılan sekmeyi geri aç |

## Kurulum (geliştirme)

```bash
git clone <depo-adresi>
cd NooXTabs
npm install
npm start
```

Hata ayıklama çıktısı için (PowerShell):

```powershell
$env:NOOX_DEBUG=1; npm start
```

## Paketleme

```bash
npm run pack   # paketlenmiş klasör (dist/win-unpacked), hızlı deneme için
npm run dist   # kurulum dosyası (dist/NooXTabs Setup <sürüm>.exe)
```

- Windows'ta çalıştırılmalıdır. Kurulum dosyası NSIS ile hazırlanır (kurulum klasörü seçilebilir, masaüstü ve başlat menüsü kısayolu oluşturur).
- **Windows ile başlat** tepsi menüsünden açılır. `--hidden` ile başlar, yani pencere açmaz, tepside bekler. Kaldırılırken bu kayıt da silinir.

## Gereksinimler

- Windows 10 (64 bit)
- Node.js 20 veya üzeri
- Visual Studio Build Tools gerekmez (`koffi` hazır derlenmiş gelir)

## Lisans

Henüz belirlenmedi. Açık kaynak olarak yayınlanacaksa MIT önerilir.
