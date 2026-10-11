# Ayrı gard geometrisi ve üçüncü öğrenme deneyi

3 Ekim 2026. Frozen canlı v3 kaynakları korunmuştur. Yeni motor kimliği **`research:guarded-contact-1`**; yalnız yerel araştırma ve kayıt oynatımı içindir. Yeni mekanik/öğrenme deneyleri daha önce kabul edilmiş bir bilete uygulanmaz.

## Mekanik teşhis

V3'te eldiven merkezleri yerel±180/y1460/z300, baş merkezi y1670'tir. Örneğin merkezden y1650'de yatay gelen bir eldiven süpürmesi, eski iki gard küresini kaçırırken başa erişebilir. Bu **belirli geometri aralığıdır**; eski gardın bütün saldırıları kaçırdığı iddia edilmez. Düz çizgi örneği ayrı fixture testidir; aşağıdaki sayılar gerçek kapalı döngü motor rolloutu'dur.

Araştırma varyantı eldivenleri±140/y1600/z260'a taşır. Dirsekler omuzdan265mm üst kol,257mm önkol ve90mm eldiven ofsetli iki-link erişimle çözülür. Koruyucu önkol45mm yarıçaplı sonlu kapsül olarak eklenir. Hareket eden eldiven/ayak için kapsülün ilk kesişimi hesaplanır; uç küreler ve başlangıç örtüşmesi dahildir. Bir saldırı en fazla bir blok/isabet üretir.

Jab sırasında yalnız sağ, cross/hook sırasında yalnız sol el+önkol koruyucudur. Tekme/gard sırasında iki taraf korur. Vuruş yapan uzuv kendi saldırı penceresinde kalkan sayılmaz. Kalkanlara temas mevcut chip-damage kuralını kullanır. Tam üst kol/gövde rigid-body fiziği veya eklem-tork kontrolü eklenmedi.

Üç eşleşme ×8 aynı seed ×2 taraf ×eski/yeni ortam =**96 gerçek rollout**. [Teşhis kaydı](evidence/guarded-contact-1/diagnostic.json):

| Saldırgan/rakip (her ortam16 maç) | Eski blok → yeni blok | Eski temiz hit → yeni temiz hit | Ortalama verilen hasar |
|---|---:|---:|---:|
| Sürekli cross /gard | 319 →415 | 193 →97 | 429,56 →279,56 |
| Sürekli cross /counter | 216 →355 | 246 →107 | 498,56 →282,69 |
| Sürekli kick /gard | 74 →109 | 302 →302 | 561,25 →567,81 |

Gard yüksek saldırıların bir bölümünü engellerken gövde/bacak tekmelerini yok etmiyor. Bunun geniş oyun dengesi açısından yeterli olduğu sonucu çıkarılmaz. Gard etkisi ile nöro-kontrol etkisi ayrı ölçülmüştür.

## Yeni ortamda gerçek yeniden eğitim

[Önkayıt](guarded-plan.json), hash-pinned ortam ve [çalışma kaydı](evidence/guarded-contact-1/run-plan.json) korunur. İkinci curriculum modelinden başlanır; yeni seed alanlarında **20 nesil ×15 antithetic yön ×2 işaret ×6 maç =3.600** gerçek ödül maçı oynanır. Önceki model, sabit/punisher/counter/karma rakipler ve geçmiş yeni öğrenci snapshot'ları kullanılır. Reward ve kalite eşikleri ikinci deneyden gevşetilmedi. Validation son nesil20'yi seçti; final120000–120015 seed'leri model seçimine katılmadı.

Karşılaştırma **aynı yeni gard ortamında** önceki öğrenilmiş model ve yeni aday arasındadır; eski fizik sonucu ile yeni fizik sonucu tek başarı farkı gibi karşılaştırılmaz. Her model256 final maç oynadı.

| Ölçüm | Önceki curriculum modeli | Yeni gard ortamında eğitilen |
|---|---:|---:|
| Skor (kazanma1/beraberlik0,5) | 0,3340 | 0,9961 |
| Kazanma | %20,31 | %99,61 |
| Verilen/alınan hasar | 160,55 /169,38 | 489,21 /202,99 |
| Temiz isabet/maç | 1,40 | 15,34 |
| En az iki kez kullanılan saldırı tekniği/maç | 1,000 | 2,898 |
| En az üç teknik kullanılan maç | %0 | %88,67 |
| Motor tarafından değiştirilen karar | %52,63 | %64,21 |
| Yetersiz stamina ile saldırı önerisi/maç | 4,47 | 18,33 |

**Kalite kapısı yine FAIL**: teknik ortalaması2,898, hedef3'ün altında; override%64,21, hedef%25'in üzerinde. Yeni aday gövde tekmelerini ve diğer saldırıları daha çok kullanarak yeni çevreye uyum sağladı, fakat gard/enerji yönetimini öğrenmedi. Guard kararlarının önemli kısmı motorun zorunlu düzeltmesidir. Yüksek kazanma oranı güçlü genel zekâ, gerçekçi teknik veya biyolojik beyin iddiası değildir. Başarısız eşikler ve önceki iki koşu saklandı.

Eğitim69,56sn, tüm koşu89,42sn, tepeRSS301.006.848bayt (~287MiB); Node24.21/AppleM2 CPU. Canlı/provider/ağ çağrısı veya finansal işlem yoktur. Tek optimizer seed ve küçük scripted rakipler araştırma kapsamını sınırlar.

## Kimlik ve yeniden üretim

- Base v3 SHA256: `0813ec0765c66ca7344a69bb7e971a089ca7486fee51bd523851695c1c41c3c8`.
- Research source SHA256: `8e762fe950cf3d2c34a103ab10747af0d64fa4176335914f52d4073299e15488`.
- Derlenmiş adaptör SHA256: `044bd7838415c8d04f50b24d3525b72812a12629bceb502dd754608890e76fa1`.
- Yeni model SHA256: `5fa409248676cefbc20275700922f7dcc171c24236e8b9683131ce842c0f3b54`.

Bu ilk loader'ın source fingerprint'i çözümlenmiş yerel import yolunu da içerir. Kaydedilen ortam bu checkout'a bağlıdır; farklı kökte yeniden eğitim yeni bir provenance kaydı gerektirir. Fizik/modelin farklı platformlarda bit düzeyinde aynı olacağı iddia edilmez. Public kayıtlar bağımsız SHA256 ile sabitlenmiştir ve çalışma zamanında yeniden eğitim yapmaz.

[Preview manifesti](evidence/guarded-contact-1/preview/manifest.json), önceden belirlenen ilk üç final seed'in before/after eşlerini verir. Her kayıtta901 kare vardır; hepsi `research:` kimliği taşır. Before aday **zaten eğitilmiş ikinci curriculum modelidir**, rastgele/eğitimsiz kontrolcü değildir. Kayıtlar başarılara göre seçilmedi. `/lab/ringside` sunumu başka bir katmandır; bu rapor render/FPS veya hosted dağıtım kanıtı değildir.

```sh
bash scripts/use-node.sh node --import tsx --test experiments/combat-selfplay/*.test.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/guard-diagnostic.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/guarded-training.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/export-guarded-preview.mjs
```

**15 yerel test geçti**: önceki parity/öğrenme/seed/hash kontrolleri; sonlu kapsül ve iki-link erişimi; vuran kolun kalkan olmaması; belirli eski gard boşluğu; gerçek blok/hasar değişimi ve tekme geçişi;18 public trace'in hash/901-kare/olay→sağlık tutarlılığı; baseline etiketleri ve başarısız gate'lerin korunması. Bağımsız salt okunur incelemede kapsül/uzuv dışlama/yeni motor kimliği için somut blocker bulunmadı; bu tam fizik veya model denetimi değildir. GitHub CI, mainnet veya finansal açılış iddiası yoktur.
