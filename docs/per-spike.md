# PER + VRF + manuel Crash: kabul deneyi

Tarih: **1 Ekim 2026**. Durum: **kendi devnet probe'u dağıtıldı ve sınırlı canlı deney tamamlandı; genel G0 BLOCKED kalır**. Tarihsel **00:30 UTC G0 raporu** 23 sınırlı PASS ve 14 BLOCKED içeriyor; yeni gözlemler bu sonucu geriye dönük değiştirmez. RPC, QFS auth, taze/önbellekli TDX quote imzası ve challenge/reportData doğrulandı; bağımsız uygulama ölçümü allowlist'i ve quote→validator→program bağı eksik. [Çalışan deney](../experiments/per/README.md), [G0 kanıtı](../experiments/per/evidence/g0-latest.json) ve [sonraki kendi deployment kaydı](../experiments/per/evidence/own-probe-deployment.json) ayrı tutulur. **G1–G8 güvenlik kabulü tamamlanmadı; tam gizlilik, manuel cash-out veya L1 oyun ödemesi PASS değildir.**

Önceki finansman engeli **14:06 UTC'de ücretsiz 2 devnet SOL** ödemesiyle çözüldü; [finalized kanıt ve aşamalı bakiye kaydı](devnet-funding.md). Bu, güncel payer bakiyesi değildir: deploy ve oyuncu/hesap fonlamaları daha sonra yapıldı. Önceki gözlemlerde ilk faucet isteği RPC internal error, sonraki istek HTTP429 vermişti. 05:24 ve 09:16 UTC kontrollü denemeleri de `RPC -32603 Internal error` verdi; o kontrollerde bakiye 0 idi. Ücretsiz PoW yolu gözlenen havuzlar/başlangıç ücretleri nedeniyle çalıştırılmadı; ücretli servis alınmadı. Kasa/Coinflip yerel çalışması bağımsız ilerler; bu deney geçmeden PER tabanlı manuel Crash güvenli/üretime hazır kabul edilmez.

[Kendi probe programı](../experiments/per/program/README.md) Anchor 1.2.0 + rollups SDK 0.16.2 + VRF SDK 0.4.1 ile derlendi; kendi kaynak/IDL/anahtar kimlikleri doğrulandı. **14:35:21 UTC**'de finalized deployment, slot `506304685`, **292.384 byte** ELF ve yerel hash eşitliği doğrulandı; allocation padding yok, buffer kapandı. **14:35:40 UTC** [TEE RPC kopyasında aynı ELF](../experiments/per/evidence/own-probe-tee-copy.json) gözlendi; bu bir attestation kanıtı değildir. Inspector okuma üyesidir; yerel durum/nonce testleri ile sonraki sınırlı canlı gözlemler ayrı değerlendirilir.

**14:36 ilk çalıştırması** B receipt onay kontrolünde HTTP429 ile BLOCKED döndü. [14:38 UTC uzlaştırması](../experiments/per/evidence/interrupted-l1-initialization.json), round ve A/B receipt başlangıçlarının üçünü de finalized/`err:null` doğruladı; sözleşme hatası yoktu. Delegation, private permission, VRF ve erişim matrisi bu ilk koşuda çalışmadı.

**14:47:24–14:49:45 UTC [aynı round ile devam](../experiments/per/evidence/probe-resume-initialized-latest.json)** `COMPLETED_LIMITED_EXPERIMENT` döndü; genel durum BLOCKED ve üretim onayı false kaldı. Üç eski başlangıç yeniden gönderilmedi. Private permission VRF'den önce kuruldu, scoped callback `READY` üretti; iki readonly oyuncu komutu da receipt nonce/count 1/1 ile doğrulandı, reveal tamamlandı. [14:51:26 UTC son kontrol](../experiments/per/evidence/own-probe-final-readback.json) altı L1 işlemini finalized/`err:null` doğruladı. Beş TEE işleminin TEE RPC'deki finalized sonucu L1 commit veya ödeme kanıtı değildir.

95 HTTP satırı ve 107 tarama gözlemi içinde 71 doğrudan secret-byte taramasında eşleşme yoktu. Ayrı 36 VRF türetim denemesinin tamamı `UNPARSEABLE_OR_INCOMPLETE` / `Invalid message signature header` döndü, **0 aday** üretildi; bundan VRF gizliliği sonucu çıkmaz. Altı private round okumasındaki `null` erişim reddini kanıtlamaz. Sekiz readonly ve sekiz writable-promoted simülasyon başarılıdır; writable yükseltmenin engellendiği gösterilmedi. WS, uçuş halindeki kendi queue request'i, bağımsız input/proof bağı, attestation ve ödeme açık kabul koşullarıdır.

Probe'un 5 davranış, 10 SBF runtime ve 3 IDL testi geçti. Sentetik ACL/Pending ve yerel callback fixture'ı kapsamı ayrıca belgelenmiştir. [05:36 UTC tarihsel rent kontrolü](../experiments/per/evidence/deployment-plan-2026-10-01T05-36-41.513Z.json) kalıcı rent'i yaklaşık 1,487 test SOL, geçici buffer da ayrı sayılan ihtiyatlı zarfı yaklaşık 2,973 test SOL ölçmüştü. [Agave CLI incelemesi](../experiments/per/evidence/cli-deploy-fee-analysis.md), buffer rent yeniden kullanımını doğruladı. Gerçek deploy rent/fee toplamı **1,488567680 SOL** oldu; **14:35:21 UTC deploy sonrası**, oyuncu fonlaması öncesi payer bakiyesi **0,511432320 SOL** idi. 3 SOL minimum değildir; bu maliyet PER güvenlik onayı üretmez.

1 Ekim sonraki [TEE kimliği incelemesi](../experiments/per/evidence/tee-identity-review.md), imzalı quote anahtarı ile belgelenen validator anahtarının farklı olduğunu doğruladı. Bu tek başına saldırı kanıtı değildir; aralarında bağımsız doğrulanmış bağ ve yayınlanmış ölçüm politikası bulunmadığı için üretim kapısı açık değildir.

## Amaç ve kapsam

Doğrulanacak birleşim: sonuç tur bitmeden gizli kalır; oyuncu gizli sonucu okuyamadan manuel cash-out gönderebilir; protokolün kabul ettiği çıkış tek bir Solana ödeme hakkına bağlanır. WebSocket, tarayıcı saati, keeper veya PostgreSQL bu üç özelliğin otoritesi olamaz.

Tehdit modeli oyuncuyu, izleyiciyi, uygulama operatörünü, oracle'ı ve PER sağlayıcısını ayrı değerlendirir. VRF doğruluğu oracle'ın sonucu bilmediğini göstermez. RPC'de gizlilik testi geçmesi, oracle'ın veya TEE dışındaki süreçlerin sonucu öğrenemediğini tek başına kanıtlamaz. Donanım/attestation, sıralama, sansür ve erişilebilirlik varsayımları raporda açık kalır.

Yalnız kendi program ve test hesaplarımızla localnet/devnet üzerinde çalışılır; değer taşıyan fon kullanılmaz. Yerel Query Filtering Service (QFS), TEE giriş filtresini taklit eder; gerçek Intel TDX attestation sağlamaz. Yerel sonuçlarla devnet TEE güvenlik sonucu aynı sayılmaz. [Yerel PER rehberi](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/local-development)

## Sabitlenen resmî kaynaklar

| Kaynak | İncelenen commit |
| --- | --- |
| `magicblock-engine-examples` | `e8393c60a82f73259a39abe807c6273a83659d0a` |
| `solana-vrf` | `52b103c5d55d72e07456a445044b3c006cb87c1a` |
| `ephemeral-rollups-sdk` | `fb19a37c829f4c7487b4101a12ddd76577dbf668` |
| `delegation-program` | `fb6668c7b5ffd6a89bedee1d13b16402fd0e65de` |

Private Counter ve Delegated Roll Dice Rust manifestleri Anchor **1.0.2** + `ephemeral-rollups-sdk` **0.16.2** kullanıyor. Private Counter TypeScript manifesti `@magicblock-labs/ephemeral-rollups-sdk` **0.14.3**, `@coral-xyz/anchor` **0.32.1** içeriyor. Bunlar referans örneğin sürümleridir; kendi probe bağımlılıkları yukarıda ayrıca verilmiştir. Rust ve TypeScript paketlerinin sürüm numaraları aynı paket gibi yorumlanmaz. [Rust manifesti](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/programs/private-counter/Cargo.toml), [TS manifesti](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/package.json)

Yeni Roll Dice akışı `create_request_scoped_randomness_ix` ve `#[vrf_callback]` kullanır. Makro, bu tüketici programına bağlı `scoped_vrf_identity(&crate::ID)` signer'ını doğrular; SDK kaynağı eski global identity kontrolünü deprecated olarak işaretler. Eski `ephemeral-vrf-sdk 0.3.0` kullanan Rewards örneğiyle bu akış karıştırılmaz. [Callback makrosu](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/fb19a37c829f4c7487b4101a12ddd76577dbf668/rust/vrf-macro/src/lib.rs)

Bu tablo kaynak kimliklerini gösterir. Güncel canlı owner/program-data/hash gözlemleri G0 JSON'undadır; bunlar kaynakla derlenmiş binary eşleşmesi değildir. Yerel ön deney TS SDK `0.17.3` ve DCAP QVL `0.3.9` kullanır; kasa/Coinflip Anchor `1.2.0`, Coinflip VRF SDK `0.4.1` sürümündedir. Örnek manifest sürümleri bu bağımlılıkların yerine geçirilmez.

| Referans | Belge/kaynakta görülen değer |
| --- | --- |
| PER devnet endpoint | `https://devnet-tee.magicblock.app` |
| TEE validator | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` |
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| VRF program | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz` |
| Delegated VRF queue | `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` |
| Güncel EphemeralPermission program | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| Private Counter `declare_id!` | `9aXAUZm1SdXcX4m1W5SHAywp6CBUbUxymruMnkYvz9bR` |
| Rewards devnet örneği | `rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y` |

[PER quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart), [VRF queue bilgisi](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/technical-details), [Private Counter kaynak kodu](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/programs/private-counter/src/lib.rs), [Rewards yapılandırması](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/rewards-delegated-vrf/anchor/Anchor.toml).

**Kimlik uyuşmazlığı:** Delegated Roll Dice `Anchor.toml` adresi `D74Ho1cWBHgZNpVG4FnBBA4JtjX4HFZ5QqqRXXVKA8gM`, kaynak `declare_id!` adresi `3YAqv3GbcFzWwLcv1gZNjj2Nhr9FoxKkFaLDkfUCXXLj`. Aynı commit'teki bu fark çözülmeden örnek doğrudan çalıştırılabilir sayılmaz. Yeni deney programının kendine ait kimliği olur; başka deployment'ın anahtarı kullanılmaz. [Anchor.toml](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/roll-dice/anchor/Anchor.toml), [program kaynağı](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/roll-dice/anchor/programs/roll-dice-delegated/src/lib.rs)

## Araştırmada bulunan sınırlar

- Roll Dice callback'i randomness byte'larını logluyor. Bu örnek gizli Crash için olduğu gibi kullanılamaz. VRF `ProvideRandomness` işlemi output/proof alır; callback verisi output hash'inden üretilir. Sonuç hesabının private olması işlem verisi, inner instruction, log veya oracle tarafını otomatik gizlemez. [Fulfillment kodu](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/provide_randomness.rs)
- PER izin modeli hesap okuması ve işlem görünürlüğünü etkiler. Oyuncuyu cash-out gönderebilsin diye gizli round hesabına üye yapmak ona sonuç okuma yetkisi verebilir. Doğrudan oyuncu işlemi ile gizli program durumu etkileşimi deneyin temel kapısıdır. [Yetkilendirme](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/authorization), [güncel erişim kontrolü](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control)
- İncelenen commit yolu validator authority, whitelist ve nonce sırasını kontrol eder; tüm Crash yürütmesini L1'de yeniden hesaplayan bir kanıt değildir. Provider/attestation güveni ile VRF matematiksel doğruluğu ayrı raporlanır. [Commit kodu](https://github.com/magicblock-labs/delegation-program/blob/fb6668c7b5ffd6a89bedee1d13b16402fd0e65de/src/processor/fast/commit_state.rs)
- `#[action]` tek başına çağrı yetkilendirmesi sağlamaz. Değer taşıyan Magic Action handler'ı doğru türetilmiş `escrow` signer'ını ve kendi program PDA'mıza bağlı `escrow_auth` hesabını doğrulamalıdır. [Magic Actions güvenlik açıklaması](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/magic-actions/troubleshooting)
- Public VRF çıktısını önce L1'e yazıp sonra private hesaba taşımak geçmişteki ifşayı gidermez. Bu yol gizli Crash şartını sağlamaz; sessiz fallback yapılamaz.

## Deney düzeni ve sonuç biçimi

Roller: iki oyuncu, anonim izleyici, uygulama operatörü ve yetkili oracle. Localnet'te kontrol ettiğimiz oracle'ın gördükleri de kaydedilir; devnet oracle iç süreçlerine erişim varmış gibi davranılmaz. Base RPC, PER/QFS RPC ve WS ayrı gözlem noktalarıdır; gözlemci erişimlerinin beklenen kapsamı önceden yazılır.

Her test `PASS`, `FAIL` veya `BLOCKED` üretir. `PASS` tekrar üretilebilir işlem/hesap kanıtı gerektirir; doküman iddiası veya beklenen hata yeterli değildir. Desteklenmeyen RPC yöntemi, ulaşılamayan oracle veya eksik deployment bilgisi `BLOCKED` olur. Test edilmemiş madde başarılı sayılmaz.

Kanıt paketi; kaynak/SDK/IDL/program hash'leri, endpoint/validator/queue kimlikleri, test girdileri, işlem imzaları, slotlar, kabul sırası, son bakiyeler ve ölçülen gecikmeleri içerir. Auth token ve özel anahtarlar kayda girmez. Randomness tur sonrası açıklanarak önceki gözlem kayıtlarında geriye dönük aranır; test verileri üretim sırrı değildir.

## Kabul kapıları

### G0 — Sürüm, deployment ve attestation

Kaynak `declare_id!`, Anchor yapılandırması, IDL ve canlı executable/program-data kimlikleri eşleşmeli. Program hash'i ve upgrade authority, queue sahibi/delegation durumu ve TEE validator kimliği kaydedilmeli. Kullanılan SDK'nın gerçek attestation API'si ve doğrulanan measurement/identity kapsamı incelenmeli; yalnız HTTPS veya auth token başarı sayılmaz. Yerel QFS sonucu donanım doğrulaması yerine geçmez. Kimlik farkı, belirsiz TEE queue desteği veya doğrulanamayan attestation bu kapıyı durdurur.

### G1 — Gizli randomness yaşam döngüsü

İzinler randomness talebinden önce kurulmalı; bahisler kapanmadan sonuç seçimine geçilmemeli. Program+round+tekil request kimliği değiştirilemez bağ oluşturmalı; aynı round için sonuç görüldükten sonra yeniden talep yapılamamalı. Public başlangıç, izin değiştirme, otomatik commit, undelegation ve recovery yolları erken ifşa için sınanmalı. Düşük entropili crash çarpanının hash'i gizli taahhüt sayılmamalı; taahhüt gerekiyorsa tam entropili girdiye ve alan ayrımına dayanmalı.

### G2 — Görünürlük matrisi

Request → fulfillment → callback → tur sonu boyunca tüm rollerle hesap/program sorguları, queue, transaction/inner instruction/return data/log, block, simulation ve WS abonelikleri kontrol edilmeli. Ham çıktı/proof veya sonucu yeniden üretmeye yeterli bilgi tur bitmeden yetkisiz tarafa ulaşırsa `FAIL`. Logları silmek tek başına yeterli değildir. Oracle'ın çıktıyı bilmesi ve hangi ortamda hesapladığı ayrıca açıklanmalı; devnet'te gözlemleyemediğimiz sağlayıcı içi gizlilik için `PASS` yazılmamalı.

### G3 — Okuma yetkisi olmadan manuel cash-out

Oyuncu yetkili çıkış komutunu kabul ettirebilmeli; gizli round hesabını okuyamamalı. Üyelik verilmesi, ek hesaplar, başka program/CPI, transaction'a eklenen talimat ve simulation/return-data yollarıyla gizli veri çıkarımı denenmeli. İstemcinin gelecekteki zamanı/çarpanı vererek sonucu sorgulayabildiği bir oracle oluşmamalı. Mevcut izin modeli bunu sağlayamıyorsa doğrudan yol `FAIL`; public istek kuyruğu + özel yürütücü gibi yeni model ayrıca tasarlanıp sıralama/gecikme açısından onaylanmadan başarılı sayılmaz.

### G4 — Cash-out sırası ve oturum yetkisi

Protokol, geçerli kabul sırası ve crash sınırı için tek deterministik kural uygulamalı; tarayıcı saati karar kaynağı olmamalı. İki oyuncunun eşzamanlı, yinelenen ve yeniden sıralanan istekleri; sınır öncesi/sonrası işlem, ağ gecikmesi ve reconnect denenmeli. Varsa oyun oturum anahtarı program/işlem/tutar/süre/iptal sınırlarıyla test edilmeli. Replay farklı oyuncu/round'a taşınamamalı; alıcı değiştirilememeli. VRF doğruluğu sansür veya validator sıralama adaletinin kanıtı diye sunulmamalı.

### G5 — Callback bağlama ve tekrar koruması

Doğru scoped VRF signer'ı yanında pending request/queue/round/state bağı aranmalı. Yanlış signer, başka programın geçerli identity'si, yanlış hesap/queue, gecikmiş callback, tekrar callback, sahte sonuç ve ikinci request reddedilmeli. Yetkili callback bile yanlış round'u değiştirememeli. Başarısız callback ve oracle gecikmesinin yeniden deneme davranışı kaydedilmeli; farklı sonuç seçen tekrar akışı olmamalı.

### G6 — Solana ödeme bağı

PER'deki kabul; program, round, bet, oyuncu, ödeme tutarı ve tekil revision'a bağlı bir hak üretmeli. L1 doğru commit edilmiş hesabı/kanıtı kontrol edip hakkı bir kez tüketmeli; UI/keeper'ın serbest gönderdiği tutarı kabul etmemeli. Sahte/eski commit, yanlış owner/seeds/discriminator, alıcı veya tutar değişikliği, doğrudan action çağrısı, yabancı escrow ve çift ödeme reddedilmeli. Action başarısızlığı ve yeniden denemede bakiye/rezerv korunmalı; PER ve base-chain aynı yükümlülüğü iki kez harcayamamalı. Devnet ER kabulü, L1 commit ve cüzdan ödemesi gecikmeleri ayrı ölçülmeli.

### G7 — Kesinti ve kurtarma

Oracle yanıtı geciktirme, PER bağlantı kesintisi, keeper durması, commit/action başarısızlığı ve yeniden başlatma sınanmalı. Önceden kabul edilmiş hak korunmalı; timeout operatöre kaybeden round'u seçerek iptal etme imkânı vermemeli. Gizli hesap commit edilmeden kurtarma gereksinimi ortaya çıkarsa veri kaybı/ifşa/erişilebilirlik karşılığı açıkça çözümlenmeli. Recovery yolu desteklenmiyor veya doğrulanamıyorsa parasal Crash bu kapıdan geçemez.

### G8 — Upgrade ve audit kapsamı

Program/SDK/validator değişikliği kanıtlanan varsayımları geçersiz kılabilecek bir olaydır; sürüm/measurement değişimi algılama, yeni bahisleri durdurma ve açık hakları koruma yolu test edilmeli. Tüm upgrade authority'ler ve oracle/permission/commit güvenleri listelenmeli.

Audit sayfası VRF için Zenith, delegation için Halborn raporlarını listeler; Permission programı için eski `BTWAqWNBmF2TboMh3fxMJfgR16xGHYD7Kgr2dPwbRPBi` adresi ve **Audit: TBC** gösterir. Güncel quickstart `ACLseo…` kullanıyor. Bu çelişki çözülmeden güncel permission deployment'ının denetlendiği varsayılmaz. Rapordaki commit ve kapsam canlı binary ile karşılaştırılmalı; sağlayıcı audit'i bizim Crash/vault audit'imiz değildir. [Audit sayfası](https://docs.magicblock.gg/pages/overview/additional-information/security-and-audits)

## Vault sonrasında uygulama sırası ve önkoşullar

1. Vault rezervi, yetki ve tek-ödeme testleri tamamlanır; bu sonuç PER uyumluluğunu kendiliğinden kanıtlamaz.
2. İzole deney için sürüm/kimlik manifesti, kendi devnet program kimliği ve sınırlı test cüzdanları hazırlanır. Mevcut vault toolchain'i doğrulamadan değiştirilmez; kurulum ve test ağı maliyeti önceden belirlenir.
3. Önce Private Counter ve scoped VRF parçaları ayrı çalıştırılır; IDL/kimlik farkları çözülür. Yerel oracle+QFS gözlemleri hazırlanır; sonra gerçek devnet TEE attestation/queue desteği doğrulanır.
4. G1–G3 geçmeden tam Crash oyunu yazılmaz. G4–G7 için minimal, değersiz test yükümlülüğüyle kabul/ödeme prototipi uygulanır; test kanıtları ve başarısızlıklar kaydedilir.
5. G8 kapsamı ve tüm kapılar değerlendirilir. Tek bir temel gizlilik/ödeme ihlali veya çözülmemiş önkoşul varsa bu entegrasyon kapalı kalır; public randomness, güvenilen backend sonucu veya farklı oyun modeli sessizce ikame edilmez.

Mevcut sonuç: **sınırlı canlı akışı tamamlanan koşullu deney adayı**. Scoped callback ve readonly oyuncu komutu gözlendi; tam VRF gizliliği, okuma vermeden manuel cash-out ve doğrulanmış L1 ödeme bağı henüz gösterilmedi. Mainnet veya gerçek para yetkisi bu belgeden çıkmaz.
