# Sollish oyun dalgası 3 — Göreme ve Damla

Durum: 21 Ekim 2026, sahip isteği ("iki yeni özgün oyun: üst seviye bir slot ve bir Sollish Original anlık oyun"); son tasarım kararı bu belgededir. `docs/product/game-standards.md` bütünüyle geçerlidir (özellikle §6). Yapı dalga 2 ile aynıdır (`docs/product/games-wave2.md`): motor (`packages/protocol`, saf, deterministik, tam sayı) → mod başına ayrı süreçte ≥20 M tur RTP kanıtı (sonuç her parçada diske yazılır) → özgün sanat → özgün ses (`lib/slot-audio`) → oyun ekranı (slot kiti, 9 dil) → RGS kaydı, /verify, /replay, testler. DEMO yalnız; gerçek varlık kapıları kapalı.

Özgünlük: ad, logo, çizim, arayüz, müzik, efekt, metin ve ödeme tabloları özgündür. Başka oyunların veya sitelerin adı, görseli, metni, sesi kullanılmaz; gerçek kişi görseli yoktur. Tür mekanikleri (ways, wild çarpanı, Plinko türü düşüş) serbesttir; bütün parametreler kendi Monte Carlo / kesin hesabımızdan gelir.

---

## 1. Göreme: Şafak Balonları (`goreme`, motor `goreme-balloons-1`)

**Tema:** Kapadokya'nın Göreme vadisi, gün doğumu. Peri bacaları, güvercinlikler, Avanos çömlekçiliği, kilim desenleri, sıcak hava balonları (dini öğe yok). Görsel dil: pastel şafak gökyüzü (mor → şeftali → altın), tüf kayalarının sıcak kremi, balonlarda özgün kilim motifleri. Coğrafya ve zanaat; kamu malı, bütün çizimler özgün.

**Neden yeni:** mevcut beş oyunun hepsi düşme (tumble), küme veya ışın ödemesidir. Göreme platformun ilk **ways** oyunudur ve kazanç zinciri düşme değil **yükseliştir**: wild'lar tahtada yukarı doğru uçar.

### Tahta ve ödeme
- 6 makara × 5 sıra, **15.625 yol**; soldan sağa bitişik makaralarda 3–6 aynı sembol öder.
- Semboller: 4 yüksek (`h1` Peri Bacası, `h2` Güvercinlik, `h3` Avanos Çömleği, `h4` Kilim Atı), 5 düşük (`l1`–`l5`, beş renkli kilim göz motifi), wild `balloon`, scatter `sun` (Şafak Güneşi).
- **Balon wild'ı** `sun` dışındaki her sembolün yerine geçer ve bir **çarpan** taşır (iniş değerleri ×1, ×2, ×3, ×5; ağırlıklı). Kendi başına ödemez.
- **Yol hesabı (tam sayı):** sembol s için makara r'nin ağırlığı `c(s,r) + w(r)`; `c` = s'nin o makaradaki adedi, `w` = o makaradaki balonların çarpan **toplamı**. Seri uzunluğu L, ağırlığı sıfır olan ilk makaraya kadar. Kazanç = `ödeme[s][L] × (Π(c+w) − Π w)` (r = 1..L); çıkarılan terim yalnız balondan oluşan yolları dışarıda bırakır, yani her yolda en az bir gerçek s bulunur. Çarpanlar böylece makaralar arasında **çarpılır** (2. makarada ×3, 4. makarada ×2 → o yollarda ×6).

### Yükseliş zinciri (taban oyun)
- Bir dönüş ödendikten sonra tahtada balon varsa **kalkış** adımı gelir: her balon bir sıra yukarı çıkar, çarpanı **+1** artar (en çok ×25).
- **Rüzgâr:** her kalkışta RNG bir rüzgâr yönü seçer (sol / durgun / sağ); bütün balonlar o yöne bir makara kayar (kenarda durur).
- **Birleşme:** aynı hücreye gelen iki balon tek, büyük bir balona dönüşür; çarpanı ikisinin toplamıdır (en çok ×25).
- En üst sıradan çıkan balon uçup gider. Balon olmayan bütün hücreler yeniden döner (yeniden dönüş şeritleri; yeni balon da inebilir) ve yeni tahta **tamamen yeniden** ödenir.
- Zincir tahtada balon kalmayınca ya da 20 kalkışta biter.

### Scatter ve Şafak Şöleni (bedava dönüş)
- `sun`, yalnız turun ilk tahtasında sayılır: 3 → 10 dönüş + 2×, 4 → 12 + 5×, 5 → 15 + 20×, 6 → 20 + 100× (scatter ödemesi bahis katı).
- **Şafak Şöleni:** balonlar dönüşler arasında kalır; her bedava dönüş bir kalkıştır (yukarı + rüzgâr + çarpan +1), balon dışı hücreler döner, tahta ödenir.
- **Gökyüzü kuşağı (imza mekanik):** üstten çıkan balon uçup gitmez, tahtanın üstündeki gök kuşağına **demirler**; çarpanı **Gök çarpanına** eklenir. Gök çarpanı (başta ×1; ilk demirlemede o balonun değeri, sonra toplam) özellik sonuna kadar her kazancı çarpar ve yalnız artar.
- Bedava dönüşte 3+ `sun` → +5 dönüş. En çok 200 bedava dönüş.

### Ekonomi
- Modlar: `standard` (×1), `ante` (×5/4, özellik ~2 kat sık), `buy` (×100, en az 3 `sun` garantili). Bahis basamakları diğer slotlarla aynı.
- **RTP her modda %94–96,5** (hedef ~%95,5–96). **Azami kazanç 10.000 × bahis** (tavana ulaşınca tur biter).
- Tur şekli dalga 2 ile aynı: `engine, seedHex, mode, betCents, costCents, spins[], totalHundredths, payoutCents, capped, freeSpinsTriggered`; `play GoremeRound(seedHex, betCents, mode)`.
- **Adımlar:** `spin` (tahta, inen balonlar ve çarpanları), `ways` (sembol, uzunluk, yol sayısı, çarpan çarpımı, ödeme, hücreler), `lift` (rüzgâr, balon hareketleri, birleşmeler, çıkan/demirleyen balonlar), `respin`, `scatter`, `sky` (demirleyen balonlar, Gök çarpanı).

### İmza anı (viral klip)
Şöleninde gök kuşağının şafakta balonlarla dolması ve Gök çarpanının her demirlemede sayaç gibi atması; taban oyunda iki balonun rüzgârda çarpışıp tek dev balona dönüşmesi.

---

## 2. Damla: Pamukkale (`damla`, motor `damla-terraces-1`) — Sollish Original

**Tema:** Pamukkale travertenleri. Bembeyaz kireç teraslarından turkuaz havuzlara akan tek bir su damlası. Sakin, "izlemesi tatmin edici" görüntü; her teras sıçraması ince bir su sesi.

**Mekanik (Plinko türünün özgün yorumu):** damla R teras sırası boyunca iner; her terasta havuzun sol ya da sağ kenarından taşar (her biri 1/2, motorun RNG bitinden). Sağa taşma sayısı k ∈ [0, R] alttaki **havuzu** belirler; havuzun çarpanı bahisle çarpılır.
- Teras sayısı R ∈ {8, 10, 12, 14, 16}; risk ∈ {`low`, `medium`, `high`} → 15 mod, ad `<risk>-<R>` (ör. `medium-12`).
- Ödeme tabloları simetrik, yüzde bir hassasiyette tam sayı (`hundredths`), kendi formülümüzden üretilir. **Kesin RTP** (binom toplamı) her modda **%98,0–99,0** (kasa avantajı ≥ %1). Kanıtta hem kesin hesap hem mod başına ≥20 M tur Monte Carlo bulunur.
- Azami kazanç: o modun en yüksek havuz çarpanı (high-16 en çok 1.000×).
- Tur şekli slot turlarıyla aynıdır (RGS, /verify, /replay hiç değişmeden çalışır): `freeSpinsTriggered = false`, `spins` yerine `path` (her terasın sol/sağ kararı) ve `slot` (k).
- **Provably fair:** `sollish-slot-fair-1` (sunucu seed hash'i önceden, istemci seed, nonce). Her damla bir tur ve bir nonce'tur.
- **Oyuncu özellikleri:** bahis basamakları ve −/+, risk ve teras seçimi, tek damla, "Yağmur" (5 / 10 damla art arda, her biri ayrı tur), otomatik bahis (damla sayısı + zorunlu kayıp limiti; Gelişmiş: kazançta dur, tek kazanç şu tutarı aşarsa dur), hızlı/turbo, son sonuçlar şeridi, geçmişten tekrar oynatma ve paylaşma.
- **İmza anı:** high-16'da damlanın en kenardaki altın havuza ulaşması; havuz taşar, bütün teraslar altın renge döner.

---

## Ortak
- Seslendirme: Göreme için tr/en replikler (Higgsfield). **Kredi harcanmadan önce kullanıcıya sorulur** (~20 kredi kaldı). Onaya kadar oyun sözsüz çalışır; metinler `docs/product/voice-scripts.md`'ye eklenir. Damla sözsüzdür.
- 9 dil (en de pt fr it es tr zh ko); Türkçe ses yalnız `tr`'de.
- Lobi: Göreme `slots`, Damla `instant` + "Sollish Original"; ikisi de `isNew`, `provablyFair`.
- Kanıt: `ops/evidence/goreme-<tarih>/`, `ops/evidence/damla-<tarih>/`.
