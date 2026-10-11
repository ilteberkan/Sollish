# Hazır öğrenilmiş beden motoru — gerçek CPU deneyi

3 Ekim 2026. **Bullet projesinin dağıttığı pretrained DeepMimic ağırlıkları gerçekten okundu ve serbest köklü humanoid üzerinde çalıştı.** Kaynakla aynı 240 Hz fizik/10 solver iterasyonunda yürüme ve dönüş tekmesi, başlangıç fazı sıfırdan 10 saniye boyunca dış pelvis kuvveti veya destek olmadan ayakta kaldı. Bu iki kısa koşu dayanıklı dövüş kontrolü değildir; **üç kalite kapısı da geçilmedi**. Frozen v3, CMU boks deneyi, canlı maçlar ve ödeme yolları değiştirilmedi. Bu dizin model eğitimi yapmaz.

Önceki MimicKit/Newton erişim ve CPU adaptör başarısızlıkları [HISTORY.md](HISTORY.md) ve [ilk manifest](evidence/manifest-newton-historical.json) içinde korunur. MimicKit SharePoint HTTP401 engeli devam eder; “hiçbir pretrained motor yüklenemedi” ifadesi artık yalnız önceki deneye aittir.

## Gerçek model ve kaynak uyumluluğu

- Kaynak: [PyBullet 3.2.7 sdist](https://pypi.org/project/pybullet/3.2.7/), 80.508.379 byte, SHA256 `042879db8d101ac7590dee475fc6aded508b85fe1273fdbbfde1d88bd200e14f`. Fizik, humanoid, observation, action→PD ve phase hesabı paketteki gerçek `pybullet_envs/deep_mimic` kodudur. Baştan yeni bir takip kontrolcüsü yazılmadı.
- Spinkick ağırlığı SHA256 `4f922f07a434a0a0969c257486cba8e292c9680001db26fcca10c78231b8adff`; walk `9db666018be16a40e23e3c56bcbdeb6726b79dbc430341c18b9bf89ad849d5e5`. [Checkpoint/motion manifesti](evidence/pybullet-artifacts.json) gerçek byte uzunluklarını ve ayrı motion hash'lerini kaydeder.
- Spinkick dosyasının Git blob kimliği, [resmî Bullet deposunun sabit commit'indeki dosyayla](https://github.com/bulletphysics/bullet3/blob/63c4d67e337017f9d8b298c900e9aabdb69296e7/examples/pybullet/gym/pybullet_data/data/policies/humanoid3d/humanoid3d_spinkick.ckpt.data-00000-of-00001) aynı: `e499b1f261528e5ee4d35abcb2b7c882b4ce2083`. **Özgün XBPeng ilk checkpoint'iyle byte-identical değil**; onun blob kimliği `58acc3dd9283fac3115c345b4e5bd7352da3bd6a`. [Birincil API karşılaştırması](evidence/checkpoint-origin-check.json) saklandı. Doğru atıf: “Bullet tarafından dağıtılan DeepMimic pretrained motor”.
- [Güncel özgün XBPeng dosyası](evidence/deepmimic-download.json) ayrıca indirildi; güvenli tensor incelemesi 227 observation/28 action gösterdi. Bu portun 197/36 alanlarına kesilip uydurulmadı. Kullanılan Bullet checkpoint'i gerçekten **197→1024 ReLU→512 ReLU→36**. Checkpoint state mean/std ile normalize, action mean/std ile geri ölçeklenir; çıkışa tanh veya keyfî clamp eklenmez. Goal yok, yalnız deterministik mean actor; bahse/sonuca erişim yok.
- [Kaynak testrl.py](https://github.com/bulletphysics/bullet3/blob/63c4d67e337017f9d8b298c900e9aabdb69296e7/examples/pybullet/gym/pybullet_envs/deep_mimic/testrl.py) **240 Hz** kullanır. Önceki 600 Hz seçimi upstream varsayılanı değildi. Son iki koşuda aynı `env.need_new_action` floating-clock takvimi kullanıldı: nominal30Hz, fiilen275 karar/10sn, aralık33,3–37,5ms. Agent önce gözlemi okur/eylemi uygular, sonra fizik adımlanır. Başlangıç START/phase0 seçildi; kaynak ayrıca RANDOM destekler. Bu tek başlangıç genelleme testi değildir.

`export_checkpoint.py`, SHA sabitli TensorBundle dosyalarını [Shawn Presser'ın saf Python reader'ıyla](https://github.com/shawwn/tensorflow-checkpoint-reader) yalnız sonlu sayısal array olarak okur. En çok100tensor/5milyon eleman; ağ boyutları ve pozitif normalizer std doğrulanır. `np.load(allow_pickle=False)` kullanılır. TensorFlow/PyTorch/SavedModel veya keyfî pickle çalıştırılmadı. Reader deneysel bir bağımlılıktır; sayısal kodun TensorFlow bit-eşdeğerliği kanıtlanmadı. [Tensor şekil kaydı](evidence/spinkick-tensor-export.json) ve [kurulu kaynak/binary kimliği](evidence/runtime-provenance.json) mevcuttur.

## Ölçülen kalite ve sınırlar

Her satır gerçek10s fizik koşusu; 600 adet60Hz görüntü karesi. Takip metriği her fizik adımında15 linkin dünya konumu hatasının ortalamasının zaman p95'idir. Eşikler değişmedi: **takip<5cm, penetrasyon<5mm, destek ayağı yatay hızı p95<10cm/sn**. Son metrik normal kuvvet>1N iken ankle-link hızıdır; dönen ayağın temas noktası hızı yalnız ek tanısal ölçüdür.

| Hareket / fizik | Takip p95 | Penetrasyon max | Destek ankle p95 | İlk düşme | 3 kapı |
|---|---:|---:|---:|---|---|
| Spinkick240Hz/10 | 7,292m | 23,32mm | 1,328m/sn | 10s gözlemde yok | FAIL/FAIL/FAIL |
| Walk240Hz/10 | 1,465m | 11,25mm | 0,523m/sn | 10s gözlemde yok | FAIL/FAIL/FAIL |
| Spinkick600Hz/10 | 4,868m | 11,55mm | 1,030m/sn | 10s gözlemde yok | FAIL/FAIL/FAIL |
| Walk600Hz/10 | 1,415m | 4,31mm | 0,588m/sn | 10s gözlemde yok | FAIL/PASS/FAIL |
| Spinkick1200Hz/50 | 5,174m | 11,55mm | 0,928m/sn | 10s gözlemde yok | FAIL/FAIL/FAIL |
| Walk1200Hz/50 | 6,869m | 3,85mm | 0,406m/sn | **1,705s** | FAIL/PASS/FAIL |

1200 Hz/50iter yalnız bir fizik hassasiyet denemesidir; daha fazla solver hesabı bu checkpoint'i daha sağlam yapmadı. Başarısız koşular silinmedi. Düşme sonrası10sn kaydının devamı toparlanma iddiası değildir. Birden fazla eşzamanlı fizik parametresi değiştiği için hangi parametrenin tek başına düşmeyi doğurduğu çıkarılamaz.

240Hz walk'un köke göre takip hatası6,93cm ve temas noktasının kayma p95'i5,26cm/sn. Bunlar ayrı tanısal ölçülerdir; başarısız dünya/ankle eşiklerinin yerine geçirilmedi. Dünya metriği, modelin küresel ilerleme/yön sürüklenmesini de kapsar; gözlem baş yönüne göre yereldir ve mutlak yatay konum hedeflemez. Bu sapmayı kabul edilebilir saymak ayrı bir ürün kararı gerektirir. Spinkick köke göre de59,63cm hatalı: yalnız dünya kayması açıklaması yeterli değildir.

Kaynak uyumunda observation sırası/faz/normalizer/action→PD aynıdır; orijinal C++ eğitim dünyasıyla temas/inertia/numerics eşdeğerliği yoktur. Bir sonraki geçerli adım, özgün çalışma ortamıyla aynı checkpoint parity testi veya bu fizik dünyasına karşı yeniden eğitim ve bağımsız faz/perturbasyon değerlendirmesidir. Kör PD/solver tuning, eşik gevşetmek veya mocap'i kinematik olarak oynatıp “denge öğrendi” demek çözüm sayılmaz.

240Hz koşularında tüm10s rollout CPU duvar süresi0,48/0,57sn; mean-actor inference p95 0,031/0,043ms; processpeakRSS88,7/89,1MB. macOS ARM/Python3.13.7 yerel headless ölçümleridir; mobil/VPS/browserFPS, eğitim hızı veya çoklu oyuncu kapasitesi değildir. Başlatma, dosya yükleme ve renderer bu inference süresine dahil değildir. Kaynak humanoid totalmass45,0001kg;0,0001kg floating-base koordinatı tek başına gövde kütlesi değildir. Root fixed değil, pelvis desteği yok; motor yalnız eklem hedefleri üretir. Nonancestor self-collision açık; ancestor çiftler dışlanır. Knee/elbow hinge aralıklı, spherical eklemler anatomik limitli insan modeli değildir.

## Gerçek beden görüntüleyici sözleşmesi

Önerilen dosyalar [spinkick240 render trace](evidence/spinkick-240hz-10iterations-render-trace.json) ve [walk240 render trace](evidence/walk-240hz-10iterations-render-trace.json). [Altı trace hash'i](evidence/render-traces.json), [formal doğrulama](evidence/validation.json). `*-trace.json` ham fizik kayıtları değişmeden korundu; render dosyası yalnız geometri/rest metadata ekler.

```text
schema: sollish-learned-motor-trace-v1; Y-up; metre; quaternion xyzw
bones[i]: {name, parent}                  // 16 node; base parent=-1
frames[n]: {t, bones:[{p,q}], reference:[{p,q}], contacts:[{p,force,bodyA,bodyB}]}
geometry: [{bone,type,dimensions,p,q}]    // link-local, gerçek loaded collider
referenceRestPose: [{p,q}]               // URDF zero-joint, base identity
```

Sphere dimensions `[radius]`; box `[fullX,fullY,fullZ]`; capsule `[radius,cylinderLength]`, **yerelZ ekseni**. Three.js Y-axis CapsuleGeometry kullanılıyorsa geometriyi önce X etrafındaπ/2 çevir; sonra kayıttaki shape-local quaternion ve world-link dönüşümünü uygula. Boyutları tekrar0,25 ile çarpma: runtime ölçüsü zaten ölçekli. `getCollisionShapeData` COM-local döndürdüğünden, exporter inertial frame dönüşümüyle **link-local** yapar.15collider, URDF XML offset/boyutlarıyla bağımsız karşılaştırıldı. `neck` node baş proxy'sidir; `root` pelvis, `chest` torso; diğer eşleme `anatomy` alanında.

World-link pose doğrudan kullanılır; parent dönüşümünü yeniden çarpmayın. Contact `p` dünya noktası, `force` Newton; `bodyA/bodyB` Bullet **link index** alanlarıdır, bone index için+1 gerekir; `-1` base/plane olabilir. Bu alanlar rigidbody uniqueID değildir. Eski `referencePose` ilk animated mocap karesidir; **bind pose değildir**. Yeni `referenceRestPose` ayrı izole DIRECT dünyasında gerçekten sıfır eklem durumundan alındı; Quaternius T-pose bind'iyle otomatik eşdeğer sayılamaz. Doğru ilk gösterim gerçek collider proxy'sidir; skin retarget ayrıca eklem-basis kalibrasyonu ister.

## Tekrar çalıştırma

Mevcut izole ortamla, depo kökünde:

```sh
.tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/export_checkpoint.py spinkick
.tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/export_checkpoint.py walk
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 .tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/run_policy.py --skill spinkick --hz 240
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 .tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/run_policy.py --skill walk --hz 240
.tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/export_geometry.py
.tooling/combat-motor-reuse/venv/bin/python -m unittest discover -s experiments/combat-motor-reuse -p 'test_*.py' -v
.tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/validate_evidence.py
```

Komutlar aynı isimli deney çıktısını yeniler; yayımlanmış kanıtı korumak için ayrı checkout kullanın veya önce tarihli kopya alın. **13 test PASS:**11 pure/data doğrulaması+2 gerçek Bullet collider/rest API testi. Altı replay hash/schema/finite/unchanged-physics denetimi PASS; bu, kalite kapılarının PASS olduğu anlamına gelmez. WebGL, hosted veya fiziksel telefon bu testlerin kapsamı değildir.

Temiz ortamda önceki Newton bağımlılıkları gerekli değildir. `requirements-learned.txt` ek numeric/build sürümlerini listeler; sdist URL/SHA değerleri `runtime-provenance.json` içindedir. PyBullet3.2.7 ARM/Python3.13 wheel sunmadığından kaynak derlendi. İlk Darwin derlemesi eski zlib `fdopen` makrosuyla hata verdi; yalnız [Darwin+tek compiler build patch'i](patches/pybullet-darwin-bounded-build.patch) uygulandı. Reader'da [NumPy2/Python3.13 uyum patch'i](patches/reader-python313-numpy2.patch) var. Patches kaynak algoritmasını değiştirmez; değiştirilmiş paketler orijinal dağıtım gibi sunulmaz. Kurulum global ortamı değiştirmedi; paidGPU/hesap/servis kullanılmadı.

## Lisans ve kimlik

[Bullet root lisansı](https://github.com/bulletphysics/bullet3/blob/63c4d67e337017f9d8b298c900e9aabdb69296e7/LICENSE.txt) repo dosyalarını zlib olarak tanımlar; Extras/ThirdPartyLibs istisnaları ayrıca korunur. Kullanılan humanoid/motion/policy dizininde ek lisans bulunmadı. [Zlib bildirimi](licenses/Bullet-zlib.txt), [reader MIT bildirimi](licenses/checkpoint-reader-MIT.txt) ve ayrıca indirilen özgün [DeepMimic MIT bildirimi](licenses/DeepMimic-MIT.txt) saklandı. Ağırlıklar ignored araştırma önbelleğindedir; frontend'e yayımlanmadı. Modelin orijinal eğitim veri haklarına dair yeni bir garanti verilmez. Bu dosyalardaki hazır motor, projede eğitilen connectome modelinden ayrıdır; biyolojik kontrol veya bilinç iddiası yoktur.
