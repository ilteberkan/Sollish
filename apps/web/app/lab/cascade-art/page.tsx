import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BoardFrame, CascadeBackdrop } from '@/components/cascade/backdrop';
import { crystalTier, SYMBOL_LABELS, SymbolArt, type CascadeArtSymbol } from '@/components/cascade/symbols';
import styles from '@/components/cascade/art.module.css';

export const metadata: Metadata = { title: 'Candy Cascade sanat galerisi', robots: { index: false, follow: false } };

const PAY: CascadeArtSymbol[] = ['crown', 'cupcake', 'donut', 'gumdrop', 'strawberry', 'blueberry', 'kiwi', 'lemon', 'cherry'];
const CRYSTALS = [2, 6, 12, 25, 100];
type Cell = [CascadeArtSymbol, number?];
const BOARD: Cell[] = [
  ['cherry'], ['crown'], ['strawberry'], ['star'], ['kiwi'], ['gumdrop'],
  ['lemon'], ['donut'], ['crystal', 25], ['blueberry'], ['cupcake'], ['cherry'],
  ['kiwi'], ['strawberry'], ['crown'], ['lemon'], ['crystal', 6], ['donut'],
  ['blueberry'], ['gumdrop'], ['cherry'], ['cupcake'], ['star'], ['kiwi'],
  ['crystal', 100], ['lemon'], ['strawberry'], ['donut'], ['blueberry'], ['crystal', 2],
];

export default function CascadeArtLab() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className={styles.labPage}>
      <div className={styles.labInner}>
        <h1 style={{ fontSize: 26 }}>Candy Cascade sanat galerisi (yalnız geliştirme)</h1>
        <section aria-labelledby="g-big">
          <h2 id="g-big" className={styles.labH}>Semboller, 120 px</h2>
          <div className={styles.labRow}>
            {([...PAY, 'star'] as CascadeArtSymbol[]).map((s) => (
              <div key={s} className={styles.labCard} data-testid={`big-${s}`}>
                <SymbolArt symbol={s} size={120} />
                <span>{SYMBOL_LABELS[s]}</span>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="g-small">
          <h2 id="g-small" className={styles.labH}>56 px (okunabilirlik testi)</h2>
          <div className={styles.labCard} style={{ justifyItems: 'start' }}>
            <div className={styles.labSmallRow}>
              {([...PAY, 'star'] as CascadeArtSymbol[]).map((s) => <SymbolArt key={s} symbol={s} size={56} />)}
              {CRYSTALS.map((m) => <SymbolArt key={m} symbol="crystal" multiplier={m} size={56} />)}
            </div>
            <div className={styles.labSmallRow} style={{ filter: 'grayscale(1)' }}>
              {([...PAY, 'star'] as CascadeArtSymbol[]).map((s) => <SymbolArt key={s} symbol={s} size={56} />)}
              {CRYSTALS.map((m) => <SymbolArt key={m} symbol="crystal" multiplier={m} size={56} />)}
            </div>
            <span>üst: renkli · alt: gri tonlama (renk körlüğü için biçim farkı)</span>
          </div>
        </section>
        <section aria-labelledby="g-crystal">
          <h2 id="g-crystal" className={styles.labH}>Çarpan kristali kademeleri</h2>
          <div className={styles.labRow}>
            {CRYSTALS.map((m) => (
              <div key={m} className={styles.labCard}>
                <SymbolArt symbol="crystal" multiplier={m} size={120} />
                <span>{m}× · {crystalTier(m)}</span>
              </div>
            ))}
            <div className={styles.labCard}>
              <SymbolArt symbol="crystal" multiplier={50} size={120} />
              <span>50× · {crystalTier(50)}</span>
            </div>
          </div>
        </section>
        <section aria-labelledby="g-bd">
          <h2 id="g-bd" className={styles.labH}>Arka plan (gece şekerhanesi)</h2>
          <div className={styles.labBackdropOnly}><CascadeBackdrop /></div>
        </section>
        <section aria-labelledby="g-board">
          <h2 id="g-board" className={styles.labH}>6×5 örnek tahta</h2>
          <div className={styles.labStage} data-testid="board-stage">
            <CascadeBackdrop />
            <div className={styles.labBoardWrap}>
              <BoardFrame>
                <div className={styles.labGrid}>
                  {BOARD.map(([s, m], i) => (
                    <div key={i} className={styles.labCell}><SymbolArt symbol={s} multiplier={m} /></div>
                  ))}
                </div>
              </BoardFrame>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
