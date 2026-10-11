# Ringside yük doğrulaması — 3 Ekim 2026

## Karar

Mevcut Contact v3 pilotunu “binlerce eşzamanlı bahisçi hazır” diye açmak doğru değil. Gerçek yerel burst deneyi admission sınırını gösterdi. Ayrı deneyde **aynı tek maçta 1.000 izleyici + 64 bahisçi** akışı başarılı oldu; hesap otoritesi tek ledger olarak kaldı. Bu adaptör production'a bağlanmadı ve gerçek varlık kapılarını değiştirmedi.

Kaynak: [mühendislik şartnamesi](product/ringside-neuroarena-spec.md), [tekrar çalıştırma komutları](../experiments/load/README.md), [ilk başarısız burst](../experiments/load/evidence/contact-rooms-first-burst.json), [tam ledger takipli burst](../experiments/load/evidence/contact-rooms-latest.json), [tek maç fanout kanıtı](../experiments/load/evidence/single-round-fanout-latest.json), [delta/coalescing karşılaştırması](../experiments/load/evidence/single-round-delta-latest.json). JSON dosyaları kaynak SHA256'larını, çalıştırma tarihlerini ve gerçek ölçümleri taşır.

## Gerçekten çalıştırılan kapsam

Apple M2 / 8 CPU / 8 GiB RAM, Node v24.9.0, Wrangler 4.145.0 ve yerel workerd/SQLite kullanıldı. Native WebSocket istemcileri ile sunucu aynı geliştirme makinesindeydi; diğer geliştirme/Next/QA süreçleri tamamen izole edilmedi. İlk burst başında kısa bir CPU teşhis işi de örtüştü. Bu nedenle gecikmeler çok bölgeli internet veya Cloudflare hosted SLA ölçümü değildir. Ağ mutasyonu yalnız loopback test portlarına yapıldı.

Sunucu `sunucum` üzerinde yalnız kapasite okundu: Debian 13 aarch64, 6 CPU, 8.31 GB RAM, ölçüm anında 7.76 GB kullanılabilir RAM ve 248 GB boş disk. Noninteractive PATH'te Node yoktu. Paket kurulmadı, servis başlatılmadı, mevcut veriye dokunulmadı. Bu sunucuda yük testi yapılmış sayılmaz.

Her yerel koşu kendi SQLite klasörünü/portunu kullandı ve yalnız kendi runtime'ını kapattı. Test saatini, seed'i, kabul edilen bileti, cüzdan bakiyesini veya sonucu elle değiştiren fixture yok. ContactArena'nın gerçek **20 sn kabul + 45 sn dövüş** süreleri beklendi. Test subclass'ının tek ek HTTP yolu salt okunur SQL toplamlarıydı. Kaynak hashleri koşu öncesi/sonrası karşılaştırıldı.

## Ölçüm sonuçları

| Deney | Bağlantı | Yazma kapsamı | Sonuç |
|---|---:|---|---|
| İlk burst | 5 oda × 224 = 1.120 oturum | 1.120 yeni bilet + 160 aynı-ID tekrar | Hedef başarısız: 386 kabul; kalanlar kapanış reddi. Bu ilk koşu dağıtımdan önce durdu. |
| Ledger takipli burst | 5 bağımsız oda, 1.120 oturum | 1.120 yeni bilet + 160 aynı-ID tekrar | 616 kabul / 504 kapanış reddi; kabul edilen 616 dağıtım ve korunum doğrulandı. Admission hedefi başarısız. |
| Tek maç + fanout | 1.000 salt izleyici + 64 bahisçi | Tek mevcut ledger, 64 bilet + 64 aynı-ID tekrar | 64/64 kabul ve dağıtım; bütün 1.064 istemcide aynı round/sonuç. |
| Tek maç + 4Hz public delta | Aynı 1.000 izleyici + 64 bahisçi | Aynı ledger ve ekonomi; sıra numaralı public farklar | 64/64 dağıtım, 20 kasıtlı eksik delta sonrası 20 tam resync; toplam trafik %93,35 azaldı. |

Ledger takipli burst koşusunda bağlantı kurulumu **52.329 ms**; kabul edilenlerin ACK p95 süresi **16.590 ms**, maksimum **20.613 ms** oldu. ACK alım zamanı kabul anıyla aynı değildir: sunucu kabul sınırını kontrol ederken, kalıcı makbuz istemciye sonradan ulaşabilir. 160 oturum aynı token/ID ile yeniden bağlandı, 80 yeni geç istek reddedildi. Beş odanın 20 havuzunda toplam `616.000 stake = 603.680 ödeme + 12.320 kesinti`; bekleyen bilet 0. Toplam 349.544 frame / 1.230.678.908 byte taşındı. Bu koşuda sıfır geçersiz frame ve beklenmedik socket kapanması vardı.

Tek maç deneyinde bağlantı kurulumu **4.690 ms**; ACK p50 **1.024 ms**, p95 **1.629 ms**, maksimum **1.702 ms** oldu. 64 bahisçi aynı token/aynı bilet ID'siyle, 40 izleyici salt izleme yoluyla yeniden bağlandı; reconnect p95 **3.778 ms** idi. Kapanış sonrası 16 yeni istek reddedildi. İzleyici kanalına gönderilen bahis komutu reddedildi ve SQL toplamları değişmedi.

Ölçülen son sınırlı snapshot örnekleminde `istemci alım zamanı − snapshot.at` p95 **261 ms**; bu damganın yaşıdır, saf network RTT değildir. Dağıtım makbuzları ilan edilen round sonundan **143 ms** sonra görüldü. Toplam **285.870 frame / 1.186.294.297 byte** alındı. İstemci tepe RSS yaklaşık 403 MB, test runtime süreç ağacı yaklaşık 1.034 GB oldu. Bu tam snapshot trafiği üretim maliyetinin düşük olduğunu göstermez.

Dört havuzun her birinde `16.000 stake = 15.680 ödeme + 320 kesinti`; toplam `64.000 = 62.720 + 1.280` DEMO cent. 65 özel oturumun (64 bahisçi + bir relay) başlangıç grant toplamı `6.500.000 = 6.498.720 son bakiye + 1.280 kesinti`. 1.000 izleyiciye oturum/bakiye/bilet yaratılmadı. Client balances, private receipts ve SQL toplamları birlikte kontrol edildi; replay/taahhüt de mevcut motorla doğrulandı. Hiçbir gerçek token/SOL ödeme iddiası yok.

### Trafik iyileştirmesi

Ayrı `public-delta-worker.ts` deneyi son public snapshot'ı tek bekleyen state olarak birleştirir ve en fazla 4 Hz yayınlar. İlk bağlantı, reconnect veya sequence gap sonrası tam snapshot; diğer mesajlar `sequence`, `baseSequence` ve yalnız değişen public alanları taşır. Bakiyeler, tokenlar ve özel bilet UUID'leri bu transport tipinde yoktur. Her uygulanmış delta, yeniden oluşturulan mevcut strict public schema ile doğrulanır; sıra boşluğuna fark uygulanmaz.

| Ölçüm | Tam snapshot baseline | 4Hz delta deneyi |
|---|---:|---:|
| Koşu süresi | yaklaşık 65 sn | yaklaşık 65 sn |
| Tüm alınan byte (public + private) | 1.186.294.297 | 78.878.401 |
| Tüm frame | 285.870 | 44.030 |
| Bahis ACK p95 | 1.629ms | 943ms |
| Reconnect p95 | 3.778ms | 589ms |
| Public snapshot veri yaşı p95 | 261ms | 324ms |
| Dağıtım makbuzu gecikmesi | 143ms | 119ms |

Toplam byte azalması **%93,35**. Delta koşusunda doğrudan ölçülen salt izleyici trafiği **15.772.772 byte / 29.193 frame**; 1.000 izleyici başına round ortalaması yaklaşık **15,8 KB** (40 reconnect ve 20 resync trafiği dahil). Özel bahisçi yolu değişmediği için kalan yaklaşık 63 MB aynı eski private/public ledger akışıdır. Coalescing'in ek gecikmesi görünürdür; bu tradeoff bahis kabul anını değiştirmez, private ACK birleştirilmez.

20 test istemcisi bir public delta'yı bilerek atladı: 20 sıra boşluğu ve 20 başarılı tam resync görüldü. Bu, TCP paket kaybı veya sunucu çökmesi testi değildir. Bütün 1.064 istemci aynı final round/sonucu gördü; 16 geç yeni bahis reddedildi; 64 aynı-ID tekrar, 64 bahisçi ve 40 izleyici reconnect sonrası duplicate ödeme oluşmadı. Dört havuzda aynı `64.000 = 62.720 + 1.280` korunum sağlandı. 5 adversarial reducer unit testi ve isolated strict TypeScript kontrolü de geçti. Baseline kaynakları/kanıtları korundu; ölçümler tek koşu karşılaştırmasıdır, istatistiksel SLA değildir.

## Mimari sonucu ve açık işler

Mevcut `broadcast` her kabul/oturum değişikliğinde tüm bağlı oturumlara tam snapshot gönderir; snapshot ayrıca SQL'den bilet/pool/online hesabını çıkarır. Tek makinede beş oda açmak bu işi ortadan kaldırmadı. Uygulamanın **256 socket, 256 bilet/round, 512 oturum** sınırları duruyor. Cloudflare bunları kendiliğinden yükseltmez.

Deney adaptörü bir değişmemiş ContactArena ledger'ına abone olan relay ve dört salt public fanout DO kullanır. Private session/token/ticket mesajları filtrelenir; dışarıdan publish yolu yoktur. İki ayrı hesap defteri veya pazarlar arası teminat oluşturulmaz. `online` hâlâ kaynak ledger'ın bağlı oturum sayısıdır, izleyici toplamı gibi etiketlenmez.

Cloudflare tek DO'nun tek iş parçacıklı olduğunu ve yaklaşık 1.000 istek/sn sınırının iş yüküne bağlı yumuşak sınır olduğunu belirtir. Çok sayıda nesne yatay ayrılabilir; bu tek finansal yazara 1.000 bahis/sn garantisi vermez. [Resmî DO limitleri](https://developers.cloudflare.com/durable-objects/platform/limits/).

Delta/coalescing yerel deneyde uygulandı; henüz production'a bağlanmadı. Relay/source/bucket kesintisi, yavaş istemci backpressure'ı, hibernation/restart sonrası cache ve kalıcı sequence/epoch yeniden kurulumu; auth/admission kötüye kullanım sınırları; privacy review ve bütçeli hosted soak/multi-region testi gereklidir. Özellikle relay bellekteki sequence'i kaybederken bucket'ın eski sequence'i koruması bu prototipin çözülmemiş restart durumudur; mevcut demo route'una taşınamaz. Cloudflare'ın WebSocket rehberi batch gönderimi önerir; hibernation bellekteki state'i sıfırlar ve outgoing socket'ler hibernate olmaz. Dolayısıyla bu relay'in maliyetsiz/kalıcı olduğu varsayılmadı. [Resmî WebSocket rehberi](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

Test **binlerce izleyici topolojisi için yerel uygulanabilirlik kanıtıdır**. Binlerce eşzamanlı tek-round bahisçi, hosted dayanıklılık, kalıcı servis maliyeti, finansal protokol güvenliği veya mainnet readiness kanıtı değildir. Sonraki sürümde admission yükünü yayın yükünden ayırırken mevcut bilet ekonomisi, tek yazarlı idempotency ve cutoff korunmalıdır.
