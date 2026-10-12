# Fırtına Tahtı (çalışma adı) — çarpan küreli tumble oyunu (DEMO)

Durum: 12 Ekim 2026, taslak. Motor kimliği `storm-throne-1`. Yalnız DEMO kredisi. `docs/product/game-standards.md` bütünüyle geçerlidir.

## Özgünlük
Sahip, piyasadaki mitolojik "gök tanrısı + çarpan küresi" türünde (ör. Gates of Olympus) üst seviye bir oyun istedi. Tür mekanikleri (6×5 her yerde öde, tumble, her dönüşte düşebilen çarpan küreleri, bedava dönüşte biriken toplam çarpan, ante, satın alma) serbesttir. **Ad, karakter, semboller, sahne, animasyon, müzik, seslendirme ve ödeme tablosu özgündür.** Zeus/Olympos görselleri, o oyunun karakter tasarımı (beyaz sakal + altın defne tacı + pelerin), logo biçimi, mor-altın elmas logo, sütunlu tapınak sahnesi ve sesleri kullanılmaz. Tema ve karakter sahibin seçimini bekler (öneri: Anadolu'nun Hitit fırtına tanrısından esinlenen özgün bir karakter; Hattuşa aslanlı kapı, boğa ve tunç çağı motifleri).

## Kurallar
- 6 sütun × 5 satır, satır 0 üst. Hücreler ağırlıklı tablodan bağımsız çekilir.
- 8+ aynı normal sembol her yerde öder; kademe 8–9 / 10–11 / 12+. Kazananlar patlar, kalanlar düşer, boşluk dolar; kazanç kalmayana kadar.
- **Normal semboller (9):** yüksek `h1..h4`, düşük `l1..l5` (tema seçilince adlandırılır).
- **Scatter** `scatter`: spin sonunda ≥4 → 15 bedava dönüş + scatter ödemesi (4: 3×, 5: 5×, 6+: 100×). Bedava dönüşte ≥3 → +5 dönüş.
- **Çarpan küresi** `orb`: hem temel oyunda hem bedava dönüşte düşebilir; değer kümesi {2,3,4,5,6,8,10,12,15,20,25,50,100,250,500}, ağırlıklı. Patlamaz, düşmelerde yerinde kalıp kayar.
  - Temel oyun: tumble dizisi bitince ızgaradaki kürelerin toplamı, o spinin kazancı > 0 ise kazancı çarpar.
  - Bedava dönüş: kazanç > 0 olan her spinde ızgaradaki küre toplamı **toplam çarpana eklenir** (toplam çarpan özellik boyunca korunur, başlangıç 0), spin kazancı × toplam çarpan ödenir. Kazanç 0 ise küreler eklenmez.
- Modlar: `standard` (bet), `ante` (bet×5/4, scatter ~2 kat), `buy` (bet×100, ilk ızgarada ≥4 scatter garantisi). Her modun RTP'si ayrı ayarlanır, hedef ≈ %96.
- Azami kazanç 5.000 × bet; ulaşılınca tur biter.
- Bahis basamakları Candy Cascade v2 ile aynı.

## Motor API (`packages/protocol/src/storm-throne.ts`)
Candy Cascade v2 ile aynı yapı (`CascadeCell/Step/Spin` şekli), şu farklarla:
```ts
export const STORM_ENGINE_ID = 'storm-throne-1';
export type StormPaySymbol = 'h1'|'h2'|'h3'|'h4'|'l1'|'l2'|'l3'|'l4'|'l5';
export type StormSymbol = StormPaySymbol | 'scatter' | 'orb';
export interface StormCell { id: number; symbol: StormSymbol; multiplier?: number }
export interface StormSpin { /* CascadeSpin alanları */ orbSum: number; totalMultiplierBefore: number; totalMultiplierAfter: number; appliedMultiplier: number }
export interface StormRound { engine; seedHex; mode; betCents; costCents; spins: StormSpin[]; totalHundredths; payoutCents; capped; freeSpinsTriggered }
export function playStormRound(seedHex: string, betCents: number, mode: 'standard'|'ante'|'buy'): StormRound;
export const STORM_PAYTABLE, STORM_SCATTER_PAY, STORM_ORB_WEIGHTS, STORM_RTP, STORM_BET_LEVELS_CENTS;
export function stormCostCents(betCents: number, mode): number;
```
`appliedMultiplier`: temel oyunda o spinin küre toplamı (yoksa 1), bedava dönüşte güncel toplam çarpan (yoksa 1).
