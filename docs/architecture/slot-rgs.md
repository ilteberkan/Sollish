# Sollish slot sunucusu (RGS) — hile ve suistimale karşı mimari

Durum: 12 Ekim 2026, sahip kararı. Yalnız DEMO kredisi; gerçek varlık kapıları kapalı kalır (`docs/validation.md`). Amaç: dünyadaki lisanslı sağlayıcıların uyguladığı modeli birebir uygulamak: **sonuç sunucuda, bahis kabul edildiği anda belirlenir; istemci yalnız gösterir.**

## Sektör uygulaması (özet)
- **Uzak Oyun Sunucusu (RGS):** RNG ve oyun motoru sunucuda; istemci sonucu üretemez, değiştiremez, önceden göremez. Lisanslı ortamda RNG ve matematik bağımsız laboratuvarca sertifikalanır (ör. GLI-11/GLI-19, eCOGRA); biz sertifikalı değiliz, bunu iddia etmeyiz.
- **Cüzdan:** borç/alacak sunucuda, tekil işlem kimliği ile **idempotent**; aynı istek tekrar gelirse aynı sonuç döner, iki kez çekim olmaz; başarısız işlemde geri alma (rollback).
- **Tur durumu kurtarma:** sonuç bahis anında kesinleşir; bağlantı koparsa tur yeniden açılışta aynen gösterilir; ödeme sunumdan bağımsızdır.
- **Doğrulanabilir adillik (kripto platformları):** sunucu tohumunun hash'i önceden yayımlanır (commit), oyuncu tohumu + nonce ile birleşir, tohum dönüşümünde açıklanır (reveal); oyuncu her turu kendisi yeniden hesaplar.
- **Kötüye kullanım önlemleri:** oturum başına tek eşzamanlı tur, hız sınırı, bahis/mod/maliyet doğrulaması sunucuda, satın alma ve ante kuralları sunucuda, istemciden gelen hiçbir sonuç alanı kabul edilmez, imzalı tur kayıtları, denetim günlüğü, oyun başına gözlenen RTP izleme ve sapma alarmı, oturum başına maruziyet sınırı.

## Bizim uygulamamız (`apps/realtime`, Cloudflare Workers + Durable Objects)
- **`SlotWallet` Durable Object** (oturum başına bir örnek, SQLite): DEMO bakiye, işlem defteri, tur kayıtları, sunucu tohumu durumu. Bütün mutasyonlar tek iş parçacıklı DO içinde, `exclusive()` ile sıralı.
- **Oturum:** `POST /v1/slots/session` → sunucu üretimli opak oturum belirteci (yüksek entropi, HttpOnly çerez değil — Authorization üst bilgisi; URL'de asla), başlangıç bakiyesi, `serverSeedHash`, `nonce`. Belirteç yalnız hash'iyle saklanır.
- **Tur:** `POST /v1/slots/:game/rounds` gövde `{ betCents, mode, clientSeed, idempotencyKey }`:
  1. Belirteç, oyun kimliği, bahis basamağı, mod, maliyet (`cost(bet, mode)`), bakiye ve oturum kilidi doğrulanır.
  2. Tohum: `seedHex = HMAC-SHA256(serverSeed, clientSeed + ":" + nonce)` ilk 16 bayt.
  3. Motor (`packages/protocol`, istemciyle aynı kod) turu çözer; ödeme `payoutCents`.
  4. Tek atomik işlemde: maliyet düşülür, ödeme eklenir, tur kaydı + defter satırı yazılır, nonce artar.
  5. Yanıt: tur (sunum için tam adım listesi), yeni bakiye, `roundId`, `nonce`, `serverSeedHash`, sunucu imzası (HMAC, sunucu sırrıyla).
  - Aynı `idempotencyKey` → aynı yanıt, ikinci çekim yok. Farklı gövdeyle aynı anahtar → 409.
- **Tohum dönüşümü:** `POST /v1/slots/seed/rotate` eski sunucu tohumunu açıklar, yenisinin hash'ini verir. Tarayıcı açıklanan tohumla geçmiş turları doğrular (`/verify` sayfası).
- **Kurtarma:** `GET /v1/slots/:game/rounds/last` son turu döndürür; sayfa yenilenince tur aynen yeniden gösterilir.
- **Paylaşım:** `GET /v1/slots/replay/:roundId` imzalı, kişisel veri içermeyen tur kaydı (oyun, mod, bahis, tohum yalnız açıklanmışsa, adımlar). Bağlantıyı açan herkes turu izler; bakiye yok.
- **Sınırlar:** oturum başına 1 eşzamanlı istek, ≤ 4 tur/sn ve ≤ 600 tur/dk; gövde ≤ 2 KB; CORS yalnız izinli kökenler; bilinmeyen alanlar reddedilir.
- **İzleme:** oyun ve mod başına tur sayısı, toplam maliyet/ödeme (gözlenen RTP), en büyük kazanç; beklenen RTP'den 4σ sapmada günlük uyarısı. Kişisel veri yok.
- **Gizlilik:** sunucu tohumları ve imza sırrı yalnız DO depolamasında / Worker sırrında; günlüklere, URL'lere, istemciye (açıklanana kadar) çıkmaz.

## İstemci
- `lib/rgs-client.ts`: `RoundSource` arayüzü (`local` — mevcut tarayıcı DEMO'su, `remote` — RGS). `NEXT_PUBLIC_API_URL` tanımlıysa ve RGS erişilebilirse `remote`, değilse `local` (etiketiyle).
- Oyun yalnız sunucudan gelen turu oynatır; bakiye sunucu yanıtından gelir; istemci bakiyesi yalnız gösterimdir.
- Doğrulama: açıklanan tohumla `seedHex` ve motor sonucu tarayıcıda yeniden hesaplanır.

## Test
Eşzamanlı çift istek, tekrar (aynı anahtar), farklı gövdeli aynı anahtar, geçersiz bahis/mod/maliyet, yetersiz bakiye, hız sınırı, belirteçsiz/yanlış belirteç, DO yeniden başlatma sonrası kurtarma, tohum dönüşümü sonrası doğrulama, imza doğrulama, paylaşım kaydında gizli alan olmaması; workerd entegrasyon testleri.

## Uygulama kararları (12 Ekim 2026, yerel; yayımlanmadı)
Kod: `apps/realtime/src/{slots,slot-wallet,slot-replay,slot-monitor,slot-stats,slot-records}.ts`, `packages/protocol/src/{slot-fair,slot-games}.ts`, `apps/web/lib/{rgs-client,use-round-source,slot-verify}.ts`, `apps/web/app/{verify,replay/[id]}`. Kanıt: `ops/evidence/slot-rgs-20261012.json`.

### Açma ve sırlar
- `SLOTS_ENABLED` (wrangler `vars`, varsayılan `"false"`). Kapalıyken her `/v1/slots/*` 503, health `{enabled:false}`.
- `SLOT_SIGNING_KEY` Worker sırrı (≥ 32 karakter; `wrangler secret put` kullanıcı onayı bekler). Yoksa her isolate bellekte rastgele bir anahtar üretir; health ve imzalar `"dev"` der. Bu durumda belirteçler isolate'lar arasında geçmez (kapalı başarısızlık); üretimde açmadan önce sır tanımlanmalı. Anahtar değişirse bütün oturum belirteçleri geçersizleşir.
- Migration `v7`: `SlotWallet`, `SlotReplay`, `SlotMonitor` (yeni SQLite sınıfları; eski migration'lara dokunulmadı).

### Durable Object'ler
- `SlotWallet`, ad `slot:<sha256(token)>`, oturum başına bir örnek. Tablolar: `slot_session` (belirteç yalnız SHA-256), `slot_seeds` (sunucu tohumu, özet, `next_nonce`, `revealed_at`), `slot_rounds` (`UNIQUE(idem)`, `UNIQUE(seed_id, nonce)`), `slot_ledger` (`grant` / `round` / `reset`, borç-alacak-sonraki bakiye), `slot_stats`, `slot_shares`. `CHECK(balance>=0)`. Bilinmeyen belirteçle gelen istek şema oluşturmaz (depolama bırakmaz).
- `SlotReplay`, ad `replay:<roundId ilk 2 hex>` (256 parça). Yalnız paylaşılan turlar; 30 gün sonra silinir.
- `SlotMonitor`: oturumlar sayaç farklarını tur yolunda değil alarmla (`SLOT_MONITOR_FLUSH_MS`, varsayılan 30 sn) kendi shard'ına (`shard:<token hash ilk 8 hex mod SLOT_MONITOR_SHARDS>`, varsayılan 64) gönderir; shard'lar 5 sn'de bir `global`'e toplar (16 Ekim, `docs/architecture/scale.md` §4.2; `SLOT_MONITOR_SHARDS=0` eski doğrudan yol). Her iki atlama en az bir kez teslim (kayıp onayda bir parti iki kez sayılabilir).

### Belirteç
`hex(32 rastgele bayt) + HMAC-SHA256(SLOT_SIGNING_KEY, "sollish-slot-token-1\n"+rastgele)[0..16 bayt]` = 96 küçük hex. Worker etiketi sabit zamanlı karşılaştırır; sahte belirteç hiçbir DO'ya ulaşmaz. Yalnız `Authorization: Bearer <token>`; sorgu dizesi olan her slot isteği 400. Tarayıcıda `sessionStorage` (`sollish:rgs:v1`, API kökenine bağlı).

### Uç noktalar
Hepsi JSON, `Cache-Control: no-store`. Health dışındaki her yol izinli `Origin` ister (yoksa veya izinsizse 403). POST gövdesi `Content-Type: application/json`, ≤ 2048 bayt (parçalı gövde de sayılır), tam alan kümesi (eksik/fazla alan 400).

| Yöntem ve yol | Kimlik | Gövde | Yanıt |
| --- | --- | --- | --- |
| `GET /v1/slots/health` | yok | — | `{v,service,enabled,demo,fair,signature:"worker"|"dev",games:[{id,engineId,modes,betLevels,maxMultiplier}],limits}`; kapalıysa 503 |
| `POST /v1/slots/session` | yok (IP başına 30/dk) | `{}` | 201 `{v,token,balanceCents,serverSeedHash,nonce,expiresAt,signature}` |
| `GET /v1/slots/session` | Bearer | — | `{v,balanceCents,serverSeedHash,nonce,rounds,expiresAt,signature,revealed:[{serverSeed,serverSeedHash,nonces,revealedAt}]}` |
| `POST /v1/slots/:game/rounds` | Bearer | `{betCents,mode,clientSeed,idempotencyKey}` | makbuz (aşağıda); tekrar: aynı bayt + `Idempotent-Replayed: true` |
| `GET /v1/slots/:game/rounds/last` | Bearer | — | `{v,last:makbuz|null,balanceCents,serverSeedHash,nonce}` |
| `GET /v1/slots/history` | Bearer | — | son 50 tur özeti; açıklanmış tohumun turlarında `fair.serverSeed`, diğerlerinde `null` |
| `POST /v1/slots/seed/rotate` | Bearer | `{}` | `{v,revealed:{serverSeed,serverSeedHash,nonces,revealedAt},serverSeedHash,nonce:0}`; o tohumla paylaşılmış kayıtlar açıklanmış haliyle yeniden yayımlanır |
| `POST /v1/slots/balance/reset` | Bearer | `{}` | `{v,balanceCents:100000}`; deftere `reset` satırı |
| `POST /v1/slots/replay` | Bearer | `{roundId}` | `{v,roundId,path:"/replay/<id>",revealed}` |
| `GET /v1/slots/replay/:roundId` | yok (IP başına 30/dk) | — | `{replay,round}`; kayıtta bakiye, zaman, oturum, belirteç, IP yok; tohumlar yalnız açıklanmışsa |

Alan biçimleri: `betCents` oyunun bahis basamaklarından biri; `mode` oyunun modlarından biri (`standard`/`ante`/`buy`); `clientSeed` `[A-Za-z0-9_-]{1,64}`; `idempotencyKey` `[A-Za-z0-9_-]{16,64}`; `roundId` 32 hex. Sonuç alanı (`payoutCents`, `costCents`, `seedHex`, `nonce` …) gönderen istek bilinmeyen alan sayılır.

Makbuz: `{v:1, roundId, game, engineId, mode, betCents, costCents, payoutCents, totalHundredths, balanceCents, at, fair:{version:"sollish-slot-fair-1", serverSeedHash, clientSeed, nonce, seedHex}, signature:{alg:"HMAC-SHA256", key, value}, round}`. `round` motorun tam çıktısıdır (bütün dönüşler, adımlar, ızgaralar). Sunucu satırda yalnız girdileri ve sonucu saklar; makbuzu motorla yeniden üretir (aynı satır → aynı bayt).

İmza metinleri (`packages/protocol/src/slot-fair.ts`), satır sonuyla birleştirilir:
- makbuz: `sollish-slot-receipt-1, roundId, game, engineId, mode, betCents, costCents, payoutCents, totalHundredths, seedHex, serverSeedHash, clientSeed, nonce, balanceCents, at`
- paylaşım: `sollish-slot-replay-1, roundId, game, engineId, mode, betCents, costCents, payoutCents, totalHundredths, seedHex, serverSeedHash, nonce, serverSeed|-, clientSeed|-`
HMAC'i yalnız sunucu doğrulayabilir; oyuncunun bağımsız kontrolü tohum + motor yeniden hesabıdır.

### Doğrulanabilir adillik
`serverSeedHash = SHA-256(32 bayt tohum)`; `seedHex = HMAC-SHA256(tohum, "<clientSeed>:<nonce>")` ilk 16 bayt (32 hex); nonce her tohumda 0'dan başlar, her tur bir artar. Açıklanmış tohumla tur oynanmaz. Bilinen cevap vektörleri `packages/protocol/test/slot-fair.test.ts` (Python `hmac` ile hesaplandı).

### Sıra ve hatalar
Tur: belirteç → oturum süresi (7 gün hareketsizlikte silinir) → bellek içi istek sınırı (12/sn) → tek eşzamanlı istek (aksi `409 SESSION_BUSY`, `Retry-After: 1`; kuyruğa alınmaz) → gövde → idempotency (aynı anahtar + aynı gövde = kayıtlı makbuz; farklı gövde `409 IDEMPOTENCY_CONFLICT`) → kalıcı tur sınırı (4/sn, 600/dk, `429 RATE_LIMITED`) → bahis/mod/maliyet/maruziyet (bahis × azami çarpan ≤ 2.500.000 DEMO kuruş) → oturum tur tavanı 100.000 → bakiye (`409 INSUFFICIENT_BALANCE`) → tohum türetme → motor (sonuç oyunun sınırları dışındaysa reddedilir) → tek SQLite işlemi (oturum, tohum ve nonce işlem içinde yeniden okunur). Diğer kodlar: `401 AUTH_REQUIRED|AUTH_INVALID|SESSION_EXPIRED`, `400 INVALID_MESSAGE|INVALID_BET|INVALID_MODE`, `404 UNKNOWN_GAME|NOT_FOUND`, `413`, `415`, `410 ENGINE_RETIRED`, `503 SERVICE_UNAVAILABLE`. Diğer tavanlar: 1.000 tohum dönüşümü, 500 paylaşım / oturum.

### İzleme
Oyun+mod başına tur, maliyet, ödeme, Σmaliyet², en büyük ödeme. `z = (P − rtp·C) / (σ·√Σc²)` (`rtp`, `σ` motorun simülasyon kanıtından); `SLOT_RTP_MIN_ROUNDS` (varsayılan 1000) turdan sonra |z| ≥ 4 ise tek JSON satırı: `{"event":"slot_rtp_deviation","scope":"global"|"session",game,mode,rounds,costCents,payoutCents,observedRtp,expectedRtp,z,sigma}`. Oturum kimliği, IP, tohum yok. Ağır kuyruk nedeniyle tek büyük kazanç alarm verebilir; alarm insan içindir, sonuca veya ödemeye dokunmaz.

### İstemci
- `RoundSource`: `local` (eski yol: yerel entropi → motor → DemoLedger) ve `remote` (RGS). `NEXT_PUBLIC_API_URL` yoksa ilk çizimden itibaren `local`; varsa health kontrolü bitene kadar dönüş kilitli, health `enabled` ve oyunun `engineId`'si bu yapıyla aynıysa `remote`. Etiket: "Sunucu doğrulamalı" / "Yerel demo".
- Remote turda istemci yerelde rezerv/ödeme yapmaz; bakiye sunucu yanıtıdır. Ağ hatası, 5xx, `SESSION_BUSY` ve `RATE_LIMITED` aynı idempotency anahtarıyla 3 kez yeniden denenir. Sunucunun adım listesi yerelde aynı motorla yeniden üretilip bayt bayt karşılaştırılır; uymazsa tur gösterilmez.
- Sayfa yenilenince bu sekmede gösterimi bitmemiş son sunucu turu (`sessionStorage` `sollish:rgs:shown:<oyun>`) aynen yeniden oynatılır; ödeme sunucuda zaten yapılmıştır. Tur ortasında sayfadan çıkmak hiçbir şey ödemez/geri almaz.
- `/verify`: açıklanan tohum + oyuncu tohumu + nonce (+ isteğe bağlı özet ve beklenen kazanç) ile tarayıcıda yeniden hesap; veya bu sekmenin oturum geçmişi (açıklanmamışlar "Tohum açıklanmadı", "Tohumu açıkla" düğmesi).
- "Kazancını paylaş" yalnız remote modda geçmiş satırında; `/replay/<roundId>` imzalı kaydı alır, turu yerelde yeniden üretip adım adım gösterir, bakiye/defter yok.

### Kapsam dışı / açık
Barındırılan ortamda koşmadı; yük testi, bölge, bot direnci (Turnstile yok), sertifikalı RNG, gerçek varlık yok. Tarayıcı uçtan uca testi bu teslimde yalnız yerel `next dev` + yerel workerd ile (kanıt dosyasına bakın); `build:cloudflare` önizlemesi yok. Global izleme sayaçları en az bir kez teslimdir (yaklaşık).
