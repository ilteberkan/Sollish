# SOL vault, bahis rezervi ve makbuz temizleme

Bu teslim, [house programında](../programs/house/src/lib.rs) SOL saklama, bahis başına escrow, shard başına teminat, tek seferlik ödeme ve güvenli makbuz temizlemeyi uygular. Sonuç doğrulaması ayrı game programının sorumluluğudur; güncel Coinflip akışı [Coinflip belgesindedir](coinflip.md). House içinde Crash cash-out, VRF/TEE doğrulaması, token, staking veya airdrop yoktur. Program kimliği: `9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2`.

[Bağımlılık dosyası](../programs/house/Cargo.toml) Anchor `=1.2.0` kullanır; rezerv aritmetiği [game-math](../crates/game-math/src/lib.rs) ile paylaşılır. Bütün tutarlar `u64` lamport, hesaplar checked integer aritmetiğidir. SOL dönüşümünde `1 SOL = 1_000_000_000 lamport` kullanılır.

## Hesaplar ve değiştirilemeyen bağlar

| Hesap | House programındaki PDA seed'leri | Veri alanları | Discriminator dahil alan boyutu |
| --- | --- | --- | --- |
| `HouseConfig` | `"house", authority` | `authority`, `game_program`, `paused`, `bump` | 74 byte |
| `PlayerLedger` | `"player", config, player` | `config`, `player`, `last_bet_id`, `bump` | 81 byte |
| `HouseShard` | `"shard", config, id:u16 LE` | `config`, `id`, `buffer`, `max_stake`, `max_gross`, `reserved`, `open_bets`, `total_bets`, `bump` | 91 byte |
| `BetReceipt` | `"bet", config, player, id:u64 LE` | `config`, `shard`, `player`, `id`, `stake`, `max_gross`, `reserved`, `payout`, `status`, `bump` | 146 byte |

Boyutlar `8 + INIT_SPACE` şema hesabıdır; Rust yapılarının bellekteki padding'li `size_of` değeri değildir. `status=0` açık, `status=1` sonuçlanmış bahistir. `reserved`, `open_bets` ve `total_bets` shard başına `u64` sayaçlardır. `total_bets` sonuçlanınca azalmaz; `reserved` ve `open_bets` azalır. Bet makbuzundaki `reserved` ise özgün rezervin tarihsel kaydı olarak korunur.

Config adresi authority ile ayrıldığı için global bir config'i ilk gelenin ele geçirmesi modeli kullanılmaz. Config'in authority ve game program adresi, shard'ın tamponu ve bahis limitleri oluşturulduktan sonra değişmez. Bahis adresinde shard bulunmaz. Kalıcı `PlayerLedger` sayesinde makbuz kapandıktan sonra da aynı config ve oyuncu için eski bet ID başka shard'da tekrar açılamaz.

Normal reserve/settle işlemleri config'i yalnız okur. Her shard ayrı yazılabilir hesaptır; ortak bir global reserve veya açık bahis sayacı yoktur. Reserve ayrıca oyuncu/config ledger'ını yazar: aynı oyuncunun yeni bahisleri, farklı shard'larda olsa da nonce hesabını paylaşır. Shard eklemek mevcut sermayeyi çoğaltmaz; her shard gerçekten fonlanır.

## Instruction arayüzü

| Instruction | Argümanlar | Yetki ve etkisi |
| --- | --- | --- |
| `initialize_house` | `game_program: Pubkey` | İmzalı authority kendi config'ini açar; verilen executable program ile argüman eşleşir. House ve System Program game olarak seçilemez. |
| `initialize_player` | Yok | Oyuncu kendi config'e bağlı ledger'ını bir kez açar, rent'ini öder; `last_bet_id=0` başlar. Game imzası gerekmez. |
| `create_shard` | `id:u16, funding:u64, buffer:u64, max_stake:u64, max_gross:u64` | Config authority imzalar; rent ve başlangıç sermayesini öder. `funding >= buffer`, `max_stake > 0`, `max_gross >= max_stake`. |
| `fund_shard` | `amount:u64` | İmzalı herhangi bir fonlayıcı pozitif tutarda house sermayesi ekleyebilir. LP payı veya geri çekme hakkı verilmez. |
| `withdraw_free` | `amount:u64` | Yalnız config authority; yalnız rezerv, tampon ve rent üzerindeki pozitif serbest tutar kendi adresine gider. |
| `set_paused` | `paused:bool` | Yalnız config authority; yeni reserve işlemlerini durdurur/açar. |
| `reserve_bet` | `id:u64, stake:u64, max_gross:u64` | Oyuncu ve yetkili game PDA imzalar; yalnız `id=last_bet_id+1` kabul edilir. Nonce, escrow ve rezerv aynı işlemde ilerler. |
| `settle_bet` | `payout:u64` | Yalnız yetkili game PDA imzası; oyuncunun yeniden imzası gerekmeden kayıtlı oyuncuya tek sefer ödeme yapılır. |
| `close_bet` | Yok | Yalnız yetkili game PDA; sonuçlanmış makbuzu kapatır, kalan rent ve bağışları kayıtlı oyuncuya gönderir. Ledger korunur. |

`reserve_bet` şu sınırları uygular: `0 < stake <= shard.max_stake` ve `stake <= max_gross <= shard.max_gross`. Stake tutarında bir iade böylece rezerv sınırları içinde kalabilir; iadenin hak edilip edilmediğine bu vault karar vermez. Sıfır sermayeli shard yalnız `buffer=0` ile oluşturulabilir; bu ona teminatsız ödeme yetkisi vermez.

Dokuz instruction vardır. İlk bahis ID'si `1` olur; ID atlamak veya eski ID'yi kullanmak reddedilir. Başarısız reserve veya aynı transaction'ın sonraki instruction'ındaki hata nonce'u da geri alır. `u64` taşması reddedilir. Ledger'ı kapatan, sıfırlayan veya yeniden başlatan bir instruction yoktur.

## Game programının yetkisi

Game authority, **game program ID'si altında** `"house_authority", config` seed'leriyle türetilen canonical PDA'dır. Reserve, settle ve close hem bu PDA'nın `Signer` ayrıcalığını hem de seed/program bağını kontrol eder. Ayrıca verilen executable game hesabı config'teki sabit adresle eşleşmelidir. Adresi doğru bir hesabı iletmek tek başına imza sağlamaz; yetkili game programı CPI sırasında `invoke_signed` kullanır.

Bu authority PDA'sının veri hesabı olarak oluşturulması veya game programına ait olması şart değildir. PDA türetme ile hesap sahipliği ayrı kavramlardır. Yetki, doğru program altında türetme ve runtime tarafından doğrulanmış imza ayrıcalığıdır.

Vault `payout <= bet.max_gross` denetler; sonucun veya cash-out'un doğruluğunu **yetkili game programına bırakır**. [Mock game](../tests/fixtures/mock-game/src/lib.rs) yalnız CPI yetki sınırını test eder. İleride fonlanmış reward/claim hakları oluşursa bunları close öncesi kalıcı durumda korumak game programının sorumluluğundadır; house bu hakları bağımsız doğrulamaz. Güncel Coinflip aktivite sayaçları token hakkı oluşturmaz.

Game program ID'sinin sabit olması kodunu değiştirilemez yapmaz. Game ve house programlarının upgrade authority'leri para güven sınırına dahildir. Yetkili game programı PDA imza ayrıcalığını keyfi başka programlara aktarmamalıdır. Gerçek oyun entegrasyonu, upgrade yönetimi ve bağımsız denetim tamamlanmadan bu temel mainnet oyun hizmeti olarak sunulamaz.

## Rezerv ve ödeme muhasebesi

`H = shard.lamports - rent_minimum(shard.data_len)`

`R = açık bahislerin house rezervleri toplamı`

`F = H - R - buffer`

Bir bahsin ek house rezervi `r = max(max_gross - stake, 0)` olur. Bahis kabulü `r <= F` gerektirir; ardından `R += r` yapılır. Stake tamamı ayrı bet hesabında kaldığından shard sermayesine veya başka bahsin teminatına sayılmaz. Bu teslim bahis anaparasından oracle/işlem ücreti kesmez. Böyle bir değişiklik yapılırsa rezerv hesabı gerçek net escrow üzerinden yeniden tasarlanmalıdır.

Sonuçlanan bahis için `w=stake`, `p=payout`:

- Bet escrow'dan oyuncuya `min(p,w)` gider.
- House shard'dan oyuncuya `max(p-w,0)` gider.
- Bet escrow'dan house shard'a `max(w-p,0)` gider.
- Shard toplam rezervinden bu bahsin rezervi çıkarılır; makbuz sonuçlanmış olarak işaretlenir.

Ödeme adresi makbuzdaki `player` alanıdır; değiştirilemez. Alıcının işlemde yeniden imzalaması veya hâlâ System Program'a ait olması aranmaz. Debite edilen hesapların house programına ait olması, hesap rent'i ve işlem sonundaki `H >= R + buffer` şartı kontrol edilir. Herhangi bir hata işlemin tamamını geri alır.

Örnek: rent hariç house sermayesi 1 SOL, tampon 0,01 SOL ise 0,01 SOL stake ve 1 SOL azami brüt ödeme için 0,99 SOL rezerv gerekir. Bu tek bahis serbest teminatı tamamen kullanır. Aynı stake ve 0,1 SOL azami brüt ödeme için 0,09 SOL rezerv gerekir. Bunlar yalnız muhasebe örnekleridir; maksimum Crash çarpanı, üretim limitleri, işletme ücretleri veya kârlılık taahhüdü değildir.

## Rent, bağışlar ve makbuz temizleme

Rent tutarı kaynak kodda sabitlenmez: işlem sırasında `Rent::get()?.minimum_balance(account.data_len())` kullanılır. Config/shard rent'ini authority, ledger ve bahis makbuzu rent'ini oyuncu öder. Ledger bir kez, makbuz her yeni bahis için oluşturulur. Transaction fee payer ayrıca seçilebilir. Kullanıcının toplam maliyeti güncel rent ve ücretlerle hesaplanmalıdır.

Bet hesabına dışarıdan SOL gönderilmesi settlement'ı bozamaz: escrow kontrolü `lamports >= rent + recorded_stake` biçimindedir. Settlement yalnız kaydedilmiş stake'i dağıtır. Sonraki `close_bet`, makbuzda kalan **rent dahil bütün lamportları ve bağış fazlasını kayıtlı oyuncuya** gönderir; başka alıcı seçilemez. Shard bağışı house sermayesine eklenir. Bağışçıya geri alma hakkı doğmaz.

Close açık bahisleri reddeder; eşleşen ledger'da `last_bet_id >= bet.id > 0` aranır. Sonuçlanan bahisler farklı sırada kapatılabilir. Kapatmak rezervi yeniden serbest bırakmaz veya nonce'u düşürmez; bunların işlemleri sırasıyla settlement ve reserve'de yapılmıştır. Aynı transaction'da close sonrası eski ID'yi yeniden reserve etme denemesi tüm transaction'ı geri alır.

Sabit config/shard sayısını dışarıda tutarsak vault durumu `O(oyuncu/config ledger'ları + açık veya henüz kapatılmamış makbuzlar)` olur. Tamamlanan makbuzları game kapatmalıdır; otomatik süreli temizlik yoktur. Sabit rent koşulunda bu iki hesap türünün maliyeti `P × minimum_balance(81) + U × minimum_balance(146)` olarak yazılabilir.

Güncel [Coinflip akışı](coinflip.md), settlement sırasında house makbuzunu kapatır; 252 byte oyun makbuzu için ayrı, permissionless `close_coinflip` sunar. Settlement önce 185 byte kalıcı `GamePlayerActivity` hesabına toplamları işler. Oyun makbuzu kapanınca bu özet ve house nonce ledger'ı kalır; rent/bağışlar oyuncuya döner. Temizlik çağrıları yapılırsa bu iki programın hesapları `O(oyuncu/house çiftleri + açık veya kapatılmamış bahisler)` ölçeğindedir. Temizlik isteğe bağlıdır; kapatılmayan makbuzlar büyümeyi sürdürür.

Aktivite hesabındaki iki UTC saat kaydı, son 60 dakikalık tam bahis geçmişi veya fonlanmış token claim defteri değildir. Token/airdrop şartları ve ileride hakları silmeden kapatma protokolü ayrıca tasarlanmalıdır; mevcut sayaçlar tek başına bunları çözmez.

Pause yalnız yeni bahis kabulünü durdurur; settlement, fonlama ve serbest teminat çekimini engellemez. Admin/player için keyfi iptal veya genel timeout iadesi yoktur. Game/oracle liveness arızasında bakiye süresiz escrow'da kalabilir; gerçek oyun entegrasyonu seçici iptal avantajı yaratmadan kurtarma/sonuçlandırma koşullarını kanıtlamalıdır.

## Doğrulama durumu

1 Ekim 2026: house ve yalnız yerel test için kullanılan mock game SBPFv2 olarak derlendi. [27 LiteSVM testi](../crates/house-tests/tests/vault.rs) bu `.so` dosyalarını yükleyerek geçti. Ödeme/teminat/rent, yanlış hesap ve imzalar, admin yetkisi, pause, donation/prefund, atomik rollback yanında ardışık nonce, ledger reset/substitution, close yetkisi, rent iadesi, close sonrası replay ve nonce taşması denendi. Recipient owner değişikliği testi yapay VM hesabı kullanır ve ağda böyle bir değişimin gerçekleştiğini iddia etmez. Math paketindeki 11 sınır testi ayrıca geçti.

Aktivite ve oyun makbuzu temizliğini içeren tam koşuda **27 house LiteSVM, 19 Coinflip LiteSVM, 11 game-math ve 13 reward-math testi geçti**. Kontratlar değiştirilmeden eklenen atomik rollback, hesap değiştirme ve işlem boyutu testleriyle Coinflip'in sonraki koşusu **22/22** oldu. SBF dosyaları ve house (dokuz instruction), games (altı instruction) IDL'leri üretildi. Clippy `-D warnings` ve rustfmt kontrolleri geçti. Reward-math başarısı fonlanmış token ödülü veya claim sistemi kurulduğu anlamına gelmez.

Tekrarlanabilir komut: `bash scripts/test-contracts.sh`. LiteSVM testi gerçek ağ yükü, cash-out gecikmesi, oracle/TEE gizliliği veya devnet/mainnet dağıtımı kanıtı değildir. Bağımsız audit yapılmadı.
