# Candy Cascade — özgün tumble/scatter-pays oyunu (DEMO)

Durum: 11 Ekim 2026, ilk sürüm. Motor kimliği `candy-cascade-1`. Yalnız DEMO kredisi; SOL, token, VRF yoktur.

## Neden "birebir kopya" değil
Kullanıcı Sweet Bonanza'nın (Pragmatic Play) birebir görsel/animasyon kopyasını istedi. Oyunun adı, sembol çizimleri, karakterleri, arka planı, sesleri ve sunum düzeni üçüncü tarafın telif/marka hakkıdır ve proje kuralı ("lisanslı model ve kütüphaneleri yeniden kullan") lisanssız varlığı yasaklar. Bu yüzden **türün genel mekaniklerini** (6×5 ızgara, her yerde eşleşme, düşen semboller, bedava dönüş, çarpan) kullanan, **bütün çizimi, adı, paytable'ı, sesleri ve animasyonları özgün** bir oyun yapılır.

Kaçınılan öğeler (ayırt edici kalmak için): muz, karpuz, erik, üzüm, elma sembolleri; gökkuşağı bomba çarpanı; lolipop scatter; kardan adam / şeker diyarı arka planı; aynı paytable değerleri; "Sweet Bonanza" adı ve logosu.

## Tema
**Gece şekerhanesi:** Sollish koyu temasıyla uyumlu, alacakaranlıkta parlayan cam vitrinli bir pastane. Izgara, pirinç (brass) kenarlı buzlu cam bir vitrin kutusudur. Arka planda kubbeli cam sera, sıcak vitrin ışıkları, havada süzülen şeker tozu. Renkler: gece mavisi/mor zemin, karamel-altın vurgu (`--accent` ile uyumlu), pastel sembol renkleri.

## Semboller (11)
| id | Ad | Sınıf | Görsel tarif |
|---|---|---|---|
| `crown` | Taç makaron | yüksek | pembe-kırmızı çift katlı makaron, altın taç kreması |
| `cupcake` | Nane kek | yüksek | turkuaz kremalı cupcake, kiraz yok, şeker yıldız |
| `donut` | Mor halka | yüksek | lavanta sırlı donut, beyaz serpme |
| `gumdrop` | Turuncu jöle | yüksek | şekerle kaplı turuncu kubbe jöle |
| `strawberry` | Çilek | düşük | parlak çilek, yaprak |
| `blueberry` | Yaban mersini | düşük | üçlü küme |
| `kiwi` | Kivi | düşük | dilim, çekirdek halkası |
| `lemon` | Limon | düşük | dilim/kama, parlak sarı |
| `cherry` | Kiraz | düşük | çift kiraz, sap |
| `star` | Altın yıldız kurabiye | scatter | sırlı altın yıldız kurabiye, parıltı |
| `crystal` | Çarpan kristali | çarpan | bal/amber renkli altıgen şeker camı, içinde sayı (2×…100×), değere göre renk kademesi |

## Kurallar
- 6 sütun × 5 satır. Satır 0 en üst. Her hücre ağırlıklı tablodan bağımsız çekilir (makara şeridi yok).
- **Her yerde öde:** aynı normal sembolden ızgarada **8 veya daha fazla** varsa kazanır. Kademe: 8–9, 10–11, 12+.
- **Düşme (tumble):** kazanan semboller patlar; sütundaki kalanlar aşağı kayar, boşluklar üstten yeni sembolle dolar; kazanç kalmayana kadar tekrar. `star` ve `crystal` patlamaz, yerinde kalıp kayar.
- **Scatter:** spin sonunda (son tumble sonrası) ızgarada ≥4 `star` → 10 bedava dönüş ve scatter ödemesi (4: 3×, 5: 5×, 6+: 100×). Bedava dönüşte ≥3 `star` → +5 dönüş (scatter ödemesi yok).
- **Çarpan kristali:** yalnız bedava dönüşte düşer. Spin bitince ızgaradaki bütün kristallerin değerleri **toplanır**; o spinin kazancı > 0 ise kazanç × toplam. Kazanç 0 ise kristal etkisizdir.
- **Azami kazanç:** bahsin 5.000 katı. Ulaşılırsa tur hemen biter, kalan bedava dönüşler oynanmaz.
- Bahis 1–500 DEMO. Bütün aritmetik tam sayıdır: kazançlar "bahsin yüzde biri" biriminde (`hundredths`) toplanır, ödeme `floor(stakeCents × hundredths / 100)`.
- Bedava dönüşler aynı bahisle, aynı tur kaydı içinde oynanır; tur tek rezervasyon, tek ödemedir.

## Motor API (`packages/protocol/src/cascade.ts`)
Saf, deterministik, ağdan ve saatten bağımsız. Aynı seed + bahis → aynı tur.

```ts
export const CASCADE_ENGINE_ID = 'candy-cascade-1';
export const CASCADE_COLS = 6; export const CASCADE_ROWS = 5;
export const CASCADE_MAX_WIN_MULTIPLIER = 5000;
export type CascadePaySymbol = 'crown'|'cupcake'|'donut'|'gumdrop'|'strawberry'|'blueberry'|'kiwi'|'lemon'|'cherry';
export type CascadeSymbol = CascadePaySymbol | 'star' | 'crystal';
export interface CascadeCell { id: number; symbol: CascadeSymbol; multiplier?: number }   // id: tur içinde benzersiz, animasyon anahtarı
export type CascadeGrid = CascadeCell[][];                                                // [col][row], row 0 üst
export interface CascadeWin { symbol: CascadePaySymbol; count: number; payHundredths: number; cells: number[] } // cells = cell id'leri
export interface CascadeStep { grid: CascadeGrid; wins: CascadeWin[]; stepHundredths: number }
//   steps[0].grid = ilk düşen ızgara; steps[k+1].grid = steps[k] kazananları kaldırılıp yeni sembollerle dolmuş ızgara.
//   Son adımın wins = [].
export interface CascadeSpin {
  index: number; kind: 'base' | 'free'; steps: CascadeStep[];
  scatterCount: number; scatterHundredths: number;
  multiplierSum: number;            // ızgaradaki kristal toplamı (0 = yok)
  tumbleHundredths: number;         // adımların toplamı (çarpansız)
  winHundredths: number;            // (tumble × (multiplierSum || 1)) + scatter, tavan uygulanmış hali değil
  freeSpinsAwarded: number;         // 10 tetikleme, 5 yeniden tetikleme, 0
  freeSpinsLeft: number;            // bu spinden sonra kalan
  totalHundredthsAfter: number;     // tavan uygulanmış kümülatif tur toplamı
}
export interface CascadeRound {
  engine: typeof CASCADE_ENGINE_ID; seedHex: string; stakeCents: number;
  spins: CascadeSpin[]; totalHundredths: number; payoutCents: number; capped: boolean;
  freeSpinsTriggered: boolean;
}
export function cascadeSeedFromEntropy(words: Uint32Array): string;   // 4×uint32 → 32 hex
export function playCascadeRound(seedHex: string, stakeCents: number): CascadeRound;
export const CASCADE_PAYTABLE: Record<CascadePaySymbol, readonly [number, number, number]>; // hundredths, kademe 8-9/10-11/12+
export const CASCADE_SCATTER_PAY: { 4: number; 5: number; 6: number };
```
RNG: seed'den SplitMix32 ile genişletilen xoshiro128**; çekim sırası sabit (ilk ızgara: sütun 0..5, satır 0..4; dolum: sütun 0..5, her sütunda üstten aşağı).

## Ekonomi hedefi ve kanıt
Hedef teorik dönüş (RTP) ≈ %96 (yalnız bilgi; DEMO değersizdir). Ağırlıklar Monte Carlo ile ayarlanır; rapor: tur sayısı, RTP ve %95 güven aralığı, kazanç sıklığı, bedava dönüş tetikleme sıklığı, azami gözlenen kazanç, tavana ulaşma sayısı. Kanıt: `ops/evidence/candy-cascade-20261011/`. Ağır kuyruk nedeniyle güven aralığı geniştir; kesin RTP iddiası yapılmaz.

## Sunum (sonucu değiştiremez)
Tur başlamadan önce motor bütün turu çözer; ledger rezervasyonu yapılır. Animasyon yalnız hazır adımları oynatır. Sayfadan ayrılma, gizli sekme, azaltılmış hareket veya "hızlı dönüş" sonucu değiştirmez: tur her durumda motorun ödemesiyle **bir kez** kapanır (yarıda ayrılınca da tam ödeme yazılır, "iptal/iade" yoktur, çünkü sonuç zaten belirlenmiştir).

Animasyonlar (hepsi kodla yazılmış, prosedürel; hazır klip yok):
- Giriş: semboller sütun sütun gecikmeli düşer, yaylı yerleşme (squash & stretch).
- Kazanç: eşleşen semboller parlar ve titrer, sonra şeker kırıntısı parçacıklarıyla patlar; kazanç tutarı patlama merkezinden yükselir.
- Düşme: kalanlar yerçekimiyle kayar, yeni semboller üstten iner, hafif sekme.
- Kristal: dönerek iner, değeri parlar; spin sonunda kristaller sayaca uçar, toplam çarpan büyür.
- Scatter: yıldızlar nabız gibi atar; tetiklemede ekran kararır, "BEDAVA DÖNÜŞ" giriş kartı.
- Büyük kazanç kademeleri (≥20×, ≥50×, ≥100×) için sayaç tırmanışı ve kutlama.
- `prefers-reduced-motion`: parçacık ve sarsıntı yok, kısa geçişler.
- Ses: Web Audio ile sentezlenmiş özgün efektler (düşme, patlama, kazanç, kristal, tetikleme); varsayılan kapalı, kullanıcı açar.

## Sürüm 2 (`candy-cascade-2`, 11 Ekim 2026)
`docs/product/game-standards.md` eşitliği için. v1 (`candy-cascade-1`) donar; çıktısı değişmez.

### Modlar ve maliyet (taban bahis `bet`, kuruş)
| Mod | Ödenen | Fark |
|---|---|---|
| `standard` | `bet` | v1 kuralları |
| `ante` ("Şans ×2") | `bet × 5/4` | taban oyunda yıldız olasılığı yaklaşık iki katı; satın alma kapalı |
| `buy` ("Bonus satın al") | `bet × 100` | taban dönüş en az 4 yıldızla başlar, bedava dönüş garantili |
Kazançlar taban bahse göre hesaplanır; azami kazanç `5000 × bet`. Her modun RTP'si ayrı ayarlanır ve ayrı kanıtlanır (hedef ≈ %96, her biri 95–97).

### Bahis basamakları (DEMO)
1, 2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50, 75, 100, 150, 200, 250, 400, 500. Ödenen tutar ledger'ın tur başına sınırını aşamaz; aşan seçenek devre dışı görünür.

### Motor API ekleri (`packages/protocol/src/cascade-2.ts`)
```ts
export const CASCADE2_ENGINE_ID = 'candy-cascade-2';
export type CascadeMode = 'standard' | 'ante' | 'buy';
export const CASCADE2_BET_LEVELS_CENTS: readonly number[];
export function cascadeCostCents(betCents: number, mode: CascadeMode): number;
export interface Cascade2Round extends Omit<CascadeRound, 'engine'> { engine: typeof CASCADE2_ENGINE_ID; mode: CascadeMode; betCents: number; costCents: number }
export function playCascade2Round(seedHex: string, betCents: number, mode: CascadeMode): Cascade2Round;
export const CASCADE2_RTP: Record<CascadeMode, { rtp: number; ciLow: number; ciHigh: number; rounds: number; hitRate: number; featureRate: number; stdDev: number }>; // kanıttan kopyalanır
```
`stakeCents` alanı geriye uyumluluk için `betCents`'e eşittir. Adım/spin/hücre yapıları v1 ile aynıdır, yani v1 zaman çizelgesi aynı veriyle çalışır.

### Oyun ekranı (v2 arayüzü, 11 Ekim 2026)
Oyun artık yalnız `candy-cascade-2` ile oynanır; v1 motoru testler için durur. Bütün çizim, düzen ve animasyon özgündür (gece şekerhanesi + koyu Sollish çerçevesi, karamel-altın vurgu).
- **Kontrol paneli** (`components/cascade/cascade-game.tsx`, tek DOM, CSS grid alanları): masaüstünde ızgara solda, panel sağda (bakiye + "Bakiyeyi yenile", son kazanç, −/bahis menüsü/+, azami bahis, Şans ×2, Bonus satın al, otomatik/ÇEVİR/hız, bilgi/ayarlar/ses). Telefonda (≤1050 px) ızgara tam genişlik, altında 3 satır: bakiye·bahis·kazanç / [bilgi][−][ÇEVİR][+][otomatik] / [Şans ×2][satın al][ayarlar][hız][ses]; hedefler ≥44 px, yatay kaydırma yok.
- **Bahis:** slot kit `BetSelector` (yeni `render` düzeni) `CASCADE2_BET_LEVELS_CENTS` üstünde; bakiyenin yetmediği basamak seçilemez; seçili modun maliyeti hep görünür. Bahis tarayıcıda hatırlanır.
- **Şans ×2:** maliyet ×1,25, "Bedava dönüş şansı ≈2 kat"; açıkken satın alma kapalı.
- **Bonus satın al:** `BuyFeatureDialog`, fiyat 100×bahis, RTP `CASCADE2_RTP.buy`. Otomatik oyunda, tur sürerken, Şans ×2 açıkken veya bakiye yetmezken nedeniyle kapalı.
- **Ledger:** `DemoLedger.reserve(stake, nonce, { maxMultiplier, maxStakeCents })`; Cascade `maxMultiplier = ceil(5000 × bahis / maliyet)` (5000 / 4000 / 50) ve en çok 50.000 DEMO tek rezervasyon ister; diğer oyunların varsayılanları değişmedi. `reset()` + sağlayıcıda `resetDemoBalance()` ("Bakiye yenilendi" geçmiş satırı), tur rezerve iken reddedilir.
- **Hız:** Normal / Hızlı (×0,6) / Turbo (×0,35, beklemeler en az 1,5 sn); "Giriş ekranlarını atla" giriş/çıkış/azami kazanç kartlarını ≤0,9 sn, büyük kazanç sayacını ≤1 sn gösterir; kartlar ve sayaç dokunarak geçilir; Boşluk ayarla açılıp kapanır.
- **Bedava dönüş çıkış kartı:** son bedava dönüşten sonra "Bedava dönüş bitti — Toplam kazanç X DEMO, N dönüş" (`free-outro` zaman çizelgesi olayı).
- **Otomatik oyun:** kit `AutoplayPanel` (kayıp limiti zorunlu) + saf adaptör `lib/cascade-controls.ts` (`autoplayBeforeSpin` / `autoplayAfterRound`); bonus satın almaz; sekme gizlenince, 30 dk hatırlatmasında ve pencere açıkken bekler/durur; duruş nedeni bildirimle gösterilir; ÇEVİR yerine kalan sayılı DURDUR düğmesi.
- **Bilgi:** 7 sayfa (nasıl oynanır, bahse göre DEMO ödeme tablosu, özellikler, mod başına RTP ve %95 GA, bahis ve kazanç sınırları, tuşlar, arıza hükmü).
- **Oturum:** `SessionBar` (saat, süre, net) masanın altında; 30 dakikada bir `RealityCheckDialog` (Devam / Çık → `/games`). Geliştirmede `window.__cascadeRealityMs` aralığı kısaltır (üretimde yok).
- **Geçmiş ve tekrar:** zaman, mod, bahis, maliyet, kazanç, sonuç, kısa tur kimliği; "Tekrar oynat" kayıtlı seed + bahis + mod ile turu motordan yeniden çözer, ödemeyi kayıtla karşılaştırır ve ledger'a dokunmadan oynatır ("Tekrar — bakiye değişmez").
- **Yükleme ekranı:** sayfa başına bir kez kısa marka ekranı + "Oyna" (ayarla kapatılabilir). Ses ilk dokunuşta `resume()` + `load()`; "Ses yükleniyor %N" göstergesi.
- **Ses:** bütün çağrılar `components/cascade/use-cascade-sound.ts` içinde; yeni API yöntemleri varsa çağrılır (setMix ayarlardan, setScene base/feature, freeSpinsIntro→feature, featureOutro→base, bigWin+countUp, maxWin, tumble, scatterTease, crystalArrive, multiplierApply, click, betChange, denied, autoplay; kapanışta setScene('none')).

### Oyun akışı v3 (12 Ekim 2026, `game-standards.md` §6)
Motor değişmedi (`candy-cascade-2`); yalnız sunum. Bu bölüm yukarıdaki "≥20×" kademelerini, "Atla" düğmesini ve "Bu dönüş" sayacını geçersiz kılar.
- **Dönüş kilidi:** ÇEVİR'e basınca düğme `disabled` olur (dönen girdap, hızlı halka, kilit rozeti) ve tur bütün düşmeler ve bedava dönüşlerle bitene kadar öyle kalır. "Atla" yoktur; Boşluk/Enter tur sırasında yalnız bekleme ekranlarında (bedava dönüş girişi, toplam ekranı, kutlama) işe yarar. Hızlandırma Hızlı/Turbo ve "Giriş ekranlarını atla" ile. Otomatik oyunda büyük düğme DURDUR'dur (o tur bittikten sonra durur). Sayfadan ayrılma yine motor ödemesiyle bir kez kapatır.
- **Birikimli kazanç:** tek gösterge (`meter.total`): düşmeler, çarpan ve bütün bedava dönüşler boyunca yalnız artar; bedava dönüşte "TOPLAM KAZANÇ" başlığıyla, dönüş kazancı geçici "+X" etiketi olarak. Tur bitince son toplam bir sonraki dönüşe kadar görünür.
- **Kazanç kademeleri** (`lib/slot-kit/win-tiers.ts`, eşikler ses motorunun `lib/slot-audio/win-tiers.ts` tablosundan): Büyük ≥10×, Mega ≥25×, Süper ≥50×, Efsane ≥100×, tavanlı tur Azami. Sayaç Büyük'ten başlar ve her eşiği geçerken kademe atlar (her bant kendi süresini alır: normalde 3,0 / 4,8 / 6,6 / 9,0 sn; Hızlı ×0,6, Turbo ×0,35, en az 1,5 sn; "ekranları atla" ≤1 sn). Her kademe: kendi yazı kilidi ve renk paleti, şeker + altın para yağmuru (tek canvas), dönen ışınlar, hale, kademe geçişinde parlama, sarsıntı ve sayaç vuruşu, ses `bigWin(1..4)` / `maxWin()` / `countUp`. İlk dokunuş/Boşluk sayacı sona getirir, ikincisi kapatır. Sayaç oynatıcının saatinden okunur; son kare her zaman motor ödemesidir.
- **Bedava Dönüş Toplamı:** bedava dönüşlü her tur bu ekranla biter (dönüş sayısı, uygulanan kristal toplamı / kez / en yüksek, bahsin katı, toplam); ≥10× ise kutlamaya geçer. 10× altı kazançlı temel tur: göstergede kısa parıltı + `totalWinFanfare()`.
- **Çarpan anonsu:** kristal toplamı ızgaranın ortasında büyük "×N" ile; ≥10× / ≥25× / ≥50× / ≥100× için büyüyen boy, kendi rengi, etiket (Büyük/Mega/Süper/Efsane çarpan), parçacık ve sarsıntı; ses `multiplierCallout(N)` + `multiplierApply`.
- **Otomatik oyun ekranı:** ana görünümde tur sayısı, zorunlu kayıp limiti (×bahis kısayolları) ve Başlat. Diğer koşullar kapalı "Gelişmiş" bölümünde (bedava dönüşte dur varsayılan açık); özet satırı açık koşulları sayar.
- Geliştirme önizlemesi: `window.__cascadePreview.celebrate(toplamYüzdelik, tavanlı)` ve `.callout(N)` yalnız `NODE_ENV !== 'production'` iken vardır; tur, rezervasyon veya ödeme yapmaz.
