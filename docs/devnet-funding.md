# Devnet finansman durumu — 1 Ekim 2026

**Fonlama ve deneysel devnet deployment başarılı:** 1 Ekim 2026, **14:06:09 UTC** kontrolünde alınan **2 devnet SOL**, sonraki probe dağıtımını karşıladı. Ücretsiz faucet [ödeme işlemi](https://explorer.solana.com/tx/RSqGcnCKFwpbaNamqQfvdRZtK6LmQWqn34dt3tueeDGx45weaKa2rbrgQNEcF5xNwZ4a6zrNAtbkFrk6RgBDMbk?cluster=devnet) ve **14:35:21 UTC finalized deployment** ayrı doğrulandı. Gerçek deploy rent/fee maliyeti **1,488567680 SOL**, o anda kalan payer bakiyesi **0,511432320 SOL** idi; oyuncu fonlaması ve hesap başlangıçları daha sonra yapıldı. **2 SOL güncel bakiye değildir.** Mainnet SOL veya ücretli claim kullanılmadı. Deployment, G0/TEE gizliliği veya canlı Crash kabulü değildir.

## Hedef ve kesinleşmiş fonlama

- Ayrı PER probe fee payer: `2By6MdhFoXhCxdhQMPt15PLPJo8Q3Ge3pw1QAJ2J4waA`.
- **Fonlama sonrası, harcamalar öncesi gözlem: 2026-10-01T14:06:09.549221+00:00**, finalized bakiye slot'u `506297417`: **2.000.000.000 lamport = 2 devnet SOL**.
- Ödeme işlemi slot'u `506297293`; kaynak `FAUCET2dv59GkFN2VNJMmENU528PwspJoDHAt7HdcZzg`, hedef yukarıdaki probe payer, tek transfer **2.000.000.000 lamport**, işlem hatası `null`.
- Kanıt: `.tooling/devnet-funding-success.json`; faucet başarı ekranı: `.tooling/devnet-faucet-success.png`.
- **Geçmiş gözlemler:** `2026-10-01T10:33:56.806Z`, finalized slot `506243048` ve `2026-10-01T13:29:42.734Z`, finalized slot `506288085` kontrollerinde bakiye **0 lamport** idi. İkinci kontrol sırasında yeni faucet isteği gönderilmemişti; bu değerler mevcut bakiye değildir.
- RPC genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` — Solana devnet.
- **Bütçe ölçümü: 2026-10-01T14:06:43.705Z**, slot `506297563`: 292.384 byte probe için **1,487022680 SOL kalıcı rent + 0,001545000 SOL işlem ücreti = 1,488567680 SOL** hesaplandı. **14:35:21 UTC** deployment kontrolünde payer'ın **0,511432320 SOL** bakiyesi gözlenerek toplam gerçek harcamayla eşleşti. Bu, oyuncu fonlaması öncesindeki bakiyedir. [Ayrıntılı analiz](../experiments/per/evidence/cli-deploy-fee-analysis.md) ve [ölçüm JSON'u](../experiments/per/evidence/cli-deploy-fee-analysis-2026-10-01.json) ilk hesap koşullarını korur. Bu test fonu house bankroll veya mainnet finansmanı değildir.
- Anahtar `.tooling/per/probe-payer-keypair.json` altında git dışında tutulur; özel anahtar veya OAuth token'ı bu belgeye/evidence dosyasına yazılmaz.

## Dağıtım ve sonraki test fonlaması

- **14:35:21 UTC:** [kendi probe deployment kaydı](../experiments/per/evidence/own-probe-deployment.json), program `AHyeBQPUTEStC4CVunyBc4f4CPGVH2c3XoKFXcB3F3va`, finalized slot `506304685`; [deploy işlemi](https://explorer.solana.com/tx/5LJDTW5QagHVCJyQvzVKEKU2g1hk1hR6rBNk54AiWedKbRxrpD3Bp83QDYsZ4YMWyqDDxvRdiQX1CYSogowdUnoN?cluster=devnet). **292.384 byte** ELF SHA256 `197a965662b28971bca434633abfaaf2d5d826bdc3ce2f54a1d746554cd99aae` yerel artifact'a eşleşti; allocation padding yok ve buffer kapandı.
- İlk CLI denemesi 305 write parçasının 11'ini tamamladı. Kalan 294 parça sınırlı, aralıklı yükleyiciyle finalized oldu; bir hazırlanmış imza süresi doldu ve ücret alınmadı. Tam buffer hash'i doğrulanınca final deploy gönderildi. Yerel izler `.tooling/per/deploy-after-first-attempt.json`, `upload-buffer-wal.jsonl`, `upload-buffer-complete.json` altında korunur.
- **14:35:55 UTC:** iki mevcut test oyuncusuna ayrı ayrı **25.000.000 lamport (0,025 SOL)**, toplam **5.000 lamport** işlem ücretiyle aktarıldı; finalized slot `506305033`, [fonlama işlemi](https://explorer.solana.com/tx/39XUnmyj2c4isxrg3xJipDP23Z1boVCWBhZ2LtWcmhsm74TR2CezMp43eVFbcGxXZnHJLopaiPF8oCAtWwGSYi7T?cluster=devnet). Kanıt `.tooling/per/player-funding-finalized.json`; buradaki `balanceBefore` deploy sonrası 0,511432320 SOL'dür.
- **14:38:04 UTC:** [kesilen L1 başlangıç akışının uzlaştırması](../experiments/per/evidence/interrupted-l1-initialization.json), round ve A/B receipt işlemlerinin üçünü de finalized/`err:null` doğruladı. İlk runner, B onay kontrolünde HTTP429 ile durmuştu; sözleşme hatası değildi. Bu ilk koşuda delegation/private permission/VRF başlamadı.
- **14:47:24–14:49:45 UTC:** [aynı round/journal ile açık devam](../experiments/per/evidence/probe-resume-initialized-latest.json), önceki başlangıçları yeniden göndermeden delegation, private-before-VRF, scoped callback, iki oyuncu komutu ve reveal adımlarını tamamladı. Bu deney bahis veya ödeme içermez; genel durum **BLOCKED**, sonuç `COMPLETED_LIMITED_EXPERIMENT` olarak ayrıdır.
- **14:51:26 UTC:** [son salt okunur kayıt](../experiments/per/evidence/own-probe-final-readback.json), altı L1 işlemini finalized/`err:null` doğruladı. Bu aşamadaki finalized L1 bakiyeleri inspector için **457.510.728 lamport (0,457510728 SOL)**, her oyuncu için **21.408.600 lamport (0,021408600 SOL)** idi. Beş TEE işleminin TEE RPC'de finalized görünmesi L1 commit veya oyun ödemesi değildir. Önceki aşama bakiyeleri güncel bakiye diye kullanılmaz.

[TEE RPC'deki aynı ELF kopyası](../experiments/per/evidence/own-probe-tee-copy.json) ayrıca gözlendi. Bu, donanım/uygulama attestation'ı değildir; [kimlik/ölçüm incelemesindeki](../experiments/per/evidence/tee-identity-review.md) açık koşullar değişmedi.

## Faucet gözlemleri — 1 Ekim 2026

Başarılı son kaynak aşağıdaki `solanadevnetfaucet.com` satırıdır; diğer satırlar aynı gün yapılan önceki denemeleri/gözlemleri anlatır.

| Kaynak | Canlı gözlem / gereksinim | Sonuç |
| --- | --- | --- |
| [Solana Foundation](https://faucet.solana.com/) | Arayüz en fazla 8 saatte 2 istek bildiriyor. Root'un resmi devnet RPC isteği **10:11 UTC**'de HTTP429 aldı. AI Agent paneli web talebi yerine CLI/PoW/local validator yönlendirmesi gösteriyor. | Seri tekrar, IP değişimi veya kota aşma denenmedi. |
| [QuickNode](https://faucet.quicknode.com/solana/devnet/drip) | FAQ ilk mainnet bakiyesinin gerekmediğini söylese de root'un aynı hedef cüzdanla tek canlı denemesi küçük mainnet SOL bakiyesi gerektiği hatasıyla reddedildi. | Fiilen kullanılamadı; mainnet para yatırılmadı, başka cüzdana geçilmedi. |
| [DevnetFaucet](https://www.devnetfaucet.org/) | Arayüz 20 devnet SOL ve GitHub ile giriş gösteriyor. Kullanıcı OAuth adımını açıkça onayladı; root `read:user` ve `user:email` kapsamlarını görerek ilerledi. Sonuç: uygun repository bulunmadığı için eligibility reddi. Vouch metin formu açıldı, henüz gönderilmedi. | OAuth onayı funding başarısı değildir; alınan SOL **0**, başarı imzası yok. |
| [PineStake](https://www.pinestake.com/en/faucet) | Root'un canlı arayüzünde faucet bakiyesi **0,48 SOL**, minimum talep **1 SOL**; GitHub girişi ve 8 saatte 1 istek bildiriliyor. | Görülen havuz minimum isteği karşılamıyor. |
| [Chainstack](https://faucet.chainstack.com/solana-devnet-faucet) | Hesap/API key yanında en az 0,8 mainnet SOL ve bakiye geçmişi şartı; sayfada 24 saatte 1 devnet SOL. | Boş, ayrı test cüzdanına uygun değil. |
| [Helius](https://www.helius.dev/blog/solana-faucet) | Resmi 7 Temmuz 2025 yazısı ücretli plan ve 24 saatte 1 SOL bildiriyor. | Ücretli abonelik alınmadı; ücretsiz seçenek olarak sunulmadı. |
| [Alchemy](https://www.alchemy.com/faucets) | Güncel faucet listesinde Solana seçeneği görülmedi. Eski Solana yazısı başka faucet'e yönlendiriyor. | Eski miktarlar/gereksinimler güncel hizmetmiş gibi kullanılmadı. |
| [J Tools](https://j.tools/en/tools/devnet-faucet) | Sayfa 25 SOL/gün tanıtsa da canlı tarayıcı “TEMPORARILY PAUSED / We can't hand out devnet SOL right now” modalını gösterdi. | Adres/claim gönderilmedi; reklam metni çalışan faucet kanıtı sayılmadı. |
| [solanadevnetfaucet.com](https://solanadevnetfaucet.com/) | Ayrı işletmeci; sayfa 30 günden eski GitHub hesabına 24 saatte 2 devnet SOL ücretsiz claim bildiriyor. Kullanıcı, MightyVlad OAuth uygulamasının yalnız `read:user` erişimini açıkça onayladı. | **Başarılı:** tek ücretsiz claim ile **2 devnet SOL** alındı; **14:06:09 UTC**'de finalized bakiye/işlem doğrulandı. Ücretli veya mainnet seçeneği kullanılmadı. |

QuickNode/PineStake/GitHub arayüz gözlemleri root tarafından 1 Ekim 2026 oturumunda aktarıldı; ayrı saniyelik UTC kaydı sağlanmadığı için yukarıda zaman uydurulmadı. [Solana'nın resmi faucet rehberi](https://solana.com/developers/cookbook/development/airdrops-and-faucets) bu alternatifleri listeler; üçüncü taraf işletmeciler ve eligibility kuralları Foundation RPC'den ayrıdır. Aynı public RPC'yi kullanan bir wrapper, mevcut RPC kotasının çözümü değildir.

Başarılı kaynaktaki ilk eski OAuth callback'i kimlik doğrulama hatası verdi; normal giriş yeniden başlatılınca oturum açıldı. Ardından tek ücretsiz 2 SOL claim gönderildi. Turnstile otomatik başarı durumundaydı; etkileşimli CAPTCHA çözme eylemi yapılmadı. OAuth token'ı veya özel anahtar kanıt dosyalarına kaydedilmedi.

## DevnetFaucet: para var, eligibility ayrı

**2026-10-01T10:34:38.224Z**, finalized slot `506243224`: sayfada yayınlanan `FAUcEtpoKDsk27ta6ktJ4dX7RLFfmpv5MstejWF3AtU3` adresi **46.612,081076605 devnet SOL** içeriyordu. Bu salt okunur `getBalance` gözlemidir; bu fonlara erişim veya uygunluk kanıtı değildir.

İncelenen [kaynak commit'i](https://github.com/ferric-sol/devnetfaucet/tree/8a624921b06e1213d252ba97e3443c4c4aeb0356), GitHub kullanıcı/repository sahipliğini Solana ekosistem listesi veya ayrı uygunluk yollarıyla denetliyor. [Eligibility route](https://github.com/ferric-sol/devnetfaucet/blob/8a624921b06e1213d252ba97e3443c4c4aeb0356/app/api/check-eligibility/route.ts), [airdrop işlemi](https://github.com/ferric-sol/devnetfaucet/blob/8a624921b06e1213d252ba97e3443c4c4aeb0356/app/airdrop.ts) ve [cooldown kodu](https://github.com/ferric-sol/devnetfaucet/blob/8a624921b06e1213d252ba97e3443c4c4aeb0356/app/services/airdrop/cooldown-service.ts) incelendi. Normal/upgraded cooldown 24/12 saat; >20 SOL cüzdan bakiyesi reddi de mevcut. Açık kaynak sürümü canlı deployment ile hash eşitliği doğrulanmış değildir; canlı eligibility reddi fiili sonuçtur.

## Resmi önerilen PoW alternatifinin değerlendirmesi

Foundation AI Agent panelindeki `devnet-pow` başka bir devnet programını kullanır; mevcut faucet kotasını aşmak için ağ kimliği değiştiren yöntem değildir. Bununla birlikte eldeki havuz ve sıfır başlangıç bakiyesi nedeniyle çalıştırılmadı.

- [Crates.io kaydı](https://crates.io/crates/devnet-pow): sürüm **0.1.4**, yayımlanma **2023-05-30T02:12:19.003437Z**, sahibi `jarry-xiao`; yanked değildi.
- Registry arşivi SHA256: `1a0f40287a071514e8021738852a31bb6339419984c95d696c8b30a4aa70ce8a`. Arşiv yalnız bellekte incelendi; miner kurulmadı/çalıştırılmadı.
- Paket VCS commit'i: `5b76227764363294d5b86f19f306a7fe54e37cea`. [CLI](https://github.com/jarry-xiao/proof-of-work-faucet/blob/5b76227764363294d5b86f19f306a7fe54e37cea/cli/src/main.rs), [on-chain program](https://github.com/jarry-xiao/proof-of-work-faucet/blob/5b76227764363294d5b86f19f306a7fe54e37cea/programs/proof-of-work-faucet/src/lib.rs), [README](https://github.com/jarry-xiao/proof-of-work-faucet/blob/5b76227764363294d5b86f19f306a7fe54e37cea/README.md). Resmi rehber Ellipsis Labs'e atıf yapıyor; kaynak eski olduğu için güncel bağımsız audit varsayılmadı.
- CLI devnet genesis kontrolü yapıyor. Ancak keypair/RPC verilmezse global Solana CLI config'ini kullanabiliyor; ileride çalıştırılacaksa ayrı test cüzdanı ve devnet açıkça belirtilmeli.
- Bakiye 5.000 lamport'tan azsa CPU çalışmasından önce otomatik 1 SOL `requestAirdrop` çağırıyor. İnceleme anında sıfır bakiyeli olan payer bu yola girecekti. Bu eşik yeterli işlem bütçesi garantisi değil: claim iki imzalıdır; gerçek ücret RPC'den ölçülmelidir.
- CPU işi tek döngüde vanity public key üretimidir. CLI'da süre/deneme/işlem ücreti tavanı yok. `-t 5000000000`, süre değil **5 SOL brüt ödül hedefidir**; 0,02 SOL ödülle 250 başarılı claim gerektirir. Dışarıdan süre sınırı koymak tek başına başarısız işlem ücretlerini sınırlamaz.
- `--no-infer`, tek exact pool'u kullanır. Pool bakiyesi ilk uygun anahtar bulunduktan sonra kontrol edildiği için boş pool gereksiz CPU harcatabilir.

**2026-10-01T10:33:56.806Z** salt okunur devnet taraması (`PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL`, 23 spec):

| Pool | Kaynak adresi | Gözlem |
| --- | --- | --- |
| Difficulty3 / 20.000.000 lamport | `6yvwhesLJeE8fNWviosRoUtBP3VFUXE7SEhSP9fFRJ3Z` | Account yok, bakiye 0. Resmi panel örneği bu pool'u seçiyor. |
| Difficulty2 / 100 lamport | `5NHijp3cQCTYpRJh9WayDHXzouvX7FQLqP8iNpJ946u7` | Bakiye 999.969.700 lamport; ödül receipt rent ve işlem ücretinden düşük. |
| Difficulty5 / 19.000.000 lamport | `CbWeC89FKgzZbo1wH8ydtfk4YmdhiudmNBWdaRngcY6Q` | Bakiye 900.000 lamport, ödülü karşılamıyor. |

Aynı gözlemde sıfır byte receipt rent'i 650.240 lamport'tu. Program receipt rent'ini ödül transferinden sonra payer'dan alır; başlangıçta rent'in tamamı gerekmese de işlem ücretinin ödenmesi gerekir. O gözlemdeki pool'larda faydalı, fonlanmış ödül bulunmadığından miner kurulmadı.

## Sonraki adımın sınırı

Faucet fonlaması, finalized kendi probe deployment'ı, test oyuncusu transferi ve sınırlı canlı probe akışı doğrulandı. **Bunlar tam PER/TEE ve VRF gizliliği, manuel Crash veya oyun ödemesi kabulü değildir.** `expectedTeeMeasurements` ve `approvedOwnCounterDeployment` null kalır; gözlenen deployment ve sınırlı deney manifest'te ayrı raporlarla tutulur. Sonraki deney çağrıları, provider ücretleri ve başarısız işlemleri elle sürdürmek ayrıca masraf oluşturabilir. Vouch formu gönderimi ayrı dış iletişimdir; bu belge gönderildiğini söylemez.

**Fonlama öncesi tarihli gözlem — 2026-10-01, 13:46:07 UTC:** bağımsız `solanadevnetfaucet.com` hazinesi, slot `506292289`, `FAUCET2dv59GkFN2VNJMmENU528PwspJoDHAt7HdcZzg` adresinde **14.858,327675 devnet SOL** içeriyordu. Sayfadaki son ücretsiz ödeme [bu finalized işlemde](https://explorer.solana.com/tx/v1Cq8FyxLYTbFhuRQnP1ScwyauURiY95TnDzrHwDCsBFu81k3NiFoNs27FPDgXbbgUGNpmw2aP4WXtiEo2hDRjb?cluster=devnet) aynı kaynaktan 2 SOL transferi ve `err: null` olarak görüldü. Bu başka bir alıcıya ait geçmiş ödemedir; bizim fonlama kanıtımız yukarıdaki `RSq…Mbk` işlemidir. Ön inceleme kanıtı `.tooling/independent-faucet-readonly.json` altında korunur.

Önceki **2,973171600 SOL artı ücretler** hesabı, geçici buffer ve kalıcı hesap rent'lerini birlikte tutan muhafazakâr bir zarftı. Agave 4.1.2'nin incelenen `182084b82aae88b1b0731540f63bf7416f27773a` commit'inde [loader buffer lamportlarını önce payer'a aktarıp ardından ProgramData'yı fonlar](https://github.com/anza-xyz/agave/blob/182084b82aae88b1b0731540f63bf7416f27773a/programs/bpf_loader/src/lib.rs#L279-L302); buffer ve kalıcı rent'i aynı anda ayrı fonlamak gerekmez. Yeni hesap, CLI ön kontrolünün atladığı ayrı Program hesabının rent'ini de içerir.

**1,488567680 SOL** ilk olarak `--max-len 292384 --with-compute-unit-price 0 --max-sign-attempts 1 --use-rpc`, açık preflight ve payer ile upgrade authority'nin aynı olması koşullarında tek başarılı geçiş için hesaplandı. Gerçek binary 305 write parçasıdır; `getFeeForMessage` başlangıç/write/final mesajlarında sırasıyla 10.000 / 5.000 / 10.000 lamport vermiştir. İlk buffer başlangıcı simülasyonu yalnız o talimatı kapsıyordu; sonradan tamamlanan upload ve final deploy için yukarıdaki ayrı finalized kanıt esas alınır. Kesilen upload kaldığı yerden tamamlandığında gerçek toplam harcama bu bütçeyle eşleşti.
