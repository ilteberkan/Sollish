# Connectome araştırması ve çevrimdışı veri doğrulama

İlk veri incelemesi: 2 Ekim 2026 (İstanbul). **Gerçek MaleCNS v1.0 bağlantı dosyası indirildi ve tamamı parça parça okundu.** 3 Ekim'de ayrı bir [gerçek öğrenme deneyi](LEARNING.md) eklendi: 128 gerçek nöronun sabit bağlantı yapısı üzerinde, sentetik öğretmen kararlarını taklit eden çıkış katmanı eğitildi ve kontrol modelleriyle ölçüldü. Tam biyolojik beyin, bilinç veya finansal entegrasyon iddiası yoktur. Aşağıdaki tam dosya taraması eğitimden önceki aşamanın kaydıdır. `fixtures/` altındaki dört düğüm tamamen uydurma test verisidir; gerçek veriyle karıştırılmaz.

## Kullanıcının verdiği dört kaynak

- [Google Research, 3 Eylül 2026](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/): erkek sineğin beyin, optik lob ve ventral sinir kordonunu kapsayan harita; 166 binden fazla nöron ve yaklaşık 125 milyon sinaptik bağlantı bildiriliyor. Bu anatomik rekonstrüksiyon, eğitilmiş davranış modeli değildir.
- [Cell makalesi, S0092867426009426](https://linkinghub.elsevier.com/retrieve/pii/S0092867426009426), DOI [10.1016/j.cell.2026.08.015](https://doi.org/10.1016/j.cell.2026.08.015): yayın bağlantısı Google/Janelia üzerinden doğrulandı; Elsevier/Cell tam metnine bu oturumda erişilemedi (403). Tam metin okunmuş gibi yöntem veya parametre atfedilmedi.
- [Codex FAFB](https://codex.flywire.ai/?dataset=fafb): dişi yetişkin beyin, v783; açık giriş sayfası 139.255 nöron/3.732.460 bağlantı gösteriyordu. Etkileşimli sorgular için Google oturumu açılmadı.
- [Codex MCNS](https://codex.flywire.ai/?dataset=mcns): erkek beyin ve sinir kordonu, v1.0; giriş sayfası 166.700 nöron/6.242.118 bağlantı gösteriyordu. Bu sayılar indirilen ham segment grafiğinin satır sayısı değildir.

[Codex FAQ](https://codex.flywire.ai/faq), sürüm/filtre ayrımını ve MCNS için asıl kaynak projenin toplu indirmelerini kullanmayı açıklıyor. FAFB/MCNS görünümündeki varsayılan bağlantı eşiği beş sinapstır; anatomik sinaps sayısı, yönlü hücre çifti sayısı ve filtrelenmiş tablo satırı aynı birim değildir. FAFB yalnız beyindir; güncel BANC/MCNS sinir kordonu da içerir. Nörotransmiter tahminleri kesin deneysel işaret etiketi sayılmaz.

## Lisans ve köken

Önerilen araştırma girdisi **MaleCNS v1.0**: [Janelia indirme sayfası](https://male-cns.janelia.org/download/) veriyi [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) olarak yayımlıyor. Atıf: FlyEM/HHMI Janelia, University of Cambridge, MRC Laboratory of Molecular Biology ve Google Research; yukarıdaki Cell makalesi. Araçlarımız veriyi analiz eder; kaynak dosyaları değiştirmez. Atıf/değişiklik bildirimi dahil ürünün tamamına ilişkin hak incelemesi henüz tamamlanmadığı için `commercial_permission` ürün kapısı açık bırakılır; bu, CC BY'nin ticari kullanımı yasakladığı anlamına gelmez.

[FlyWire kullanım ilkeleri](https://flywire.ai/guidelines) FAFB açık veri sürümünü **CC BY-NC 4.0** olarak belirtir. Makalenin farklı lisansı veri lisansını değiştirmez. FAFB verisini ticari oyuna taşımak için ayrıca uygun izin gerekir; MaleCNS'nin lisansını FAFB'ye uygulamayız.

Kök kaynak Janelia'nın yönlendirdiği `storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/` dizinidir. Yerel SHA256, resmi HTTPS indirmesinden hesaplandı; imzalı upstream checksum doğrulaması olduğu iddia edilmez. Ham dosyalar Git'e eklenmeyen `.tooling/connectome/malecns-v1.0/` önbelleğindedir. EM görüntüleri, iskeletler, 12,7 GB sinaps noktaları ve 6,8 GB sinaps partner dosyası indirilmedi.

## Gerçekte doğrulanan veri

[İndirme kaydı](evidence/malecns-downloads.json), [tam dosya taraması](evidence/malecns-inspection.json).

| Dosya | Bayt | Okunan satır | Anlam |
|---|---:|---:|---|
| body-annotations | 14.483.314 | 211.577 | `bodyId` benzersiz; glia, orphan ve diğer durumlar da bulunur |
| body-neurotransmitters | 43.282.834 | 1.835.518 | Tahmin/etiket tablosu; satır sayısı tamamlanmış nöron sayısı değildir |
| connectome-weights | 1.051.241.946 | 151.856.684 | Tüm bağlantılı segmentlerin `body_pre,body_post,weight` int64 tablosu |

Tam bağlantı dosyası 87,909 saniyede, tek denemede indirildi. SHA256: `e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1`. 2.318 kayıt parçasının tamamı okundu; tam sayı ağırlıklarının toplamı 311.833.243, aralığı 1–2.591; 123 satır öz bağlantıdır. Bu ham toplamın yaklaşık 125 milyonluk nöronlar arası yayın sayısıyla aynı olması beklenmez.

Yalnız iki ucu da `annotations.status == 'Traced'` olan görünümde 165.122 uygun anotasyon kimliği, 25.563.197 bağlantı satırı ve 124.025.046 toplam ağırlık var; ağırlık eşiği uygulanmadı. Bu somut filtre **Codex'in 166.700 nöron kümesini yeniden ürettiği iddiasını taşımaz**. İzole düğüm sayısı, tüm ham grafiğin benzersiz segment sayısı ve yinelenen yönlü çift sayısı ölçülmedi. Kaynak satırları silinmedi/toplanmadı; CSR üretildiği iddia edilmez.

Tam tarama yerel ARM64 macOS/Python 3.13.7/PyArrow 25.0.1 üzerinde 14,317 saniye sürdü; süreç tepe RSS 844.038.144 bayt. Bu eğitim veya gerçek zamanlı çıkarım ölçümü değildir. Tablo açıldığında 3.644.560.416 bayt int64 değer içerir; parça işleme bunu bir defada RAM'e yüklemez. 166.700² float32 yoğun matris yaklaşık 111 GB gerektirirdi; yoğun matris oluşturulmadı.

## Araçlar ve tekrar çalıştırma

`validate_dataset.py`, bağımlılıksız küçük CSV altgraf manifestini denetler: sürüm/lisans/köken, SHA256, kesin u64 kimlikler, tam sayı ağırlıklar, uç üyeliği, yinelenen çiftler, sınırlar ve göreli dosya yolları. Sınırları 5.000 düğüm/100.000 kenar/16 MiB dosyadır; tam grafiği bu araca sıkıştırmayız. Çıktıdaki başarı, ürün/lisans/biyoloji onayı değildir.

```sh
python3 experiments/connectome/validate_dataset.py experiments/connectome/fixtures/manifest.json
python3 -m unittest discover -s experiments/connectome -p 'test_*.py' -v
```

`inspect_malecns.py` ayrı, çevrimdışı tam dosya okuyucusudur: üç kaynağın pinli hash'ini Arrow ayrıştırmasından önce doğrular, özgün kimlik/ağırlıkları float'a dönüştürmeden her parçayı işler. Ağ çağrısı yapmaz, indirilen dosyalara yazmaz. Hash pinleri yeniden indirme sırasında sessizce güncellenmez. Yerel güvenilir cache içindir; genel amaçlı düşmanca Arrow sandbox'ı değildir.

```sh
# İsteğe bağlı; bu kilit yalnız CPython 3.13 / macOS ARM64 wheel'i içindir.
python3 -m venv .tooling/connectome/venv
.tooling/connectome/venv/bin/pip install --require-hashes --only-binary=:all: --no-deps \
  -r experiments/connectome/requirements-inspection-macos-arm64-py313.txt
.tooling/connectome/venv/bin/python experiments/connectome/inspect_malecns.py \
  .tooling/connectome/malecns-v1.0
.tooling/connectome/venv/bin/python -m unittest discover -s experiments/connectome -p 'test_*.py' -v
```

Doğrulama: 17 standart kütüphane testi geçti; isteğe bağlı PyArrow ortamında ek 6 testle **23/23 geçti**. Temiz standart Python ortamında bu 6 test açıkça atlanır. Testler yalnız küçük sentetik dosyalar oluşturur; CI 1 GB veri indirmez. Bozuk hash/şema, null veya negatif ağırlık, yanlış kimlik, gizli fixture etiketi, lisans değiştirme ve yol kaçışı reddedilir.

## Haritadan öğrenen kontrole geçiş

Bağlantı haritası kimin kime kaç anatomik temasla bağlandığını verir. Hücrenin anlık elektrik durumu, kesin iletkenlikler, reseptörler, gecikmeler, plastisite kuralları veya boks eylemlerine hazır bir çıkış sözlüğü sağlamaz. Sinaps sayısı doğrudan kalibre edilmiş öğrenilmiş ağırlık değildir. İki kollu bir boks karakterine sinek devresi eşlemek ayrıca bizim modelleme tercihimiz olur.

- [NeuroMechFly/FlyGym](https://neuromechfly.org/) beden, duyular ve beyin–motor kontrol arayüzünü sağlar; [2024 makalesi](https://www.nature.com/articles/s41592-024-02497-y) bu deney yaklaşımını açıklar. [Güncel değişiklik günlüğü](https://neuromechfly.org/changelog/) 2026 v2 dönüşümünü kaydeder; eski örneklerin çalıştığı varsayılmaz. [Kod Apache 2.0](https://github.com/NeLy-EPFL/flygym/blob/main/LICENSE).
- [flybody](https://github.com/TuragaLab/flybody), [2025 Nature çalışması](https://www.nature.com/articles/s41586-025-09029-4), çok eklemli sinek bedenini öğrenilmiş yürüyüş/uçuşla kontrol eder. Bu model bütün connectome'un doğrudan çalıştırılması değildir. Çalışmanın eğitim ölçeği yürüyüş için yaklaşık 10⁹, uçuş için 10⁸ simülasyon adımıdır; yerel M2/VPS maliyetini bundan çıkaramayız. [Lisans Apache 2.0](https://github.com/TuragaLab/flybody/blob/main/LICENSE).
- [Shiu ve arkadaşları, 2024](https://www.nature.com/articles/s41586-024-07763-9) ve [resmî kod](https://github.com/philshiu/Drosophila_brain_model), anatomiyi LIF modeliyle sınamanın örneğidir; öğretilmiş dövüş veya bilinç kanıtı değildir. [FlyVis](https://github.com/TuragaLab/flyvis) görsel devre kısıtlarıyla görev eğitimi için daha dar bir örnektir.
- [MuJoCo](https://github.com/google-deepmind/mujoco/blob/main/LICENSE) Apache 2.0'dır. [Tekrar üretilebilirlik açıklaması](https://github.com/google-deepmind/mujoco/blob/main/doc/computation/index.rst) aynı sürüm/mimari ve tam entegrasyon durumunu gerektirir; cihazlar veya sürümler arası bit eşitliği varsayılmaz.

Önerilen sıralama:

1. Sürüm/hash pinli kaynak → bilimsel seçim kuralı açık nöron kümesi → sparse yönlü graf. Tam ham segment grafiği kaynak olarak korunur; yeni filtre ayrı türetilmiş sürümdür.
2. Sabit gözlem şeması → graph-mask'li recurrent/LIF aday model → sınırlandırılmış eylem başlığı → fizik. Uyarıcı/engelleyici işaretler ve zaman sabitleri varsayım olarak sürümlenir; eksik biyolojik parametreler uydurulmuş gerçekler diye sunulmaz.
3. Finans dışı çevrimdışı eğitim; eşit parametre bütçeli MLP, karıştırılmış graf ve sabit kurallı kontrolcüyle karşılaştırma. En az üç eğitim seed'i; ayrı değerlendirme seed'leri/rakipler; kazanma, hareket geçerliliği, enerji, NaN ve p95 adım gecikmesi ölçülür. Sonuçlar aralıklarla raporlanır; başarılı tek koşu seçilmez.
4. Model/engine/gözlem/eylem sürümü, ağırlık hash'i ve replay kaydı sabitlenmeden UI'ya “öğrenen model” etiketi verilmez. Eğitim worker/DO içinde yapılmaz; küçük sabit modelin CPU çıkarımı ancak ölçümden sonra sunulur. 3 Ekim'deki CPU taklit öğrenmesi ve çıkarım ölçümü [ayrı kayıttadır](LEARNING.md); GPU eğitimi, FlyGym kurulumu veya ücretli hizmet harcaması yoktur.

## Ringside ve bahis sınırı

Mevcut rastgele belirlenen ikili kazananı yalnız animasyonla canlandıran deneyimde öğrenen politika gerçek kazananı belirlemiş olmaz. Öğrenen iki ajanın fizik sonucunu belirlediği demo ayrı bir mod olmalıdır. Paylaşılan sohbet veya paylaşılan yayın tek başına ortak finansal maç protokolü oluşturmaz.

Gelecekte finansal mod düşünülürse model/engine/kurallar bahis açılmadan pinlenmeli, kabul penceresi kapanmadan sonuç/seed açıklanmamalı, sonradan yeniden seed/sonuç seçimi yapılamamalı ve tekrar oynatılabilir yürütme kanıtı gerekir. VRF tek başına fizik yürütmesini veya operatörün sonucu saklamamasını ispatlamaz. Güçleri farklı iki ajan için %50 varsayımı geçersizdir: 1,96x brüt ödeme ve %60 kazanma olasılığı, ilgili tarafta beklenen house edge'i −%17,6 yapar. Mevcut Coinflip ekonomisi doğrudan taşınamaz.

**Açık kapılar:** tam beyin/beden eşleme ve kalibre sinir dinamiği, bağımsız gerçek dövüş öğrenme değerlendirmesi, ürün hak incelemesi, hedef sunucu/cihaz performansı ve ayrı finansal protokol. Küçük altgraf, taklit öğrenmesi ve yerel çıkarım için tamamlanan sınırlar [öğrenme raporunda](LEARNING.md) belirtilir. Hiçbir test bilinç veya biyolojik bütünlük doğrulaması değildir.
