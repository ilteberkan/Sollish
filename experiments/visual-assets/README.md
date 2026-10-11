# Fightkit v1 — ayrı, doğrulanmış kıyafet adayı

`output/athlete-fightkit-v1.glb`, mevcut Quaternius anatomisini ve animasyonlarını korur; yeni bir anatomik insan modeli değildir. Üretimdeki `athlete.glb` değişmez. Yeni GLB 12.34 MB; daha büyük dosya ve GPU maliyeti nedeniyle otomatik olarak mobil/üretim sürümüne geçirilmemelidir.

Yeni parçalar: düşük yakalı singlet ve kenar şeritleri, daha açık şort paçası, yan paneller, paça/kemer şeritleri, deri baş koruyucu, kulak dolgusu, eldiven/manşet, bot burnu ve üç boyutlu bağcık. Kıyafetler orijinal insan yüzeyinin interpolasyonlu skin ağırlıklarını; sert koruyucular ilgili kemik bağını kullanır. Kumaş fizik simülasyonu, taranmış kıyafet, motion capture veya AA kalite sertifikası iddia edilmez. Çıplak anatomiyi üreten ilk model ve klipler yeniden kullanılmıştır; kıyafet ve ekipman geometrisi bu deneyde yazılmıştır.

## Kaynak kararı

| Seçenek | Resmi koşul ve değerlendirme | Bu adayda durum |
| --- | --- | --- |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | CC0 karakter, rig ve haritalar. Mevcut kaynak gerçek 65 kemikli modeldir. | Pinli mevcut anatomi/skin korunur. |
| [Quaternius UAL](https://quaternius.com/packs/universalanimationlibrary.html), [UAL2](https://quaternius.com/packs/universalanimationlibrary2.html) | CC0 authored animasyon. Seçili 14 klip mevcut pakette zaten bulunur. | Klip ve sampler baytları birebir korunur; yeni animasyon ya da mocap diye sunulmaz. |
| [MakeHuman/MPFB resmi lisansı](https://static.makehumancommunity.org/about/license.html), [MPFB](https://static.makehumancommunity.org/mpfb.html) | Core varlıklar CC0; üretim aracının GPL/AGPL lisansı ile ihracat varlığı birbirinden ayrıdır. MPFB Blender tabanlıdır; topluluk ek varlıklarının kendi lisansı ayrıca kontrol edilmelidir. | Gerçekçi farklı anatomi için daha uygun sonraki yol. Yerelde Blender/bpy bulunmadı; büyük kurulum yapılmadı. İhracat/retarget yapılmış gibi gösterilmez. |
| [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Ticari oyun kullanımına izin verir; Adobe ID ister. [Ham dosya dağıtım sınırı](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400?lang=en) public GLB kaynak dağıtımı için ayrıca çözülmelidir. | Hesap açılmadı, login veya varlık ithali yok. |
| [Poly Haven Leather White](https://polyhaven.com/a/leather_white), [lisans](https://polyhaven.com/license) | Rob Tuytel'in CC0 varlığı; asset yeniden dağıtımı da serbest. Site renderları ve logoları farklı kapsamdır, alınmadı. | 1K diffuse, OpenGL normal ve ARM haritaları; toplam 2,298,230 B. URL/byte/SHA256 `sources/manifest.json` içinde. |

Punchers/CrazyGames varlıkları kopyalanmadı. Model/animasyon marketi hesabı, ücretli satın alma veya Blender kurulumu yapılmadı. Görsel referansın ekipman/siluet dilinden yararlanmak, o oyunun mesh/texture dosyalarını yeniden kullanmak değildir.

## Yeniden üretim ve kontroller

Repo kökünden:

```sh
python3 experiments/visual-assets/build_fightkit.py
python3 -m unittest discover -s experiments/visual-assets -p 'test_*.py' -v
node experiments/visual-assets/preview.mjs
```

Build ağ kullanmaz; pinli eski GLB ve üç hash kontrollü kaynak JPEG yeterlidir. Büyük arşivleri yeniden indirmez. Preview yalnız 127.0.0.1:18904 üzerinde assetlere ve Three.js modüllerine hizmet verir, iş bitince kapatır; uygulama cüzdanı, LIVE bağlantısı veya bahis API'si yoktur.

5 bağımsız kontrol grubu geçti: eski dosyanın değişmezliği ve animation/skin bayt eşitliği; lisans manifesti/embedded kaynaklar; klasik hakem ile yeni ekipmanın ayrı görünürlük seçimi; sonlu geometri/normalize ağırlıklar/palet ve sınır kontrolleri; deterministik tekrar build. Khronos Validator çalıştırıldığı iddia edilmez. Three.js GLTFLoader ile gerçek Metal WebGL'de gard, cross ve arka poz yüklendi; konsol hatası sıfır. `evidence/` PNG ve JSON dosyaları bu görsel/format incelemesini kaydeder, hareket fiziği veya oyun kalitesi kanıtı değildir.

## Renderer sözleşmesi

- Eski `RefereeShirt`, `RefereeTrousers`, `Trunks`, `Waistband`, `Boots` node'ları korunur. Hakem klasik parçaları kullanır ve `FightKit*` node'larını gizler. Yeni dövüşçü klasik parçaları gizler; yeni ekipmanı gösterir.
- Yeni skinned meshler materyale göre **6 draw grubu** olarak birleştirilir: `FightKitTeamFabric`, `FightKitDarkFabric`, `FightKitIvoryTrim`, `FightKitBlackLeather`, `FightKitTeamLeather`, `FightKitLaces`.
- İlk ve beşinci materyal takım rengi içindir. Eldiven artık GLB içindedir; ikinci prosedürel eldiven eklenmemelidir (`extras.requiresLegacyGlovesDisabled`).
- 65 kemik, inverse bind matrisleri, 14 klip ve mevcut node kimlikleri aynıdır; sonuç/motor kuralları değişmez.
- Yerel Metal karşılaştırmasında eski+yeni karakter, zemin ve tek shadow pass birlikte 31 draw/94,174 triangle gösterir; bu değer tek modelin triangle sayısı değildir. Hedef uygulamanın ışık, gölge, 3 karakter ve mobil bütçesi ayrıca ölçülmelidir.

## Sonraki gerçek kalite adımı

MakeHuman/MPFB ile iki farklı yetişkin karakter preseti üretmek; game rig'e retarget/skin incelemesi; özellikle omuz, dirsek, boyun ve gard pozlarında sanatçı düzeltmesi; şortu vücut yüzeyi kopyasından bağımsız düzgün UV'li giysiye dönüştürmek; lisansı uygun boks mocap veya authored klipleri temas zamanlarıyla düzenlemek. Her adım yeni dosya/hash ve eski maça dokunmayan görsel sürümle yapılır. Bu aday o işlerin bitirildiği anlamına gelmez.
