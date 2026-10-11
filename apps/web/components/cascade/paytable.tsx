'use client';
import { useEffect, useRef } from 'react';
import { CASCADE_MAX_WIN_MULTIPLIER, CASCADE_PAYTABLE, CASCADE_SCATTER_PAY, type CascadePaySymbol } from '@sollish/protocol';
import { containDialogFocus } from '@/lib/dialog';
import { demoNumber } from '@/lib/demo';
import { centsFor, moneyText, multiplierText } from '@/lib/cascade-timeline';
import { SYMBOL_LABELS, SymbolArt } from './symbols';
import styles from './cascade-game.module.css';

const ORDER: CascadePaySymbol[] = ['crown', 'cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry'];
const TIERS = ['8–9', '10–11', '12+'] as const;

/** "Ödeme tablosu": every value is computed from the engine's own tables, scaled to the current bet. */
export function Paytable({ open, onClose, stakeCents }: { open: boolean; onClose: () => void; stakeCents: number | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current; if (!node) return;
    if (open && !node.open) node.showModal(); else if (!open && node.open) node.close();
  }, [open]);
  const amount = (h: number) => (stakeCents === null ? null : moneyText(centsFor(stakeCents, h)));
  return (
    <dialog ref={dialog} className={styles.paytable} aria-labelledby="cc-paytable-title" onClose={onClose} onKeyDown={containDialogFocus}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.paytableInner}>
        <div className={styles.paytableHead}>
          <h2 id="cc-paytable-title">Ödeme tablosu</h2>
          <button type="button" className={styles.paytableClose} onClick={onClose} aria-label="Ödeme tablosunu kapat">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <p className={styles.paytableLead}>
          Aynı sembolden ızgarada <strong>her yerde 8 veya daha fazla</strong> varsa kazanırsın. Değerler bahsin katıdır{stakeCents !== null ? <>; altındaki küçük rakam, {demoNumber(stakeCents)} DEMO bahiste brüt DEMO karşılığıdır</> : null}.
        </p>
        <table className={styles.payTable}>
          <caption className="sr-only">Sembol başına üç kademe ödeme</caption>
          <thead><tr><th scope="col">Sembol</th>{TIERS.map(t => <th key={t} scope="col">{t}</th>)}</tr></thead>
          <tbody>
            {ORDER.map(symbol => (
              <tr key={symbol}>
                <th scope="row"><span className={styles.paySymbol}><span className={styles.payIcon}><SymbolArt symbol={symbol} size={40} /></span><span>{SYMBOL_LABELS[symbol]}</span></span></th>
                {CASCADE_PAYTABLE[symbol].map((h, i) => (
                  <td key={i}><strong>{multiplierText(h)}×</strong>{amount(h) !== null && <small>{amount(h)}</small>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.payRules}>
          <section>
            <span className={styles.payIcon}><SymbolArt symbol="star" size={44} /></span>
            <div>
              <h3>{SYMBOL_LABELS.star}</h3>
              <p>Temel dönüş bitince ızgarada 4 yıldız <strong>{multiplierText(CASCADE_SCATTER_PAY[4])}×</strong>, 5 yıldız <strong>{multiplierText(CASCADE_SCATTER_PAY[5])}×</strong>, 6 veya daha fazla yıldız <strong>{multiplierText(CASCADE_SCATTER_PAY[6])}×</strong> öder ve 10 bedava dönüş açar. Bedava dönüşte 3 veya daha fazla yıldız 5 dönüş ekler (ödeme yok). Yıldızlar patlamaz.</p>
            </div>
          </section>
          <section>
            <span className={styles.payIcon}><SymbolArt symbol="crystal" multiplier={5} size={44} /></span>
            <div>
              <h3>{SYMBOL_LABELS.crystal}</h3>
              <p>Yalnız bedava dönüşte düşer, 2× ile 100× arası değer taşır. Dönüş bitince ızgaradaki kristallerin değerleri <strong>toplanır</strong>; o dönüşün kazancı sıfırdan büyükse kazanç bu toplamla çarpılır.</p>
            </div>
          </section>
          <section className={styles.payMax}>
            <div>
              <h3>Azami kazanç {new Intl.NumberFormat('tr-TR').format(CASCADE_MAX_WIN_MULTIPLIER)}×</h3>
              <p>Tur toplamı bahsin {new Intl.NumberFormat('tr-TR').format(CASCADE_MAX_WIN_MULTIPLIER)} katına ulaşırsa tur hemen biter; kalan bedava dönüşler oynanmaz.</p>
            </div>
          </section>
        </div>
        <p className={styles.payRtp}>Simülasyonla ölçülen teorik dönüş ≈ %95,8 (20 milyon tur, %95 GA 95,2–96,4); DEMO değersizdir.</p>
      </div>
    </dialog>
  );
}
