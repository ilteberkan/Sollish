# Deneysel PER erişim/VRF probe'u

**Test programı devnet'te dağıtıldı ve sınırlı canlı akış tamamlandı; G0 ve gizlilik kabulü hâlâ BLOCKED.** Bu ayrı workspace G1–G3 erişim/VRF deneyine yöneliktir. Bahis, Crash çarpanı, kazanç, bankroll veya ödeme talimatı içermez. Inspector kasıtlı private read üyesidir; operatörün sonuçtan habersiz olduğu iddia edilmez.

**1 Ekim 2026, 14:35:21 UTC:** [finalized deployment](../evidence/own-probe-deployment.json), slot `506304685`; kendi programın **292.384 byte** ELF'i SHA256 `197a965662b28971bca434633abfaaf2d5d826bdc3ce2f54a1d746554cd99aae` ile yerel artifact'a eşleşti, allocation padding yok ve buffer kapandı. [14:35:40 UTC TEE kopyası](../evidence/own-probe-tee-copy.json) aynı ELF'i gösterdi; bu RPC gözlemi attestation veya ölçülen uygulama kimliği değildir. [TEE kimliği incelemesindeki](../evidence/tee-identity-review.md) bağ/ölçüm eksikleri devam eder.

İki test oyuncusu fonlandı; round ve iki receipt başlangıcı [14:38 UTC salt okunur uzlaştırmada](../evidence/interrupted-l1-initialization.json) finalized/`err:null` olarak doğrulandı. İlk runner B işleminin onay kontrolündeki HTTP429 nedeniyle durmuştu; sözleşme hatası değildi.

[14:47:24–14:49:45 UTC aynı round ile devam](../evidence/probe-resume-initialized-latest.json), önceki üç başlangıcı yeniden göndermeden delegation, private-before-VRF, scoped callback ile `READY`, iki oyuncunun readonly komutları ve reveal adımlarını tamamladı. Her receipt'te nonce/count **1/1** gözlendi. `runOutcome:COMPLETED_LIMITED_EXPERIMENT` iken genel durum **BLOCKED** ve üretim onayı false kaldı. [14:51:26 UTC son okuma](../evidence/own-probe-final-readback.json) altı L1 işlemini finalized/`err:null` doğruladı; beş TEE işleminin TEE RPC'deki finalized sonucu L1 commit değildir. Anonim reveal sonrası round/receipt okuması ve randomness hash'i eşleşti.

## Sabitlenen kimlik ve araçlar

- Kendi program ID'miz: `AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va`.
- `anchor-lang =1.2.0`, `ephemeral-rollups-sdk =0.16.2` (`anchor`, `access-control`), `ephemeral-vrf-sdk =0.4.1` (`anchor-modern`); bağımsız `Cargo.lock`.
- Host Rust 1.95.0; mevcut proje SBF v1.57/builder 4.4.0 ve Anchor 1.2.0 araçları kullanılır. Global toolchain veya kök workspace değişmez.
- Program anahtarı `.tooling/per/probe-program-keypair.json`, ayrı ücret ödeyen cüzdan `.tooling/per/probe-payer-keypair.json`; ikisi de ignored ve `0600`. Önceki PER auth cüzdanı/kanıtları korunur.

```sh
bash experiments/per/program/build-local.sh
```

Komut host testlerini, clippy, format kontrolünü, SBF v2 derlemesini ve IDL üretimini çalıştırır; **deployment, faucet veya QFS başlatmaz**. `artifacts/own-probe-build.json` yalnız yerel artifact bilgisi; on-chain deployment alanı değildir. `verify-artifacts.mjs`, kaynak/IDL/Anchor.toml/anahtar public key ve delegation `owner_program` adreslerini eşleştirir. Binary `target/deploy/per_probe.so`, IDL `artifacts/per_probe.idl.json` konumundadır. Anahtar yoksa script kendiliğinden yeni kimlik üretmez.

1 Ekim 2026 yerel sonuç: **5 Rust davranış + 10 LiteSVM SBF runtime + 3 JavaScript IDL doğrulama testi geçti**, clippy ve format kontrolü temiz; SBF v2 binary **292.384 byte** üretildi. Normal host test listesinde generated `test_id` testi yoktur; IDL üreticisinin iç çıktı testleri bu sayıya dahil edilmedi. Yerel artifact tutarlılığı ve sonraki kendi deployment'ımız doğrulandı; G0/G1/G2/G3 kabulü BLOCKED kalır. Derleme betiği [runtime suite](runtime-tests/README.md) ve yalnız yerel callback fixture'ını da derleyip çalıştırır.

Runtime suite gerçek imzalı SBF işlemleriyle account creation/rent, oyuncu ve PDA bağları, imza değiştirme, scoped callback CPI, nonce/replay ve hata anında atomik geri almayı sınar. Pending/Ready ve ACL hesapları gereken senaryolarda sentetik oluşturulur; gerçek delegation, permission programı veya oracle kriptografisi çalıştırılmaz. Düz LiteSVM'de simülasyonun hesap verisi döndürebilmesi ve callback inner instruction'ının randomness taşıması, canlı QFS matrisinde sınanacak yüzeyleri gösterir; QFS açığı bulunduğu anlamına gelmez.

## Hesaplar ve akış

`ProbeRound` PDA'sı `[probe, inspector, round_id]`; private randomness ve sabit iki test oyuncusunu taşır. Her oyuncunun `ProbeReceipt` PDA'sı `[receipt, round, player]`; yalnız nonce ve accepted-count tutar. Round ve receipt'ler yalnız belgelenen devnet TEE validator'ına delege edilir. Round için canonical ACL permission oluşturulur; receipt için ACL oluşturulmaz. Son canlı raporda iki public receipt, prepared/ready aşamalarında anonim ve üç yetkili rol tarafından okunabildi; bu, private round gizliliği kanıtı değildir.

Akış `Initialized → PrivatePrepared → Pending → Ready → Revealed`. Sıfır veriyle başlatma ve delegation sırasında henüz gizli sonuç yoktur. `prepare_private`, izni doğrudan `is_private=true` oluşturur; VRF'den sonra private yapma veya yeniden request yolu yoktur. `request_probe_randomness` permission owner/PDA/round/private durumunu ve oyuncuların üye olmadığını kontrol eder. Yalnız `5hBR…` ephemeral queue kullanılır; public L1 queue'ya fallback yoktur.

Callback, bu programın scoped VRF signer'ı + pending state + round ID + request tag kontrolüyle bir kez kabul edilir. Secret log, return-data veya debug event üretilmez. `reveal_probe` ancak callback sonrasında izni public yapar; elle commit veya ödeme yapmaz. SDK'nın ürettiği canonical `process_undelegation` destek talimatı IDL'de bulunabilir; bu, TEE/delegation güvenini veya otomatik commit riskini kaldırmaz.

`submit_probe` oyuncu imzasıyla **private Round READONLY + kendi public Receipt WRITE** ister. Hazır round ve monoton nonce doğrulanır. Client gizli hesabı okuyarak seed çözmeye çalışmamalı; tüm account metaları açıkça kurulmalı. Bu yalnız private account'a referans veren komutun kabul deneyidir; manuel Crash cash-out veya sıralama adaleti kanıtı değildir.

## Canlı kabul için açık kalanlar

- Test fonu ve kendi deployment'ımız tamamlandı; uygulama measurement allowlist'i ve quote→validator→program bağı hâlâ BLOCKED. Manifest'te gözlem `observedOwnProbeDeployment` altında tutulur; `expectedTeeMeasurements` ve `approvedOwnCounterDeployment` null kalır. Tarihsel G0 kayıtları değiştirilmedi.
- `commit_frequency_ms = u32::MAX` yaklaşık 49,7 günlük **sonlu** aralıktır; otomatik commit'in kapalı olduğu anlamına gelmez. Validator'ın program dışı commit/undelegation yetkisi ve erken ifşa ayrıca sınanır.
- G1/G2: 95 HTTP satırı üzerinde 71 doğrudan secret-byte taramasında eşleşme yoktu. Ayrı 36 VRF türetim gözleminin tamamı `UNPARSEABLE_OR_INCOMPLETE` / `Invalid message signature header` döndü; 0 aday ve bağımsız input/proof doğrulaması yoktur. WS ve uçuş halindeki kendi queue request'i hâlâ sınanmadı. Oracle/TEE içi gizlilik bu sonuçlarla kanıtlanamaz.
- G3: iki gerçek `submit_probe` işleminden sonra receipt nonce/count 1/1 oldu. Buna karşılık altı private round okumasındaki `null` cevap erişim reddi kanıtı sayılmadı. Sekiz readonly ve sekiz writable-promoted simülasyon başarılıydı; writable yükseltmenin engellendiği veya manuel cash-out güvenliğinin geçtiği söylenemez. Oyuncular ACL okuma üyesi yapılmadı, relay eklenmedi.
- Host testleri gerçek Anchor transaction-signature/ACL runtime testleri değildir; saf state/kimlik kontrolleri, nonce, callback bağları, serileştirme ve generated readonly meta sınırlarını doğrular. G1–G3 bu testlerden PASS olamaz.

## Kaynak ve değişiklik sınırı

[Private Counter sabit kaynak](https://github.com/magicblock-labs/magicblock-engine-examples/blob/e8393c60a82f73259a39abe807c6273a83659d0a/private-counter/anchor/programs/private-counter/src/lib.rs) delegation/permission API referansıdır; paketlenmiş IDL'deki farklı program ID'si kopyalanmadı. Permission CPI'leri yayınlanmış `ephemeral-rollups-sdk 0.16.2` kaynağıyla karşılaştırıldı. Scoped VRF helper/signer modeli yayınlanmış `ephemeral-vrf-sdk 0.4.1` kullanır; eski global identity kullanılmaz. [VRF fulfillment kaynağı](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/provide_randomness.rs) gizliliğin yalnız account private flag'inden çıkmadığını gösterir.
