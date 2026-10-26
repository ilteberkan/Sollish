# Göreme kazanç sunumu (win FX) — 23–26 Ekim 2026

Sahip geri bildirimi: "Candy Cascade'de şekerler patlıyor; Göreme'de kazanan öğeler kaybolmuyor, görsel efekt yok."
Kapsam: yalnız sunum. Motor `goreme-balloons-1`, kurallar, ödeme tablosu ve ödeme değişmedi
(`packages/protocol/src/goreme.ts` dokunulmadı). Tüm ölçümler `next dev` (localhost:3000), headless Chromium,
4 çekirdekli bulut konteyneri; üretim derlemesi, gerçek telefon, CI yok.

## 1. Kıyas (benchmark) — ne yapıyorlar

Kayıt: `benchmark/*.webm` (Playwright video, 1280×800) ve kare tabakaları `benchmark/*-frames.jpg`.
Tohumlar spec dosyalarındaki sabitler (Cascade `TUMBLES`, Asena `CONST_WALK`, Ebru `COMB_WIN`).

| Oyun | Kazanç anı (kare kare) |
|---|---|
| Candy Cascade | Kazanan küme parlıyor + sallanıyor (±8° dönme, ×1,1–1,13 ölçek); diğerleri kararıyor. Ardından "pop": ×1,34'e şişip dönerek ×0,2'ye küçülüp kayboluyor, sembol renginde kıvılcım patlaması + halka, küme merkezinde "+tutar" etiketi yükselip sönüyor; boşluklara yeni şekerler düşüyor. Sayaç birikiyor. |
| Asena | Küme hücreleri takımyıldız çizgileriyle birbirine bağlanıyor (yıldız parıltıları), sonra küme bir madalyona çöküyor ("×2 HİLAL" + "+4,80"), şok halkaları; semboller düşüyor. |
| Ebru | Tarak geçişi; kazanan küme parlıyor, geri kalanı kararıyor, "Tarak yeni küme kurdu" şeridi; küme mürekkebe dağılıp "+tutar" bırakıyor. |
| Göreme (önce) | Kazanan hücrelerde altın çerçeve + hafif nabız, diğerleri sönük, alt kenarda makara başına sayı çipleri; kazanç notu sayaçta kırpılmış ("Mor Yonca · 6 makara · 4…"); 0,9 s sonra biter. Patlama, yol çizimi, yol başına tutar yok. `goreme-before-multi.webm`, `frames/before-multi-*.jpg`. |

Çıkarım: ticari ways/küme oyunları (1) önce bütün kazançları özetler, (2) sonra her kazancı tek tek gösterir,
(3) her kazancın tutarını sembolün üstünde yazar, (4) büyük kazançta sembolü patlatır. Göreme tumble etmediği için
"kaybolma" yerine **patlayıp yeniden oluşma** (tahta motor tahtası olarak kalır) seçildi.

## 2. Eklenenler

- `apps/web/lib/goreme-wins.ts` (saf): motor turundan yol başına etiket listesi `{symbol, reels, ways, multiplier,
  payTenThousandths, amountCents, cells}`. Tutarlar **tam olarak tur ödemesine eşit toplanır**: her tahta, sayacın o anda
  eklediği sentleri alır (tavanlı birikimli toplamın sent farkı), tahta içindeki yollar `payTenThousandths` ağırlığıyla en
  büyük kalan yöntemiyle bölünür (BigInt; tavan yakınında 2^53 taşmaz). Yol başına floor ile 1 sentlik sapma olmaz.
- `lib/goreme-timeline.ts`: `win` olayı artık `lines`, `cents`, `burst`, `summaryMs` taşır; tahtada 2+ yol varsa özetten
  sonra her yol için `win-line` olayı (en büyük tutar önce, en çok 6). Süreler: özet 900 ms (büyük tahta 1250 ms),
  yol başına 720 ms; hızlı ×0,6, turbo ×0,35; azaltılmış hareket özet 900 ms + yol 900 ms (statik okuma). Bir dönüşte
  6. tahtadan sonra (uzun kalkış zinciri) döngü ve patlama yok. Büyük tahta = ≥5× bahis veya yol çarpanı anonsu.
- `components/goreme/win-fx.tsx` + `win-fx.module.css`: tahta içi katman. Özet: her kazanan hücrede kilim elmaslı
  kıvılcım patlaması + halka (makaraya göre soldan sağa gecikmeli), her yol için etiket
  ("Avanos Çömleği 3× · 9 yol · ×6 = 4,80"). Yol: hücreler makaradan makaraya (r → r+1 her çift) çizgilerle bağlanır,
  her hücrede kilim düğümü, etiket büyük. Özgün çizim (kilim baklavası, kök boya/safran/turkuaz/çivit).
- `components/goreme/board.tsx`: `showWins` / `focusWin`; sembol `.fx` sarmalayıcısında, her vurguda zıplama;
  büyük tahtada şişme → kırılıp kilim kırıklarına dağılma → yeniden oluşma (`board.module.css`). Kazanmayanlar zaten
  `dim` durumunda (opaklık 0,32); balonlar patlamaz (kalıcı çarpanlar).
- `goreme-game.tsx` (küçük ekleme): `win` → `showWins`, `win-line` → `focusWin` + ses `waysWin(symbol, 0)` (mevcut
  `ways-0` sesi, sembole göre perde; yeni ses dosyası yok); "+tutar" etiketi artık tahta payının senti.
- i18n: `goreme.winLine.label` 9 dilde (`messages/<dil>/goreme.json`); tr/en dikkatle, diğerleri "way" terimiyle makul.
- Spin kilidi §6: atlama düğmesi eklenmedi; dizi turbo/hızlı ayarıyla kısalır, sonuç/ödeme etkilenmez.

## 3. Kanıt

- Sonra: `goreme-after-multi.webm` (3 yollu tahta, 1280×900), `goreme-after-big-phone-390x844.webm` (12,32× tahta,
  patlama, telefon). Kareler `frames/after-multi-01-summary.jpg` … `04-way3.jpg`, `frames/after-big-phone-01-swell.jpg`
  … `04-way-trace.jpg`, tabakalar `frames/*-sheet.jpg`. Etiketler: Al Göz 1,34 + Çivit Göz 0,72 + Mor Yonca 5,74 =
  7,80 = ödeme.
- fps (`requestAnimationFrame` aralıkları, spin anından itibaren, ekran görüntüsüz koşu `NOSHOT`):

| Koşu | Pencere | ort. fps | p95 kare | >50 ms kare |
|---|---|---|---|---|
| Önce, MULTI, 1280×800 | 7,3 s | 19,1 | 183 ms | 32 |
| Sonra, BIG (patlama), 390×844 | 9,3 s | 32,6 | 83 ms | 32 |
| Sonra, MULTI, kazanç dizisi | bkz. `fps-after.json` | | | |

  Not: next dev + yazılım çizimli headless Chromium + aynı anda koşan diğer ajan testleri; sayılar arasında 2× oynama
  var, yalnız kıyas için. Önceki animasyon denetimi bu makinede 42–50 fps ölçmüştü. 60 fps iddiası yok; gerçek
  telefonda ölçülmeli.

## 4. Testler

- Birim: `apps/web/tests/goreme-wins.test.ts` (bölme, 3 mod × 4 bahis × 120 tohum: tahtalar + dağılım = ödeme;
  zaman çizelgesi: win-line sırası/zamanı, turbo kısalır, azaltılmış hareket etiketleri korur, büyük tahta patlar,
  kalkış zinciri toplamı). `goreme-timeline.test.ts` hız testi `summaryMs`'i zamanlama alanı olarak ayıklar.
- Tarayıcı (`tests/browser/goreme.spec.ts`, 3 yeni test): etiketler motor yollarıyla birebir, tutarlar ödemeye
  eşit, kararma, yol izi, kıvılcım, son tahta = motor tahtası; azaltılmış hareket: etiketler + kararma var, kıvılcım ve
  patlama yok; büyük tahta patlar, ödeme değişmez.

## 5. Sınırlar

- Görsel kabul sahibinde; ekran görüntüsü veya test sayısı kabul değildir.
- "Şafak Şöleni moorings" tarayıcı testi bu konteynerde kırmızı (balon kuşak yuvasına 42–176 px uzak). Kazanç FX
  kodu (board/timeline/css 8db8145 sürümüne geri alınarak) devre dışıyken de aynı şekilde kırmızı: bu değişiklikten
  bağımsız; zamanlama/ortam veya eşzamanlı başka değişiklik. Ayrı incelenmeli.
- Patlama yalnız ≥5× tahtalarda; küçük kazançlarda zıplama + kıvılcım. Balon wild'ları patlamaz.
- Etiket listesi çok yollu tahtada (9 yola kadar) alt satırları kapatır; telefonda yazı 11 px.
- Üretim önizlemesi (`build:cloudflare`) bu değişiklikle koşulmadı; yalnız next dev.
