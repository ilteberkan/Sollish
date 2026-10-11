# Gerçek dövüş ödülüyle öğrenme — izole CPU deneyi

**Sonraki enerji/çeşitlilik çalışması:** [ENERGY.md](ENERGY.md). Yeni kontrolcü 576 taze testte müdahaleyi%62,17→%8,61 azalttı, teknik ortalamasını2,97→3,60 çıkardı; fakat temiz isabet10,88 <12 nedeniyle toplam kalite FAIL kaldı. Aynı bankada sürekli-kick baseline%99,826, öğrenci%90,799 kazandı: tek-tekme sömürüsü ve genel taktik yeterlilik çözülmedi. Model finalden sonra değiştirilmedi; aşağıdaki ilk başarısız çalışma korunur.

3 Ekim 2026. Bu deney **öğretmen etiketi kullanmadan**, gerçek yerel Contact v3 simülasyonunda eylem seçip oluşan temas/hasar/sonuçtan öğrenir. Kendi geçmiş kontrolcüleri rakip havuzuna girer. Bu, önceki taklit öğrenmesinden farklıdır. Fakat ortaya çıkan aday **ürün kalite kapısını geçmedi**; bütün beyin, bilinç, insan dövüş becerisi veya finansal kullanıma hazır sistem değildir.

## 1. Korunan sınırlar

`packages/protocol/src/combat-v3.ts` ve `connectome-policy.ts` değiştirilmedi. Motor SHA256 `0813ec0765c66ca7344a69bb7e971a089ca7486fee51bd523851695c1c41c3c8`. `environment.mjs` hash uyuşmazlığında durur; yalnız kontrolcü callback'i, karar sayacı ve isteğe bağlı headless kayıt ekleyen bir adaptörü `.tooling/combat-selfplay/` altında derler. Temas, stamina, hasar, rastgele zamanlama veya sonuç kuralları değişmez. Varsayılan adaptör ile gerçek v3'ün iki tam seed kaydı `deepEqual` testini geçmiştir. Bu iki seed parity kanıtıdır; yeni bir canlı motor yayını değildir.

Öğrenciye yalnız mevcut v3'ün 10 sayısal gözlemi verilir; ağırlıklar bir maç sırasında değişmez. Seed/RNG, rakip politika ağırlıkları, bahis, cüzdan, havuz veya kasa verisi verilmez. V3 mesafe/yön açısını her karar anında sağlar; 120° görüş alanı yalnız gözlenen hazırlık/toparlanma alanlarını sınırlar. Bu nedenle eksiksiz fiziksel görüş/örtülme simülasyonu iddia edilmez.

V3 uzaklığı kapatmayı, stamina<210 iken gardı ve uzun süre saldırmayan dövüşçünün saldırmasını **kural olarak zorlar**. Bu davranışlar öğrenilmiş yetenek değildir. El/ayak temasına dayalı mevcut kinematik ortam kullanılır; MuJoCo eklem torku, rigid-body humanoid, klinç veya yeni animasyon öğrenilmedi.

## 2. Gerçek veri, varsayımsal model

Gerçek kaynak [HHMI Janelia MaleCNS v1.0](https://male-cns.janelia.org/download/), **CC BY 4.0**; FlyEM/HHMI Janelia, University of Cambridge, MRC LMB ve Google Research'e atıf. [Önceki veri seçimi](../connectome/LEARNING.md) aynen korunur: Traced descending-neuron adaylarından 128 gerçek bodyId, 4.949 yönlü bağlantı, 108.471 toplam ağırlık. Graf SHA256 `284dca2f166169c47d50a489d96bb011ceab3ae01a73922c2dd4c44da041e37d`; kaynak dosya ve graf ayrı hashlerle kontrol edilir. Yeni veri indirilmedi.

128 durumlu leaky tanh reservoir, pozitif/normalize recurrent ağırlıklar ve rastgele duyusal eşleme **mühendislik varsayımıdır**. Biyolojik zaman sabitleri, gerçek duyusal adaptör veya sinaptik plastisite modeli değildir. Anatomik kenarlar sabit kalır. Sıfırdan rastgele başlatılan 139×8 = **1.112 çıkış ağırlığı** öğrenilir; eski öğreticiyle eğitilmiş readout başlangıç olarak yüklenmez. Sabit v3 modeli yalnız görülmemiş karşılaştırma rakiplerinden biridir.

Tam kaynak grafın indirilmiş olması tam işlevsel beyin üretmez. [Google'ın MaleCNS yazısı](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/) bir anatomik harita sunar. [Flyvis](https://github.com/TuragaLab/flyvis) görsel sistem için bağlantıyla kısıtlanmış ve görevde optimize edilmiş model örneğidir; tüm beynin boks kontrolcüsü değildir. [Flybody](https://github.com/TuragaLab/flybody) MuJoCo sinek bedeni ve hareket öğrenme görevlerini ayrıca kurar; insan bedenine hazır aktarım kanıtı sunmaz. Bu iki kütüphane araştırıldı, bu deneye yüklenmedi veya kodları kopyalanmadı.

## 3. Eğitim ve önceden ayrılmış değerlendirme

[Plan](plan.json), source hashleri ve başlama zamanı ilk final değerlendirmeden önce [run-plan.json](evidence/run-plan.json) dosyasına yazıldı. Yöntem [Salimans ve arkadaşlarının antithetic evolution-strategy yaklaşımından](https://arxiv.org/abs/1703.03864) yararlanır: Gaussian ±parametre pertürbasyonları aynı maç koşullarında sınanır, episode ödülü standartlaştırılır ve Adam ile çıktı parametreleri güncellenir. Backpropagated teacher labels, kazanma sonucu yeniden seçimi veya insan etiketleri yoktur. Geçmiş kontrolcü havuzu, [rekabetçi self-play](https://arxiv.org/abs/1710.03748) yaklaşımının küçük bir örneğidir; o çalışmaların beceri seviyesinin tekrarı değildir.

Her varyant 24 nesil ×12 antithetic yön ×2 işaret ×4 gerçek maç = **2.304 eğitim maçı**. Başlangıç politikası ve her dört nesilde dondurulan öğrenci snapshot'ları rakiptir. Nesiller/seed'ler, rastgelelik, sigma0,08 ve öğrenme oranı0,025 planda sabittir. En iyi checkpoint yalnız sabit doğrulama ödülünden seçilir.

Ödül açıkça: `win/loss + 0.002*(verilen-alınan hasar) + 0.15*normalize eylem entropisi - 0.15*temassız süre/45sn`. Çeşitlilik terimi tasarım tercihidir, doğal biyolojik motivasyon değildir. Parametreler final değerlendirmeden önce dosyaya dondurulur.

Finalde her politika: **16 yeni seed ×2 taraf ×8 rakip =256 maç**. Başlangıç ve sürekli-jab doğrulamada görülmüştür; kick, counter, alternating, turtle, evasive ve frozen-v3 olmak üzere altı rakip tipi eğitim/doğrulamada görülmemiştir. Seed'ler yalnız aynı kuralların zamanlama çeşitliliğini ölçer; yeni beden/fizik/gerçek oyuncu genellemesi değildir. Tek optimizer seed vardır.

## 4. Gerçek sonuç: öğrenme var, ürün kalitesi yok

| Varyant (eşit eğitim bütçesi) | Başlangıç skoru | Öğrenilmiş skor | Eylem entropisi | Dar araştırma kapısı |
|---|---:|---:|---:|---|
| Gerçek altgraf | 0,4727 | 0,9922 | 0,4369 | **FAIL** |
| Hedef uçları karıştırılmış graf | 0,4863 | 0,9844 | 0,4978 | PASS |
| Recurrent bağlantısız kontrol | 0,5039 | 0,9922 | 0,3921 | **FAIL** |

Skor kazanma1/beraberlik0,5/kaybetme0'dır. Gerçek altgrafın verdiği ortalama hasar289,36→673,53, aldığı325,73→312,66; hasar farkı−36,37→+360,88. Fakat saldırılarının **%91,59'u cross**, kararlarının **%52,50'si motor tarafından değiştirilmiş**. Çeşitlilik eşiği0,45'ti ve sonuca bakılarak düşürülmedi. En uzun saldırısız süre2,45sn, temassız süre8,15sn; kaydedilmiş durumlarda ring/enerji sınırı ihlali0. Son iki kontrolün çoğu motorun kurallarına bağlıdır.

Bağlantısız kontrol aynı skoru aldığı için anatomik topoloji üstünlüğü yoktur. Karıştırılmış grafın dar kapıyı geçmesi de ürün yayını izni değildir: kullanılan rakipler zayıf/öngörülebilir, görsel kalite ölçülmedi ve yoğunluğu yüksek tek teknik stratejileri kalıyor. [Ham sonuçlar](evidence/evaluation.json), [seed kümeleriyle analiz](evidence/analysis.json) ve bütün checkpoint'ler saklanır. Bootstrap bir seed'in iki tarafını ve bütün rakiplerini birlikte tutar; 16 küme/tek eğitim seed'i güçlü bilimsel genelleme için yetersizdir.

İlk sonucu gördükten sonra ayrıca yapılan ve model seçimine katılmayan [sömürü teşhisi](evidence/exploit-audit.json) daha kritik bir sınır buldu: **hiç eğitilmemiş sürekli-cross kuralı aynı256 maçta %99,61 kazanırken aday %99,22 kazanıyor**. Yeni32 audit maçında adayın bu basit kurala karşı kazanması yalnız **%31,25**. Dolayısıyla yüksek skor “zeki dövüşçü” göstergesi olamaz; mevcut motor/rakip havuzundaki dar optimumu bulmuştur. Bu teşhis sonradan tasarlandığı için ilk önkayıtlı final test gibi sunulmaz.

## 5. Kaynak kullanımı ve araştırma ekranı

Üç eğitim+değerlendirme toplam **164,97sn**, tepeRSS **271.777.792 bayt (~259MiB)**; Node24.21.0, macOS ARM64 Apple M2, 8GiB RAM. Tek yerel CPU süreci, ücretli GPU/cloud çağrısı yok. Bu ölçüm tam beyin eğitimi veya VPS/Cloudflare kapasite ölçümü değildir.

Model SHA256: `ff0f938d6e7b3061281039cc043454a9be9f35552d9c535c6e11d7ec0f1dfec8`; validation checkpoint8. [Public-safe preview](evidence/preview/manifest.json) üç sabit held-out case'in başlangıç/öğrenilmiş eşlerini sunar. `research:` motor kimliği ve ayrı politika hashleri kullanılır; canlı v3 maç kimliği değildir. Sahne aynı901 kareyi oynatabilir, fakat kayıt yükleme/kamera/FPS sonucu değiştiremez. Ham eğitim trace'leri yalnız deney içindir; public aktarımda `export-preview.mjs` kullanılır. Gerçek para kapısı **CLOSED**, adayın kalite kapısı **FAIL**.

## 6. Sıradaki deney ve çalıştırma

Sonraki adım; sürekli-cross ve daha güçlü cezalandırıcı rakipleri curriculum'a eklemek, yeni seed bölmesiyle saldırı çeşitliliği/temiz isabet/enerji/override ölçülerini birlikte değerlendirmek. Basit rakiplerden yüksek kazanma tek başına yeterli değildir. Fizik değişirse ayrı deney/motor kimliği gerekir; mevcut v3 biletleri ve modeli korunur. Daha sonra insan gövdesi için fiziksel eklem kontrolü ve motion-data uygunluğu ayrıca çalışılabilir; buradaki sekiz hazır hareket seçimi bunu çözmez.

```sh
bash scripts/use-node.sh node --import tsx --test experiments/combat-selfplay/selfplay.test.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/train.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/analyse.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/exploit-audit.mjs
bash scripts/use-node.sh node experiments/combat-selfplay/export-preview.mjs
```

İlk dört test geçti: frozen parity/headless parity/hash reddi, gerçek graf ve bağımsız state, politika→gerçek temas/hasar değişimi, küçük ES koşusuyla gerçek parametre güncellemesi. Yerel test sonucu GitHub CI çalışmış sayılmaz. Eğitim komutu kendi evidence dosyalarını yeniden üretir; önce korunması gereken sonuçlar ayrı arşivlenmelidir.
