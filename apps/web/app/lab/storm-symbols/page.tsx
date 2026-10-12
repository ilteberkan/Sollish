import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { orbTier, STORM_SYMBOL_LABELS, StormSymbolArt, StormSymbolSprites, StormSymbolUse, type StormSymbol } from '@/components/storm/symbols';
import { StormFrame } from '@/components/storm/frame';
import { StormLogo } from '@/components/storm/logo';
import styles from '@/components/storm/symbols.module.css';

export const metadata: Metadata = { title: 'Tarhun sembol galerisi', robots: { index: false, follow: false } };

const PAY: StormSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5', 'scatter'];
const ORBS = [2, 6, 20, 100, 500];
type Cell = [StormSymbol, number?];
const BOARD: Cell[] = [
  ['l1'], ['h1'], ['l3'], ['scatter'], ['l4'], ['h2'],
  ['l5'], ['h3'], ['orb', 25], ['l2'], ['h4'], ['l1'],
  ['l4'], ['l2'], ['h1'], ['l5'], ['orb', 6], ['h3'],
  ['l3'], ['h2'], ['l1'], ['h4'], ['scatter'], ['l4'],
  ['orb', 100], ['l5'], ['l2'], ['h1'], ['l3'], ['orb', 500],
];

function Board({ mood }: { mood: 'base' | 'feature' }) {
  return (
    <div className={styles.labBoardWrap} data-testid={`board-${mood}`}>
      <StormFrame mood={mood}>
        <div className={styles.labGrid}>
          {BOARD.map(([s, m], i) => <div key={i} className={styles.labCell}><StormSymbolUse symbol={s} multiplier={m} /></div>)}
        </div>
      </StormFrame>
    </div>
  );
}

export default function StormSymbolsLab() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className={styles.labPage}>
      <StormSymbolSprites />
      <div className={styles.labInner}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Tarhun: Fırtına Tahtı · sembol galerisi (yalnız geliştirme)</h1>
        <section aria-labelledby="s-logo">
          <h2 id="s-logo" className={styles.labH}>Logo</h2>
          <div className={styles.labLogos} data-testid="logos">
            <StormLogo size="min(100%, 520px)" variant="full" />
            <StormLogo size="min(100%, 300px)" variant="compact" />
          </div>
        </section>
        <section aria-labelledby="s-big">
          <h2 id="s-big" className={styles.labH}>Semboller, 120 px</h2>
          <div className={styles.labRow} data-testid="big">
            {PAY.map(s => (
              <div key={s} className={styles.labCard}>
                <StormSymbolArt symbol={s} size={120} />
                <span>{s} · {STORM_SYMBOL_LABELS[s]}</span>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="s-orb">
          <h2 id="s-orb" className={styles.labH}>Fırtına Taşı kademeleri</h2>
          <div className={styles.labRow} data-testid="orbs">
            {ORBS.map(m => (
              <div key={m} className={styles.labCard}>
                <StormSymbolArt symbol="orb" multiplier={m} size={120} />
                <span>×{m} · {orbTier(m)}</span>
              </div>
            ))}
            <div className={styles.labCard}>
              <StormSymbolArt symbol="orb" multiplier={250} size={120} />
              <span>×250 · {orbTier(250)}</span>
            </div>
          </div>
        </section>
        <section aria-labelledby="s-small">
          <h2 id="s-small" className={styles.labH}>56 px (okunabilirlik) · renkli ve gri tonlama</h2>
          <div className={styles.labCard} style={{ justifyItems: 'start' }} data-testid="small">
            <div className={styles.labSmallRow}>
              {PAY.map(s => <StormSymbolArt key={s} symbol={s} size={56} />)}
              {ORBS.map(m => <StormSymbolArt key={m} symbol="orb" multiplier={m} size={56} />)}
            </div>
            <div className={`${styles.labSmallRow} ${styles.labGray}`}>
              {PAY.map(s => <StormSymbolArt key={s} symbol={s} size={56} />)}
              {ORBS.map(m => <StormSymbolArt key={m} symbol="orb" multiplier={m} size={56} />)}
            </div>
            <span>üst: renkli · alt: gri tonlama (renk körlüğü için biçim farkı)</span>
          </div>
        </section>
        <section aria-labelledby="s-board">
          <h2 id="s-board" className={styles.labH}>6×5 örnek tahta (sprite &lt;use&gt;) · temel ve özellik modu</h2>
          <div className={styles.labBoards}>
            <Board mood="base" />
            <Board mood="feature" />
          </div>
        </section>
      </div>
    </main>
  );
}
