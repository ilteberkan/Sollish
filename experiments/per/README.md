# Çalışan PER devnet ön deneyi

**1 Ekim 2026: kendi devnet probe'u dağıtıldı ve sınırlı canlı deney tamamlandı; G0 ve genel güvenlik kabulü BLOCKED kalıyor.** Scoped callback, iki oyuncunun readonly round komutları ve reveal gözlendi; tam gizlilik, manuel cash-out ve L1 oyun ödemesi doğrulanmadı. Tarihsel **00:30 UTC G0 raporunda 23 sınırlı gözlem PASS, 14 kontrol BLOCKED** bulunur; yeni gözlemler bu raporu geriye dönük değiştirmez. RPC, auth, DCAP quote ve negatif auth kontrolleri çalıştı; quote'un beklenen uygulama ölçümü/validator/çalıştırılan programa bağı doğrulanmadı.

[Kendi izole probe programımızın](program/README.md) kaynak, program anahtarı public key'i, Anchor yapılandırması ve IDL adresi eşleşiyor. [Yerel artifact kaydı](program/artifacts/own-probe-build.json) ile [gözlenen canlı deployment](evidence/own-probe-deployment.json) ayrı kayıtlardır. Manifest'te `observedOwnProbeDeployment` eklenmiştir; `expectedTeeMeasurements` ve `approvedOwnCounterDeployment` **null** kalır. Program yalnız private round ve public oyuncu receipt'iyle erişim/komut/VRF deneyidir; oyun, bahis veya ödeme otoritesi değildir.

## Canlı ilerleme — 1 Ekim 2026, 14:35–14:51 UTC

- **14:35:21 UTC:** `AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va` devnet'te finalized olarak doğrulandı; deployment slot'u `506304685`. [İşlem](https://explorer.solana.com/tx/5LJDTW5QagHVCJyQvzVKEKU2g1hk1hR6rBNk54AiWedKbRxrpD3Bp83QDYsZ4YMWyqDDxvRdiQX1CYSogowdUnoN?cluster=devnet), [kanıt](evidence/own-probe-deployment.json). ELF **292.384 byte**, SHA256 `197a965662b28971bca434633abfaaf2d5d826bdc3ce2f54a1d746554cd99aae`; ek allocation padding yok, buffer kapandı. Upgrade authority ayrı probe payer'dır.
- **14:35:40 UTC:** [TEE RPC kopyasının](evidence/own-probe-tee-copy.json) ELF byte/hash eşitliği görüldü. Bu RPC gözlemi donanım/uygulama attestation'ı değildir; [TEE kimliği incelemesindeki](evidence/tee-identity-review.md) quote→validator→program bağı ve bağımsız ölçüm politikası eksiktir.
- **14:35:55 UTC:** mevcut iki test oyuncusuna ayrı ayrı **0,025 devnet SOL**, toplam **5.000 lamport** işlem ücretiyle finalized olarak aktarıldı ([işlem](https://explorer.solana.com/tx/39XUnmyj2c4isxrg3xJipDP23Z1boVCWBhZ2LtWcmhsm74TR2CezMp43eVFbcGxXZnHJLopaiPF8oCAtWwGSYi7T?cluster=devnet)); kayıt `.tooling/per/player-funding-finalized.json`.
- **14:36 run / 14:38 uzlaştırma:** round ve A/B receipt başlangıçları gönderildi. Runner, B işleminin onay kontrolünde HTTP429 nedeniyle BLOCKED döndü; sözleşme hatası raporlanmadı. [Salt okunur uzlaştırma](evidence/interrupted-l1-initialization.json) üçünün de finalized/`err:null` olduğunu ve hesap owner/boyutlarını doğruladı. Delegation, private permission ve VRF aşamasına bu ilk çalıştırmada geçilmedi.
- **14:47:24–14:49:45 UTC:** [aynı round/journal ile açık devam](evidence/probe-resume-initialized-latest.json) `COMPLETED_LIMITED_EXPERIMENT` döndü; `status` ve G0 **BLOCKED**, `productionApproval:false` kaldı. WAL'daki **11 confirmed adım**, yeniden gönderilmeyen üç tarihsel başlangıcı da içerir. Private permission VRF isteğinden önce kuruldu; scoped callback round'u `READY` yaptı. Her iki oyuncunun readonly round komutu receipt'te `lastNonce=1`, `acceptedCount=1` üretti; kontrollü reveal tamamlandı. Oyun veya ödeme çalıştırılmadı.
- **14:51:26 UTC:** [son salt okunur kontrol](evidence/own-probe-final-readback.json) altı L1 işlemini finalized/`err:null` doğruladı. Beş TEE işlemi de **TEE RPC tarafından** finalized/`err:null` bildirildi; bu, L1 commit/ödeme kanıtı değildir. Anonim reveal sonrası round `Revealed` durumunda, receipt sayaçları 1 ve randomness hash'i önceki raporla aynıydı; ham randomness kaydedilmedi.

Son deney **95 HTTP satırı ve 107 tarama gözlemi** içerir: 71 doğrudan secret-byte taramasında eşleşme yoktur; 36 VRF türetim denemesinin tamamı `UNPARSEABLE_OR_INCOMPLETE` / `Invalid message signature header` ile sonuçlanmış ve **0 aday** üretmiştir. Bu ikinci grup VRF gizliliği kanıtı değildir. Private aşamadaki altı round `getAccountInfo` cevabı `null`/`ABSENT_OR_FILTERED` olduğundan erişim izolasyonu **BLOCKED** tutuldu. Sekiz readonly ve sekiz writable-promoted simülasyonun tamamı başarılıdır; writable yükseltmenin engellendiği iddia edilmez. WS abonelikleri, uçuş halindeki kendi queue request'i, bağımsız input/proof bağı, attestation, sıralama ve L1 ödeme hâlâ açık kapılardır.

Probe için 5 Rust davranış, 10 SBF runtime ve 3 IDL testi geçti. Runtime testleri gerçek imzalı işlemler kullanır; ACL/Pending durumları ve scoped callback sağlayıcısı gerektiğinde yerel fixture'dır. Canlı gizlilik veya gerçek oracle sonucu sayılmaz.

## Kendi deneyimizi hazırlama ve rent kontrolü

`node probe-runner.mjs prepare` yalnız çevrimdışı çalışır: ayrı inspector/iki oyuncu kimlikleri ve canonical round/receipt PDA planı hazırlar. Inspector, ayrı probe payer cüzdanıdır; program anahtarı fee payer değildir. Anahtarlar ve tekrar kullanılan round planı `.tooling/per/` altında, Git dışında ve `0600` modunda kalır. `inspect` yalnız sabit devnet'te kendi deployment'ını okur; kaynak/IDL/binary/dependency hash'i, loader ve upgrade authority doğrulamaları olmadan programı kullanmaz. Plan değiştirilerek sessiz yeniden çekiliş yapılmaz.

`node deployment-plan.mjs` işlem göndermeden güncel yerel artifact'ları, devnet genesis'ini, RPC rent tutarlarını ve kendi payer bakiyesini denetler. **Fonlama öncesi tarihsel** [1 Ekim 2026 05:36 UTC raporu](evidence/deployment-plan-2026-10-01T05-36-41.513Z.json):

| Kalem | Test SOL |
| --- | ---: |
| Program + tam binary boyutunda ProgramData kalıcı rent | 1,487022680 |
| Geçici deployment buffer rent'i | 1,486148920 |
| İkisini de ayrıca sayan ihtiyatlı zarf | 2,973171600 |
| Kendi probe payer bakiyesi | 0 |

Loader buffer lamportlarını yeniden kullandığından bu zarf CLI'nin kesin minimumu değildir. **14:06 UTC'de ücretsiz 2 devnet SOL** alındı; [gerçek deploy maliyeti](evidence/own-probe-deployment.json) rent dahil **1,488567680 SOL**, deploy sonrası **14:35:21 UTC** gözlenen payer bakiyesi **0,511432320 SOL** oldu. Bu, sonraki oyuncu fonlaması ve hesap başlangıçları öncesindeki bakiyedir. Mainnet SOL veya planlanan house sermayesi harcanmadı; [fonlama kaydı](../../docs/devnet-funding.md) aşamaları ayırır.

İlk CLI denemesinde 305 write parçasının 11'i tamamlandı. Sonraki sınırlı yükleyici kalan 294 parçayı finalized olarak yazdı; bir hazırlanmış imza süresi doldu ve ücret alınmadı. Byte/hash denetimi tamamlanmadan final deploy yapılmadı. Yerel iz `.tooling/per/deploy-after-first-attempt.json`, `upload-buffer-wal.jsonl` ve `upload-buffer-complete.json` dosyalarında korunur; bir başarısız/eksik gönderim sessizce başarılı sayılmadı.

Canlı `run` modu açık `--experimental-devnet --allow-writes` bayrakları ve doğrulanmış kendi deployment'ımızı gerektirir; faucet/transfer/deployment yapmaz. Hazırladığı sıra: L1 round/receipt oluşturma ve delegation, TEE'de önce private permission, sonra VRF, iki oyuncunun readonly round'a referans veren komutları, role göre HTTP okuma/transaction/simulation matrisi ve kontrollü reveal. İşlem imzası confirmed/finalized olmadan sonraki adıma geçilmez; beklenen round durumu ve receipt ilerlemesi ayrıca okunur. Belirsiz gönderim otomatik yinelenmez. Inspector bilerek okuma yetkilisidir, operatör gizliliği iddiası yoktur.

**82 Node testi geçti**: 9 önceki ön kontrol, 4 rent/artifact, 32 istemci/auth/journal/devam, 13 VRF görünürlük, 6 rapor gizliliği ve 18 sınırlı buffer yükleyici testi. `prepare` ağ çağrısını reddeden bir fetch stub'ıyla da çalıştırıldı; çevrimdışı hazırlık doğrulandı. [05:40 UTC tarihsel inspect](evidence/probe-inspect-2026-10-01T05-40-53.543Z.json) o anda deployment bulunmadığını kaydetmişti; yukarıdaki yeni kanıt bunun sonraki durumudur. [14:36 canlı run](evidence/probe-run-2026-10-01T14-36-15.344Z.json) L1 başlangıcında HTTP429 ile kesildi. HTTP cevaplarının reveal sonrası randomness taraması tam gizlilik kanıtı değildir. Yeni `vrf-visibility.mjs`, yalnız kendi round/program/queue/scoped identity hesabına bağlanan `ProvideRandomness` verisini çözüp `SHA256(output32)` ile reveal sonucunu karşılaştırır. JSON/base64, legacy/v0 ve inner instruction biçimleri sınanır. Public işlem başarısız olsa da veri erişimi sonucu açığa çıkarabilir; proof doğrulaması veya başarılı fulfillment iddia edilmez. İlk gerçek input henüz bağımsız yakalanmadığı için PER tarayıcısının bağı account kapsamıyla sınırlıdır. Ham RPC/simulation hataları rapora aktarılmaz; sabit sınıf ve SHA-256 özeti saklanır. History imzalarının canonical 64-byte base58 biçimi RPC çağrısı ve raporlama öncesinde doğrulanır; bu kontrol tek başına imzanın kriptografik doğrulaması değildir. RPC error code yalnız güvenli tamsayıysa yazılır. WebSocket filtreleri ve inflight queue görünürlüğü ayrıca incelenmelidir; parser boyut sınırı HTTP yanıtını belleğe alma sınırı değildir. Eksik, `null` veya filtrelenmiş sonuç otomatik PASS olamaz; genel G1–G3 kabulü kapalı kalır.

## Yeniden çalıştırma

Node 24 kullanıldı. Yalnız bu klasörün bağımlılıklarını kurar; kök Cargo/Anchor/Node manifestlerini değiştirmez:

```sh
cd /Users/macmini/Desktop/Sollish/experiments/per
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run preflight
npm run read-matrix
```

`preflight` ve `read-matrix` bu aşamada rapor yazıp **exit 2** döndürür: anlamı BLOCKED; sessiz başarı değildir. PASS 0, FAIL 1, BLOCKED 2 kullanılır. Her çalıştırma `evidence/` altında tarihli JSON ile `*-latest.json` üretir. Eksik/bilinmeyen kapı ve duplicate check kimliği PASS üretemez.

`npm run faucet` ayrı, isteğe bağlı bir komuttur: sabit Solana devnet genesis kontrolünden sonra yalnız yeni test cüzdanına **tek 2 devnet SOL** isteği yapar; otomatik retry/endpoint değiştirme yoktur. Mevcut bakiye yeterliyse istemez. Rate limit kalkmadan yeniden çalıştırılmamalı. Gerçek SOL satın almaz, imzalı transfer/deployment yapmaz.

Özel Ed25519 anahtarı yalnız gitignore kapsamındaki `.tooling/per/devnet-wallet.pem` dosyasında, `0600` modunda saklanır; kullanıcının Solana CLI cüzdanı okunmaz. QFS imzası yalnız kendi pubkey'imizi içeren, ±300 saniyelik beklenen login metni için üretilir. Token RAM'de kalır; URL/token/private key rapora yazılmaz. Quote, challenge ve quote pubkey/signature alanları ise açık attestation kanıtıdır.

## Tarihsel G0 gözlemleri — 1 Ekim 2026, 00:30 UTC

Aşağıdaki tablo eski G0 çalıştırmasını ve ayrıca saatleri belirtilen sonraki faucet kontrollerini korur; mevcut deployment/bakiye durumu yukarıda ayrı belgelenmiştir.

| Kontrol | Bu çalıştırmada gözlenen sonuç |
| --- | --- |
| Base devnet | Genesis eşleşti; RPC Solana `4.3.0` bildirdi. |
| TEE | `magicblock-core 0.16.0`, commit `e66d914`; identity beklenen `MTEWGuqx…` ile eşleşti. ER'nin bildirdiği tüm-1 genesis Solana devnet genesis'i değildir. |
| SDK | Yerel `@magicblock-labs/ephemeral-rollups-sdk 0.17.3`, `@phala/dcap-qvl 0.3.9`, npm lock/integrity sabit. |
| TDX | SDK `verifyTeeRpcIntegrity` ve `verifyTeeIntegrity` gerçekten çalıştı; DCAP doğrulaması ve challenge/reportData kontrolü döndü. QVL ek kontrolü `UpToDate`, boş advisory listesi verdi. |
| Ölçümler | MRTD/RTMR0–3 iki yöntemde kaydedildi. Beklenen güvenilir uygulama ölçümü yok; gözlenen değeri kendi kendine allowlist yapmıyoruz. |
| Deployment | Delegation, VRF ve güncel ACL base/TEE'de mevcut. L1 upgrade authority, deploy slot, program-data adresi ve kod hash'leri kaydedildi. |
| Kod karşılaştırma | L1 LoaderV3 metadata'sı (45 byte) ve TEE LoaderV4 metadata'sı (48 byte) çıkarılınca bu üç programın kod hash'leri eşleşti. Bu, kaynak commit'iyle reproducible build eşleşmesi veya oyun doğruluk kanıtı değildir. |
| VRF queue | L1 `Cuj97…` owner VRF, 30.000 byte. `5hBR…` base owner Delegation, TEE owner VRF, 9.500 byte. TEE'den anonim okuma mümkün; içerik decode edilmedi, başkalarının request'leri incelenmedi. |
| QFS auth | Kendi yeni cüzdanıyla login başarılı. Malformed, değiştirilmiş issued token ve imzasız expired-claim token ayrı ayrı HTTP 401 aldı. |
| Okuma matrisi | Kendi cüzdan hesabı anonim ve geçerli auth ile `null`; hesap yokluğunu gizlilik başarısı saymıyoruz. Gerçek imzalı expired token testi yapılmadı. |
| Faucet | İlk 1 SOL isteği `RPC -32603 Internal error`; yaklaşık 3 dakika sonra 2 SOL isteği `HTTP 429`. 05:24 UTC ve yaklaşık dört saat sonraki 09:16 UTC kontrollü denemeleri de `RPC -32603 Internal error`. Bakiye 0; başarılı airdrop/işlem imzası yok. |

Kaynak Private Counter `declare_id!` adresi `9aXAU…`, aynı commit'in paketlenmiş IDL adresi ve `owner_program` alanı `2WJiw…`. Her iki üçüncü taraf deployment mevcut fakat bu durum kaynak/IDL eşleşmesini sağlamaz. Başkasının deployment'ına yazmadık. Sonradan oluşturulan kendi probe'un kimlik ve canlı ELF eşleşmesi ayrı doğrulandı; bu, eski örneğin uyuşmazlığını düzeltmez.

Sonuçları [G0 JSON](evidence/g0-latest.json), [auth matrisi](evidence/read-matrix-latest.json), [faucet JSON](evidence/faucet-latest.json) ve tarihli dosyalarla doğrulayabilirsiniz. Program/queue hash'leri anlık gözlemdir; sonraki upgrade veya queue değişimi beklenebilir.

## Açık kapılar ve sınırlar

- G0: kendi probe'un deployment/ELF eşleşmesi ayrı gözlem olarak doğrulandı. Üçüncü taraf örneğin kaynak–IDL uyuşmazlığı, bağımsız uygulama ölçümü politikası, quote→validator→program bağı ve private VRF queue/oracle uyumluluğu genel kabulü kapalı tutuyor; [kimlik incelemesi](evidence/tee-identity-review.md).
- G1–G8: private-before-VRF, scoped callback, oyuncu komutu ve reveal için sınırlı canlı gözlemler var. Tam gizlilik, okuma izni vermeden manuel cash-out, sıralama, L1 ödeme ve kesinti/upgrade kabulü **tamamlanmadı**. Probe komutu cash-out değildir; `null` okuma ve aday çıkarılamayan VRF taraması gizlilik başarısı sayılmaz.
- Geçerli TDX quote; bu HTTP endpoint'inin, oracle'ın ve on-chain validator'ın tümüyle beklenen oyun koduna bağlı olduğunu tek başına kanıtlamaz. SDK'nın nonce üretiminde `Math.random()` kullanıldığı kaynakta görüldü; bu deney sağlayıcı SDK davranışını gözlemliyor, üretim attestation istemcisi onayı vermiyor.
- Invalid-token reddi, başka oyuncunun private round'una erişemediğimizi kanıtlamaz. Expired-claim testi imzasız olduğu için ayrı bir token-expiry testi değildir.
- Kuyruğun anonim okunabilmesi tek başına gizli VRF'nin imkânsız olduğunu göstermez; **yalnız kendi request'imizle** işlem/callback/log/queue görünürlüğü ayrıca ölçülmelidir.

Önceki resmi faucet engeli, kullanıcının açıkça onayladığı GitHub `read:user` girişiyle bağımsız `solanadevnetfaucet.com` kaynağından tek ücretsiz claim alınarak çözüldü; etkileşimli CAPTCHA çözülmedi. PoW/miner kurulmadı, ücretli RPC/servis satın alınmadı. Tarihsel HTTP429 kesintisi aynı round/journal ile açık devam edilerek aşıldı. Güncel BLOCKED sonucu, tamamlanan sınırlı deneyden sonra eksik kalan güvenlik kanıtlarını belirtir; fonlama veya deployment başarısızlığı anlamına gelmez.

### İncelenen ücretsiz alternatif: devnet-pow

[Solana'nın yönlendirdiği PoW yolu](https://solana.com/developers/cookbook/development/airdrops-and-faucets), Ellipsis Labs tarafından sürdürülen ayrı permissionless devnet programına dayanır; RPC faucet kotasını aşma yöntemi değildir. `devnet-pow 0.1.4` crate kaynağı diske kurulmadan bellekte incelendi; paket SHA256 değeri crates.io metadata'sıyla eşleşti: `1a0f40287a071514e8021738852a31bb6339419984c95d696c8b30a4aa70ce8a`. İncelenen [CLI kaynağı](https://github.com/jarry-xiao/proof-of-work-faucet/blob/1efbcbf87497ed6d75a9bda373766ab11c5b4501/cli/src/main.rs) payer bakiyesi **5.000 lamport altındaysa otomatik `requestAirdrop(1 SOL)` çağırıyor**. Boş test cüzdanımızla çalıştırmak mevcut faucet engeline geri döneceğinden kurulmadı/çalıştırılmadı. Claim işlemi payer ve üretilen PoW anahtarının iki imzasını ister; CLI'nin 5.000 eşiği güncel işlem ücretinin yeterliliğine dair bir garanti değildir.

CPU işi, `A` harfiyle başlayan Ed25519 public key bulana kadar anahtar üretmektir. CLI'de duvar saati sınırı yoktur; `target-lamports` süreyi sınırlamaz. Kullanıcı hesabı/API anahtarı gerekmez; seçilen devnet RPC ve on-chain faucet programı kullanılır. [Program](https://github.com/jarry-xiao/proof-of-work-faucet/blob/1efbcbf87497ed6d75a9bda373766ab11c5b4501/programs/proof-of-work-faucet/src/lib.rs) ödülden receipt rent'i karşılayabilir, fakat transaction fee için başlangıç bakiyesi yine gerekir. Solana 1.14/Anchor 0.27 dönemindeki bağımlılıkların bugünkü toolchain ile derlenmesi denenmedi.

1 Ekim 2026 **00:33:49 UTC**, devnet slot **506089379** salt-okuma kontrolünde 23 faucet spec'i bulundu. Resmî sayfadaki difficulty 3 / 0,02 SOL pool'unun source hesabı yoktu (bakiye 0). Yalnız iki source bakiyesi sıfırdan farklıydı: biri claim başına sadece 100 lamport veriyordu; diğeri 19.000.000 lamport ödül için yalnız 900.000 lamport içeriyordu ve CLI tarafından yetersiz sayılıyordu. Aynı incelemede boş receipt rent'i RPC'den 650.240 lamport ölçüldü; 100 lamport ödül ekonomik olarak yeterli değildi. Bu anlık durum ve bootstrap gereksinimiyle PoW mevcut blokajı çözmedi. Yeni faucet isteği, miner kurulumu/çalıştırması veya hesap açılması yapılmadı.

## Birincil referanslar

- [Sabit SDK auth](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/fb19a37c829f4c7487b4101a12ddd76577dbf668/ts/web3js/src/access-control/auth.ts), [quote doğrulayıcı](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/fb19a37c829f4c7487b4101a12ddd76577dbf668/ts/web3js/src/access-control/verify.ts)
- [Sabit Private Counter kaynak](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/programs/private-counter/src/lib.rs), [paketlenmiş IDL](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/app/src/idl/private_counter.json)
- [PER quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart), [VRF teknik referans](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/technical-details), [Phala DCAP QVL](https://github.com/Phala-Network/dcap-qvl)

Test kapsamı: RPC/HTTP hatalarının kapalı kalması, canonical account decoding, LoaderV3/V4 metadata sınırları ve hash/authority anlamı, eksik kanıtın PASS olmaması, auth mesajı kapsamı, TCB policy, redaction, account yokluğunun erişim reddi sayılmaması. Bunlar protokol güvenlik testlerinin yerine geçmez.
