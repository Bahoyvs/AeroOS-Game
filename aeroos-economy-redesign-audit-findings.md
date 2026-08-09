# AeroOS Ekonomi Redesign — Keşif Bulguları

## A. App → Rol Tablosu

| App | Kozmetik mi (yalnız UI/flavor) | Üretime doğrudan etkisi var mı (nasıl?) | Buff/çarpan sağlıyor mu (neye, ne kadar?) | Unlock koşulu | Install/RAM maliyeti | Kaynak dosya:satır |
| --- | --- | --- | --- | --- | --- | --- |
| **AeroChat** | Hayır | Evet. Bot başına 0.5 Buzz/sec taban üretim sağlar. Yalnızca pencere açıkken pasif üretim yapar. | Bot sayısına bağlı milestone bonusu: Her 25 bot için AeroChat üretimine flat +%8 (+0.08) çarpan ekler. LemonWire seed geliri için baz alınır. | Pre-installed (`unlockAt: 0`) | Install: 0 Buzz<br>RAM: 32 MB | [apps.js:11-22](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L11-L22)<br>[economy.js:265-291, 319](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L265-L291)<br>[balance.js:9-20](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L9-L20) |
| **RetroAmp** | Hayır | Doğrudan üretim yapmaz. Yalnızca penceresi açıkken aktif çalma listesi üzerinden küresel üretim çarpanı (`globalMultiplier`) uygular. | Active playlist çarpanı:<br>• *AERO AMBIENCE*: +%15 küresel, süresiz<br>• *P2P DOWNLOADER*: +%200 küresel (3x), 300s süre, 600s cooldown<br>• *Y2K TRANCE*: +%500 küresel (6x), 120s süre, 1200s cooldown | `runBuzz >= 20` (`unlockAt: 20`) | Install: 28 Buzz<br>RAM: 64 MB (+0 / +64 / +256 MB playlist'e göre) | [apps.js:23-39](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L23-L39)<br>[economy.js:131-149, 326-339](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L131-L149)<br>[playlists.js:14-64](file:///d:/Games/Web/AeroOS-Game/src/data/playlists.js#L14-L64) |
| **LemonWire** | Hayır | Evet. Yalnızca penceresi açıkken aktif seed slotundaki dosyalar saniye başı pasif Buzz/sec üretir: `(0.6 + chatRate * 0.03) * weight * bandwidth`. | Doğrudan çarpan vermez. Seed edilen risk miktarı Shield99 tehditlerinin ortaya çıkma hızını artırır. | `runBuzz >= 1200` (`unlockAt: 1200`) | Install: 2000 Buzz<br>RAM: 96 MB | [apps.js:40-51](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L40-L51)<br>[economy.js:302-314](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L302-L314)<br>[lemonwire.js:31-47](file:///d:/Games/Web/AeroOS-Game/src/core/lemonwire.js#L31-L47)<br>[balance.js:226-276](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L226-L276) |
| **Shield99** | Hayır | Doğrudan pasif Buzz üretmez. Pencere açıkken tehditleri yakalayıp karantinaya alır. Karantinadan çıkan ödüller Buzz burst, global buff veya Aero Studio render boost verir. Ayrıca virüs bulaşmasını engelleyerek üretimin yarıya düşmesini önler. | Virüsü engelleyerek %50 ceza (`infectionPenalty = 0.5`) oluşmasını önler. Karantinadaki *Worm* tehdidi açıldığında 600s süren +%100 küresel buff verir. | `runBuzz >= 2500` (`unlockAt: 2500`) | Install: 3000 Buzz<br>RAM: 48 MB | [apps.js:52-63](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L52-L63)<br>[shield99.js:83-96, 127-130, 163-183](file:///d:/Games/Web/AeroOS-Game/src/core/shield99.js#L83-L96)<br>[balance.js:302-349](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L302-L349)<br>[economy.js:330](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L330) |
| **Aero Studio** | Hayır | Evet. GPU tabanlı render tamamlandığında 14.400 saniyelik (4 saatlik) anlık Buzz üretimi tutarında toplu ödeme (`pendingReward`) kazandırır. | Render devam ederken küresel üretime 0.8x (%20 ceza) render cezası uygular. | `runBuzz >= 8000` (`unlockAt: 8000`) | Install: 12000 Buzz<br>RAM: 192 MB | [apps.js:64-73](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L64-L73)<br>[economy.js:327, 337](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L327)<br>[aerostudio.js:80-95](file:///d:/Games/Web/AeroOS-Game/src/core/aerostudio.js#L80-L95)<br>[balance.js:583-608](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L583-L608) |
| **AeroBurn** | Hayır | Pasif Buzz üretmez. Buzz harcayarak Format C: prestijini atlatan CD yakar. MIX (5k) ve GOLD (1M) diskleri çalındığında harcanan Buzz'ın %60 veya %80'ini geri öder. | O/C (Overclock) diski çalındığında 300 saniye (5 dk) süren +%100 (+1.0) küresel üretim buff'ı verir. | `runBuzz >= 9000` (`unlockAt: 9000`) | Install: 12000 Buzz<br>RAM: 64 MB | [apps.js:74-83](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L74-L83)<br>[aeroburn.js:11-85](file:///d:/Games/Web/AeroOS-Game/src/core/aeroburn.js#L11-L85)<br>[cds.js:14-45](file:///d:/Games/Web/AeroOS-Game/src/data/cds.js#L14-L45) |
| **AeroSweeper** | Hayır | Evet. Cash-out yapıldığında açılan güvenli kare başına 25 saniyelik mevcut Buzz/sec öder. Token alımı 900s üretime mal olur. | Açılan her güvenli kare +0.1 (+%10) Nudge (click) buff'ı ekler (max +12.0 = 1200%, 180s süre). Tahta tam temizlenirse %150 bonus alır. | `runBuzz >= 5000` (`unlockAt: 5000`) | Install: 6000 Buzz<br>RAM: 64 MB | [apps.js:84-95](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L84-L95)<br>[balance.js:373-412](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L373-L412)<br>[sweeper.js:218-257](file:///d:/Games/Web/AeroOS-Game/src/core/sweeper.js#L218-L257)<br>[economy.js:418-444](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L418-L444) |
| **My Computer (System)** | Hayır | Doğrudan pasif üretim yapmaz; Hardware geliştirmelerinin (CPU, RAM, GPU, HDD, Mainboard) satın alınmasını ve Format C: yapılmasını sağlar. | Donanım geliştirmelerinin satın alım arayüzüdür. | Pre-installed (`system: true`), arayüzde görünmesi için `tutorial.hardwareRevealed` = true olmalıdır. | Install: 0 Buzz<br>RAM: 0 MB | [apps.js:98-109](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L98-L109)<br>[desktop.js:18](file:///d:/Games/Web/AeroOS-Game/src/ui/desktop.js#L18) |

---

## B. Buddy Sistemi

- **Buddy Tipleri ve Taban Üretim**:
  - Kodda farklı üretim yapan veya seviyeleri olan ayrı buddy tipleri **bulunmamaktadır**. Buddy'ler `state.chat.bots` alanında yalnızca **sayısal bir adet (count)** olarak saklanır ([state.js:47](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L47)).
  - Tüm buddy'lerin taban üretimi (base rate) **sabit 0.5 Buzz/sec**'dir ([balance.js:12](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L12), [economy.js:290](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L290)).
  - İsimler, avatarlar ve durum mesajları buddy indeksine dayalı deterministik kozmetik fonksiyonlarla üretilir ([buddies.js:84-96](file:///d:/Games/Web/AeroOS-Game/src/data/buddies.js#L84-L96)).
  - Fiyat artış oranı: Geometrik fiyat eğrisi (geometrical scaling) uygulanır:
    $$\text{botCost}(\text{owned}) = \lceil \text{baseCost} \times \text{costGrowth}^{\text{owned}} \rceil$$
    Burada `CHAT_BOT.baseCost = 10` Buzz, `CHAT_BOT.costGrowth = 1.15`'dir ([balance.js:10-11](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L10-L11), [economy.js:234-236](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L234-L236)). Toplu bot alımında maliyetler ardışık olarak toplanır (`botCostBulk`, [economy.js:238-243](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L238-L243)). Run başına maksimum 500 bot sınırı vardır (`CHAT_BOT.maxPerRun = 500`, [balance.js:13](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L13)).

- **Formül Birleşimi (AeroChat & Genel Üretim)**:
  - AeroChat ham üretimi ([economy.js:284-291](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L284-L291)):
    $$\text{chatRate} = \text{bots} \times 0.5 \times \text{chatMultiplier}$$
    $$\text{chatMultiplier} = \text{chatMilestoneMultiplier} \times \text{buffMultiplier}(\text{'chat'})$$
    $$\text{chatMilestoneMultiplier} = 1 + \lfloor \frac{\text{bots}}{25} \rfloor \times 0.08$$
  - Genel Saniye Başına Buzz üretimi (`buzzPerSecond`, [economy.js:317-344](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L317-L344)):
    $$\text{baseBuzzPerSecond} = (\text{aerochat.open} ? \text{chatRate} : 0) + \text{seedBuzzPerSecond}$$
    $$\text{buzzPerSecond} = \text{baseBuzzPerSecond} \times \text{globalMultiplier}$$
    $$\text{globalMultiplier} = \text{CPU\_prod} \times \text{bloatPenalty} \times \text{infectionPenalty} \times \text{retroampMultiplier} \times \text{globalBuffs} \times \text{defragPenalty} \times \text{renderPenalty}$$
  - Kod kanıtı: Buddy üretimi taban katmanda yer alır; CPU, RetroAmp, Bloat, Defrag ve Buff çarpanları bu taban üretimi çarpar (Multiplicative chain).

---

## C. Ölçekleme Oranları

- **Buddy Fiyat/Üretim Oranı Örneği**:
  - Taban üretim her bot için sabit **0.5 Buzz/sec**'dir. Fiyat %15 bileşik artış gösterir (`costGrowth = 1.15`).
  - **Bot #1 (Index 0)**: Maliyet = **10 Buzz** \| Taban Üretim = **0.5 Buzz/s** \| (Maliyet / Taban Üretim = 20)
  - **Bot #2 (Index 1)**: Maliyet = **12 Buzz** \| Taban Üretim = **0.5 Buzz/s** \| (Maliyet / Taban Üretim = 24)
  - **Bot #3 (Index 2)**: Maliyet = **14 Buzz** \| Taban Üretim = **0.5 Buzz/s** \| (Maliyet / Taban Üretim = 28)
  - **Bot #4 (Index 3)**: Maliyet = **16 Buzz** \| Taban Üretim = **0.5 Buzz/s** \| (Maliyet / Taban Üretim = 32)
  - **Bot #5 (Index 4)**: Maliyet = **18 Buzz** \| Taban Üretim = **0.5 Buzz/s** \| (Maliyet / Taban Üretim = 36)
  - *(Referans: [balance.js:9-20](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L9-L20), [economy.js:234-236](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L234-L236))*

- **Hardware Track'leri Arası Oranlar**:
  - Donanım kulvarları (CPU, RAM, GPU, HDD, Mainboard) **birbiriyle orantılı değildir, tamamen bağımsız olarak Dolar ($) cinsinden fiyatlandırılmıştır** ([hardware.js:30-94](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L30-L94)).
  - **CPU Track** (Production & Click Power):
    - Tier 0: Celedon 400 — Cost: $0 (+0% prod, +0% click)
    - Tier 1: Pentagon II 733 — Cost: $12 (+25% prod, +50% click)
    - Tier 2: Pentagon III 1.0 — Cost: $60 (+35% prod, +70% click)
    - Tier 3: Athlete XP 2400+ — Cost: $320 (+50% prod, +100% click)
    - Tier 4: Pentagon IV HT 3.2 — Cost: $1,800 (+70% prod, +140% click)
    - Tier 5: Core Duet E6600 — Cost: $11,000 (+100% prod, +200% click)
    - Tier 6: Core Quadra Q6600 — Cost: $75,000 (+140% prod, +280% click)
  - **RAM Track** (Memory Capacity):
    - Tier 0: 128 MB — Cost: $0 (128 MB)
    - Tier 1: 256 MB — Cost: $10 (256 MB)
    - Tier 2: 512 MB — Cost: $55 (512 MB)
    - Tier 3: 1 GB — Cost: $300 (1024 MB)
    - Tier 4: 2 GB — Cost: $1,700 (2048 MB)
    - Tier 5: 4 GB — Cost: $10,000 (4096 MB)
    - Tier 6: 8 GB — Cost: $68,000 (8192 MB)
  - **GPU Track** (Cooldown Reduction):
    - Tier 0: Integrated — Cost: $0 (-0%)
    - Tier 1: GeForged MX 440 — Cost: $14 (-10%)
    - Tier 2: Radium 9600 Pro — Cost: $70 (-12%)
    - Tier 3: GeForged 6800 GT — Cost: $380 (-14%)
    - Tier 4: Radium X1900 XT — Cost: $2,100 (-14%)
    - Tier 5: GeForged 8800 GTX — Cost: $13,000 (-14%)
  - **HDD Track** (Storage & Offline Hours):
    - Tier 0: 20 GB — Cost: $0 (20GB storage, 2h offline)
    - Tier 1: 40 GB — Cost: $16 (40GB storage, 4h offline)
    - Tier 2: 80 GB — Cost: $85 (60GB storage, 6h offline)
    - Tier 3: 250 GB — Cost: $450 (190GB storage, 18h offline)
    - Tier 4: 500 GB — Cost: $2,600 (270GB storage, 14h offline)
    - Tier 5: 1 TB — Cost: $16,000 (520GB storage, 14h offline)
  - **Mainboard (MOBO) Track** (Format C: Payout multiplier):
    - Tier 0: OEM Board — Cost: $0 (+0% payout)
    - Tier 1: Pentagon Overclock Kit — Cost: $2.5 (+10% payout)
    - Tier 2: Dual-Core Bus — Cost: $10 (+20% payout)
    - Tier 3: Quantum Interconnect 500 — Cost: $50 (+50% payout)

---

## D. Unlock/Milestone Eşikleri

- **Uygulama Kilit Eşikleri (`runBuzz` tabanlı)** ([apps.js:11-95](file:///d:/Games/Web/AeroOS-Game/src/data/apps.js#L11-L95), [economy.js:653](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L653)):
  - **AeroChat**: `runBuzz >= 0` (Unlock: 0, Install: 0 Buzz)
  - **RetroAmp**: `runBuzz >= 20` (Unlock: 20 Buzz, Install: 28 Buzz)
  - **LemonWire**: `runBuzz >= 1200` (Unlock: 1200 Buzz, Install: 2000 Buzz)
  - **Shield99**: `runBuzz >= 2500` (Unlock: 2500 Buzz, Install: 3000 Buzz)
  - **AeroSweeper**: `runBuzz >= 5000` (Unlock: 5000 Buzz, Install: 6000 Buzz)
  - **Aero Studio**: `runBuzz >= 8000` (Unlock: 8000 Buzz, Install: 12000 Buzz)
  - **AeroBurn**: `runBuzz >= 9000` (Unlock: 9000 Buzz, Install: 12000 Buzz)
  - **My Computer**: `system: true` (Her zaman kilit açık, ancak `tutorial.hardwareRevealed` ilk RAM darboğazında `%90 RAM kullanımı` gerçekleşince açılır, [balance.js:430-432](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L430-L432), [tutorial.js:10-28](file:///d:/Games/Web/AeroOS-Game/src/core/tutorial.js#L10-L28)).

- **Format C: Prestij Eşiği (`lifetimeBuzz` tabanlı)**:
  - Format C: prestij butonu `lifetimeBuzz >= 5000` olduğu anda aktifleşir (`PRESTIGE.minLifetimeBuzz = 5000`, [balance.js:159](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L159), [economy.js:497](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L497)).

- **Donanım / Mağaza Eşikleri**:
  - Donanımlar Dolar ($) bakiyesine göre açılır; özel bir `runBuzz` veya `prestigeCount` kilit şartı yoktur ([economy.js:586-589](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L586-L589)).

- **Kozmetik Kilit Eşikleri (`cosmetics.js`)**:
  - `lifetimeBuzz`: 0, 50k, 500k, 5M, 50M Buzz ([cosmetics.js:41-93](file:///d:/Games/Web/AeroOS-Game/src/data/cosmetics.js#L41-L93)).
  - `prestigeCount`: 1, 3, 10 Format C: wipe ([cosmetics.js:48-94](file:///d:/Games/Web/AeroOS-Game/src/data/cosmetics.js#L48-L94)).
  - `dollarsSpentTotal`: $1.00, $25.00, $100.00, $500.00 ([cosmetics.js:55-90](file:///d:/Games/Web/AeroOS-Game/src/data/cosmetics.js#L55-L90)).

---

## E. Prestij Bağlantı Noktaları

- **Dollar'ların Üretime Etkisi**:
  - **Kod Doğrulaması**: `state.dollars`, `state.dollarsEarnedTotal` veya `state.dollarsSpentTotal` değişkenleri `buzzPerSecond` veya `globalMultiplier` formülünde **HİÇBİR ŞEKİLDE DOĞRUDAN YER ALMAZ** ([economy.js:326-344](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L326-L344)).
  - Dollar'ların tek ve dolaylı etkisi **Hardware Shop** üzerinden satın alınan donanımlardır:
    - CPU → `production` çarpanı (+%25'ten +%140'a) ve `click` gücü ([hardware.js:30-39](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L30-L39)).
    - RAM → Bellek kapasitesi ([hardware.js:41-49](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L41-L49)).
    - GPU → Cooldown indirimi ([hardware.js:51-58](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L51-L58)).
    - HDD → Offline süresi & LemonWire seed slotları ([hardware.js:60-67](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L60-L67)).
    - Defrag → Otomatik bloat temizleyici ($25) ([balance.js:186](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L186)).
  - **Prestij Formülü ve Mainboard Etkisi**:
    $$\text{pendingPrestigeDollars} = \lfloor 1 \times \sqrt{\frac{\text{lifetimeBuzz}}{\text{prestigeDivisor}}} \rfloor$$
    $$\text{prestigeDivisor} = \frac{1000}{\text{payout}^2}$$
    Mainboard donanımındaki `payout` artışı (%10, %20, %50) `prestigeDivisor`'ı düşürerek `lifetimeBuzz`'ın değerini artırır ([economy.js:483-507](file:///d:/Games/Web/AeroOS-Game/src/core/economy.js#L483-L507), [hardware.js:88-93](file:///d:/Games/Web/AeroOS-Game/src/data/hardware.js#L88-L93)).

- **Format C: (Prestige Reset) Etki Alanı**:
  - **Sıfırlanan Veriler**: `buzz`, `runBuzz`, tüm uygulama yükleme/açık durumları (`state.apps`), `chat.bots`, `lemonwire` seed'leri/bağlantısı, `shield99` karantinası, `security.infection/scan`, `bloat`, geçici `buffs` ([state.js:217-261](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L217-L261)).
  - **Kalıcı Kalan Veriler**: `dollars`, `dollarsEarnedTotal`, `dollarsSpentTotal`, `lifetimeBuzz`, `prestigeCount`, `hardware` seviyeleri, `defrag.owned`, `aeroburn.discs` (yakılmış CD'ler), `cosmetics`, `settings`, `stats`, `tutorial.done` ([state.js:217-261](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L217-L261), [aeroburn.js:80-85](file:///d:/Games/Web/AeroOS-Game/src/core/aeroburn.js#L80-L85)).

---

## F. Save/State Etki Alanı

- **`createInitialState()` İçindeki Ekonomi/App/Hardware Alanları** ([state.js:15-204](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L15-L204)):
  - `version`: `SAVE_VERSION` (3)
  - `buzz`, `lifetimeBuzz`, `runBuzz`, `dollars`, `dollarsEarnedTotal`, `dollarsSpentTotal`
  - `hardware`: `{ cpu: 0, ram: 0, gpu: 0, hdd: 0, mobo: 0 }`
  - `prestigeCount`: number
  - `apps`: `{ [id]: { installed: boolean, open: boolean, minimized: boolean } }`
  - `chat`: `{ bots: number, event: null|object, nextEventIn: number }`
  - `lemonwire`: `{ activeSeeds: [], maxSeedSlots: 3, connection: 0, trash: [], nextId: 1 }`
  - `aeroburn`: `{ discs: [], burning: null, burned: 0 }`
  - `security`: `{ infection: null, rescuesUsed: 0, scan: null }`
  - `shield99`: `{ quarantine: [], nextThreatIn: 0, adCooldownUntil: 0, filesCleaned: 0, nextId: 1 }`
  - `sweeper`: `{ tokens: 3, nextTokenAt: 0, bestTiles: 0, rounds: 0, sweeps: 0 }`
  - `retroamp`: `{ playlist: null, endsAt: 0, cooldownUntil: {}, startedAt: 0 }`
  - `defrag`: `{ owned: false, active: false, startedFrom: 0, passes: 0 }`
  - `aerostudio`: `{ isRendering: false, currentProject: null, progress: 0, pendingReward: null, upgrades: { sidechainCompression: 0, arpeggiator: 0, environmentalFx: 0 } }`

- **Save Versiyonu ve Migration Adımları** ([save.js:93-140](file:///d:/Games/Web/AeroOS-Game/src/core/save.js#L93-L140)):
  - **Güncel `SAVE_VERSION`**: `3` ([state.js:10](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L10))
  - **Adım 1 -> 2**: `settings.reducedMotion` boolean değerini `settings.motion` ('auto'|'full'|'reduced') üçlü durumuna aktarır ([save.js:97-104](file:///d:/Games/Web/AeroOS-Game/src/core/save.js#L97-L104)).
  - **Adım 2 -> 3**: LemonWire indirme yöneticisi yapısından seeder yapısına geçtiğinde eski `queue` ve `library` listesini `activeSeeds` yapısına dönüştürür, slot limitine göre keser ([save.js:112-139](file:///d:/Games/Web/AeroOS-Game/src/core/save.js#L112-L139)).
  - **Yeni Migration Ekleme Şablonu**:
    ```javascript
    // src/core/save.js
    // 3 -> 4: Yeni ekonomi redesign alanları veya veri dönüşümü
    3: (data) => {
      return {
        ...data,
        // yeni alanlar / dönüştürülen veriler
        version: 4,
      };
    },
    ```
    `SAVE_VERSION` değeri `4` olarak güncellenir ([state.js:10](file:///d:/Games/Web/AeroOS-Game/src/core/state.js#L10)).

---

## G. Belirsiz / Kodda Net Olmayan Noktalar

1. **Masaüstü ve Start Menüsü Görünürlük Uyuşmazlığı**:
   - `src/ui/taskbar.js:49-50`: Start menüsünde kurulmamış uygulamalar `game.econ.isAppUnlocked(game.state, app.id)` (`runBuzz >= unlockAt`) kontrolüne tabi tutularak gösterilir ve satın alma olanağı sunulur.
   - `src/ui/desktop.js:16`: Masaüstünde ise **sadece ve sadece `installed: true` olan uygulamalar** ikon olarak render edilir. Açılmış ancak henüz kurulmamış uygulamalar masaüstünde simge olarak yer almaz.
2. **Aero Studio Üretim Kesintisi**:
   - `src/core/economy.js:327`: Render işlemi devam ederken küresel üretime %20 ceza (`renderPenalty = 0.8`) uygulanmaktadır. Tamamlanan render ise toplu bir ödeme (4 saatlik Buzz) verir. Render esnasında anlık Buzz/sec düşüşü yaşanmaktadır.
3. **ADS Flag'inin Pasif Durumu**:
   - `src/data/balance.js:481`: `ADS.enabled = false` durumundadır. Ads kapalıyken Shield99 karantinadan dosya çıkarma işlemi manuel modda dahi tam ödül öder (`src/data/balance.js:475-478`).
4. **Offline Bloat Tavanı Farklılığı**:
   - Defrag sahipliği yokken çevrimdışı kalındığında bloat %100'e kadar çıkar ([defrag.js:96](file:///d:/Games/Web/AeroOS-Game/src/core/defrag.js#L96)). Defrag satın alındığında çevrimdışı bloat birikimi %50 (`DEFRAG.offlineCap = 0.5`) seviyesinde tutulur ([defrag.js:95-98](file:///d:/Games/Web/AeroOS-Game/src/core/defrag.js#L95-L98), [balance.js:213](file:///d:/Games/Web/AeroOS-Game/src/data/balance.js#L213)).
