# PER uygulama ölçümü ve validator kimliği incelemesi

İnceleme: **2026-10-01 14:26–14:28 UTC**. Salt okunur resmî doküman/kaynak incelemesi ve önceki quote'un çevrimdışı analizi; Solana RPC, yeni auth/quote talebi, transaction veya dış iletişim yapılmadı. Manifest ve önceki G0 raporları değiştirilmedi.

**Sonuç: beklenen uygulama ölçümü ve quote→validator→çalıştırılan program bağı hâlâ BLOCKED.** İncelenen yayınlarda bağımsız üretilebilir bir PER image manifest'i, beklenen MRTD/RTMR politikası veya seçtiğimiz validator için attestation key bağlantısı bulunamadı. Bu, bunların sağlayıcı içinde hiç olmadığı iddiası değildir; aşağıdaki erişilebilir kaynaklar mevcut kabul kapısını kapatmıyor.

## SDK'nın kanıtladığı sınır

Pinli SDK0.17.3, commit `fb19a37c829f4c7487b4101a12ddd76577dbf668`, [verify.ts](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/fb19a37c829f4c7487b4101a12ddd76577dbf668/ts/web3js/src/access-control/verify.ts):

- `verifyTeeRpcIntegrity(rpcUrl)`: DCAP collateral/quote doğrulaması ve TDX `reportData == challenge64` karşılaştırması yapar.
- `verifyTeeIntegrity(rpcUrl)`: cached quote'u doğrular; dönen32-byte Ed25519 anahtarıyla challenge imzasını ve `reportData == SHA512(pubkey)` eşitliğini kontrol eder.
- API yalnız URL alır. Beklenen validator key, oyun programı/hash'i veya MRTD/RTMR allowlist parametresi/kontrolü yoktur. `Math.random()` challenge üretimi de üretim verifier'ı için ayrıca değiştirilmelidir.
- `verify(...)` sonucu SDK'da uygulama/TCB politikasına çevrilmez. Bizim önceki G0 ek kontrolü TCB durumunu ve advisory listesini ayrıca değerlendirmiştir; bu tarihsel sonucu bugüne ait yeni collateral kontrolü olarak sunmuyoruz.

Resmî [client implementation](https://github.com/magicblock-labs/docs/blob/74b5519fabc97d1a9beb716bf3d5db6763ac773d/pages/tools/tee/client-implementation.mdx) hardware quote kontrolünü anlatıyor. [PER quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart) aynı SDK yolunu kullanıyor. İncelenen sayfalarda beklenen image ölçümü veya onu hesaplama prosedürü verilmedi.

## Saklı G0 kanıtının çevrimdışı tekrar kontrolü

Kaynak: `g0-latest.json`, başlangıç **2026-10-01T00:30:48.571Z**. Node crypto ile Ed25519 detached signature, SHA512 ve pinli QVL quote parser kullanıldı; yeni ağ doğrulaması yapılmadı.

| Kontrol | Çevrimdışı sonuç |
| --- | --- |
| `/quote` reportData = o talebin challenge'ı | Eşleşti |
| `/fast-quote` reportData = SHA512(dönen public key) | Eşleşti |
| Dönen public key ile challenge imzası | Geçerli |
| Quote'a bağlı key = beklenen validator key | **Eşleşmedi** |

Quote'a bağlı key: `5AcobNF8ZQ7t63HDS2eJoRuKKzRpVvuDZyi3tWBq5gkZ`.

Beklenen validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`.

Farklı anahtar kullanımı tek başına saldırı kanıtı değildir; QFS ayrı bir attestation anahtarı kullanıyor olabilir. Fakat bu iki anahtarı aynı güvenilir deployment'a bağlayan doğrulanmış bir sertifika/imza/policy elimizde yoktur. `getIdentity` yanıtı bağı tamamlamaz: resmî [validator handler](https://github.com/magicblock-labs/magicblock-validator/blob/0bf0863f10f4698184c59c12db6c3a75be9ebc19/aperture/src/requests/http/get_identity.rs) yalnız engine authority'yi RPC yanıtı olarak verir; yanıtın kendisinde quote bağı yoktur.

İki eski quote aynı MRTD ve RTMR0–3 değerlerini taşır; RTMR3 sıfırdır. Event log/ölçüm semantiği olmadan uygulamanın hangi register'a ölçüldüğü çıkarılamaz. Bu değerler gözlemdir; `expectedTeeMeasurements` için bağımsız güvenilir referans değildir.

## Açık kaynak ve yayın zinciri

- Resmî [QFS platform paketi metadata'sı](https://registry.npmjs.org/@magicblock-labs/query-filtering-service-linux-x64/0.1.3), sürüm0.1.3 için `magicblock-labs/private-ephemeral-rollup` repository'sini gösteriyor. Dağıtım2 dosyalı native paket; repository [public API erişimi](https://api.github.com/repos/magicblock-labs/private-ephemeral-rollup) inceleme sırasında HTTP404 döndürdü. Paket kurulmadı/çalıştırılmadı. Bu binary'nin canlı PER sürümüyle aynı olduğu da doğrulanmadı.
- [Validator'ın QFS wrapper'ı](https://github.com/magicblock-labs/magicblock-validator/blob/0bf0863f10f4698184c59c12db6c3a75be9ebc19/.github/packages/npm-package/queryFilteringService.ts) platform binary'sini başlatır; TDX image/policy oluşturmaz.
- Validator commit `0bf0863f10f4698184c59c12db6c3a75be9ebc19` arşivindeki küçük metin kaynaklarında `MRTD`, `RTMR`, `reportData`, `attestation`, `reproducible`, `verifyTee` araması sonuç vermedi. Kamuya açık SDK ve ilgili PER dokümanları ayrıca incelendi. Dokümanlar repository arşivi15MB araştırma sınırını aştığı için bütün arşiv taranmış sayılmadı.
- Validator'ın [güvenlik açıklaması](https://github.com/magicblock-labs/magicblock-validator/blob/0bf0863f10f4698184c59c12db6c3a75be9ebc19/README.md#-api-stability-and-security), delegation program audit'ini belirtirken tüm validator iç bileşenlerinin kapsamlı audit'ten geçmediğini açıkça ayırıyor. Delegation audit'i PER/QFS image ölçüm politikasının yerine geçmez.

## Sağlayıcıdan veya bağımsız yayın zincirinden gereken somut kanıt

1. **Sürüm ve ölçüm manifest'i:** ilgili PER deployment'ının QFS, validator, oracle, firmware/kernel/image/config sürüm ve hash'leri; hangi input'un MRTD/RTMR'yi nasıl ürettiği; bağımsız reproducible build/ölçüm adımları veya imzalı, denetlenmiş referans policy. Runtime event log kullanılıyorsa log'un quote register'larına replay doğrulaması gerekir.
2. **Kimlik bağlantısı:** attested key'in `MTEWGu...` validator'ına ve beklenen devnet genesis/deployment'a ait olduğunu doğrulayan, policy kapsamındaki imzalı/domain-separated bağ. Anahtarların TEE içinde üretimi/korunması ve rotasyon politikası açıklanmalı. Gözlenen key'i yalnızca pinlemek bu kanıtı üretmez.
3. **İletişim bağlantısı:** quote'un doğruladığı anahtar/ölçülen servis ile RPC oturumu arasındaki bağ. Yalnız bir endpoint'ten challenge quote almak, ayrı bir geçerli quote servisine aktarımı dışlamaz; bu bir protokol çıkarımıdır. Attested session/TLS key veya imzalı endpoint/response bağı gibi doğrulanabilir bir mekanizma gerekir.
4. **Program/sonuç bağlantısı:** on-chain canonical program hash'i, TEE'ye yüklenen aynı ELF ve gerçek yürütme/commit imzası arasındaki güvenilir zincir. İstemcimizin L1/TEE byte eşitliği kontrolü yararlı bir RPC gözlemidir; quote'a bağlanmış execution kanıtı değildir. Upgrade, rollback, restart ve revocation durumlarında geçerli policy tanımlanmalı.
5. **Fail-closed kabul:** bağımsız referans geldikten sonra taze, kriptografik nonce; Intel collateral/TCB/debug politikası; beklenen ölçümler; validator/session/program bağı birlikte kontrol edilmeli. Birinin eksikliği üretim kabulünü BLOCKED tutmalı.

`expectedTeeMeasurements: null` korunur. İzole, açıkça deneysel devnet probe bu belirsizlikleri ölçebilir; finansal üretim veya operator-blind Crash güvenlik iddiası oluşturmaz. Sağlayıcıya mesaj/issue gönderilmedi ve gözlenen değerler allowlist yapılmadı.
