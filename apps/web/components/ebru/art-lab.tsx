'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { EBRU_SIN_TABLE, type EbruColour, type EbruSymbol } from '@sollish/protocol';
import { EbruScene, type EbruSceneHandle } from './scene';
import { EbruFrame } from './frame';
import { EbruLogo } from './logo';
import { EBRU_STAIN_VALUES, EBRU_SYMBOLS, EBRU_SYMBOL_LABELS, EbruStainArt, EbruStainUse, EbruSymbolArt, EbruSymbolSprites, EbruSymbolUse } from './symbols';
import { EbruWater, combRowTiming, ebruRng, shiftField, type EbruMood } from './water';
import styles from './art.module.css';

/* Dev-only gallery for the Ebru art (rendered by app/lab/ebru-art, notFound in production). The board here is
   a reference implementation of the presentation contract: rows slide with combRowTiming() (WAAPI, transform
   only, three copies of a row while it slides so the cyclic wrap is seamless) while EbruWater shears the
   water with the same curve. Demo randomness is Math.random; nothing here is a game round. */

const COLOURS: EbruColour[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
type Grid = EbruSymbol[][]; // [col][row]
const randSym = (rnd: () => number = Math.random): EbruSymbol => {
  const r = rnd();
  if (r < 0.03) return 'comb';
  if (r < 0.06) return 'drop';
  // lower colours more common
  const w = [5, 6, 7, 8, 9, 10, 11, 12];
  let t = rnd() * 68;
  for (let i = 0; i < 8; i++) { t -= w[i]!; if (t <= 0) return COLOURS[i]!; }
  return 'c8';
};
const newGrid = (): Grid => Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => randSym()));
/** SSR-stable first board (hydration). */
const firstGrid = (): Grid => { const r = ebruRng(2026); return Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => randSym(r))); };
const emptyStains = () => Array.from({ length: 7 }, () => new Array(7).fill(0) as number[]);
/** The engine's comb formula (docs/product/games-wave2.md §2) with a random A, p, q. */
function randomShifts() {
  const A = 1 + Math.floor(Math.random() * 3);
  const p = Math.floor(Math.random() * 64);
  const q = [3, 5, 6, 8, 10, 13][Math.floor(Math.random() * 6)]!;
  const shifts = Array.from({ length: 7 }, (_, r) => {
    const v = (A * EBRU_SIN_TABLE[(p + r * q) % 64]!) / 1000;
    return Math.sign(v) * Math.round(Math.abs(v));
  });
  return { A, p, q, shifts };
}
function shiftGrid(g: Grid, shifts: readonly number[]): Grid {
  const out: Grid = Array.from({ length: 7 }, () => new Array<EbruSymbol>(7));
  for (let c = 0; c < 7; c++) for (let r = 0; r < 7; r++) out[(((c + shifts[r]!) % 7) + 7) % 7]![r] = g[c]![r]!;
  return out;
}
/** A random connected blob of `n` cells. */
function blob(n: number) {
  const start = { col: Math.floor(Math.random() * 7), row: Math.floor(Math.random() * 7) };
  const cells = [start];
  const key = (c: { col: number; row: number }) => c.col * 7 + c.row;
  const seen = new Set([key(start)]);
  let guard = 0;
  while (cells.length < n && guard++ < 200) {
    const b = cells[Math.floor(Math.random() * cells.length)]!;
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)]!;
    const c = { col: b.col + d[0]!, row: b.row + d[1]! };
    if (c.col < 0 || c.col > 6 || c.row < 0 || c.row > 6 || seen.has(key(c))) continue;
    seen.add(key(c));
    cells.push(c);
  }
  return cells;
}

interface LabApi {
  comb: (duration?: number) => Promise<number[]>;
  dissolve: () => Promise<void>;
  bleed: () => Promise<void>;
  bloom: () => Promise<void>;
  stains: (on?: boolean) => void;
  deal: () => void;
  stats: () => unknown;
  setMood: (m: EbruMood) => void;
}
declare global { interface Window { __ebruLab?: LabApi } }

function LabBoard({ mood, onMood, scene, fpsOut }: { mood: EbruMood; onMood: (m: EbruMood) => void; scene: React.RefObject<EbruSceneHandle | null>; fpsOut: (s: string) => void }) {
  const [grid, setGrid] = useState<Grid>(firstGrid);
  const [stains, setStains] = useState<number[][] | null>(null);
  const [combing, setCombing] = useState(false);
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const wellRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const stripRefs = useRef<Array<HTMLDivElement | null>>([]);
  const engine = useRef<EbruWater | null>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const stainsRef = useRef(stains);
  stainsRef.current = stains;

  useEffect(() => {
    const host = wellRef.current, canvas = waterRef.current;
    if (!host || !canvas) return;
    const w = new EbruWater({ host, canvas, front: frontRef.current, mood });
    engine.current = w;
    return () => { w.destroy(); engine.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { engine.current?.setMood(mood); }, [mood]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = engine.current?.stats;
      if (s) fpsOut(`${s.fps.toFixed(0)} fps · kare ${s.avgMs.toFixed(1)} ms (en kötü ${s.worstMs.toFixed(0)}) · FX ${s.drawMs.toFixed(2)} ms (en kötü ${s.drawWorstMs.toFixed(1)}) · ${s.polys} boya / ${s.verts} köşe`);
    }, 1000);
    return () => window.clearInterval(id);
  }, [fpsOut]);

  const comb = useCallback(async (duration = 1700) => {
    const w = engine.current;
    if (!w) return [];
    const { A, shifts } = randomShifts();
    flushSync(() => setCombing(true));
    const anims: Animation[] = [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    shifts.forEach((s, r) => {
      const el = stripRefs.current[r];
      if (!el || !s) return;
      const t = combRowTiming(r, duration);
      anims.push(el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${(s * 100) / 7}%)` }], reduced ? { duration: 1, fill: 'forwards' } : { delay: t.delay, duration: t.duration, easing: t.easing, fill: 'forwards' }));
    });
    await w.combPass({ shifts, amplitude: A, duration });
    flushSync(() => {
      setGrid((g) => shiftGrid(g, shifts));
      setStains((st) => (st ? shiftField(st, shifts) : st));
      setCombing(false);
    });
    anims.forEach((a) => a.cancel());
    return shifts;
  }, []);

  const dissolve = useCallback(async () => {
    const w = engine.current;
    if (!w) return;
    const colour = COLOURS[Math.floor(Math.random() * 8)]!;
    const cells = blob(6 + Math.floor(Math.random() * 5));
    // paint the blob first so the cluster is real on the board
    flushSync(() => setGrid((g) => { const n = g.map((c) => c.slice()); for (const c of cells) n[c.col]![c.row] = colour; return n; }));
    await new Promise((r) => setTimeout(r, 450));
    flushSync(() => setGone(new Set(cells.map((c) => c.col * 7 + c.row))));
    const done = w.dissolve(cells.map((c) => ({ ...c, colour })));
    if (stainsRef.current) {
      const next = stainsRef.current.map((c) => c.slice());
      for (const c of cells) next[c.col]![c.row] = next[c.col]![c.row] ? Math.min(256, next[c.col]![c.row]! * 2) : 2;
      setStains(next);
      w.setStains(next);
    }
    await new Promise((r) => setTimeout(r, 560));
    flushSync(() => {
      setGrid((g) => { const n = g.map((c) => c.slice()); for (const c of cells) n[c.col]![c.row] = randSym(); return n; });
      setGone(new Set());
      setDropped(new Set(cells.map((c) => c.col * 7 + c.row)));
    });
    w.land(cells, 40, 0.8);
    await done;
    setDropped(new Set());
  }, []);

  const bleed = useCallback(async () => {
    const w = engine.current;
    if (!w) return;
    const col = 1 + Math.floor(Math.random() * 5), row = 1 + Math.floor(Math.random() * 5);
    flushSync(() => { setGrid((g) => { const n = g.map((c) => c.slice()); n[col]![row] = 'drop'; return n; }); setDropped(new Set([col * 7 + row])); });
    w.ripple(col, row, 1.2);
    await new Promise((r) => setTimeout(r, 650));
    const colour = COLOURS[Math.floor(Math.random() * 8)]!;
    const targets = [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]].map(([c, r]) => ({ col: c!, row: r! }));
    const done = w.bleed(col, row, colour, targets, 900);
    await new Promise((r) => setTimeout(r, 420));
    flushSync(() => {
      setGrid((g) => { const n = g.map((c) => c.slice()); n[col]![row] = colour; for (const t of targets) if (n[t.col]![t.row] !== 'comb') n[t.col]![t.row] = colour; return n; });
      setDropped(new Set([col * 7 + row, ...targets.map((t) => t.col * 7 + t.row)]));
    });
    await done;
    setDropped(new Set());
  }, []);

  const toggleStains = useCallback((on?: boolean) => {
    const w = engine.current;
    const want = on ?? !stainsRef.current;
    if (!want) { setStains(null); w?.setStains(null); return; }
    const f = emptyStains();
    for (let i = 0; i < 14; i++) f[Math.floor(Math.random() * 7)]![Math.floor(Math.random() * 7)] = EBRU_STAIN_VALUES[Math.floor(Math.random() * 8)]!;
    setStains(f);
    w?.setStains(f);
  }, []);

  const bloom = useCallback(async () => {
    const w = engine.current;
    if (!w) return;
    onMood('bigwin');
    scene.current?.glow(1);
    await w.bloom(1);
    await new Promise((r) => setTimeout(r, 1200));
    onMood('base');
  }, [onMood, scene]);

  const deal = useCallback(() => {
    const g = newGrid();
    setGrid(g);
    setDropped(new Set(Array.from({ length: 49 }, (_, i) => i)));
    const cells = [];
    for (let r = 6; r >= 0; r--) for (let c = 0; c < 7; c++) cells.push({ col: c, row: r });
    engine.current?.land(cells, 14, 0.6);
    window.setTimeout(() => setDropped(new Set()), 1400);
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } }, [busy]);

  useEffect(() => {
    window.__ebruLab = { comb, dissolve, bleed, bloom, stains: toggleStains, deal, stats: () => engine.current?.stats, setMood: onMood };
    return () => { delete window.__ebruLab; };
  }, [comb, dissolve, bleed, bloom, toggleStains, deal, onMood]);

  const rows = useMemo(() => Array.from({ length: 7 }, (_, r) => r), []);
  const copies = combing ? [-1, 0, 1] : [0];
  return (
    <div className={styles.labBoardWrap}>
      <div className={styles.controls}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(() => comb())} data-testid="comb">Tarak</button>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(dissolve)} data-testid="dissolve">Küme dağılsın</button>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(bleed)} data-testid="bleed">Damla yayılsın</button>
        <button type="button" className={styles.btn} data-on={stains ? '' : undefined} onClick={() => toggleStains()} data-testid="stains">Leke alanı</button>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(bloom)} data-testid="bloom">Çiçek ebrusu</button>
        <button type="button" className={styles.btn} disabled={busy} onClick={deal} data-testid="deal">Yeni dağıtım</button>
      </div>
      <EbruFrame mood={mood === 'base' ? 'base' : 'feature'} wellRef={wellRef}>
        <canvas ref={waterRef} className={styles.water} aria-hidden="true" />
        <div className={styles.grid} role="grid" aria-label="Ebru tahtası">
          {rows.map((r) => (
            <div key={r} className={styles.row} role="row">
              <div ref={(el) => { stripRefs.current[r] = el; }} className={styles.strip}>
                {copies.flatMap((j) => grid.map((col, c) => {
                  const sym = col[r]!;
                  const id = c * 7 + r;
                  const st = stains?.[c]?.[r] ?? 0;
                  return (
                    <div key={`${j}:${c}`} className={styles.cell} role="gridcell" aria-label={EBRU_SYMBOL_LABELS[sym]}
                      style={{ left: `${((c + 7 * j) * 100) / 7}%` }}
                      data-gone={j === 0 && gone.has(id) ? '' : undefined} data-drop={j === 0 && dropped.has(id) ? '' : undefined}>
                      <EbruSymbolUse symbol={sym} />
                      {st > 0 && <div className={styles.stainBadge}><EbruStainUse value={st} /></div>}
                    </div>
                  );
                }))}
              </div>
            </div>
          ))}
        </div>
        <canvas ref={frontRef} className={styles.front} aria-hidden="true" />
      </EbruFrame>
    </div>
  );
}

function Gallery() {
  return (
    <div className={styles.galleryPage}>
      <section className={styles.panel}>
        <h2>Semboller · 120 px</h2>
        <div className={styles.symGrid}>
          {EBRU_SYMBOLS.map((s) => (
            <figure key={s} className={styles.sym} data-testid={`sym-${s}`}>
              <EbruSymbolArt symbol={s} size={120} />
              <figcaption>{EBRU_SYMBOL_LABELS[s]} · {s}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>48 px (telefon hücresi) ve gri tonlama</h2>
        <div className={styles.smallRow}>{EBRU_SYMBOLS.map((s) => <EbruSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{EBRU_SYMBOLS.map((s) => <EbruSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{EBRU_SYMBOLS.map((s) => <EbruSymbolUse key={s} symbol={s} className={styles.s120} />)}</div>
      </section>
      <section className={styles.panel}>
        <h2>Boya lekesi çarpanları ×2 … ×256</h2>
        <div className={styles.smallRow}>{EBRU_STAIN_VALUES.map((v) => <EbruStainArt key={v} value={v} size={96} />)}</div>
        <div className={styles.smallRow}>{EBRU_STAIN_VALUES.map((v) => <EbruStainUse key={v} value={v} className={styles.s48} />)}</div>
      </section>
      <section className={styles.panel}>
        <h2>Logo</h2>
        <div className={styles.logoRow}>
          <div style={{ width: 'min(520px, 100%)' }}><EbruLogo /></div>
          <div style={{ width: 200 }}><EbruLogo subtitle={false} /></div>
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Çerçeve · temel / özellik</h2>
        <div className={styles.frameRow}>
          {(['base', 'feature'] as const).map((m) => (
            <div key={m} style={{ width: 'min(420px, 100%)' }}>
              <EbruFrame mood={m}>
                <div className={styles.miniGrid}>{Array.from({ length: 49 }, (_, i) => <EbruSymbolUse key={i} symbol={EBRU_SYMBOLS[(i * 7 + (i % 3)) % 10]!} />)}</div>
              </EbruFrame>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function EbruArtLab() {
  const [tab, setTab] = useState<'scene' | 'gallery'>('scene');
  const [mood, setMood] = useState<EbruMood>('base');
  const [fps, setFps] = useState('');
  const scene = useRef<EbruSceneHandle>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') === 'gallery') setTab('gallery');
  }, []);
  return (
    <main className={styles.lab}>
      <EbruSymbolSprites />
      <div className={styles.bar}>
        <button type="button" className={styles.btn} data-on={tab === 'scene' ? '' : undefined} onClick={() => setTab('scene')} data-testid="tab-scene">Sahne</button>
        <button type="button" className={styles.btn} data-on={tab === 'gallery' ? '' : undefined} onClick={() => setTab('gallery')} data-testid="tab-gallery">Galeri</button>
        {tab === 'scene' && ([['base', 'Temel'], ['feature', 'Özellik'], ['bigwin', 'Büyük kazanç']] as const).map(([m, l]) => (
          <button key={m} type="button" className={styles.btn} data-on={mood === m ? '' : undefined} onClick={() => setMood(m)} data-testid={`mood-${m}`}>{l}</button>
        ))}
        {tab === 'scene' && <span className={styles.mono} data-testid="fps">{fps}</span>}
      </div>
      {tab === 'scene' ? (
        <EbruScene ref={scene} mood={mood} className={styles.labScene}>
          <div className={styles.labStage}>
            <div className={styles.labLogo}><EbruLogo /></div>
            <LabBoard mood={mood} onMood={setMood} scene={scene} fpsOut={setFps} />
          </div>
        </EbruScene>
      ) : <Gallery />}
    </main>
  );
}
