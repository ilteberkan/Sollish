'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GoremeFrame } from './frame';
import { GoremeFx, goremePointOf } from './fx';
import { GoremeLogo } from './logo';
import { GoremeScene, GoremeStage, type GoremeMood, type GoremeSceneHandle } from './scene';
import { GoremeSkyBand, type GoremeMooredBalloon } from './sky-band';
import {
  GOREME_SYMBOLS, GOREME_SYMBOL_LABELS, GoremeSymbol, GoremeSymbolSprites, goremeMergedSize,
  type GoremeSymbolId, type GoremeSymbolState,
} from './symbols';
import styles from './art.module.css';

/* Dev-only gallery for the Göreme art (app/lab/goreme-art, notFound in production). The hero is a full composition
   (scene + logo + sky band + reel window) with buttons for every FX helper and a cosmetic lift step that shows how
   the game screen should animate `lift` steps: burner puff → move up one row with the wind → merge burst when two
   meet → exit (base: fly away · feature: moor in the sky band, sky multiplier grows). Lab randomness is Math.random
   and nothing here touches a balance; the real lift rules live in the engine (goreme-balloons-1). */

const PAY: GoremeSymbolId[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
const STATES: GoremeSymbolState[] = ['idle', 'win', 'land', 'dim'];
const COLS = 6, ROWS = 5;
const IDLE: GoremeSymbolId[][] = [
  ['h1', 'l2', 'l4', 'h3', 'l1'],
  ['l3', 'h2', 'l5', 'l1', 'h4'],
  ['h4', 'l1', 'sun', 'l3', 'l2'],
  ['l5', 'h3', 'l2', 'h1', 'l4'],
  ['l2', 'l4', 'h1', 'l5', 'h2'],
  ['h2', 'l5', 'l3', 'h4', 'l1'],
];
interface Flyer { id: number; c: number; r: number; m: number; parts: number; exit?: boolean }
const START: Flyer[] = [{ id: 1, c: 1, r: 3, m: 2, parts: 1 }, { id: 2, c: 4, r: 2, m: 3, parts: 1 }, { id: 3, c: 5, r: 2, m: 1, parts: 1 }];
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
let nextId = 100;

function Hero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const scene = useRef<GoremeSceneHandle>(null);
  const fx = useRef<GoremeFx | null>(null);
  const [mood, setMood] = useState<GoremeMood>('base');
  const [grid, setGrid] = useState(() => IDLE.map((c) => c.map((s, r) => ({ s, k: c.length * 10 + r }))));
  const [flyers, setFlyers] = useState<Flyer[]>(START);
  const [moored, setMoored] = useState<GoremeMooredBalloon[]>([]);
  const [sky, setSky] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [highlight, setHighlight] = useState(false);
  const flyRef = useRef(flyers);
  flyRef.current = flyers;
  const feature = mood === 'feature';

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const f = new GoremeFx({ root, canvas });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
  }, []);

  const cellPoint = useCallback((c: number, r: number, fy = 0.5) => {
    const root = rootRef.current, well = wellRef.current;
    if (!root || !well) return { x: 0, y: 0 };
    const p = goremePointOf(root, well, (c + 0.5) / COLS, (r + fy) / ROWS);
    return p;
  }, []);
  const cellScale = () => (wellRef.current ? wellRef.current.getBoundingClientRect().width / COLS / 100 : 1);

  const respin = useCallback((cells: Array<[number, number]>) => {
    setGrid((g) => g.map((col, c) => col.map((x, r) => (cells.some(([cc, rr]) => cc === c && rr === r) ? { s: PAY[Math.floor(Math.random() * PAY.length)]!, k: nextId++ } : x))));
  }, []);

  const lift = useCallback(async () => {
    const f = fx.current;
    const before = flyRef.current;
    if (!before.length) { setStatus('Tahtada balon yok · "Balon indir"'); return; }
    setBusy(true);
    const wind = ([-1, 0, 1] as const)[Math.floor(Math.random() * 3)]!;
    setStatus(`Kalkış · rüzgâr ${wind < 0 ? '← sol' : wind > 0 ? 'sağ →' : 'durgun'}`);
    for (const b of before) { const p = cellPoint(b.c, b.r, 0.78); void f?.flame(p.x, p.y, { power: b.parts > 1 ? 1.6 : 1 }); }
    await sleep(220);
    const moved = before.map((b) => ({ ...b, r: b.r - 1, c: Math.max(0, Math.min(COLS - 1, b.c + wind)), m: Math.min(25, b.m + 1) }));
    setFlyers(moved.map((b) => (b.r < 0 ? { ...b, exit: true } : b)));
    await sleep(780);
    // merges
    const byCell = new Map<string, Flyer[]>();
    for (const b of moved) if (b.r >= 0) { const key = `${b.c},${b.r}`; byCell.set(key, [...(byCell.get(key) ?? []), b]); }
    const survivors: Flyer[] = [];
    for (const list of byCell.values()) {
      if (list.length === 1) { survivors.push(list[0]!); continue; }
      const m = Math.min(25, list.reduce((s, b) => s + b.m, 0)), parts = list.reduce((s, b) => s + b.parts, 0);
      const keep = { ...list[0]!, m, parts };
      survivors.push(keep);
      const p = cellPoint(keep.c, keep.r, 0.45);
      void f?.mergeBurst(p.x, p.y, { multiplier: m, scale: cellScale() * 1.4 });
      setStatus(`Birleşme ×${m}`);
    }
    const exits = moved.filter((b) => b.r < 0);
    if (exits.length && feature) {
      const add = exits.map((b) => ({ id: b.id, multiplier: b.m }));
      setMoored((m) => [...m, ...add]);
      setSky((s) => (moored.length === 0 && s === 1 ? 0 : s) + exits.reduce((t, b) => t + b.m, 0));
      window.setTimeout(() => {
        const band = bandRef.current, root = rootRef.current;
        if (band && root) { const p = goremePointOf(root, band, 0.5, 0.45); void f?.moorSparkle(p.x, p.y, { scale: 1.4 }); }
      }, 150);
    }
    setFlyers(survivors);
    // vacated cells respin
    const occupied = new Set(survivors.map((b) => `${b.c},${b.r}`));
    respin(before.filter((b) => !occupied.has(`${b.c},${b.r}`)).map((b) => [b.c, b.r] as [number, number]));
    await sleep(500);
    setBusy(false);
  }, [cellPoint, feature, moored.length, respin]);

  const drop = useCallback(() => {
    const taken = new Set(flyRef.current.map((b) => `${b.c},${b.r}`));
    const add: Flyer[] = [];
    for (let i = 0; i < 2; i++) {
      const c = Math.floor(Math.random() * COLS), r = 2 + Math.floor(Math.random() * 3);
      if (taken.has(`${c},${r}`)) continue;
      taken.add(`${c},${r}`);
      add.push({ id: nextId++, c, r, m: [1, 1, 2, 3, 5][Math.floor(Math.random() * 5)]!, parts: 1 });
    }
    setFlyers((f) => [...f, ...add]);
  }, []);

  const occupied = new Set(flyers.filter((b) => !b.exit).map((b) => `${b.c},${b.r}`));
  const board = (
    <GoremeFrame mood={feature ? 'feature' : 'base'} wellRef={wellRef}>
      <div className={styles.boardGrid}>
        {Array.from({ length: ROWS }, (_, r) => grid.map((col, c) => {
          const x = col[r]!;
          return (
            <div key={`${c}-${r}`} className={styles.cell} data-hidden={occupied.has(`${c},${r}`) || undefined}>
              <GoremeSymbol key={x.k} sprite symbol={x.s} state={highlight ? (x.s === 'h1' || x.s === 'sun' ? 'win' : 'dim') : x.k >= 100 ? 'land' : 'idle'} />
            </div>
          );
        }))}
      </div>
      <div className={styles.overlay}>
        {flyers.map((b) => (
          <div key={b.id} className={styles.flyer} data-exit={b.exit || undefined} style={{ ['--c' as string]: b.c, ['--r' as string]: b.r }}>
            <GoremeSymbol sprite symbol="balloon" multiplier={b.m} size={goremeMergedSize(b.parts)} state={b.id >= 100 && !b.exit ? 'land' : 'idle'} />
          </div>
        ))}
      </div>
    </GoremeFrame>
  );

  return (
    <>
    <div ref={rootRef} className={styles.hero}>
      <GoremeScene ref={scene} mood={mood}>
        <GoremeStage
          logo={<GoremeLogo />}
          skyBand={<div ref={bandRef}><GoremeSkyBand balloons={moored} multiplier={Math.max(1, sky)} active={feature} /></div>}
          board={board}
        />
      </GoremeScene>
      <canvas ref={canvasRef} className={styles.fxCanvas} />
      <div className={styles.status} role="status">{status}</div>
    </div>
      <div className={styles.toolbar}>
        {(['base', 'feature', 'bigwin'] as const).map((m) => <button key={m} type="button" aria-pressed={mood === m} onClick={() => setMood(m)}>{m === 'base' ? 'Temel' : m === 'feature' ? 'Şafak Şöleni' : 'Büyük kazanç'}</button>)}
        <button type="button" disabled={busy} onClick={() => void lift()}>Kalkış</button>
        <button type="button" onClick={drop}>Balon indir</button>
        <button type="button" aria-pressed={highlight} onClick={() => setHighlight((h) => !h)}>Kazanç vurgusu</button>
        <button type="button" onClick={() => { const b = flyRef.current[0]; if (b) { const p = cellPoint(b.c, b.r, 0.78); void fx.current?.flame(p.x, p.y, { power: 1.5 }); } }}>Alev</button>
        <button type="button" onClick={() => { const p = cellPoint(3, 2, 0.45); void fx.current?.mergeBurst(p.x, p.y, { multiplier: 7, scale: cellScale() * 1.4 }); }}>Birleşme</button>
        <button type="button" onClick={() => { const band = bandRef.current, root = rootRef.current; if (band && root) { const p = goremePointOf(root, band, 0.5, 0.45); void fx.current?.moorSparkle(p.x, p.y, { scale: 1.4 }); } }}>Demirleme</button>
        <button type="button" onClick={() => { const p = scene.current?.sunPoint(); if (p) void fx.current?.sunRays(p.x, p.y, { intensity: feature ? 2 : 1 }); }}>Güneş ışınları</button>
        <button type="button" onClick={() => { setFlyers(START); setMoored([]); setSky(1); setGrid(IDLE.map((c) => c.map((s, r) => ({ s, k: c.length * 10 + r })))); setStatus('Hazır'); }}>Sıfırla</button>
      </div>
    </>
  );
}

function SymbolTable() {
  return (
    <section className={styles.section}>
      <h2>Semboller × durumlar</h2>
      <p>Her sembol dört durumda: bekleme (balon salınır, güneş ışınları döner), kazanç vurgusu (nabız + hale, döngü), iniş (tek sefer; balon süzülerek iner, güneş parlayarak açılır), soluk (kazanmayan hücreler). Düşükler renk, açıklık ve biçimle ayrılır: baklava, altıgen, üçgen, koçboynuzu, dört yaprak.</p>
      <div className={styles.symTable}>
        <span />
        {STATES.map((s) => <span key={s} className={styles.head}>{s.toUpperCase()}</span>)}
        {GOREME_SYMBOLS.map((sym) => (
          <Row key={sym} sym={sym} />
        ))}
      </div>
    </section>
  );
}
function Row({ sym }: { sym: GoremeSymbolId }) {
  return (
    <>
      <span className={styles.symName}>{GOREME_SYMBOL_LABELS[sym]}<small>{sym}</small></span>
      {STATES.map((st) => <div key={st} className={styles.symCell}><GoremeSymbol sprite symbol={sym} state={st} multiplier={sym === 'balloon' ? 3 : undefined} /></div>)}
    </>
  );
}

function BalloonRow() {
  const mults = [1, 2, 3, 5, 8, 12, 15, 25];
  return (
    <section className={styles.section}>
      <h2>Balon joker · çarpan ve boyut</h2>
      <p>Çarpan rozeti ×1…×25; zarf renkleri kademeye göre değişir (×1–2 kök boya kırmızısı, ×3–5 turkuaz, ×6–12 erik, ×13–25 altın). Birleşen balonlar büyür (goremeMergedSize: 2 → 1,18 · 3 → 1,3 · 4+ → 1,45).</p>
      <div className={styles.row}>
        {mults.map((m) => <div key={m} className={styles.tile}><div className={styles.tileArt}><GoremeSymbol symbol="balloon" multiplier={m} /></div>×{m}</div>)}
      </div>
      <div className={styles.row} style={{ marginTop: 18 }}>
        {[1, 2, 3, 4].map((n) => <div key={n} className={styles.tile}><div className={styles.tileArt}><GoremeSymbol symbol="balloon" multiplier={[2, 7, 13, 25][n - 1]} size={goremeMergedSize(n)} /></div>{n} balon · boyut {goremeMergedSize(n)}</div>)}
      </div>
    </section>
  );
}

function Scenes() {
  return (
    <section className={styles.section}>
      <h2>Sahne · temel ve Şafak Şöleni</h2>
      <p>Şölende gökyüzü aydınlanır, güneş yükselir, ışın demetleri güçlenir ve fazladan balonlar belirir.</p>
      <div className={styles.scenePair}>
        <div className={styles.sceneBox}><span>Temel</span><GoremeScene mood="base" parallax={false} /></div>
        <div className={styles.sceneBox}><span>Şafak Şöleni</span><GoremeScene mood="feature" parallax={false} /></div>
      </div>
    </section>
  );
}

function Bands() {
  const eight: GoremeMooredBalloon[] = [3, 5, 2, 8, 4, 13, 6, 25].map((m, i) => ({ id: i, multiplier: m }));
  return (
    <section className={styles.section}>
      <h2>Gök kuşağı · 0 / 3 / 8 balon</h2>
      <p>Demirleyen balonlar ortadan dışa, sağ-sol sırayla dizilir; çoğaldıkça sıkışır. Gök çarpanı her değişimde zıplar.</p>
      <div className={styles.bands}>
        <div className={styles.bandRow}><b>0 · temel oyun</b><GoremeSkyBand balloons={[]} multiplier={1} active={false} /></div>
        <div className={styles.bandRow}><b>3 · Şölen</b><GoremeSkyBand balloons={eight.slice(0, 3)} multiplier={10} /></div>
        <div className={styles.bandRow}><b>8 · Şölen</b><GoremeSkyBand balloons={eight} multiplier={66} /></div>
      </div>
    </section>
  );
}

function LiftDemo() {
  return (
    <section className={styles.section}>
      <h2>Kalkış ve birleşme (yalnız CSS)</h2>
      <p>Rüzgâr sağa: her balon bir sıra yukarı ve bir makara sağa kayar. Sağ kenardaki balon (×2) kenarda durur; yanındaki (×3) onun hücresine gelir, ikisi tek büyük balona dönüşür (×3 + ×4 = ×7). Üst sıradaki balon tahtadan çıkıp uçar.</p>
      <div className={styles.demoWrap}>
        <div className={`${styles.frameDemo} ${styles.liftDemo}`}>
          <GoremeFrame crest={false}>
            <div className={styles.boardGrid}>
              {Array.from({ length: ROWS }, (_, r) => IDLE.map((col, c) => <div key={`${c}-${r}`} className={styles.cell}><GoremeSymbol sprite symbol={col[r] === 'sun' ? 'l4' : col[r]!} state="dim" label={null} /></div>))}
            </div>
            <div className={styles.overlay}>
              <div className={`${styles.demoCell} ${styles.demoA}`}><GoremeSymbol sprite symbol="balloon" multiplier={2} label={null} /></div>
              <div className={`${styles.demoCell} ${styles.demoB}`}><GoremeSymbol sprite symbol="balloon" multiplier={3} label={null} /></div>
              <div className={`${styles.demoCell} ${styles.demoC}`}><GoremeSymbol sprite symbol="balloon" multiplier={1} label={null} /></div>
              <div className={`${styles.demoCell} ${styles.demoM}`}><GoremeSymbol sprite symbol="balloon" multiplier={7} size={goremeMergedSize(2)} label={null} /></div>
              <div className={styles.demoRing} />
            </div>
            <span className={styles.wind}>rüzgâr →</span>
          </GoremeFrame>
        </div>
        <div>
          <p>Oyun ekranı aynı sırayı izler: alev (fx.flame) → hareket (transform geçişi) → birleşme (fx.mergeBurst + büyük balon) → çıkış (temel: uçup gider · Şölen: gök kuşağına demirler, fx.moorSparkle, Gök ×N artar) → boşalan hücreler yeniden döner (iniş durumu).</p>
        </div>
      </div>
    </section>
  );
}

function Brand() {
  return (
    <section className={styles.section}>
      <h2>Logo ve çerçeve</h2>
      <div className={styles.logoRow}>
        <GoremeLogo />
        <GoremeLogo subtitle={null} />
      </div>
      <div className={styles.scenePair} style={{ marginTop: 20 }}>
        <GoremeFrame />
        <GoremeFrame mood="feature" />
      </div>
    </section>
  );
}

export function GoremeArtLab() {
  return (
    <main className={styles.lab}>
      <GoremeSymbolSprites />
      <Hero />
      <div className={styles.gallery}>
        <SymbolTable />
        <BalloonRow />
        <Scenes />
        <Bands />
        <LiftDemo />
        <Brand />
      </div>
    </main>
  );
}
