# Coinflip — scoped VRF ve SOL ödeme prototipi

[Games programı](../programs/games/src/lib.rs), Coinflip sonucunu ayrı tutar ve SOL escrow/rezerv/ödemesini [house programına](contracts.md) CPI ile yaptırır. Program kimliği `8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ`. Bu, yerel test ve ileride devnet deneyi için geliştirme durumudur; gerçek oracle ile uçtan uca doğrulama veya ağ deployment'ı kanıtlanmış değildir. Cluster adreslerinden biri devnet diye adlandırılsa da programda mainnet'i teknik olarak engelleyen bir cluster denetimi yoktur.

## Hesaplar ve arayüz

| Hesap | Games programı altında PDA seed'leri | Discriminator dahil boyut |
| --- | --- | --- |
| `CoinflipConfig` | `"coinflip_config", house` | 75 byte |
| `CoinflipBet` | `"coinflip", house, player, id:u64 LE` | 252 byte |
| `GamePlayerActivity` | `"activity", house, player` | 185 byte |

Config, house adresini, sabit queue'yu ve house edge'i tutar. Bet; config/house/shard/player bağlarını, ID, stake, azami brüt ödeme, request tag, randomness, payout, `created_at`, `settled_at`, `hour_recorded` ve durumu tutar. Stake bet hesabında tutulmaz; house makbuzunda escrow'dadır. Kalıcı aktivite hesabı toplamları ve yalnız iki UTC saat kovasını saklar; bahis geçmişinin tamamı değildir.

| Instruction | Argümanlar | Davranış |
| --- | --- | --- |
| `initialize_coinflip` | `edge_bps:u16` | Yalnız house authority; house bu games ID'sini yetkilendirmiş olmalı. `0..=500` bps kabul edilir; config sonradan değişmez. |
| `initialize_activity` | Yok | Oyuncu kendi house'a bağlı kalıcı aktivite hesabını bir kez açar ve rent'ini öder. Token hakkı oluşturmaz. |
| `place_coinflip` | `id:u64, side:u8, stake:u64` | Oyuncu imzalar; side yalnız `0/1`, stake pozitif. House rezervi, nonce ilerlemesi, oyun hesabı ve VRF isteği aynı transaction'da oluşur. |
| `place_coinflip_rewarded` | `id:u64, side:u8, stake:u64, epoch:u64` | Aynı bahis kabulüne önceden fonlanan incentives fazı ve saatlik hak kaydını atomik ekler; ödül bütçesi yetmezse işlem bütünüyle geri alınır. |
| `consume_randomness` | `randomness:[u8;32], id:u64, request_tag:[u8;32]` | Yalnız doğru scoped VRF imzası; eşleşen bekleyen bahsi `Ready` yapar. Ödeme yapmaz. |
| `settle_coinflip` | Yok | Herkes tetikleyebilir; aktivite özeti, kayıtlı sonuçtan hesaplanan ödeme ve house makbuzunun kapatılması atomik tamamlanır. |
| `close_coinflip` | Yok | Herkes sonuçlanmış oyun makbuzunu kapatabilir; rent ve bağışlar yalnız kayıtlı oyuncuya döner. Aktivite ve nonce ledger'ı korunur. |

Yedi instruction vardır. İlk bahisten önce oyuncu house `initialize_player` ile nonce ledger'ını ve games `initialize_activity` ile aktivite hesabını açar. Place sırasında aktivite hesabının varlığı ve house/player bağı doğrulanır; eksik hesap yüzünden sonradan ödemenin engellenmesi önlenir. ID tam `last_bet_id + 1` olmalıdır; ilk değer `1`'dir. İşlem başarısızsa nonce, stake, hesap açılışları ve VRF ücreti transferi geri alınır; ağ transaction ücreti ayrı kalır. Aynı oyuncunun farklı shard'lardaki yeni bahisleri ledger, settlement'ları aktivite yazma kilidini paylaşır.

Durumlar `Awaiting=0 → Ready=1 → Settled=2`. Taraf, tutar ve request tag sonuç gelmeden kilitlenir. Admin sonucu seçemez; settle çağıranı taraf, randomness veya payout veremez. House pause yeni bahsi durdurur, mevcut callback ve settlement'ı durdurmaz.

## Sonuç ve ücretler

Kazanan taraf `randomness[0] & 1` ile belirlenir. Kazanan brüt ödeme, lamporta aşağı yuvarlanan `stake × 2 × (10_000 − edge_bps) / 10_000`; kaybeden ödeme sıfırdır. `edge_bps=200` örneğinde 0,01 SOL stake için brüt ödeme 0,0196 SOL, house rezervi 0,0096 SOL olur. Stake ve brüt ödeme ayrıca shard limitlerine tabidir.

Çok küçük stake'lerde yuvarlama gerçekleşen oranı değiştirir; kodda pozitif tutar dışında ayrı ürün minimumu henüz yoktur. Nominal %2 edge, VRF ve ağ ücretleri dahil toplam kullanıcı maliyeti değildir.

Oyuncu stake'e ek olarak nonce ledger'ı ve aktivite hesabının ilk açılış rent'ini, her bahis için iki makbuz rent'ini ve VRF ücretini karşılar. House makbuzu settlement sırasında kapanır; oyun makbuzu ayrı `close_coinflip` çağrısına kadar kalır. İkisinin de kapanışında rent ve varsa bağışlar kayıtlı oyuncuya döner. Transaction fee payer ayrı seçilebilir.

İncelenen sağlayıcı kodunda normal istek 500.000 lamport, yüksek öncelikli istek 800.000 lamporttur; bu program normal scoped isteği kullanır. Ücret request sırasında queue'ya gider. Sağlayıcının purge kodu, süresi dolan isteğin ücretini de oracle'a aktarabilir; sadece başarılı fulfillment için ödeme varsayılmamalıdır. Bunlar incelenen kaynak değerleridir, canlı deployment doğrulaması değildir. [İstek kodu](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/request_randomness.rs), [ücret sabitleri](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/api/src/consts.rs).

## VRF kimliği ve isteğe bağlama

Bağımlılıklar Anchor `=1.2.0`, `ephemeral-vrf-sdk =0.4.1`, `anchor-modern` özelliğidir. `0.16.2` ayrı rollups SDK sürümüdür; bu bağımsız VRF paketinin sürümü değildir. Bu kombinasyon test fixture'ında host ve SBFv2 olarak derlendi.

Sabit VRF programı `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`, L1 queue `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh`. Queue adresi ve VRF program sahipliği kontrol edilir. Queue adresi mainnet ve devnet'te aynıdır; cluster RPC seçimiyle belirlenir. [Resmî queue açıklaması](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/technical-details).

`create_request_scoped_randomness_ix` normal scoped istek (`0x0A`) üretir. Games programı kendi `["identity"]` PDA'sıyla imzalar. Callback metas sırası config (salt okunur), bet (yazılabilir); callback args `id:u64 LE || request_tag:[u8;32]` olur. Tag, benzersiz CoinflipBet PDA'sının 32 byte adresidir ve `caller_seed` olarak da kullanılır; sağlayıcının slot/queue verileriyle oluşturduğu VRF input ID'si değildir. Kullanıcı callback hedefi veya serbest bir seed seçemez. [Sabitlenmiş SDK kaynağı](https://github.com/magicblock-labs/solana-vrf/blob/8431efd996154e3c8ae2f839c772bde4663b3092/sdk/src/instructions.rs).

Sağlayıcı callback başına VRF programı altında `["identity", games_program_id]` seed'leriyle türeyen scoped signer'ı ekler. Games, bu imzayı; hesap PDA/config/house bağlarını; bekleyen durumu; ID ve tag eşitliğini denetler. Legacy global VRF signer kabul edilmez. Callback verisi `discriminator || randomness32 || idLE || tag32` biçimindedir.

Games programı kriptografik proof'u kendisi doğrulamaz: incelenen sağlayıcı `ProvideRandomness` kodu kayıtlı isteği bulur, oracle anahtarına göre proof'u doğrular ve yalnız ardından scoped CPI yapar. Yanlış proof reddedilir. Kaynak incelemesi canlı program binary'sinin, upgrade yönetiminin veya audit kapsamının doğrulandığı anlamına gelmez. [Fulfillment kodu](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/provide_randomness.rs).

## Zaman aşımı ve ölçek sınırları

İncelenen VRF kaynak sürümünde queue TTL 120 saniyedir. Herkes süresi geçen istekleri temizleyebilir; silinen isteğin normal fulfillment yolu artık çalışmaz. Callback başarısız olduğunda aynı transaction'daki queue silme geri alınır, ancak istek sonradan TTL nedeniyle temizlenebilir. [TTL sabiti](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/api/src/consts.rs), [permissionless purge](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/purge_expired_requests.rs).

Bu prototipte **otomatik iade, admin iptali, yeni sonuç çektirme veya timeout sonrası fallback yoktur**. `created_at` gözlem içindir. Sonuç ulaşmazsa bahis ve teminat süresiz kilitli kalabilir. Timeout'ta yeni sonuç veya seçilebilir iade, oracle/operatöre sonuçları seçerek geciktirme avantajı verebilir. Üretim öncesinde kalıcı recovery ve liveness güven modeli ayrıca çözülmelidir.

TTL dolması tek başına programın fulfillment'ı reddetmesi değildir: kayıt henüz silinmediyse program aynı geçerli proof'u kabul edebilir. Ancak incelenen [oracle daemon](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/vrf-oracle/src/oracle/processor.rs), callback hatasında aynı hazırlanmış proof/output ile yeniden denerken TTL geçince purge gönderir. Purge sonrası `ProvideRandomness`, proof kontrolünden önce kuyrukta input bulamadığı için `RandomnessRequestNotFound` döner. İncelenen API'de bu input'u geri yükleyen recovery instruction'ı yoktur.

Aynı `caller_seed` ile tekrar request göndermek aynı sonuçla kurtarma değildir: [input türetimi](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/program/src/request_randomness.rs) slot, slot hash, zaman ve queue konumunu da kullanır. Özgün input/oracle anahtarını kalıcı bağlayıp proof doğrulamak ayrı bir protokol tasarımı gerektirir; mevcut `request_tag` bu input değildir. Oracle'ın hiç açıklamadığı proof'un erişilebilirliği de ayrıca çözülmeden bu yaklaşım liveness garantisi sağlamaz.

1 Ekim 2026'da [izole recovery deneyi](../experiments/vrf-recovery/README.md) **35 testi** geçti: 12 capture okuyucu, 8 kaynak kodundan derlenmiş gerçek provider SBF entegrasyonu ve 15 proof/recovery. Gerçek scoped request CPI'sı sonrası ilk input/oracle key aynı instruction'da capture ediliyor; callback Instructions sysvar ile doğrudan provider fulfillment'ına, ilk input ve aynı key'e bağlanıyor. Gerçek provider purge instruction'ı sonrası eski proof aynı sonucu kurtardı; her iki yol ortak consumed bitini kullanıyor. Bu özellikler root Coinflip programına henüz eklenmedi. BSL kullanım şartları, canlı program/sürüm uyumu ve oracle'ın açıklamadığı proof'a erişim açık kalıyor.

Doluluk deneyinde 4.800 kısa kayıt bulunan 512.000-byte queue'da varsayılan 200.000 CU yetersiz kaldı; yüksek bütçeyle admission/capture 618.367 CU kullandı. Queue/VRF ücreti/snapshot hata halinde geri alındı; ağ transaction ücreti harcandı. Ortak queue'nun CU maliyeti house shard'larından bağımsızdır. Bu yerel ölçüm eşzamanlı kullanıcı kapasitesi veya gerçek ağ yük testi değildir.

Anahtar değişimi riski abartılmamalıdır: incelenen provider'da `ModifyOracle` doğrudan VRF key güncellemez; oracle silinmesi açık queue sayısının sıfır olmasını gerektirir. Canlı eski request sürerken serbest key rotation gösterilmiş bir saldırı değildir. İzole deneyde oracle key ve queue input'u VM fault injection ile değiştiren testler normal callback'i reddetti; bunlar gerçek key rotation saldırısı veya canlı-provider sonucu değildir. Coinflip entegrasyonunda aynı ilk input/key bağı ayrıca korunmalıdır.

Callback'in yalnız sonucu kaydetmesi, ödeme/receipt kapatma hatalarının randomness teslimini bozma riskini azaltır. `Ready` olduktan sonra kayıtlı sonuçla permissionless settlement tekrar denenebilir; başarısız deneme durum değişimini geri alır.

Her request aynı yazılabilir oracle queue hesabını kullanır. House shard'ları bu ortak kilidi kaldırmaz; gerçek throughput ve kuyruk gecikmesi henüz ölçülmedi. Tamamlanan oyun makbuzları ayrıca kapatıldığında kalıcı durum, oyuncu/house başına nonce ledger'ı ve aktivite özetinden oluşur; açık veya kapatılmamış makbuzlar ayrıca yer tutar. Kapanış otomatik değildir.

## Aktivite özeti ve oyun makbuzunun kapatılması

`GamePlayerActivity`, `house`, `player`, `bump` yanında şu alanları saklar:

| Alan | Tür / anlam |
| --- | --- |
| `total_wagered_lamports`, `total_payout_lamports` | `u128`; başarıyla sonuçlanan bahislerin ömür boyu toplamları |
| `settled_bets` | `u64`; bir kez sonuçlanan bahis sayısı |
| `last_settled_at` | `i64`; görülen en büyük settlement zamanı |
| `current`, `previous` | İki `ActivityBucket`: `epoch:u64`, `wagered_lamports:u128`, `bet_count:u64` |

Saat `floor(unix_timestamp / 3600)` ile UTC sınırlarından belirlenir. Sayım bahis kabul zamanında değil **settlement zamanında** yapılır. Bir saat ileri geçişte current önceki kovaya taşınır; daha uzun arada yalnız yeni saat ve boş önceki saat tutulur. Güncelleme settlement geldikçe yapılır; kovalar kendiliğinden saat başında dönmez. Okuyucu epoch değerlerini kontrol etmelidir.

Saat gerilerse hâlâ tutulan kovaya eklenebilir; negatif zaman veya iki kovanın dışındaki eski saat, ödeme ve ömür boyu toplamları engellemez. Bu durumda `hour_recorded=false` olur ve yeni saat kayıtları silinmez. Bütün sayaç artışları checked aritmetik kullanır; gerçek bir taşma transaction'ı geri alır. Aktivite hesabını sıfırlama veya kapatma yolu yoktur.

**İki UTC kovası, son 60 dakikalık kayan pencere değildir.** Örneğin 14:30'da gereken 13:30–14:30 aralığı, 13:00 ve 14:00 saat toplamlarından tam çıkarılamaz. Ayrıca beklemiş bir bahis sonuçlandığı saatte sayılır. Bu veri tek başına chat/airdrop için “son bir saatte minimum bahis” şartını uygulamaz; chat için finalized kabul olaylarından kayan pencereyi hesaplayan backend ve token için kalıcı UTC epoch kayıtları ayrı uygulanır; bkz. backend.md ve incentives-contracts.md.

`close_coinflip`, yalnız `Settled` oyun makbuzunu; eşleşen kalıcı aktivite hesabı ve ID'yi tüketmiş house ledger'ı ile kapatır. Settlement'ın ödeme, aktivite kaydı ve durum değişikliği aynı transaction'da olduğu için tek seferlik kayıt korunur. Close toplamları azaltmaz, nonce'u geri almaz, ödeme yapmaz; makbuzun kalan rent/bağış bakiyesini oyuncuya iade eder. Sonuç ve randomness alanlarını içeren `CoinflipClosed` olayı yayımlanır; bu olay kalıcı on-chain claim hesabı değildir.

Ödüllü yol, kazanılmış token haklarını ayrı incentives hesaplarına kabul işlemi içinde yazar; Games'in dönen iki saatlik özeti token hakkının kaynağı değildir. `close_coinflip` bu incentives hesaplarını kapatmaz. Ödül fazı, saatlik hak ve claim muhasebesi [incentives sözleşmelerinde](incentives-contracts.md) açıklanır. Bu yerel uygulama, canlı devnet üzerinde fonlanmış token fazı veya token launch yapılmış olduğu anlamına gelmez.

## Yerel doğrulamanın kapsamı

[Mock VRF](../tests/fixtures/mock-vrf/src/lib.rs), yalnız yerel LiteSVM içinde gerçek VRF ID'sinde yüklenen test fixture'ıdır. Gerçek SDK request biçimini, çağıran program PDA imzasını, scoped callback'i ve 500.000 lamport ücret transferini uygular. Sekiz slotlu özel queue'su vardır; fulfillment randomness'ını test seçer. **Proof, gerçek oracle, production queue düzeni, TTL, TEE veya ağ erişilebilirliği doğrulanmaz.** Paylaşılan cluster'a dağıtılmamalıdır.

1 Ekim 2026 son koşusunda **22 Coinflip LiteSVM testi geçti**. [Testler](../crates/games-tests/tests/coinflip.rs) derlenmiş SBF programlarıyla istek bağlama, ödeme kombinasyonları, sahte/yanlış/tekrar callback, fee/queue hatasında rollback ve pause yanında aktivite, saat geçişi/gerilemesi, makbuz kapatma ve replay senaryolarını çalıştırdı. `Ready → settle → close → eski ID ile place` tek transaction'ında ödeme/aktivite/iki makbuz bütünüyle geri alındı; `settle + close` tek seferde başarılı oldu. Başka oyuncunun gerçekten oluşturulmuş ledger/activity hesapları Place/Settle/Close girişlerinde reddedildi. Queue değiştirme ve saat geriletme senaryoları açıkça yapay VM fault fixture'larıdır.

Önceki tam koşuda **27 house LiteSVM, 11 game-math ve 13 reward-math testi** de geçti. Son üç Coinflip testinin eklenmesi program kodunu değiştirmedi. SBF dosyaları ve house/games IDL'leri üretildi, Clippy `-D warnings` ve rustfmt başarılı oldu. Bu sonuçlar gerçek VRF proof doğrulaması, canlı oracle veya fonlanmış token claim sistemi kanıtı değildir.

Tek imzalı, wallet fee payer kullanan ilk işlem `initialize_player + initialize_activity + place` olarak çalıştı. Bu legacy işlem **688 byte**, sonraki bahis **658 byte**, keeper `settle + close` işlemi **524 byte** ölçüldü; mevcut legacy 1.232 byte bütçesine sığıyorlar. Bunlar ek compute-budget veya priority-fee instruction'ları olmadan ölçülen işlem boyutlarıdır. İlgili [Solana işlem biçimi](https://solana.com/docs/core/transactions/transaction-structure).

Aynı yerel çalıştırmada CU değerleri sırasıyla 144.680, 65.226 ve 74.906 idi. PDA bump araması ve test girdileri sonucu değiştirebilir; **mock VRF maliyeti gerçek oracle maliyeti değildir**. Bu sayılar throughput, gecikme veya mainnet ücret tahmini olarak kullanılmaz. Canlı RPC simulation ve gerçek provider ölçümü istemci bütçesi belirlenmeden yapılmalıdır.

### Gerçek provider SBF ile ek Coinflip testi

19:39UTC ayrı `root-games-provider` hedefi **6/6 testi**, Clippy ve rustfmt kontrollerini geçti. [Kanonik komut ve kapsam](../experiments/vrf-recovery/README.md), [ölçüm kanıtı](../experiments/vrf-recovery/games-provider-evidence.json). House/Games yeniden derlendi; ELF hash'leri önceki artifact'lerle aynı kaldı. Root program kaynakları ve300.000CU istemci bütçesi değiştirilmedi.

İlk wallet+onboarding+bahis99.005CU/728byte, provider ücreti500.000lamport ölçüldü.120 kısa sentetik queue kaydında102.202CU,4.800 kayıtta223.167CU ile request kabul edildi.33.741CU callback sonrası kazanan19.600.000lamport, kaybeden0 ödeme aldı; settle+close sırasıyla83.915/83.381CU kullandı. Rent iadesi, nonce, tek ödeme, rezervin bırakılması, yanlış proof/scoped identity ve replay reddi sınandı. Pause ve kasıtlı160.000CU yetersiz bütçede bahis/rezerv/rent/oracle ücreti atomik geri alındı; işlem ücreti yine ödendi.

Sağlayıcı programı sabit upstream kaynaktan derlenmiş gerçek SBF'dir; transaction imza denetimi açıktır. Başlangıç queue hesapları, oracle anahtarı, upgrade authority ve saat/slot hash'leri **VM fixture'ıdır**. Canlı queue'nun oracle anahtarına sahip olmadığımızdan callback testi, kabul edilmiş request byte'larını açıkça test oracle'ının canonical queue'suna taşır. House/Games hesapları bu taşıma sırasında değiştirilmez. Bu deney canlı queue teslimatını, devnet provider binary/source eşitliğini, concurrency/TPS'yi veya mainnet maliyetini kanıtlamaz; VM rent tarifesi de canlı devnet rent'i değildir.

Gerçek provider purge instruction'ı sonrası callback ve settlement reddedildi, Games `Awaiting` ve house rezervi kilitli kaldı. Böylece yukarıdaki timeout/recovery açığı ayrıca gerçek provider entegrasyonunda yeniden üretildi; altı testin geçmesi bu açığın çözüldüğü anlamına gelmez.

Crash turu, manuel cash-out ve PER/TEE gizliliği bu Coinflip akışıyla uygulanmış değildir. Public Coinflip randomness akışı gizli Crash noktası için uygunluk kanıtı değildir. Token/staking sözleşmeleri ve backend chat ayrı modüllerdir; bu ödülsüz provider testi bunların kabulünü kapsamaz.
