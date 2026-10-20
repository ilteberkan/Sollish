'use client';
import { CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_PAYTABLE, CASCADE2_SCATTER_PAY, CASCADE_FREE_SPINS_TRIGGER, type CascadePaySymbol } from '@sollish/protocol';
import type { Formatter } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translator';
import { centsFor } from '@/lib/cascade-timeline';
import { SymbolArt, type CascadeArtSymbol } from './symbols';
import styles from './info.module.css';

const ORDER: CascadePaySymbol[] = ['crown', 'cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry'];
const TIERS = ['12+', '10–11', '8–9'] as const;
const HIGH = new Set<CascadePaySymbol>(['crown', 'cupcake', 'donut', 'gumdrop']);

const bold = (chunk: string) => <strong key={chunk}>{chunk}</strong>;

/** "Ödeme tablosu" page: every amount is computed from the v2 engine tables and the current bet. */
export function PaytableContent({ betCents, t, format, symbol }: { betCents: number; t: Translator<'cascade'>; format: Formatter; symbol: (symbol: CascadeArtSymbol) => string }) {
  const amount = (h: number) => format.amount(centsFor(betCents, h));
  const times = (h: number) => format.amount(h);
  return (
    <div className={styles.page}>
      <p className={styles.lead}>{t.rich('info.pay.lead', { b: bold }, { bet: format.demo(betCents) })}</p>
      <ul className={styles.payGrid} aria-label={t('info.pay.symbolsAria')}>
        {ORDER.map(sym => {
          const [t8, t10, t12] = CASCADE2_PAYTABLE[sym];
          return (
            <li key={sym} className={`${styles.payCard} ${HIGH.has(sym) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><SymbolArt symbol={sym} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{symbol(sym)}</h4>
                <dl className={styles.payRows}>
                  {[t12, t10, t8].map((h, i) => (
                    <div key={TIERS[i]}>
                      <dt>{TIERS[i]}</dt>
                      <dd><strong>{amount(h)}</strong><small>{times(h)}×</small></dd>
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
            <h4>{t('info.pay.scatterTitle', { name: symbol('star') })}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.stars6')}</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[6])}</strong> <small>{times(CASCADE2_SCATTER_PAY[6])}×</small></dd></div>
              <div><dt>{t('info.pay.stars5')}</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[5])}</strong> <small>{times(CASCADE2_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>{t('info.pay.stars4')}</dt><dd><strong>{amount(CASCADE2_SCATTER_PAY[4])}</strong> <small>{times(CASCADE2_SCATTER_PAY[4])}×</small></dd></div>
            </dl>
            <p>{t.rich('info.pay.scatterText', { b: bold }, { spins: CASCADE_FREE_SPINS_TRIGGER })}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><SymbolArt symbol="crystal" multiplier={10} size="100%" /></span>
          <div>
            <h4>{symbol('crystal')}</h4>
            <p>{t.rich('info.pay.crystalText', { b: bold })}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { n: format.number(CASCADE2_MAX_WIN_MULTIPLIER, 0) })}</h4>
            <p>{t.rich('info.pay.maxText', { b: bold }, { amount: format.demo(betCents * CASCADE2_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
