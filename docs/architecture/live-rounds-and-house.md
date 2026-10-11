# SOLO, ortak LIVE turu ve kasa sınırları

İnceleme: 1 Ekim 2026. Bu belge mevcut kaynak kodunu, yeni LIVE **DEMO** protokolünü ve ilerideki SOL turu için öneriyi ayırır. Ortak tur sözleşmesi uygulanmış, denetlenmiş veya gerçek paraya açılmış değildir. Demo kredisi SOL, token, mevduat veya çekilebilir alacak oluşturmaz.

## Ürün ayrımı ve beş saniye

SOLO'da oyuncu kendi turunu başlatır. Mevcut [Coinflip programı](../../programs/games/src/lib.rs) oyuncu/bahis kimliği başına ayrı VRF isteği üretir. Ortak LIVE turunda bütün katılımcılar aynı tur kimliğini, kapanışı ve sonucu paylaşır; tek oyuncunun ekran animasyonu tur otoritesi olamaz. İlk ortak uygulama RINGSIDE LIVE DEMO'dur; yerel SOLO demo bakiyesinden ayrıdır.

Demo durum sırası:

```text
OPEN [openedAt, openedAt+5000ms)
  → CLOSED kalıcı kayıt
  → sunucu CSPRNG sonucu → FIGHTING (8800ms)
  → RESULT (4000ms) → yeni tur
```

Kabul koşulu `phase=open && openedAt <= serverNow < closesAt` olur. Tam `closesAt` anındaki istek reddedilir. Tarayıcı tıklama saati, gecikmiş WebSocket mesajı veya ekranın hâlâ açık görünmesi bu sınırı değiştirmez. Geciken alarm da süreyi uzatmaz: her bahis, sunucunun güncel saatini tekrar kontrol eder. CLOSED kalıcı olmadan sonuç üretilmez. Kapanmış durum, saat geriye gitse bile OPEN'a dönmez.

Sunucu aynı oda için komutları sıralar; kredi düşümü ve bilet yazımı tek kalıcı işlemde tamamlanmadan `accepted` göndermez. Kaybolan ACK, kabul edilmedi anlamına gelmez. Aynı oturum/`clientId` ve aynı yük tekrar geldiğinde önceki bilet döner; aynı kimliğe farklı miktar/taraf reddedilir. Kopma veya sekme değişimi ortak turu iptal etmez ve yeniden bahis/iade doğurmaz. Ödeme, bilet durumunu ve bakiyeyi atomik değiştirir; tekrar işleme ikinci ödeme yaratmaz.

Ortak [protokol](../../packages/protocol/src/live-round.ts), gelen ve giden mesajları alan allowlist'iyle doğrular. Genel snapshot oturum token'ı/bakiye/bilet içermez. OPEN/CLOSED aşamasında kazanan ve maç zamanları null olmak zorundadır. Sonuç FIGHTING başlarken artık kamuya açıktır; animasyon sonuç üretmez. Bu, sunucu tarafından yönetilen değersiz demodur; VRF veya manipülasyon yapılamazlık iddiası değildir. İstemci eski snapshot sürümünü atmalı; aynı sürümde çelişen tur içeriğini kabul etmemelidir.

SOL sürümünde otorite oyun programının `Clock` ve tur PDA'sıdır. Solana Clock her slot güncellenen tahmini küme zamanını verir; saniyelik Unix zamanıdır. Dolayısıyla L1 üzerinde bütün cihazlar için tam 5000 gerçek duvar-saati milisaniyesi veya beş saniye içinde kesin işlem dahil edilmesi vaat edilmez. İmzalanmış/gönderilmiş işlem, kabul edilmiş bahis değildir. İşlem yürütülürken cutoff geçmişse program reddeder. RPC kabulü, confirmed ve finalized durumları UI'da ayrı gösterilir. [Agave Clock açıklaması](https://docs.anza.xyz/runtime/sysvars#clock)

Gerçek shared-round önerisi: `OPEN → LOCKED → RANDOMNESS_PENDING → RESOLVED`; lock sonrasında girdiler değişmez. Request kimliği tur kimliğine ve kilitlenen girdilere bağlanır. Callback yalnız scoped oracle yetkisiyle sonucu bir kez kaydeder; ödemeler ayrı, permissionless işlemlerdir. Sırasız callback başka turun sonucunu tüketemez. Kapanıştan önce hiçbir sonuç isteği/ifşası olmamalıdır. Bu ilkeler, request eşleme, request sonrası girdi yasağı, tekrar çekiliş yasağı ve küçük callback tavsiyeleriyle uyumludur. Chainlink burada tasarım referansıdır; Solana'da Chainlink VRF kullandığımız anlamına gelmez. [VRF güvenlik ilkeleri](https://docs.chain.link/vrf/v2-5/security)

## Kaybeden stake ve 1 SOL kasa

Mevcut [House `settle_bet`](../../programs/house/src/lib.rs) kayıtlı stake'i şu şekilde dağıtır:

- Oyuncuya escrow'dan `min(payout, stake)`.
- Oyuncuya house shard'dan `max(payout-stake, 0)`.
- Escrow'dan house shard'a `max(stake-payout, 0)`.

Bu nedenle Coinflip kaybında `payout=0` ise stake'in tamamı kasaya geçer. Kazanıldığında stake geri döner ve ek kazanç kasadan çıkar. Receipt rent'i ve istenmeden gönderilmiş bağışlar kasa geliri sayılmaz; receipt kapatılınca kayıtlı oyuncuya döner. `fund_shard` katkısı da kullanıcıya LP veya geri alınabilir mevduat payı basmaz.

50/50 olasılık ve 1.96x brüt ödeme, yuvarlama öncesinde %98 RTP / %2 house edge demektir. Masrafsız örnekte 1 SOL kasa ve 0.1 SOL bahis: kayıpta kasa 1.1 SOL; kazançta 0.904 SOL olur. Beklenen kasa artışı 0.002 SOL'dür, gerçekleşen tur kârı garanti değildir. Oracle/işlem ücretleri, ödüller, işletme giderleri ve uzun kazanç serileri ayrıca etkilidir. Mevcut oyun en fazla %5 edge konfigürasyonuna izin verir; örnek %2'dir.

Bahis anında stake kendi receipt'inde tutulur ve başka bahsin kazanmasına fon sayılamaz. İlk shared SOL tasarımında da mevcut güvenli rezerv korunmalı:

```text
gross_i = floor(stake_i × 19600 / 10000)
reserve_i = max(gross_i − stake_i, 0)
free_house = actual_shard_balance − rent − buffer − Σ reserve_i
```

Aynı sermayeyi kullanan bütün SOLO bahisler ve bütün açık LIVE turları bu toplamda yer alır. Her shard yalnız gerçekten kendisine ayrılmış bakiyeyi kullanır. İşlem rezervi atomik ayırmadan kabul edilemez; yönetici yalnız serbest kısmı çekebilir. Pausing, açık bahis ödemelerini kapatmamalıdır.

İleride **bütün tur stake'lerini hukuken ve teknik olarak aynı ödeme havuzunda tutan ayrı bir round-vault** için daha düşük bir sınır hesaplanabilir. `S` toplam stake, `P_K` KOR kazanırsa toplam brüt ödeme, `P_A` AYAZ kazanırsa toplam brüt ödeme olsun:

```text
pooled_extra_reserve = max(0, max(P_K, P_A) − S)
```

Bu formül mevcut ayrı receipt'lere uygulanamaz. Kaybedenlerin henüz settle edilmemiş stake'leri shard'da yoktur. Yeni pooled vault; kazanan alacakları, kısmi claim'ler, surplus iadesi ve tekrar ödeme engelini ayrıca korumalıdır. Farklı turların riskleri birbirinden düşülmez: hepsi aynı anda kasa aleyhine sonuçlanabilir.

Örnek: 100 kişinin 0.01 SOL yatırması, hepsi aynı taraftaysa 1.96 SOL azami ödeme ve 0.96 SOL ek rezerv gerektirir. 50/50 eşit dağılımda teorik pooled ek rezerv sıfırdır; **mevcut House yine 0.96 SOL ayırır**. 1 SOL bakiyenin tamamı serbest sermaye değildir: rent ve güvenlik tamponu düşülür. Ürün üst limitleri daha düşük seçilebilir.

## İncelenen açık kaynaklar ve uygulanacak yaklaşım

| Kaynak | Doğrulanan kapsam ve kullanılabilir ders | Sınır |
| --- | --- | --- |
| [Gamba SDK, commit `70f9ed9`](https://github.com/gamba-labs/gamba/tree/70f9ed98d8b1c24e16035591c237ff2c8e9e5b95) | `gamba-core-v2` ve multiplayer paketleri; multiplayer'da create/join/leave/select/distribute akışı, süre ve miktar parametreleri. [Paket metadatası MIT](https://github.com/gamba-labs/gamba/blob/70f9ed98d8b1c24e16035591c237ff2c8e9e5b95/packages/multiplayer/package.json). | Bu repo SDK/IDL ve uygulama kaynağıdır; bağımsız denetlenmiş Rust gambling çekirdeği doğrulanmadı. Root repo lisans dosyası yok; paket MIT beyanı bütün depoya genişletilmez. [Oyun dokümanı](https://gamba.so/docs/games) hash/client seed/nonce akışını anlatır; bu model bizim scoped VRF ile aynı değildir. |
| [Monaco'nun BetDEX fork'u, commit `a98aaf9`](https://github.com/BetDexLabs/protocol/tree/a98aaf9f545709b65f6060b949572d65edc2f761) | Apache-2.0; gerçek Anchor kaynakları. [Order kabulünde `lock_timestamp > now`](https://github.com/BetDexLabs/protocol/blob/a98aaf9f545709b65f6060b949572d65edc2f761/programs/monaco_protocol/src/instructions/order_request/create_order_request.rs); sonuç başına [maksimum exposure](https://github.com/BetDexLabs/protocol/blob/a98aaf9f545709b65f6060b949572d65edc2f761/programs/monaco_protocol/src/state/market_position_account.rs). | Spor/prediction piyasası; rastgele Coinflip/Crash motoru değildir. Repo kendini beta diye tanımlar. [Sec3 rapor dizini](https://github.com/BetDexLabs/protocol/tree/a98aaf9f545709b65f6060b949572d65edc2f761/audit/sec3) belirli tarih/sürümler içindir; bugün deploy edilen binary ile eşleşme bu araştırmada doğrulanmadı. Özgün Monaco URL'si bu incelemede 404 döndü; fork açıkça fork olarak gösterilir. |
| [MagicBlock Solana VRF, commit `52b103c`](https://github.com/magicblock-labs/solana-vrf/tree/52b103c5d55d72e07456a445044b3c006cb87c1a) | Resmî proof verifier ve request/callback arayüzü. Repo 6 Ağustos 2025 Zenith raporunu yayımlıyor. Sollish yeni kriptografi yerine sabitlenmiş SDK ve scoped callback yetkisini kullanır. | Provider kaynak lisansı [BSL 1.1](https://github.com/magicblock-labs/solana-vrf/blob/52b103c5d55d72e07456a445044b3c006cb87c1a/LICENSE.md), Additional Use Grant None; otomatik üretim fork izni değildir. Audit dosyasının varlığı son commit, SDK, bizim oyun veya canlı deployment için toplu güvenlik onayı değildir. |
| [ORAO Solana VRF SDK](https://github.com/orao-network/solana-vrf) | Apache-2.0; Anchor CPI ve fulfilled-state örneği, classic/callback program ayrımı. | SDK/örnek oyunu komple audited casino diye sunmak yanlış olur. Mevcut MagicBlock entegrasyonunu bu araştırma yüzünden değiştirmiyoruz. |

Hazır sistemi düşünmeden kopyalamak yerine, lisansı ve sürümü belirli sağlayıcı arayüzlerini kullanıyoruz. Yeni byte-level VRF verifier, özel şifreleme veya SlotHashes/timestamp tabanlı rastgelelik eklemiyoruz. Harici denetim ancak denetlenen commit/kapsam için kanıttır; Sollish finansal entegrasyonu ayrıca denetlenmelidir. Hiçbir üçüncü taraf oyun çekirdeği bu değişiklikte kopyalanmadı.

## İptal, oracle kesintisi ve Crash sınırı

Sonuç isteği gönderildikten sonra yeni RNG seçmek veya sonuca göre iptal etmek adilliği bozar. Boş tur request öncesinde kapatılabilir. Bahisli turda iptal gerekiyorsa kabulden önce yayımlanmış, programla uygulanan ve oracle sonucu seçerek elenemeyen kural gerekir. Genel bir “120 saniye sonra iade” eklemek güvenli çözüm değildir: sonucu bilen bir taraf kötü sonucu saklayıp iadeyi seçebilir.

Mevcut root Coinflip'te provider isteğinin purge edilmesi sonrası yerleşik recovery yoktur. [İzole deney](../../experiments/vrf-recovery/README.md), aynı özgün input/key ve proof ile kurtarmayı test eder; root programa entegre değildir ve oracle'ın hiç açıklamadığı proof'u yaratamaz. [Gerçek provider SBF deneyi](../../experiments/vrf-recovery/games-provider-evidence.json) de VM-only kapsamındadır. Bu liveness sorunu ve lisans/deployment sınırları çözülmeden gerçek SOL ortak turu açılmaz.

Crash ayrı tasarlanır. Coinflip/Ringside'da bahisler kapandıktan sonra ikili sonucu göstermek sorun değildir. Manuel cash-out Crash'te ise gelecekteki çöküş noktasını oyuncuya açmak oyunu bozar. Beş saniyelik giriş penceresi, gizli çöküş durumu, cash-out sıralaması veya TEE/oracle kesintisi problemlerini çözmez.

## Bu değişiklikte doğrulananlar

`pnpm --filter @sollish/protocol test`: **11/11 PASS**; `typecheck`: PASS. Sekiz yeni test grubu: 5000 ms sınır/eşitlik reddi, kalıcı CLOSED sonrası saat gerilemesi, strict client/server şeması, sonuçtan önce ifşa yasağı, brüt ödeme/yuvarlama/overflow, iki tarafın ortak exposure'ı ve bütün eşzamanlı rezervlerin toplamı. Bu testler piyasa otoritesi veya gerçek fon güvenliği kanıtı değildir; backend kalıcılık/eşzamanlılık ve tarayıcı çoklu oturum testleri ayrıca çalıştırılır. On-chain programlar bu çalışma kapsamında değiştirilmedi.
