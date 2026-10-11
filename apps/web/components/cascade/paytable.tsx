'use client';
import { CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_PAYTABLE, CASCADE2_SCATTER_PAY, type CascadePaySymbol } from '@sollish/protocol';
import { centsFor, moneyText, multiplierText } from '@/lib/cascade-timeline';
import { formatDemo } from '@/lib/slot-kit/bet';
import { SYMBOL_LABELS, SymbolArt } from './symbols';
import styles from './info.module.css';

const ORDER: CascadePaySymbol[] = ['crown', 'cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry'];
const TIERS = ['12+', '10–11', '8–9'] as const;
const HIGH = new Set<CascadePaySymbol>(['crown', 'cupcake', 'donut', 'gumdrop']);

/** "Ödeme tablosu" page: every amount is computed from the v2 engine tables and the current bet. */
export function PaytableContent({ betCents }: { betCents: number }) {
  const amount = (h: number) => moneyText(centsFor(betCents, h));
  return (
    <div className={styles.page}>
      <p className={styles.lead}>
        Aynı şekerden ızgarada <strong>her yerde 8 veya daha fazla</strong> varsa kazanırsın. Büyük rakam <strong>{formatDemo(betCents)}</strong> bahiste brüt DEMO tutarıdır; altındaki çarpan bahsin katıdır.
      </p>
      <ul className={styles.payGrid} aria-label="Sembol ödemeleri">
        {ORDER.map(symbol => {
          const [t8, t10, t12] = CASCADE2_PAYTABLE[symbol];
          return (
            <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><SymbolArt symbol={symbol} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{SYMBOL_LABELS[symbol]}</h4>
                <dl className={styles.payRows}>
                  {[t12, t10, t8].map((h, i) => (
                    <div key={TIERS[i]}>
                      <dt>{TIERS[i]}</dt>
                      <dd><strong>{amount(h)}</strong><small>{multiplierText(h)}×</small></dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><SymbolArt symbol="star" size="100%" /></span>
          <div>
            <h4>{SYMBOL_LABELS.star} · dağınık ödeme</h4>
            <dl className={styles.scatterRows}>
              <div><dt>6+ yıldız</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[6])}</strong> <small>{multiplierText(CASCADE2_SCATTER_PAY[6])}×</small></dd></div>
              <div><dt>5 yıldız</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[5])}</strong> <small>{multiplierText(CASCADE2_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>4 yıldız</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[4])}</strong> <small>{multiplierText(CASCADE2_SCATTER_PAY[4])}×</small></dd></div>
            </dl>
            <p>Temel dönüş bitince ızgarada 4 veya daha fazla yıldız varsa öder ve <strong>10 bedava dönüş</strong> açar. Yıldızlar patlamaz.</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><SymbolArt symbol="crystal" multiplier={10} size="100%" /></span>
          <div>
            <h4>{SYMBOL_LABELS.crystal}</h4>
            <p>Yalnız bedava dönüşte düşer, 2× ile 100× arası değer taşır. Dönüş sonunda ızgaradaki kristaller <strong>toplanır</strong>; o dönüşün kazancı varsa bu toplamla çarpılır.</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>Azami kazanç {new Intl.NumberFormat('tr-TR').format(CASCADE2_MAX_WIN_MULTIPLIER)}×</h4>
            <p>Bu bahiste <strong>{formatDemo(betCents * CASCADE2_MAX_WIN_MULTIPLIER)}</strong>. Tur toplamı bu tavana ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
