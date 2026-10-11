# Sollish operasyon akışı

## Dağıtım sınırları

Cloudflare web ve native WebSocket/DO; Supabase kalıcı veri ve kimlik; Nürnberg ARM VPS Node indexer/outbox/keeper çalıştırır. VPS üzerinde house, upgrade authority veya kullanıcı cüzdan anahtarı tutulmaz. Test keeper'ı için ayrı, sınırlı bütçeli yalnız devnet fee-key gerekir.

Üretim parası, token launch veya ücretli plan bu runbook tarafından açılmaz. Eksik config için503 doğru kapalı durumdur; hazır servis gibi raporlanmaz. PER kapıları geçmeden gerçek Crash sonucu veya cash-out yayınlanmaz.

## Mevcut Cloudflare dağıtımı

Web: `https://sollish-web-devnet.sollish-web.workers.dev` (son web version `6212d442-2122-4d24-9f21-af43b23234ee`, build `UAna6VgAb-vWl6kgnZdH8`); realtime: `https://sollish-realtime.sollish-web.workers.dev`. İlk dağıtımda bu iki Worker adının hesapta bulunmadığı API'den doğrulandı. Başka uygulamalar değiştirilmedi. Web finansal bayrakları kapalıdır; realtime üç DO binding ve sekiz fanout bucket içerir. Hosted Supabase Solana Auth, dört realtime secret binding ve gerçek imzalı oturumla WebSocket bağlantısı doğrulandı. Bahis indeksi ve minimum bahis ayarı tamamlanmadığından chat yazımı `CHAT_UNAVAILABLE`, health503 döner. Bu durum oyun yayını olarak değerlendirilmez.

Wrangler kullanıcı onayıyla `account:read user:read workers_scripts:write offline_access` kapsamlarına sahiptir. Yerel credential dosyası0600 tutulur; içeriği repo/loga yazılmaz. CLI'ın diğer varsayılan kapsamları eksik sayması üzerine izin genişletilmez. Mevcut web ve DO deploy'u bu dar kapsamla başarılıdır.

```sh
bash scripts/use-node.sh pnpm --filter @sollish/web build:cloudflare
bash scripts/use-node.sh pnpm --filter @sollish/web exec wrangler deploy
bash scripts/use-node.sh pnpm --filter @sollish/realtime exec wrangler deploy
```

Web public ayarları build zamanında gömülür; mevcut build doğrulanmış Supabase URL/publishable key ve realtime adresini içerir. Yeni public ayarlar veya program kabulünden sonra `apps/web/.env.example` esas alınarak tekrar build/deploy gerekir. Realtime `ALLOWED_ORIGINS` yayımlanan web adresine sabittir. Yerel geliştirmede `.dev.vars.example` üzerinden loopback origin'leri ayrıca ayarlanır. Secret yönetimi bağlı MCP üzerinden yapılır; CLI gerektiğinde yalnız doğrulanmış devnet kaynakları için kullanılmalıdır.

## ARM VPS

`ssh sunucum` mevcut erişimdir. `scripts/setup-vps-runtime.sh` Debian ARM64 üzerinde resmi checksum ile Node24.21.0'ı `/opt/sollish/runtime` altına kurar. `sollish-worker` giriş yapamayan servis kullanıcısıdır. SSH/firewall ayarlarını değiştirmez.

```sh
bash scripts/use-node.sh pnpm build:worker
bash scripts/use-node.sh pnpm test:worker-bundle
bash scripts/deploy-worker.sh
ssh sunucum 'systemctl is-active sollish-worker.service'
ssh sunucum 'curl -sS http://127.0.0.1:8790/health'
```

Deployment SCP ile yalnız paket, build metadata ve systemd unit taşır; secret taşımaz. Artifact SHA256 uzakta yeniden doğrulanır, `/opt/sollish/releases/<sha256>` içine yüklenir. Tekil `flock` kilidi eşzamanlı dağıtımı engeller; candidate unit `systemd-analyze verify` kontrolünden geçmeden var olan unit değiştirilmez. `/opt/sollish/current` atomik değiştirilir. Restart veya40saniyelik health kontrolü başarısızsa önceki artifact, unit ve active/enabled durumu geri alınır; ilk sürümde servis durdurulur.

Health yanıtı servis kimliği ve alan tipleriyle kontrol edilir. Yapılandırılmış servis yalnız `ready:true` ile kabul edilir; DB/chain sorunu olan yapılandırılmış servisin503 yanıtı başarısız dağıtımdır. Henüz yapılandırılmamış servis için503 yalnız `configured:false`, `ready:false`, `lastSuccess:null` ve keeper kapalıysa kabul edilir. Bu bekleme durumudur, devnet yayını değildir. Güncel betikle olumlu VPS dağıtımı ve aşağıdaki kontrollü sağlık hatasında otomatik rollback doğrulandı.

Unit: ayrı kullanıcı, salt okunur sistem, private tmp/devices, capability yok,512MB bellek sınırı, bir çekirdek CPU kotası ve yeniden başlatma sınırı. Uygulama portu8790 yalnız127.0.0.1'e bağlıdır. ReadWritePaths yalnız `/var/lib/sollish-worker`.

### Uzak sağlık hatası ve geri dönüş denemesi — 1 Ekim 2026

Tek kontrollü deneme **14:35:37 UTC**'de başarıyla doğrulandı. Ön kontrolde yalnız kendi `sollish-worker` servisi `active/running`, `enabled` ve yapılandırılmamıştı; root sahibi `0600` ortam dosyasında yalnız `NODE_ENV` bulunuyordu. Asıl kaynakları değiştirmeyen bağımsız fixture, `scripts/deploy-worker.sh` dosyasının byte eşit kopyasını kullandı (SHA256 `5a9ff2f45b90d7c0000c7d778110c51652278fbacf889057f3012af2d3693e84`).

Aday paket yalnız mevcut `127.0.0.1:8790` adresinde HTTP503 döndürdü; kasıtlı `service: "rollback-fixture"` kimliği gerçek sağlık kapısını başarısız kıldı. Servis dosyasının yalnız açıklaması farklıydı. **14:35:07 UTC** ara gözlemi, hatalı adayın gerçekten çalıştığını ve ortam dosyasının değişmediğini doğruladı. Aday paket veritabanına veya dış ağa erişmedi; Solana RPC/fon kullanılmadı ve yeni port açılmadı.

Dağıtım **50,842 saniyede exit 1** ile sonuçlandı; `Health gate did not pass` sonrası betiğin kendi rollback yolu çalıştı. Manuel kurtarma gerekmedi. Son kontrol eski symlink, artifact, unit, dosya sahipliği/izinleri ve active/enabled durumunun geri geldiğini doğruladı:

| Kontrol | Geri yüklenen SHA256 / durum |
| --- | --- |
| Artifact | `f8dbc7516c4846f9ae7f90f64ebdff431b7bc01ab5a1d56dbb0b63fa5392ffb0` |
| Systemd unit | `7bb048680f52abcf30ba1da7683173dba4a05327f823b7a61f63c3375563ba58` |
| Ortam dosyası | `628b969b104157c4e25f043477fe8302e4ab1770fe43e3486cf4069866294205`; içerik değiştirilmedi veya loglanmadı |
| Servis / health | `active/running`, `enabled`; HTTP503, `service: worker`, `configured:false`, `ready:false`, `lastSuccess:null`, `keeper: disabled-no-deployment-or-fee-key` |

Yerel kanıtlar `.tooling/worker-rollback-probe/` altında `before.json`, `during.json`, `after.json`, `result.json` ve `deploy.log` dosyalarıdır. Önceki sürüm korundu; test adayı aktif değildir. Bu deneme sağlık doğrulaması başarısızlığını ve o yoldaki artifact/unit geri dönüşünü kapsar; yapılandırılmış DB/keeper, ilk kurulum rollback'i, restart hatası veya uzun süreli yük testi değildir.

## Gizli yapılandırma

`/etc/sollish/worker.env` root0600'dür; deployment var olan dosyayı korur. Mevcut dosyada NODE_ENV, realtime URL, yayın HMAC anahtarı, `KEEPER_ENABLED=false`, doğrudan Supabase DATABASE_URL, devnet RPC ve NODE_EXTRA_CA_CERTS bulunur. HOUSE_ADDRESS ve doğrulanmış GAMES_PROGRAM_DATA_SHA256 henüz eklenmediğinden indexer çalışmaz. Gerekli alanlar `apps/worker/.env.example` içinde açıklanır. URL/parola/anahtarları komut geçmişine, Git'e veya sohbet çıktısına koymayın.

Supabase `sollish_worker` LOGIN rolü migration'daki dar fonksiyon yetkileriyle kullanılmalı; postgres/service-role veritabanı hesabı kullanılmaz. Uzak TLS sertifikası doğrulanır. HMAC publish secret yalnız realtime ve outbox'ta bulunur. Supabase service key yalnız realtime sunucu secret'ıdır; tarayıcıya giden publishable key'den ayrıdır.

Hosted worker rolü ayrı yüksek entropili SCRAM parolası ve beş bağlantı sınırıyla etkinleştirildi; superuser/BYPASSRLS/rol üyeliği yoktur. Kimlik bilgileri schema migration'larına eklenmez. Doğrudan IPv6 `db.lutwdmwkogtzajxvbuiy.supabase.co:5432/postgres` kullanılır. Worker session advisory lock tuttuğu için transaction pooler6543 kullanılmaz. Oturum pooler'ına geçilecekse gerçek dashboard hostu ve aynı oturuma bağlı lock davranışı ayrıca doğrulanır.

Bu projede kullanılan CA, [resmî Supabase CLI sabit kaynağındaki 2021 sertifikasıdır](https://raw.githubusercontent.com/supabase/cli/703afc860284dc9203d816eff4d0893f6f9c1c97/apps/cli-go/internal/gen/types/templates/prod-ca-2021.crt): SHA256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. `/etc/sollish-ca/supabase-root-2021.crt` root0644, üst dizin root0755; worker env'de `NODE_EXTRA_CA_CERTS` bu dosyayı gösterir. Gizli env dosyasının bulunduğu `/etc/sollish` root0700 kalır. Node başlangıcında yüklenir; CA değişikliği restart gerektirir. `rejectUnauthorized:true` ve hostname doğrulaması korunur; sistem çapında TLS doğrulaması kapatılmaz. 2025 CA bu endpoint'i doğrulamadı. Sertifika değişiminde güncel resmî zincir ve hostname yeniden denetlenir.

[Managed DB probe](../scripts/check-managed-db.mjs), mevcut worker bağımlılığını kullanarak taşınabilir Node24 paketi olarak üretilir:

```sh
bash scripts/use-node.sh node --input-type=module <<'NODE'
import { build } from 'esbuild';
await build({ entryPoints: ['scripts/check-managed-db.mjs'],
  outfile: '.tooling/check-managed-db-acceptance.mjs', bundle: true,
  platform: 'node', target: 'node24', format: 'esm',
  nodePaths: ['apps/worker/node_modules'], sourcemap: false });
NODE
```

Paket SHA256 doğrulanarak VPS'ye taşınır. Root yalnız `DATABASE_URL` ve `NODE_EXTRA_CA_CERTS` değerlerini korunan env'den belleğe alır; işlem `sollish-worker` UID/GID ile başlatılır. Parola komut argümanına veya stdout'a konmaz. Probe CA'nın Node başlangıcında gerçekten yüklenmesini, dar rolü, gerçek SELECT reddini ve aynı session'da advisory lock temizliğini sınar. Read-only transaction, savepoint ve rollback kullanır; cursor/fact/outbox yazmaz. Başarı, ödeme veya indeks hazır demek değildir. [19:32UTC12 kontrolün kanıtı](../ops/evidence/managed-db-vps-20261001.json) mevcut; yeni ortam için tekrar çalıştırılmalıdır.

Keeper journal için `/var/lib/sollish-worker/keeper` dizini servis kullanıcısına ait0700, fee-key0600 olmalıdır. Ayrı fee-key house/program upgrade authority olamaz. ProgramData hash pin'leri, finalized devnet deployment'ın45-byte Loader-v3 metadata sonrası tüm tahsisli verisinden hesaplanır; yerel ELF hash'i olduğu varsayılmaz.

Keeper her bahis için imzayı diske yazdıktan sonra bir send yapar. Timeout'ta otomatik yeni işlem üretmez. SIGKILL sonrası lock otomatik kaldırılmaz: önce servis durdurulur, pending imzalar ve finalized hesaplar incelenir; journal ve toplam ücret rezervi korunarak müdahale edilir. Ayrıntı [backend belgesinde](backend.md).

## Bulut devnet açılışı

1. **Tamamlandı:** Supabase Frankfurt Free proje, iki migration, sekiz özel tablonun RLS/ACL kontrolleri ve gerçek Solana SIWS kabulü. Yerel auth fixture'ı gerçek hosted kabulün yerine sayılmaz.
2. **Tamamlandı:** Cloudflare Worker/DO dağıtımı, realtime secret'ları, kesin Origin allowlist'i ve public web ayarları. Gerçek login/logout ve eski token'ın reddi doğrulandı.
3. **Kısmen tamamlandı:** Dar worker DB rolü, TLS CA ve VPS bağlantı ayarları hazır. Gerçek Games deployment/hash ve house bilgisi olmadığından indexer hâlâ kapalıdır.
4. House+Games için yeterli devnet fonu ve açık program anahtarlarıyla dağıtım yapılır; önce yalnız kendi cüzdanlarıyla ödülsüz Coinflip kabulü yürütülür. Gerçek VRF callback, ödeme, rezerv ve rent doğrulanır. Oracle kesintisi/recovery kabulü ayrı gerekliliktir.
5. Doğrulanmış finalized program hash'leriyle indexer açılır. Açık minimum bahis ayarı, gerçek uygun/uygun olmayan wallet chat koşulu ve outbox fanout sınanır. Token pool/faz, stake/unstake ve saatlik tek claim ayrıca kabul edilir; tamamlanmamış özellik bayrakları açılmaz.
6. Manuel Crash için gizlilik/sıralama/ödeme kapıları tamamlanır. Mainnet için ayrı audit, sağlayıcı kabulü, ülke/işletme kapsamı ve bütçe kararı gerekir. Bir free/paid plan tek başına gambling faaliyetini onaylamaz.

## Geri dönüş ve gözlem

Eski artifact dizinleri korunur; on-chain upgrade veya SQL veri silme bu deployment'ın parçası değildir. Geri dönüşte mevcut hash dizinine symlink atomik alınır ve servis yeniden başlatılır. Önce journal/pending işlemler incelenir; iki keeper aynı anda çalıştırılmaz.

`systemctl status`, filtrelenmiş journal ve loopback health kullanılır. `/health` yapılandırma, son başarılı index/outbox döngüsü ve keeper durumunu gösterir; bakiye veya secret içermez. Yeniden başlatma, RPC kesintisi ve outbox tekrarları yerel test kapsamındadır; haricî alarm teslimatı ve uzun süreli küresel yük henüz doğrulanmamıştır.
