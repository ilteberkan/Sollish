# Özgün oyunlar: sunum, sözleşme ve kalan kabul koşulları

1 Ekim 2026 kaynak/kanıt incelemesi. Bu belge yeni finansal oyun, canlı izin veya deploy onayı değildir. Kaynaklar: [Games](../programs/games/src/lib.rs), [House](../programs/house/src/lib.rs), [Coinflip](coinflip.md), [PER kapıları](per-spike.md), [izole recovery deneyi](../experiments/vrf-recovery/README.md).

## Boks sunumu bugün neyi temsil eder?

`/game/boxing` yolundaki **RINGSIDE**, Sollish'e özel KOR ve AYAZ karakterleriyle oynanabilen yerel demodur. Next.js istemci sınırında yalnız bu rota açıldığında yüklenen Three.js sahnesi; ring, karakterler, kamera geçişi ve maç koreografisini üretir. Karakterler, lisansı doğrulanmış Quaternius CC0 yetişkin modeline ve aynı iskelete ait animasyon kliplerine dayanır. Yerel GLB varlıkları, Three.js GLTFLoader/AnimationMixer ile yüklenir; ring ve özgün sunum kodla üretilir. Kaynak/lisans/hash kayıtları `apps/web/public/models/boxing/credits.json` dosyasındadır. Sonuç sahneden bağımsız olarak maç başında kilitlenir. Cüzdan, SOL veya platform token'ı kullanılmaz.

Demo iki eşit uint32 aralığıyla %50/%50 seçim yapar; kazananda yatırılan miktar dahil 1,96× brüt dönüş ve aşağı yuvarlanan kredi kuruşları kullanılır. Bu tarayıcı rastgeleliğidir, VRF kanıtı değildir. `BoxingRoundGate`, süre/sekme dönüşü/unmount yollarının aynı demo rezervini yalnız bir kez tüketmesini sağlar. Erken ayrılmada yalnız demo kredisi iade edilir; süre geçmişse kilitli sonuç uygulanır. Finansal oyuna bu iade kuralı taşınmaz.

Normal gösterim 8,8 saniye, azaltılmış hareket 1,2 saniyedir. Grafik bağlamı veya yükleme başarısızlığında SVG arena görünür ve sonuçlandırma devam eder. Sahne DPR'ı 1,5 ile sınırlar; animasyon en fazla 30 fps çalışır ve görünmeyen sekme/arenada durur. Bunlar kod sınırlarıdır; bütün cihazlarda ölçülmüş performans garantisi değildir. Gerçek SOL erişimi kapalıdır; aşağıdaki sözleşme tasarımı henüz bu rotaya entegre edilmemiştir. Ayrı `/live/boxing` rotası, tek sunucu turunu ve 5 saniyelik bahis penceresini paylaşan LIVE DEMO sunar. Bu odada bağlantı kopması iade oluşturmaz; azaltılmış hareket, 8,8 saniyelik ortak turu kısaltmaz. Ayrıntılar [ortak tur ve kasa](architecture/live-rounds-and-house.md) belgesindedir.

Mevcut sözleşme oyuncuya ait tek bir Coinflip bahsini ve `side=0/1` seçimini destekler. Sonuç `randomness[0] & 1`; kazanan brüt ödeme, stake ve config'te kilitli edge'den hesaplanır. Boksçular, vuruş sırası ve kamera/animasyon bu ikili sonucun görsel anlatımı olabilir. Animasyon finansal sonucu belirlemez.

- `0 → sol köşe`, `1 → sağ köşe` eşlemesi inceleme ekranında açık ve bahis boyunca sabit olmalıdır. Kazanan boksör oyuncunun seçimine göre değiştirilmez.
- Yerel demo sonucu açıkça demo olarak gösterilir. Canlı görünüm yalnız doğrulanmış on-chain sonucu canlandırır; bekleyen veya bilinmeyen işlem animasyonla kazanmış/kaybetmiş sayılmaz.
- `Ready`, oracle sonucu kaydedildi demektir; cüzdana ödendi demek değildir. Ödeme ve kesinleşme ayrı durumlar olarak gösterilir.
- Mevcut on-chain oyun bağımsız, cüzdan başına iki sonuçlu Coinflip bahisleridir. Yeni LIVE DEMO gerçekten ortak tur ve sonuç paylaşır; bu, ortak SOL potu veya deploy edilmiş shared-round sözleşmesi olduğu anlamına gelmez.
- Yeni RNG, çok turlu ödeme, kombine bahis, odds veya ek house riski yalnız UI değişikliğiyle eklenemez. “Provably fair” iddiası gösterilen sözleşme/sağlayıcı/doğrulama kapsamını aşamaz.

## Sonraki sözleşme arayüzü için yön

Önce mevcut iki sonuçlu ödeme modeli korunur; sunum kimliği ekonomik `game_kind` ile karıştırılmaz. İleride yeni ekonomik kurallar gerektiğinde aşağıdaki bağlar ayrı bir tasarım/test kapsamıdır:

| Kayıt | Önerilen bağ |
| --- | --- |
| `GameDefinition` | Sürüm, ekonomik oyun türü, kuralların hash'i, randomness sağlayıcı/config sürümü, payout hesabı ve sınırlar. Aktif bahislerin tanımı sonradan değişmez. |
| `Bet` | Definition sürümü, house/shard/player/tekil nonce, seçilen taraf, stake, azami brüt ödeme ve özgün randomness isteği. |
| `GameResult` | Aynı bet ve definition, kanıtlanmış entropy, deterministik outcome, kesin payout ve consumed durumu. |
| Sunum | `presentation_id/version` ve outcome→görsel eşlemesi. Sözleşme ödemesini değiştirme yetkisi yoktur. |

Genel bir admin callback'ine serbest payout verme yetkisi eklenmez. House'un yetkili Games PDA sınırı, önceden ayrılmış azami yükümlülük, tek ödeme ve nonce korunur. Gelecekte `game_id/rules_version` bet, receipt ve olaylara birlikte bağlanır; bugünkü kozmetik skin yeni veya deploy edilmiş bir boks programı değildir. Ortak Crash round'u için ayrı round/bet/revision ve kabul sırası gerekir; mevcut Coinflip kaydı bunun yerine geçmez. Yeni instruction/account şeması, IDL/SDK/indexer ve kanonik olay sürümleriyle birlikte tasarlanır.

Paylaşılan global dövüş eklenirse bahis penceresi randomness açıklanmadan **önce** sözleşmede kesin kapanmalıdır. Daha önce public VRF sonucu belli olmuş bir round'a yeni bahis kabul etmek bilinen kazanana bahis açar; mevcut açık sonucu global maç için yeniden kullanmak güvenli değildir. “Özgün” hedefi Sollish karakterleri ve deneyimidir; doğrulanamayan “dünyada ilk” iddiası değildir.

## Coinflip: özgün proof ile kurtarma entegrasyonu

**Bugün:** scoped callback ve House ödemesi mevcut; kayıp queue kaydından kurtarma root Games'e eklenmedi. Yerel recovery deneyinin 35 testi ve gerçek provider SBF ile Coinflip'in 6 testi ayrı kanıtlardır. İkinci deneyde callback için request byte'ları test oracle'ının canonical queue'suna taşınır; canlı oracle teslimatı kanıtı değildir. [Recovery kanıtı](../experiments/vrf-recovery/evidence.json), [Coinflip/provider kanıtı](../experiments/vrf-recovery/games-provider-evidence.json).

Uygulanabilir sonraki adım, onaydan sonra sürümlü `CoinflipBetV2` kabul yoludur:

1. **İlk kabulde sabitleme.** House lock + ilk scoped VRF CPI + queue capture + kalıcı snapshot aynı transaction'da tamamlanır. Capture hatasında stake, rezerv, nonce, rent ve oracle ücreti geri alınır; ağ işlem ücreti ayrı kalır.
2. **Snapshot alanları.** Bet/config bağına ek olarak ilk `vrf_input:[u8;32]`, oracle kimliği, ilk Ristretto VRF public key, queue adresi/index'i, request slot/zamanı ve layout/provider sürümü tutulur. Kuyruk konumu input'u yeniden hesaplamak için kullanılır; sonradan pointer olarak takip edilmez. Bütün bu alanlar ilk kabulden sonra değişmez.
3. **Güvenilir capture.** Provider owner/discriminator ve canonical queue/oracle PDA'ları kontrol edilir. Gerçek Clock/SlotHashes ile input yeniden hesaplanır; callback program/discriminator/metas/args birebir eşleşen tek kayıt bulunur. Aynı seed ile yeni request göndermek yasaktır; seed gerçek VRF input'u değildir.
4. **Normal callback aynı bağa tabi.** Scoped signer yeterli sayılmaz. İzole deneydeki doğrudan provider instruction/Instructions sysvar kontrolüyle ilk input, ilk key ve `SHA256(output)` eşleşmesi korunur. Üretim daemon'ının bu callback biçimiyle uyumu ayrıca denenir; wrapper CPI desteği varsayılmaz.
5. **Permissionless recovery.** Süre koşulundan sonra sunulan aynı output/proof, ilk key ve input ile resmî verifier üzerinden doğrulanır. Geçersiz/identity key veya point ve canonical olmayan scalar reddedilir. Yalnız aynı `Awaiting → Ready` geçişi ve aynı entropy yazılır; doğrudan para transferi yapılmaz. Normal callback ve recovery ortak tek-tüketim durumunu kullanır.
6. **Ödeme ve geçiş.** Mevcut permissionless settlement tek kaydedilmiş sonuçtan ödeme yapar. Callback/recovery yarışı, close, yeniden yerleştirme, rent/bağış, ödül hakkı ve keeper yeniden denemeleri birlikte sınanır. Snapshot'ı bulunmayan eski V1 bahisleri için admin'in sonradan key/input seçmesi kabul edilmez; eski bekleyen bahislerin geçişi ayrıca çözülmelidir.

Bu plan oracle'ın hiç açıklamadığı proof'u üretmez. Provider'ın arşivlenmiş aynı input/proof'u erişilebilir kılacağı somut API/operasyon taahhüdü ve kesinti modeli hâlâ yoktur. Timeout iadesi, reroll, yeni anahtarla sonuç veya seçilebilir fallback eklenmez; **tam liveness çözüldü denemez**.

İzole deneyde kullanılan API/prover, pinned upstream lisans/NOTICE altında yalnız üretim dışı çalışmaya alınmıştır. Üretimde kullanma hakkı çözülmeden root programa taşınmaz; MIT `ephemeral-vrf-sdk` lisansı ayrı paketlerin yerine geçmez. [Yerel NOTICE](../experiments/vrf-recovery/NOTICE.md), [pinned upstream](https://github.com/magicblock-labs/solana-vrf/tree/52b103c5d55d72e07456a445044b3c006cb87c1a). Bu bir lisans görüşü değil, kapatılmamış kullanım koşulu kaydıdır.

Capture bütün queue'yu tarar. Deneyde 4.800 kısa kayıtta kabul/capture 618.367 CU kullandı; mevcut normal Coinflip request'inin 300.000 CU bütçesi buna yeterli sayılmaz. Tam Games entegrasyonunda işlem boyutu, rent, CU üst sınırı, gerçek payload dağılımı ve yoğunluk altında atomik rollback yeniden ölçülmelidir. Yerel 23.797 CU proof doğrulaması toplam kabul/settlement maliyeti değildir.

## Manuel Crash: açık kalan kapılar

Canlı probe private hazırlık, scoped callback ve iki readonly komut gösterdi. Bunlar oynanabilir parasal Crash veya manuel cash-out değildir. [Son sınırlı koşu](../experiments/per/evidence/probe-resume-initialized-latest.json) hâlâ `BLOCKED`, `productionApproval:false` döner.

| Kapı | Kalan kanıt |
| --- | --- |
| TEE kimliği | Bağımsız ölçüm allowlist'i; quote→validator→uygulama/program bağı. RPC'de aynı ELF görmek attestation değildir. |
| Sonucun gizliliği | Uçuş halindeki queue, WS ve tüm işlem/proof yolları. 36 türetim denemesi parse edilemedi ve 0 aday üretti; gizlilik kanıtı yok. |
| Manuel kabul | Gizli sonucu okumadan cash-out; sınır öncesi/sonrası sıra, tekrar, bağlantı kopması ve eşzamanlı oyuncular. 16 başarılı simülasyon writable yükseltmenin engellendiğini göstermez. |
| L1 ödeme | Round/bet/player/amount/revision bağlı tek hak, doğrulanmış commit ve bir kez House ödemesi. TEE finalized, L1 commit değildir. |
| Kesinti | Oracle/PER/keeper/commit kesintisinde kabul edilmiş hakkın korunması; seçilebilir iptal veya public randomness fallback olmadan kurtarma. |

### Açıklama sonrası gerçek veriyle pozitif kontrol

1 Ekim **20:05:45–20:05:46 UTC** anonim, salt okunur RPC kontrolünde mevcut tur `3a3Ar74sNKUScYvhDaqPNcnhHvfzB6cSm5Dj1bh64nqF` hâlâ `state=4` idi; randomness hash'i önceki reveal kaydıyla eşleşti. Yeni round, auth, anahtar okuması, işlem veya ödeme yapılmadı.

Önceden aynı tur geçmişinde kayıtlı callback `PMLWf3fyXkCXQDUNNAbpcsXSXJ1fLy45qazRBuHWsGHWNxNi2PixNKSxtCVffkz3PCbi5o9TWFW7EnrKg2Gm4Zd`, hem JSON hem base64 olarak mevcut [VRF tarayıcısından](../experiments/per/vrf-visibility.mjs) geçirildi. İki biçimde de **1 doğru scope'lu aday, 1 açıklanmış randomness eşleşmesi** bulundu. Proof kriptografik olarak doğrulanmadı; input bağı hâlâ `ACCOUNT_SCOPE_ONLY_INPUT_NOT_INDEPENDENTLY_BOUND` idi. Ham response, randomness ve proof saklanmadı.

| Açıklama sonrası response | Byte | SHA256 |
| --- | --- | --- |
| JSON | 2389 | `1adc80d251c30f6dde48be4aebba3ddc10de91d47b4c5638b42b6149f7576a9b` |
| base64 | 2074 | `0269dbbd0eeebe08bdc2eccc5917c5a979b0292337e83b53c9d9d99742854eac` |

Tarayıcının `DERIVABLE_SECRET_OBSERVED/FAIL` etiketi bu **açıklama sonrası pozitif kontrolde beklenen** sonuçtur; tur öncesi sızıntı bulgusu değildir. Önceki ready-phase anonim callback response'ları 703/715 byte idi. Değişim filtrelemeyle uyumlu olabilir; eski ham response'lar saklanmadığından bunun nedeni doğrulanmış değildir. Yeni kontrol, tarayıcının açıklanmış gerçek provider verisini tanıdığını gösterir; önceki parse edilemeyen 36 gözlemi gizlilik PASS'e dönüştürmez.

## Tekrarlanabilir durum kontrolü

`node scripts/check-launch-readiness.mjs` ağsız JSON raporu üretir; özel anahtar/env okumaz, işlem göndermez. Mevcut yerel source/test/log/binary hash'leri kayıtlarla karşılaştırılır; PER kaydı tarihsel ve sınırlı olarak raporlanır. Hash uyumu bağımsız audit veya kaynağın otantikliği kanıtı değildir.

Çıkış kodu `2`: kayıtlar kendi kapsamlarında tutarlı, bilinen üretim kapıları hâlâ kapalı. `1`: eksik/değişmiş/tutarsız kanıt veya kullanım hatası. Script'te otomatik üretim onayı yolu yoktur; kapıları kapatmak yeni uygulama, kanıt ve bağımsız inceleme gerektirir. Test komutu: `node --test scripts/check-launch-readiness.test.mjs`.

Finansman ayrı önkoşuldur: 1 Ekim **19:57:16 UTC**, pinned devnet genesis ile finalized kontrolünde mevcut payer `2By6…J4waA` bakiyesi **457.510.728 lamport**, slot **506387359** idi. Bu anlık gözlem yeni deploy veya bankroll yeterliliği değildir. 19:17 faucet hatasından yalnız 40 dakika geçtiğinden doğrulanmış reset olmadan tekrar istek yapılmadı.

Sonraki **20:26UTC** kontrolde resmî endpoint'e tek2 test SOL isteği `-32603` hatası verdi; imza yok, yeniden deneme yok. Finalized bakiye yine457.510.728lamport kaldı. [Sanitize kayıt](../ops/evidence/devnet-funding-recheck-20261001.json).
