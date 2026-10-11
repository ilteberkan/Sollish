# VRF recovery — yalnız yerel deney

**Yalnız üretim dışı yerel deney; recovery Coinflip programına bağlanmadı.** Kaynaktan
derlenen gerçek provider SBF'si LiteSVM'de çalışır. İstek CPI'sı, oluşan queue
kaydının atomik capture'ı, normal callback ve gerçek provider purge sonrası
orijinal proof ile recovery sınanır. Oracle daemon, ağ veya gizli PER çalışmaz.
Bahis, kazanç ödemesi veya token hakkı yoktur; VRF ücret transferleri yalnız VM
bakiyeleriyle gerçekleşir.

Ayrı, açıkça seçilen `root-games-provider` test hedefi artık değiştirilmemiş
House/Games SBF'lerini de sınar. Aşağıdaki recovery deneyinden farklıdır;
[Games/provider ölçümü](#ayrı-gamesprovider-entegrasyon-testi) iki yolun sınırını açıklar.

Test programı `79cu2QNvp92chEmBhBgcUfERDT9KHnUcr8eiJb5WzKML`, ana Sollish
deployment listelerine dahil değildir. Authority Ed25519 seed'i `[41; 32]`,
oracle identity seed'i `[42; 32]` herkese açıktır. **Ağa deploy edilmez.**
SBF derlemesi açık `test-fixture` özelliği gerektirir.

## Sabitlenen kaynak ve lisans

- Resmi repo: [magicblock-labs/solana-vrf](https://github.com/magicblock-labs/solana-vrf/tree/52b103c5d55d72e07456a445044b3c006cb87c1a).
- Tam commit: `52b103c5d55d72e07456a445044b3c006cb87c1a`.
- Git dependency: `solana-vrf-api` 1.0.0; host prover: `solana-vrf` 1.0.0.
- Ayrı `Cargo.lock` transitive dependency'leri sabitler; Solana program/curve 3.0.0,
  LiteSVM 0.15.2, yerel Rust 1.95.0 ve platform-tools 1.57 kullanılır.
- Bu iki upstream paket **BSL 1.1** kapsamındadır: Additional Use Grant `None`,
  belirtilen Change Date 1 Aralık 2029, Change License MIT. Lisans metni
  non-production kullanıma izin verir. [LICENSE.md](LICENSE.md) aynen korunur;
  [NOTICE.md](NOTICE.md) sınırı açıklar. Üretime taşıma ayrıca lisans incelemesi ister.
- MIT lisanslı `ephemeral-vrf-sdk` 0.4.1'in lisansı bu iki paketi kapsamıyor.

Kriptografi kopyalanmadı veya yeniden yazılmadı. Host doğrudan resmi
[`compute_vrf`](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/vrf/src/vrf.rs),
SBF programı doğrudan resmi
[`verify_vrf`](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/api/src/verify.rs)
fonksiyonunu çağırır.

## Sınanan protokol

Snapshot 153 byte: magic8, authority32, input32, oracle-key32, slot8, zaman8,
consumed1, randomness32. VM başlangıcında bu PDA boş olarak hazırlanır; deneyin
kendisi snapshot rent/account-creation CPI'sı uygulamaz. İki admission yolu vardır:

- `initialize` (opcode 0), 15 kriptografi regresyonunun eski kontrollü fixture
  yoludur; sabit test authority input/key verir.
- `admit` (opcode 2), sabit oracle identity ve queue index 0 altında gerçek
  provider `RequestRandomnessScoped` CPI'sı yapar. Caller seed snapshot adresidir;
  caller identity PDA program tarafından imzalanır. Gerçek Clock ve adres/owner'ı
  doğrulanmış SlotHashes'tan değerler alınır. Aynı instruction içinde
  [capture okuyucusu](program/src/capture.rs) oluşan kaydı bulur ve input/key'i saklar.

Capture, canonical queue/Oracle PDA, owner, discriminator ve Ristretto key'i;
callback program/discriminator/metas/args, scoped signer bump, slot, zaman ve
priority'yi doğrular. Input, resmi türetimle **gerçek body byte offset'inden**
yeniden hesaplanır. Son cursor'a güvenilmez; hole reuse, aynı boyutlu payload'dan
kalabilen padding ve birden çok eşleşme ayrı sınanır. Kuyruk boyutuyla sınırlı
tek O(n) tarama yapılır; kuyruk boyutunda Vec oluşturulmaz. Capture başarısızsa
provider'ın istek kaydı ve 500.000 lamport VM ücreti de geri alınır.

Normal callback (opcode 3), scoped signer yanında Instructions sysvar ile
doğrudan top-level provider `ProvideRandomness` instruction'ını doğrular.
Kayıtlı ilk input, aynı oracle key ve `SHA256(compressed_output)` eşleşmelidir.
Wrapper CPI fulfillment ve noncanonical reserved header bu deneyde reddedilir.
Normal sonuç ile recovery aynı consumed bitini kullanır.

`recover` (opcode 1), input/key kabul etmez; immutable snapshot'ı kullanarak
resmi `verify_vrf` ile output/base/hash/scalar proof'unu doğrular. Sonraki slot ve
120 saniyeden fazla geçen deney zamanı gerekir; sonuç tek kez saklanır. Recovery
queue veya oracle hesabına ihtiyaç duymaz. Eski sentetik purge testi korunur;
yeni entegrasyon testinde resmi provider'ın **gerçek purge instruction'ı**
çalıştırılır. Provider'ın zamanı dört saniyelik birimdir; bu eşik uygulama için
tam timeout/liveness politikası değildir.

Provider setup'ında VM ProgramData authority metadata'sı test adminine atanır;
ELF değiştirilmez. Sonra resmi `initialize`, `add_oracle` ve `initialize_oracle_queue`
SBF instruction'larıyla kayıtlar oluşturulur. Anahtar/input değiştirme negatif
senaryoları açıkça VM fault injection'dır; `ModifyOracle` ile canlı key rotation
mümkün olduğu iddia edilmez.

## Çalıştırma ve ölçüm

```sh
bash experiments/vrf-recovery/run-local.sh
```

[build-provider.sh](build-provider.sh), pinned kaynağı ayrı `.tooling` checkout'ında
kilitli bağımlılıklarla derler. `test-sbf` authority override'ı veya fee exemption
özellikleri kullanılmaz. Değişmiş source/lock kabul edilmez; artifact cache'i
kaynak/toolchain/script hash'leriyle doğrulanır. [Provider manifesti](provider-build.json)
canlı deployment binary eşleşmesi anlamına gelmez.

Son koşu: **35 test geçti** (12 capture, 8 gerçek-provider VM, 15 proof/recovery),
Clippy `-D warnings` ve format kontrolü temiz. Gözlemler [evidence.json](evidence.json)
içindedir; başarılı workflow sonunda rapor ve dosya hash'leri otomatik yenilenir. Ayrıntılı yerel çıktı `verification.log` Git dışında tutulur.

| Yerel işlem / fixture | Tüketilen CU |
| --- | ---: |
| Boş queue'ya admission + capture | 38.055 |
| Gerçek provider proof doğrulaması + callback | 31.911 |
| Canonical recovery vektörü | 23.797 |
| 9.500 byte queue, 30 kısa kayıt + admission | 41.828 |
| 30.000 byte queue, 120 kısa kayıt + admission | 52.802 |
| 512.000 byte queue, 1.000 kısa kayıt + admission | 162.367 |
| 512.000 byte queue, 4.800 kısa kayıt + admission | 618.367 |

Doluluk fixture'ları resmi queue constructor ile hazırlanmış 104-byte kısa
kayıtlardır; gerçek çok oyunculu trafik veya en kötü payload dağılımı değildir.
4.800 kayıtta varsayılan 200.000 CU işlem bütçesi yetmedi. 1.400.000 CU tavanı
isteyen aynı admission başarılı oldu. Bütçe aşımında snapshot, queue ve VRF ücreti
geri alınırken transaction fee payer'ın ağ ücreti harcandı. Başka uygulamaların
paylaştığı queue doluluğu bizim request maliyetimizi etkileyebilir. Bu ölçümler
kullanıcı/saniye kapasitesi, mainnet ücret veya gecikme garantisi değildir.

Deney SBF'si 76.656 byte; gerçek source-built provider SBF'si 258.392 byte.
Yerel build/hash eşleşmesi çapraz ortam reproducible build veya audit değildir.

## Coinflip'e geçmeden açık kalanlar

- Bu deney, root `programs/games` içine entegre edilmedi. Bet admission, teminat,
  receipt kapanışı ve recovery bütünlüğü birlikte tekrar tasarlanıp sınanmalıdır.
- Provider canlı deployment/source eşleşmesi, version/upgrade ve oracle daemon
  davranışı ayrıca doğrulanmalıdır. Yerel gerçek SBF çalışması canlı oracle testi değildir.
- Normal callback yalnız doğrudan top-level fulfillment destekler; kullanılması
  planlanan canlı gönderim yoluyla uyumluluğu ölçülmelidir.
- Shared queue ve payload çeşitliliği için daha geniş CU/heap/latency ölçümü gerekir.
- **Withholding sürer:** oracle proof'u hiç açıklamazsa recovery onu üretemez.
  Açıklanmış proof arşivi yardımcı olabilir; kesintisiz sonuç garantisi değildir.
  Aynı caller seed ile yeniden request, yeni slot/hash/zaman/offset nedeniyle yeni
  input üretir; güvenli kurtarma diye kullanılmaz.
- BSL kapsamındaki dependency/provider kodu üretime taşınamaz; lisans uygunluğu
  ayrıca çözülmelidir. PER gizliliği ve manuel Crash ödeme bağı burada sınanmaz.

İlgili resmi kaynaklar:
[request input türetimi](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/request_randomness.rs),
[provider verification/callback](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/provide_randomness.rs),
[queue layout](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/api/src/state/queue.rs),
[oracle retry/purge](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/vrf-oracle/src/oracle/processor.rs).

## Ayrı Games/provider entegrasyon testi

```sh
bash experiments/vrf-recovery/run-games-provider.sh
```

[Runner](run-games-provider.sh) önce pinned provider artifact'ını doğrular,
root programları yeniden derler, ardından yalnız `root_games_provider` hedefini
`root-games-provider` özelliğiyle çalıştırır. Varsayılan recovery komutunun ve
root mock-oracle testlerinin yerini almaz. Eksik veya hash'i değişmiş gerçek
provider artifact'ı hatadır; mock'a sessiz geçiş yoktur. Root program kaynakları,
manifestleri ve IDL account layout'ları değiştirilmedi.

[Altı test](tests/tests/root_games_provider.rs) geçti; Clippy `-D warnings` ve
format kontrolü temiz. [Ayrı kanıt dosyası](games-provider-evidence.json) binary,
test, lock ve log hash'lerini içerir. `games-provider-verification.log` yerel
ayrıntılı çıktıdır. Ölçümler sabit, herkese açık VM anahtarlarıyla alınmıştır:

| Yerel işlem / fixture | CU |
| --- | ---: |
| İlk cüzdan: ledger + activity + gerçek provider request | 99.005 |
| 30.000 byte queue, 120 kısa kayıt + ilk bahis | 102.202 |
| 512.000 byte queue, 4.800 kısa kayıt + ilk bahis | 223.167 |
| Gerçek proof doğrulaması + scoped Games callback | 33.741 |
| Keeper settle + close, kazanan bahis | 83.915 |
| Keeper settle + close, kaybeden bahis | 83.381 |

İlk bahis legacy transaction'ı 728 byte ve tek cüzdan imzalıdır. Provider'a tam
500.000 lamport gider; bu VM'de ilk dört hesabın rent toplamı 8.184.960 lamport,
ağ işlem ücreti 5.000 lamporttur. **VM rent'i güncel devnet rent'i değildir**;
dağıtım ve cüzdan teklifleri canlı RPC'den ölçülmelidir. 300.000 CU client sınırı
bu fixture'lerde yeterlidir. Capture parser içermeyen root admission ile yukarıdaki
recovery deneyinin 618.367 CU ölçümü aynı işlem değildir; bu sonuçlar daha geniş
payload, canlı queue yükü veya TPS garantisi oluşturmaz.

Gerçek provider paused queue reddi, daha önceki House reservation, nonce, rent ve
request ücretini atomik olarak geri alır. 4.800 kayıtta bilerek 160.000 CU verilen
işlem provider taramasında tükenir ve aynı rollback doğrulanır; yalnız ağ ücreti
kalır. Global client bütçesi değiştirilmedi.

**Callback sınırı:** Games'in sabit `DEFAULT_QUEUE` adresinin gerçek oracle özel
anahtarı elimizde değildir. VM test oracle'ının bu kuyruğu doğrudan fulfill etmesi
resmi provider seed doğrulamasında reddedilir. Bu nedenle test, gerçek admission'ın
oluşturduğu queue byte'larını ve ücretini, resmi instruction'larla kurulmuş test
oracle canonical queue'suna açıkça **VM-only transplant** ile taşır. Games/House
state'i, callback parametreleri veya imza doğrulaması değiştirilmez. Gerçek test
oracle imzası ve resmi `compute_vrf` proof'u, gerçek provider `verify_vrf` ve scoped
CPI'dan geçer. Yanlış proof, yanlış scoped identity ve ikinci fulfillment reddedilir.
İki ayrı admission ile hem 19.600.000 lamport kazanma hem sıfır ödeme zorunlu sınanır;
rent doğru cüzdana döner, rezerv çözülür, activity bir kez artar ve eski nonce yeniden
kullanılamaz. Bu, aynı canlı queue üzerinden uçtan uca teslim kanıtı değildir.

Gerçek provider purge işlemi sonrası root Games bahsi `Awaiting` kalır ve House
rezervi çözülmez. Recovery entegrasyonu yapılmış gibi davranılmaz; oracle kesintisi
ve açıklanmayan proof için üretim engeli sürer. Ağ işlemi, mainnet, TDX/PER gizliliği
ve canlı provider binary/source eşleşmesi bu testin dışındadır.
