# Doğrulama ve açık kabul koşulları

**Ölçek 16 Ekim (yerel, yayımlanmadı; ayrıntı [scale.md](architecture/scale.md), kanıt `ops/evidence/scale-20261016/summary.json`):**
- Birim/tip: realtime 20/20 (yeni: monitor shard dağılımı, relay ayarları ve son-değer/oran sınırlı yayıncı), protocol 302/302, realtime ve web typecheck temiz.
- workerd: `test:slots` 33/33 (RTP sayaçları oturum → `shard:<k>` → global), Contact 5 14/14, Contact v3/v4 16/16, v2 12/12 (yeniden başlatmalı testler bu konteynerde `pnpm exec` SIGTERM iletmediği için asılıyordu; harness artık süreç grubunu kapatıyor).
- Slot yük testi (`pnpm --filter @sollish/realtime loadtest:slots`, üretim router'ı, tek workerd): 50 oyuncu × 1/s disk 46,6 tur/s, ilk deneme p50/p95/p99 11/28/33 ms; 200 × 3/s disk (aşırı yük) 56 tur/s, 104 yerel 500 aynı anahtarla yeniden denendi; 1.000 × 0,15/s tmpfs 102 tur/s. Her koşuda nihai hata 0, bütün oturumlarda bakiye/nonce/idempotent bayt eşitliği, global monitor tur sayısı = kabul edilen tur. Yerel tavan tek süreç + fsync'tir; barındırılan kapasite değildir.
- Ringside relay (`test:relay`): 2.000 izleyici / 4 relay, 40 kök oturum yayını: güncel duruma yetişme p50/p95/p99 196/455/641 ms (250 ms birleştirme dahil), geç katılan 20 ms'de son revizyon, izleyicinin bilet çerçevesi bilet üretmedi, >20 mesaj/dk 1008 ile kapandı. 200 izleyici + 36 gerçek bilet koşusunda p99 276 ms.
- Paket: `@sollish/protocol` `sideEffects:false` ile slot rotalarının rota kodu (esbuild) ~900 KB → ~430–560 KB min (gzip ~300 → 139–180 KB); Turbopack üretim derlemesinde slot rotası ilk yük JS 241–289 KB gz, connectome işareti yok. Kalan sızıntı ~134–147 KB min/rota (diğer motorlar + diğer oyunların synth/sfx'i) tasarımda.
- Açık: barındırılan yük testi, çok bölge, telefon LCP/fps, web istemcisinin `/watch` kullanımı, HTML önbelleği (§6.3). `LIVE_RELAYS="0"`; dağıtım sahip onayı bekler.

**Sunucu doğrulamalı slot servisi (RGS, 12–13 Ekim, yayımlanmadı, `SLOTS_ENABLED=false`):** yerel workerd `test:slots` 30/30 kontrol (eşzamanlılık, idempotency, çakışan anahtar, geçersiz bahis/mod/maliyet, yetersiz bakiye, hız sınırları, belirteçsiz/sahte belirteç, SQLite hata geri alma, yeniden başlatma kurtarma, tohum dönüşümü + Node ile yeniden hesap, imza, paylaşım kaydında gizli alan yok); realtime birim 17/17, protocol `slot-fair` 6/6 (Python hmac bilinen cevap vektörleri), web birim 245/245, üç typecheck temiz; tarayıcı (next dev + yerel workerd) `rgs-remote.spec.ts` 2/2, yerel mod regresyonu cascade+tarhun 40/40 (2'si yük altında uzatılmış zaman aşımıyla). `test:integration` 1000 soket 16/16. `test:arena:stress` yoğun CPU altında zaman aşımına düştü; yüklediği `live-arena.ts` değişmedi. [Kanıt](../ops/evidence/slot-rgs-20261012.json), [mimari](architecture/slot-rgs.md). Barındırılan ortam, `SLOT_SIGNING_KEY` sırrı, yük testi ve sertifikalı RNG yok; gerçek varlık kapıları kapalı.

**Candy Cascade v2 ekranı (11 Ekim, yayımlanmadı):** web birim 186/186, typecheck temiz, tarayıcı (next dev) `cascade.spec.ts` 16/16 ve regresyon 23/23 (product, solo-lifecycle, demo-entropy). [Kanıt](../ops/evidence/candy-cascade-2-20261011/web.json). Cloudflare önizlemesinde, telefonda ve barındırılan ortamda koşmadı; kullanıcı görsel/işitsel kabulü yok.

**Ringside maç defteri (9 Ekim gece, yayımlanmadı):** protocol 128/128, workerd v5 14/14 (+ v3/v4 16, v2 12), realtime 11/11, web 38/38, tarayıcı (next dev) ringside 7/7 ve ürün 14/14 (WCAG dahil), readiness exit 2. [Kanıt](../ops/evidence/ringside-match-20261009.json). Cloudflare derlemesinde ve barındırılan ortamda koşmadı.

**Güncel Ringside Lab v2 (2 Ekim):** [v2 raporu](releases/ringside-neuroarena-demo-2026-10-02.md), 50 tarayıcı testi ve ayrı gerçek SQLite/havuz testleri. Connectome veri incelemesi öğrenilmiş beyin doğrulaması değildir.

**Önceki Ringside/SOLO/LIVE kabulü (2 Ekim):** [sürüm raporu](releases/ringside-live-demo-2026-10-02.md). Aşağıdaki tarihli önceki yayın/33 test kayıtları tarihsel kanıttır; yeni ortak demo ve modellerin kabulü ayrı rapordadır.


Tarih:1 Ekim2026. Yerel macOS ARM testleri, gerçek Cloudflare workerd runtime'ı ve yetkili Debian ARM VPS kullanıldı. Yerel test başarısı canlı devnet, küresel kapasite, bağımsız audit veya üretim onayı değildir.

## Sözleşmeler

`bash scripts/test-contracts.sh` son tam çalıştırması başarılı:

| Bölüm | Geçen test |
| --- | ---: |
| Oyun matematiği | 11 |
| Ödül matematiği | 13 |
| House SBF/LiteSVM | 27 |
| Coinflip + faz/saatlik ödül SBF/LiteSVM | 39 |
| Staking SBF/LiteSVM | 13 |
| **Toplam** | **103** |

House/games/incentives ve yerel mock programları SBF olarak derlendi; üç Anchor IDL üretildi. Clippy `-D warnings`, rustfmt ve generated-client IDL eşleşmesi geçti. Kanıt: `.tooling/contracts-final.log`, `target/deploy/artifacts.sha256`, `target/idl/`.

Kapsam: escrow/azami rezerv, yetkisiz CPI ve hesap değiştirme, nonce/replay, çift ödeme, başarısız CPI rollback, kalıcı haklar ve rent, gerçek SPL/Token2022 transferleri, staking ayrık anapara, phase bütçesi, saat sınırları/clock gerilemesi, pro-rata eşik ve hacim overflow. Mock VRF yalnız yerel ABI fixture'ıdır.

`apps/worker/test/fixtures/litesvm-*.json` kayıtları actual SBF işlem loglarıdır. İlk ödülsüz wallet transaction'ı (ComputeBudget + iki kalıcı hesap + bahis)728byte/140.334CU; settlement+close524byte/71.916CU. Sabit oyuncu/PDA ve mockoracle'a ait örnektir; gerçek sağlayıcı maliyeti değildir. Keeper otomatik close uygulamaz.

19:39UTC ek opt-in **Games + gerçek provider SBF6/6** test geçti; Clippy `-D warnings` ve rustfmt başarılı. Root House/Games yeniden build edildi ve önceki hash'leri korudu. Gerçek request/scoped callback/proof, kazanma ve kaybetme ödemesi, rent/nonce/replay, provider pause ve160kCU yetersiz bütçede rollback doğrulandı. Son kanonik ölçüm: ilk wallet99.005CU/728byte;120/4.800 kısa fixture kaydında102.202/223.167CU; callback33.741CU, settle+close kazanmada83.915CU/kaybetmede83.381CU. İstemci300k sınırı değiştirilmedi. [Kanonik kanıt](../experiments/vrf-recovery/games-provider-evidence.json) ve [ayrıntılı kapsam](coinflip.md).

Queue başlangıcı ve oracle/saat kimlikleri yerel fixture; callback için request açıkça test oracle queue'suna taşınır. Transaction imzaları ve gerçek provider Ristretto doğrulaması çalışır; Games/House hesapları READY/settled yapmak için değiştirilmez. Canlı oracle teslimatı, deployed provider bytecode eşitliği veya küresel throughput kanıtlanmaz. Gerçek purge sonrası `Awaiting` bahis ve house rezervinin kilitli kaldığı ayrıca doğrulandı; production recovery kapısı hâlâ açıktır. Bunlar103 testlik root toplamına dahil olmayan altı ek deney testidir.

Yeni opt-in bağımlılıklar yalnız deney Cargo.lock dosyasına girdiğinden mevcut recovery deneyinin35 testi de kanonik `run-local.sh` ile yeniden çalıştırıldı;35/35, Clippy ve fmt geçti. Yeni test/log/Cargo.lock ve root ELF hash'leri rapora karşı ayrıca doğrulandı. Ayrı recovery deneyinin başarısı ana Games programına kurtarma eklemez.

## JavaScript, veritabanı ve realtime

`pnpm typecheck`, `pnpm test`, `pnpm idl:check` bütün workspace üzerinde çalıştırılır. SDK; BigInt/u64, program/PDA/discriminator, token extension, snapshot slot, simulation, imza/mesaj bağlama, eksik metadata ve belirsiz wallet gönderimini sınar. Web testleri demo/gerçek işlem ayrımı, public takip kaydı ve token sayı dönüşümünü kapsar.

Son workspace çalıştırması: **98/98 test geçti**, atlanan test yok. Dağılım: protocol3, onchain SDK45, realtime4, web24, worker22. Bütün paketlerin typecheck'i geçti. Kanıtlar: `.tooling/ringside-workspace-tests.log`, `.tooling/ringside-workspace-typecheck.log`. Önceki IDL eşleşmesi kayıtlıdır; bu turda sözleşme/IDL değiştirilmedi.

Keeper regresyonları bekleyen işlem ücretlerini minimum bakiyeden düşmeyi, finalized banka slotunu journal'da saklamayı ve eksik/bozuk simulation veya status yanıtında gönderim yapmamayı kapsar. Process testi gerçek paket dosyasını iki seviyeli symlink üzerinden çalıştırır; kapalı durumda health503, bilinmeyen route404 ve SIGTERM temiz çıkışı doğrular.

`supabase/tests/local-postgres.sh`:son çalıştırmada41 SQL assertion; RLS/rol yetkileri, gerçek hosted biçimiyle nested wallet identity, bozuk/missing claim tipleri, taze indeks, kayan60dakika, idempotent mesaj/chain fact/outbox. İlk26 assertion'a15 kimlik regresyonu eklendi. Ek gerçek PostgreSQL yarışı:200 eşzamanlı commit,600 snapshot,1.200 sıra/boyut assertion. Yerel Auth tabloları shape fixture'ıdır; aşağıdaki hosted Supabase Auth testi ayrıca yürütüldü.

`apps/realtime/evidence/local-workerd.json`:1.000 kimliği doğrulanmış native WebSocket,8DO bucket,16 protokol kontrolü.10:26:54UTC ölçümünde auth batch6.190ms, tek olay fanout p50=58ms/p95=88ms/max=91ms. Yerel ES256/JWKS/Auth/DB fixture; yayımlanan tek sentetik chat olayı. Bozuk kimlik, origin, session expiry, reconnect, gap/duplicate, body limiti ve snapshot/publish yarışı sınanır. Hosted Supabase, farklı bölgeler, uzun süreli yük ve zincir işlem TPS'si ölçülmedi.

## Web ve paketler

Next16.3.8/React19.3.0 üretim derlemesi ve OpenNext1.20.7 Cloudflare paketi üretildi. Gerçek workerd önizlemesi localhost3001'de çalıştırılır. Wallet/Solana/Auth kodu ihtiyaçta yüklenir, fontlar yerel WOFF2'dir. Otomatik erişilebilirlik testi manuel tüm WCAG uyumluluğu garantisi değildir.

Son üretim tarayıcı testi **14/14 geçti** (10:50:55UTC; build `9d_FozpKhvkO9zJ6EnH35`). Dört ekranın390/1440px axe taraması ve cüzdan penceresinde bulgu yok.320–1440px yerleşim,44px mobil dokunma alanı, hızlı miktar butonlarının sınırları, klavye odağı, reduced-motion,200% eşdeğer reflow ve sabit manuel cash-out sınandı. Fiziksel telefon/OS zoom testi ve yapılandırılmış devnet RPC+cüzdan işlemleri bu kapsamda yapılmadı.

Başlangıç JavaScript toplamı **175.799byte (171,7KiB) gzip**, cüzdan açılışındaki ek kod3.137byte (3,1KiB). Ölçüm yerel üretim HTTP yanıtlarının Node gzip ile yeniden sıkıştırılmasıdır; gerçek CDN transferi veya Core Web Vitals sonucu değildir. Kanıtlar: `.tooling/web-qa-final.json`, `.tooling/web-js-measurement.json`, `.tooling/web-screenshots/`.

### Hosted Cloudflare doğrulaması

Kullanıcının açık onayıyla resmi Wrangler'a yalnız User Read, Account Read, Workers Scripts Write ve Background Access verildi. Web `1b3e3e1f-2f99-42e3-a9ff-ac5e5844a95d`, realtime `4677b26c-c4ca-4c16-ad18-509a8353aebd` sürümleri yayımlandı. Web adresi: `https://sollish-web-devnet.sollish-web.workers.dev`; API: `https://sollish-realtime.sollish-web.workers.dev`.

Yeni workers.dev alt alanında ilk deneme TLS sertifika yayılımı sırasında bağlantı hatası verdi; sertifika kontrolü kapatılmadı. HTTPS200 alındıktan sonra aynı14 tarayıcı testi **14/14 geçti (12,5s)**. HTTP güvenlik başlıkları doğrulandı. Log: `.tooling/web-browser-cloudflare.log`; ekran: `.tooling/cloudflare-web.jpg`.

İlk hosted realtime dağıtımında **7/7 kapalı durum kontrolü** geçti: health503; oyun/chat/ödül kullanılabilirliği false; kesin origin CORS; yabancı origin403; boş geçmiş503; imzasız publisher403; WebSocket upgrade503; izinli preflight204. Bunlar7 test içinde gruplanır. Bu ilk ölçümde secrets/DB henüz eklenmemişti. Kanıt: `.tooling/cloudflare-realtime-smoke.json` (13:39:41UTC). Aşağıdaki managed entegrasyon kaydı daha güncel durumdur.

### Managed Supabase ve uygulama bağlantısı

Supabase ve Cloudflare MCP erişimleri çalışır durumda doğrulandı. Solgamb organizasyonunda ücretsiz (MCP teklifinde0USD/ay) **Sollish Devnet**, Frankfurt `eu-central-1` bölgesinde oluşturuldu: `lutwdmwkogtzajxvbuiy`, durum `ACTIVE_HEALTHY`. Önce boş veritabanı denetlendi;26 yerel SQL assertion ardından `backend` migration'ı MCP ile uygulandı. Remote sürüm `20261001183459` ile yerel migration adı eşleştirildi; SQL hash'i değişmedi. Sekiz özel tabloda RLS açık ve istemci tablo yetkileri kapalı; yalnız iki sınırlı genel okuma RPC'si açık. Advisor istisnaları [backend rehberinde](backend.md) açıklanır.

Canlı Data API üzerinde8 kontrol yapıldı: iki genel okuma RPC'si modern publishable anahtarla hem yalnız `apikey` hem uygulamanın mevcut eşleşen `Bearer` biçiminde200/aynı sonuç verdi. Özel şema406, worker RPC401 ile reddedildi; public JWKS ES256 ile uyumlu. Public Auth settings Web3 durumunu yayımlamadığından burada açık/kapalı sonucu çıkarılmadı. Kanıt: `.tooling/managed-supabase-public-check.json`.

İlk fonlanmamış test cüzdanı SIWS isteği **422 / `web3_provider_disabled`** döndürdü; bu tarihsel başarısızlık `.tooling/siws-preflight/report.json` içinde korundu. Sonra kullanıcının belirttiği mevcut Brave oturumuyla Solana sağlayıcısı açıldı; site URL `https://sollish-web-devnet.sollish-web.workers.dev`, tek redirect kuralı aynı hostta `/**` olarak kaydedildi. Ethereum açılmadı. Mevcut server secret çıktıya yazılmadan yerelde0600 dosyaya alındı ve Cloudflare'a MCP ile yüklendi. Public web config'ine server secret eklenmedi.

Cloudflare realtime'da `SUPABASE_URL`, modern `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ve32byte rastgele HMAC anahtarının hex gösterimi `PUBLISH_SIGNING_KEY` artık mevcut. Kesin origin ve8DO bucket korundu. Server secret öncesi7 kısmi kurulum kontrolü `.tooling/cloudflare-managed-partial-check.json` içinde tarihsel kanıttır; ilk Python JSON dışı yanıt denemesi bu başarı sayısına katılmadı. Son bağlantı kontrolünde server-only read RPC200, hosted chat history200/seq0/boş events doğrulandı (`.tooling/managed-server-connection-check.json`).

Gerçek başarılı SIWS girişinde yerel fixture hatası ortaya çıktı: Supabase `chain/address` alanlarını üst seviyede değil `identity_data.custom_claims` altında üretir. İlk şema uyumsuzluğu denemesi oturumunu logout ile kapattı; kanıt `.tooling/siws-hosted-configured-20261001-01/` içinde korundu. `20261001190258_siws_nested_claims.sql` yalnız bu okuma yolunu ve JSON object/string tip kontrollerini düzeltir; ilk migration değişmedi. Gerçek PostgreSQL41/41, bağımsız kaynak/kod incelemesi ve hosted owner/ACL/search_path önce-sonra eşitliği doğrulandı. Kanonik test logu `.tooling/siws-nested-local-sql-canonical.log`.

**19:03:13–18UTC hosted Auth/WebSocket8/8 kontrol geçti:** SIWS200; gerçek ES256 imzası, issuer/audience/role/session/expiry ve canlı Auth user eşleşmesi; doğru immutable nested Solana identity; yabancı origin403; bozuk JWT `AUTH_INVALID`; geçerli oturumla doğru cüzdan ve boş snapshot; mesajın `CHAT_UNAVAILABLE` ile reddi; kendi oturumunu logout204; eski token'ın hem mevcut socket resume hem yeni bağlantıda reddi. Son DB okuması1 test kimliği/1 wallet binding,0 aktif session,0 chat/chain fact/outbox gösterdi.6 HTTP/4WebSocket/1login/1logout,0 zincir işlemi,0 sahte bahis kaydı. [Sanitize hosted raporu](../ops/evidence/hosted-auth-20261001.json). Gerçek bahisle `CHAT_INELIGIBLE` veya başarılı chat/outbox yayını henüz sınanmadı; health503 bu eksik indeks/ayar durumunu yansıtır.

Son Advisor taraması aynı8 özel RLS/policy INFO ve iki genel okuma RPC'sinin anon/authenticated için toplam4 kasıtlı SECURITY DEFINER uyarısını koruyor. Ek `auth_leaked_password_protection` uyarısı mevcut; bu çalışma parola girişini değil SIWS akışını doğruladı. Advisor sonucu sıfır uyarı veya genel üretim güvenliği onayı olarak sunulmaz.

Web public Supabase/realtime ayarlarıyla yeniden derlendi ve `6212d442-2122-4d24-9f21-af43b23234ee` sürümü yayımlandı. Hosted build `UAna6VgAb-vWl6kgnZdH8` yerel artifact ile eşleşti;18 web birim testi ve14 hosted tarayıcı testi geçti. Bu son14 test araç çıktısı ve `.tooling/web-browser-results/.last-run.json` ile doğrulandı; eski `.tooling/web-browser-cloudflare.log` güncel koşunun logu değildir. Coinflip/incentives bayrakları false. Finansal oyun kabulü, gerçek bahis koşulu ve başarılı chat yayını henüz tamamlanmış sayılmaz. [Sanitize edilmiş kurulum özeti](../ops/evidence/managed-backend-20261001.json) anahtar veya token içermez.

Üretim bundle'ında üçüncü taraf bignum kodundan `-0 === value` esbuild uyarısı bulunuyor; uygulama finansal hesaplarında floating point kullanılmaz. Prod bağımlılık taraması1moderate/0high/0critical; açık `stream-json` bulgusunun erişim analizi [bağımlılık incelemesindedir](dependency-review.md). Uyarı gizlenmez.

### RINGSIDE ve son web kabulü

**20:21UTC** son web deployment'ı `39ff9f3b-9839-49a3-a5e7-0bfc4465a340`; build `5UGyERrkht7uJcXHgTddZ`. Cloudflare MCP100% dağıtımı, hosted HTTP200/build eşitliği ve güvenlik başlıklarını doğruladı. [RINGSIDE](https://sollish-web-devnet.sollish-web.workers.dev/game/boxing) KOR/AYAZ karakterleriyle **yerel kredi demosudur**; yeni canlı bahis programı dağıtılmadı. Coinflip/incentives bayrakları false; public API oyun/chat/reward durumları kapalıdır. [Kalıcı, kaynak hash'li kanıt](../ops/evidence/ringside-20261001.json).

98/98 workspace testi,28/28 operasyon testi ve son hosted paket üzerinde **33/33 tarayıcı testi** geçti (2,5dakika). İlk üretim paketinde33/33 yerel test; son grafik kaynak temizliği düzeltmesinden sonra ilgili11/11 test workerd üzerinde yeniden geçti. Bunlar ayrı koşulardır; yeni sözleşme/audit testleri olarak toplanmaz. Loglar `.tooling/ringside-{workspace-tests,operations-tests,production-browser,final-production-browser,hosted-browser}.log`.

Boks testleri gerçek WebGL, iki kamera, nav/unmount, çift tıklamada tek sonuç, miktar/seçim kilidi, kazanç/kayıp kuruşları, reduced-motion, WebGL yokluğu ve maç sırasında gerçek context kaybını kapsar. Ek lifecycle testleri RNG/UUID hatasında kredinin korunmasını, aynı oturumda yeniden oynamayı, süre öncesi Back iadesini ve süre sonrası sonucun korunmasını sınar. Aynı rastgelelik hatası düzeltmesi Crash/Coinflip'e uygulandı; dört hata→yeniden deneme browser kontrolü geçti. 320/390/768/1024/1440px düzenleri,44px temel kontroller ve390/1440px axe taraması geçti. Gerçek 3D idle, ring kenarı, dövüş ve bitiş görüntüleri incelendi; fiziksel telefon veya tam manuel WCAG kabulü yapılmış sayılmaz.

Three.js yalnız boks rotasında ayrı chunk olarak yüklenir; nav prefetch'i bu rota için kapalıdır. Hosted HTTP yanıtlarının Node gzip yeniden sıkıştırması: Crash175.958byte, Ringside toplam324.380byte; boksun iki ek chunk'ı148.422byte. Bunlar CDN transferi/Core Web Vitals sonucu değildir. Son yerel Chromium ANGLE Metal/M2,1440×1000,DPR1 ölçümünde ilk sahne970ms,5s örnekte29,91fps, p95frame aralığı34,3ms, yaklaşık10MB JS heap; mobil garanti değildir. SPA çıkışında canvas0, instance tamponları65/65 açıkça silindi ve context kapandı. Renderer'a ait diğer kaynakların tamamının explicit delete sayacında görünmesi beklenmez; GPU byte profili ölçülmedi. Yerel benchmark'taki iki konsol hatası localhost→hosted chat CORS reddidir; hosted görsel koşuda sayfa hatası yoktur. Kanıtlar `.tooling/boxing-performance-v2/metal.json`, `.tooling/boxing-review/report.json`.

Yeni `check:readiness` kontrolü dört çekirdek kanıt kaydını tutarlı buldu; dokuz üretim kabul koşulunu **BLOCKED** tutar. Boş/eksik/tekrarlı PER gözlemleri ve hash kayması reddedilir. Operasyon toplamına10 yeni negatif/pozitif kontrol eklendi. [Çekirdek hazırlık kaydı](../ops/evidence/core-readiness-20261001.json) ağdaki gizliliği veya ödeme hazır oluşunu onaylamaz. Açıklanmış gerçek VRF çıktısının iki encoding'de tanındığı ek salt okunur kontrol [özgün oyunlar belgesinde](original-games.md) kayıtlıdır; geçmiş36 ayrıştırılamayan gözlem PASS yapılmadı.

## VPS

Debian13.7 ARM64,6CPU/~8GB RAM üzerinde resmi checksum ile Node24.21.0 kuruldu. Bundle hash'i SCP sonrası yeniden doğrulandı. Symlink üzerinden servis başlatma hatası gerçek dağıtımda yakalandı; guard düzeltildi, source+bundle regresyon testi eklendi ve servis yeniden dağıtıldı.

`systemctl is-active` = active; servis kullanıcısı `sollish-worker`, `ProtectSystem=strict`, `NoNewPrivileges=yes`. SadeceSSH22 dışarıya, sağlık8790 yalnız127.0.0.1'e bağlı. Bulut config'i yokken health503/`configured:false` ve keeper disabled. Bu devnet index/ödeme servisi hazır demek değildir; süreç güvenli kapalı durumdadır. Paket startup ve SIGTERM temiz çıkış testi geçti.

Managed kurulum sırasında VPS ortamına yalnız realtime adresi, Cloudflare ile ortak yayın HMAC anahtarı ve açık `KEEPER_ENABLED=false` eklendi. Önceki env sahibi dışında okunamayan yedekle korundu; atomik yeni dosya0600. Servis yeniden başlatıldı: active, sağlık yanıtı hâlâ `configured:false` / `ready:false`; DB ve doğrulanmış oyun deployment bilgileri olmadan indexer/keeper etkinleştirilmedi.

### Hosted DB'nin VPS servis hesabından kabulü

Sonraki adımda `sollish_worker` ayrı yüksek entropili SCRAM parolası ve beş bağlantı sınırıyla LOGIN aldı; migration'ın beş dar fonksiyon yetkisi genişletilmedi. VPS ortamına doğrudan IPv6/5432 DB URL, devnet RPC ve doğrulanmış resmî Supabase CA eklendi. İlk servis kullanıcısı denemesi, root0700 dizinindeki sertifikayı okuyamadığı için `CA_NOT_LOADED` ile bağlantı kurmadan durdu. CA `/etc/sollish-ca/` root0755 dizinine taşındı; sertifika root0644, gizli dizin root0700 ve env root0600 kaldı.

**19:32:44UTC gerçek VPS Node24.21.0 / sollish-worker kullanıcısı altında12/12 kabul kontrolü geçti:** kesin proje/host/port/rol, başlangıçta CA yüklenmesi, doğrulanan TLS, ayrı ayrıcalıksız LOGIN, rol üyeliği yokluğu, read-only transaction, beş fonksiyon yetkisi, özel/auth tablo yetkilerinin yokluğu, gerçek özel/auth SELECT reddi, boş cursor okuyabilme ve aynı oturumda advisory lock alma/bırakma. Hatalı SELECT'ler `WHERE false` ve savepoint kullanır; beklenmedik erişimde dahi satır verisi yazdırılmaz. Her deneme rollback ve bağlantı kapatma uygular. [Kalıcı kabul kanıtı](../ops/evidence/managed-db-vps-20261001.json).

Son MCP kontrolü0 chain fact,0 chat,0 outbox,0 aktif Auth oturumu ve0 kalan probe bağlantısı gösterdi. Servis active; `configured:false`, `ready:false`, keeper kapalı. DB bağlantısının geçmesi zincir indeksini hazır yapmaz: gerçek House adresi ve finalized Games ProgramData hash'i henüz yoktur. Bu turda worker22/22 yeniden geçti; yeni planner11 + DB probe7 = **18/18 operasyon testi** geçti ve `Verify/application` CI tanımına eklendi. Uzaktaki GitHub CI çalıştırılmadı.

### Devnet deployment bütçesi ve faucet sonucu

19:27:48UTC finalized ölçümünde payer0,457510728 test SOL; House/Games hesapları henüz yok. Exact-size upgradeable-v3 için kalıcı rent3,334075120;10m lamport toplam ücret tavanı ve100m rezervle sıralı CLI planı3,444075120 test SOL, açık2,986564392 test SOL. House bankroll'u, oyun hesapları ve oracle ücretleri hariçtir. CLI final deployment'ta buffer bakiyesini yeniden kullanır; buffer'ı ikinci kez ekleyen eski üst sınır zorunlu maliyet değildir. [Plan ve varsayımlar](devnet-deployment.md).

19:17UTC resmi devnet RPC'ye tek2 test SOL airdrop isteği `-32603` hatası döndürdü; imza alınmadı ve sonraki finalized bakiye artmadı. Resmî Solana rehberinin yönlendirdiği PoW faucet'inde23 canonical spec salt okunur incelendi:21 kaynak boş; kalan kaynakların ödül/bakiye ve receipt-rent/ücret dengesi bu deployment'ı karşılamıyor. Mining, claim imzası veya para gönderimi yapılmadı. [Salt okunur faucet kanıtı](../ops/evidence/devnet-pow-feasibility-20261001.json). Bu ölçüm faucet'lerin ileride fonlanamayacağını söylemez.

**20:26UTC** bir saatten uzun aradan sonra pinned devnet genesis doğrulanarak aynı adrese tek2 test SOL isteği daha gönderildi. Resmî RPC yine `-32603` döndürdü; imza yok, otomatik yeniden deneme yok. Önce/sonra finalized bakiye457.510.728lamport ile aynı kaldı. [Son faucet ve bakiye kaydı](../ops/evidence/devnet-funding-recheck-20261001.json). Mevcut sıralı House/Games deployment planındaki2,986564392 test SOL açığı kapanmadı.

Son dağıtılan worker SHA256: `f8dbc7516c4846f9ae7f90f64ebdff431b7bc01ab5a1d56dbb0b63fa5392ffb0` (1.687.945byte). Dağıtım tekil kilit, candidate unit doğrulaması, artifact+unit+servis durumunu geri alma ve yapılandırılmış serviste `ready:true` şartını içerir. Güncellenen betikle gerçek olumlu dağıtım geçti. 14:35UTC tek kontrollü negatif deneyde, aynı betiğin byte-identical kopyası yanlış service kimliği veren fixture uygulamasını dağıttı. Gerçek sağlık kontrolü adayı reddetti;50,842s sonunda exit1 ve otomatik rollback görüldü. Önceki artifact/unit/env hash'leri, active/enabled durumu ve503 kapalı sağlık yanıtı birebir geri geldi. Manuel kurtarma gerekmedi. `.tooling/worker-rollback-probe/result.json` ve [operasyon kaydı](operations.md) kanıttır; ilk kurulum, restart arızası veya yapılandırılmış DB/keeper rollback'i bu deneyin kapsamı değildir.

## Önceki deneyler ve güncel dış engeller

PER Node istemcisi82 testi bu çalışmada tekrar geçti. Saf testler açıkça etiketli sentetik ELF fixture'ıyla gerçek `target` veya özel anahtar gerektirmeden çalışır. Ayrı `npm --prefix experiments/per run test:artifacts` kontrolü gerçek292.384byte yerel ELF/source/IDL/lock eşleşmesini1/1 doğruladı; eksik gerçek dosyada üretim yükleyicisi hâlâ reddeder. `test:clean`82/82 ve ayrı uygulama kaynak kopyası92/92 geçti. Önceki bağımsız PER probe10VM+5host+3IDL ve ayrı VRF recovery35test kanıtları kendi deney klasörlerindedir; bu rapor bunları canlı PER kanıtı olarak saymaz.

PER istemcisinde işlem öncesi ücret tavanı, fsync günlüğü, yerel imzayla RPC imzası eşleştirmesi ve açık `err:null` onayı uygulandı. Belirsiz gönderim yeniden imzalanmaz. Açık `resume-initialized` modu yalnız üç finalized başlangıç işleminin Ed25519 imzası, canonical talimatı, WAL mesaj özeti ve değişmemiş hesap durumu birlikte doğrulandığında aynı turdan devam eder; sonraki aşamalara otomatik kurtarma uygulanmaz. RPC/auth/okuma istekleri origin başına600ms aralıkla sıralanır. Canlı QFS login yalnız token döndürdüğü için süre JWT içinden yalnız yerel zamanlama amacıyla okunur; oturum en fazla30dakika, kimlik/attestation kanıtı değildir. Üç deney kimliğinin canlı girişleri14:19UTC geçti. Auth ve TEE program kopyası kontrolleri ilk L1 hesap oluşturmasından önce yapılır. Kanıtlar `.tooling/per/tests-clean-resume.log`, `.tooling/per/tests-artifact-final.log`, `.tooling/per/participant-auth-preflight.json`.

### Canlı PER turu: sınırlı deney tamamlandı

14:47:24–14:49:45UTC `resume-initialized` çalıştırması aynı round üzerinde tamamlandı. Üç başlangıç işlemi yeniden gönderilmedi; ardından üç delegation, private permission, scoped VRF isteği/callback, iki oyuncu komutu ve reveal çalıştı. [Canlı rapor](../experiments/per/evidence/probe-resume-initialized-latest.json) **22 sınırlı PASS,10 BLOCKED** kontrol içerir; `runOutcome=COMPLETED_LIMITED_EXPERIMENT`, genel `status=BLOCKED` ve `productionApproval=false` kalır.

İki gerçek oyuncu işlemi private round'u readonly kullanarak ayrı receipt'lerde nonce/count1 üretti.95 HTTP gözlemi toplandı.71 doğrudan eşleşme taramasında sonuç baytları bulunmadı;36 VRF türetme denemesinin tamamı eksik/geçersiz mesaj header'ı nedeniyle çözümlenemedi ve kullanılabilir scoped candidate üretmedi. Bunlar107 başarılı gizlilik testi değildir. Altı yetkisiz round okuması HTTP200/null verdi; null yanıtları gizlilik kanıtı sayılmadı.16 simülasyonun tamamı geçti:8 readonly ve8 writable-promoted. Anonim RPC sorguları da oyuncuların geçerli işlem imzalarını taşıdı; writable yükseltmenin reddedildiği iddia edilmez. Probe gizli randomness'a göre bahis sonucu üretmediği için gerçek Crash'te simulation sonucunun gizli eşiği açığa çıkarma riski ayrıca sınanmalıdır.

[14:51UTC salt okunur son kontrol](../experiments/per/evidence/own-probe-final-readback.json), altı L1 işleminin finalized/err:null olduğunu; beş TEE işleminin kendi RPC'sinde finalized/err:null raporlandığını doğruladı. TEE finalized, L1 oyun ödemesi veya commit kanıtı değildir. Reveal sonrası anonim okuma beklenen state4'ü ve iki receipt'i döndürdü; sonuç hash'i raporla eşleşti. Payer457.510.728lamport, iki oyuncu ayrı ayrı21.408.600lamport finalized devnet bakiyesine sahipti. Bu çalışmada mainnet kullanılmadı.

Bağımsız beklenen TEE ölçümü ve quote→validator→program bağı, streaming/WebSocket filtreleri, kendi VRF isteğinin uçuş sırasındaki görünürlüğü, kesinti/upgrade davranışı, gerçek cash-out sıralaması ve L1 ödeme bağı hâlâ açık kabul koşullarıdır. Inspector bilerek private state'i okuyabilir; operatörden gizlilik kanıtı yoktur. Bu deney Coinflip oracle deployment'ını veya hazır bir Crash protokolünü doğrulamaz.

Temiz web kaynağında Next route tipleri `next typegen && tsc --noEmit` ile üretilir. Geçersiz sayfa export'unu çıplak tsc'nin gözden kaçırdığı, yeni komutun reddettiği ayrı fixture ile doğrulandı; workspace typecheck yeniden geçti. GitHub uzaktan CI çalıştırması henüz yoktur. Standalone PER dependency taraması workspace sonucundan ayrıdır; kalan iki duyurunun kapsamı [bağımlılık incelemesinde](dependency-review.md) açıklanır.

| Canlı kapı | Mevcut durum |
| --- | --- |
| Supabase managed proje/Auth | Frankfurt ACTIVE_HEALTHY; iki migration,8 özel RLS tablo,41 SQL assertion. Brave üzerinden Solana/site URL ayarları tamam; gerçek SIWS/JWT/identity ve oturum iptali doğrulandı |
| Cloudflare deployment | Web24 unit+33 hosted browser geçti; Ringside 3D demo yayında. Realtime4 binding tamam; hosted Auth/WebSocket8/8 geçti. Gerçek index/bahis tabanlı başarılı chat/outbox ve bölgesel yük testi bekliyor |
| Devnet fonlama ve probe | Ücretsiz2 devnet SOL alındı. Kendi probe finalized olarak dağıtıldı;292.384byte SBF, canonical ProgramData/authority ve TEE kopyası eşleşti. Dağıtım maliyeti1,488567680SOL. Aynı turda scoped VRF callback, iki oyuncu komutu ve reveal tamamlandı; kapsamlı gizlilik/attestation/ödeme kabulü açık. [Kanıt](../experiments/per/evidence/own-probe-deployment.json) |
| Canlı Coinflip oracle | Yerel scoped callback geçti; program deployment + gerçek VRF round trip yapılmadı |
| Canlı staking/airdrop | SBF transfer testleri geçti; ağda mint/pool/phase fonlama yapılmadı |
| Zorunlu manuel Crash | Browser demo var; PER gizlilik, kabul sıralaması ve L1 ödeme bağı geçmedi; canlı işlem kapalı |
| Mainnet/token launch | Başlatılmadı; audit, sağlayıcı/işletme kapsamı, bütçe ve ayrı karar gerekir |

GitHub Actions ve Dependabot tanımları hazırdır; checkout'ta remote veya çalışmış GitHub CI run'ı yoktur. Ağdaki ilk devnet kabul sonuçları alınmadan bu tablo PASS olarak güncellenmez.

## 3 Ekim 2026 — Ringside Contact v3 ve cüzdan düzeltmesi

[Yeni sürüm raporu](releases/ringside-contact-2026-10-03.md) ve [kaynak kimlikli kanıt](../ops/evidence/ringside-contact-20261003.json): workspace typecheck,164 unit,65 üretim paketi tarayıcı,28 operasyon,16 gerçek V3 workerd kontrolü geçti. V1/V2 runtime regresyonları ve gerçek GLB hedef testleri ayrı kaydedildi. Hosted iki bağımsız demo oturumunda6bilet/60DEMO, per-pool korunumu, iade, ikinci raunta taşıma ve asset/build eşleşmesi gözlendi. Öğrenilmiş model yalnız128nöronluk gerçek altgraf üzerinde taklit öğrenmesidir; biyolojik beyin/self-play değildir. Gerçek fonlar ve9launchgate BLOCKED kalır. Ayrıntılı sınırlar ve çalıştırılmamış fiziksel cihaz/yük/bağımsız denetim raporda açıkça yazılıdır.

## 3 Ekim 2026 — yerel self-play, beden ve ölçek deneyleri

Bu bölüm önceki hosted v3 kanıtını değiştirmez; yeni `/lab/ringside` araştırma ekranının deployment/hosted kabulü değildir. Kaynaklar, hashler, başarısız sonuçlar ve yeniden çalıştırma komutları aşağıdaki deney raporlarında saklanır. Frozen canlı v3/politika ve kabul edilmiş biletler korunmuştur; gerçek varlık kapıları açılmamıştır.

| Alan | Gerçek yerel kanıt | Geçmeyen koşul / kapsam |
|---|---|---|
| Ödülden self-play | [İlk deney](../experiments/combat-selfplay/README.md): gerçek kapalı döngü maçlar, geçmiş öğrenci ve sabit rakipler; öğretmen etiketi yok. Üç varyantta toplam 6.912 eğitim maçı, 256 final maç/politika. | Connectome adayı FAIL; saldırıların %91,59'u cross. Sonradan yapılan sürekli-cross kontrolü de yüksek skor aldı; genel dövüş zekâsı veya connectome üstünlüğü gösterilmedi. |
| Daha zor curriculum | [İkinci deney](../experiments/combat-selfplay/CURRICULUM.md): 9.600 eğitim maçı, 512 yeni final maç/politika; önceki öğrenilmiş modelin skoru 0,6055→0,8486. | Teknik çeşitliliği, motor müdahalesi ve temassız süre koşulları FAIL. |
| Yeni gard + yeniden eğitim | [Üçüncü deney](../experiments/combat-selfplay/GUARDED.md): 96 mekanik karşılaştırma; 3.600 eğitim maçı, 256 yeni final maç/politika. Aynı yeni ortamda önceki curriculum modelinden skor 0,3340→0,9961; eğitim 69,56 sn, tüm koşu 89,42 sn. | Ortalama 2,898 teknik <3; motor müdahalesi %64,21 >%25: FAIL. Önceki model rastgele/eğitimsiz başlangıç değildir. Düşük seviyeli eklem-tork veya enerji yönetimi öğrenilmedi. |
| CMU + MuJoCo | [Gerçek fizik ölçümü](../experiments/combat-physics/evidence/metrics.json): 8 sn, 4.800 adım; takip p95 16,5 cm, penetrasyon 5,1 mm, destek ayağı hızı p95 27,5 cm/sn. | 5 cm /5 mm /10 cm/sn eşikleri üçü de FAIL. Pelvis desteği var; pasif torba/kayıt takibi, rakip veya öğrenilmiş denge politikası yok. |
| Hazır motor yeniden kullanımı | [Newton CPU ölçümü](../experiments/combat-motor-reuse/evidence/cpu-runtime.json): 15 gövde/34 DoF, 1.200 pasif adım; warm step p95 0,287 ms. | İncelenen MimicKit SharePoint yolu HTTP401; CPU temas köprüsü `NotImplementedError`. Daha sonra özgün DeepMimic MIT checkpoint/motion indirildi ve hashleri doğrulandı ([kanıt](../experiments/combat-motor-reuse/evidence/deepmimic-download.json)); tensor yükleme, uyarlama veya dengeli dövüş inference yapılmadı. |
| Tek maç izleyici fanout | [Yük kanıtı](load-validation.md): 1.000 izleyici +64 DEMO bahisçi; 64/64 admission/settlement ve havuz korunumu. 4 Hz delta ile toplam byte %93,35 azaldı, 20/20 kasıtlı boşluk sonrası resync geçti. | Yerel workerd, paylaşılan Apple M2/8 GiB; hosted SLA veya binlerce bahisçi kanıtı değildir. Adaptör production'a bağlanmadı; restart/hibernation sequence durumu açık. |
| Bahisçi burst sınırı | [Ledger takipli koşu](../experiments/load/evidence/contact-rooms-latest.json): 5 odada 1.120 istekten 616 kabul/504 kapanış reddi; kabul edilen bütün biletler dağıtıldı, bekleyen 0. | Admission hedefi FAIL. Beş odanın toplam 616.000 DEMO cent girdisi =603.680 ödeme +12.320 kesinti; başarısız hedef gizlenmedi. |

Self-play deneyinin 15 testi; CMU deneyinin 4 Python testi ve 8 JS assertion'ı; motor artifact güvenliğinin 5 unit testi ve delta reducer'ın 5 testi yerel olarak geçti. Bunlar kalite kapılarını PASS yapmaz ve uzaktan GitHub CI sonucu değildir. Gerçek MaleCNS altgrafı üzerinde varsayımsal sabit sinir dinamiği ve öğrenilen 1.112 readout ağırlığı kullanılır; tam işlevsel beyin, bilinç, insana aktarılmış sinir kontrolü veya AAA hazır ürün iddiası yoktur. Son checkpoint'ler validation ile seçildi; final sonuçlarıyla politika/eşik değiştirilmedi. Araştırma replay'leri yalnız karşılaştırma/sunum verisidir, yeni canlı maç veya ödeme üretmez.

### Araştırma ekranının yayın doğrulaması — 3 Ekim 2026

[Kaynak ve sürüm kimlikli kanıt](../ops/evidence/ringside-research-20261003.json): workspace typecheck ve 168/168 birim testi; yerel üretim workerd paketinde 68/68 tarayıcı testi, sıfır fail/skip/flaky. Build `2SZSncHPlrRB-VNsxuL5i`; yalnız web yayımlandı. Web sürümü `9335f817-49e2-4e02-9e32-54fa2559db30`, deployment `7c97d6ee-459b-4116-a682-242c180eb942` Cloudflare MCP ile %100 trafik olarak yeniden okundu. Realtime sürümü `fd489ab1-98ab-4aa9-8dc7-d010717747c9` değişmedi.

[Hosted gözlem](../ops/evidence/ringside-research-20261003/hosted.json): 8 public deney dosyasının boyut/SHA eşleşmesi, 1440/390 viewport'ta gerçek Metal render, oynatma, kayıt değişimi, sabit duraklatma, taşma olmaması ve gezinmede canvas temizliği; LIVE arena bağlantısı ve pageerror sıfır. 320px yerel görsel incelemede başlık çakışması düzeltildi; duraklamış fizik sahnesinde 1,5 sn boyunca sıfır ek GPU çizimi ölçüldü. Bunlar fiziksel iOS/Android veya sunucu ölçek sertifikası değildir. Yeni ekran hash doğrulanmış araştırma kayıtlarını gösterir; başarısız öğrenme/fizik kalite kapıları ve dokuz gerçek-varlık launch gate kapalıdır. GitHub CI çalıştırıldığı iddia edilmez.

## Ringside quality continuation — 2026-10-03

The new Lab presentation and published offline artifacts are tracked separately in `ops/evidence/ringside-quality-20261003.json`. Earlier evidence is retained. The energy residual model improves the unchanged energy/diversity gates on 576 fresh held-out episodes, but clean hits remain below threshold and a fixed-kick baseline outperforms it. All monetary gates and frozen LIVE engine identities remain closed/unchanged.

The learned motor is now a real numeric pretrained actor driving a free-base PyBullet runtime, not a passive Newton fall or supported CMU playback. Bullet's redistributed checkpoint differs from the initially downloaded original DeepMimic checkpoint. Source-default 240 Hz runs, 600/1200 Hz sensitivity runs, safe tensor exports and model/source identities are recorded under `experiments/combat-motor-reuse/evidence/`. Ten seconds without a fall is a narrow observed result, not robust balancing, whole-brain function or unified learned combat. All three requested physics thresholds are still not jointly satisfied. The new viewer renders the exported collision geometry and validates pinned trace hashes, full timeline coverage and consistency of displayed gate verdicts; it does not independently rerun the solver in a browser.

The user deferred physical-phone QA and authorized simulator testing for now. Viewport emulation, desktop Metal rendering and headless browser tests must remain labelled as those scopes, not physical iPhone/Android evidence. FightKit retains existing anatomy and authored clips; CC0 additions have a separate asset and credit manifest. New scene controls and lifecycle/rig tests do not establish AA character quality, production capacity, or real-asset launch readiness.

## 3 Ekim 2026 — Combat Club / Sparring yayın kaydı

Bu kayıt `/lab/ringside/play` ve `sparring-1` için ayrı bir hazırlık kesitidir; önceki Contact/Lab deployment, test ve başarısız fizik kanıtlarının üzerine yazmaz. Yerel, girdiye dayalı antrenmanda bahis veya ödeme yolu yoktur. Yeni fixed-step kinematik oyun, sabit kurallı botlar ve authored/procedural görsel adaptör [araştırma raporunda](research/ringside-sparring-20261003.md) ayrılmıştır. Önceki connectome eğitimi veya gerçek PyBullet motor deneyi bu moda bağlanmış değildir.

| Kontrol | Bu kayıttaki durum | Kanıt / sınır |
|---|---|---|
| Referans oyun tarayıcı gözlemi | **Sınırlı gözlem** | Fight Arena tutorial salonu + pause; Punchers animasyonlu 3D menü. Maç tamamlanmadı, iç içe Unity girdisi güvenilir değil. [Referans görselleri ve ayrım](research/ringside-sparring-20261003.md) yeni Sollish browser PASS'i değildir |
| Yeni animasyon provenance ve retarget | **Yerel PASS — 4 Python testi** | `test_combat_motion.py`: hash/lisans, mevcut hedef bind/hiyerarşi, monoton/sonlu keyframe ve quaternionlar, root/pelvis eksenleri |
| Gerçek Three.js klip bağlama | **Yerel PASS — 3 Node testi** | `combat-motion.test.mjs`: GLTFLoader, mevcut 65 kemikli rig üzerinde AnimationMixer, uyarısız bağlanma ve kök kaymadan değişen poz; GPU/piksel testi değildir |
| Önceki atlet asset regresyonu | **Yerel PASS — 5 Python testi** | `test_assets.py`; eski `athlete.glb` SHA değişmedi: `4f6408ef9aa249ef7043f36b2de15e60069cd656d0fc9abd6a1f5028002b66aa` |
| Sparring mekanik/input/visual-adapter unit ve tip kontrolü | **Yerel PASS** | 61 protocol, 76 web, 10 gerçek GLB testi; web typecheck ve OpenNext build PASS. 76 web içinde 9 kamera, 8 input ve 2 hareket testi var; ayrı sayılarla tekrar toplanmaz. 28 gerçek motor isabetinde uzuv süpürmesi, ilan edilen hurt-volume ile örtüşüyor; tam mesh çarpışması değil |
| Yeni mod gerçek tarayıcı, desktop/mobil viewport, WebGL ve cleanup | **33/33 önceki üretim build; 6/6 son build PASS** | `5BsK4Lr38e6HYczgYrth8`: 6 antrenman + 27 regresyon. Son kamera cutaway/poz sınırı düzeltmesinden sonra `yTTEY4MG5gmewPMEL9MsM`: etkilenen 6 antrenman testi yeniden PASS. Manuel giriş, maliyet, pause/reset, kamera, odak değişiminde gard bırakma, 390 px, bozuk asset, gerçek WebGL context loss ve route cleanup. Eski LIVE/wallet network/adaptörleri fixture; fiziksel cihaz veya uzaktan ödeme kanıtı değil |
| Yeni mod deployment ve hosted doğrulama | **Yayımlandı; gerçek WebGL gözlemi PASS** | Build `yTTEY4MG5gmewPMEL9MsM`, Worker version `93645ad3-1955-4f7d-b947-c495d6b604f6`, deployment `bb9914b8-c62e-4679-a97a-32778b649c77`; Cloudflare MCP %100 aktif sürümü doğruladı. Hosted 1280×720: bot dövüşü, sağlık/enerji/olay güncellemeleri, pause/resume, yayın/üst kamera, yatay taşma yok ve JS hata kaydı boş. Realtime sürümü değişmedi |
| Aktif dövüş FPS | **INCONCLUSIVE** | Önceki render aralıkları terminal boşta durmayı içerdi; aktif FPS diye raporlanmaz. 390 px otomatik browser testi fiziksel telefon performansı değildir |
| Fiziksel iOS/Android | **PENDING — kullanıcı sonraya bıraktı** | Headless/Metal/simüle viewport gerçek telefon sayılmaz |
| Öğrenilmiş bağımsız beden kontrolü / üç fizik kalite kapısı / gerçek varlıklar | **Değişmedi; açık engeller korunur** | Yeni authored klip, prosedürel IK veya yerel oyun başarısı eski FAIL/BLOCKED sonuçlarını kapatmaz |

Yeni addon `combat-motion-v1.glb`: **357.712 bayt**, SHA256 `8ab9688e12a625ed3d4ec3c7ab752f4f465d90b33d3eef1580b276bc1e3cff39`; [lisans/manifest ve yeniden çalıştırma](../scripts/boxing-assets/combat-motion-v1.md). 8 authored klibin ham kaynakta 66, hedefte 65 kemiği vardır. In-place root, kusursuz ayak basışı veya mesh ile hasar hacmi eşleşmesi kanıtı değildir. Guard/dodge kliplerinin filtrelenmesi ve uppercut/roundhouse procedural katmanı ayrıca görsel doğrulanmalıdır. Bu bölüm uzaktan GitHub CI veya mainnet hazır olma iddiası içermez.

Sparring yayın kaydı: [kaynak/build kimliği ve doğrulama logları](../ops/evidence/ringside-sparring-20261003.json). [Son hosted görünüm](../ops/evidence/ringside-sparring-20261003/hosted-final.jpg). Önceki başarısız geliştirme denemeleri PASS sayısına dahil değildir; testlerin build kapsamı ayrı kaydedilir. CLI ile doğrudan HTTP kontrolü 403 verdi; bunu başarılı saymadık, son yayın doğrulaması Cloudflare MCP ve normal tarayıcıda gerçek sayfa/oyun gözlemidir.

## 4 Ekim 2026 — Combat Club `sparring-2` mekanik ve sunum düzeltmesi

Önceki `sparring-1` kaydının üzerine yazmaz. Kapsam yalnız bahissiz `/lab/ringside/play`; dondurulmuş 8 LIVE/protokol kaynağının hashleri önceki kanıtlarla eşleşir. **Yayımlanmadı**: hosted Worker hâlâ `93645ad3-…` (sparring-1).

| Kontrol | Durum | Kanıt / sınır |
|---|---|---|
| Şikâyetlerin yeniden üretimi | **sparring-1'de FAIL olarak ölçüldü** | [Denetim](../experiments/combat-sparring-audit/README.md), görülmemiş seed 1001–1048: hacme giriş p95 14,3–18,3 cm; kaçan rakibe 90 sn'de 0 temas; jab spam 0,865–0,885 |
| sparring-2 mekanik denetimi | **Görülmemiş seed'lerde düzeldi** | Hacme giriş maks. 0,2 cm (tolerans); runner 0,000 (KO %95–96); önce-vur-kaç 0,188–0,380; jab/tekme spam 0,000. Sömürü stratejileri ayar sırasında kullanılanlarla aynı; insan oyun testi yok |
| Birim / tip / GLB / asset | **Yerel PASS** | 65 protocol (4 yeni test sparring-1'de FAIL, sparring-2'de PASS), 76 web, typecheck, 10 gerçek GLB (temas = 4 mm içinde dokunma), Python asset testleri, 3 Three motion |
| Tam tarayıcı paketi | **77/77 PASS** | Build `58nJGPuyJ2rBqjbkcA3_N`, yerel workerd önizleme, workers=1, 3,9 dk; `.tooling/sparring2-production-browser.log`. GitHub CI çalışmadı |
| Aktif dövüş FPS | **Masaüstü M2 ölçüldü; telefon PENDING** | ANGLE Metal/Apple M2 headless, bitişten önceki 23,6 sn aktif pencere: 59,9–60,0 ort. FPS (yayın/takip/üst/390 px emülasyon). Kare süresi p95, bellek ve GPU süresi ölçülmedi |
| Görsel kayıt | **Hareket halinde gözlendi** | [Kanıt](../ops/evidence/ringside-sparring2-20261004.json): sahne 370→468 px, alçak yayın kamerası, 3/4 takip kamerası, halat kesiti, mobil 390 px. Karakter sanatı değişmedi; kullanıcı görsel kabulü açık |
| Gerçek varlık kapıları | **BLOCKED, exit 2, CONSISTENT** | `check:readiness` yeniden çalıştı; dokuz kapı değişmedi |

## 4 Ekim 2026 — Combat Club izleme sürümü (`sparring-3` + CMU mocap + arena + ses)

`sparring-2` kaydının üzerine yazmaz; ikisi de yayımlanmadı (hosted hâlâ `sparring-1`). Kapsam yalnız bahissiz `/lab/ringside/play`.

| Kontrol | Durum | Kanıt / sınır |
|---|---|---|
| Kurallar ve mekanik denetimi | **PASS (seed 1001–1048)** | `experiments/combat-sparring-audit/evidence/sparring3-heldout-1001-48seeds.json`: runner 0,000 (KO %100), önce-vur-kaç 0,094–0,443, jab spam 0,000, hacme giriş ≤0,2 cm |
| Mocap provenance ve tekrar üretim | **PASS** | 12 CMU denemesi ZIP+BVH SHA256; yeniden bake bayt bayt aynı (`319792e8…`). CMU koşulları CC0 değil |
| Birim / tip | **PASS** | 67 protocol, 76 web, typecheck |
| Gerçek GLB | **PASS 10/10 + 10/10** | Eski ve mocap renderer; mocap'te her motor isabeti render edilen elle 4 mm içinde temas |
| Tarayıcı | **77/77 PASS** | Build `1JyknQCgc_sUVus5smcSg`, yerel workerd, 4,2 dk; `.tooling/sparring3-production-browser.log`. GitHub CI çalışmadı |
| FPS | **M2 GPU ~60; SwiftShader ~3,5** | Aktif dövüş penceresi; yazılım render en kötü durumdur, telefon ölçümü değildir. Uyarlanabilir kalite devrede |
| Gerçek varlık kapıları | **Değişmedi** | Dokuz kapı kapalı |

## 4 Ekim 2026 — `sparring-4`: knockdown, sayım, raunt ve puanlama

Sersemleme birikimiyle knockdown, 0,75 sn'lik hakem sayımı (gerçek 1 sn'den hızlı, yayın temposu için), kalkma + zorunlu 8 sayım, üç knockdown TKO, sağlık tükenince 10 sayımla KO, 3×45 sn raunt + 8 sn ara, 10-9 puan kartı ve karar; dövüşü etkilemeyen hakem; otomatik kamera rejisi; raunt/knockdown sesleri. Protocol 71/71, web 76/76, GLB 10+10, tarayıcı **77/77** (build `OGU2u_5wt9P6ZSKBu5mee`, yerel workerd). Görülmemiş seed'lerde sömürüler kaybediyor (runner/jab spam 0,000). 3 rauntluk bot maçlarının %69'unda knockdown (ayar seti). [Kanıt](../ops/evidence/ringside-sparring4-20261004.json). Yayımlanmadı; düşme/kalkma authored klip; Mixamo içe aktarımı tarayıcı izni bekliyor.

## 4 Ekim 2026 — Mixamo hareket seti ve akıcılık

Kullanıcının Brave'deki Mixamo oturumundan (sayfa içi betik; oturum anahtarı sayfadan çıkmadı) 43 animasyon indirildi; 27'si mevcut 65 kemikli rig'e aktarılıp `mixamo-boxing-v1.glb` (2 529 856 bayt, SHA `14c2829c…`) olarak paketlendi. [Atıf ve koşullar](../apps/web/public/models/boxing/mixamo-boxing-v1-credits.json): oyun içinde telif ücretsiz kullanım; ham dosyalar tek başına dağıtılamaz; CC0 değildir. Render artık tümüyle bu setten (`boxing-mixamo-athletes.ts`); CMU renderer `?renderer=cmu` ile karşılaştırma için durur. Gerçek GLB testi 10/10 (her motor isabetinde render edilen el 4 mm içinde temas).

Akıcılık önce/sonra ölçümü (`?probe=1`, seed 7, 20 sn, M2 Metal, ekran görüntüsü alınmadan): en büyük kamera hareketi 4,6 m/kare (sert kesmeler) → 0,07 m/kare; kemik açısal hızı p99 162 → ~64 rad/s. Değişiklikler: tick-arası ara-konum, 50 ms poz yumuşatma + kemik başına 35 rad/s hız sınırı, gard IK'sinin yumuşatmadan önce çözülmesi, temas IK rampaları, kesmesiz/yavaş kamera, hakemin uzak tarafta durması. Kalan hızlı kol hareketleri temas IK'si ve omuz zincirinin dünya-uzayı toplamıdır; 25 fps video karelerinde tek karelik atlama gözlenmedi, ancak bu çözünürlük ince atlamaları ayırt etmeye yetmez. Kullanıcının görsel kabulü açıktır.

## 5 Ekim 2026 — `sparring-5`: kapsül teması, hakem, NeuroBoxer v2 ve Jev stil katmanı

Kapsam yalnız bahissiz `/lab/ringside/play`. **Yayımlanmadı:** hosted web hâlâ `sparring-1` (`93645ad3-…`). Dört iş paralel alt ajanlarla yapıldı, ortak dosyalar önceden ayrıldı; `sparring-4` bayt bayt `experiments/combat-sparring-audit/baseline-sparring-4.ts` içinde donduruldu. Özet kanıt: [`ops/evidence/ringside-sparring5-20261005.json`](../ops/evidence/ringside-sparring5-20261005.json).

| Kontrol | Durum | Kanıt / sınır |
|---|---|---|
| Motor temas kapsülleri | **PASS** | 200 seed, her tick: gövde/baş/uyluk kapsül örtüşmesi 14,1–14,4 cm → 0 (≤0,002 m), gardlı eldiven ≤0,005 m, replay bayt aynı. Kapsül modelidir, mesh çarpışması değildir. Gard yalnız gard tutulurken katıdır (aksi halde vuruşların %89–95'i bloğa dönüyordu) |
| Render temas düzeltici (CPU GLB) | **FAIL (plan eşikleri)** | 3 tam maç, canlı görüntüleyici ayarı (kök kayması hız sınırı 3 m/sn). Düzelticisiz → düzeltici açık: gövde-gövde 0,449 → 0,035 m (eşik 0,010), baş-gövde 0,291 → 0,090, kol-gövde 0,356 → 0,168, eldiven-eldiven/önkol 0,236 → 0,231 (iyileşme yok). Bacak-bacak 0,304 → 0,255 m, 2 744 karede; hız sınırı olmadan 0,064 m / 1 238 kare, bu yüzden sınır bacakta geçici örtüşmeyi artırıyor. Kök kayması ≤0,12 m ve motor hashleri düzeltici açık/kapalı aynı: PASS |
| Temas, gerçek sahne (yerel üretim runtime) | **Kısmi** | s1–s1 varsayılan maç, seed 7: penetrasyon karelerinin ~%95'i eldiven/kol çifti, gövde/baş çifti ~%1. 1 cm üstü kare 628/1812 (düzelticisiz 1373). Kök sıçraması 0,231 → 0,089 m/kare: koordinatör 1,5 / 3 / 6 m/sn hız sınırlarını ölçtü ve 3 m/sn'yi seçti (`ops/evidence/ringside-sparring5-20261005/root-rate-ab.json`). Büyük sıçramalar örtüşme normalinin yön değiştirmesinden gelir; asıl çözüm sabit bir ayırma eksenidir. Kemik p99 ~180 rad/sn: kol IK düzeltmeleri hızlı |
| Mekanik denetim | **PASS (anti-exploit)** | held-out 1001–1048: runner/jabSpam/kickSpam 0; hitAndRun 0,188/0,115 → 0,302/0,255 (hâlâ kaybeder, marj daraldı) |
| Hakem motoru | **PASS** | 60 maç: dövüşçü/olay/kazanan eski hakemle aynı. Ayakta segmente uzaklık 0,393 → 0,696 m, yatan bedene 0,108 → 0,662 m, aradan geçiş 0, Δyaw 3,13 → 0,050 rad/tick, Δhız 1,73 → 0,067 m/sn. Tick maliyeti 6,6 → 14,5 µs |
| Hakem render ve sahne | **CPU PASS / sahne FAIL** | CPU GLB: kök ≤0,024 m/kare, adım başına kayma ≤1,99 cm, kamera sınırı dışında köşe 0 (önce 51 300/56 430). Üretim runtime: ortalama kayma 0,08 mm, adım başına en fazla 2,51 cm (eşik <2 cm). Kamera tarafında bulunma %2,0 → %5,35 (kötüleşti) |
| NeuroBoxer v2 (neuro-2) | **Öğrenme var; ana hipotez FAIL** | held-out 5000–5049 / 6000–6099: sabit havuz 1,000 (doymuş). Stratejist en iyi sabit stili geçmiyor (s1 −0,065). Eğilim girdilerinin ölçülebilir etkisi yok. Connectome üstünlüğü gösterilmedi (kontrol başına 1 seed). `experiments/neuro-boxer/evidence-style.json` |
| Ürün modeli seçimi | **Koordinatör kararı** | Ayna maçları, ayrı seed bankası 9000–9059: s3 (doğrulama seçimi) maçların %72'sinde 1. rauntta hiç saldırmıyor, %82'si beraberlik; s2 %93 / %98. s1 ilk tick'ten dövüşüyor: 1. rauntta 85 saldırı, maç başına 47,6 isabet, %3 beraberlik. Ürün **s1** (`d1e8f30d…`). Seyirci ölçütüdür, performans iddiası değildir. `experiments/neuro-boxer/evidence-mirror-product.json` |
| Jev stil katmanı | **PASS (yerel)** | 74/150 gerçek çağrı, hepsi OK. Node p50 281 ms; tarayıcı uçtan uca p50 389 ms. Üretim runtime'da (workerd) üç build × 2 çağrı başarılı. Aynı gözleme farklı stil dönebilir, bu yüzden replay yalnız kayıtlı karar günlüğünden yapılır. Karar kalitesi ölçülmedi |
| Anahtar güvenliği | **PASS** | Anahtar yalnız `.tooling/secrets/typesafe.env` (600, gitignore). Depo ve build çıktısı taramasında 0 eşleşme. İstemci paketinde uç nokta, env adı veya `authorization` yok. `opennextjs-cloudflare preview` `--env-file`'ı iletmiyor; yerel deneme `wrangler dev --env-file` ile yapılır |
| Birim / tip | **PASS** | protocol 105, web 92, decision-agent 21; protocol tsc; web typecheck (typegen dahil) |
| Gerçek GLB / asset | **PASS + 1 bilinen FAIL** | sparring-replay 10/10 × 3, hakem 4/4 × 2, temas GLB 1/2 (eşik FAIL, yukarıda); Python 5+4, combat-motion 3 |
| Build ve tarayıcı | **PASS** | Son build `RQQVZsiqtnBTkcFGuWvNz`, yerel workerd :3002, Jev rotası kapalı: **81/81** (3,8 dk). Önceki iki ara build de 81/81 geçti. Gerçek sahne raporu: `ops/evidence/ringside-sparring5-20261005/report.json`. GitHub CI çalışmadı |
| Donmuş LIVE / neuro-1 | **Değişmedi** | combat-v3, connectome-policy, ringside, pari-mutuel, live-round, combat, ringside-arena ve neuro-boxer(-model) hashleri önceki kanıtlarla aynı |
| Gerçek varlık kapıları | **BLOCKED, exit 2, CONSISTENT** | Dokuz kapı değişmedi |

## 9 Ekim 2026 — Contact 5, canlı Jev köşe planı, animasyon A/B (yerel, yayımlanmadı)

Kanıt: `ops/evidence/ringside-contact5-20261009.json` ve klasörü (önceden kayıtlar, testler, denge, ekran görüntüleri).

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Maç içi öğrenme, ana kriter (kural v3, test3, öğrenen rakipler) | **FAIL** | öğrenen − dondurulmuş: −2,6 puan (95% −28,4..24,2), 600 raunt. Kural v1 geçmişti (+44,8; 31,1..58,2) ama izlenemez; v2 geçmedi. |
| Maç içi öğrenme, ikincil (sabit tarzlı held-out rakipler) | **PASS** | +42,5 puan (16,3..69,8), 800 raunt |
| Bağlantı yapısı üstünlüğü | **Gösterilmedi** | MaleCNS − karıştırılmış: +5,5 (−18..29) |
| Denge bandı (iki köşe öğreniyor) | **PASS** | 300 raunt: KOR %47,3, yere düşme %41, 97 vuruş/raunt, 6 tekniğin hepsi %10–26 |
| Determinizm ve kayıt doğrulama | **PASS** | aynı seed + plan kaydı = aynı tekrar; değiştirilmiş plan, zincir ve gözlem hash'i reddedilir |
| workerd Contact 5 arenası | **PASS** | 10/10 senaryo: Jev cevabı, bozuk cevap, zaman aşımı, kaçan son tarih, yinelenen alarm, bütçe, kayıttan sonuçlandırma, anahtar sızmaz, yeniden başlatma |
| workerd v2/v3/v4 (temel sınıf kancaları sonrası) | **PASS** | v3 16/16, v4 16/16, v2 geçti |
| Gerçek Jev çağrısı | **PASS (1 çağrı)** | 545 ms, 2.281/280 token, kapalı şema |
| Animasyon A/B, 60 Hz tarayıcı ölçümü | **Kısmi** | temas p95 1,0 cm (en kötü 3,7; 38/39 ≤3 cm), iç içe geçme >5 mm karelerin %0,07'si (en kötü 14 mm), ayak 0,63 cm/adım, eklem hızı p99 45 rad/sn; telefon fps ve kullanıcı kabulü yok |
| Birim / tip | **PASS** | protocol 124, web 100, realtime 11; üç paket tsc temiz; talimat bütçesi 6/6 |
| Gerçek varlık kapıları | **BLOCKED, exit 2** | değişmedi |

## 9 Ekim 2026 (akşam) — Contact 5 kural v4b, tek canlı oyun, 2.5D kod animasyonu (yerel, yayımlanmadı)

Kanıt: `ops/evidence/ringside-live-20261009b.json`, `ops/evidence/ringside-contact5-20261009/rule-v4/`, `rule-v4b/`, `broadcast-25d/`, `live-v5b-jev-calls.jsonl`.

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Tempo ve denge (`dfd179bd`, 300 raunt) | **PASS** | 54 vuruş/raunt (bant 40–65), KOR %48, yere düşme %24; her vuruş menzil içinden başlar, seri ≤3 (protokol testi) |
| Maç içi öğrenme, ana kriter (v4b, test5, öğrenen rakipler) | **FAIL** | −2,6 (95% −22,9..17,7); kural v4 (`579c86bc`) aynı kriteri geçmişti: +19,6 (0,4..38,4) |
| Maç içi öğrenme, sabit tarzlı held-out rakipler (v4b) | **PASS** | +38,8 (24,6..53,4) |
| Bağlantı yapısı üstünlüğü | **Gösterilmedi** | v4b MaleCNS − karıştırılmış: +2,6 (−17..22) |
| workerd Contact 5 arenası | **PASS** | 11/11: yeniden deneme, bozuk cevap, zaman aşımı, kaçan son tarih, bütçe, yeniden başlatma dahil |
| Gerçek Jev, tam maç (yerel) | **PASS** | 15/15 plan Jev'den, 354–545 ms; tarayıcı tekrar doğrulaması uyarısız |
| 2.5D hareket kapıları (60 Hz, 10 raunt) | **PASS** | eldiven–kafa p95 0,43 cm (en kötü 3,4), basan ayak kayması 0, kemik boyu sabit, sıçrama yok |
| Tarayıcı (next dev :3000) | **PASS** | ringside-contact 7/7, product 14/14; Cloudflare derlemesinde koşmadı |
| Birim / tip | **PASS** | protocol 125, web 38, realtime 11; tsc temiz; v3/v4 workerd 16/12 kontrol |
| Telefon 60 fps, kullanıcı görsel kabulü, barındırılan ortam | **Açık** | ölçülmedi / onay bekliyor |
| Gerçek varlık kapıları | **BLOCKED, exit 2** | değişmedi |
