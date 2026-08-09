# AeroOS — Game Design Document: Derinlik & Retention Sistemleri (GDD v1)

Bu GDD, ekonomi redesign'ının (v2 + UI/performans patch'i) üzerine inşa edilen dört yeni
sistemi kapsar: **(A)** tüm uygulamaların Windows Vista/7 Aero tasarım diline tam uyumu,
**(B)** upgrade-kilitli mini-oyunlar, **(C)** Cookie Clicker'ın Grandmapocalypse'ine
karşılık gelen bir kriz-event sistemi ("Darknet Breach"), **(D)** achievement sistemi +
gerçek CrazyGames SDK entegrasyonu. Tüm kararlar **retention** (oyuncuyu sıkmadan tutmak,
geri getirmek) hedefine göre alındı ve **mobilde tam oynanabilirlik** zorunlu kabul edildi.

Önceki dosyalarla ilişki: `aeroos-economy-redesign-refactor-plan-v2.md` (building/upgrade/
prestij mimarisi) ve `aeroos-economy-redesign-v2-patch-ui-safety.md` (pencere kategorileri,
maliyet formülü, sinerji UI'ı) **değişmeden geçerli** — bu GDD onların üzerine ekleniyor,
çakışmıyor.

---

## A. Görsel Tasarım Sistemi — Windows Vista/7 Aero, Sıfır Modern Element

### A.1 Kural

**Hiçbir modern UI deseni kullanılmayacak.** Aşağıdaki liste, kod incelemesinde/tasarım
teslimatında otomatik red sebebi sayılmalı:

| Yasaklı (modern) | Yerine kullanılacak (Vista/7 doğru) |
| --- | --- |
| Flat design, gölgesiz düz renkler | Gradient dolgular, iç/dış emboss bevel (proje zaten `--emboss`/`--emboss-well` token'larına sahip — bunlar dışına çıkılmayacak) |
| Material Design gölgeleri (soft/blur drop shadow) | Sert, keskin kenarlı Aero gölgeleri + cam parlaklığı (glass highlight) |
| Hamburger menü | Klasik menü çubuğu (File/Edit/View/Help) veya Start-orb tarzı açılır menü |
| İnce/light sans-serif fontlar | Segoe UI / Tahoma, kalın hiyerarşi (Vista/7'nin fiili sistem fontu) |
| Neumorphism / soft-UI | Aero glass (`backdrop-filter: blur()` + gradient overlay, WebGL değil — mimari kural zaten CSS/SVG) |
| Pill-shaped modern butonlar | Aero'nun karakteristik dikdörtgen-yuvarlatılmış (hafif radius, ~3-4px) camsı butonları |
| iOS-tarzı toggle switch | Klasik checkbox/radio, üç durumlu (normal/hover/pressed) buton state'leri |
| Emoji (Unicode) | Klasik MSN emoticon seti (dönem-doğru .png/SVG ikonlar) |
| Sonsuz kaydırma / kart-tabanlı mobil liste | Pencere/panel metaforu korunur, mobilde bile (bkz. madde F) |
| Koyu tema varsayılan | Aero'nun varsayılanı **açık/camsı**; koyu ("Slate benzeri") bir seçenek olabilir ama bu bir **kozmetik unlock** olarak sunulmalı (`theme.js`'te zaten var olan tint sistemine ek bir seçenek, varsayılan değil) |

### A.2 Pencere kromu (window chrome) — tüm Full Window building'ler için ortak

- Başlık çubuğu: camsı gradient (üstte parlak highlight, altta koyulaşan degrade), pencere
  odaklıyken mavi parlama (glow), odak dışıyken soluk gri.
- Sağ üstte klasik üç düğme: minimize / maximize / close — Vista/7'nin karakteristik
  **dairesel** düğmeleri (kare değil), close düğmesi hover'da kırmızı parlama.
- Kenarlıklar: ince, camsı, hafif yansımalı — mevcut `.glass` sınıfı ve 7.css temel
  alınacak, yeni bir stil sistemi icat edilmeyecek.
- İkonlar: 32×32 piksel-sanat / skeuomorfik, bevel + drop-shadow (XP/Vista ikon dilinin
  karakteristik "gerçekçi obje" yaklaşımı — düz vektör ikon değil).

### A.3 Sistem tepsisi (system tray) — Tray-kategori building'ler için

UI/performans patch'indeki üç kategori (Full Window / Tray / değişmeyen AeroSweeper)
burada görsel karşılığını buluyor: **Tray building'leri (AdBar, IoT Botnet, Cloud
Mainframe) gerçekten Windows 7 sistem tepsisinde** (saat kutusunun solunda, "gizli
simgeler" oku ile açılan alan) yaşıyor. Bu hem tema açısından %100 doğru hem UI kalabalığı
sorununu (önceki mesajdaki kaygı) görsel olarak da çözüyor — tepsi ikonu tıklanınca küçük
bir popover açılıyor, tam pencere değil.

### A.4 Uygulama başına referans yazılım ve UI eşleştirmesi

Her app, gerçek 2000'ler yazılımının **UI diline** (renk paleti, pencere yerleşimi,
tipografik hiyerarşi) olabildiğince sadık kalacak — bu hem nostalji sadakati hem de
"örnek alınan app'lerin UI'larına çok yakın olmalı" isteğinin karşılığı:

| Building | Referans yazılım | Sadık kalınacak UI unsurları |
| --- | --- | --- |
| AeroChat | MSN Messenger 7.5/8 | Buddy list paneli, çevrimiçi/meşgul/uzakta durum ikonları, nudge titreşim animasyonu, klasik emoticon seti |
| RetroAmp | Winamp 2.x/5 klasik skin | Yeşil-gri LCD ekran, spektrum analizör çubukları, çift satır (track adı + zaman), minik equalizer penceresi |
| LemonWire | LimeWire 4/5 | Arama sonucu tablosu, bağlantı gücü çubukları (sinyal ikonu), Gnutella yeşil ağ simgesi |
| AdBar | Erken 2000'ler tarayıcı toolbar'ları | Pop-up pencere yığını görselleştirmesi, sahte "Ödül Kazandınız!" pop-up tasarımı (satirik, tıklanamaz — sadece dekor) |
| Shield99 | Norton AntiVirus 2004 / McAfee VirusScan | Sarı/altın kalkan ikonu, tarama ilerleme çubuğu, karantina kasası listesi |
| VidChat | Erken webcam messenger (MSN/Yahoo video call) | Picture-in-picture önizleme, **kasıtlı düşük FPS / piksel bloklu webcam görüntüsü** (CSS filter ile, gerçek video değil — hem dönem-doğru hem performanslı) |
| Registry Doctor | "PC Hızlandırıcı" tarzı 2000'ler scareware | Kırmızı/sarı/yeşil sağlık göstergesi, sahte teknik jargonlu "sorun listesi", büyük "Tümünü Onar" butonu |
| Aero Studio | Windows Movie Maker / erken Premiere | Zaman çizelgesi şeridi, storyboard küçük resimleri, render ilerleme çubuğu |
| AeroBurn | Nero Burning ROM | Disk tepsisi grafiği, dairesel yakma ilerleme göstergesi, track listesi |
| GeoPage | Microsoft FrontPage / Geocities editörü | WYSIWYG sayfa düzenleyici, retro **odometre tarzı** ziyaretçi sayacı widget'ı, "Yapım Aşamasında" GIF esintisi (statik/CSS ile) |
| IoT Botnet | Terminal/komut satırı estetiği | Yeşil-siyah terminal penceresi, ele geçirilen cihazların düğüm haritası (basit SVG node graph) |
| Cloud Mainframe | 1970-80 mainframe terminali (fosfor CRT yeşili) | **Kasıtlı olarak Vista/7'den bile eski** bir estetik — "modern" değil, "daha da retro" — tema tutarlılığını bozmadan oyunun en üst katmanını görsel olarak farklılaştırıyor |
| AeroSweeper | Klasik Minesweeper | Değişmiyor, zaten dönem-doğru |

---

## B. Mini-Oyun Sistemi — Upgrade-Kilitli Derinlik

### B.1 Tasarım prensibi

**Her building'e mini-oyun eklenmiyor** — bu hem geliştirme kapsamını şişirir hem de ana
idle döngüsünü sulandırır. 12 building'den **5 tanesi**, kendi temasıyla en güçlü örtüşen
ve erken/orta/geç oyuna yayılan bir seçkiyle mini-oyun alıyor. Her mini-oyun belirli bir
**upgrade kademesinde** (genelde tier 3/5-6) açılıyor — bu hem "sıradaki içerik" görünürlük
kancası olarak çalışıyor (mevcut ekonomi denetiminin eksik bulduğu hook'la aynı prensip)
hem de bir ödül anı yaratıyor.

**Ekonomik güvenlik kuralı:** hiçbir mini-oyun ödülü kalıcı/büyük bir üretim çarpanı
vermiyor — sadece **o building'e özel, süreli bir bonus** (v2 madde 4.5'teki "upgrade'ler
kendi building'ini çarpar" kuralıyla tutarlı). Mini-oyunlar ekonomiyi bozmadan angajmanı
artırıyor.

### B.2 Seçilen 5 mini-oyun

| Building | Mini-oyun | Açılma koşulu | Mekanik | Ödül |
| --- | --- | --- | --- | --- |
| **LemonWire** | *Bant Genişliği Çekişmesi* | Tier 3 upgrade | Gerçek zamanlı yükleme/indirme kaydırıcılarını dengelemek (dokunmatik: iki kaydırıcıyı sürükle) | Aktif seed süresi boyunca geçici hız artışı |
| **Shield99** | *Güvenlik Duvarı Savunması* | Tier 3 upgrade | Ekranda kayan tehdit ikonlarına dokunarak yakalamak (whack-a-mole benzeri, mevcut tehdit/karantina sistemini yeniden kullanır) | Bonus karantina ödülü + geçici building üretim artışı |
| **Registry Doctor** | *Fragmantasyon Bulmacası* | Tier 3 upgrade | Kayan-karo bulmaca — disk parçalarını sıraya sokmak (mevcut Bloat/Defrag temasıyla görsel olarak örtüşüyor) | Geçici bloat-azaltma bonusu |
| **VidChat** | *Gecikme Senkronu* | Tier 3 upgrade | Ritim/zamanlama oyunu — donan görüntü akışına dokunarak senkronize olmak | Geçici sosyal/AeroChat bonusu |
| **AeroBurn** | *Mükemmel Yakım* | Tier 3 upgrade | Klasik "yeşil bölgede durdur" zamanlama çubuğu | Bonus disk verimi / Overclock buff süresini uzatma |

AeroSweeper zaten oyunun amiral mini-oyunu (değişmiyor). Diğer 6 building (AeroChat,
RetroAmp, AdBar, Aero Studio, IoT Botnet, Cloud Mainframe, GeoPage) **kasıtlı olarak**
mini-oyunsuz kalıyor — bu app'ler zaten kendi upgrade/synergy derinliğine sahip, her
building'e oyun eklemek içerik yorgunluğu yaratır.

---

## C. Kriz Event Sistemi — "Darknet Breach"

### C.1 Referans ve tema seçimi

Cookie Clicker'daki Grandmapocalypse'in çekirdek deseni: **oran-tetiklemeli, kademeli
artan, aktif-katılımla yönetilebilen, isteğe bağlı olarak tamamen kapatılabilen bir risk
sistemi**. AeroOS'ta bunun en doğal temsili **hacking/darkweb teması** — LemonWire/AdBar/
IoT Botnet gibi "riskli" building'lerin zaten var olan güvenlik-açığı temasını
(audit'te doğrulanan LemonWire→Shield99 tehdit ilişkisi) büyütüyor.

### C.2 Tetikleme koşulu

```
riskRatio = (lemonwire.units + adbar.units + iotBotnet.units) / max(1, shield99.units)
```

`riskRatio` bir eşiği (taslak: 5) aştığında breach riski birikmeye başlıyor. Bu, Shield99'a
yatırım yapmayı **anlamlı bir karşı-denge** haline getiriyor — Grandmapocalypse'in
"Grandma'ları çok biriktirirsen bedeli olur" mantığının birebir karşılığı.

### C.3 Üç faz

1. **Faz 1 — "Şüpheli Trafik"** (kozmetik, cezasız): masaüstü duvar kağıdı hafifçe
   bozuluyor, taskbar saati arada titriyor, sahte pop-up pencereler beliriyor (kapatılması
   gerekiyor, sadece rahatsızlık — ön uyarı işlevi).
2. **Faz 2 — "Sızma Tespit Edildi"**: masaüstünde gezinen **"Sahtekar Süreç" (Rogue
   Process)** ikonları beliriyor (Wrinkler'ların karşılığı) — her biri hayattayken
   `buzzPerSecond`'dan küçük bir yüzde çalıyor. Oyuncu tıklayarak "Sonlandır" diyebiliyor,
   bu da anlık bir Buzz patlaması ödülü veriyor (Wrinkler patlatma mekaniğiyle aynı —
   aktif check-in'i ödüllendiriyor).
3. **Faz 3 — "Tam İhlal"** (nadir, riskRatio uzun süre yüksek kalırsa): tam ekran, dönem-
   doğru "Hacklendiniz" şakası estetiğinde (Matrix-yeşili akan metin, mevcut `bsod.js`
   altyapısı yeniden kullanılıyor) bir olay tetikleniyor. İkili seçim:
   - **"Fidyeyi Öde"**: anlık Buzz'ın bir kısmını kaybet (lifetime/prestij verisi güvende),
     breach hemen sona erer.
   - **"Karşı Koy" (mini-oyun)**: Shield99'un *Güvenlik Duvarı Savunması* motorunu
     yeniden kullanan kısa bir reaksiyon oyunu — başarı bonus Dollar/geçici küresel buff
     verir, başarısızlık fidyeden daha pahalıya mal olur.

### C.4 Çözüm ödülü ve kozmetik iz

Bir breach'i (özellikle Faz 3'ü "Karşı Koy" ile) atlatmak, mevcut `cosmetics.js`
deseniyle uyumlu bir **kozmetik unlock** veriyor (örn. özel "Kurtarılmış Sistem" duvar
kağıdı) — kalıcı bir "rozet" hissi, ekonomiye dokunmadan.

### C.5 Opt-out — "Gizli Mod" (Incognito Mode)

Grandmapocalypse'in Elder Pledge'i gibi, bu sistemin **tamamen isteğe bağlı** olması
gerekiyor — herkesi strese sokmamak iyi UX'in parçası. Dollar ile satın alınabilen bir
**"Gizli Mod"** utility'si: riskli building kümesinin (LemonWire/AdBar/IoT Botnet) üretimine
küçük bir kalıcı vergi (taslak: -%5) karşılığında breach riskini tamamen susturuyor. Sakin
oynamak isteyen oyuncular için bir çıkış kapısı, zorunlu bir mekanik değil.

---

## D. Achievement Sistemi + CrazyGames SDK Entegrasyonu (gerçek API'ye göre)

### D.1 Önce netleştirme — CrazyGames'te gerçekte ne var

CrazyGames SDK'da **native bir "achievement" API'si yok**. Var olan iki ilgili hook
(resmi dokümantasyondan doğrulandı):

- **`happytime()`** — "oyuncu başarımı" anlarında (boss yenme, highscore vb.) çağrılan,
  siteyi kutlama animasyonuyla (konfeti) tetikleyen bir fonksiyon. Dokümantasyon açıkça
  **"seyrek kullanın, özel bir an olarak kalmalı"** diyor.
- **`reportGameCompletedPercentage(value: 0-100)`** — oyuncunun oyunu tamamladığını veya
  bir ilerleme kilometre taşına ulaştığını CrazyGames'e bildiren fonksiyon; platform bunu
  tamamlama-sonrası deneyimi iyileştirmek (yeniden başlatma teklifi, güncelleme bildirimi
  vb.) için kullanıyor.
- **Leaderboard** (ayrı bir sistem, sadece **davet edilen oyunlar için**, oyun başına
  **tek** leaderboard) — `isIncremental: true` seçeneği sürekli büyüyen skorlar için
  var, bu da idle oyun türüne doğal olarak uyuyor.

**Bu üç hook'u uydurmadan, gerçek yeteneklerine göre kullanıyoruz** — kendi
achievement listemiz tamamen **birinci-parti** (kendi UI'ımızda, save'de saklanan), sadece
belirli anlarda CrazyGames'e sinyal gönderiyor.

### D.2 Achievement kategorileri (kendi sistemimiz)

| Kategori | Örnekler |
| --- | --- |
| **Kilometre taşı** | İlk bot, 25 bot (mevcut milestone), ilk Format C:, bir building'i tam upgrade etmek, ilk Legacy Level, ilk breach'i atlatmak |
| **Koleksiyoncu** | 12 building'in tümünü açmak, bir synergy çiftini tam doldurmak, tüm kozmetikleri toplamak |
| **Beceri** | AeroSweeper'ı mayına basmadan bitirmek, bir mini-oyunu mükemmel skorla tamamlamak, Faz 3 breach'i "Karşı Koy" ile atlatmak |
| **Geri dönüş / oturum (retention-odaklı)** | "Tekrar Hoş Geldin" (24+ saat sonra dönüş), "Hafta Sonu Savaşçısı" (3 gün üst üste oynama) — bunlar doğrudan CrazyGames Basic Launch'taki D1/D7 retention boşluğunu hedefliyor |

### D.3 SDK bağlama kuralları

- `happytime()` **yalnızca** küratörlü, "büyük" başarımlarda çağrılıyor (ilk Format C:,
  Cloud Mainframe'i açmak, Faz 3 breach'i atlatmak) — dokümantasyonun "seyrek kullanın"
  uyarısına birebir uyularak, her küçük achievement'ta değil.
- `reportGameCompletedPercentage()`, genel içerik-tamamlama oranına bağlı (örn. açılan
  building sayısı + tamamlanan achievement oranının harmanlanmış bir yüzdesi), sadece
  anlamlı kontrol noktalarında çağrılıyor (her tick değil) — bu, kullanıcının "game
  completion SDK" dediği gerçek karşılık.
- Leaderboard **koşullu bir öneri**: sadece CrazyGames'in "davet edilen oyun" listesine
  girilirse aktive edilebilir (dokümantasyon uyarısı). Aktive edilirse önerilen metrik:
  `legacyLevel` veya `prestigeCount`, `isIncremental: true` — haftalık sezon sıfırlaması
  idle türü için doğal bir "her hafta geri gel" kancası oluyor.
- Achievement listesinin kendisi **Start Menü → Başarımlar** penceresi olarak, Vista/7
  temalı bir ikon ızgarası şeklinde sunuluyor — kilitli achievement'lar gri/silik
  (mevcut görünürlük-gating prensibiyle tutarlı, madde A ve önceki patch'teki kural).

---

## E. State/Save etkileri (yeni)

Önceki migration zincirine (v3→v4→v5) ek olarak, bu GDD bir **v5→v6** adımı gerektiriyor:

```
state.achievements: { unlocked: { [id]: timestamp } }
state.event: {
  riskRatioHistory: [], // faz geçişlerini tetiklemek için kısa pencereli ortalama
  breachPhase: 0,       // 0 = yok, 1-3 = aktif faz
  rogueProcesses: [],
  incognitoModeOwned: false
}
state.minigames: {
  [buildingId]: { unlocked: boolean, bestScore: number, timesPlayed: number }
}
state.crazyGames: { lastReportedCompletion: number } // API'yi gereksiz çağırmamak için
```

---

## F. Mobil UX — tüm sistemler için zorunlu gereksinimler

Mevcut PDA modu (portrait-native, zaten doğru mimari karar) bu dört yeni sistemin de
taşıyıcısı olacak:

- **Tray building'leri**: PDA modunda ekranın üstünde kalıcı bir durum şeridinde
  (Windows Mobile/PocketPC'nin bildirim çubuğu tarzında) küçük ikonlar olarak görünür —
  tam pencere hiç açılmaz, masaüstü/mobil arasında tutarlı.
- **Mini-oyunlar**: tek-başparmak, dikey oynanış için yeniden tasarlanmış kontroller;
  hover-bağımlı hiçbir etkileşim yok (Aero glow efektleri dokunma karşılığına sahip
  olmalı); dokunma hedefleri ≥44px.
- **Darknet Breach tam ekran olayı**: CSS/SVG tabanlı olduğu için doğası gereği duyarlı,
  ama dikey en-boy oranında özellikle test edilmeli (Faz 3 "Hacklendiniz" ekranı).
  Rogue Process ikonları mobilde dokunma hedefi olarak büyütülmeli (masaüstündeki fare
  imleci hassasiyetine güvenilemez).
- **Achievement penceresi**: masaüstünde ikon ızgarası, PDA modunda tek-sütun liste
  görünümüne düşüyor (mevcut PDA tasarım deseniyle tutarlı).
- **Genel kural**: hiçbir yeni sistem, mobilde "sadece masaüstünde tam çalışır" bir
  ikincil vatandaş olarak tasarlanmayacak — madde F, tüm fazların (madde G) kabul
  kriterinin bir parçası.

---

## G. Güncellenmiş implementasyon fazları

Ekonomi patch'indeki fazlara (v2 madde 8) ek olarak:

7. **Faz 6 — Görsel tasarım sistemi**: madde A'daki yasaklı-element listesinin lint/
   review kontrolüne dönüştürülmesi, 12 building'in referans-yazılım UI eşleştirmesinin
   uygulanması. En büyük tasarım/sanat yükü burada.
8. **Faz 7 — Mini-oyun motoru**: 5 mini-oyunun her biri kendi alt-görevi; ortak bir
   "mini-oyun sonucu → o building'e geçici bonus" arayüzü paylaşılmalı (kod tekrarını
   önlemek için tek bir `applyMinigameReward(buildingId, result)` fonksiyonu).
9. **Faz 8 — Darknet Breach**: `riskRatio` hesaplaması (core, DOM'suz) → Faz 1-3 UI →
   Gizli Mod satın alma arayüzü → kozmetik unlock bağlantısı.
10. **Faz 9 — Achievement + CrazyGames bağlama**: birinci-parti achievement listesi ve
    penceresi → `happytime()`/`reportGameCompletedPercentage()` çağrı noktaları →
    (koşullu) leaderboard entegrasyonu.
11. **Faz 10 — Mobil geçiş/test**: madde F'deki her gereksinim için ayrı bir doğrulama
    turu, gerçek cihazda (emülatör değil) test.

---

## H. Açık kalan kararlar

1. `riskRatio` eşik değeri (taslak: 5) ve Faz 1→2→3 geçiş süreleri — dengeleme konusu,
   playtestle kalibre edilecek.
2. Mini-oyunların "Tier 3" açılma kademesi tüm 5'i için aynı mı kalacak, yoksa
   building'e göre farklılaşacak mı (öneri: ilk sürümde sabit, tutarlılık için).
3. Leaderboard'un gerçekten aktive edilip edilmeyeceği — CrazyGames'in "davet edilen
   oyun" statüsüne bağlı, bizim kontrolümüz dışında bir ön koşul.
4. Cloud Mainframe'in "mainframe terminali" estetiğinin genel Aero temasıyla ne kadar
   kontrast oluşturacağı — kasıtlı bir tonal seçim ama görsel olarak playtestte
   doğrulanmalı ("modern" ile karıştırılmadığından emin olmak için).
