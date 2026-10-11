# MaleCNS altgrafı üzerinde gerçek taklit öğrenmesi

3 Ekim 2026, İstanbul. Bu deney gerçekten eğitilmiş bir **çıkış kontrolcüsü** üretir: gerçek anatomiden türetilen 128 düğümlü bağlantı ağı sabittir; iki katmanlı çıkış ağırlıkları etiketli örneklerden optimize edilir. Bütün sinek beyni, biyolojik sinir dinamiği, kendi kendine dövüş öğrenmesi veya bilinç değildir. Kazanan/ödeme verisi model girdisi değildir.

## Veri ve bilimsel seçim

[MaleCNS v1.0, CC BY 4.0](https://male-cns.janelia.org/download/); FlyEM/HHMI Janelia, University of Cambridge, MRC LMB ve Google Research'e atıf. [Cell çalışması](https://doi.org/10.1016/j.cell.2026.08.015) için önceki erişim sınırlaması devam eder. İlk tam dosya [raporu](evidence/malecns-inspection.json) ve kaynak hash'leri korunmuştur.

`extract_subgraph.py` yalnız `status == 'Traced' AND superclass == 'descending_neuron'` olan 1.314 kayıt seçer. Tam 151.856.684 kaynak satırında bu adaylar arasındaki 75.273 yönlü bağlantıyı bulur; tekrarlanan çiftleri tamsayı toplamıyla birleştirir (bu veride tekrar yoktu). Aday kümesindeki gelen+giden sinaps ağırlığına göre ilk 128 düğümü seçer; eşitlikte küçük `bodyId` önce gelir. Sonra bu düğümler arasındaki **bütün** bağlantıları tutar; yapay kenar eklemez, öz bağlantıları silmez.

[Seçilen veri](evidence/descending-128.json): **128 düğüm, 4.949 yönlü kenar, 108.471 toplam sinaps ağırlığı**. Gerçek `bodyId`/hücre tipleri ve tam sayı kenar ağırlıkları dosyada bulunur. Graf SHA256: `284dca2f166169c47d50a489d96bb011ceab3ae01a73922c2dd4c44da041e37d`. Seçim motor komutlarına ilişkin anatomik sınıfı kullanır; bu düğümlerin insan boks hareketleri için doğrulanmış devre olduğu iddiasını taşımaz. Yüksek derece seçimi ayrıca örnekleme yanlılığı yaratır; rastgele bir beyin örneklemi değildir.

## Tam olarak ne öğrenildi?

Sabit ağ durumu 128 float64 değerdir:

`h_next = 0.65*h + 0.35*tanh(W_input*[1, observation] + W_graph*h)`

Her hedef düğümün toplam gelen ağırlığı 0,8'e normalize edilir. Kaynak anatomik ağırlıklar ayrı dosyada kayıpsız saklanır; bu normalizasyon bir mühendislik varsayımıdır. Nörotransmiterden doğrulanmamış uyarıcı/engelleyici işaret çıkarılmaz: bütün recurrent kenarlar pozitiftir. 128×11 giriş projeksiyonu sabit rastgeledir; gerçek duyusal reseptör haritası değildir. Bu normalize matrisin maksimum satır toplamı ve tanh, sabit girişlerde bounded recurrent durum sağlar; biyolojik zaman sabitlerini doğrulamaz.

Öğrenilen kısım `[1, observation, h_next]` girdili **139→32 ReLU→8** çıkış ağıdır: 4.744 parametre, sınıf ağırlıklı cross-entropy ve Adam, en fazla 80 epoch. Epoch yalnız doğrulama kümesinin macro-F1 değerine göre seçilir. Ağın kenarları ve giriş projeksiyonu eğitilmez. Bu ayrım [reservoir/echo-state yönteminin](https://mantas.info/get-publication/?f=Practical_ESN.pdf) genel yaklaşımına uygundur; kaynak örnek kodu kopyalanmadı. NumPy'nin pinli CPU matris işlemleri kullanıldı.

On girdi, kendi bakış açısından normalize `[-1,1]` değerlerdir: mesafe, kendi stamina/health, gözlenen rakip windup/recovery, ipe yakınlık, göreli yanal hareket, gözlenen son yüksek/alçak saldırı ve son saldırıdan geçen süre. Eylemler sabit sırayla `advance, circle, guard, slip, jab, cross, hook, kick`. Bahis, bakiye, kasa kârı, oturum kimliği veya gelecek seed yoktur. Sunucu görünürlük/FOV sınırını ve eylem geçerliliğini ayrıca uygular.

Eğitim görevi **sentetiktir**: şeffaf kural öğretmeni sınırlı gözlemlerle mesafeyi kapatma, savunma, ipten uzaklaşma ve saldırı seçimi üretir. Gözlenen windup sonrasındaki iki adımın savunma etiketi geçmiş gözlemler gerektirir. Rastgele üretilen diziler fizik motoru rolloutu veya hayvan kaydı değildir. Gerçek dövüşte kazanma oranı bu testten çıkarılamaz.

## Önceden ayrılmış değerlendirme ve başarısız deneme

- Eğitim: 128 bölüm ×80 adım, seed1000–1127. Doğrulama: 32 bölüm, seed2000–2031. Bölümler arasında recurrent durum sıfırlanır.
- İlk ridge çıkış eğitimi seed3000–3063 üzerinde %68,59 doğruluk /0,605 macro-F1 aldı ve eşikleri **geçemedi**. [Başarısız sonuç](evidence/policy-evaluation.json), model ve kaynak kodu saklandı.
- İkinci deneyde yalnız çıkış sınıfı değiştirildi; yeni, önceden kullanılmamış son test seed4000–4063 (64 bölüm, 5.120 adım) kullanıldı. Test sonucuna göre epoch veya model seed'i seçilmedi. Yayımlanan seed11 önceden belirlendi; seed23 ve47 duyarlılık kontrolüdür.
- Eşikler değişmedi: seçili model doğruluğu≥%75, macro-F1≥0,65, her eylemin recall değeri≥%35. Yeni model bunları geçti. Bu eşikler sentetik karar görevinin aday kapısıdır; canlı dövüş veya finansal uygunluk kapısı değildir.

| Kontrol | Üç seed ortalama doğruluk | Üç seed ortalama macro-F1 |
|---|---:|---:|
| Gerçek altgraf + öğrenilen çıkış | %86,76 | 0,8511 |
| Hedef uçları karıştırılmış bağlantılar + aynı çıkış kapasitesi | %86,71 | 0,8514 |
| Recurrent bağlantı/bellek olmadan aynı 128 giriş birimi + aynı çıkış kapasitesi | %85,76 | 0,8128 |
| Yalnız güncel 10 gözlemli küçük MLP, tek seed | %86,13 | 0,8182 |

Karıştırılmış kontrol, kaynak uçları ve hedef derece adetlerini korur; hedef eşleşmelerini permüte edip yeniden normalize eder. Tekrarlı çift oluşturabilir ve ağırlıklı dereceyi aynen korumaz; bunlar kontrolün sınırlarıdır. Küçük MLP 616 parametrelidir ve parametre eşitliği kontrolü değildir. Aynı 4.744 parametreli diğer iki kontrol kapasiteyi eşler. Anatomik topolojinin karıştırılmış bağlantılardan üstün olduğu **gösterilmedi**; karşılaştırma bunu desteklemiyor.

Seçilen model: **%86,66 doğruluk, 0,8501 macro-F1**; en düşük eylem recall'ı %73,25. Bölüm bazlı 1.000 bootstrap örneklemiyle doğruluk aralığı %85,33–87,83; aynı görev üreticisinin belirsizliğidir, gerçek dövüşe aktarım aralığı değildir. Tam confusion matrix/seed/epoch kayıtları [rapordadır](evidence/policy-mlp-evaluation.json). Model SHA256: `f8cd1d1feb8cf62f39eb2f1b11ebf95728deb8990f83594230d15709d2d9db9e`.

## CPU kullanımı ve entegrasyon sınırı

Üç model türü ×üç seed ve küçük MLP eğitimi yerel Apple M2/NumPy2.5.3/Python3.13.7 üzerinde **9,738 saniye**, yaklaşık **109 MB** tepe süreç RSS kullandı. Bu küçük deney 8 GB sınıfı bellek bütçesine sığar; tam beyin eğitiminin sığdığı sonucu çıkmaz. GPU, ücretli sağlayıcı veya cloud eğitim başlatılmadı.

`packages/protocol/src/connectome-policy.ts` bağımsız, üretilmiş CPU inference modülüdür. `createPolicyState()` her dövüşçü için ayrı durum üretir; `chooseCombatAction(inputs,state)` yalnız verilen durumu ilerletir. `evaluateCombatPolicy` ayrıca **olasılık/odds olmayan** logits döndürür. Ağ çağrısı/saat/RNG yoktur. Eylem maskesi, stamina, mesafe, çarpışma, hasar, para ve maç sonucu modelin dışında kalır. Recurrent adım fiziksel milisaniye olarak kalibre edilmediğinden entegrasyon sabit gözlem ritmi ve maç başına reset kullanmalıdır.

20 ardışık Python↔TypeScript adımında durum/logit/eylem eşleşmesi test edildi (sayı toleransları 1e-10/1e-8). Farklı makinelerde bit eşitliği iddia edilmez. Invalid input/state değişiklikten önce reddedilir; 2.400 aşırı girdi adımı finite/sınır testini geçti. [Yerel Node24.21 ölçümü](evidence/policy-runtime.json): 1.000 warmup sonrası 10.000 çağrıda p95 **0,02125 ms**, p99 0,02529 ms. Cloudflare, telefon veya tüm dövüş süre ölçümü değildir.

Önceki SOLO/v2 kuralları değişmedi. Bu modül yeni demo için adaydır; bütünüyle entegre edilmiş yeni motorun closed-loop davranışı, fizik ve sunucu yayını başka kanıt ister. Gerçek varlık kapıları kapalıdır; bu rapor onları açmaz. Ürün lisans incelemesi/atıflar ayrıca korunur.

## Tekrar çalıştırma

```sh
.tooling/connectome/venv/bin/pip install --require-hashes --only-binary=:all: --no-deps \
  -r experiments/connectome/requirements-learning-macos-arm64-py313.txt
.tooling/connectome/venv/bin/python experiments/connectome/extract_subgraph.py \
  .tooling/connectome/malecns-v1.0 experiments/connectome/evidence/descending-128.json
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 .tooling/connectome/venv/bin/python \
  experiments/connectome/train_nonlinear_policy.py experiments/connectome/evidence/descending-128.json experiments/connectome/evidence
python3 experiments/connectome/export_policy.py experiments/connectome/evidence/policy-mlp-model.json \
  experiments/connectome/evidence/policy-mlp-evaluation.json packages/protocol/src/connectome-policy.ts
.tooling/connectome/venv/bin/python -m unittest discover -s experiments/connectome -p 'test_*.py' -v
bash scripts/use-node.sh node --import tsx --test packages/protocol/test/connectome-policy.test.ts
bash scripts/use-node.sh node --import tsx experiments/connectome/benchmark-policy.ts
```

İsteğe bağlı ortamda **29 Python testi +4 TypeScript testi geçti**; protocol typecheck geçti. Standart kütüphane ortamında NumPy/PyArrow gerektiren 9 test açıkça atlanır, 20 test çalışır. CI'ın çalıştığı veya gelecekte aynı donanım dışındaki sayısal çıktının bit eşit olacağı iddia edilmez. Ham 1 GB veri yalnız önbellekte kalır; testler yeniden indirmez.
