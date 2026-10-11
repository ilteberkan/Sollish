# Ringside NeuroArena — ürün ve mühendislik şartnamesi

Tarih: 2 Ekim 2026; Contact v3 eki 3 Ekim 2026. Kullanıcı talimatını uygulanabilir iş emirlerine dönüştürür. Araştırma prototipi, çalışan demo ve henüz kanıtlanmamış ürün hedefleri açıkça ayrılır. Bu belge mainnet açılış izni veya denetim raporu değildir.

## Amaç ve değişmez ilkeler

Ringside, iki dövüşçünün birbirine sırayla aynı animasyonu oynattığı bir sonuç göstericisi olmaktan çıkacak. Karakterler mesafeyi, ring sınırını, rakibin görülebilir hazırlığını, dayanıklılığı ve kendi riskini değerlendirecek. Dövüş; hareket, kaçınma, blok, temiz isabet, yere düşme, toparlanma ve durdurma gibi ölçülebilir olaylardan oluşacak. Sonuç bu olaylardan türeyecek; izleyicinin bahis miktarı, kasa açığı veya platform geliri karakter kararlarının girdisi olamaz.

Nihai hedef biyolojik bağlantı yapısıyla kısıtlanmış, eğitimden geçmiş bir kontrolcüyle karşılaştırmalı deney yapmaktır. “Meyve sineğinin zihni birebir aktarıldı”, “bilinç kazandı”, “insan gibi düşünüyor”, “dünyada ilk”, “AAA kalitesinde”, “kusursuz” veya “kasa hiçbir koşulda kaybetmez” ifadeleri ölçülebilir kanıt olmadan kullanılmayacak. Bağlantı haritası nöronların dinamik parametrelerini, anılarını veya insan dövüş tekniklerini içermez.

Her teslimde çalışan işlev, test edilen sınır, henüz yapılmayan iş ve kaynak/lisans kayıtları birlikte sunulacak. Önceki gerçek bahis güvenlik kapıları korunacak; yeni demo, doğrulanmamış SOL ödeme yolunu açmayacak.

## Güncel kararlar ve sürüm haritası

Aşağıdaki §1–8 2 Ekim ilkeleridir; sonraki kararlar bunları daraltır. Sürüme özgü kurallar, kanıt ve açık kalanlar [sürüm günlüğündedir](ringside-version-log.md); yalnız değiştirdiğin sürümün bölümünü oku.

- Ürünler yalnız **izleme + bahis**tir; "Kendin oyna" hiçbir oyunda olmayacak (4 Ekim kullanıcı kararı).
- 9 Ekim (akşam) kullanıcı kararı: sitede tek boks oyunu vardır, canlı `/live/ringside`; görüntü 2.5D ve kodla çizilir, 3D ve Combat Club kaldırıldı (dosyalar `.tooling/archive/removed-20261009/`). Eski sürümlerin sunucuları yalnız kabul edilmiş biletler için durur; biletler göç ettirilmez.
- Dondurulmuş, bayt bayt korunan: LIVE v1, v2, v3 (`ringside-contact-3-f8cd1d1f`), `sparring-4`, `neuro-1`. Yeni davranış yeni sürüm alır (`sparring-6`, `neuro-3` …).
- Connectome üstünlüğü hiçbir koşuda gösterilmedi; iddia edilmez.
- 9 Ekim kullanıcı kararı: maç içi öğrenme serbest; öğrenme kuralı, başlangıç ağırlıkları ve hiperparametreler donar ve motor kimliğine girer, ağırlıklar yalnız gözlenebilir olaylardan deterministik güncellenir. Jev yalnız köşe antrenörüdür (9 sn'de bir plan, raunt başına 5); her plan hash zincirine girer, deterministik yedek vardır, motor yalnız DEMO'dur.

| Sürüm | Yüzey | Günlük bölümü |
|---|---|---|
| Contact v3 | `/live/ringside` (shared LIVE, 3 raunt) | 3 Ekim — Contact v3 |
| Self-play, Energy6, fizik motoru | (kaldırıldı; eski `/lab/ringside`) | 3 Ekim — self-play / referans kalite |
| `sparring-1`…`sparring-4` | (kaldırıldı; eski Combat Club) | 3–4 Ekim — Combat Club bölümleri |
| `neuro-1` | Combat Club "Sinek beyni" köşesi | 4 Ekim — NeuroBoxer |
| `sparring-5`, `neuro-2`, Jev stil katmanı | Combat Club (yayımlanmadı) | 5 Ekim |
| Contact 4 | `/live/ringside-v4` (yayımlanmadı) | 8 Ekim — Contact 4 |
| Contact 5 (maç içi öğrenen dövüşçü + canlı Jev planı) | `/live/ringside` (yayımlanmadı) | 9 Ekim — Contact 5 |
| Contact 5 kural v4b (`dfd179bd`): tempo, menzil, 2.5D kod animasyonu, tek oyun | `/live/ringside` (yayımlanmadı) | 9 Ekim (akşam) |

## 1. Bilimsel kaynak ve veri seçimi

Kullanıcının gönderdiği [Google Research yazısı](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/) 3 Eylül 2026 tarihli MaleCNS çalışmasını anlatır. Erkek sineğin beyni ve ventral sinir kordonunu içerir; Google'ın açıklamasında 166 binin üzerinde nöron ve yaklaşık 125 milyon sinaptik bağlantı belirtilir. [Cell makalesinin DOI kaydı](https://doi.org/10.1016/j.cell.2026.08.015) aynı çalışmadır. Kullanıcının [Elsevier bağlantısının](https://linkinghub.elsevier.com/retrieve/pii/S0092867426009426) tam metnine bu çalışmada erişim engeliyle karşılaşıldı; tam metin okunmuş sayılmaz.

[FAFB](https://codex.flywire.ai/?dataset=fafb) ile [MCNS](https://codex.flywire.ai/?dataset=mcns) aynı veri kümesi değildir. Codex sayfasındaki nöron-bağlantı sayısı, ham segment grafındaki satır sayısı ve tekil biyolojik sinaps sayısı birbirine eşit kabul edilmez. Sürüm, filtreler, segment durumu ve ağırlık eşiği her deneyde kaydedilir.

Ürün araştırmasında tercih edilen kaynak, [HHMI Janelia MaleCNS v1.0 indirmeleri](https://male-cns.janelia.org/download/) ve buradaki **CC BY 4.0** lisansıdır. [FlyWire kamu veri kullanım yönergelerinin](https://flywire.ai/guidelines) CC BY-NC koşulları bütün Janelia kaynaklarına genellenmez; aynı şekilde Janelia lisansı FlyWire ek açıklamalarına otomatik izin vermez. Atıf metni, kaynak URL, alınma zamanı ve SHA-256 saklanır.

Bu teslimde gerçek ham MaleCNS ağı, annotation ve nörotransmitter dosyaları yerel araştırma önbelleğine alındı. Ham ağ 151.856.684 segment bağlantısı satırı içerir. İki ucu `Traced` olan görünüm 165.122 uygun anotasyon kimliği, 25.563.197 satır ve toplam 124.025.046 ağırlık içerir; ağırlık eşiği uygulanmadı. Bu görünümün Codex ile birebir aynı olduğu iddia edilmez. [Tam dosya taraması](../../experiments/connectome/evidence/malecns-inspection.json) özgün int64 kimlik/ağırlıkları ve `e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1` dosya SHA256'sını kaydeder. Tam sparse tablo parça parça okundu; dense matris, CSR veya öğrenilmiş sinir sistemi oluşturulmadı. Ayrıntılı yöntem ve lisans sınırları [deney kaydındadır](../../experiments/connectome/README.md).

## 2. Kontrolcü ve öğrenme mimarisi

Üç ayrı katman kullanılacak:

1. **Beden ve dövüş ortamı:** sabit zaman adımı, çarpışma/temas, pozisyon, yönelim, denge, stamina, hasar, geçerli teknikler ve hakem kuralları. Otorite sunucudadır; Three.js bu durumu gösterir. Tarayıcı FPS'i, kamera ve sekmenin arka planda kalması sonucu değiştiremez.
2. **Politika:** gözlem → eylem. Gözlem yalnız dövüşçünün erişebileceği bilgiyi içerir; gelecek seed akışı, rakibin gizli durumu, kullanıcı bahisleri ve kasa bilgisi yoktur. İlk denetlenebilir referans reaktif kontrolcüdür. Daha sonra aynı ortamda MLP/RNN, rastgele graf ve connectome yapılı politika karşılaştırılır.
3. **Eğitim ve yayın kaydı:** çevrim dışı eğitim, sabit test seed'leri, görülmemiş rakipler, kalibrasyon ve sömürü testleri. Model yalnız maçlar arasında değişebilir. Bir maçta model ağırlıkları, kurallar ve veri sürümü sabitlenir. Ağırlık güncellemesi maç içinde bahis sonucunu yeniden seçmek için kullanılamaz.

[FlyGym/NeuroMechFly](https://github.com/NeLy-EPFL/flygym), [flybody](https://github.com/TuragaLab/flybody) ve [MuJoCo](https://mujoco.readthedocs.io/en/stable/overview.html) araştırma ortamı için mevcut açık kaynak seçenekleridir. Sinek gövdesinin bacak/kanat kontrolcüsü insan iskeletine hazır bir boks politikası değildir. Humanoid ortam ve hareket eğitimi ayrıca gerekir. Fizik motoru sürümü ve işlemci mimarisi sabitlenmeden platformlar arası bit düzeyinde aynı sonuç varsayılmaz.

Connectome hattı: kaynak manifesti → seyrek graf → nöron/kenar eşleme → tanımlı dinamik model → duyusal giriş ve motor çıkış adaptörleri → eğitim → kör değerlendirme → sürümlü politika. Sinaps sayısı doğrudan öğrenilmiş fiziksel ağırlık veya uyarıcı/baskılayıcı işaret değildir. Nörotransmitter tahmini belirsizliği, eksik segmentler ve eşleme varsayımları raporlanır. Dense 166.700² float32 matris yaklaşık 111 GB olduğundan 8 GB VPS üzerinde kurulmaz.

Başarı ölçütü yalnız kazanma oranı değildir: geçersiz temas, ring dışına kaçış, tekrarlanan tek hamle, rakip görünmez bilgisini kullanma, enerji ihlali ve saldırısız süre ölçülür. Connectome modelinin eşit parametre ve hesap bütçeli alternatiflerden iyi olduğu gösterilmeden üstünlük iddiası yapılmaz. Unseen seed/rakip testleri ve ablation zorunludur.

## 3. Jev ve Jeeves'in doğru rolü

[PostHog Jeeves](https://github.com/PostHog/jeeves) Qwen tabanlı sınıflandırma/karar modeli ve eğitim kodudur; connectome simülatörü değildir. [TypeSafe API](https://api.typesafe.ai/redoc) yapılandırılmış seçenekler arasında karar alabilir. Bunların çıktısı iskelet eklemlerini her fizik adımında sürmek veya kazananı belirlemek için doğrudan otorite olmayacak.

Uygun kullanım: çevrim dışı bölüm analizi, kısıtlı taktik önerisi, veri etiketleme ve araştırma koşullarında karar karşılaştırması. Ham sağlayıcı yanıtı izin verilen eylem kümesine ve güvenli zaman aşımına tabi olacak. İstek hata verirse sabit fallback kullanılacak; geç gelen yanıt bir sonraki maça taşınmayacak. Araç erişimi, para transferi, bahis değiştirme, admin komutu veya keyfi kod yürütme yetkisi yoktur.

Jeeves'in yayımladığı 9B model bellek ve gecikme değerleri 8 GB ARM VPS'te 20 Hz motor kontrolü için uygunluk kanıtı değildir. Sağlayıcı çağrıları maçın ödeme yolunda bulunmaz. `experiments/decision-agent/` resmî API sözleşmesine karşı sınırlandırılmış adaptör ve çevrim dışı testleri içerir; paylaşılan anahtar kaynak koduna alınmadı, gerçek API harcaması yapılmadı.

## 4. Bahis ve kasa matematiği

Canlı Ringside için **pari-mutuel**, yani oyuncu havuzundan ödeme seçildi. Sabit oranlı SOLO oyunları bundan ayrıdır; bu değişiklik onların kasa riskini kaldırmaz.

Her maç/pazar bağımsızdır. `S` kabul edilen toplam stake, `W` kazanan seçenekteki toplam stake, `f` önceden açıklanan kesinti oranıdır. Normal dağıtımda `F = floor(S × f / 10000)`, `D = S − F`. Kazanan `i` için temel ödeme `floor(D × stake_i / W)`; kalan en küçük birimler kesirli kalan sırasıyla dağıtılır, eşitlikte sunucunun kalıcı bilet sırası belirleyicidir. Bütün hesap BigInt ve sınırları kontrol edilen tamsayıdır.

**Korunum:** `S = F + toplam ödeme`. Ödeme için başka pazar, başka maç veya house bakiyesi kullanılamaz. Boş, tek taraflı, geçersiz/iptal veya kazanan bileti bulunmayan havuzda bütün stake kesintisiz iade edilir. Doğru seçimin getirisi stake'den düşük olabilir; ekranda bu durum açıklanır. Tahminler kapanışa kadar değişebilir ve garantili oran değildir.

Bu model doğru uygulandığında operatörün sonuç kaynaklı ek ödeme yükümlülüğünü kaldırır. İşletme masrafı, ağ ücretleri, saldırı, yazılım hatası ve müşteri edinme maliyetinden sonra net kâr garantisi sağlamaz. 1 SOL rezervi “sınırsız bahis kasası” gibi sunulamaz. Ödül tokenı/airdrop ve ücret masrafları ayrı bütçedir.

Kombine kupon bu teslimde yoktur: korelasyonlu prop'ların sabit oranlarını çarpmak yasaktır. Bir sonraki aşamada kombine istenirse tüm birleşik sonucun tek havuzda tanımlanması veya tam teminatlı karşı taraf gerekir.

## 5. Pazarlar ve maç kuralları

| Pazar | Seçenekler | Nesnel çözüm |
|---|---|---|
| Maç sonucu | KOR / AYAZ / beraberlik | İki yere düşmede durdurma; aksi halde 10 × temiz isabet − 30 × yere düşme. Eşit puan beraberlik. |
| İlk temiz isabet | KOR / AYAZ / aynı anda / isabet yok | İlk `hit` olayının 50 ms tick'i. Aynı tick'te iki isabet “aynı anda”; blok ve ıskalama temiz isabet değildir. |
| Yere düşme | Olur / olmaz | En az bir `knockdown` olayı. |
| Bitiş şekli | Durdurma / puanla | İki yere düşme koşuluyla `finish`; yoksa süre sonunda puanlama. |

Bu kurallar gerçek federasyon kuralları gibi sunulmaz; mevcut simülasyonun açık kurallarıdır. Ring içindeki hakem görseli sonuç otoritesi değildir. Sonradan eklenecek faul, clinch, kafes, yerde mücadele, kickboxing/Muay Thai kuralları ayrı sürüm ve test gerektirir; bugünkü sürümde varmış gibi gösterilmez.

Contact 5 (9 Ekim gece, `ringside-match-1`): **30 saniye admission → en çok 3 × 45 saniye raunt → sonuç**; raunt aralarında bahis yoktur, her pazarda maç başına tek bilet, havuzlar maç bitince bir kez sonuçlanır. Üç seed'in hash'i admission'dan önce yayımlanır. Eski sürümlerde: 20 saniye admission → 60 saniye dövüş gösterimi → 10 saniye sonuç. Sunucuda `now >= closesAt` anından itibaren yeni bilet reddedilir. Ağda bekleyen bir tıklama kabul garantisi değildir. Aynı idempotency anahtarı kapanıştan sonra yalnız önceki makbuzu döndürür. Eski v1 biletler yeni ekonomiyle geriye dönük değiştirilmez.

## 6. Canlı mimari, şeffaflık ve ölçek

Cloudflare SQLite Durable Object maç için tek yazardır. Ticket, debit ve idempotency tek işlemde kaydedilir; ACK kalıcılık sınırından sonra çıkar. Settlement bütün pazarları, ödeme kayıtlarını, bakiyeleri, kesintileri ve sonucu tek işlemde yazar; hata halinde tamamı geri alınır. Hibernation/restart SQL'den devam eder. Kimlik doğrulanmamış veya süre dolmuş oturum bahis gönderemez.

Public stream: bağlı benzersiz demo oturumları, maç katılımcısı, kabul edilmiş bilet sayısı, havuz hacmi, seçim dağılımı, son 30 makbuz ve tam maç kaydı isteği. Üç sekme aynı oturumsa online sayısına bir kez girer. “Gerçek insan” diye adlandırılmaz. Retry hacmi artırmaz. Public takma ad session token/hash veya client UUID değildir. Bakiyeler özel kanaldadır. Gelecek real-money stream'de pending/confirmed/finalized ayrımı ve zincir işlem linki gerekir; DEMO makbuzuna zincir işlemi görünümü verilmez.

Mevcut uygulama pilot sınırları: 256 socket, 256 bilet/maç, 512 geçerli/tutulan oturum, 3 socket/oturum, 40 mesaj/dakika/socket; her pazarda bir bilet. Bunlar binlerce eşzamanlı kişi testi değildir. Binlerce izleyici için aynı protokolün snapshot + sequence/delta fanout katmanı kullanılacak; yazma otoritesi parçalanmayacak. Bahis admission ve maç çözümü ayrı tutulacak. Mevcut chat fanout mimarisi ortak canlı veri için adaydır; entegrasyon ve p95 yük testi yapılmadan kapasite ilan edilmez.

Supabase uzun vadede model registry, indekslenmiş finalized kayıt ve kimlik/uygunluk verisini tutar. VPS keeper/indexer/eğitim koordinasyonu için kullanılır; 8 GB VPS'e büyük GPU modeli zorla yüklenmez. RPC veya sağlayıcı yokluğu isteğin kabul edildiği varsayımına dönüşmez. Ücretli GPU veya servis açılması ayrıca bütçe gerektirir.

## 7. Görsel ve etkileşim kalite kapıları

9 Ekim'den beri Three.js yok: 2.5D Canvas yayını, koddan 3B iskelet, mutlak simülasyon zamanından animasyon, hareket/kaçınma/tekme gösterimi, ring içi hakem ve üç kamera. Kamera iki dövüşçüyü ring sınırlarında kadrajda tutmalı; kullanıcı geçişinde ani sıçrama olmamalı. Düşük hareket seçeneği ödeme/zamanı değiştirmez. WebGL hatasında bahis ve makbuz arayüzü çalışır. Route değişiminde sahne/GPU kaynakları temizlenir.

Premium hedef için halen gerekli işler: dövüşe özel lisanslı motion capture, temas ve ayak sabitleme, gerçek collision capsule/IK doğrulaması, karakter kıyafeti ve yüz/ten sanat yönetimi, ses katmanı, animasyon geçişlerinin bağımsız görsel incelemesi, fiziksel iOS/Android cihaz ölçümleri. Mevcut procedural kick, motion capture olarak adlandırılmaz. Aynı taban modelden türetilen hakem özgün profesyonel 3D eser gibi pazarlanmaz.

Kabul ölçütleri: 320/390/1440 px taşma yok; klavye ile bütün seçimler; 44 px hedefler; görünür focus; erişilebilir form/durumlar; hareket azaltma; WebGL context loss ve yeniden bağlanma; p95 frame süresi gerçek cihazlarda ölçülür. “Dünyanın en iyi grafiği” doğrulanabilir test değildir.

## 8. Yayın sırası ve açık kalan işler

1. **Bu teslim:** gerçek veri provenance/doğrulaması, TypeSafe deney adaptörü, deterministik reaktif dövüş referansı, havuz matematiği, dört DEMO pazar, public tape, takma adlar, veri/ödeme geri alma ve tekrar testleri, yeni ayrı v2 demo.
2. **Nöro-kontrol araştırması:** seyrek sinir dinamiği ve duyusal/motor eşleme, gerçek eğitim koşuları, rastgele graf ve klasik politika karşılaştırması, görülmemiş rakipler. Veri içe alınmış olması bu adımı tamamlamaz.
3. **Oyun kalitesi:** fizik teması, animasyon seti, kurala uygun teknikler, bağımsız görsel geçiş değerlendirmesi ve cihaz performansı.
4. **Finansal protokol:** yeni Solana pooled vault programı, fee/claim/refund talimatları, tam fon korunumu, claim replay ve iptal/zaman aşımı, model/rule hash kayıtları, oracle/VRF ve yürütme doğrulaması. Mevcut fixed-odds House programının reserve kuralı bu iş için sessizce gevşetilmeyecek.
5. **Kanıt ve açılış:** modelin doğru yürütülmesi için bağımsız replay/attestation/challenge tasarım kararı; VRF sadece seed'i doğrular. Denetim, hukuk/pazar erişim değerlendirmesi, doğrulanmış ödeme/Crash gizliliği/oracle recovery ve yük testi olmadan gerçek para açılmaz.
