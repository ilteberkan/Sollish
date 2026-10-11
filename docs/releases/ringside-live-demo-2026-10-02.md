# Ringside: karakter yenilemesi ve ortak canlı demo

2 Ekim 2026 (Türkiye); ölçüm/deploy kayıtları UTC kullanır. Bu sürüm ücretsiz DEMO içindir. Gerçek SOL kabulü, VRF adilliği veya üretim finansal güvenlik onayı değildir.

## Görünen değişiklik

[Oyun lobisi](https://sollish-web-devnet.sollish-web.workers.dev/games) SOLO ve LIVE oyunları ayırır. [Ringside antrenmanı](https://sollish-web-devnet.sollish-web.workers.dev/game/boxing) oyuncunun kendi başlattığı yerel oyundur. [Canlı Ringside](https://sollish-web-devnet.sollish-web.workers.dev/live/boxing) bütün katılımcıların aynı turu ve sonucu izlediği ayrı DEMO odasıdır. Cüzdan, SOL veya token kullanılmaz; demo hacmi chat/airdrop hakkı oluşturmaz.

Önceki ilkel gövdeler kaldırıldı. Quaternius'un lisansı doğrulanmış CC0 yetişkin modeli, 65 kemikli iskelet ve 11 hazır animasyon klibi kullanılır. KOR/AYAZ saç, ten, eldiven ve kıyafetleri; ring, kamera ve maç koreografisi Sollish sunumudur. Gerçek tam gövde jab/cross, darbe tepkisi, yere düşüş ve kazanan pozu kullanılır. Bunlar keyframe klipleridir; motion capture veya AAA kalite garantisi diye sunulmaz. [Kaynak, lisans ve dosya özetleri](../../apps/web/public/models/boxing/credits.json), [tekrar üretim](../../scripts/boxing-assets/README.md).

Three.js GLTFLoader, SkeletonUtils ve AnimationMixer kullanılır; yeni karakter/animasyon motoru yazılmadı. Model yüklemesi oyun rotasında yapılır. Aynı sahne, SOLO/LIVE otoritelerinden aldığı sonucu canlandırır; animasyon hiçbir bahis sonucu veya ödeme üretmez. Kamera ve azaltılmış hareket sonucu değiştirmez.

## Ortak tur ve hata davranışı

- OPEN aralığı tam `[openedAt, openedAt + 5000 ms)`; kabul anını sunucu belirler. Eşitlikte ve sonrasında gelen yeni bahis reddedilir.
- CLOSED kalıcı olarak yazılmadan sonuç üretilmez. Sonuç ardından sunucu CSPRNG'si ile belirlenir; FIGHTING başında kamuya açıktır. Bu DEMO, VRF değildir.
- Gösterim 8,8 saniye; sonuç arası 4 saniye. Azaltılmış hareket ve gizlenen sekme ortak süreyi kısaltmaz.
- SQLite işlemi, kredi düşümü ve bileti atomik yazar. Aynı oturum/UUID tekrarında aynı bilet döner. Değişen payload kabul edilmez. Sonuç bir kez işlenir.
- Kayıp ACK veya geçici hata, başarısız bahis diye yorumlanmaz. İstemci kimliği göndermeden önce saklar; yeniden bağlanmada aynı UUID ile sorgular. Refresh/kopma iade oluşturmaz.
- Eski, çelişen veya cutoff/kazananı değiştiren mesajlar arayüzde kabul edilmez. OPEN sırasında winner içeren mesaj geçersizdir.

Cloudflare Workers + SQLite Durable Objects, mevcut Supabase/Solana yetki sınırları korunarak kullanılır. Anonim bir saatlik demo oturumu, cüzdan kimliği veya gerçek para hesabı değildir. Kapasite 256 bağlantı, 512 anonim oturum, tur/oturum başına bir bilet ve oturum başına 256 saklanan bilet ile sınırlıdır. Query string ile token kabul edilmez; token ilk WebSocket mesajında gönderilir. Origin allowlist, ayrı IP admission kotası ve 10 saniyelik oturum başlangıç süresi vardır.

## Çalıştırılan doğrulamalar

| Kapsam | Sonuç ve sınırı |
| --- | --- |
| Workspace typecheck ve birim testleri | PASS. Protocol 11, web 24, onchain client 45, realtime 11, worker 22 test. Yeni Rust/on-chain dağıtımı yok. |
| Operasyon testleri | 28/28 PASS; gerçek finansal hazır olma anlamına gelmez. |
| Model/animasyon dosyaları | 5/5 PASS: hash/lisans, kaynak sınırları, 65 kemik, sonlu normalize dönüşler, monotonic clip zamanı ve kıyafet skin ağırlıkları. |
| Üretim Cloudflare paketi, yerel workerd | 44/44 Playwright, sıfır beklenmedik/flaky sonuç. SOLO regresyonları, 11 LIVE fixture senaryosu, 320–1440 px düzenleri, WebGL kaybı ve Axe kontrolleri. |
| Gerçek yerel DO/SQLite | 13 kontrol: iki oyuncu, tekrar/çelişki, SQL rollback, gerçek alarm, tam payout, kopma ve workerd restart kalıcılığı. |
| Gerçek router | 12 kontrol: kapalı bayrak, origin/query/upgrade reddi, IP kotası ve oturum başlangıç timeout'u. Node/workerd transport kapanışının tamamlanma süresi garanti edilmez. |
| Yerel Ringside yükü | 256 bağlantı; 64 oyuncudan tekrarlar dahil 128 istek → 64 benzersiz kabul/settlement. 32 geç istek reddi, 257. bağlantı 503. ACK p50 849 ms, p95 1470 ms. |
| Mevcut chat fan-out regresyonu | 8 bucket üzerinde 1000 yerel sentetik bağlantı; 16 kontrol PASS. Bu, Ringside finansal oyuncu kapasitesi değildir. |
| Gerçek Cloudflare yayını | İki bağımsız tarayıcı oturumu aynı #10 turuna zıt seçimlerle katıldı. 10'ar DEMO sonrası bakiyeler 990 ve 1009,60; refresh bileti korudu. Beş yayımlanan asset SHA256 değeri yerelle eşleşti; pageerror yok. |
| Yerel grafik ölçümü | Apple M2, native Chromium Metal, 1440×1000: ilk hazır 1,328 sn; 5 saniyede yaklaşık 29,92 ana kare/sn. Bu mobil donanım veya hosted ağ performansı ölçümü değildir. |

Yerel yük profili, beş saniyelik yeni tur başlamadan bağlantıları hazırlar; küresel coğrafya, reconnect fırtınası veya uzun süreli kapasite testi değildir. 1000 chat izleyicisi ile 256 Ringside bağlantısı birbirine eklenip oyuncu kapasitesi olarak sunulmaz. [Yük kanıtı](../../apps/realtime/evidence/local-live-arena-stress.json), [ölçekleme sınırı](../scaling.md).

Mobil düşüş kadrajı ayrıca iki sonuç, iki kamera ve 320/390 px ekranlarda gerçek skinned GLB vertex projeksiyonuyla denetlendi; 145 zaman örneğinde en az 11,71 px yatay pay kaldı. Tarayıcı çizimi ayrıca Playwright ve yayın kontrolüyle incelendi.

Grafik temizliğinde 108/108 buffer silindi ve navigasyon sonrası canvas sayısı sıfırdı. Texture/program explicit delete sayaçları tam eşit değildi; renderer context loss ile kalan GPU kaynaklarını bırakır. Tam GPU bellek sıfırı veya bütün cihazlarda kararlı FPS kanıtlanmış değildir.

## Kasa ve kalan gerçek SOL işi

Mevcut House kaybeden bahsin kayıtlı stake'ini kasaya aktarır. Kazananın anaparası ve ek ödemesi ayrı, önceden ayrılmış rezervle karşılanır. %50 olasılık ve 1,96× brüt ödeme %2 teorik house edge'dir; her turda veya dönemde kâr garanti etmez. 1 SOL planlanan sermaye, tamamı serbest/çekilebilir gelir değildir. Rent, tampon ve eşzamanlı bütün bahislerin azami ek ödemeleri ayrılır. [Kaynaklı mimari ve açık kaynak karşılaştırması](../architecture/live-rounds-and-house.md).

Gerçek SOL özellikleri kapalıdır. Coinflip aynı-proof entegrasyonu, oracle proof erişilebilirliği/lisansı, canlı sağlayıcı ödeme doğrulaması; Crash attestation/gizlilik/manuel cash-out sıralaması/L1 ödeme-kurtarma ve bağımsız inceleme hâlâ açık koşullardır. Shared-round SOL sözleşmesi bu demo ile uygulanmış sayılmaz. `check:readiness` kayıtları tutarlı bulur, ancak 9 koşulla BLOCKED / productionApproved=false döndürür.

GitHub Actions tanımı bu test komutlarını içerir; uzakta çalışmış GitHub CI sonucu iddia edilmez. Supabase projesi, cüzdan fonları veya VPS yapılandırması bu görsel/LIVE DEMO çalışmasında değiştirilmedi.

Yayın kimlikleri: web `f3cca8af-bfe8-42ab-84b2-d3c4b6c54095`, realtime `86360c1d-e404-49b5-bbea-7254610bc53f`; Cloudflare MCP her iki sürümde %100 dağıtımı ve mevcut server secret binding adlarının korunmasını doğruladı. [Birleştirilmiş kaynak hashli kanıt](../../ops/evidence/ringside-live-20261002.json).
