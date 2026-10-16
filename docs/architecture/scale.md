# Sollish ölçek mimarisi — milyonlarca oyuncu ve izleyici

Durum: 16 Ekim 2026. Sahip hedefi: "milyonlarca kişi aynı anda izleyip oynayabilsin; dünyanın en büyük operatörleri gibi, daha iyi; mimari çok sağlam; site ve oyunlar her cihazda hızlı." Yalnız DEMO; gerçek varlık kapıları kapalı (`docs/validation.md`).

**Dürüst sınır:** Bu konteynerde "milyonlar" kanıtlanamaz. Burada olan: bir kapasite modeli (varsayımları açık), kodda bulunan gerçek darboğazlar, şimdi düzeltilenler ve tek makinede yerel workerd yük ölçümleri. Barındırılan (Cloudflare) yük testi, çok bölgeli ölçüm ve gerçek telefon ölçümü yapılmadı. Aşağıda her madde **[ŞİMDİ UYGULANDI]**, **[TASARIM — barındırılan doğrulama gerekir]** veya **[SAHİP KARARI]** etiketlidir.

Kanıt klasörü: `ops/evidence/scale-20261016/` (özet `summary.json`).

---

## 1. Hedef SLO'lar

| Ölçüt | Hedef | Bugünkü kanıt |
| --- | --- | --- |
| Spin API (POST `/v1/slots/:game/rounds`) gecikmesi, oyuncunun bölgesinde, sunucu tarafı | p50 ≤ 40 ms, p99 ≤ 150 ms | Yerel, kapasite altında (50 oyuncu × 1 spin/sn, disk): p50 11 ms, p95 28 ms, p99 33 ms. Barındırılan ölçüm yok. |
| Spin API hata oranı (yeniden denemeden sonra) | < 0,01 % ; çift çekim **0** | Yerel bütün koşularda nihai hata 0, defter/nonce/idempotency 100 % tutarlı (aşırı yükte bile). |
| Lobi HTML TTFB (p75, mobil, sıcak kenar) | ≤ 200 ms | Barındırılan yok. Yerel workerd önizleme (loopback, sıcak): `/games` p50 42 ms, `/game/tarhun` 70 ms; her sayfa her istekte SSR (§6.3). |
| Lobi LCP (p75, orta segment Android, 4G) | ≤ 2,5 s | Ölçülmedi. |
| Oyun rotası ilk yük JS (gzip, framework dahil) | ≤ 250 KB | `build:cloudflare` (build `JpEUqEHEm4FOYVKBgzfGK`): slot rotaları 246–294 KB (`first-load-js-after.json`); düzeltmeden önce rota kodu ~+157 KB gz daha (esbuild tahmini, §6.2). |
| Oyun sayfası HTML (sıkıştırılmış) | ≤ 30 KB | 33–101 KB; ham HTML'in %76–92'si sunucuda çizilmiş satır içi SVG (§6.3). |
| Oyun içi kare hızı (orta segment telefon) | 60 fps, ≥ 50 fps p5 | Ölçülmedi. |
| Canlı yayın yayılma gecikmesi (kök arena → izleyici) | p99 ≤ 1 s | Yerel, 2.000 izleyici / 4 relay: "güncel duruma yetişme" p50 196 ms, p99 641 ms (250 ms birleştirme dahil, yüklü konteyner; ayrıntı §5). |
| Geç katılan izleyicinin ilk karesi | ≤ 300 ms | Yerel relay: tek istek, önbellekteki son anlık görüntü. |
| İzleme (RTP sapma alarmı) gecikmesi | ≤ 60 s | Oturum → shard 30 s + shard → global 5 s (yerel koşuda doğrulandı). |

Dağılma bütçesi (error budget) aylık %0,1 spin API kullanılamazlığı (≈ 43 dk/ay). Bütçe yarıya inerse yeni özellik dağıtımı durur, yalnız güvenilirlik işi çıkar.

## 2. Trafik modeli

Varsayımlar (sahiple doğrulanmalı):
- **Oyuncu** = aktif spin atan oturum. Ortalama 1 spin / 4 s (normal hız ~6 s, turbo/otomatik ~2 s). Tepe saat ortalamanın 2,5 katı.
- **İzleyici** = Ringside LIVE yayınını açık tutan, bahis yapmayan tarayıcı. Oyuncu başına 3–10 izleyici (yayın açıkken).
- Spin başına ağ: istek ~180 B, yanıt (makbuz + tam tur adımları) 1,7–4,1 KB (motor ölçümü: cascade 1,8 KB, ebru 4,1 KB).

| Ölçek | Eşzamanlı oyuncu | Spin/s (ortalama → tepe) | Eşzamanlı izleyici soketi | SlotWallet DO aktif |
| --- | ---: | ---: | ---: | ---: |
| A | 10.000 | 2.500 → 6.250 | 50.000 | 10.000 |
| B | 100.000 | 25.000 → 62.500 | 500.000 | 100.000 |
| C | 1.000.000 | 250.000 → 625.000 | 5.000.000 | 1.000.000 |

Kıyas: en büyük slot sağlayıcıları ayda onlarca milyar tur işler (≈ 10–30 bin tur/s ortalama). C ölçeği sektörün tamamından büyüktür; mimari bunu yatay olarak taşıyabilmeli, ama bütçe ve kanıt B'ye göre planlanmalı.

## 3. Büyük operatörler/agregatörler nasıl kuruyor (ve biz neye karşılık geliyoruz)

| İlke | Sektör uygulaması | Sollish karşılığı |
| --- | --- | --- |
| Durumsuz kenar | API ağ geçidi + durumsuz oyun sunucusu havuzu, yatay ölçek | Worker router (`src/index.ts`, `src/slots.ts`) durumsuz; her istek kendi PoP'unda koşar. [ŞİMDİ] |
| Oyuncu başına cüzdan parçalama | Cüzdan/bakiye oyuncu kimliğine göre shard'lanır; tek yazıcı | **Bir oturum = bir `SlotWallet` DO** (`slot:<sha256(token)>`), SQLite, tek iş parçacığı. Doğrulandı (§4.1). DO ilk istek yapılan bölgeye yakın yaratılır → oyuncuya yakınlık kendiliğinden. [ŞİMDİ] |
| İdempotent tur ve ödeme | Her işlem tekil kimlik; tekrar = aynı sonuç; rollback | `idempotencyKey` → aynı bayt, `Idempotent-Replayed: true`; tek SQLite işlemi; yük testinde 500/409 yeniden denemelerinde çift çekim 0. [ŞİMDİ] |
| Oturum başına tek eşzamanlı tur | Çift tıklama/bot yarışını sunucu keser | `SESSION_BUSY` (kuyruk yok), 4/s, 600/dk. [ŞİMDİ] |
| Değişmez, CDN önbellekli oyun varlıkları | İçerik hash'li URL, `immutable`, sürümlü paketler | `_next/static`, `/fonts`, `/workers` immutable; ses/sprite/görsel ETag ile yeniden doğrulanır (§6). [ŞİMDİ, kısmen] |
| Hiyerarşik yayın dağıtımı | Video: kaynak → origin shield → kenar → izleyici; veri: pub/sub ağaç | Ringside: kök arena DO → N relay DO → izleyici (§5). [ŞİMDİ uygulandı, varsayılan kapalı] |
| Sayaçlarda sıcak nokta yok | Sharded sayaç + periyodik toplama | `SlotMonitor` 64 shard + 5 s rollup (§4.2). [ŞİMDİ] |
| Senkron olmayan raporlama yolu | Tur verisi kuyruğa/akışa, DWH'ye toplu | Spin yolunda Supabase yok (doğrulandı). Rapor/denetim dışa aktarımı Queues ile (§4.4). [TASARIM] |
| Bölgesel yedeklilik | Aktif-aktif bölgeler, oyuncu yapışkanlığı | DO depolaması Cloudflare tarafından çoğaltılır; DO yeri sabittir. §8. [TASARIM] |
| Gözlemlenebilirlik | RED metrikleri, tur başına iz, RTP izleme, SLO alarmı | RTP 4σ alarmı var; Workers Logs/Analytics Engine metrikleri tasarım (§9). |
| Olay runbook'ları ve kill switch | Oyun/sağlayıcı bazında anında kapatma | `SLOTS_ENABLED`, `LIVE_ARENA_ENABLED`, `LIVE_RELAYS` var; oyun bazında anahtar tasarım (§8). |

## 4. Slot RGS yolu

### 4.1 SlotWallet: oyuncu başına bir DO [ŞİMDİ, doğrulandı]
- Router `env.SLOT_WALLET.idFromName("slot:" + sha256(token))` (`src/slots.ts`); tablo `slot_session` tek satır (`CHECK(singleton=1)`). Bir oturum hiçbir zaman başka bir DO ile kilit paylaşmaz → spin yolunda küresel kilit yok, yatay ölçek DO sayısıyla doğrusal.
- Spin yolunda dış çağrı yok: Supabase, KV, R2 yok. Tek SQLite işlemi + `storage.sync()`.
- Spin başına CPU: motor 0,02–0,04 ms (Node ölçümü, `summary.json` `engineCost`); asıl maliyet platform (HMAC, JSON, SQLite commit). Yerel workerd'de spin başına 6–16 ms CPU (yerel geliştirme vekili ve fsync dahil; barındırılan sayı değildir).
- Yük altında doğruluk (yerel): 50, 200 ve 1.000 eşzamanlı oturum; her oturumda bakiye = 100.000 − Σmaliyet + Σödeme, nonce 0..n−1 kesintisiz, örnek anahtarlar aynı baytla döndü; aşırı yükte miniflare "Network connection lost" 500'leri aynı anahtarla yeniden denendi ve hiçbiri çift çekim yapmadı.

### 4.2 SlotMonitor: tek küresel sıcak nokta → shard + rollup [ŞİMDİ UYGULANDI]
- **Önce:** her aktif oturum 5 s'de bir `SlotMonitor("global")`'a istek atıyordu. 1 M aktif oturumda 200.000 istek/s tek bir DO'ya (DO tek iş parçacıklıdır; pratik tavan ~1.000 istek/s). Kesin darboğaz.
- **Sonra:** `SlotWallet` → `shard:<k>` (k = token hash'inin ilk 8 hex'i mod `SLOT_MONITOR_SHARDS`, varsayılan 64; 30 s'de bir, yalnız yeni tur varsa) → `global` (her shard 5 s'de bir, yalnız bekleyen varsa). Global yük ≈ 64/5 = 13 istek/s, ölçekten bağımsız. 1 M oturumda shard başına ≈ 1 M / 64 / 30 ≈ 520 istek/s; 10 M için `SLOT_MONITOR_SHARDS=256`.
- API ve alarm metni aynı (`/add`, `/stats`, `slot_rtp_deviation`); `SLOT_MONITOR_SHARDS=0` eski tek-nesne yolu. Her iki atlama en az bir kez (kayıp onayda bir parti iki kez sayılabilir; alarm insan içindir, sonuca/ödemeye dokunmaz). Ekonomi, motor ve politika kimliği değişmedi.
- Kod: `src/slot-monitor.ts`, `src/slot-stats.ts` (`monitorTarget`, `monitorShardCount`), `src/slot-wallet.ts` `flushStats`. Test: birim `monitor sharding` (dağılım düzgünlüğü), workerd `test:slots` 33/33 (global'e shard üzerinden ulaşır), yük testinde global tur sayısı = kabul edilen tur sayısı.

### 4.3 Kenarda hız sınırı ve kötüye kullanım [kısmen ŞİMDİ, gerisi TASARIM]
- Şimdi: oturum başına bellek içi 12 istek/s, kalıcı 4 tur/s + 600/dk, tek eşzamanlı istek, gövde ≤ 2 KB, CORS/Origin, sorgu dizesi yasak, sahte belirteç DO'ya ulaşmaz (HMAC etiketi Worker'da).
- **Bulgu:** oturum açma ve canlı soket kabulü `AdmissionGate` ile IP başına 30/dk ve her kabulde bir DO yazması. Mobil operatör CGNAT'ı arkasında binlerce gerçek kullanıcı tek IP'yi paylaşır → C ölçeğinde meşru kullanıcı reddi ve gereksiz DO yazmaları.
- Tasarım: (1) Workers Rate Limiting bağlaması (PoP-yerel sayaç, DO gidiş-dönüşü yok) IP + ASN + `/64` IPv6 anahtarıyla; (2) şüpheli trafikte Turnstile (oturum açarken bir kez); (3) WAF hız kuralı `/v1/slots/session` için; (4) `AdmissionGate` yalnız Turnstile'sız yollar için yedek. Hiçbiri sonuç veya ödeme yoluna girmez.

### 4.4 Supabase yazma yolu [TASARIM]
- Bugün spin yolunda veritabanı yazması **yok** (doğrulandı: `slot-wallet.ts` yalnız DO SQLite). Bu doğru yön: oyuncu başına senkron DB yazması C ölçeğinde 250 k yazma/s demektir.
- Gerekirse (raporlama, sorumlu oyun limitleri, denetim): `SlotWallet` turu commit ettikten sonra `ctx.waitUntil` ile Cloudflare Queue'ya `{roundId, game, engineId, bet, cost, payout, at}` (kişisel veri yok) → tüketici Worker 100'lük partilerle Supabase'e `INSERT … ON CONFLICT (round_id) DO NOTHING` (idempotent). Kuyruk kaybı yalnız raporu geciktirir; defterin tek doğrusu DO'dur.
- **Bulgu (sohbet):** `FanoutBucket` alarmı her soketin oturumunu ≤ 60 s'de bir Supabase `verify_chat_session` ile doğruluyor; 16 k soket ≈ 270 RPC/s yalnız canlılık için. Tasarım: kimlik süresine kadar önbellek + oturum iptali için Supabase'ten itme (Realtime/webhook → `RoomCoordinator`), alarmda yalnız süre kontrolü.

### 4.5 Depolama maliyeti bulgusu
Spin başına SQLite satır yazımı ≈ 10 (slot_rounds 1 + 4 dizin, ledger 1, session 1, seeds 1, stats 1–2). Cloudflare'de dizin güncellemeleri de yazılan satır sayılır; bu maliyetin en büyük kalemidir (§10). İyileştirme (yeni şema sürümü olarak, ekonomiye dokunmadan): `slot_rounds_game` dizinini kaldırıp son turu `slot_session`'da tutmak, `slot_rounds_at` yerine bellek içi + `slot_session` sayaçlı hız penceresi, `round_id`'yi rowid'e bağlamak → ~6 yazma/spin (−40 %).

## 5. Ringside LIVE yayılımı

**Bulgu:** her arena tek DO ve **en fazla 256 soket** (`ringside-arena.ts`), 512 oturum. Her değişiklikte (bilet, plan, faz) tam anlık görüntü bütün soketlere; her yeni oturum ve her soket kapanışı da bütün soketlere yayın yapar (katılım fırtınasında O(n²)). Yani bugün küresel olarak en fazla 256 kişi izleyebiliyordu.

### 5.1 Yayın ağacı [ŞİMDİ UYGULANDI, varsayılan kapalı: `LIVE_RELAYS="0"`]
- `GET /v5/arena/ringside/watch` (yalnız okuma): router → rastgele `relay:v5:<k>` (`ArenaRelay` DO, migration `v8`) → hibernasyonlu soket (`acceptWebSocket`; boşta DO bellekten çıkar, soket açık kalır, ücret işlemez).
- Kök arena (`ContactArenaV5`) yaptığı her yayının aynı baytlarını relay'lere iter. Bahis, oturum, bilet ve defter yalnız kökte; relay soketi hiçbir komut kabul etmez (yük testinde izleyicinin bilet çerçevesi bilet üretmedi). v2–v4 arenaları yayın yapmaz (`relayArena()` null), davranışları değişmedi.
- **Geri basınç:** anlık görüntü tam durumdur (`revision` sıralı, idempotent). Kök relay başına yalnız EN SON bekleyeni tutar ve en fazla 250 ms'de bir gönderir (`LIVE_RELAY_MIN_INTERVAL_MS`); relay eski revizyonu atar. Yavaş halka kuyruk büyütmez, ara revizyonları atlar.
- **Geç katılan:** relay'in son anlık görüntüsü hemen gönderilir; soğuk relay kökten çeker (`/relay/sync`).
- **Seyirci varken gösteri sürer:** relay izleyicisi varken 30 s'de bir `/relay/sync` çağırır; kök bunu 90 s boyunca "bağlı biri var" sayar (yeni raunt yalnız izleyen varken açılır kuralı).
- Kapasite: relay başına `LIVE_RELAY_SOCKETS` (varsayılan 2.000), `LIVE_RELAYS` ≤ 256 → tek kademe ≤ 512 k izleyici. 5 M için iki kademe: kök → 32 ara relay → her biri 64 yaprak relay (2.048 yaprak × 2.500 soket). Kodda ara kademe yok [TASARIM].
- Yerel ölçüm (`arena-relay-2000.json`, tek workerd + tek Node istemcisi, başka ajanların tarayıcı testleriyle paylaşılan konteyner): 2.000 izleyici / 4 relay, 42 kök revizyonu; yetişme p50/p95/p99 196/455/641 ms, tam revizyon p99 497 ms, 84.000 izleyici×revizyon çiftinin 3.978'i birleştirmeyle atlandı (yenisi geldi); geç katılan 20 ms. `arena-relay-200-bets.json`: 200 izleyici, 36 gerçek bilet, p99 276 ms. Bağlantı kurulumu yerelde ~11 ms/izleyici (yerel tek süreç).
- Açık: web istemcisi (`use-ringside.ts`) henüz `/watch` kullanmıyor; bahis yapmayan izleyiciyi relay'e, bahis isteyeni köke bağlamak gerekir. Barındırılan ölçüm yok.

### 5.2 Bahis tarafı ölçeği [SAHİP KARARI]
512 oturum / 256 bilet tavanı tek kök defterdedir. Milyonlarca kişinin aynı maçta oynaması için havuz başına shard'lı kabul (ör. 64 kabul DO'su, her biri kendi alt havuzunu tamsayı korunumlu tutar, kesimde kök toplar ve tek seferde dağıtır) gerekir. Bu bir defter/ekonomi değişikliğidir: yeni defter kimliği (`ringside-match-2`) ve ayrı ad alanı ister, eski biletler taşınmaz. Sahip onayı olmadan yapılmadı.

### 5.3 Lobi sohbeti
`FanoutBucket` 8 kova × 256 soket = 2.048 tavan (`FANOUT_BUCKETS` ≤ 64 → 16 k). Tasarım: kova başına 2.000 soket + 256 kova; `RoomCoordinator` → ara kova kademesi. Sohbet gerçek varlık kapısına bağlı olduğundan öncelik düşük.

## 6. Web: önbellek, kod bölme, hız

### 6.1 Önbellek başlıkları [ŞİMDİ UYGULANDI] — `apps/web/public/_headers`
| Yol | Başlık | Neden |
| --- | --- | --- |
| `/_next/static/*` | `public, max-age=31536000, immutable` | içerik hash'li ad |
| `/fonts/*` | aynı | sabit lisanslı dosyalar (next/font hash'li kopya da üretir) |
| `/workers/*` | aynı (**yeni**) | tek tüketici `?v=<sha256>` ile yükler (`build-audio-worker.mjs`) |
| `/audio/*`, `/sprites/*`, `/images/*` | `public, max-age=3600, stale-while-revalidate=86400` (**yeni**; önce `max-age=0`) | adlar sabit, dosyalar yerinde değişiyor (ses dosyaları `/audio/voice/<oyun>/<tr|en>/`) |
| HTML | `private, no-cache, no-store` (doğrulandı: bütün rotalar dinamik) | i18n katmanı her istekte çerez/başlık okuyor (§6.3) |

**Sürümlü varlık URL'leri [TASARIM, ses ajanının dosyalarına dokunur]:** derleme betiği `public/audio|sprites|images` için `asset-manifest.generated.ts` (yol → içerik hash'i) üretir; ses bankaları `setVoiceBank('/audio/voice/ebru/tr')` yerine dosya başına `?v=<hash>` URL'si verir. Bütün tüketiciler geçince bu klasörler `immutable` olur ve tekrar ziyarette ağ isteği sıfırlanır.

### 6.2 Rota başına kod bölme [ŞİMDİ UYGULANDI kısmen]
**Bulgu:** `@sollish/protocol` barrel'ı (`index.ts`) `sideEffects` beyan etmiyordu; bu yüzden her slot rotası Ringside connectome ağırlıklarını ve dövüş motorlarını (connectome-policy 255 KB, reservoir 129 KB, contact-v5-weights 38 KB …) indiriyordu.
**Düzeltme:** `packages/protocol/package.json` → `"sideEffects": false` (modüllerde üst düzey yan etki yok; tek döngü `combat-sparring.ts` kendi nesnesini donduruyor). Davranış, motor ve sonuç değişmedi; protocol testleri geçiyor.

Ölçüm (esbuild metafile, framework hariç, rota koduna özgü; `route-bundles-before.json` → `route-bundles-after-sideeffects.json`):

| Rota | Önce min / gzip | Sonra min / gzip |
| --- | ---: | ---: |
| /game/cascade | 904 / 297 KB | 429 / 139 KB |
| /game/tarhun | 1.037 / 339 KB | 562 / 180 KB |
| /game/ebru | 987 / 325 KB | 511 / 167 KB |
| /game/cezeri | 1.012 / 328 KB | 536 / 170 KB |
| /game/asena | 992 / 326 KB | 517 / 168 KB |
| /verify | 544 / 179 KB | 69 / 22 KB |

Gerçek üretim derlemesi (`build:cloudflare`, düzeltme sonrası, build `JpEUqEHEm4FOYVKBgzfGK`; `first-load-js-after.json`, framework + layout + sayfa, nomodule polyfill 110 KB hariç): `/` 149 KB gz, `/games` 155, slot rotaları 246 (ebru) – 294 (cascade), `/live/ringside` 317, `/verify` 172. Slot rotalarının parçalarında Ringside motor/connectome işareti yok; beş slot motorunun işareti her slot rotasında var (aşağıdaki 1. madde). Önizlemede başlıklar doğrulandı (`preview-ttfb.json`).

**Kalan sızıntı (her slot rotasında ~134–147 KB min, ≈ %26) [TASARIM — dosyalar diğer ajanlarda]:**
1. `lib/rgs-client.ts` yerel kaynak beş motoru da statik çağırıyor ve `SLOT_GAMES` kaydını (motor fonksiyonlarıyla) kullanıyor → ~45 KB min. Çözüm: `createLocalSource(TARHUN_SLOT)` gibi oyun başına motor enjeksiyonu + motorsuz meta kayıt (`slot-game-meta.ts`); her oyun bileşeni kendi tanımını verir.
2. `lib/slot-audio/render.ts` (ana iş parçacığı yedeği) bütün oyunların synth/sfx'ini içe aktarıyor → ~90 KB min. Çözüm: render yedeğini `import()` ile tembel yüklemek ve oyun başına sfx/synth kayıtları.
Bu iki adım slot rotalarını ~290 → ~250 KB gz'ye indirir (tahmin; ölçüm gerekir).

### 6.3 HTML, TTFB ve sayfa ağırlığı (önizlemede ölçüldü, `preview-ttfb.json`)
- **Bulgu 1 — her sayfa dinamik:** `lib/i18n/server.ts` her istekte `cookies()` ve `headers()` okuyor; derleme çıktısında bütün rotalar `ƒ (Dynamic)`, HTML `no-store`. Her sayfa görüntüleme Worker'da React SSR'dir (CPU maliyeti, önbelleklenemez). Tasarım: dili URL'de taşımak (`/en/games`, `generateStaticParams` ile 9 dil × rota önceden üretilir) veya statik kabuk + istemcide dil; sonra salt-okunur `staticAssetsIncrementalCache` ile HTML'i Workers Assets'ten sunmak. i18n ajanının alanı; bu teslimde değiştirilmedi.
- **Bulgu 2 — `/` 307 ile `/games`'e yönleniyor:** ilk ziyarette bir gidiş-dönüş fazla (mobilde 100–300 ms). Tasarım: kökü doğrudan lobi olarak sunmak veya kalıcı (308) yönlendirme.
- **Bulgu 3 — oyun HTML'i ağır:** sıkıştırılmış HTML Tarhun 84 KB, Ebru 101 KB, Cezeri 69 KB, Asena 40 KB, Cascade 33 KB; ham HTML'in 170–550 KB'ı sunucuda çizilmiş satır içi SVG (sembol sanatı ve sahne). Aynı sanat istemci paketinde de var (hidrasyon), DOM düğüm sayısı yüksek → orta segment telefonda ayrıştırma/stil maliyeti. Tasarım: sembolleri bir kez `<symbol>` + `<use>` ile (bazı oyunlarda `*SymbolSprites` zaten var) veya derleme anında rasterleştirilmiş, içerik hash'li WebP/AVIF atlasla çizmek; tahtayı ilk boyamadan sonra istemcide kurmak. Bileşen dosyaları diğer ajanların çalıştığı alanda; ölçüm burada, değişiklik yapılmadı.
- Yerel önizleme TTFB (loopback, sıcak, 20 örnek p50/p95): `/games` 42/64 ms, `/game/cascade` 58/88, `/game/tarhun` 70/106, `/live/ringside` 38/50, ses dosyası 6/17 ms. Barındırılan ve mobil değil.

### 6.4 Cihaz performansı (tasarım)
Hedef cihaz sınıfı: 4 GB RAM orta segment Android. Kurallar: oyun sahnesi tek `requestAnimationFrame` döngüsü, gizli sekmede durdurma (sunum; sonuç/ödeme etkilenmez), `prefers-reduced-motion`, ses worker'da önceden üretim (var), görseller AVIF/WebP + `sizes`, yazı tipi `display: swap` (var). Ölçüm: WebPageTest/Lighthouse mobil profili + gerçek cihazda Performance panel; kanıt yok.

## 7. Cloudflare eşlemesi (özet)
```
Tarayıcı ──HTTPS──► Worker (router, durumsuz, her PoP)
   │                  ├─► SlotWallet DO  (oturum başına; SQLite; spin yolu)      [şimdi]
   │                  │      └─(30 s)─► SlotMonitor shard:k ─(5 s)─► global      [şimdi]
   │                  ├─► SlotReplay DO  (256 önek parçası; paylaşılan turlar)     [şimdi]
   │                  ├─► ContactArenaV5 (kök; bahis/defter; ≤256 soket)           [şimdi]
   │                  │      └─(≤4/s, son değer)─► ArenaRelay ×N ─► izleyiciler    [şimdi, kapalı]
   │                  └─► Queue ─► tüketici ─► Supabase (rapor, toplu, idempotent)  [tasarım]
   └──► Workers Static Assets (_next/static immutable, ses/sprite ETag)            [şimdi]
```

## 8. Kademeli bozulma, kill switch, bölgeler
- Mevcut anahtarlar: `SLOTS_ENABLED` (bütün RGS 503 → istemci "Yerel demo"ya düşer, etiketli), `LIVE_ARENA_ENABLED`, `LIVE_RELAYS` (0 = izleme ağacı kapalı, kök eskisi gibi), `DECISION_AGENT_ENABLED`/`JEV_CALL_BUDGET` (deterministik yedek), `SLOT_MONITOR_SHARDS`.
- Tasarım: oyun bazında anahtar (`SLOTS_DISABLED_GAMES="ebru,asena"` → `410 ENGINE_RETIRED` yerine `503 GAME_PAUSED`, istemci tur başlatmaz; devam eden tur zaten commit edilmiştir), yayın kalitesi düşürme (relay aralığı 250 → 1.000 ms), sohbet salt-okunur modu.
- Bölgeler: DO tek konumda yaşar ve Cloudflare depolamayı çoğaltır; bir veri merkezi kaybında DO başka yerde yeniden başlar (kısa kesinti, veri kaybı yok — barındırılan doğrulama gerekir). Yargı alanı kısıtı gerekirse `jurisdiction: "eu"` ad alanları. Aktif-aktif tek oyuncu cüzdanı yapılmaz (çift harcama riski); oyuncu yapışkanlığı DO kimliğiyle zaten sağlanır.

## 9. Gözlemlenebilirlik ve olay runbook'ları [TASARIM]
- Metrikler (Workers Analytics Engine, kişisel veri yok): uç nokta × oyun × durum kodu sayısı, gecikme histogramı, `SESSION_BUSY`/`RATE_LIMITED` oranı, relay başına soket ve yayın gecikmesi, shard rollup gecikmesi, RTP z-skoru.
- Alarmlar: spin p99 > 150 ms 5 dk; 5xx > %0,5; RTP |z| ≥ 4; relay gecikmesi p99 > 2 s; DO "overloaded" hataları.
- Runbook'lar: (1) RTP sapması → oyunu duraklat, motor kimliğini ve simülasyon kanıtını karşılaştır, ödemelere dokunma; (2) DO aşırı yük → shard sayısını artır, istemci geri çekilmesi; (3) yayın gecikmesi → `LIVE_RELAY_MIN_INTERVAL_MS` artır, relay sayısını artır; (4) Supabase kesintisi → spin yolu etkilenmez, kuyruk birikir; (5) imza anahtarı sızıntısı → `SLOT_SIGNING_KEY` döndür (bütün belirteçler geçersiz, oyuncular yeni oturum açar). Her olay `ops/evidence/` altına zaman çizelgesiyle yazılır.

## 10. Maliyet modeli (milyon spin başına)
Cloudflare Workers Paid liste fiyatları (bilgi kesimime göre; dağıtımdan önce güncel fiyat sayfasından doğrulanmalı): Worker istek $0,30/M, CPU $0,02/M ms; DO istek $0,15/M, süre $12,50/M GB-s; SQLite yazılan satır $1,00/M, okunan satır $0,001/M, depolama $0,20/GB-ay.

| Kalem | Varsayım / spin | $ / 1 M spin |
| --- | --- | ---: |
| Worker isteği | 1 | 0,30 |
| Worker CPU | 3 ms (HMAC, JSON) | 0,06 |
| DO isteği | 1 (+ monitor 1/30 s, ihmal) | 0,15 |
| DO süresi | 15 ms × 128 MB | 0,02 |
| SQLite yazılan satır | ~10 (§4.5) | 10,00 |
| SQLite okunan satır | ~30 | 0,03 |
| Depolama | ~0,6 KB/spin, 1 ay tutma | 0,12 |
| **Toplam** | | **≈ $10,7** (şema iyileştirmesiyle ≈ $6,7) |

İzleyici: hibernasyonlu soket boşta ücretlenmez; yayın başına relay DO isteği + gönderilen mesajlar. Kaba: 1 M izleyici, saniyede 1 güncelleme, 500 relay → saniyede 500 DO isteği ≈ $0,27/saat + çıkış trafiği (Workers'ta ayrı ücret yok). Sayılar tahmindir; barındırılan fatura ölçümüyle doğrulanmalı.

## 11. Yerel yük ölçümleri (özet; ayrıntı `docs/validation.md`)
Tek konteyner (4 vCPU, 16 GB), tek workerd süreci her DO'yu çalıştırır; sayılar platform kapasitesi değil, istek başına maliyet ve eşzamanlılık altında doğruluktur.

| Koşu | Teklif | Kabul tur/s | İlk deneme p50 / p95 / p99 | Nihai hata | Doğruluk |
| --- | ---: | ---: | --- | ---: | --- |
| 50 oyuncu × 1/s, disk | 50/s | 46,6 | 11 / 28 / 33 ms | 0 | 50/50 bakiye, nonce, replay |
| 200 × 3/s, disk (aşırı yük) | 600/s | 56 | 2,8 / 3,7 / 3,7 s (kuyruk) | 0 (104 yerel 500 yeniden denendi) | 200/200 |
| 1.000 × 0,15/s, tmpfs | 150/s | 102 | 3,9 / 7,9 / 8,3 s | 0 | 1.000/1.000 |
| 200 × 3/s, tmpfs (tanı) | 600/s | 163 | 1,2 / 1,8 / 1,8 s | 0 | 200/200 |

Yorum: yerel tavan ~60–200 tur/s, darboğaz tek workerd süreci ve yerel diskte commit başına fsync (tmpfs'te ~3×). Dosyalar: `slot-load-50x1-disk.json`, `slot-load-200x3-disk.json`, `slot-load-200x3-tmpfs.json`, `slot-load-1000x0.15-tmpfs.json`. Barındırılan ortamda her oturum ayrı DO olduğundan tavan DO sayısıyla yatay büyür; bunun kanıtı barındırılan yük testidir (aşağıda).

## 12. Barındırılan doğrulama planı ve onay gerektirenler
1. **[SAHİP ONAYI]** realtime'ın ayrı bir yük ortamına (`sollish-realtime-load`, ayrı Worker adı, DEMO) dağıtımı; `SLOT_SIGNING_KEY` sırrı; `SLOTS_ENABLED=true`.
2. k6/Artillery ile 3 bölgeden 1 k → 10 k → 50 k oturum rampası (`test/slot-load.mjs` mantığı: tek eşzamanlı, idempotent yeniden deneme, sonda defter kontrolü); hedef SLO tablosu.
3. Relay: `LIVE_RELAYS=16`, 3 bölgeden 20 k izleyici soketi; yayılma p99 ve DO ücretleri.
4. Fatura panosundan gerçek $/M spin; §10 güncellenir.
5. Web: `build:cloudflare` önizlemesi + dağıtım sonrası WebPageTest (Moto G Power, 4G) lobi ve beş oyun; LCP/TTFB/JS.
Hiçbiri mainnet veya gerçek varlık içermez.
