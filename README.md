# Sollish

Solana üzerinde Coinflip, canlı manuel cash-out hedefli Crash ve özgün oyunlar için Three.js sunum katmanı. İlk özgün oyun **RINGSIDE**, KOR ve AYAZ karakterlerinin boks demosudur. Bu çalışma alanı **devnet geliştirmesidir**; gerçek para kabul eden bir ürün değildir.

**Ringside Contact v3:** [Canlı arena](https://sollish-web-devnet.sollish-web.workers.dev/live/ringside) · [İş emri/şartname](docs/product/ringside-neuroarena-spec.md) · [Sürüm günlüğü](docs/product/ringside-version-log.md) · [Gerçek öğrenme ve ablation](experiments/connectome/LEARNING.md). Temasa bağlı IK, üç raunt, her rauntta bağımsız havuzlar ve görünür canlı defter. Gerçek MaleCNS altgrafı üzerinde eğitilmiş taklit kontrolcüsüdür; tam beyin veya self-play değildir. [V3 yayın ve test raporu](docs/releases/ringside-contact-2026-10-03.md). V2 ledger'ı [eski sayfasında](https://sollish-web-devnet.sollish-web.workers.dev/live/ringside-v2) korunur. [V2 tarihsel kanıtı](docs/releases/ringside-neuroarena-demo-2026-10-02.md).

**Önceki demolar:** [Oyun lobisi](https://sollish-web-devnet.sollish-web.workers.dev/games) · [RINGSIDE ortak canlı demo](https://sollish-web-devnet.sollish-web.workers.dev/live/boxing) · [RINGSIDE antrenman](https://sollish-web-devnet.sollish-web.workers.dev/game/boxing) · [Crash](https://sollish-web-devnet.sollish-web.workers.dev/game/crash) · [Coinflip](https://sollish-web-devnet.sollish-web.workers.dev/game/coinflip). Önceki v1 paketi **44/44 yerel workerd tarayıcı testinden** geçmişti; test kapsamı ve uzak yayın doğrulaması [sürüm raporunda](docs/releases/ringside-live-demo-2026-10-02.md). [Realtime durum uç noktası](https://sollish-realtime.sollish-web.workers.dev/v1/public/status) yalnız zincir üstü özellikleri bildirir; ayrı canlı demo finansal kabulü açmaz. Gerçek bahis indeksi tamamlanmadığından chat yazımı ve finansal özellikler kapalıdır.

**[Yeni, ayrı araştırma ekranı — RINGSIDE LAB](https://sollish-web-devnet.sollish-web.workers.dev/lab/ringside):** gerçek maç ödülünden öğrenen [self-play deneyleri](experiments/combat-selfplay/README.md), [yeni gard geometrisi ve yeniden eğitim](experiments/combat-selfplay/GUARDED.md), aynı seed'de önceki/yeni politika kayıtları ve [CMU mocap + MuJoCo karşılaştırması](experiments/combat-physics/README.md). Son aday 3.600 eğitim maçından sonra bağımsız test skorunu yükseltti; teknik çeşitliliği ve motor müdahalesi koşulları **FAIL** kaldı. Fizik takibinin üç kalite koşulu da geçmedi. [Hazır motor yeniden kullanımında](experiments/combat-motor-reuse/README.md) incelenen MimicKit yolu, SharePoint ağırlık erişimi ve CPU temas adaptörü nedeniyle engelli; bu, bütün alternatif ağırlıkların erişilemez olduğu anlamına gelmez. Özgün DeepMimic spinkick ağırlığı ve motion ayrıca indirildi, fakat mevcut fizik ortamında çalıştırılmadı. Ekran 3 Ekim 2026 tarihinde web sürümü `9335f817-49e2-4e02-9e32-54fa2559db30` ile yayımlandı; [kaynak kimlikli doğrulama](ops/evidence/ringside-research-20261003.json) 168 birim /68 üretim paketi tarayıcı testi ile ayrıca hosted dosya ve arayüz gözlemini ayırır. Frozen canlı v3 ve biletleri değişmedi; tam işlevsel beyin, öğrenilmiş eklem-tork kontrolü veya AAA hazır ürün iddiası yoktur.

[Yerel yük kanıtı](docs/load-validation.md): aynı maçta 1.000 izleyici +64 DEMO bahisçi geçti; 1.120 eşzamanlı bahisçi denemesinde yalnız 616 kabul edildi. Ayrı public delta deneyi trafiği %93,35 azalttı; production bağlantısı, restart/hibernation ve hosted ölçek doğrulaması açık kaldı.

## Uygulanan parçalar

- **Anchor house:** ayrı bahis escrow'u, fonlanmış kasa bölümleri, atomik azami ödeme rezervi, yetkili oyun CPI'ı, sabit oyuncuya tek ödeme ve kalıcı nonce.
- **Coinflip:** seçimi scoped VRF talebine bağlama, callback doğrulama, izin gerektirmeyen settlement, güvenli makbuz kapatma ve rent iadesi.
- **Token sözleşmeleri:** önceden fonlanan faz ödülleri, bahis hacmiyle orantılı saatlik claim ve anaparadan ayrı staking ödül vault'u. Ödüllü bahis, rezerv ve kredi kaydını aynı işlemde yapar. Fonlanmamış getiri vaat edilmez.
- **İstemci:** üretilen Anchor IDL'inden hesap/işlem kodlama, kanonik PDA ve devnet kontrolü, imza öncesi simulation, cüzdana gitmeden takip kaydı, belirsiz gönderimde tekrar bahis oluşturmayı engelleme.
- **Backend:** Supabase Auth/PostgreSQL şeması ve RLS, finalized Solana indexer, kalıcı outbox, kısıtlı yetkili ödeme keeper'ı; Cloudflare Durable Objects üzerinde kimliği doğrulanmış native WebSocket chat.
- **Web:** Next.js/React, özel koyu tema, telefon/masaüstü düzenleri, Wallet Standard bağlantısı, oyun/ödül/stake ekranları. Bulut ve program ayarları eksikken canlı işlemler kapalıdır.
- **Ringside görselleri:** doğrulanmış CC0 Quaternius yetişkin modeli, 65 kemik, 14 hazır animasyon klibi, v2 replay modunda hakem ve prosedürel tekme, üç kamera, sonuçtan bağımsız render ve azaltılmış hareket. [Lisans ve yeniden üretim](scripts/boxing-assets/README.md).
- **Ringside Lab v2:** 20 saniye admission / 60 saniye deterministik dövüş / 10 saniye sonuç. Kasa ek ödeme sözü vermez; bağımsız havuzlar %2 açık kesinti ile tam korunur, tek taraflı havuzlar iade edilir. Public tape oturum anahtarlarından bağımsız takma adlar kullanır. Gerçek MaleCNS dosyaları araştırma için kaynak/hash/şema düzeyinde incelendi; bu v2 sürümünde eğitim yoktu. V3 eğitim kapsamı ve sınırları yukarıdaki deney raporundadır.
- **Önceki ortak canlı demo (v1):** 5 saniyelik kalıcı bahis penceresi, kapanıştan sonra sunucu CSPRNG sonucu, SQLite atomik kredi/bilet defteri, kopma/yeniden başlatmada aynı bilet ve bir kez ödeme. SOLO tarayıcı kredilerinden ayrıdır; iki modda da SOL, token veya VRF iddiası yoktur. [Protokol ve kasa sınırları](docs/architecture/live-rounds-and-house.md).
- **Operasyon:** kilitli bağımlılıklar, ARM64 Node çalışma ortamı, systemd sertleştirmesi, hash doğrulamalı sürüm dizinleri ve başlangıç kontrolünde geri dönüş; GitHub Actions doğrulama tanımı.

Canlı manuel Crash protokolü **tamamlanmadı**. Gizli VRF, yalnız komut yetkisiyle cash-out ve Solana ödemesi arasındaki bağ PER devnet üzerinde henüz kanıtlanmadı. Crash ekranındaki manuel çıkış yalnız değersiz yerel demodur. Yerel mock oracle testleri gerçek VRF kanıt doğrulaması, canlı entegrasyon veya bağımsız audit değildir.

## Yerel çalışma

Node 24.21.0 proje içine indirilir ve resmi SHA256 ile kontrol edilir; sistem Node/PATH ayarları değiştirilmez. pnpm 10.18.2 gerekir.

```sh
bash scripts/use-node.sh pnpm install --frozen-lockfile
bash scripts/use-node.sh pnpm dev
```

Önizleme: `http://127.0.0.1:3000/games`. Ortam örnekleri `apps/{web,realtime,worker}` altındadır. Gizli anahtarlar hiçbir `NEXT_PUBLIC_` değişkenine yazılmaz. Boş ortam dosyaları demo gösterir; kimlik veya para işlemi yapmaz.

Gerçek Cloudflare runtime'ında yerel üretim paketi:

```sh
bash scripts/use-node.sh pnpm --filter @sollish/web build:cloudflare
bash scripts/use-node.sh pnpm --filter @sollish/web preview:cloudflare
```

Bu komutlar Cloudflare hesabına deployment yapmaz. Önizleme `http://localhost:3001` adresindedir.

## Doğrulama

```sh
bash scripts/use-node.sh pnpm typecheck
bash scripts/use-node.sh pnpm test
bash scripts/use-node.sh pnpm test:database
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:integration
bash scripts/use-node.sh pnpm --filter @sollish/realtime test:arena
python3 scripts/boxing-assets/test_assets.py
bash scripts/use-node.sh pnpm build:worker
bash scripts/use-node.sh pnpm test:worker-bundle
bash scripts/use-node.sh pnpm test:operations
bash scripts/use-node.sh pnpm test:browser
bash scripts/use-node.sh pnpm test:per
```

Veritabanı test betiği loopback'te kendi PostgreSQL kümesini ve yalnız `sollish_backend_test` test veritabanını kullanır; haricî veritabanını sıfırlamaz. PostgreSQL araçlarının PATH'te bulunması gerekir. Tarayıcı testleri için Playwright Chromium gerekir. Ek veritabanı yarış testinin komutu [backend belgesindedir](docs/backend.md).

PER ayrı npm projesidir: ilk kullanımda `bash scripts/use-node.sh npm --prefix experiments/per ci --ignore-scripts` gerekir. Saf istemci testleri gerçek ELF gerektirmez. Yerel probe derlemesinden sonraki gerçek artifact kontrolü `bash scripts/use-node.sh npm --prefix experiments/per run test:artifacts` ile ayrıca çalışır; ayrım [PER test belgesindedir](experiments/per/test/README.md).

Sözleşmeler (mevcut SBF kurulum betiği macOS Apple Silicon içindir):

```sh
rustup toolchain install 1.95.0 --profile minimal --component clippy --component rustfmt
bash scripts/toolchain-setup.sh
bash scripts/test-contracts.sh
bash scripts/use-node.sh pnpm idl:check
```

Betik house, games ve incentives SBF/IDL'lerini, açık `test-fixture` özelliğiyle iki yerel oracle/oyun fixture'ını üretir; tüm workspace testleri, Clippy ve biçim kontrolünü çalıştırır. Eksik SBF testin atlanmasına yol açmaz. `target/deploy/artifacts.sha256` yerel build özetidir; bağımsız reproducible build doğrulaması değildir. Mock programlar ağda yayımlanmaz.

Son ölçümler, çalıştırılan komutlar ve açık kabul koşulları [doğrulama raporunda](docs/validation.md) tutulur. GitHub Actions tanımının bulunması, uzakta çalışmış bir CI sonucu anlamına gelmez.

`bash scripts/use-node.sh pnpm check:readiness`, kayıtların dosya hash'lerini ve kapsamlarını kontrol eder. Bilinen açık koşullarda çıkış kodu2, eksik/değişmiş kayıtta1 verir; yeşil üretim onayı üreten bir özellik bayrağı değildir. [Son rapor](ops/evidence/core-readiness-20261002.json) ve [özgün oyun/protokol planı](docs/original-games.md).

## Korunan kararlar

- Planlanan mainnet house sermayesi **1 SOL**; operasyon, token edinimi, audit ve devnet test bütçeleri ayrıdır. İşlem ücretleri için house anahtarı kullanılmaz.
- Saatlik airdrop platform token'ı dağıtır; UTC epoch içindeki kabul edilmiş ödüllü bahisler ve minimum hacim eşiği on-chain tutulur. Chat uygunluğu finalized kabul olaylarından tam kayan son 60 dakika olarak hesaplanır.
- Pump.fun regular launch daha sonraki aşamadır. 1 milyar arz hedefi ücretsiz platform tahsisi anlamına gelmez; reward vault fiilen edinilmiş token ile fonlanır.
- Buyback/burn, gerçek gelir ve ayrı bir hazine politikası olmadan otomatikleştirilmez. Staking anaparası, açık bahis rezervi ve kullanıcı ödül hakkı kullanılamaz.
- Cloudflare web/olay dağıtımı, Supabase veri/kimlik, ARM VPS indexer/keeper/outbox görevini taşır. TEE gizli Crash yürütmesi için ayrı adaydır.

[Mimari](docs/architecture.md) · [Kasa](docs/contracts.md) · [Coinflip](docs/coinflip.md) · [Özgün oyunlar](docs/original-games.md) · [Token sözleşmeleri](docs/incentives-contracts.md) · [Backend](docs/backend.md) · [Hosting](docs/hosting.md) · [Ölçek](docs/scaling.md) · [PER deneyleri](experiments/per/README.md) · [Operasyon](docs/operations.md)
