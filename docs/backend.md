# Backend ve gerçek zamanlı protokol

Bu dilim Cloudflare Workers/Durable Objects, Supabase Postgres/Auth ve Node24 ARM worker kaynaklarını içerir. Sunucu anahtarı bahis, payout, RNG, staking veya token hakkı belirlemez. Finansal işlemler ortak IDL istemcisi üzerinden Solana programlarına gider. Crash PER kabul kapıları kapanana kadar backend Crash sonucu yayınlamaz.

## Kimlik ve sohbet

UI, Supabase `signInWithWeb3({chain:'solana',…})` ile imzalı cüzdan oturumu açar. Realtime ilk WebSocket karesinde `{v:1,type:'auth',access_token}` bekler; token URL'ye veya kalıcı DO attachment'a yazılmaz. ES256/RS256 JWT, doğru issuer/audience/role/session/expiry ve JWKS ile doğrulanır; HS256 kabul edilmez. Ardından Auth `getUser` ve canlı `auth.sessions` kontrol edilir.

Cüzdan kimliği kullanıcı tarafından değiştirilebilen `user_metadata` üzerinden alınmaz. Migration, doğrulanmış `auth.identities.provider='web3'`, `provider_id='web3:solana:<address>'` ile bağlı kimliği kullanır. `identity_data.sub`, `identity_data.custom_claims.chain` ve `identity_data.custom_claims.address` tutarlılığı aranır; `custom_claims` nesne, chain/address string olmalıdır. Hosted SIWS bu alanları üst düzey chain/address yerine nested `custom_claims` içinde üretir. İlk eşleşme kullanıcı→kimlik→cüzdan olarak sabitlenir. Kimlik değişirse yeniden yetkilendirme gerekir; kod sessizce başka cüzdana geçmez. Oturum iptali mesaj/resume sırasında ve periyodik alarmda kontrol edilir. Süre dolunca bağlantı kapanır.

Sohbet gönderme şartı, **son 60 dakika içinde gerçekten escrow'a kabul edilmiş ve finalized `CoinflipPlaced` olaylarıyla doğrulanmış bahisler** toplamıdır. Settlement beklenmez; `CoinflipSettled` bu toplamı artırmaz. Alt sınır `sollish.settings.chat_min_wager_lamports` ile açıkça ayarlanır; varsayılan `NULL` olduğundan sohbet yazma kapalıdır. Indexer90 saniye güncel değilse yazma durur. Bu DB toplamı token/airdrop hakkı değildir.

Sohbet mesajı, tek bir PostgreSQL transaction içinde sıra numarası ve outbox olayıyla yazılır. Aynı kullanıcı/client_id tekrarı önceki sonucu döndürür. Kullanıcı başına2 saniye aralık ve dakikada20 mesaj sınırı, birden çok bağlantıda da SQL kilidiyle uygulanır. Gövde500 Unicode karakter/2.000 UTF8byte, kontrol karakteri yasak; UI metin olarak render etmelidir.

## HTTP / WebSocket sözleşmesi

| Yol | Davranış |
| --- | --- |
| `GET /health` | Yapılandırma ve güncel DB/index durumu olmadan503 |
| `GET /v1/public/status` | Eksik altyapıda açık `unavailable`; uydurma oyuncu/claimable yok |
| `GET /v1/chat/history?after=0` | Son100 olaya kadar snapshot; lag büyükse `truncated:true` |
| `GET /v1/rooms/lobby?after=N` | Native WebSocket, kesin Origin allowlist; ilk10sn auth |
| `POST /internal/publish` | Sadece servis HMAC'i,±30sn zaman penceresi ve UUID;8KiB streaming sınır |

Tüm kareler `v:1`; ortak tip ve strict allowlist `packages/protocol` içindedir. Client kareleri10.240byte, server snapshot524.288byte ile sınırlıdır. `seq` tek `lobby` mantıksal akışında artar. Duplicate atlanır; gap `REPLAY_REQUIRED` ile yeniden snapshot ister. Auth/resume sırasında gelen yayın snapshot bitmesini bekler; cursor geriye alınmaz. Aynı socket dakikada40 kare ile sınırlıdır; bir komut ağ yanıtını beklerken yeni komut kuyruğa alınmaz, bağlantı1008 ile kapatılır. UI auth/snapshot akışı tamamlanmadan komut göndermemelidir.

Tek RoomCoordinator DB sırasını bucket'lara dağıtır; DO başına256 bağlantı üst sınırı, varsayılan8 bucket vardır. Bir IP dakikada30 yeni bağlantıyla sınırlıdır; idle admission kayıtları2 dakika sonra silinir. IP yalnız secret ile hash'lenmiş DO adresi olarak kullanılır. Bu ayarlar2.048 kullanıcı kapasitesi garantisi değildir; dağılım, CPU, provider kotaları ve global coordinator yükü ayrı ölçülür. Bucket sayısını canlı değiştirmek bağlantıların yeniden açılmasını gerektirir. Socket.io ve Supabase Realtime kullanılmaz.

## Indexer ve outbox

Node worker yalnız devnet genesis, sabit Games programı ve operatörün doğruladığı deployed ProgramData SHA256'sı eşleşince veri işler. Hash, Loader-v3 metadata sonrası tüm ayrılmış kod byte'larını kapsar; yerel ELF hash'iyle otomatik eşit olduğu varsayılmaz. RPC sonucu kriptografik konsensüs kanıtı değildir; TLS ve güvenilir RPC hâlâ bağımlılıktır.

`getSignaturesForAddress`/`getTransaction` finalized okunur. Anchor event'i ancak gerçek runtime invoke stack'teki Games frame'inden kabul edilir. Başarısız transaction/CPI, bozuk/truncated log, sahte `Program log:` metni, yanlış house/bet PDA reddedilir. v0 loaded addresses çözülür. ComputeBudget ve üç tanınan imza precompile'ı log üretmezse yalnız bunlar atlanır; gerçek outer instruction numarası korunur. ABI değişimi sessizce tahmin edilmez.

Tek kayıt anahtarı genesis+program+signature+instruction/log konumudur; ayrıca aynı bet/event_kind tekrarına unique kısıtı vardır. Aynı kimlikte farklı miktar conflict olur. Cursor sadece eksiksiz bounded tarama sonrasında ilerler.20.000 signature üstü backfill otomatik atlanmaz; operatör incelemesi gerekir. Outbox30sn lease, sırayla HMAC yayını ve ack ile çalışır. Çökme tekrar yayın yapabilir; consumer seq/id ile idempotenttir.

DB bağlantısı sadece `sollish_worker` veya Supabase pooler biçimi `sollish_worker.<project-ref>` olmalıdır. Supabase migration role'ü NOLOGIN oluşturur; operatör şifre/LOGIN'i güvenli kanaldan atar. Hosted rol ayrı SCRAM parolası ve beş bağlantı sınırıyla etkinleştirilmiştir; uygulama en fazla üç bağlantı kullanır. Superuser/BYPASSRLS rolü uygulama tarafından reddedilir. Uzak DB TLS sertifikası doğrulanır (`rejectUnauthorized:true`); `ssl:'require'` kullanılmaz. VPS'de doğrulanmış resmî Supabase CA, `NODE_EXTRA_CA_CERTS` ile yalnız worker'ın başlangıç ortamına eklenir; hostname doğrulaması korunur. Doğrudan IPv6/5432 bağlantısı session advisory lock ile uyumludur; transaction pooler6543 uygun değildir. CA kaynağı ve dosya izinleri [operasyon kaydında](operations.md) bulunur. Secretlar git'e/loglara yazılmaz.

Indexer, tarama boyunca `pg_try_advisory_lock` oturum kilidini tutar. Bu nedenle doğrudan PostgreSQL bağlantısı5432 veya Supabase **session pooler5432** kullanılmalıdır. Transaction pooler6543, ayrı SQL komutlarını farklı PostgreSQL oturumlarına taşıyabileceğinden uygun değildir; `prepare:false` bu oturum kilidi gereksinimini çözmez. `sql.reserve()` yalnız istemci bağlantısını ayırır, transaction pooler arkasındaki PostgreSQL oturumunu sabitlemez.

## Managed migration ve Advisor kararları

`lutwdmwkogtzajxvbuiy` projesinde MCP tarafından uygulanmış `backend` migration sürümü `20261001183459` olarak kaydedildi. Yerel dosya `supabase/migrations/20261001183459_backend.sql` bu sürümle eşleştirildi; SQL byte'ları değişmedi (SHA256 `7fe5600e0cd009465baf74abd32fc809130c2e8d5981f86cd18e7b980f1ab678`). Böylece sonraki CLI migration karşılaştırması aynı şemayı yeni bir migration sanmaz. Uygulanmış bu dosya yeniden düzenlenmez; sonraki SQL değişiklikleri yeni migration olur.

Gerçek hosted SIWS denemesi, ilk yerel fixture'ın chain/address alanlarını yanlış seviyede modellediğini gösterdi. Yalnız `sollish.assert_session` içindeki nested claim okuması ve JSON tip kontrollerini düzelten `siws_nested_claims` migration'ı MCP'de `20261001190258` sürümüyle uygulandı. Yerel `supabase/migrations/20261001190258_siws_nested_claims.sql` aynı SQL byte'larını taşır (SHA256 `bd0d13c23aa694999c38f75a626e842df43f0e2f7c890a26dbf1e4ef86b503fd`). `CREATE OR REPLACE` mevcut fonksiyon ACL'lerini, session/ban kontrollerini ve değişmez cüzdan eşlemesini korur. Yerel testler artık nested hosted biçimini kullanır; üst düzey sahte alanlar, eksik/yanlış tipli nested claims ve uyuşmayan provider/sub reddedilir.

Advisor'ın `public.chat_snapshot` ve `public.platform_status` için anonim/oturumlu rollerin çağırabildiği `SECURITY DEFINER` uyarıları, bu iki kasıtlı açık okuma API'si için incelendi. `chat_snapshot` yalnız yayınlanmak üzere oluşturulan outbox olaylarını döndürür: SQL en fazla200 olayı, Worker100 olayı ister; cursor sınırı ve `seq <= tail` filtresi vardır. Cüzdan adresi, genel zincir işlemi ve sohbet metni bu API'nin bilerek herkese açık çıktılarıdır. `platform_status` yalnız son indeks slot'u, indeks tazeliği ve minimum sohbet bahis miktarını döndürür. Auth/session tabloları, ban nedenleri, özel cüzdan eşlemesi ve outbox lease alanları çıkmaz. Dinamik SQL yoktur; `search_path=''` ve şema adı açık referanslar kullanılır. Varsayılan `PUBLIC EXECUTE` kaldırılmış, yalnız bu iki okuma fonksiyonu `anon`/`authenticated` rollerine yeniden verilmiştir; yazma fonksiyonları açık değildir.

Bu dar `SECURITY DEFINER` istisnası, özel tablolara doğrudan erişim vermeden genel projeksiyon sunmak içindir; `SECURITY INVOKER` tercihinin genel bir kaldırılması değildir. API'ye yeni çıktı veya parametre eklenirse ayrıcalık ve veri ifşası incelemesi tekrarlanır. Bu okumalara doğrudan Data API üzerinden de erişilebildiğinden Worker Origin kontrolü onları gizli hale getirmez. [Supabase fonksiyon yetkileri rehberi](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker).

Sekiz `sollish` tablosundaki “RLS açık, policy yok” INFO kayıtları da beklenir: istemciler bu tabloları doğrudan okuyup yazmaz; tablo/schema grant'leri kaldırılmış ve policy olmaması istemci rolleri için varsayılan ret sağlar. Gerekli işlemler açıkça yetkilendirilmiş, sınırları denetlenen fonksiyonlardan geçer. RLS, ayrıcalıklı fonksiyon sahibi için koruma diye kabul edilmez; güvenlik burada fonksiyon gövdesi ve `EXECUTE` grant'lerine de dayanır. Uyarıyı susturmak için geniş `USING (true)` policy eklenmez. [Supabase RLS rehberi](https://supabase.com/docs/guides/database/postgres/row-level-security). Hosted grant denetiminde sekiz özel RLS tablo ve yalnız iki genel okuma RPC'si doğrulandı; bu sonuç canlı SIWS veya uçtan uca sohbet testi yerine geçmez.

## Permissionless keeper

Varsayılan `KEEPER_ENABLED=false`. Etkinleştirme; ayrı0600 fee-key dosyası, kullanıcıya ait0700 journal dizini, house authority/shard, Games+House deployed kod hash'leri, işlem başı ücret tavanı, ömür boyu toplam ücret bütçesi ve minimum bakiye ister. Fee-key house authority veya iki programın upgrade authority'si olamaz. Anahtar çıktıya yazılmaz; backend ev kasası anahtarını istemez.

Keeper finalized READY bet'leri generated IDL ile yeniden okur; canonical player/shard/PDA bağlantılarını denetler. Yalnız `settle_coinflip` ve sabit300.000 compute-unit limit talimatını kurar; priority ücret0'dır. İmzalı simulation, RPC fee quote, bakiye ve toplam bütçe kontrolünden sonra imza+bet+ayrılan ücret **diskte fsync edilmiş journal'a önce** kaydolur; tek send çağrısı `maxRetries:0` ile yapılır.

Minimum bakiye kontrolü yeni işlem ücretine önceki tüm pending ücretleri de ekler. İşlem finalized olduğunda slot'u journal'a kaydolur; sonraki bakiye RPC çağrısı tüm bilinen finalized slot'ların en büyüğünü `minContextSlot` olarak ister. Böylece henüz ücreti yansıtmamış eski banka bakiyesiyle rezerv serbest bırakılamaz. Eski journal'da finalized slot'u bulunmayan kayıtlar konservatif biçimde bakiye rezervinde kalır. Ömür boyu ücret bütçesi hiçbir durumda geri açılmaz; ayrı fee-key başka uygulamalar tarafından harcanmamalıdır.

Timeout veya restart aynı imzayı izler; yeni blockhash ile otomatik tekrar oluşturmaz. Finalized failed transaction da ücret rezervasyonunu geri açmaz. Bu muhafazakâr davranış bazı READY bahislerde operatörün belirsiz sonucu incelemesini gerektirir. Journal crash-lock'u otomatik silinmez. SIGKILL/çökme sonrası önce servis durdurulmalı, bekleyen imzalar ve finalized hesap durumu RPC üzerinden incelenmeli, journal bütçesi korunmalıdır; ancak bundan sonra operatör lock dizinini kaldırıp servisi yeniden başlatabilir. VPS journal alt dizini `/var/lib/sollish-worker/keeper` için0700 gerekir; üst dizinin0750 olması tek başına yeterli değildir. Eksik journal/anahtar/bütçede keeper çalışmaz. Otomatik receipt close yoktur; frontend finalized hesabı okumaya devam edebilir. Kullanıcının permissionless settlement işlemi fallback'tir.

## Yerel doğrulama ve sınırlar

- `pnpm --filter @sollish/protocol --filter @sollish/realtime --filter @sollish/worker test` ve `typecheck`.
- `bash supabase/tests/local-postgres.sh`: yalnız `.tooling/backend-postgres` cluster'ında port55432 ve `sollish_backend_test` DB'sini sıfırlar; tüm yerel migration'ları sürüm sırasıyla uygular ve41 gerçek SQL assertion çalıştırır. Auth tabloları hosted nested claim biçimini izleyen yerel shape fixture'ıdır, Supabase Auth servisi değildir.
- `node --import tsx apps/worker/test/database.integration.ts`:200 eşzamanlı writer commit /600 snapshot /1.200 tail+boyut assertion.
- `SPECTATORS=1000 bash scripts/use-node.sh node apps/realtime/test/workerd.integration.mjs`: gerçek workerd/DO/native WebSocket; localhost ES256 JWKS/Auth/DB fixture. Prod kodunda auth bypass yoktur.
- 29 Node test (protokol3, realtime4, worker22) ve üç TypeScript denetimi geçti. Worker testlerinden12 tanesi ayrı fee-key/journal, kanonik settlement, bütçe, iki tick boyunca pending ücret rezervi, finalized minimum slot, belirsiz gönderim ve restart sınırlarını sınar. Bu keeper testleri RPC mock kullanır, canlı devnet transferi değildir. Indexer ayrıca gerçek LiteSVM House/Games SBF loglarından üretilmiş first-wallet, repeat-wallet ve settlement fixture'larını tüketir; bu fixture'larda oracle yerel mock'tur.
- Ölçüm kanıtı `apps/realtime/evidence/local-workerd.json`:1.000 authenticated socket,8 bucket, tek event için p50/p95/max. Bu hosted Supabase, bölgesel gecikme, finansal transaction throughput, uzun süreli yük veya reconnect storm testi değildir.

Cloudflare/Supabase hesaplarına kaynak açmak, secret yüklemek, real devnet işlem göndermek ve üretim ağına geçmek bu testlerin parçası değildir. Mainnet; sözleşme/provider kabul kapıları, bağımsız güvenlik incelemesi, hukuki kapsam ve provider kullanım şartları tamamlanmadan etkinleştirilmez. Free paketler ölçek garantisi vermez.

Birincil referanslar: [Supabase Web3 Auth](https://supabase.com/docs/guides/auth/auth-web3), [Supabase Auth Web3 kaynak kodu](https://github.com/supabase/auth/blob/master/internal/api/web3.go), [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Agave precompile listesi](https://github.com/anza-xyz/agave/blob/master/precompiles/src/lib.rs). API referansları1 Ekim2026 tarihinde kontrol edildi; pinli paketler manifest/lock dosyalarındadır.
