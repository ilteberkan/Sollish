# Hazır motor politikası: sınırlı kaynak incelemesi (3 Ekim 2026)

**Sonuç:** sıfırdan PD ayarı yerine hazır imitation motorunu yeniden kullanmak uygun sonraki adımdır. Bu incelemede güvenli, küçük ve doğrudan çalıştırılmış bir boks uzmanı elde edilmiş değildir. Hiçbir model unpickle edilmedi; çok GB arşiv veya yeni GPU hizmeti açılmadı.

## MoCapAct

[Microsoft deposu](https://github.com/microsoft/MoCapAct/tree/58bbb0047942708d20abb4fb191e9771de30ea1e), [resmî model deposu](https://huggingface.co/microsoft/mocapact-models). Kod MIT, model/dataset kartı CDLA-Permissive-2.0. CMU kaynak hareketinin ayrıca koşulları korunmalı.

[all_snippets.txt](https://github.com/microsoft/MoCapAct/blob/58bbb0047942708d20abb4fb191e9771de30ea1e/clip_splits/all_snippets.txt) `CMU_013_18` içermez. Buna karşılık üniversitenin [boks indeksi](https://mocap.cs.cmu.edu/search.php?maincat=4&subcat=8) ile eşleşen **CMU_017_10** için beş eğitim uzmanı listeler: `0-180`, `147-327`, `294-474`, `441-621`, `588-769`. Bu, 13_18 için uzman bulmuş olduğumuz anlamına gelmez.

HF public tree metadatasında `sample/experts.tar.gz` **7.796.985.599 byte**, sekiz full shard **4.595.230.252–18.644.079.469 byte**. Küçük tek-uzman dosyası ayrı listelenmiyor. Bunlar ZIP değil gzip-sıkıştırılmış tar; ZIP central directory yöntemi uygulanamaz. Sınırlı32byte HTTPRange isteği206 ve `Content-Range: bytes 0-31/7796985599` döndürdü; başlangıç magic `1f8b0800`, yani gerçek gzip. Bağımsız seek/gzip indeksi yayımlandığı doğrulanmadı. Model metadatasındaki `multiclip_policy.tar.gz` **107.124.267 byte** daha yönetilebilir; fakat belirli boks uzmanıyla eşdeğer değildir.

[Resmî loader](https://github.com/microsoft/MoCapAct/blob/58bbb0047942708d20abb4fb191e9771de30ea1e/mocapact/sb3/utils.py) normalizer için doğrudan `pickle.load`, ardından Stable-Baselines3 loader kullanır. `requirements.txt` dm_control1.0.7/MuJoCo2.2.2/SB3 1.5.0 sabitler. Bunlar mevcut3.14 deney ortamına körlemesine kurulmadı. Güvenli yeniden kullanım: hash-pinned tekuzman elde edilirse data-only observation stats ve tensor state_dict çıkarımı, eski gözlem/action sırası ve aynı CMU humanoid model doğrulaması, ardından CPU tek-env rollout. Restricted unpickler yalnız açık NumPy veri tiplerini ve inert taşıyıcıyı kabul etmeli; bilinmeyen callable/type otomatik allowlist'e eklenmemeli. Mevcut aşamada böyle bir extractor veya rollout çalıştırılmadı.

## MimicKit / Newton

[Yazarın güncel MimicKit sürümü](https://github.com/xbpeng/MimicKit/tree/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69), README'de hazır `deepmimic_humanoid_spinkick_model.pt` kullanımını gösterir; assets/motions harici SharePoint arşivindedir. Spinkick hazır politika, iki rakip arasında öğrenilmiş düello değildir. Eski [DeepMimic](https://github.com/xbpeng/DeepMimic) kendi README'sinde MimicKit'e yönlendirir.

Pinned [engine_builder.py](https://github.com/xbpeng/MimicKit/blob/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69/mimickit/engines/engine_builder.py) IsaacGym/IsaacLab/Newton seçeneklerini içerir. Ancak **Newton içinden MuJoCo kullanılır**: [newton_engine.py](https://github.com/xbpeng/MimicKit/blob/2ed1e6c093bb0829f55d33cb4f7a1731cfe6cb69/mimickit/engines/newton_engine.py) `SolverMuJoCo` kurar. Dolayısıyla listede MuJoCo adının olmaması CPU ihtimalini dışlamaz.

[Newton SolverMuJoCo belgesi](https://newton-physics.github.io/newton/latest/api/_generated/newton.solvers.SolverMuJoCo.html) `use_mujoco_cpu=True` ile native MuJoCo-C CPU yolunu sunar. MimicKit'in incelenen çağrısı bu parametreyi vermez; default false. [Warp resmî uyumluluk belgesi](https://nvidia.github.io/warp/latest/user_guide/installation.html) Apple Silicon macOS için CPU wheel olduğunu, Metal hızlandırma olmadığını belirtir. Bu bilgiler minimal CPU adaptasyonu için **uygulanabilir aday**dır, test sonucu değildir.

MimicKit motion loader'ı da `pickle.load` kullanır; ağırlık loader'ı açık `weights_only=True` belirtmeyen `torch.load` içerir. Gerekli adım: yalnız dosya provenance/lisans/sha doğrulamasından sonra güvenli veri dönüştürme, sabit PyTorch sürümü ve data-only tensor yükleme, CPU tek ortam/headless/süre/bellek sınırı. Ağırlıkların hedef fizik modelinde başarılı çalışacağı bu incelemede gösterilmedi. 8GB VPS için inference uygunluğu ölçülmedi; eğitimi8GB üzerinde uygun diye ilan etmek yanlış olur.

## Önerilen sınırlandırılmış sonraki deney

Önce MimicKit'in resmî tek karakter + tek spinkick policy + tek motion paketini ayrı küçük dosyalar olarak edinmenin yolu doğrulansın. Arşiv tek büyük paket ise boyut/onay sınırına uyulsun. CPU parametresi isolated fork'ta açık seçilsin; güvenli tensor/stats loader dışında pickle çalıştırılmasın. Bir ortamda10 saniye rollout: düşme, jointlimit, zeminpenetrasyonu, contact-foot slip, inference latency ve model hash kaydedilsin. Kalite iyileşirse yalnız yeni lab viewer'a aktarılabilir; frozen v3 ve para otoritesine otomatik terfi yok.
