# CMU boxing + MuJoCo: ayrı, başarısız kalite kapıları olan fizik deneyi

Bu çalışma LIVE v3, politikası, kabul edilmiş biletleri veya ödeme yolunu değiştirmez. Amaç, gerçek insan hareketi ile eklem/temas motorunu aynı ölçümde karşılaştırmaktır. `boxing-physics-lab.tsx` solda fizik izini, sağda gerçek mocap referansını mevcut lisanslı Quaternius skinned model üzerinde gösterir. Bu yeni bir profesyonel karakter modeli veya tamamlanmış fizik tabanlı dövüş oyunu değildir.

## Gerçekten kullanılan kaynak ve lisans

- **CMU 13_18 / boxing:** [üniversitenin spor indeksi](https://mocap.cs.cmu.edu/search.php?maincat=4&subcat=8) bu kaydı boks olarak listeler. [CMU ana koşulları](https://mocap.cs.cmu.edu/) araştırma ve ticari ürün içinde kullanıma izin verir; özgün/dönüştürülmüş verinin tek başına yeniden satılmasına izin vermez. CMU ham sunucusuna bu koşuda doğrudan dosya istekleri başarısız oldu. Veri, aşağıdaki açık mirror'dan sınırlı tek ZIP isteğiyle alındı; bütün veritabanı taranmadı.
- **BVH dönüşümü:** Bruce Hahne/CGspeed 2010 MotionBuilder-friendly dönüşümü. [Yazarın dönüşüm ve kullanım açıklaması](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/the-daz-friendly-bvh-release-of-cmus-motion-capture-database/readmefirst-file-for-daz-friendly-primary-release) dönüşüme ek kullanım kısıtı koymadığını belirtir. Kullanılan arşivin [READMEFIRST kaydı](https://github.com/Shriinivas/cmubvh/blob/3bc9c75c481ac6e622f3c378369b293d8de9be45/READMEFIRST.txt) MotionBuilder sürümünü tanımlar. Daz açıklaması aynı dosya sürümü gibi sunulmaz.
- **Mirror:** [Shriinivas/cmubvh, commit 3bc9c75c…](https://github.com/Shriinivas/cmubvh/tree/3bc9c75c481ac6e622f3c378369b293d8de9be45), `Sequence-010-014/13/Data/13_18.zip`. ZIP SHA256 `19432ab29c93d48a51830b5469a9bb647784bfa59fac3e50884ac325c1b51679`; BVH SHA256 `24efe49cc97292cbce871bec7ed3a2413118da63d435b9ad46a57e7eb81eafbb`. Mirror sahibinin sayfası tek başına üniversitenin haklarının yerine geçmez; her iki kaynak birlikte kontrol edildi.
- **MuJoCo 3.14.0:** [resmî motor](https://github.com/google-deepmind/mujoco), [Apache-2.0 lisansı](https://github.com/google-deepmind/mujoco/blob/main/LICENSE), [articulated dynamics/modelleme](https://mujoco.readthedocs.io/en/stable/overview.html). Sürüm ve yerel bağımlılıklar `requirements.txt` içinde sabit. Native Python/C runtime gerçek `mj_step` kullanır; Three.js fizik hesaplamaz.
- **Görsel insan:** halihazırdaki Quaternius CC0 model/skin/clothing; [ayrı kaynak manifesti](../../apps/web/public/models/boxing/credits.json). Bu deney yeni mesh satın almaz. Browser GLB, deneydeki yaklaşık collider yüzeyinin aynısı değildir.

Atıf: The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

Ham BVH yalnız ignored `.tooling` önbelleğine indirilir. Deneyin JSON izi, mocap türevi araştırma/uygulama verisidir; özgün veya dönüştürülmüş animasyon paketi olarak satılmamalıdır. CMU koşulları CC0 diye etiketlenmez. Bu lisans incelemesi bir kumar hizmetinin yasal çalışmasına izin belgesi değildir.

## Kullanılmayan alternatifler

| Seçenek | Birincil kaynak ve karar |
|---|---|
| Rapier | [JS joint motors](https://rapier.rs/docs/user_guides/javascript/joints/) ve [multibody constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints/) tarayıcı/Worker prototipi için uygun. [WASM determinism](https://rapier.rs/docs/user_guides/javascript/determinism/) aynı sürüm/başlangıç/sıra koşuluna bağlı; sin/cos ile hazırlanan girdiler ayrıca kontrol edilmeli. Bu koşuda çalıştırılmadı. |
| MakeHuman/MPFB | [Core assets CC0](https://static.makehumancommunity.org/about/license.html), [asset packs](https://static.makehumancommunity.org/assets/assetpacks.html). Daha ayrıntılı insan/skin üretimi mümkün; üçüncü taraf bütün paketler aynı lisans değil. Bu koşuda model üretimi/indirme yapılmadı. Program GPL/AGPL lisansı core asset lisansından ayrıdır. |
| DeepMimic | [Yazar deposu](https://github.com/xbpeng/DeepMimic) hazır imitation/RL araştırması ve motor politikaları içerir; deprecation notu MimicKit'e yönlendirir. Yeni eğitim veya hazır ağırlık çalıştırma yapılmadı. Mocap oynatmak bu kontrolcüye sahip olmak demek değildir. |

## Yeniden çalıştırma

```sh
python3 -m venv .tooling/combat-physics/venv
.tooling/combat-physics/venv/bin/pip install -r experiments/combat-physics/requirements.txt
.tooling/combat-physics/venv/bin/python experiments/combat-physics/fetch_source.py
.tooling/combat-physics/venv/bin/python experiments/combat-physics/run.py
.tooling/combat-physics/venv/bin/python -m unittest discover -s experiments/combat-physics -p 'test_*.py'
bash scripts/use-node.sh node experiments/combat-physics/test-trace.mjs
bash scripts/use-node.sh pnpm --filter @sollish/web exec tsc --noEmit
```

İlk sentetik T-pose yalnız bind kalibrasyonudur; görüntülenen 8 saniye gerçek kayıt frame 1'den başlar. BVH kanal sırası korunur. Ölçek `0.056444` metre/BVH birimi, Y-up → Z-up dönüşümü açık sabittir; aktörün tıbben ölçülmüş boy/kütle kalibrasyonu değildir. Parmak/toe gürültüsü nedeniyle bunlar çarpışma gövdesi yapılmadı.

- 600 Hz sabit fizik adımı; 60 Hz sunum izi, 4.800 `mj_step`.
- Serbest kök + sınırlı generalized torque kontrolü. Diz ve dirsek için capture rest eksenlerinde dört tek-eksen menteşe, 0–155° mühendislik sınırı; diğer eklemlerde 175° ball swing. Bunlar doğrulanmış kas/iskelet biyomekaniği değildir.
- **Pelvis destek kuvveti:** çeviri ±1500 N, açısal ±250 Nm; diğer generalized motor torqueleri ±95 Nm ile sınırlandırılır. Kütle matrisi/gravity compensation kullanır. Bu destek bağımsız denge politikasının yerine geçmez.
- Sürtünmeli zemin ve motorsuz kayar torba fiziksel temas üretir. Komşu fizik gövdeler ve baş/boyun/gövde iç içe axial proxy grubu birbirinden hariç; kollar-bacaklar-gövde arasındaki diğer selfcollision açık.
- `mj_contactForce` ile normal kuvvet ölçülür. `bagContactsOver1N` ve `selfContactSamplesOver1N` birer **contact-step örneği** sayısıdır; yumruk/isabet sayısı değildir. Destek ayağı kayması, zeminle >1 N temas eden ayak gövdesinin yatay hızıdır; cilt/toe noktasının exact kayması değildir.
- Rakip/maç/hasar/kazanan/bahis/finans girdisi yok. Referans hareketi geleceği bilinen kayıt olarak takip eder; bu rekabetçi ajan gözlemi değildir.

## Sonuç ve kabul kapıları

[Ölçümler](evidence/metrics.json): p95 joint-position tracking **16,5 cm**, en derin temas **5,1 mm**, destek ayağı p95 yatay hız **27,5 cm/sn**. Önceden belirlenmiş 5 cm / 5 mm / 10 cm/sn dar eşiklerinin üçü de **FAIL**. Finite/repeatable fizik ve gerçek temasın çalışması, dövüş kalitesinin hazır olduğu anlamına gelmez. `initial-pd-failure.json` ve `feedforward-failure.json` ilk başarısız denemeleri saklar; final kod ile birebir yeniden üretilebilir sürümler oldukları iddia edilmez.

Dört Python testi: kaynak/bind ayrımı, bozuk BVH reddi, gerçek hinge/collision yapılandırması, aynı local binary üzerinde iki dinamik koşunun hash/temas/torque/FAIL kapısı karşılaştırması. Sekiz JS assertion bounded trace doğrulamasını kontrol eder. Platformlar arası determinism veya fiziksel mobil FPS kanıtlanmadı.

Yerel gerçek Chromium/ANGLE Metal skinned viewer, 1280 ve390 viewport, oynat/duraklat ve azaltılmış hareket başlangıcında duraklama kontrol edildi. `.tooling/physics-preview/` görselleri yerel gözlemdir; hosted sonuçları ayrı değerlendirilir. Sarı noktalar fizik temasları, yarı saydam torba simüle edilmiş pasif hedeftir. MOCAP/physics görsel yönlendirmesi sonuç üretmez.

Sıradaki gerçek kalite adımı: uygun hazır fizik motor politikası/clip expert lisansını ve ağırlık formatını doğrulayıp bağımsız denge/temas ölçümüne almak. PD sayılarıyla sonsuz arama veya sadece güzel kamera bunu sağlamaz. Tam düello/başarı iddiası için el/ayak temas hatası, selfcollision, dengede kalma, fall/recovery ve görülmemiş hareket geçişleri ayrıca geçmelidir.

Görsel düzeltme: tek materyal/array şekli korunur; directional shadow normalBias=.025/bias=-.0001 ile self-shadow acne giderildi. CMU parmak verisi ölçülmediği için yalnız Quaternius `Punch_Jab` parmak trackleriyle sabit authored yumruk pozu kullanılır; gövde/kol hareketi bu authored kliple değiştirilmez. Düzeltme sonrası başlangıç ve2sn actual WebGL kareleri açılıp iki tam gövde/kapalı eldivenler gözlemlendi.
