# Fonlanmış staking ve oyun ödülleri

Bu belge [incentives](../programs/incentives/src/lib.rs), [phase/epoch modülü](../programs/incentives/src/rewards.rs) ve [games](../programs/games/src/lib.rs) kodunun uyguladığı protokolü anlatır. Program kimliği `E5tr12oarJumShYmXvohnSDJNVKrVGuKS4gLm6pdgfHv`. Kaynak kodu, derlenmiş SBF ve yerel VM doğrulaması mevcuttur; token launch, devnet/mainnet deployment veya gerçek token fonlaması yapılmış olduğu anlamına gelmez.

## Ortak token ve yetki sınırları

Her pool/phase house, mint ve token programına değiştirilemez şekilde bağlıdır. Mint altı ondalıklıdır; mint ve freeze yetkileri kapatılmış olmalıdır. Klasik SPL Token desteklenir. Token-2022'de yalnız `MetadataPointer` ve `TokenMetadata` mint uzantılarına izin verilir. Transfer fee, permanent delegate, transfer hook, non-transferable, pausable ve diğer uzantılar reddedilir. Token transferleri gerçek `transfer_checked` CPI çağrılarıdır; metadata uzantıları muhasebe birimini değiştirmez.

Pool/phase oluşturma yetkisi house authority'dedir. Bu yetki, oyuncu anaparasını veya dağıtılmamış ödülleri çekme yetkisi vermez. İlgili programların upgrade authority'si ayrı bir güven sınırıdır; kod upgrade edilebilirken yalnız program adresinin sabit olması değiştirilemez kod garantisi sağlamaz.

## Staking

Pool adresi `[staking, house, mint, id_u64_le]`; anapara vault'u `[principal, pool]`, ödül vault'u `[staking_rewards, pool]`, oyuncu pozisyonu `[stake, pool, player]` seed'leriyle türetilir. Pool ve vault'lar program kontrolündedir. Başlangıç/bitiş zamanları ve ödül bütçesi pool yaratılırken sabitlenir; bütçenin tamamı aynı transaction'da ödül vault'una aktarılır. Fonlama başarısızsa pool oluşmaz.

Talimatlar:

- `initialize_pool(id, start_ts, end_ts, budget)` ve `initialize_staker()`.
- `stake(amount)`, `unstake(amount)` ve `claim_staking()` oyuncunun imzasını ister. Alıcı token hesabı aynı oyuncuya ve sabit mint'e bağlıdır.
- Stake artırma kampanya sonunda kapanır; anapara çekme ve kazanılmış ödülleri talep etme kapanmaz.

Emisyon, başlangıç dahil/bitiş hariç süre boyunca bütçenin zaman oranlı payıdır. Stake bulunmayan aralığın payı sonradan gelen oyunculara verilmez. Global pay ve oyuncu kesirleri `10^18` precision ile tutulur; sık küçük işlemle yuvarlama kaybı oluşturulması engellenir. Saat gerilemesi ikinci kez emisyon üretmez ve anapara çekimini engellemez. Getiri, süre boyunca toplam stake'e bağlıdır; sabit APR sözü verilmez.

Korunan muhasebe:

- `principal_vault.amount >= pool.total_staked`.
- `reward_vault.amount >= budget - claimed`.
- `claimed <= allocated <= budget`.

Doğrudan vault bağışları kişisel stake veya hak ediş yaratmaz. Kullanılmayan emisyon ve yuvarlama artığı rezervde kalır. Yönetici sweep talimatı yoktur. Pozisyonlar kapatılmaz; pool başına oyuncu başına tek sabit boyutlu hesap vardır.

## Phase'li bahis ödülü ve saatlik airdrop

Bu sürümde hak, **on-chain kabul edilmiş ve escrow'a yatırılmış bahis** üzerinden doğar. Randomness veya sonuç henüz gelmemiş olabilir. Mevcut oyunlarda timeout refund/cancel yoktur; ileride refund eklenirse bu teşvik kuralı birlikte yeniden tasarlanmalıdır.

Yeni `games.place_coinflip_rewarded(id, side, stake, epoch)` isteğe bağlı yoldur. Gerçek house rezervasyonu, SOL stake transferi, VRF isteği ve `incentives.credit_wager` aynı transaction'da tamamlanır. Incentives kredisi yalnız house'un sabit game programının `[incentives_authority, house]` PDA imzasıyla mümkündür. Backend, house admin veya oyuncu tek başına kredi yazamaz. Games bu imzayı yalnız yeni bir bahis kabul edilirken üretir; house'un kalıcı oyuncu nonce'u eski bahis ID'sini yeniden açmayı engeller.

Eski `place_coinflip` ödülsüz yol olarak kalır. Fon yetersizliğinde UI açıkça ödülsüz bahis seçimi sunabilir; kullanıcının seçtiği ödüllü işlem sessizce ödülsüz işleme dönüştürülmemelidir. `settle_coinflip` hiçbir reward/token hesabına ihtiyaç duymaz; SOL kazancının ödenmesi token claim'lerine bağlı değildir.

Phase adresi `[phase, house, mint, id_u64_le]`, vault `[phase_vault, phase]` olur. `initialize_reward_phase(args)` ile gelecekteki tam UTC saatlerinde başlayan, en fazla 90 günlük süre tanımlanır. Phase ID, oranlar, minimum bahis ve bütçeler değiştirilemez. Toplam ön fonlama:

`wager_budget + (end_epoch - start_epoch) * hourly_budget`.

Bahis token hakkı `floor(stake_lamports * rate_units_per_sol / 1_000_000_000)` olur. Bu miktarın tamamı kalan `wager_budget` ile karşılanamıyorsa ödüllü bahis bütün yan etkileriyle geri alınır; kısmi oran uygulanmaz. Hak, `[reward_user, phase, player]` hesabında birikir ve `claim_wager_rewards()` ile alınır. Claim'in son tarihi yoktur.

Saat `Clock.unix_timestamp / 3600` ile belirlenir; istemcinin gönderdiği epoch gerçek saatle eşleşmek zorundadır. `[hour, phase, epoch_u64_le]` global saat hesabı; `[hour_user, phase, epoch_u64_le, player]` oyuncu katılım hesabıdır. Oyuncunun bu saatteki kabul edilmiş toplam bahsi minimum eşiğe ulaşınca `qualified_wallets` bir kez artırılır. Ek bahisler aynı cüzdanı ikinci kez saydırmaz. İlk eşik geçişinde o cüzdanın saatteki tüm bahis hacmi `qualified_wagered_lamports` toplamına eklenir; sonraki bahisler yalnız yeni tutarı ekler. Uygun toplam hacim u64 ile sınırlıdır; bu sayede bütçe × hacim çarpımı u128 içinde kalır.

Saat tamamlandıktan sonra `claim_hourly()` global saati kalıcı olarak mühürler. Her uygun cüzdanın payı:

`floor(hourly_budget * wallet_wagered_lamports / qualified_wagered_lamports)`.

Bu oran, aynı uygun bahis hacmini birden çok cüzdana bölmeyi ödüllendirmez. Eşik altında kalan cüzdanların hacmi paydaya girmez.

Payda ilk claim'den sonra değişemez; kalan vault bakiyesi payda olarak kullanılmaz. Boş saatlerin bütçesi ve bölme artıkları vault'ta kalır. Minimum bahis eşiği bir ekonomik katılım koşuludur; Sybil direnci veya benzersiz insan kimliği değildir.

## Claim replay ve rent

Saatlik claim transferi ve oyuncu katılım hesabının kapatılması atomiktir; tüm rent/bağış lamport'ları kaydedilmiş oyuncuya döner. Kalıcı global epoch mührü, saat gerilese bile kapalı oyuncu kaydının yeniden oluşturulmasını engeller. Mühürlenmiş saatlerde henüz almamış oyuncuların claim'leri saat gerilemesinde de ödenebilir.

Uygun olmayan saat kaydı `close_hourly_record()` ile saat kapanınca rent iadesi için kapatılabilir. Uygun fakat claim edilmemiş hak bu yolla kapatılamaz. Phase sona erdikten ve oyuncunun bahis ödülü `pending=0` olduktan sonra `close_reward_player()` hesabı kapatabilir. Bu işlem phase kredi kapısını kalıcı mühürler; eski saate dönüş hesabın yeniden açılmasını sağlamaz. Diğer oyuncuların eski claim hakları devam eder.

Global phase ve katılım olan global epoch hesapları kalıcıdır; oyuncu başına saatlik hesaplar claim/uygun olmayan kayıt cleanup sonrası geri alınabilir. Boş saat için admission hesabı açılmaz. İlk ödüllü katılım mevcut olmayan reward hesaplarının rent'ini oyuncuya ödetir; UI transaction maliyet tahmininde bunu göstermelidir. Büyük shared phase/epoch yoğunluğunun write-lock kapasitesi ayrıca yük testine tabidir; yerel testler binlerce eşzamanlı kullanıcı kapasitesi iddiası değildir.

## Backend ve istemci

IDL: `target/idl/incentives.json`; games'in yeni instruction'ı `target/idl/games.json` içindedir. Mevcut `CoinflipBet` ve `CoinflipSettled` yerleşimleri değişmemiştir. Yeni olaylar `PoolInitialized`, `Staked`, `Unstaked`, `StakingClaimed`, `RewardPhaseInitialized`, `WagerCredited`, `WagerRewardClaimed`, `HourlyRewardClaimed`.

Indexer yalnız başarılı ve finalized transaction'lardaki doğru program invocation'ından gelen olayları işler; transaction signature + instruction/event konumu ile idempotent olmalıdır. DB, token haklarını yaratmaz. Claim ekranı ilgili on-chain hesapları okumalı, işlem öncesi simülasyon yapmalı ve para hareketini finalized durumla göstermelidir. Chat'in kayan son 60 dakikalık eşiği ile airdrop'ın tam UTC saatleri aynı pencere değildir.

## Doğrulama

Canonical komut `bash scripts/test-contracts.sh`; builder her manifesti ayrı `--locked`, SBF v2 olarak derler, IDL üretir ve Rust test/Clippy/format denetimini çalıştırır. Staking testleri [staking.rs](../crates/incentives-tests/tests/staking.rs); ödül entegrasyonu [rewarded.rs](../crates/games-tests/tests/support/rewarded.rs). Staking transferleri klasik SPL ve Token-2022 programlarıyla çalıştırılır. Ödül entegrasyonu gerçek games/house/incentives SBF çağrılarını kullanır; randomness sağlayıcısı açıkça etiketli yerel scoped-VRF fixture'dır, canlı oracle doğrulaması değildir.

Kapsam: 13 staking testi ve 17 ödül entegrasyon testi; mevcut 22 Coinflip, 27 house ve matematik regresyonları korunur. Wallet payer ile yeni ödüllü bahis 864 byte, ilk-wallet onboarding + ödüllü bahis 894 byte legacy paket ölçülmüştür; bu iki ölçüm ComputeBudget talimatı olmadan alınmıştır (1232 sınırının altında). Ortak istemci nihai serialize edilmiş her işlemi 1232 byte sınırına karşı ayrıca doğrular. CU ölçümleri fixture'a ve PDA'lara bağlıdır; gerçek sağlayıcı maliyeti veya TPS için kullanılmaz. Son canonical çıktı `target/incentives-validation.log` dosyasındadır.
