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
