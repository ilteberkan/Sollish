# Ölçekleme kararı — 1 Ekim 2026

Bu belge hedef tasarımı ve kabul ölçütlerini tanımlar. Yerel1.000WebSocket/workerd ölçümü ve VPS başlangıcı tamamlandı; hosted Supabase, küresel yük ve finansal işlem kapasitesi henüz doğrulanmadı. Önceki self-host Socket.io / Supabase Realtime seçeneklerinin yerine Cloudflare + Supabase yerleşimi seçilmiştir. TEE/PER güvenlik deneyleri sonuçlanmadan gerçek paralı manuel Crash üretime hazır sayılmaz.

## Yerleşim ve yetki sınırları

| Bileşen | Yerleşim ve sorumluluk |
| --- | --- |
| Web | Next.js 16 + OpenNext, Cloudflare Workers; adapter uyumluluğu build/preview testinde doğrulanıp sürümler sabitlenir. |
| API | Uygulanan public status/snapshot, WebSocket auth/chat komutları ve hız sınırları ayrı realtime Worker içinde; Next web Worker arayüzü sunar. |
| Realtime | Cloudflare Durable Objects (DO), native WebSocket; chat ve yayımlanabilir oyun gözlemleri için tek dağıtım katmanı. |
| Kimlik / kalıcı veri | Supabase Auth + Postgres; doğrulanmış cüzdan kimliği, chat, moderasyon, halka açık indeks, cursor ve outbox. |
| Arka plan | ARM VPS üzerinde Node işçileri: indexer, keeper, outbox dağıtıcısı ve epoch işleri; sınırlı kaynak ve yeniden başlatma politikası. |
| Finansal komutlar | Cüzdan → ilgili Solana/PER protokol uçları; bahis, cash-out kabulü ve ödeme yetkisi WebSocket/SQL katmanına verilmez. |

Socket.io kullanılmaz; native WebSocket onun protokolünü konuşmaz. Supabase Realtime ikinci yayın yolu olarak eklenmez. VPS temizliği veya donanım kapasitesi, normal Node/Worker sürecini TEE yapmaz; gizli Crash yürütmesi ayrı PER ortamındadır.

## Kapasite tanımı

| Test aşaması | Eşzamanlı izleyici hedefi | Finansal oyuncu yükü | Durum |
| --- | --- | --- | --- |
| A | 1.000 | Bahis/s, cash-out/s ve tur başına oyuncu ayrı tanımlanır. | Yerel sentetik fan-out ölçüldü; finansal/hosted test bekliyor |
| B | 5.000 | Aynı anda çıkış isteği ve round geçişi patlaması ayrıca ölçülür. | Ölçülmedi |
| C | 10.000 | RPC/PER, zincir hesapları ve teminat sınırları birlikte doğrulanır. | Ölçülmedi |

Bu sayılar kapasite vaadi değildir. İzleyici bağlantısı ile kabul edilmiş parasal bahis farklı kaynak tüketir. Test profili; açık sekmeler, bölgeler, mesaj boyutu, chat hızı, aktif oyuncu oranı ve reconnect dalgasını içerir. Önce p95/p99 gecikme, hata oranı, kuyruk yaşı ve kurtarma süresi için kabul eşikleri kaydedilir; her aşama geçmeden sonraki ölçek açılmaz.

Supabase'in mevcut Pro harcama sınırı kapalı varsayılanı 10.000 bağlantı / 2.500 mesaj/s'dir; bir yayının her alıcıya teslimi sayılır. Dolayısıyla 5.000 izleyiciye tek round geçişi bile büyük bir anlık yük oluşturur. DO seçimi, bilinen global yayın biçimini baştan karşılamak içindir; yalnız animasyonu yerelde çizmek bu yükü ortadan kaldırmaz. [Limitler](https://supabase.com/docs/guides/realtime/limits), [mesaj sayımı](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages).

## Oda ve yayın dağıtımı

- Başlangıçtan mantıksal oda/akış kimliği ve onun altında birden fazla fan-out bucket tanımlanır. Oyuncular aynı odayı görürken bağlantıları farklı DO'lara dağıtılabilir; bucket sayısı ölçüme göre ayarlanır.
- Her mantıksal akışın tek sıralama kaynağı bulunur; bütün siteyi yöneten tek global koordinatör kurulmaz. Bucket'lar aynı olay kimliği ve sıra numarasını taşır, bağımsız oyun sırası üretmez.
- Oda koordinatöründen bucket'lara dağıtım da yük oluşturur. Bucket eklemek koordinatörün giriş/sıralama darboğazını çözmez; oda bazında giriş sınırı, sınırlı kuyruk, ölçülmüş dağıtım ağacı ve aşırı yük yanıtı gerekir.
- DO başına yaklaşık 1.000 istek/s yumuşak sınır ve tek iş parçacıklı yürütme vardır. 32.768 WebSocket üst sınırı kullanılabilir iş yükü garantisi değildir. [DO limitleri](https://developers.cloudflare.com/durable-objects/platform/limits/), [WebSocket API](https://developers.cloudflare.com/durable-objects/api/state/).
- Hibernation API kullanılır; yeniden uyanma sonrası gerekli bağlantı bilgisi geri yüklenir. Sık olaylar hibernation kazancını azaltabilir. Yavaş alıcılar sınırlı tamponla ayrılır ve snapshot üzerinden döner; sınırsız bellek kuyruğu tutulmaz.
- Crash grafiği istemcide çizilir. Sunucu doğrulanmış round başlangıcı/sonu ve durum değişimlerini gönderir; ekran çarpanı, tıklama saati veya yayın sırası cash-out kabul kanıtı değildir.

## Olay sözleşmesi, kalıcılık ve oturum

- Sürümlü olay zarfı: `schema_version`, `stream_id`, `event_id`, `sequence`, `round_id`/`epoch_id`, `source_revision`, `occurred_at`, `payload`. Anlamı değişen olay yeni sürüm alır; bilinmeyen sürüm sessizce uygulanmaz.
- Chat mesajı, oda sırası ve outbox kaydı aynı Postgres transaction'ında kalıcılaşır. Kalıcılık olmadan başarılı gönderim onayı verilmez. Tekrar denemeler kullanıcıya bağlı idempotency anahtarıyla aynı sonucu döndürür.
- Outbox dağıtımı en az bir kez teslim modelindedir; istemci/bucket `event_id` ile tekrarları eler. Aynı akışın olayları sıralı yayımlanır; eksik sıra görüldüğünde replay veya sürümlü snapshot istenir. Sonsuz geçmiş tutulmaz; saklama süresi ve cursor son kullanımı açık tanımlanır.
- İndeksleme zincir/protokol kimliği, işlem kimliği ve olay konumuyla tekilleştirilir. Kesinleşme düzeyi ile düzeltme olayları açık olur; geçici gözlem kesin ödeme gibi sunulmaz. Gizli TEE hesabı genel indekse kopyalanmaz.
- Sistem olayları yalnız yetkili üreticiden gelir; şema ve alan allowlist'iyle yayımlanır. Gizli sonuç, anahtar, bearer token ve özel hesap verisi log/DB/olaya taşınmaz. Chat içeriği render sırasında güvenli metin olarak ele alınır.
- Supabase Solana Web3 Auth ile cüzdan sahipliği doğrulanır. Yetki, doğrulanmış identity kaydına bağlanır; istemcinin `wallet` alanı veya düzenlenebilir `user_metadata` yetki kaynağı olamaz. [Web3 Auth](https://supabase.com/docs/guides/auth/auth-web3).
- Korumalı WebSocket katılımında JWT imzası, issuer/audience, son kullanma ve oda yetkisi sunucuda doğrulanır. Token URL'ye/loga yazılmaz. Kimlik doğrulanana kadar korumalı komutlar işlenmez; yenileme doğrulanmazsa süre dolunca yetki kesilir/bağlantı kapanır.
- Oturum/ban iptali mevcut bağlantılara da uygulanır; yalnız ilk bağlantıdaki kontrol yeterli değildir. JWT iptalinin anlık olmadığı hesaba katılır; hassas işlemlerin oturum kontrolü ve cache süresi belirlenir. Açık şemalarda RLS ve en az yetki uygulanır; ayrıcalıklı anahtar tarayıcıya verilmez.
- Login imzası ödeme yetkisi değildir. Oyun için ayrıca imzalanmış oturum yetkisi kullanılacaksa program/işlem, süre, tutar ve iptal sınırları açıkça onaylanır; alıcı değiştirme veya sınırsız harcama yetkisi verilemez. Bu protokolün güvenlik testleri henüz tamamlanmadı.

## İlk Anchor hesap tasarımında paralellik

- Tüm bahislerin aynı writable house vault, round sayacı veya epoch toplamını yazması sıcak hesap oluşturur. Solana hesap kilitleri ve hesap başına blok maliyeti, web katmanından bağımsız ölçülür. [İşlem hattı](https://solana.com/docs/core/transactions/transaction-pipeline).
- `Bet`/ödeme hakkı bahis bazında ayrılır; round parametreleri mümkün olduğunca salt okunur kalır. Tur durumu ve cash-out sıralamasında gerçekten gerekli ortak yazmalar saklanmaz; bunların PER ve base-chain üzerindeki sınırları deneyle belirlenir.
- `VaultShard` hesaplarına önceden ayrı teminat bütçesi tahsis edilir. Tahsis toplamı kullanılabilir house sermayesini aşamaz; aynı sermaye iki shard/PER/base-chain tarafından eşzamanlı kullanılmaz. Her bahis kendi shard'ında rezervi atomik ayırır; teminatsız shard yeni bahsi reddeder.
- Rezerv, kabul anındaki `max(azami_brut_odeme - net_escrow, 0)` üzerinden tutulur. Aynı Crash turundaki kazançlar birlikte gerçekleşebilir; açık yükümlülükler toplanır. Round ve platform toplam tavanları dağıtılmış bütçelerle korunur; her bahis merkezî sayacı güncellemek zorunda bırakılmaz.
- Yetkili settlement rezervi bir kez tüketir/serbest bırakır; cüzdan alıcısı değişmez. Shard yeniden dengelemesi açık alacakları taşırken atomik ve doğrulanabilir olur. 1 SOL bankroll, izleyici kapasitesi artsa da büyümez.
- `UserEpoch` kullanıcının ilgili UTC döneminde gerçekten sonuçlanmış uygun bahis hacmini tutar; iptal/iade dışlanır. Yalnız doğrulanan gaming CPI authority güncelleyebilir. Kullanıcı aynı dönem boyunca deterministik tek toplam shard'ına bağlanır.
- Eşik `m` için ağırlık `w(x)=0` (`x<m`), aksi halde `x` olur; toplam güncellemesi `w(yeni)-w(eski)` kadar yapılır. Eşik aşılırken önceki hacim unutulmaz. İşlem tekrarları toplamı artıramaz.
- Epoch kapanınca tüm shard'lar zincirde dondurulup işaretlenerek toplam oluşturulur; her shard yalnız bir kez eklenir. Eksik shard varken claim açılmaz. Dönem ve settlement zamanının PER/base-chain tanımı protokol deneyinde kesinleştirilir.
- Önceden fonlanmış epoch bütçesiyle `floor(bütçe × ağırlık / toplam)` dağıtılır; toplam sıfır, kalan küsurat ve claim süresi tanımlıdır. Tek-claim, kanonik cüzdan ATA'sı ve toplam bütçe sınırı zincirde uygulanır. Stake anaparası/diğer haklar reward veya buyback bütçesine eklenmez.

## Arıza sınırları ve kabul testleri

| Arıza | Beklenen davranış ve test |
| --- | --- |
| DO / WebSocket kesintisi | Jitter'lı reconnect, sınırlı replay ve snapshot; duplicate/gap/ters sıra denenir. Yayın kesintisi ödeme hakkını silmez. |
| Supabase / Auth kesintisi | Yeni chat/oturum işlemleri güvenli biçimde durur; uydurma başarı verilmez. Zincirdeki kabul edilmiş hakların kurtarılması DB'ye bağımlı tasarlanmaz. |
| VPS / keeper / indexer kesintisi | Kalıcı cursor/outbox'tan devam, lease ve idempotent işler; yeniden başlatma ve geçmiş tamamlama denenir. Gecikmiş indeks eski olarak işaretlenir. |
| RPC / PER / TEE kesintisi | Yeni kabul sınırı ve stale durum görünür olur. Kazanılmış hakların recovery/timeout yolu seçici kayıp iptaline dönüşemez; bu yol devnet'te doğrulanmadan üretim açılmaz. |

1. Önce sözleşme testleri: rezerv/çifte ödeme, sahte authority, epoch eşik geçişi ve oyun yetkisi sınırları. Yayın katmanı uygulandığında replay ve bucket failover ayrıca test edilir.
2. Ardından Workers/OpenNext CPU, DO süre/bellek/dağıtım gecikmesi, Postgres bağlantı havuzu/sorgu-kilit süresi ve VPS kuyruk yaşı ölçülür; her istemciye ayrı DB bağlantısı açılmaz.
3. RPC limitleri, Solana CU/ücret/hesap çekişmesi, PER kabul sırası ve base-chain settlement süresi aktif oyuncu yüküyle ölçülür; eşzamanlı cash-out sınanır.
4. 1.000 → 5.000 → 10.000 izleyici aşamalarında bölgesel yük, round geçişi, chat patlaması, token yenileme ve yeniden bağlanma fırtınası denenir. Sonuçlar sürüm, ayar, yük profili ve maliyetle kaydedilir.
5. Doğrulanmış sınırın altında admission control uygulanır. Kapasite artışı; test, kullanılabilir teminat ve sağlayıcı bütçesinin üçünü birlikte gerektirir.

## Bütçe ve tamamlanma sınırı

Ücretsiz planlar devnet/prototip içindir; binlerce kullanıcıya ücretsiz hizmet taahhüdü yoktur. DO'nun giden WebSocket mesajları ayrıca ücretlendirilmez; gelen istek, aktif süre, depolama, Workers, Supabase, RPC/PER ve operasyon kalemleri ayrıca hesaplanır. [DO fiyatları](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Bu belge ücretli plan açma, harcama sınırını kaldırma, kaynak satın alma veya mainnet'e geçme yetkisi değildir. Üretim öncesi güncel fiyat/kota, Supabase AUP ve ilgili sağlayıcı şartları doğrulanır; yükseltilen plan mevzuat/sağlayıcı uygunluğunun yerine geçmez. [Supabase AUP](https://supabase.com/aup).

Yerel1kWebSocket fan-out/protokol ölçümü docs/validation.md ve apps/realtime/evidence/local-workerd.json içindedir.5k/10k yük, gerçek Supabase oturumu, çok bölgeli dağıtım, TEE gizlilik/attestation ve canlı finansal kapasite kabulü hâlâ bekler.

## Uygulanan sözleşmelerin sıcak hesapları

House bölümleri ayrı fonlanır; ödülsüz Coinflip bahisleri farklı shard hesaplarına ayrılabilir. İlk incentives sürümü ise fonlanmış phase/epoch ve staking pool üzerinde ortak yazma kilitleri kullanır. Bu hesaplar, reward etkin bahis veya claim kapasitesinin sınırıdır.1.000WebSocket sonucu on-chain1.000eşzamanlıbahis iddiası değildir. Gerçek CU/account-lock ölçümü alınmadan bu kapasite açılmaz. Sonraki ölçek diliminde önceden ayrı fonlanmış faz bölümleri ve toplam bütçe muhasebesi aynı Solana/Anchor stack içinde tasarlanıp yeniden denetlenmelidir; mevcut sözleşmenin böyle bir bölünmeyi zaten yaptığı söylenmez.

## 2 Ekim: ortak Ringside demo ölçümü

Yeni LIVE DEMO odası finansal yetki taşımaz ve başlangıçta **256 bağlantı / 512 bir saatlik anonim oturum** ile sınırlıdır. [Yerel stres kanıtı](../apps/realtime/evidence/local-live-arena-stress.json): Apple M2/8 GiB üzerindeki tek workerd DO, 256 izleyici/oyuncu bağlantısı altında 64 benzersiz bahis ve tekrarları işler; 64 kabul/settlement, 32 geç istek reddi ve kesin toplam bakiye doğrulanır. Kabul p50 849 ms, p95 1470 ms; 257. bağlantı 503 alır. Tur açılmadan tüm bağlantılar hazırlanmıştır. Bu, küresel dağıtım veya sürekli yük testi değildir.

Mevcut 8 fan-out bucket üzerinden 1000 chat izleyicisi testi ayrı bir sistem ölçümüdür; Ringside için binlerce aktif oyuncu kabulü olarak yorumlanmaz. Çok izleyicili Ringside aşamasında aynı Cloudflare teknolojileri korunarak kamuya açık tur snapshotları fan-out bucket katmanına taşınır; oyun koordinatörü, kalıcı tek sıra ve özel bilet yetkisini korur. Yeni oyuncu kapasitesi, gerçek RPC/teminat ve bölgesel gecikme deneyleri geçtikten sonra artırılır. Mevcut sınırlar ölçülmeden yükseltilmez.
