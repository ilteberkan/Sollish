# Cloudflare + Supabase + ARM worker — barındırma kararı

Güncelleme: **1 Ekim 2026**. Yerleşim Cloudflare üzerinde web/API ve Durable Objects, managed Supabase üzerinde Postgres/Auth, mevcut VPS üzerinde arka plan işçileridir. Web demosu ve realtime/DO servisi yayımlandı; Supabase Solana oturumu ve VPS'nin kısıtlı DB bağlantısı doğrulandı. VPS işçisi çalışır fakat zincir indeksi/keeper kapalıdır. Canlı oracle, gerçek bahis koşuluyla chat ve finansal oyun kabulü henüz tamamlanmadı. [Zaman damgalı doğrulama raporu](validation.md).

## Doğrulanan sunucu ve temizlik durumu

| Özellik | SSH üzerinden görülen değer |
| --- | --- |
| Paket / konum (kullanıcı paneli) | netcup VPS 1000 ARM G11 NUE iv; Nürnberg / Almanya |
| İşletim sistemi / mimari | Debian 13, aarch64 |
| CPU / toplam RAM | 6 CPU, 7.929 MiB |
| Dosya sistemi | Yaklaşık 251 G |
| Temizlik sonrası kontrol | Yaklaşık 7,3 GiB kullanılabilir RAM; son disk ölçümü işlem kaydında |

Kullanıcı mevcut uygulamaların yedek alınmadan silinmesini, Debian ve SSH erişiminin korunmasını açıkça onayladı. 17 container, 6 volume, 18 image ve Opia/Supabase/Coolify ile eski yedekleri kaldırıldı. Docker, Node ve Certbot dahil 167 paket ve ardından 343 kullanılmayan bağımlılık kaldırıldı. Yeni SSH bağlantısı, sshd yapılandırması, paket tutarlılığı ve yalnız TCP 22'nin dinlediği doğrulandı. Bu işlem işletim sisteminin yeniden kurulması değildir.

Temizlik kaydı [server-cleanup.md](server-cleanup.md) içindedir. Yukarıdaki boş kaynaklar temizlik anına aittir; eşzamanlı kullanıcı veya üretim SLA'sı garantisi değildir. Sonrasında Node24.21.0 ve `sollish-worker` kuruldu; hash doğrulama, systemd sertleştirmesi ve gerçek rollback deneyi [operasyon belgesinde](operations.md) kayıtlıdır.

## Seçilen topoloji

| Bileşen | Yerleşim ve görev |
| --- | --- |
| Web | Stable Next.js 16 App Router + OpenNext, Cloudflare Workers; statik varlıklar Cloudflare üzerinden sunulur. |
| API | Ayrı realtime Worker'ı: JWT/kimlik doğrulama, chat komutları, snapshot, public status ve imzalı outbox yayın kabulü. |
| Canlı yayın | Ayrı Durable Objects servisi, native WebSocket; oda ve fan-out bucket'ları başlangıçtan tasarlanır. |
| Auth | Supabase Solana Web3 Auth; doğrulanmış cüzdan kimliği ve kısa ömürlü oturumlar. |
| Postgres | Managed Supabase; chat geçmişi, moderasyon, cursor, outbox ve yayımlanabilir zincir indeksi. |
| İşçiler | VPS üzerinde modüler Node/TypeScript servisleri: indexer, keeper, outbox dağıtıcısı ve epoch tamamlama. |
| Crash gizli durumu | Ayrı MagicBlock TEE/PER devnet deneyi. |
| Bahis / ödeme / reward / staking | Cüzdan → Solana/PER protokolü; Anchor hesapları ve zincirdeki kurallar. |

Socket.io ve Supabase Realtime bu topolojide kullanılmaz; iki farklı yayın yolu işletilmez. Web/API veya tam Supabase yığını VPS'e taşınmaz. Sunucu işçileri asgari yetki ve kaynak sınırlarıyla ayrılır; ilk aşamada bunlar için ek Redis veya ayrı bir kuyruk ürünü zorunlu değildir.

OpenNext/Next.js ve Workers uyumluluğu gerçek build/preview üzerinde doğrulanır; paket sürümleri ve lockfile sabitlenir. Kullanılan Node API'lerinin Workers runtime'ında çalıştığı varsayılmaz. Beta framework'e geçiş bu kararın kapsamında değildir.

## Realtime neden Durable Objects?

Supabase Pro harcama sınırı kapalı varsayılanında 10.000 bağlantı fakat 2.500 mesaj/s sınırı bulunur; her alıcıya teslim sayılır. 5.000 kişiye tek round geçişi bile bu sınır açısından yüksek anlık yük oluşturur. Global chat'in dağıtım ve teslimat maliyeti baştan bilindiği için fan-out DO üzerinde tasarlanır.

DO başına tek iş parçacıklı yürütme ve yaklaşık 1.000 istek/s yumuşak sınır vardır. Bucket eklemek oda koordinatörünün sıralama darboğazını kendiliğinden çözmez. Kuyruk sınırları, yavaş istemciler, reconnect, replay ve oturum süresi dolması uygulamanın sorumluluğudur.

Sürümlü olay sözleşmesi, kalıcı chat/outbox, yetkili sistem olayları, 1.000/5.000/10.000 izleyici testleri ve zincir hesabı çekişmesi [scaling.md](scaling.md) içinde tanımlıdır. Bunlar hedef/test aşamalarıdır; mevcut kapasite ölçümü değildir. Crash grafiği istemcide çizilir; yayın, ödeme veya cash-out kabulünün otoritesi değildir.

## ARM worker ve güven sınırları

- Linux ARM64 için desteklenen Node runtime'ı ve native bağımlılıklar hedef mimaride test edilir; macOS `node_modules` dizini sunucuya kopyalanmaz. Süreç yönetimi, log sınırı ve yeniden başlatma politikası kurulumda doğrulanır.
- Build ve Anchor derlemeleri mümkün olduğunda yerel/CI ortamında yapılır. Worker kaynakları CPU/RAM, RPC throughput ve iş kuyruğu yaşıyla ölçülür.
- Indexer kalıcı cursor ve işlem/olay kimliğiyle yeniden başlayabilir. Outbox ve epoch işleri idempotent olur; keeper kesintisi geçmiş saatleri atlamaz.
- Chat yazımı ve outbox aynı Postgres transaction'ında kalıcılaşır. Açık şemalarda RLS ve rol yetkileri uygulanır; ayrıcalıklı Supabase anahtarı tarayıcıya verilmez.
- İstemcinin gönderdiği wallet alanı veya düzenlenebilir metadata yetki kaynağı değildir. JWT süresi/iptali açık bağlantılara da uygulanır; login imzası para transferi yetkisi vermez.
- Normal ARM VPS ve Cloudflare Worker, Intel TDX tabanlı PER yürütmesini barındırmış sayılmaz. Gizli Crash noktası genel Postgres indeksine veya uygulama loglarına yazılmaz.
- Keeper anahtarı yalnız gerekli işlem ücretleriyle sınırlanır; treasury/upgrade yetkisi internet sunucusuna taşınmaz. Ödeme alıcısı ve hak tutarı programca belirlenir.
- Kullanıcının kabul edilmiş zincir hakkı VPS/DB kesintisiyle silinmez. PER kesintisi, timeout ve recovery davranışı devnet deneyleriyle doğrulanmadan mainnet açılmaz.
- İzleyici kapasitesinin artması **1 SOL house sermayesini** artırmaz. Bahis, azami çarpan, shard rezervleri ve toplam açık yükümlülük zincirde sınırlanır.

## Bulut panellerindeki mevcut durum

Cloudflare resmi Wrangler erişimi kullanıcı tarafından onaylandı; Cloudflare MCP de doğrulandı. [Web demo](https://sollish-web-devnet.sollish-web.workers.dev/game/crash) ve [realtime durum API'si](https://sollish-realtime.sollish-web.workers.dev/v1/public/status) yayındadır. Son web sürümü ve tarayıcı testleri [doğrulama raporunda](validation.md) tutulur. Realtime dört gerekli Supabase/yayın binding'i ve8fanout bucket ile yapılandırılmıştır; gerçek SIWS/JWT/WebSocket ve oturum iptali8/8 geçti. Gerçek finalized bahis indeksi/eşik eksik olduğu için chat yazımı `CHAT_UNAVAILABLE`, health503 kalır.

Supabase'te `Solgamb` Free altında **Sollish Devnet** (`lutwdmwkogtzajxvbuiy`, Frankfurt) oluşturuldu. İki migration uygulandı; sekiz özel tabloda RLS ve istemci doğrudan erişim yasağı korundu. Solana Auth/site URL ayarı tamamlandı; gerçek kimliğin nested `custom_claims` biçimi SQL'de doğrulandı. VPS için ayrı, beş dar RPC yetkili LOGIN rolü ve doğrulanan TLS/CA bağlantısı12/12 kontrolden geçti. [Managed kurulum kaydı](../ops/evidence/managed-backend-20261001.json), [VPS DB kabulü](../ops/evidence/managed-db-vps-20261001.json).

Supabase yönetimi MCP üzerinden yapıldı; önceki bağlantısız/form aşaması tarihsel durumdur. 3D oyunlar istemcide Three.js ile çizilir; fiziksel sahnenin çizimi VPS veya Durable Objects üzerinden oyuncu başına render edilmez. Grafikler ödeme kararının otoritesi değildir.

## Maliyet, sağlayıcı uygunluğu ve sıradaki doğrulama

Ücretsiz planlar küçük devnet prototipi için başlangıç olabilir; binlerce kullanıcı için ücretsiz hizmet garantisi yoktur. Workers CPU/istek, DO aktif süre/istek/depolama, Supabase compute/DB/egress/Auth ve VPS/RPC/PER tüketimleri ayrı ölçülür. DO'nun giden WebSocket mesajları ayrıca ücretlendirilmez; bu tüm sistemin ücretsiz olduğu anlamına gelmez.

Supabase Free otomatik yedekleme/PITR ve uptime SLA sağlamaz; proje hareketsizlik nedeniyle duraklayabilir. Üretimde yedek, geri yükleme testi, izleme ve uygun plan gerekir. Solana deployment/rent/işlem ücretleri, VRF, token edinimi ve audit web/DB ücretsiz kotalarına dahil değildir.

Supabase AUP'nin düzenlenmemiş kumar ve bahis faaliyetleri kısıtı gerçek paralı yayın öncesinde işletme/lisans modeliyle birlikte değerlendirilir. Ücretli plan bunu kaldırmaz; devnet için de otomatik sağlayıcı onayı iddia edilmez. Cloudflare, netcup, RPC ve PER sağlayıcı şartları ayrıca geçerlidir.

Bu belge yeni ücretli kaynak açma, harcama sınırını kaldırma veya mainnet'e geçme yetkisi vermez. Geliştirme sırası sözleşmeler ve güvenlik deneyleri, backend ve frontend olarak korunur. Bölge/erişim ve RLS, sürüm uyumluluğu ve ölçülmüş yük sınırları ilgili aşamada doğrulanır.

## Birincil kaynaklar

- [Cloudflare Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) · [DO limitleri](https://developers.cloudflare.com/durable-objects/platform/limits/) · [DO fiyatları](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [DO WebSocket/Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) · [Workers limitleri](https://developers.cloudflare.com/workers/platform/limits/)
- [Supabase Realtime limitleri](https://supabase.com/docs/guides/realtime/limits) · [Mesaj sayımı](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) · [Fiyatlandırma](https://supabase.com/pricing)
- [Supabase Solana Auth](https://supabase.com/docs/guides/auth/auth-web3) · [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [AUP](https://supabase.com/aup)
- [MagicBlock PER / Intel TDX](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/onchain-privacy) · [Node ARM64 imajları](https://github.com/nodejs/docker-node/blob/main/versions.json)
