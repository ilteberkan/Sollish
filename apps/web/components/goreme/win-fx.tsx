'use client';
/**
 * Göreme win presentation overlay (inside the board, above the cells): what a ways win shows besides the cell glow.
 *   summary (all wins)  every winning cell throws a kilim-diamond spark burst; a big board also bursts (the symbols swell
 *                       and shatter into kilim shards, then re-form: Göreme's symbols never tumble, the board stays the
 *                       engine board); one label per way lists its share of the payout.
 *   way (focus)         the focused way is traced reel by reel, left to right: every winning cell on reel r is joined to
 *                       every winning cell on reel r + 1 (that is what a "way" is), with a kilim node on each cell; its
 *                       label is shown large.
 * Presentation only: the overlay never decides anything, it draws ids the engine listed. Only transform / opacity
 * animate (win-fx.module.css). `fx` false (reduced motion or reduced effects): no sparks, no bursts, no drawing
 * animation; the highlight, the connections and the labels stay, static.
 */
import { memo, type CSSProperties } from 'react';
import type { GoremeSymbol as EngineSymbol } from '@sollish/protocol';
import styles from './win-fx.module.css';

export interface GoremeWinShowLine {
  symbol: EngineSymbol;
  /** Engine cell ids of the run (symbol and balloon cells). */
  cells: readonly number[];
  /** Full label ("Avanos Çömleği 3× · 9 yol · ×6 = 4,80"). */
  text: string;
  amountCents: number;
}
export interface GoremeWinShow {
  key: number;
  lines: readonly GoremeWinShowLine[];
  /** Index of the focused way, or null for the all-wins summary. */
  focus: number | null;
  burst: boolean;
  fx: boolean;
  /** Length of this beat (summary or one way), ms. */
  ms: number;
}
export interface GoremeWinSpot { id: number; col: number; row: number }

/** Kilim spark directions (deg): six rays, alternating long and short like a woven star (kept low: software rasterisers). */
const RAYS = [0, 60, 120, 180, 240, 300];
/** Summary labels shown before the "+N" chip. */
const SUMMARY_LABELS = 3;

export const GoremeWinFx = memo(function GoremeWinFx({ show, spots }: { show: GoremeWinShow; spots: ReadonlyMap<number, GoremeWinSpot> }) {
  const focusLine = show.focus === null ? null : show.lines[show.focus] ?? null;
  const ids = focusLine ? focusLine.cells : [...new Set(show.lines.flatMap(l => l.cells))];
  const cells = ids.map(id => spots.get(id)).filter((s): s is GoremeWinSpot => !!s);
  // connections of the focused way: every cell on reel c to every cell on reel c + 1
  const byCol = new Map<number, GoremeWinSpot[]>();
  if (focusLine) for (const c of cells) byCol.set(c.col, [...(byCol.get(c.col) ?? []), c]);
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  // summary: biggest ways first; past SUMMARY_LABELS only a "+N" chip shows (each way still gets its own focus beat), so the
  // list never covers the board's lower rows. The hidden labels stay in the DOM (the amounts still sum to the payout).
  const labels = focusLine ? [{ line: focusLine, index: show.focus! }]
    : show.lines.map((line, index) => ({ line, index })).sort((a, b) => b.line.amountCents - a.line.amountCents || a.index - b.index);
  const more = focusLine ? 0 : Math.max(0, labels.length - SUMMARY_LABELS);
  return (
    <div key={show.key} className={styles.layer} data-fx={show.fx || undefined} data-burst={show.burst && show.focus === null ? '' : undefined}
      data-mode={focusLine ? 'way' : 'all'} data-testid="goreme-win-fx" style={{ '--ms': `${show.ms}ms` } as CSSProperties}>
      {focusLine && cols.length > 1 && (
        <svg className={styles.ways} viewBox="0 0 600 500" preserveAspectRatio="none" aria-hidden="true" data-testid="goreme-way-trace">
          {cols.slice(0, -1).map((col, i) => (
            <g key={col} className={styles.seg} style={{ '--i': i } as CSSProperties}>
              {byCol.get(col)!.flatMap(a => (byCol.get(cols[i + 1]!) ?? []).map(b => (
                <g key={`${a.id}-${b.id}`}>
                  <line className={styles.glow} x1={a.col * 100 + 50} y1={a.row * 100 + 50} x2={b.col * 100 + 50} y2={b.row * 100 + 50} vectorEffect="non-scaling-stroke" />
                  <line x1={a.col * 100 + 50} y1={a.row * 100 + 50} x2={b.col * 100 + 50} y2={b.row * 100 + 50} vectorEffect="non-scaling-stroke" />
                </g>
              )))}
            </g>
          ))}
        </svg>
      )}
      {focusLine && cells.map(c => <span key={`n${c.id}`} className={styles.node} style={{ '--c': c.col, '--r': c.row, '--i': cols.indexOf(c.col) } as CSSProperties} aria-hidden="true" />)}
      {show.fx && cells.map(c => (
        <span key={`s${c.id}`} className={styles.spark} style={{ '--c': c.col, '--r': c.row, '--i': focusLine ? cols.indexOf(c.col) : c.col } as CSSProperties} aria-hidden="true" data-testid="goreme-win-spark">
          <b />
          {RAYS.map((deg, k) => <i key={deg} style={{ '--a': `${deg}deg`, '--k': k % 2 } as CSSProperties} />)}
        </span>
      ))}
      <ol className={styles.labels} data-testid="goreme-win-labels" data-mode={focusLine ? 'way' : 'all'}>
        {labels.map(({ line, index }, n) => (
          <li key={index} className={styles.label} data-testid="goreme-win-label" data-cents={line.amountCents} data-symbol={line.symbol}
            data-extra={n >= SUMMARY_LABELS && !focusLine ? '' : undefined} style={{ '--n': n } as CSSProperties}>{line.text}</li>
        ))}
        {more > 0 && <li className={`${styles.label} ${styles.more}`} aria-hidden="true" data-testid="goreme-win-more" style={{ '--n': SUMMARY_LABELS } as CSSProperties}>+{more}</li>}
      </ol>
    </div>
  );
});
