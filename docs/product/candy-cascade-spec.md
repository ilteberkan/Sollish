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
