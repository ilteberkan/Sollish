# Ringside Combat Club — araştırma ve doğrulama

Tarih: **3 Ekim 2026**. Kapsam: ayrı `/lab/ringside/play` yerel antrenman modu,
`sparring-1` motoru ve yeni animasyon paketi. Bu belge karşılaştırma ve uygulama kapsamını açıklar; bağımsız nihai görsel kalite onayı değildir. Mevcut LIVE/Contact v3/önceki SOLO kuralları korunur.

## Referanslar ve gözlemin sınırı

Bu çalışmada referansların yayıncı üzerindeki resmî oyun sayfaları metin olarak
yeniden okundu. Kaynakta yazan davranış, kendi oynama testimizle doğrulanmış
davranıştan ayrıdır. Yeni tarayıcı gözleminde Fight Arena giriş canvas'ına tıklama
3D tutorial salonuna ulaştı; karakter görüldü ve P ile pause menüsü açıldı. İç içe
Unity yüzeyine klavye/fare girdisi güvenilir değildi; maç tamamlanmadı. Kaydedilen
[Fight Arena karesi](../../ops/evidence/ringside-sparring-20261003/reference-fight-arena-tutorial.jpg)
pause menüsünü gösterir, tek başına hareket/temas kanıtı değildir.

Punchers'ta [gerçek 3D animasyonlu menü](../../ops/evidence/ringside-sparring-20261003/reference-punchers-menu.jpg)
görüldü; FIGHT koordinat tıklaması maçı başlatmadı. Durağan ekran görüntüsü animasyonun
zamansal akışını ölçmez. Menü A/D ve A+D superpunch ipucu gösterirken yayıncı aşağıdaki
farklı eşlemeyi listeler; maç içinde bu fark çözümlenmedi. İki oyun da bütünüyle
oynanmış/ölçülmüş sayılmaz. Rakip oyunların kodu, modeli veya animasyonu kopyalanmadı.

| Kaynak | Sayfada doğrulanan kontrol / davranış | Tasarıma çıkarım |
|---|---|---|
| [Fight Arena Online — CrazyGames](https://www.crazygames.com/game/fight-arena-online) | Geliştirici The Money Suitcase. WASD hareket; iki fare düğmesi saldırı; sol Shift yuvarlanma/alttan saldırı; Space sıçrama; T/tilde sohbet. Açıklama koşarken ve havadayken farklı saldırılardan bahseder. | Oyuncu doğrudan mesafe, yön ve saldırı zamanlamasını yönetebilmeli. Yeni modun `dash` davranışı rakibin roll/ledge sisteminin kopyası veya tam karşılığı değildir. |
| [Punchers — CrazyGames](https://www.crazygames.com/game/punchers) | Geliştirici Vardan Aleksanyan. Sol oyuncu WASD + Y/U; sağ oyuncu yön tuşları + numpad1/2. Yayıncı ragdoll, normal/yavaş zaman, dayanıklılık ve saldırı sonrası toparlanma tarif eder. | Temas ve kaçırma okunmalı; saldırı toparlanması ve enerji maliyeti gerçek karar doğurmalı. Bizim modelimiz bu oyunun ragdoll motorunu içermez. |

Bu çıkarımlar ürün hedefidir. Resmî sayfadaki desteklenen platform etiketi bizim
uygulamamızın telefon performansını kanıtlamaz; sayfalardaki puanları veya “gerçekçi”
tanıtım dilini bağımsız kalite ölçümü olarak kullanmıyoruz.

## Yeni oynanabilir mimari

Kaynak girişleri: [`combat-sparring.ts`](../../packages/protocol/src/combat-sparring.ts),
[`sparring-controls.ts`](../../apps/web/lib/sparring-controls.ts),
[`boxing-sparring.tsx`](../../apps/web/components/boxing-sparring.tsx),
[`boxing-sparring-scene.tsx`](../../apps/web/components/boxing-sparring-scene.tsx) ve
[`boxing-sparring-athletes.ts`](../../apps/web/components/boxing-sparring-athletes.ts).

1. **Yerel girdi:** basılı hareket/gard ile tek basış saldırı birbirinden ayrılır.
   UI, insan + bot veya bot + bot seçer. Blur/sekme gizleme kontrolü temizler ve yerel
   antrenmanı duraklatır. Bu davranış shared LIVE saatine veya ledger'ına uygulanmaz.
2. **Oyun motoru:** 60 Hz sabit tick; metre cinsinden konum/yön, sağlık/dayanıklılık,
   startup/active/recovery, sınırlı tampon, kombinasyon, hitstun, kontra ve guardbreak.
   UI oturumu 90 saniye; sıfır sağlık veya süre sonu bitirir, kalan sağlık üstünlüğü
   sonucu verir, eşitlik beraberliktir. Sonuç klip oynatılarak önceden seçilmez.
3. **Temas:** aktif uzvun önceki/yeni noktası ile hareket eden baş/gövde hacimleri
   arasında göreli süpürme; saldırı kimliği başına en fazla bir hasar. Aynı tick'te
   geçerli vuruşlar birlikte çözümlenir. Yönlü gard, stamina ve sıyrılma geometrisi
   sonuçları etkiler. Kök ayırma/ring sınırı ve basitleştirilmiş sıçrama vardır.
4. **Sunum:** Three.js gerçek skinned rig, authored klip harmanlama, procedural
   düzeltmeler, yayın/takip/üst kamera, sağlık/enerji göstergesi ve olay geri bildirimi.
   Render, ses ve kamera motor state'ine veya finansal karara yazmaz.

Motor kinematik bir oyun modeli kullanır; MuJoCo/Bullet solver, eklem torku, ragdoll
veya kendi dengesini öğrenen humanoid değildir. Sabit girdilerin aynı tick sırasında
tekrar işlenmesi test edilebilir; farklı tarayıcı/işlemcilerde bit eşdeğerliği veya
canlı sunucu otoritesi ayrıca kanıtlanmış değildir. Yerel oyun duraklatılabilir ve
yavaş cihazda duvar saati yerine simülasyon zamanı ilerler. Finansal maç değildir.

### Mevcut UI kontrolleri

| İşlev | Klavye / fare | Dokunmatik karşılık |
|---|---|---|
| Hareket | WASD veya yön tuşları; dünya X/Z | Dört yön düğmesi |
| Jab / cross / hook | J / K / L; sol fare jab | İsimli teknik düğmeleri |
| Uppercut / roundhouse | U / R; sağ fare roundhouse | Aparkat / tekme |
| Gard / sıyrılma / dash | G basılı / Q / Shift | Gard tut / sıyrıl / kaçış |
| Sıçrama / duraklat | Space / Escape | Sıçra / duraklat |

Girdi eşlemeleri birim testlerinde; manuel jab/cross kombinasyonu, tekme komutu ve bot maçı gerçek masaüstü tarayıcısında denendi. Dokunmatik boyutlu tarayıcı testleri fiziksel telefon sayılmaz. Bot stilleri dengeli,
baskı ve kontra olarak seçilir; bunlar taktik kurallardır, eğitilmiş model değildir.

## Animasyon ve kaynak ayrımı

| Parça | Gerçek kaynak / yöntem | İddia edilmeyen |
|---|---|---|
| Model, temel jab/cross/hook, hit/death | Mevcut CC0 Quaternius rig/klipleri ve ayrı FightKit görünümü | Yeni AA/AAA insan anatomisi veya yeni mocap |
| Guard idle, defend, dodge, strafe, geri yürüme | CC0 Mesh2Motion; sekiz authored klip, offline retarget | Lisanslı profesyonel combat mocap veya bağımsız fizik |
| Uppercut, roundhouse, sıçrama | Authored taban üzerine procedural eklem/kalça/uzuv katmanı | Pakette var olmayan hazır uppercut/roundhouse/jump klibi |
| Temasa yakın IK ve ayak düzeltmesi | Ölçülü kemik zinciri üzerinde görsel çözüm | Tam ayak kilidi, tüm mesh çarpışması, öğrenilmiş denge |

Mesh2Motion [sabit kaynak commit'i](https://github.com/Mesh2Motion/mesh2motion-app/tree/79f3f61a9852ef70234a5a4a7c13ed87f7a71833),
[doğrudan GLB](https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/79f3f61a9852ef70234a5a4a7c13ed87f7a71833/static/animations/human-addon-animations.glb)
ve [CC0 lisansı](https://github.com/Mesh2Motion/mesh2motion-app/blob/79f3f61a9852ef70234a5a4a7c13ed87f7a71833/LICENSE-CC0.MD)
pinlendi. Ham kaynak 5.292.804 bayt; yayımlanabilir addon 357.712 bayt. Çıktı SHA256:
`8ab9688e12a625ed3d4ec3c7ab752f4f465d90b33d3eef1580b276bc1e3cff39`.

İki rig'in rest rotasyonları/uzunlukları aynı değildir: 66→65 kemik eşleme, `head`
→`Head`, fazladan `head_leaf` çıkarma ve dünya rotasyonunu hedef hiyerarşiye çevirme
uygulandı. Root hareketi çıkarıldı; pelvis yerel Z'deki dikey hareket korundu.
Eski `athlete.glb` değişmedi. [Pipeline, manifest ve testler](../../scripts/boxing-assets/combat-motion-v1.md)
yeniden üretim bilgilerini taşır. Adapter geniş kaynak dodge hareketlerinin üst
gövdesini ayırır; alt gövdeyi yerde tutma ve temasa yaklaşma ayrı görsel kararlardır.

## Kanıt durumu ve kalan sınırlar

[Kaynak/build kimliği ve test logları](../../ops/evidence/ringside-sparring-20261003.json)
ayrı yayın kaydında tutulur. 61 protocol ve 76 web testi, 10 gerçek GLB/Mixer testi,
9 Python asset ve 3 Three.js asset testi geçti. Web typecheck ve OpenNext üretim
derlemesi başarılı. Tarayıcı sayısı ve deployment kimliği yayın kaydında bulunur;
fixture kullanılan LIVE/cüzdan regresyonları gerçek uzak ödeme kanıtı değildir.

İki karakter ve beş teknik için tüm aktif örneklerde serbest uç farkı ölçüldü:
jab yaklaşık 0, cross 6,94 cm, hook 10,85 cm, uppercut 0,27 cm, roundhouse 3,95 cm
maksimum. Bu farklara keyfi bir PASS eşiği atanmadı. Üç mesafede gerçek motorun
ürettiği **28 isabetin tamamında**, render edilen vuran uzvun süpürdüğü hacim ilan
edilen baş/gövde hedefini kesiyor. Bu sonuç üçgen mesh teması veya bedenin hiçbir
yerinde penetrasyon olmadığı anlamına gelmez.

Kamera gerçek FOV/aspect ile beden kutularını sığdırır; 320/390/1440 oranlarında,
zıt köşeler, sıçrama, üç kamera ve kamera geçişleri gerçek Three projeksiyonuyla
sınandı. Pause/reset, odak değişiminde gard bırakma, bozuk asset, WebGL kaybı ve
route cleanup gerçek yerel üretim tarayıcı testlerindedir. Referansların tamamlanmış
oynama testi ve birebir eşdeğerlik doğrulaması halen yoktur.

**Açık kalite işi:** AA karakter ve profesyonel combat mocap; tekniğe özel support-foot
kayması ve tüm beden mesh penetrasyonu; bağımsız dinamik denge; önceki öğrenilmiş
kontrolcüyü bu yeni motorla eğitme/değerlendirme; sürdürülebilir performans ve fiziksel
telefon. İki kısa render sayacı ölçümü terminal/idle süreyi de içerdiği için aktif FPS
kanıtı olarak reddedildi. Aynı screenshot veya test sayısı bu maddeleri kapatmaz.

Eski öğrenme kayıtları, CMU fizik FAIL sonuçları, DeepMimic duyarlılık koşuları ve
frozen canlı motorlar korunur. Bu oynanabilir baseline öğrenilmiş değildir; eğitim
araştırmasının yerine geçmez. Supabase/Cloudflare canlı protokolü, gerçek para,
SOL/token stake/ödül ve dokuz launch gate bu iş ile açılmaz. Genel durum
[`docs/validation.md`](../validation.md) içinde kanıt türleri ayrılarak izlenir.
