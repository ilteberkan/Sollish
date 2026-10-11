# MimicKit motor yeniden kullanımı — gerçek CPU deneyi

**Sonraki kanıt,03:50UTC:** aşağıdaki MimicKit SharePoint engeli geçerlidir; fakat “hiçbir hazır ağırlığa erişilemiyor” genellemesi artık doğru değildir. Yazarın eski DeepMimic deposundan küçük pretrained spinkick checkpoint'i ve eşleşen motion indirildi. [Yeni kaynak kaydı](evidence/deepmimic-download.json) bu eklemeyi ayrı tutar; önceki Newton deneyinin sonucu değişmedi.

3 Ekim 2026. **Newton CPU fizik adımlaması çalıştı; hazır neural spinkick motoru yüklenemedi.** Bu deney yeni bir dövüş motoru, eğitim koşusu veya görsel kalite teslimi değildir. Frozen v3, mevcut viewer ve ödeme yolları değiştirilmedi.

## Gerçekten yapılan

- Yazarın [MimicKit kaynağı](https://github.com/xbpeng/MimicKit/tree/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69) pinlendi. README, hazır `deepmimic_humanoid_spinkick_model.pt` kullanımını gösteriyor. `humanoid.xml`, Newton engine ve loader kaynaklarının byte/SHA kayıtları [provenance](evidence/source-provenance.json) içinde.
- Ayrı `.tooling/combat-motor-reuse/venv`: Python3.13.7, Newton1.0.0, Warp1.17.0, MuJoCo3.5.0, mujoco-warp3.5.0.2. Paketler [hash sabitli lock](requirements.lock) ile kuruldu. Mevcut fizik venv'sine dokunulmadı. PyTorch kurulmadı; ağırlık yerine rastgele ağ kullanılmadı.
- Warp gerçek macOS ARM `cpu` cihazını açtı. Aynı XML import seçenekleri, self-collision açık, native `SolverMuJoCo(use_mujoco_cpu=True)` ile 15body/34DoF humanoid **1.200 adım / 5 simülasyon saniyesi** yürütüldü. Kontrolcü yok; kaynak passive joint terimleriyle düşüş testi. Root assist uygulanmadı.
- [İlk koşu](evidence/cpu-runtime-initial.json): soğuk başlatma11,38sn; stepping0,275sn, adım medyan0,221ms/p95 0,255ms. [Temas API koşusu](evidence/cpu-runtime.json): warm başlatma0,474sn; stepping0,331sn, medyan0,225ms/p95 0,287ms. Sonlu fizik değerleri alındı. Bunlar model inference latency'si veya mobil/VPS ölçümü değildir.
- İki koşunun [150kare trace](evidence/passive-trace.json) hash'i aynı: `be735eceae8bf23b329c404bbba1536ff3c2b721f677deea01b397b00da94231`. Dünya Z-up, metre, quaternion xyzw; bu küçük trace viewer'a combat sonucu olarak bağlanmadı.

## Somut iki engel

**Ağırlık/motion erişimi:** README'deki resmî public SharePoint bağlantısının anonim istekleri 03:34:49UTC kaydında HTTP401 döndü. Daha önce Mozilla User-Agent ile normal bağlantı ve `download=1` varyantı Microsoft login HTML'ine yöneldi. [Saklanan HTTP kanıtı](evidence/asset-access.json) yalnız durum, host ve prefix hash içerir; cookie, oturum query'si veya HTML saklamaz. Repo release `v0` ayrıca indirilebilir asset içermiyordu. Hiçbir ağırlık/motion byte'ı elde edilmedi; harici arşiv lisansı doğrulanamadı. Login açılmadı, hesap/ücretli servis kullanılmadı.

**CPU temas adaptörü:** yalnız `use_mujoco_cpu=True` seçmek full MimicKit çalıştırmaz. Pinned [NewtonEngine.step](https://github.com/xbpeng/MimicKit/blob/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69/mimickit/engines/newton_engine.py) her control tick sonunda `solver.update_contacts(...)` çağırıyor. Kurulan Newton1.0 CPU solver üzerinde bu çağrı **gerçekten `NotImplementedError`** verdi; ayrı BLOCKED alanında kayıtlı. Native `mj_data` temas kuvvetleri/sensörleri için adaptör ve observation/action sırası eşdeğerliği testi gerekir. Bu deney full MimicKit environment/agent path'ini çalıştırmış sayılmaz. [Newton resmî API](https://newton-physics.github.io/newton/latest/api/_generated/newton.solvers.SolverMuJoCo.html) CPU flag'ini açıklar; kurulan1.0 davranışının kanıtı yerel runtime'dır.

## Güvenli tekrar ve sınırlar

```sh
python3 -m venv .tooling/combat-motor-reuse/venv
.tooling/combat-motor-reuse/venv/bin/python -m pip install --require-hashes --only-binary=:all: -r experiments/combat-motor-reuse/requirements.lock
python3 experiments/combat-motor-reuse/prepare_sources.py
.tooling/combat-motor-reuse/venv/bin/python -m unittest discover -s experiments/combat-motor-reuse -p 'test_*.py' -v
.tooling/combat-motor-reuse/venv/bin/python experiments/combat-motor-reuse/cpu_probe.py
```

Lock bu macOS ARM/Python3.13 ortamına aittir; Linux wheel hash'leri değildir. CPU komutu kendi `cpu-runtime.json` kaydını yeniler; ilk ölçüm ayrı korunur. `inspect_assets.py` isteğe bağlı iki anonim,20sn timeout/65.536byte sınırlı HTTP kontrolüdür; dosya veya hesap indirimi yapmaz.

**5 unit test PASS:** resmî `Motion.save` builtin dict/list/numeric biçimi kabul; callable pickle çalıştırılmaz; NaN/Infinity/bozuk frame/fps, trailing data, byte ve SHA sınırı reddedilir. `safe_artifacts.py` hiçbir pickle global/REDUCE/BUILD/NEWOBJ kabul etmez. NumPy object pickle otomatik allowlist'e alınmaz. Gelecekteki tensor loader açık `torch.load(weights_only=True,map_location='cpu')` kullanır; **Torch/model eksik olduğundan bu loader gerçek ağırlık üzerinde çalıştırılmadı**.

[Kaynak/paket/çıktı manifesti](evidence/manifest.json): seçilen tüm wheel boyutları toplam50.914MB; bazıları önbellekten geldi. İki pip geçişi ve küçük metadata/source/HTML için konservatif toplam110MB altı tahmin,500MB indirme sınırının altında; paket düzeyinde boyut kaydıdır, ağ packet ölçümü değildir. İzole dosyalar214,9MB; son boş disk14,31GB,10GB alt sınırının üzerinde. Yeni GPU/ücretli hesap veya arşiv extraction yok.

MimicKit repo Apache2.0 lisanslıdır; XML/source kullanımı kaynak lisans kaydıyla tutulur. Erişilemeyen harici ağırlık/motion arşivine aynı lisans otomatik atfedilmez, dağıtım izni verilmiş sayılmaz. Sonraki somut gereksinim: yazarın erişilebilir, lisansı doğrulanmış **tek spinkick model + motion** dosyası ve hash'i; ardından CPU temas adaptörü, data-only yükleme, aynı observation/action normalizasyonu ve5–10sn gerçek policy rollout. Şu an balancing, combat, learned inference, inference latency ve kalite iddiası yoktur.

## Erişilebilir alternatif: özgün DeepMimic

Yazarın [resmî deposu](https://github.com/xbpeng/DeepMimic/tree/1f915c52fcd4b95b5f5f15b759ae91bd81e9a801), commit `1f915c52fcd4b95b5f5f15b759ae91bd81e9a801`, [MIT lisansı](https://github.com/xbpeng/DeepMimic/blob/1f915c52fcd4b95b5f5f15b759ae91bd81e9a801/LICENSE). İndirmeler yalnız ignored `.tooling/combat-motor-reuse/deepmimic/` altında; model dağıtımı veya uygulamaya ekleme yapılmadı. Toplam **6.263.749byte**,15MB sınırından düşük; tamamı raw GitHub HTTP200, önceki boundedRange denemeleri206. LFS pointer değil gerçek dosyalar.

| Dosya | Boyut | SHA256 |
|---|---:|---|
| `humanoid3d_spinkick.ckpt.data-00000-of-00001` | 6.130.068 | `deae7c33edb66994b67e34d6a73c66f577e3fe2a14c60817992ab42131cd022a` |
| `humanoid3d_spinkick.ckpt.index` | 1.355 | `d14fe2801676d51c423bd8f67e1ed6890f7feeced1054fb0972dce43d845bdd0` |
| `humanoid3d_spinkick.txt` | 72.338 | `e293f84c00e5a3cefaf8e9e9952ac39cfcdc8a9d445b5c1d24c67a271c97d43c` |

[Resmî runargs](https://github.com/xbpeng/DeepMimic/blob/1f915c52fcd4b95b5f5f15b759ae91bd81e9a801/args/run_humanoid3d_spinkick_args.txt) bu checkpoint'i tam bu motion, `humanoid3d.txt`, phase-rot PD controller ve PPO agent ile eşliyor. Motion güvenli JSON parse ile78frame,44değer/frame,wrap ve1,283282sn olarak doğrulandı. `.index` footer gerçek SSTable magic `57fb808b247547db`; yalnız header/printable metadata incelendi. Ağırlıklar deserialise edilmedi, model çalıştırılmadı.

**Doğrudan MimicKit'e takılamaz:** özgün ortam Bullet2.88/TF1.13.1 tabanlı; actor ReLU1024→512, phase input açık,30Hz controller, kaydedilmiş observation/action normalizer'ları var. İncelenen MimicKit config phase input kapalı ve gelecekteki1/2/3 reference pose gözlemleri açık. Beden sırası, yerel dönüşler, PD hedefleri, normalizasyon ve fizik farklılıkları eşleştirilmeden yeniden adlandırmak transfer değildir.

En küçük resmî tensor okuma yolu [tf.train.load_checkpoint](https://www.tensorflow.org/api_docs/python/tf/train/load_checkpoint): `get_variable_to_shape_map()`/`get_tensor()` ile checkpoint verisi okunur; SavedModel/MetaGraph veya custom op yüklemek gerekmez. Bu API **henüz çalıştırılmadı**, TF/PyTorch kurulmadı. Önce hash sabitli reader ortamı ve yalnız sayısal tensor export; ardından kaynakla aynı observation/action hesapları ve motor uyumluluğu testi gerekir. Küçük model dosyası erişim engelini kaldırdı; başarılı CPU neural rollout kanıtı oluşturmadı.
