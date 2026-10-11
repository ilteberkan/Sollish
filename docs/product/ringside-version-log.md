# Ringside sürüm günlüğü

Bu dosya [şartnamenin](ringside-neuroarena-spec.md) tarihli eklerini birebir korur; 6 Ekim 2026'da şartnameden taşındı, metin değiştirilmedi. Her bölüm o sürümün kabul koşullarını, kanıtını ve açık kalanlarını kaydeder. Dondurulmuş sürümlerin (LIVE v1/v2/v3, `sparring-4`, `neuro-1`) kuralları burada yazıldığı gibi geçerlidir. Yeni sürüm eklerken en alta yeni tarihli bölüm ekle.

## 3 Ekim 2026 iş emri — Contact v3

Bu bölüm yeni geliştirme sözleşmesidir; yukarıdaki v2 kuralları eski biletler için donmuştur. Kullanıcının temas, öğrenme, raunt, görünür işlem defteri ve cüzdan taleplerinin kabul koşulları:

| Alan | Uygulanacak koşul | Kanıt türü |
|---|---|---|
| Dövüş | Rakipten sonsuz kaçış yok; fiziksel olarak geçerli yaklaşma, gard, açı, sıyrılma ve dört teknik. Kararlar aynı önceki kareyi görür. | Seed taraması, saldırısız süre ve konum sınırı |
| Temas | Hasar sadece süpürülmüş eldiven/ayak temasından; baş/gövde/gard/bacak ayrılır. Her saldırıda en fazla bir temas. Görsel IK aynı kayıtlı hedefi kullanır. | Her sağlık farkını olaylarla eşleme, gerçek GLB uç konumu |
| Beden | Kök hacimleri ve hakem ayrılır. Ölçülmüş iskelet uzunlukları aşılmaz; hareket boyunca sabit ve salınan ayak hedefleri kaydedilir. | Çoklu seed gövde uzaklığı + GLB erişim testleri |
| Öğrenme | Gerçek kaynak altgrafı, eğitim, bağımsız test, başarısız deney ve ablation açıkça saklanır. | `experiments/connectome/LEARNING.md` ve manifestler |
| Canlı raunt | Her maç en fazla üç raunt; her raunt 20 sn kabul + 45 sn simülasyon + 10 sn sonuç/ara. Her raunt/pazar kendi hesabına sahiptir. | Gerçek workerd cutoff, restart, settlement ve raunt geçişleri |
| İzleme | Görünür saat, bağlı oturum, katılımcı, tutar, bilet sayısı ve seçeneğe yatırılan miktar. Desktop yayın/defter/form aynı çalışma alanı; mobil panel sekmeleri. | Tarayıcı viewport ve taşma kontrolleri |
| Etkileşim | Gerçek skinned mesh tıklaması dövüşçüyü seçer; klavye için eşdeğer isimli düğmeler. Kamera ve azaltılmış hareket sonucu değiştirmez. | Gerçek GLB raycast, erişilebilir UI ve deterministik replay |
| Cüzdan | Önceki seçili Wallet Standard cüzdan için `silent:true` restore; açık disconnect tercihi siler. Geciken eski bağlantı/sign-in yanıtları yeni oturuma karışmaz. | Unit, reload ve navigation browser kontrolleri |
| Yerel SOLO demo | Bakiye/stake/payout tamsayı ledgerında tutulur. Deadline geçmiş kaybeden oyun gezinme/unmount ile iade alamaz. | Deadline/visibility/unmount ve settlement tekrar testleri |

V3 `ringside-contact-3-f8cd1d1f` ayrı `ContactArena` namespace'i ve `/v3/arena/ringside` yolu kullanır. Mesaj zarfının `v:2` olması eski motoru göstermez: sürüm ayrımı `round.engine` ve sadece v3'te zorunlu olan `bout` alanıdır. V2 `/v2/arena/ringside` ve `/live/ringside-v2` üzerinden önceki ledger'ını korur; v1 klasik arena ayrıdır. Session/pending anahtarları da ayrı tutulur.

V3 raunt sonucu, uygulanan hasar toplamından veya sağlık sıfırlanınca durdurmadan türetilir. İlk raunt 1000 sağlık/kondisyonla başlar. Durdurma yoksa sonraki raunta sağlık +250 ve kondisyon +350, üst sınır 1000 uygulanır. Sağlığı sıfırlanan dövüşçü için durdurma maçı bitirir; iki eşzamanlı sıfır beraberliktir. Raunt skoru kazanılan rauntları sayar. Dört pazar **tek raunt** içindir; bütün maç sonucu veya kombine kupon değildir. Maç erken durursa görsel dövüş durur, dağıtım önceden ilan edilen 45 saniyelik son tarihte gerçekleşir.

Bu sürümde 128 gerçek MaleCNS nöronu/4.949 kenar üzerinde, varsayımsal recurrent dinamik ve sentetik öğreticiyle gerçek bir çıkış katmanı eğitildi. İlk ridge deneyi başarısızdı; doğrulama bölümüyle geliştirilen MLP başlığı yeni bağımsız test bölümünde %86,66 öğretici-etiket doğruluğu gösterdi. Bu, canlı dövüş başarısının veya biyolojik düşünmenin ölçümü değildir. Karıştırılmış graf benzer başarı verdi; connectome üstünlüğü gösterilmedi. Eğitim maç içinde devam etmez; her **raunt** için recurrent state sıfırlanır; sağlık/kondisyon taşınır. Kaynak/model hashleri manifesttedir. Jev servisleri sonuç/ödeme yoluna alınmadı.

Model SHA256'sı `f8cd1d1feb8cf62f39eb2f1b11ebf95728deb8990f83594230d15709d2d9db9e` kodda sabittir; uyumsuz model çalışma anında reddedilir. Seed taahhüdü motor kimliğini, maç/raunt numarasını, skoru ve başlangıç sağlık/kondisyonunu bağlar. **Bu yayın sonrası aynı motor kimliğiyle dövüş davranışı/model değiştirilemez.** Sonraki sürüm yeni namespace/motor kimliği almalı, kabul edilmiş v3 biletleri için bu kod/weights korunmalıdır; yalnız fail-closed yapmak eski biletleri sonuçlandırmanın yerine geçmez.

Mevcut kaynaklar yeniden kullanıldı: [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), [Three.js AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html), [Raycaster](https://threejs.org/docs/pages/Raycaster.html), [Wallet Standard bağlantı sözleşmesi](https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/features/src/connect.ts). Gerçek GLB'ye iki kemikli IK uygulanır; klipler ve prosedürel hedefler motion capture değildir. Tam rigid-body ragdoll, her kemik için anatomik malzeme fiziği, grappling/ground fighting, lisanslı özel dövüş mocap'i, profesyonel karakter sanat üretimi ve fiziksel mobil cihaz QA bu sürümde tamamlanmış sayılmaz.

Havuz kesintisi pozitif veya sıfır olabilir; negatif ödeme yükümlülüğü oluşturmayan **fon korunumu** doğrulanır. Bu, sabit oranlı Crash/Coinflip'i risksiz yapmaz. Tarayıcıdaki yerel DEMO kredileri kullanıcının cihazında değiştirilebilir ve gerçek fon otoritesi değildir. Gerçek varlık gates, oracle/Crash gizliliği, ödeme, bağımsız değerlendirme ve yük testleri kapanmadan açılmayacak. Yeni görsel veya eğitim metriği bunların yerine geçmez.

## 3 Ekim 2026 — ayrı self-play ve beden araştırması

`/lab/ringside`, öğrenme ve beden deneylerinin hash doğrulanmış kayıtlarını karşılaştıran ayrı ekrandır; canlı maç, bahis kabulü veya ödeme otoritesi değildir. Bu bölüm yerel kaynak/deney durumunu belirtir, yeni ekranın dağıtımını doğrulamaz. Frozen `ringside-contact-3-f8cd1d1f` ve önceki biletler korunur. Yeni deney kayıtları `research:` kimliği taşır; canlı v3 kimliğiyle kabul edilemez.

**Gerçek öğrenme kapsamı:** [self-play](../../experiments/combat-selfplay/README.md) ve [curriculum](../../experiments/combat-selfplay/CURRICULUM.md) koşularında öğrenci gerçek simülasyonda karar verip maç/temas ödülünden çıkış ağırlıklarını öğrendi; öğretmen hamle etiketi kullanılmadı. MaleCNS'in 128 düğümlü sabit altgrafı, varsayımsal recurrent dinamik ve 1.112 öğrenilen readout parametresi kullanılır. Bu, bütün beynin öğrenmesi, bilinç veya biyolojik duyusal/motor aktarım değildir. Aksiyonlar sekiz yüksek seviyeli karardır; kas/eklem torku, denge ve ayak kontrolü öğrenilmiş değildir. İlk adayın cross tekrarına dayanan başarısı ve ikinci adayın başarısız çeşitlilik/enerji ölçümleri korunur; karıştırılmış graf/recurrence karşılaştırması connectome üstünlüğü göstermedi.

**Mekanik teşhis:** [ayrı gard ortamı](../../experiments/combat-selfplay/GUARDED.md) baş yüksekliğindeki boşluğu yeni eldiven konumu ve sonlu önkol kapsülüyle daralttı. 96 gerçek karşılaştırmalı rollout'ta cross/gard eşleşmesinde temiz isabetler 193→97 düştü, bloklar 319→415 çıktı. Bu, tam rigid-body humanoid fiziği veya geniş oyun dengesi kanıtı değildir. Yeni ortamda önceki curriculum modelinden başlayan 3.600 eğitim maçı sonrası, aynı yeni ortam ve 256 bağımsız test maçı/politikada skor 0,3340→0,9961 oldu (kazanma=1, beraberlik=0,5). Baseline zaten öğrenilmiş modeldir. Ortalama 2,898 saldırı tekniği ≥3 hedefini, %64,21 motor müdahalesi ≤%25 hedefini geçemedi: **kalite kapısı FAIL**. Eşikler düşürülmez; gard/enerji yönetimi ve görülmemiş rakiplere genelleme sonraki kabul koşullarıdır.

**Beden katmanı:** [CMU 13_18 boks mocap + MuJoCo](../../experiments/combat-physics/README.md) gerçek 4.800 fizik adımıyla, sınırlı pelvis desteği ve kayıt takibiyle yürütüldü. Bağımsız dengede kalan öğrenilmiş dövüşçü değildir. Takip p95 16,5 cm, penetrasyon 5,1 mm, destek ayağı hızı p95 27,5 cm/sn; üç kalite eşiği de FAIL. CMU kullanım koşulları CC0 sayılmaz; mocap veri paketi tek başına yeniden satılmaz. [MimicKit/Newton yeniden kullanımında](../../experiments/combat-motor-reuse/README.md) pasif humanoid CPU üzerinde adımlandı, fakat incelenen MimicKit SharePoint ağırlık/motion bağlantısı HTTP401 ve CPU `update_contacts` adaptörü `NotImplementedError` nedeniyle gerçek neural motor inference çalışmadı. Yazarın özgün DeepMimic deposundaki MIT lisanslı spinkick checkpoint ve eşleşen motion daha sonra indirildi; [SHA/kaynak kanıtı](../../experiments/combat-motor-reuse/evidence/deepmimic-download.json) kaydedildi. Eski TensorFlow/Bullet modeli mevcut Newton gözlem/eylem uzayıyla doğrudan uyumlu değildir ve çalıştırılmadı. Sonraki adım güvenli tensor yükleme, observation/action eşdeğerliği ve gerçek dengeli motor rollout'tur.

**Ölçek:** [gerçek yerel workerd deneyinde](../load-validation.md) tek ledger'a bağlı fanout ile 1.000 izleyici +64 DEMO bahisçi tamamlandı; 1.120 bahisçi burst'ünde admission hedefi kaçtı, kabul edilen 616 biletin tamamı korunarak dağıtıldı. Ayrı 4 Hz public delta deneyi trafiği %93,35 azalttı ve 20 kasıtlı sequence boşluğunu tam snapshot ile kurtardı. Pilot sınırları ve tek finansal yazar değişmedi. Hosted kapasite, restart/hibernation, backpressure, maliyet ve bağımsız privacy incelemesi olmadan deney adaptörü canlı route'a taşınmaz. Bu ilerlemeler düşük seviyeli öğrenilmiş motor, AAA kalite veya gerçek varlık açılışı anlamına gelmez.

## 3 Ekim 2026 — referans kalite incelemesi ve enerji/motor devamı

Kullanıcı fiziksel telefon kontrolünü ürün tamamlandıktan sonra kendisi yapacağını belirtti; bu aşamada tarayıcı/simüle ekran doğrulaması önceliklidir. Fiziksel cihaz kontrolü tamamlandı diye işaretlenmez.

[CrazyGames Boxing](https://www.crazygames.com/tr/t/boxing), [Punchers](https://www.crazygames.com/tr/game/punchers), [Boxing Stars](https://www.crazygames.com/tr/game/boxing-stars) ve [Fight Arena Online](https://www.crazygames.com/tr/game/fight-arena-online) incelendi. Kaynak oyun açıklamaları, menüler ve Punchers sayfasının gömülü oynanış videosu görüldü; otomasyonla oynanabilir maça girilemediği için bütün oyunlar oynanmış sayılmaz. Referanslardan alınan kabul yönü: okunur hazırlık/temas/toparlanma, görünür enerji tüketimi, belirgin gövde/kalça ağırlık aktarımı, yakın fakat iki karakteri koruyan yayın kamerası. Rakip oyunlardan varlık veya kaynak kod kopyalanmadı.

**Yeni öğrenme kanıtı:** üç aşamada 26.640 ek gerçek eğitim maçı (14.400 enerji residual, 8.400 refinement, 3.840 CEM); final aday model SHA `eb270b099c4c0d64bebc55f1d74ee06e92c6d24335370f501011ee6c7a8f5dee`. 576 yeni test maçı/politika, 12 rakip, iki taraf; final sonrası ayar yapılmadı. Aynı bankada önceki guarded modele göre teknik sayısı 2,974→3,602, motor müdahalesi %62,17→%8,61, karşılanamayan maliyetle ham öneri %28,30→%0,0028. Teknik ve enerji eşikleri geçti; temiz isabet 14,98→10,88 ile ≥12 eşiği geçmedi. Sürekli tekme baseline'ı %99,83 kazanırken aday %90,80 kazanır; ortamın teknik dengesi ve rakibe genel uyum çözülmüş değildir. Model canlı v3'e taşınmaz. Eski başarısız kayıtlar ve eşikler korunur.

**Hazır öğrenilmiş motorun gerçek çalışması:** Bullet3/PyBullet3.2.7 dağıtımındaki DeepMimic pretrained 197→1024→512→36 aktörün sayısal tensorları güvenli okundu; NumPy inference gerçek serbest tabanlı fizik ortamına bağlandı. Yürüme ve spinkick 10 saniye/240 Hz, kaynak `need_new_action` takvimiyle 275 karar çalıştı. Bu iki kısa koşuda pelvis desteği ve düşme teması yok. Daha yüksek frekans duyarlılık deneyi de korunur: 1200 Hz yürüyüş 1,705 sn'de düştü. Robust bağımsız denge, öğrenilmiş dövüş veya tam fonksiyonel biyolojik beyin kanıtı değildir. Yeni motor da üç özgün takip/penetrasyon/ayak hızı eşiğini birlikte geçmedi. CMU destekli fizik kaydının üç başarısız sonucu değişmedi. Motor, yüksek seviyeli MaleCNS altgraf kontrolcüsüyle henüz birleşmedi.

**Sunum:** yeni `fightkit-v1` dosyası mevcut Quaternius 65 kemik/14 authored klibi koruyarak kıyafet, deri koruyucu/eldiven ve bot ekler; Poly Haven CC0 deri haritaları ve kaynak hashleri ayrı kaydedildi. AA anatomi veya yeni mocap değildir. Yalnız Lab kullanır, eski LIVE ve SOLO sunumuna sessiz dosya değişimi yapılmaz. Yeni Lab sağlık/enerji/isabet/hamle fazını iki dövüşçü için aynı anda gösterir. Ayrı öğrenilmiş motor sekmesi deneyin gerçek çarpışma hacimlerini ve fizik kaydını gösterir; nihai karakter sanatı gibi sunulmaz. Her iki izleme yolu hash/süre/boyut doğrulaması yapar; kamera, oynatma ve kıyafet ödeme veya dövüş sonucu üretmez.

**Sonraki kabul engelleri:** tekme dengesizliğini yeni ve ayrı ortam sürümünde gidermek; dokunulmamış test bankasında temiz isabet/çeşitlilik/enerjiyi birlikte geçmek; motoru stratejiye bağlayıp yeni görülmemiş başlangıçlar/darbeler altında dengeyi test etmek; üç fizik kapısını aynı koşuda geçirmek; profesyonel karakter/mocap üretimi ve gerçek telefon QA. Yeni kayıtların yayımlanması bu maddeleri kapatmaz. Yayın kimliği ve test kapsamı `ops/evidence/ringside-quality-20261003.json` içinde ayrı tutulur.

## 3 Ekim 2026 — oynanabilir Combat Club / Sparring eki

Kullanıcının Fight Arena Online düzeyinde dövüş mekaniği talebini somut girdi/tepki testleriyle geliştirmek için yeni ve ayrı `/lab/ringside/play` antrenman yolu hazırlanır. Sürüm `sparring-1`; mevcut SOLO, shared LIVE, Contact v3 motor/politika ve kabul edilmiş biletlerin devamı veya ekonomik göçü değildir. Bu modda bahis, cüzdan imzası, bakiye, token ödülü ve ödeme yoktur. Tarayıcıda duraklatılabilen yerel oyun zamanı kullanılabilir; bu istisna sunucu otoriteli LIVE maç zamanını değiştirmez.

Yeni referans gözlemi Fight Arena'nın 3D tutorial salonuna girişi ve P ile pause menüsünü; Punchers'ın gerçek 3D animasyonlu menüsünü kapsar. İç içe Unity girdileri güvenilir olmadığı ve FIGHT tıklaması Punchers maçını başlatmadığı için tamamlanmış maç/temas testi iddiası yoktur. [Görseller ve yayıncı kontrol bilgileri](../research/ringside-sparring-20261003.md) ayrı saklanır; bu gözlem yeni Sollish sürümünün tarayıcı kabulü değildir.

**Çalışma ayrımı:** `combat-sparring.ts` 60 Hz sabit adımda girdiyi, hareketi, dayanıklılığı, saldırı fazlarını, basitleştirilmiş temas hacimlerini, hasarı ve sonucu yürütür. Arayüzün mevcut oturumu 90 saniyedir. Three.js bu state'i görselleştirir; klip, kamera, ses ve temas parıltısı hasar otoritesi değildir. Aynı sıralı girdilerle replay eşdeğerliği sınanır; kayan noktalı yerel kinematik model, bağımsız fizik motoru veya ağ üzerinde kanıtlanmış platformlar arası deterministik yürütme diye sunulmaz.

**Etkileşim hedefi:** hareket, yönlü gard, sıyrılma, dash, sıçrama; jab, cross, hook, uppercut, roundhouse; okunur hazırlık/aktif/toparlanma, sınırlı input buffer, hit-confirm kombinasyonu, hitstun/kontra ve gard kırılması. Hasar yalnız geçerli aktif saldırının süpürülmüş temasından; aynı saldırı örneği birden fazla hasar vermez. Sağlık/enerji ve olaylar iki dövüşçü için görünürdür. Aynı tick'te geçerli iki temas birlikte çözümlenir. Bu kurallar federasyon boksu veya gerçek ragdoll fiziği değildir.

**Kontrolcü:** “Kendin oyna” insan girdisi + bot; “Dövüşü izle” bot + bot kullanır. Dengeli/baskı/kontra botları okunabilir, sabit kurallı referanslardır. Yeni mod MaleCNS, öğrenilmiş DeepMimic motoru, çevrim içi eğitim veya TypeSafe API kullanmaz. Önceki gerçek öğrenme ve başarısız fizik deneyleri korunur; antrenman moduna otomatik olarak aktarılmış sayılmaz.

**Animasyon kaynağı:** mevcut Quaternius iskelet/kliplerine ayrı CC0 Mesh2Motion paketi eklenir. Fighting idle, defend, üç dodge, iki strafe ve walk-back olmak üzere sekiz authored klip `combat-motion-v1.glb` içinde hashlenmiştir. 66→65 kemik dönüşümü, `head`→`Head`, bind farkları, root hareketi filtreleri ve lisans [ayrı asset kaydındadır](../../scripts/boxing-assets/combat-motion-v1.md). Jab/cross/hook ve darbe tepkileri authored klip temellidir; uppercut, roundhouse, sıçrama ve temas/ayak düzeltmeleri procedural katman içerir. Bu ek pakette hazır uppercut/roundhouse mocap yoktur. Görsel IK, desteklenmeyen karakterin kendi dengesini öğrendiği anlamına gelmez.

**Yeni kabul kaydı:** klavye/dokunmatik giriş, takılı tuş bırakmama, pause/reset, 390 px yerleşim, context-loss ve route cleanup yerel üretim tarayıcı testlerinde; üç kameranın 320/390/1440 px projeksiyonu sayısal testlerde; uzuv/temas eşleşmesi gerçek GLB üzerinde sınandı. Son kamera düzeltmesinden önce 33 tarayıcı testi, son `yTTEY4MG5gmewPMEL9MsM` build üzerinde etkilenen 6 antrenman testi geçti. Son sürüm Cloudflare'a yayımlandı; gerçek hosted 1280×720 WebGL görünümünde bot dövüşü, pause/resume, yayın/üst kamera ve boş JS hata kaydı gözlendi. [Yayın kimliği ve kapsam](../../ops/evidence/ringside-sparring-20261003.json) ayrı saklanır. Bu sonuçlar AA sanat, Fight Arena/Punchers eşdeğerliği, tam beden fiziği veya öğrenilmiş dövüşü kanıtlamaz. Aktif dövüş FPS ölçümü kesinleşmedi; fiziksel telefon kontrolü kullanıcı tarafından sonraya bırakıldı. [Araştırma sınırları](../research/ringside-sparring-20261003.md) ve [doğrulama kaydı](../validation.md) geçerlidir; dokuz gerçek-varlık açılış kapısı değişmez.

## 4 Ekim 2026 — Combat Club `sparring-2` mekanik düzeltmesi

Kullanıcının üç somut şikâyeti (temasın beden içinden geçmesi, geri çekilerek dövüşün bitmesi, zayıf ağırlık aktarımı/dar kamera) önce [mekanik denetimiyle](../../experiments/combat-sparring-audit/README.md) dondurulmuş `sparring-1` üzerinde sayısal olarak yeniden üretildi, sonra yeni `sparring-2` sürümünde düzeltildi. Bu mod bahis kabul etmez; kabul edilmiş bilet olmadığı için normal sürümleme uygulandı. Contact v3, v2, v1 ve LIVE pool kaynakları değişmedi; hashleri önceki yayın kanıtıyla eşleşir.

- **Temas:** isabet/blok anında uzuv vurulan yüzeyde durur; savunan geri çekilen uzva yürürse uzuv kısalır. İlan edilen baş/gövde hacmine giriş p95 14–18 cm'den 0,2 cm'ye (ikili arama toleransı) indi. Ölçüm küre hacimlerine karşıdır; üçgen mesh, kol/bacak çarpışması değildir.
- **Mesafe ve baskı:** ileri 1,85 / yan 1,45 / geri 1,10 m/sn, vuruş başına hazırlıkta adım (jab 13 cm). Saldırmayan kaçış stratejisi önceden 90 sn'de hiç temas almıyordu; şimdi botlar onu her maçta yakalıyor ve çoğunlukla nakavt ediyor.
- **Enerji dengesi:** blok saldırganın maliyetinin %40'ı ve 12 tick yenilenme duraklaması; tek teknik jab spam'i 0,87 skordan 0,00'a düştü. Botlar hâlâ **sabit kurallıdır**, öğrenilmiş politika değildir.
- **Sunum:** kroşede kalça/gövde rotasyonu, ölçülmüş deri sınırı, daha alçak/yakın yayın kamerası, 3/4 takip kamerası, kamera tarafındaki halatların kesiti ve 1280×720'de 370 → 468 px sahne. Render katmanı sonuç otoritesi değildir.

Ayar seed 1–24 üzerinde yapıldı; görülmemiş seed 1001–1048 bir kez ölçüldü ve sonuçlar tutarlı. Sömürü stratejileri ayar sırasında kullanılanlarla aynıdır; insan oyun testi yapılmadı. Karakter/animasyon sanat kalitesi, öğrenilmiş strateji + bağımsız beden kontrolü, üç fizik kalite kapısı ve fiziksel telefon testi açık kalır.

## 4 Ekim 2026 — Combat Club izleme sürümü: `sparring-3`, gerçek boks mocap'i, arena ve ses

Kullanıcı kararı: Combat Club bir **izleme** yüzeyidir; "Kendin oyna" hiçbir oyunda olmayacak. Kullanıcı bahis verir ve izler; dövüşü köşeler yapar. Bu yüzey hâlâ bahissizdir; LIVE v3 ve önceki biletler değişmedi.

- **Kurallar (`sparring-3`):** boks kural seti; tekme komutu `ruleset` gerekçesiyle reddedilir (tip, eski kayıtlar için durur). Gövde merkezleri arası en az 0,78 m (0,64 m'de gerçek bladed mocap gövdeleri iç içe geçiyordu). Ayak hızları boksa yaklaştırıldı: ileri 1,35, yan ~1,0, geri 0,72 m/sn. Kaçış adımı 2,6 m/sn. Botlar ringi keser (önleme noktası + geri kaçana adım).
- **Hareket:** CMU boks hareket yakalama kayıtları (7 kayıt, toplam ~4,5 dk kaynak) çevrimdışı olarak mevcut 65 kemikli rig'e aktarıldı. Bunlardan 8 jab, 8 direkt, 4 ön el kroşesi ve 58 ayak oyunu/gard penceresi seçildi ([pipeline ve lisans](../../scripts/boxing-assets/cmu/README.md)). CMU verisi CC0 değildir: ürün içinde kullanım serbest, verinin kendisi satılamaz. Aparkat, darbe tepkisi, nakavt ve kalkma için uygun kalitede kayıt bulunamadı; bunlar hâlâ authored + prosedürel katmandır.
- **Sunum:** özgün prosedürel arena (yükseltilmiş kare ring, dört taraf halat, köşe pedleri, ışık truss'ı, kademeli kalabalık, LED panolar), yavaş cihazda kendini düşüren kalite. Ses: CC0 yumruk sesleri, CC BY 4.0 seyirci kayıtları, özgün sentez zil ([atıf](../../apps/web/public/audio/ringside/credits.json)).

Ölçüm (görülmemiş seed 1001–1048): kaçan rakip her maçta nakavt, jab spam 0,00, ilan edilen hacme giriş en fazla 0,2 cm. Masaüstü M2 GPU'da aktif dövüş ~60 FPS; yazılım WebGL'de ~3,5 FPS (en kötü durum; telefon ölçümü değil). Açık kalanlar: kullanıcı görsel kabulü; profesyonel karakter modeli ve yüz; aparkat/tepki/nakavt/kalkma mocap'i; ayak kayması için tam foot-lock; nakavt sayımı ve raunt yapısı; öğrenilmiş politika entegrasyonu; bu motorun bahisli LIVE sürümüne (yeni namespace) terfisi.

## 4 Ekim 2026 — NeuroBoxer: gerçek dövüşlerde öğrenen sinek bağlantı haritası kontrolcüsü

Combat Club'da "Sinek beyni" köşesi artık gerçek `sparring-4` dövüşlerinde evrim stratejisiyle eğitilmiş bir kontrolcüdür: 22 algı değeri → 128 MaleCNS inen-nöron alt grafında tekrarlayan bellek (anatomik bağlantılar sabit) → hareket/gard/komut kararı. İki köşe aynı tick'te karar verir (ilk denemedeki sıralı karar bir tarafa bilgi avantajı veriyordu; bütün modeller yeniden eğitildi). Ürün seed'e bağlı örnekleme kullanır: her maç farklı, aynı seed birebir tekrar.

Görülmemiş seed'lerde öğrenme kanıtı güçlü (sabit kurallı köşelere karşı ~0,97–1,00; taban çizgileri ~0). **Gerçek bağlantı haritasının karıştırılmış graf veya belleksiz ağa üstünlüğü gösterilmedi**; üç mimari de bu rakiplere karşı tavana dayanıyor. Ekrandaki düşünme paneli kontrolcünün gerçek iç durumunu (algı, 128 nöron etkinliği, karar olasılıkları) gösterir; bilinç veya tam beyin iddiası yoktur. [Yöntem ve sonuçlar](../../experiments/neuro-boxer/README.md).

## 5 Ekim 2026 — `sparring-5`, NeuroBoxer v2 (`neuro-2`) ve Jev stil katmanı

Kullanıcının dört talebi bahissiz Combat Club'da uygulandı: maç içi karakter seçimi ve karar kaydı (TypeSafe Jev), sinek beyni stratejisti, hakem hareketi ve temas. **Yayımlanmadı.** `sparring-4` ve neuro-1 bayt bayt korunur. LIVE v1/v2/v3 kaynakları değişmedi. Kanıt: [doğrulama kaydı](../validation.md) ve `ops/evidence/ringside-sparring5-20261005.json`.

- **Temas (`sparring-5`).** Motor artık gövde, baş, uyluk, kol ve eldiven kapsülleriyle çalışır. Kökler yalnız gövde/baş/uyluk örtüşmesiyle ayrılır; gard tutulurken önkol ve eldiven katıdır ve önce onlara çarpan vuruş bloktur. Motor düzeyinde gövde örtüşmesi sıfırdır. Render tarafında prosedürel bir düzeltici gövdelerin iç içe geçmesini büyük ölçüde giderir. Yakın mesafede gardların ve eldivenlerin birbirine girmesi çözülmedi; CPU GLB eşikleri FAIL kaydedildi. Bu katman hareket yakalama değildir.
- **Hakem.** Dövüşçülerin arasından geçmez, ani sıçramaz. Pozlara yumuşak mesafe korur (≥0,55 m; yatan bedene ≥0,6 m), hız ve dönüş sınırlıdır. Yürüyüşü hıza ve yöne göre karışan klipler ile prosedürel ayak yerleşimidir (CC0 Mesh2Motion + Quaternius; hareket yakalama değil). Hakem sonucu etkilemez; 60 maçta dövüşçü sonuçları birebir aynıdır. Açık kalanlar: gerçek sahnede adım başına 2,51 cm ayak kayması (eşik <2 cm) ve kamera tarafında daha sık durma (%5,35).
- **NeuroBoxer v2.** Aynı 128 düğümlü MaleCNS alt grafı üzerinde öğrenilmiş bir stratejist başlığı altı stilden birini seçer: baskıcı, kontracı, temkinli, mesafeci, gövdeci, bitirici. Seçilen stil, stile koşullu taktik beyne girer. Girdiler yalnız görülebilir maç durumudur; bahis, bakiye, kimlik ve seed yoktur. Held-out değerlendirmede stratejist en iyi sabit stili **geçmedi**, rakip eğilim girdilerinin ölçülebilir etkisi yok ve connectome üstünlüğü gösterilmedi. Doğrulama kuralıyla seçilen s3 ayna maçlarında neredeyse hiç saldırmadığı için ürün, seyirci ölçütüyle **s1**'i kullanır; bu bir performans iddiası değildir. Stil etiketi öğrenilmiş bir latent seçimdir, akıl yürütme veya bilinç değildir. Panelin gösterdiği gerekçeler yaklaşık atıflardır.
- **Jev stil katmanı.** İsteğe bağlı olarak bir köşenin stilini TypeSafe Jev (`jev-1.13.0`) seçer: maç başında, her raunt arasında ve raunt içinde her 15 sn'de bir. Cevap 1,5 sn içinde gelmezse deterministik yedek kural uygulanır. Simülasyon karar işlenene kadar bekler, bu yüzden sonuç ağ hızına bağlı değildir. Sonuç yalnız (motor, seed, karar günlüğü) üçlüsüne bağlıdır ve kayıt indirilip ağsız tekrar oynatılabilir. Jev'in sonuç, puan, işlem veya araç yetkisi yoktur; anahtar yalnız sunucu ortamındadır. Barındırılan demoda Jev, sahibi `wrangler secret` ile anahtarı tanımlayana kadar kapalıdır; bunun yerine çevrimdışı kayıt (önbellek) ve yedek kural kullanılır.

Açık kabul işleri: kullanıcının görsel ve his kabulü; eldiven/gard iç içe geçmesi; neuro-2 ayna maçlarında nakavt olmaması (s1 maçlarının %97'si kararla biter); daha güçlü held-out rakiple stratejist ve connectome karşılaştırması; fiziksel telefon testi.

## 8 Ekim 2026 — Gece Ligi yayın görünümü (yalnız sunum)

`/live/ringside` artık varsayılan olarak yeni 2.5D tuval yayınını gösterir; eski 3D sahne kameradaki **3D** düğmesi ve `?scene=3d` ile açılır. Motor (`ringside-contact-3-f8cd1d1f`), politika, kabul ve ödeme değişmedi; görünüm yalnız taahhüt edilmiş kareleri ve olayları okur. Tasarım yönü Claude Design tuvalindedir ("Ringside Görsel Yönü"). **Yayımlanmadı.** Kanıt: `ops/evidence/ringside-gece-ligi-20261008.json`.

- **Hareket.** Elle yazılmış 2D anahtar kare pozları + kayıtlı temas noktasına nişan alan iki kemikli prosedürel IK. Hareket yakalama veya öğrenilmiş motor değildir. 12 maçtaki 474 isabet/bloğun hepsinde eldiven ya da ayak, olay karesinde hedef bölgeye 2,5 cm içinde değer.
- **Yalnız görsel düzeltmeler.** Kamera ekseni boyunca 1,08 m'den yakın dövüşçüler simetrik açılır; hakem kamera ile dövüşçüler arasındaysa saydamlaşır, sayımda yere düşene, sonuçta kazananın yanına yürür. Seed açıklanmadan önce dövüşçüler motorun başlangıç noktalarında ısınır.
- **Kameralar.** Yayın ve Ring dövüşçü eksenine dik döner; Taktik, motorun mm konumlarını ve eldiven pozlarını üstten gösterir.
- **Ön izleme.** `/lab/ringside/night` çevrim dışı araştırma tekrarıdır; bahis yoktur.

Açık: kullanıcının görsel kabulü, barındırılan yayın, fiziksel telefon. Combat Club, `/live/boxing`, `/game/boxing` ve `/live/ringside-v2` hâlâ 3D sahneyi kullanır.

## 8 Ekim 2026 — Contact 4 (`ringside-contact-4-f8cd1d1f`) ve yayın

Kullanıcı mekaniği yavaş ve amatör buldu. Yeni motor sürümü açıldı; **yayımlanmadı**. Contact 3 bayt bayt korunur, `/v3` ve `/live/ringside-v3` üzerinden kendi biletlerini sonuçlar. Kanıt: `ops/evidence/ringside-contact4-20261008.json`.

- **Motor.** Jab, düz, ön/arka kroşe, aparkat, gövde kroşesi; 2-3 vuruşluk seriler, sıyrılma/eğilmeden kontra, klinç ve hakem ayırması, sersemleme, yere düşme, hakem sayımı (saat işler), kalkma; üçüncü düşüş veya sağlığın bitmesi durdurmadır. Süre biterse hasar + düşürme başına 120 puan. Açık dövüşçü özellikleri: Kor kısa menzil/güçlü, Ayaz uzun menzil/sıkı gard. Bağlantı ağı ağırlıkları değişmedi ve yalnız taktik niyeti seçer; seri, mesafe, savunma ve sayım açık deterministik kurallardır, öğrenilmiş değildir. 400 maçta raunt başına ~90 vuruş, ~33 isabet, ilk raunt yere düşme %30, Kor %52,8 / Ayaz %47,3.
- **Sunucu.** `ContactArenaV4`, `/v4/arena/ringside`, migration `v5`, motor kaydı `CONTACT_ENGINES` ile taahhüt ve tekrar eşleşir.
- **Yayın (yalnız sunum).** Kısa vuruş duraksaması, eldiven izi, darbe parlaması, nakavtta yarım hızlı tekrar ve canlı sayım, raunt sonu en iyi an, isteğe bağlı arena sesi. Hakem kamera koridoru dışında yanda çizilir. Animasyon elle yazılmış anahtar pozlar, analitik yaylar ve IK'dir; hareket yakalama değildir.

Açık: kullanıcı görsel kabulü, barındırılan yayın (deploy onayı), telefon testi; Combat Club ve eski sayfalar 3D.

## 9 Ekim 2026 — Contact 5: maç içi öğrenen dövüşçü, canlı Jev köşe planı, animasyon A/B

Kullanıcı kararları (9 Ekim): maç içi öğrenme serbest (kural, başlangıç ağırlıkları ve hiperparametreler donar), Jev köşe antrenörüdür, anahtar yalnız yerelde, animasyonda önce iki prototip. **Yayımlanmadı.** Kanıt: `ops/evidence/ringside-contact5-20261009.json` ve aynı adlı klasör.

- **Motor** `ringside-contact-5-78ccfa82` (`combat-v5.ts`). Contact 4 ringi, hasar, sayım ve hakemi; her vuruş, seri devamı, mesafe ve savunma seçimi öğrenen ağdan gelir. Kural olarak kalanlar yalnız fiziksel: kondisyon, sersemlik, klinç menzili ve 5 sn hakem beklemesi. Dövüşçü özellikleri v5 için dengelendi (KOR menzil −25, güç 1,12; AYAZ menzil +35).
- **Öğrenen** (`contact-learner.ts`). MaleCNS 128 düğümlük sabit rezervuar + aktör-eleştirmen okuma katmanı; maç içinde TD(0), hızlı eylem eğilimi ve entropi terimiyle yalnız gözlenebilir olaylardan güncellenir. Yalnız + − × ÷ kullanan tanh/exp/log. Başlangıç ağırlıkları 12.000 eğitim raundundan (`experiments/ringside-learner`).
- **Kanıt, dürüst sonuç.** Üç kural denendi, her biri önceden yazılmış kriterle yeni seed'lerde bir kez test edildi. v1: maç içi öğrenme öğrenen rakiplere karşı +45 puan (31–58) ama maçlar izlenemez (%33 klinç, yere düşme %0,7). v2: kriter geçmedi. **v3 (seçilen):** ana kriter geçmedi (öğrenen rakiplere −3, aralık −28..24); sabit tarzlı hiç görülmemiş rakiplere +43 (16–70). MaleCNS karıştırılmış ağdan iyi değil. Denge: KOR %47, yere düşme %41, raunt başı 97 vuruş, altı tekniğin hepsi %10–26.
- **Jev.** 6 sn'de bir, tek çağrı iki köşeyi yanıtlar (niyet, hedef, tehdit). Sunucu planı bahis kapandıktan sonra ister, 1,5 sn sınır, bütçe (`JEV_CALL_BUDGET`, varsayılan 300), deterministik yedek; her plan raundun taahhüdünden başlayan hash zincirine girer ve anında yayımlanır; tarayıcı gözlem hash'ini yeniden oynatarak doğrular. Gerçek tek çağrı: 545 ms, 2.281/280 token.
- **Sunucu.** `ContactArenaV5`, `/v5/arena/ringside`, migration `v6`; dövüş kesimden 2,5 sn sonra başlar. Web: `/live/ringside` v5, `/live/ringside-v4` korunur; köşe paneli Jev planını ve dövüşçünün o an tarttığı üç eylemi gösterir.
- **Animasyon A/B** (`/lab/ringside/motion`). Aynı Mixamo yakalaması + IK iskelet iki çizimle: A gerçek 3D, B Canvas 2.5D. Arka kroşe, gövde kroşesi, eğilme, klinç yakalanmış klip değil, elle eklenen katmandır. 60 Hz ölçüm: temas p95 1,0 cm (en kötü 3,7), eldiven iç içe geçme karelerin %0,07'sinde >5 mm, ayak kayması 0,63 cm/adım, eklem hızı p99 45 rad/sn.

Açık: kullanıcının animasyon yolu seçimi ve görsel kabulü; v5 canlı sayfanın tarayıcı testi; telefon 60 fps ölçümü; Mixamo'nun yalnız-animasyon dosyasının herkese açık sunulması lisans incelemesi ister.

## 9 Ekim 2026 (akşam) — tek canlı oyun, tempo, menzil, kodla çizilen 2.5D yayın

Kullanıcı isteği: tempo çok yüksek; dövüşçüler menzile girmeden vuruyor; oyun 2.5D olacak, 3D tamamen kalkacak; sitede tek boks oyunu (canlı) kalacak; Jev ve meyve sineği tam çalışacak; animasyon kodla daha iyi olacak. **Yayımlanmadı.** Kanıt: `ops/evidence/ringside-contact5-20261009/rule-v4/`, `rule-v4b/` ve `ops/evidence/ringside-live-20261009b.json`.

- **Motor** `ringside-contact-5-dfd179bd` (kural v4b). `V5_TEMPO` motor kimliğine girer:
  - vuruş yalnız menzil + 100 mm içindeyken seçilebilir;
  - bir seride en çok 3 yumruk;
  - seriden sonra toparlanma: 10 tick + yumruk başına 12 tick (kontra penceresi hariç);
  - kondisyon dinlenirken 3/tick, yumruk atarken 0;
  - sersemlik 2/tick söner;
  - ayak işi süreleri uzadı.
  Köşe planı 9 sn'de bir, raunt başına 5 plan, 18 sn'lik gözlem penceresi. Çeneler: KOR 1,03, AYAZ 1,00. Contact 5'in önceki kimliği hiç yayımlanmadığı için yeni kimlik aynı `/v5` ad alanını kullanır.
- **Tempo ölçüsü** (300 raunt): raunt başına 54 vuruş (önce 97); KOR %48; yere düşme %24; 10. saniyede ortalama kondisyon %85 civarı. Her vuruş menzil içinden başlar (protokol testi).
- **Öğrenme kanıtı:**
  - Kural v4 (`579c86bc`, çeneler 1,09/1,05) önceden kaydedilmiş testi geçti: öğrenen rakiplere karşı öğrenen − donmuş +19,6 puan (95% aralık 0,4…38,4); sabit tarzlı rakiplere +50 (36…64). MaleCNS karıştırılmış ağdan iyi değil.
  - Yere düşme %12 kaldığı için çeneler indirildi; bu kural v4b oldu. Kural v4b ayrı ön kayıtla yeni seed'lerde (`test5`) test edildi. Ana kriter geçmedi: öğrenen rakiplere karşı −2,6 (−22,9…17,7). Sabit tarzlı rakiplere karşı +38,8 (24,6…53,4). Karıştırılmış ağa göre fark yok.
  - Ürün v4b'yi kullanıyor, çünkü izlenebilirlik için yere düşme gerekiyor. Metin yalnız sabit tarzlı rakiplere karşı faydayı söylüyor.
  - Öğrenme kriterini geçen v4 kimliğine dönmek kullanıcı kararı.
- **Jev:**
  - Geçici hata (zaman aşımı, ağ, 5xx, bozuk cevap, 429) olursa ve son tarihe en az 0,6 sn kaldıysa bir kez yeniden denenir. Her deneme bütçeden düşer.
  - workerd senaryosu 11/11: Jev cevabı, yeniden deneme, bozuk cevap, kaçan son tarih, zaman aşımı, bütçe, yeniden başlatma.
- **Site:**
  - Yalnız `/live/ringside` kaldı. `/game/boxing`, `/live/boxing`, `/live/ringside-v2…v4` ve `/lab/ringside*` sayfaları `/live/ringside`'a yönlenir. Gezinmedeki Ringside bağlantısı canlı oyuna gider.
  - 3D sahneler, GLB modeller, Mixamo/CMU varlıkları, araştırma sayfası, Combat Club ve `three` bağımlılığı kaldırıldı. Silinmedi; `.tooling/archive/removed-20261009/` altına taşındı (gitignored).
  - Eski motorların sunucu tarafı (v2–v4 arenaları) kabul edilmiş biletler için korunur.
- **Animasyon:** `apps/web/lib/ringside-25d/motion.ts` ve `components/ringside-broadcast.tsx` kodla yazıldı; hareket yakalama kullanılmıyor.
  - Metre cinsinden 3B iskelet, kol ve bacakta iki kemikli IK, basan ayağı kaydırmayan adım planlayıcı.
  - Tekniğe göre eldiven yolu: düz yumruk çizgi, kroşe yatay yay, aparkat aşağıdan yukarı, gövde kroşesi eğilerek.
  - Kalça önce döner, eldiven son anda hızlanır. Menzil eksiği kalça ve eğilmeyle kapanır, kol uzatılarak değil.
  - Darbe tepkileri sönümlüdür: düz yumruk geri, kroşe yana, aparkat yukarı, gövde vuruşu öne katlanma. Ayrıca düşme, oturma, sayım, diz çökme, kalkış, klinç sarılması ve hakem modları var.
  - Kamera: uzun lens (21°), ring hattına 17° açılı, sayımda yerdeki dövüşçü ile hakemi kadrajlar. Kameranın önüne geçen hakem saydamlaşır.
  - 60 Hz kapıları (`apps/web/tests/ringside-motion.test.ts`, 10 maç):
    - temasta eldiven–kafa yüzeyi p95 0,4 cm, en kötü 3,4 cm;
    - basan ayak kayması 0;
    - kemik boyları sabit;
    - kare başına en büyük adım: eldiven/dirsek 36 cm, gövde/kafa 16 cm. Bu, yumruk ve kafa savrulma hızıdır; sıçrama değildir.

Açık:
- kullanıcının görsel kabulü;
- telefon 60 fps ölçümü;
- Playwright paketi v5'e çevrildi ama barındırılan derlemede koşturulmadı;
- yayın (realtime `v6` migration + web) ve barındırılan Jev anahtarı onay bekler.

## 9 Ekim 2026 (gece) — maç başına tek bilet (`ringside-match-1`) ve yeni arena arayüzü

Kullanıcı isteği: her rauntta bahis olmasın, bütün maç için tek bahis olsun; bahis daha akıllı olsun; dövüşçüye tıklama fark edilmiyor; site daha modern ve etkileşimli olsun (Claude Design ile). **Yayımlanmadı.** Kanıt: `ops/evidence/ringside-match-20261009.json`.

- **Defter:** Contact 5 artık maç defteri kullanır. Bahis yalnız R1'den önce 30 sn açıktır; R2/R3'ün kabul penceresi yoktur (`closesAt = openedAt`). Biletin `roundId` alanı maçın (bout) kimliğidir. Her havuz maç bitince (durdurma ya da R3 sonu) bir kez sonuçlanır. Dövüş motoru ve öğrenme kuralı değişmedi.
- **Pazarlar:** `match-winner` (KOR/berabere/AYAZ), `match-method` (KOR veya AYAZ, durdurma veya puan; berabere), `match-knockdowns` (0–1 / 2 / 3+). 300 maçta evet/hayır yere düşme pazarı %96 "evet" çıktığı için sayı pazarına çevrildi (%40/39/21).
- **Adillik:** Üç raunt seed'i bahis açılmadan çekilir, hash'leri her anlık görüntüde yayımlanır. Önceki rauntlar (seed, başlangıç durumu, plan kaydı) yayımlanır; geç katılan tarayıcı bütün maçı yeniden oynatır (`verifyMatchHistory`) ve maç sonucunu kontrol eder. Jev planları kapanıştan sonra geldiği için yalnız DEMO.
- **Ad alanı:** v5 hiç yayımlanmadığı için aynı `/v5` yolu ve `ContactArenaV5` sınıfı kullanılır; Durable Object adı `ringside-match-v1` (yerel eski test deposu kullanılmaz). v2–v4 sunucuları ortak taban sınıftaki defter kancalarıyla değişmeden çalışır (workerd 16 ve 12 kontrol).
- **Arayüz:** Claude Design tuvali (https://claude.ai/artifact/Cu1K7TpsxUWFi73w6PpdM8) referans alındı. Bahis açıkken yayında her dövüşçünün ayağında nabız gibi atan halka ve çarpan etiketi; altta dövüşçü kartları ve kalabalık dağılımı; sağda maç kuponu (pazar sekmeleri, canlı tahmini dönüş, renkli onay düğmesi); telefonda alttan açılan kupon. Maç akışı şeridi (Bahis → R1 → R2 → R3 → Sonuç), canlı kupon takibi ("şu an önde/geride", yalnız gösterge), raunt arası ve maç sonu kartları. Site genelinde yeni renkler, hap menü ve yeni oyunlar sayfası.

## 10 Ekim 2026 — tekmeler (kural v5k), izleyici kamerası, yeni arena ve arayüz

Kullanıcı isteği: tekme ve MMA/kick boks hareketleri; daha iyi boksör, hakem, ring çevresi, vuruş ve hareket animasyonu, kamera takibi; fare/telefonla açı ayarı; "Az hareket" kalksın; yazılar okunur, butonlar modern olsun; Higgsfield ile görsel; orkestra şefi geliştirme. **Yayımlanmadı.** Kanıt `ops/evidence/ringside-contact5-20261010/`.

- **Motor** `ringside-contact-5-989b2917`: `combat-v5-strikes.ts` (`teep`, `lowKick`, `bodyKick`, `headKick`, `knee`), kuralları `V5_KICK_RULES`; öğrenen 19 eylem, 48 girdi. Alçak tekme bacağa vurur, yere düşürmez; ön tekme iter; diz yakında ve klinçten. v5 hiç yayımlanmadığı için aynı `/v5` ad alanı.
- **Denge ayarı** yalnız denge seed'leriyle üç kısa koşu (yere düşme %6 → %44 → %17): çeneler 0,96/0,94, kafa tekmesi sersemletmesi 56. Son eğitimde denge geçti (KOR %52, yere düşme %18, 44 vuruş, tekme %33).
- **Önceden kayıtlı test (test6):** ana kriter geçmedi (öğrenen rakiplere −1,8; −18,9…15,0), ikincil de (sabit tarzlara +1,6; −12,8…15,9). Eğitilmiş ağ eğitimsize göre +113. MaleCNS karıştırılmış ağdan farklı değil. Sayfa metni buna göre düzeltildi.
- **Yayın** (`lib/ringside-25d/scene.ts`, `camera.ts`, `arena.ts`, `motion.ts`): fareyle sürükle/tekerlek, telefonda yatay sürükle ve iki parmakla yakınlaş, çift tıklama ya da "Görüşü sıfırla" ile otomatik kameraya dönüş; sönümlü otomatik kamera; Higgsfield arena arka planı, seyirci, ışık, LED pano, köşe minderleri; yeni dövüşçü ve hakem çizimi; tekme ve diz için bacak IK'si (destek ayağı kaymaz).
- **Arayüz:** yazılar en az 13 px, ana sayılar büyük; oyun tarzı butonlar; "Az hareket" kaldırıldı (işletim sistemi ayarı geçerli); dövüşçü kartlarında Higgsfield portreleri; lobi kapağı yeni.
- **Testler:** protocol 139, web 71, workerd v5 14, tarayıcı 7 + 14, operasyon 34, readiness 2.

## 10 Ekim 2026 (öğleden sonra) — raunttan raunda öğrenme (kural v5m), Higgsfield parça çizimleri

Kullanıcı isteği: öğrenme raunt süresi, raunt sayısı, rakibin canı, kondisyonu ve hamleleri üzerine olsun; iki beyin bağımsız seçsin ve raunttan raunda unutmadan ders çıkarsın; sonuç ekranı oyunu kapatmasın ve kapatılabilsin; boksör, hakem ve ring Higgsfield ile oyuna uygun yeniden üretilsin. **Yayımlanmadı.** Kanıt `ops/evidence/ringside-contact5-20261010/summary.json`, `rule-v5m/`.

- **Motor** `ringside-contact-5-5d6b12d5`: `V5Carry` (okuma ağırlıkları, eleştirmen, hızlı ağırlıklar, rakip modeli, dersler) raunt sonunda çıkar, sonraki rauntta başlangıç olur; `verifyMatchHistory` ve sunucu bunu önceki rauntları yeniden oynatarak üretir. 73 girdi: raunt, rakibin teknik sıklıkları, savunma alışkanlıkları, isabet oranı, kendi tekniklerimin bu rakibe karşı dersleri. Bağımsızlık testi: KOR'un beyni değişse de AYAZ'ın iç durumu yalnız görünen dövüş üzerinden değişir.
- **Ön kayıtlı test (test7, 200 maç, bütün maç):** öğrenen rakiplere +38 (−1,9…73,7) ve sabit tarzlara +20 (−5,2…44,8): ikisi de geçmedi. Keşif amaçlı: öğrenen rakiplere R1 +2, R2 +19, R3 +16. Eğitim etkisi +284. MaleCNS karıştırılmış ağdan farklı değil.
- **Denge:** KOR %50,7, yere düşme %18,8, 41,5 vuruş, tekme %36,6 (tasarım bandı %35; protokol testinin tavanı %40'a çıkarıldı, açıkça kayıtlı). Ayar koşusu yalnız denge seed'leriyle (`tune-m.sh`), test seed'lerine dokunulmadı.
- **Çizim:** Higgsfield parça sayfaları (KOR, AYAZ, hakem, ring zemini, apron; 10 kredi) `apps/web/scripts/ringside-sprites.mjs` ile yeşil zeminden ayrılıp `public/sprites/ringside/` altına parçalandı; sahne parçaları 3B iskelete göre yerleştirir. Prosedürel çizim yedek olarak kalır.
- **Arayüz:** sonuç ve raunt arası kartları sahnenin sol altında, kamera çubuğunun üstünde; "Sonucu kapat" ve "Sonucu göster".
- **Testler:** protocol 147, web 76, workerd v5 14, realtime 11, tarayıcı 7 + 14, operasyon 34, readiness 2.

## 10 Ekim 2026 (akşam) — klasik 2D sprite yayını

Kullanıcı parça (cutout) çizimini bozuk buldu ve klasik 2D dövüş oyunu görünümünü seçti. Higgsfield'de (GPT Image 2, 10 kredi) her dövüşçü için iki 4x4 poz sayfası ve hakem için 4x3 sayfa üretildi, onayla indirildi (`.tooling/higgsfield-sprites/`). `apps/web/scripts/ringside-frames.mjs` kareleri yeşil zeminden ayırır, ayak çapası ve ortak ölçek hesaplar (75 kare, ~1,2 MB). `lib/ringside-2d/` sabit yan kamerada kare kare canlandırır; vuruş karesi motorun temas tikine denk gelir. KOR'un iki kişili klinç karesi kullanılmaz (blok karesi). Fare/parmakla döndürme kaldırıldı; Yayın ve Taktik kaldı. Testler: web 89, tarayıcı 7 + 14.
- **Düzeltme turu (aynı akşam):** kullanıcı iç içe geçme ve kesik hareketi reddetti. Yeni: kare başına gövde/kafa/itme kutusu ve vuruş ucu (`frames.json`), görüntü konumları motordan türetilir ama gövdeler örtüşmez, vuruş ucu temas tikinde hedefe değer; mesafeyle eşlenmiş 6 adımlı yürüyüş, en az 70 ms kare tutma, darbe duraksaması ve sarsıntı; Higgsfield sahne arka planı (aynı tarz) ve geçiş sayfaları (`kor-3`, `ayaz-3`, 6 kredi). Hakem geride, küçük ve koyu çizilir, dövüşçülerin arasına girmez, 40 px boşluk korur. Kanıt: `ops/evidence/ringside-contact5-20261010/film/` (kare dizileri). Testler: web 98, tarayıcı 22 (film dahil).

