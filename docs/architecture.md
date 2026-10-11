# Mimari kararları — 1 Ekim 2026

## Onaylanan kapsam

Kullanıcı canlı manuel Crash, Coinflip, platform token'ıyla saatlik airdrop ve TEE temelli devnet prototipini onayladı. House sermayesi 1 SOL. Uluslararası erişim hedefi, her ülkede izinsiz gerçek para işletme kararı değildir.

Özgün oyunlar için Three.js sunum katmanı eklendi. İlk örnek, KOR/AYAZ karakterlerinin **RINGSIDE** demosudur. Tarayıcı çizimi ayrı modüldedir; finansal sonuç ve ödeme doğrulaması animasyondan türetilmez. Bağımsız ikili maç, paylaşılan global round ve yeni ekonomik kuralların sınırları [özgün oyun planında](original-games.md) ayrılmıştır. RINGSIDE'ın canlı bahis sözleşmesi henüz yoktur.

1 Ekim revizyonu: Kullanıcının binlerce kullanıcı hedefiyle Cloudflare + Supabase merkezli yerleşim seçildi. Web/API Next.js + OpenNext ile Cloudflare Workers'ta; chat ve oyun gözlemleri native WebSocket + Durable Objects'te; kalıcı uygulama verisi ve kimlik Supabase PostgreSQL/Auth'ta tutulur. ARM VPS yalnız modüler indexer/keeper/outbox/epoch işçisini çalıştıracak. Kaynak, kota ve worker sayısı artırılarak büyüme hedeflenir; ölçülmemiş kapasite garanti edilmez. Ayrıntılar [hosting](hosting.md) ve [ölçek planında](scaling.md).

SSH üzerinden Debian 13 / ARM64 / 6 CPU / yaklaşık 8 GB RAM doğrulandı. Kullanıcı mevcut uygulama ve verileri yedeksiz silip Debian/SSH'yi korumayı açıkça istedi. Sunucu işlemleri [ayrı kayıtta](server-cleanup.md); Node uygulama işçisinin kapalı yapılandırmalı ilk dağıtımı yapıldı; bulut ve zincir etkinleştirme adımları ayrıdır.

## Güven sınırları

| Katman | Rolü | Yetkisi olmayan işler |
| --- | --- | --- |
| Solana / Anchor | Bahis escrow'u, ödeme rezervi, sonuçlandırma, reward ve staking hakları | Backend'in keyfi ödeme veya sonuç seçimini kabul etmek |
| Attestation sağlayan TEE / PER adayı | Gizli Crash durumu ve manuel çıkış sıralaması | Oyuncunun istediği adrese fon taşımak, rezervsiz bahis kabul etmek |
| Cloudflare Workers ve Durable Objects | Web/API, kimliği doğrulanmış chat ve halka açık oyun olaylarının dağıtımı | Gizli Crash noktasını saklamak veya cash-out kabul kararı vermek |
| ARM uygulama işçisi | Indexer, keeper, outbox ve zamanlanmış epoch işleri | TEE desteği olmadan gizli Crash otoritesi sayılmak |
| Supabase PostgreSQL/Auth | Cüzdan oturumu, chat, moderasyon, kalıcı iş kuyruğu ve zincir indeksi | House bakiyesinin veya ödül hakkının otoritesi olmak |
| Keeper | İzin gerektirmeyen settlement/epoch işlemlerini tetiklemek | Sonuç, alıcı veya ödeme tutarı belirlemek |
| Three.js oyun sahnesi | Kilitlenmiş/doğrulanmış sonucu karakter ve kamera animasyonuyla göstermek | Kazananı veya finansal ödeme hakkını belirlemek; frame hızından sonuç üretmek |

TEE adayı MagicBlock Private Ephemeral Rollup'tır. Genel bir Worker veya Supabase Edge Function bu güven modelinin yerine geçmez. TEE, validator sıralaması, sansür ve erişilebilirlik risklerini kendi başına çözmez.

MagicBlock PER'in kullandığı Intel TDX, mevcut Ampere ARM64 VPS üzerinde barındırılamaz. Uygulama VPS'te, gizli Crash yürütmesi ayrı PER devnet ortamında kalır; gizlilik ve settlement bağı aşağıdaki deneylerle doğrulanır. Self-host uygulama sunucusu ile Solana validator/RPC node işletmek ayrı kapsamdır; ilk aşama bir validator kurulumunu içermiyor.

## İlk protokol deneylerinin kabul ölçütleri

1. Randomness talebi, callback, log, RPC, işlem geçmişi ve ara hesaplardan Crash noktası tur bitmeden çıkarılamamalı. Public VRF çıktısını daha sonra gizli hesaba yazmak yeterli değildir.
2. Tur başında bahisler kapanmalı; randomness ile tur arasında tekil ve değiştirilemez bağ bulunmalı. Operatör aynı tur için yeniden sonuç seçememeli.
3. Cash-out için tarayıcı tıklama saati değil, protokolün kabul kaydı esas olmalı. Sıralama, son geçerli çıkış ve çakışan işlemler deterministik olmalı.
4. Başarılı cash-out tekrarlanamamalı ve önceden kayıtlı oyuncu adresine bağlı ödeme hakkı oluşturmalı.
5. TEE/keeper/RPC kesintilerinde önceden kabul edilmiş haklar korunmalı. Timeout veya iade, kaybedilen sonucu seçerek iptal etme yoluna dönüşmemeli.
6. Gizlilik ve işlem kabulü ile Solana'daki final ödeme arasında doğrulanabilir bağ bulunmalı. Yalnız operatörün gönderdiği sayıyı doğru kabul eden settlement yeterli değildir.
7. Kullanılan permission/VRF/delegation program sürümleri ile audit kapsamı karşılaştırılmalı. Sağlayıcıya ait bir audit bizim oyun programımızın audit'i değildir.
8. Ölçülen gecikme ve toplam ücret olmadan "anında" veya "ücretsiz" üretim taahhüdü verilmemeli.

Bu deneyler tamamlanmadan TEE + VRF birleşiminin üretime hazır olduğu varsayılmaz. Devnet'teki bir mock oracle gerçek VRF olarak sunulamaz.

## House muhasebesi

Bahis anaparası ayrı escrow'da tutulur. Bir bahis için ek house yükümlülüğü:

`max(azami_brut_odeme - net_escrow_anaparasi, 0)`

Manuel Crash rezervi mevcut çarpandan değil, bahis kabul edilirken izin verilen azami ödemeden hesaplanır. Aynı turdaki oyuncular birlikte kazanabileceğinden bütün açık bahislerin rezervleri toplanır.

- 0,01 SOL ve 10x: ek house rezervi 0,09 SOL.
- 0,01 SOL ve 100x: ek house rezervi 0,99 SOL.

Bunlar kapasite örnekleridir; üretim bahis limiti veya risk önerisi değildir. Güvenlik tamponu ve operasyon parası ayrıca tutulur. Ücret bahis anaparasından kesilirse rezerv hesabında escrow'ya gerçekten ulaşan net tutar kullanılır.

Staking anaparası, açık oyuncu alacakları, ödül/airdrop rezervleri buyback veya house çekimi için kullanılamaz. Program yükseltme yetkisi ve onun güven sınırı ayrıca açıklanır.

Binlerce izleyici ile binlerce eşzamanlı bahis farklı kapasite hedefleridir. İlk Anchor hesap tasarımı her bahiste aynı global vault/round/epoch hesabına yazmayı zorunlu kılmamalı. Bahis başına durum, önceden fonlanmış house bölümleri ve kullanıcı/epoch istatistikleri değerlendirilir. Bölümlerin teminat toplamı ortak sermayeyi aşamaz; bölme işlemi 1 SOL'ü çoğaltmaz. Kilit çakışması ve eşzamanlı rezerv testleri tasarımın kabul koşuludur.

## Token ve saatlik airdrop

- Pump.fun regular launch; Mayhem kapalı. Başlangıç arzı hedefi 1 milyar; burn sonrası mevcut arz azalır.
- Pump launch bize toplam arzdan ücretsiz bir ödül tahsisi sağlamaz. Reward vault ayrı satın alım bütçesiyle fonlanır.
- Edinilen ödül rezervi için önerilen dağılım: %70 oyun, %15 staking, %10 saatlik airdrop, %5 topluluk. Bu toplam token arzının dağılımı değildir.
- Her UTC saatin bitiminden sonra o epoch içinde atomik olarak kabul edilmiş ödüllü bahisler değerlendirilir. Minimum hacmi geçen cüzdanlar fonlanmış saatlik bütçeden bahis hacimleriyle orantılı pay alır. Settlement gecikmesi kabul anını değiştirmez; mevcut Coinflip protokolünde seçici iade/iptal yolu yoktur. İade eklenecekse reward muhasebesi birlikte yeniden incelenmelidir.
- Uygunluk, payda ve tek-claim kuralı on-chain tutulur. Cron gecikmesi hakları değiştirmez; kaçırılan epoch'lar tekrar işlenebilir.
- Token miktarı, faz takvimi ve APY, fonlanmış rezerv bulunmadan vaat edilmez.

`programs/incentives` artık önceden fonlanan faz, saatlik claim ve staking sözleşmelerini içerir. Ödüllü Coinflip talimatı bahis kabulüyle token kredisini aynı transaction içinde yazar; bütçe yetersizliği bütün talimatı geri alır. Stake anaparası ve ödüller ayrı vault'lardadır. Mint/freeze authority ve Token2022 extension allowlist'i kontrol edilir. Ayrıntılar ve hesap yaşam döngüsü [token sözleşmeleri belgesindedir](incentives-contracts.md). Bu yerel uygulama canlı deployment veya bağımsız audit değildir.

Coinflip'in kalıcı oyuncu aktivitesi lifetime sayaçları ile iki hizalı UTC saat alanını saklar. Bu alanlar önceki saatlerin token haklarının yerine geçmez ve chat için tam kayan 60 dakikalık hacmi vermez. Fonlanmış ödül modülünde her hak, bahis makbuzu kapanmadan kalıcı alacağa veya tüketilmemiş epoch kaydına bağlanmalı; çevrimdışı kullanıcı hakkı bir saatlik alanın üzerine yazılarak kaybolmamalı.

## Sıralı teslimler

Yerel uygulama durumu: kasa, [Coinflip](coinflip.md) ve incentives SBF olarak derlendi. Matematik, kasa, oyun, faz/saatlik ödül ve staking testleri [doğrulama raporunda](validation.md) izlenir. Makbuz kapatma, kalıcı nonce ve atomik reward kredisi uygulandı. Coinflip scoped VRF ABI'si yerel oracle fixture'ıyla sınandı; canlı VRF doğrulaması ve oracle kesintisinde güvenli recovery açık kabul koşullarıdır.

[PER ön deneyi](../experiments/per/README.md) gerçek devnet RPC, QFS auth ve TDX quote doğrulamasını çalıştırdı. **1 Ekim 2026, 00:30 UTC tarihsel G0 raporu** 23 sınırlı PASS ve 14 BLOCKED içerir; genel G0 BLOCKED kalır. Sonraki kendi deployment/ELF eşleşmesi ayrı gözlem olarak doğrulandı; beklenen uygulama ölçümü ve quote→validator→çalıştırılan program bağı hâlâ eksiktir ([kimlik incelemesi](../experiments/per/evidence/tee-identity-review.md)). Önceki faucet engeli 14:06 UTC ücretsiz 2 devnet SOL ödemesiyle çözüldü; bu miktar sonraki harcamalar öncesine aittir. Canlı gizli VRF, okuma vermeden manuel cash-out ve L1 oyun ödemesi henüz doğrulanmadı.

[Kendi PER probe programı](../experiments/per/program/README.md) devnet'te finalized olarak dağıtıldı: **14:35:21 UTC** gözlemi, deployment slot'u `506304685`, **292.384 byte** ELF, yerel SHA256 eşitliği ve sıfır allocation padding; buffer kapandı ([kanıt](../experiments/per/evidence/own-probe-deployment.json)). **14:35:40 UTC TEE kopyası** aynı ELF'i gösterdi; RPC byte eşitliği attestation değildir. Probe yalnız private round, scoped VRF ve public oyuncu receipt'iyle erişim/komut yetkisini araştırır; inspector'ın okuma yetkisi vardır, gizli Crash veya para ödeme uygulaması değildir. Manifest'te `observedOwnProbeDeployment` vardır; `expectedTeeMeasurements` ve `approvedOwnCounterDeployment` null kalır.

Mevcut iki test oyuncusu ayrı ayrı 0,025 devnet SOL ile fonlandı. İlk runner B onay kontrolündeki HTTP429 nedeniyle kesildi; [14:38 UTC uzlaştırması](../experiments/per/evidence/interrupted-l1-initialization.json) üç başlangıcın finalized/`err:null` olduğunu doğruladı. **14:47:24–14:49:45 UTC [aynı round ile devam](../experiments/per/evidence/probe-resume-initialized-latest.json)** önceki başlangıçları yeniden göndermeden tamamlandı: private-before-VRF, scoped callback ile `READY`, iki readonly oyuncu komutunda nonce/count 1/1 ve reveal gözlendi. `COMPLETED_LIMITED_EXPERIMENT` sonucu genel **BLOCKED** durumunu kaldırmaz. [14:51:26 UTC son kontrol](../experiments/per/evidence/own-probe-final-readback.json) altı L1 işlemini finalized doğruladı; beş TEE işleminin TEE RPC'deki finalized sonucu L1 commit/ödeme değildir.

Gizlilik kapsamı sınırlıdır: 95 HTTP satırında 71 doğrudan secret-byte taramasında eşleşme yoktur; ayrı 36 VRF türetim denemesi ayrıştırılamamış/eksik olup 0 aday üretmiştir. Altı private round `null` okuması erişim reddi kanıtı değildir. Readonly ve writable-promoted simülasyonlar başarılıdır; writable yükseltmenin engellendiği iddia edilmez. WS, uçuş halindeki queue görünürlüğü, input/proof bağı, attestation, manuel cash-out sıralaması ve L1 ödeme koşulları açık kalır.

1. Ortak matematik, Anchor house/Coinflip/incentives ve yerel güvenlik testleri uygulandı.
2. Ortak IDL istemcisi, Supabase şeması, native WebSocket/DO, indexer/keeper ve web arayüzü uygulandı. Dış bağımlılıkların eksikliğinde gerçek işlemler kapalı kalır.
3. Cloudflare web demo/realtime, gerçek Supabase Solana oturumu ve ayrı PER probe'un sınırlı canlı akışı doğrulandı. Sıradaki canlı kapılar: probe gizlilik/streaming/attestation kabulü, house/Coinflip/incentives devnet entegrasyonu ve gerçek bahisle hosted chat/keeper akışı.
4. Zorunlu manuel Crash için TEE gizlilik, kabul sıralaması ve L1 settlement bağı kanıtlanmalı; browser demosu bu kapıyı geçmez.
5. Fonlanmış token fazı, gecikme/ücret ölçümleri ve dış servislerle uçtan uca test.
6. Bağımsız denetim, işletme/sağlayıcı uygunluğu, bütçe ve ayrı mainnet kararı.

## Birincil kaynaklar

- [MagicBlock PER](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/onchain-privacy)
- [VRF akışı](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/technical-details)
- [Audit kapsamı](https://docs.magicblock.gg/pages/overview/additional-information/security-and-audits)
- [Pump token oluşturma](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md)
