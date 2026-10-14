'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { playCezeriRound, type CezeriMode, type CezeriPos, type CezeriSymbol } from '@sollish/protocol';
import { CezeriBoard, type CezeriBoardHandle, type CezeriBoardSlices, type CezeriRingTarget } from './board';
import { CezeriFrame } from './frame';
import { CezeriFx, type CezeriMood } from './fx';
import { CezeriLogo } from './logo';
import { CezeriReservoir } from './meter';
import { CezeriScene, type CezeriSceneHandle } from './scene';
import { CEZERI_SYMBOLS, CEZERI_SYMBOL_LABELS, CezeriSymbolArt, CezeriSymbolSprites, CezeriSymbolUse } from './symbols';
import styles from './art.module.css';

/* Dev-only gallery for the Cezeri art (rendered by app/lab/cezeri-art, notFound in production). The lab board is
   the reference player of the presentation contract: it turns engine steps (hub / rotate / win / lock / end /
   scatter / falcon) into board + FX + scene calls, either from a hand-written sample chain (rotate → win → lock
   → hub +1 → all rings respin under the clamps → …) or from a real playCezeriRound() round. Demo randomness
   (seeds, filler symbols) is Math.random; nothing here touches a balance. */

const PAY: CezeriSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4'];
const LOW_W = [3, 4, 4, 5, 7, 7, 8, 8];
function seeded(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickPay = (r: () => number) => { let t = r() * 46; for (let i = 0; i < 8; i++) { t -= LOW_W[i]!; if (t <= 0) return PAY[i]!; } return 'l4' as CezeriSymbol; };
/** A board without accidental spoke runs (no two neighbouring rings share a symbol on a spoke). */
function quietBoard(r: () => number, keep?: Map<string, CezeriSymbol>): CezeriBoardSlices {
  const b: CezeriBoardSlices = Array.from({ length: 4 }, () => new Array<CezeriSymbol>(12));
  for (let s = 0; s < 12; s++) for (let ring = 0; ring < 4; ring++) {
    const k = keep?.get(`${ring},${s}`);
    if (k) { b[ring]![s] = k; continue; }
    let sym: CezeriSymbol;
    do { sym = r() < 0.04 ? 'vessel' : pickPay(r); } while (ring > 0 && sym === b[ring - 1]![s]);
    b[ring]![s] = sym;
  }
  return b;
}
const FIRST = quietBoard(seeded(2026));
/** cezeri-gears-1 (held-slice rule): base spin with 10 respins, hub 2 → 12, 120.34 × bet. */
const LONG_CHAIN_SEED = '643d50cc643d50cc643d50cc643d50cc';
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const ringsOf = (b: CezeriBoardSlices, held: Set<string>): CezeriRingTarget[] => b.map((slices, ring) => ({ ring, slices, held: [...held].filter((k) => k.startsWith(`${ring},`)).map((k) => Number(k.split(',')[1])) }));

interface LabApi { [k: string]: (...a: never[]) => unknown }
declare global { interface Window { __cezeriLab?: LabApi } }

function LabBoard({ mood, onMood, scene, fpsOut, statusOut }: { mood: CezeriMood; onMood: (m: CezeriMood) => void; scene: React.RefObject<CezeriSceneHandle | null>; fpsOut: (s: string) => void; statusOut: (s: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const board = useRef<CezeriBoardHandle>(null);
  const fx = useRef<CezeriFx | null>(null);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [reservoir, setReservoir] = useState(0);
  const [speed, setSpeed] = useState(1);
  const cur = useRef<CezeriBoardSlices>(FIRST.map((r) => r.slice()));
  const hubVal = useRef(1);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const f = new CezeriFx({ host, canvas, board: board.current?.element ?? null, mood });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { fx.current?.setMood(mood); }, [mood]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = fx.current?.stats;
      if (s) fpsOut(`${s.running ? `${s.fps.toFixed(0)} fps · kare ${s.avgMs.toFixed(1)} ms (en kötü ${s.worstMs.toFixed(0)})` : 'FX boşta'} · FX çizim ${s.drawMs.toFixed(2)} ms (en kötü ${s.drawWorstMs.toFixed(1)}) · ${s.particles} parçacık`);
    }, 1000);
    return () => window.clearInterval(id);
  }, [fpsOut]);

  const B = () => board.current!, F = () => fx.current!;
  const spin = useCallback(async (next: CezeriBoardSlices, held = new Set<string>()) => {
    setSpinning(true);
    await B().rotate(ringsOf(next, held), { speed, onRingStop: (ring) => { B().jolt(0.35); F().sparksAt(F().cell(ring, 0), 0); } });
    cur.current = next.map((r) => r.slice());
    setSpinning(false);
  }, [speed]);
  const hubTick = useCallback(async (v: number) => {
    hubVal.current = v;
    scene.current?.strike();
    B().jolt(1);
    await Promise.all([B().hub(v, 'respin'), F().hubTick(v)]);
  }, [scene]);
  const win = useCallback(async (spoke: number, len: number) => {
    const cells: CezeriPos[] = Array.from({ length: len }, (_, r) => [r, spoke] as const);
    B().showWin(cells, spoke);
    await F().spokeBeam(spoke, len, { duration: 720 * speed });
  }, [speed]);
  const lock = useCallback(async (cells: CezeriPos[]) => {
    B().jolt(0.8);
    await Promise.all([B().lock(cells), F().lock(cells)]);
  }, []);

  /** The sample chain for the revised Dişli Kilidi rule: winners stick, all four rings respin underneath, hub +1. */
  const sample = useCallback(async () => {
    const r = seeded(Math.floor(Math.random() * 1e9));
    statusOut('Dönüş · göbek ×2');
    B().clearWins();
    await B().release();
    await B().hub(2, 'spin'); hubVal.current = 2;
    const keep0 = new Map<string, CezeriSymbol>([['0,3', 'h1'], ['1,3', 'h1'], ['2,3', 'gear'], ['0,8', 'l2'], ['1,8', 'l2'], ['2,8', 'l2'], ['3,8', 'l2']]);
    const b0 = quietBoard(r, keep0);
    if (b0[3]![3] === 'h1') b0[3]![3] = 'l3';
    await spin(b0);
    statusOut('Kazanç: ışın 4 (Fil Saati ×3) · ışın 9 (Çini Yıldızı ×4)');
    await win(3, 3);
    await win(8, 4);
    statusOut('Dişli Kilidi: kazanan dilimler kenetlendi');
    const held = new Set(['0,3', '1,3', '2,3', '0,8', '1,8', '2,8', '3,8']);
    await lock([[0, 3], [1, 3], [2, 3], [0, 8], [1, 8], [2, 8], [3, 8]]);
    statusOut('Çark döndü · göbek +1 → ×3');
    await hubTick(3);
    B().clearWins();
    const keep1 = new Map(keep0); keep1.set('3,3', 'h1'); keep1.set('0,0', 'h3'); keep1.set('1,0', 'h3'); keep1.set('2,0', 'h3');
    const b1 = quietBoard(r, keep1);
    await spin(b1, held);
    statusOut('Yeni kazanç: ışın 4 uzadı (×4) · ışın 1 (Su Saati Kalesi ×3)');
    await win(3, 4);
    await win(0, 3);
    await lock([[3, 3], [0, 0], [1, 0], [2, 0]]);
    for (const k of ['3,3', '0,0', '1,0', '2,0']) held.add(k);
    statusOut('Çark döndü · göbek +1 → ×4');
    await hubTick(4);
    B().clearWins();
    const keep2 = new Map(keep1);
    const b2 = quietBoard(r, keep2);
    await spin(b2, held);
    statusOut('Yeni kazanç yok · zincir bitti (2 yeniden dönüş, göbek ×4)');
    await sleep(500);
    await B().release();
  }, [hubTick, lock, spin, statusOut, win]);

  /** Plays a real engine round (any mode) through the same calls. */
  const real = useCallback(async (mode: CezeriMode = 'standard', fixedSeed?: string) => {
    const words = crypto.getRandomValues(new Uint32Array(4));
    const seed = fixedSeed ?? Array.from(words, (w) => w.toString(16).padStart(8, '0')).join('');
    const round = playCezeriRound(seed, 100, mode);
    let total = 0;
    B().clearWins();
    await B().release();
    B().setPinned([]);
    setReservoir(0);
    for (const sp of round.spins) {
      if (sp.kind === 'free') { onMood('feature'); statusOut(`Fil Saati · bedava dönüş ${sp.index} · kalan ${sp.freeSpinsLeft}`); }
      const held = new Set<string>();
      for (const st of sp.steps) {
        switch (st.type) {
          case 'hub':
            if (st.reason === 'respin') await hubTick(st.value);
            else await B().hub(st.value, 'spin');
            break;
          case 'rotate':
            B().clearWins();
            setSpinning(true);
            await B().rotate(st.rings, { speed, onRingStop: () => B().jolt(0.35) });
            setSpinning(false);
            break;
          case 'win':
            total += st.winHundredths;
            statusOut(`Işın ${st.spoke + 1}: ${CEZERI_SYMBOL_LABELS[st.symbol]} ×${st.length} · göbek ×${st.hub} · tur ${(total / 100).toFixed(2)}×`);
            B().showWin(st.cells, st.spoke);
            await F().spokeBeam(st.spoke, st.length, { duration: 700 * speed, startRing: st.startRing });
            break;
          case 'lock':
            for (const [r, s] of st.newHeld) held.add(`${r},${s}`);
            await lock([...st.newHeld]);
            break;
          case 'end':
            await sleep(250 * speed);
            B().clearWins();
            await B().release();
            break;
          case 'scatter':
            if (st.count >= 2) {
              B().showVessels(st.cells);
              statusOut(`${st.count} Su Kabı${st.freeSpinsAwarded ? ` · +${st.freeSpinsAwarded} bedava dönüş` : ''}`);
              await F().scatter(st.cells, { hold: 1800 });
              B().showVessels(null);
            }
            break;
          case 'falcon': {
            statusOut(`Şahin geldi: halka ${st.ring + 1}, ${st.slices.length} Altın Dişli`);
            const before = st.wilds.filter(([r, s]) => !(r === st.ring && st.slices.includes(s)));
            const dropped: CezeriPos[] = [];
            await F().falcon(st.ring, st.slices, { onDrop: (_, s) => { dropped.push([st.ring, s]); B().setPinned([...before, ...dropped], [[st.ring, s]]); } });
            B().setPinned(st.wilds);
            break;
          }
        }
      }
      if (sp.kind === 'free') { setReservoir(sp.reservoir >= 3 ? 3 : sp.reservoir); if (sp.reservoir >= 3) window.setTimeout(() => setReservoir(0), 900); }
      await sleep(300 * speed);
    }
    const x = round.totalHundredths / 100;
    statusOut(`Tur bitti · ${x.toFixed(2)}× bahis${round.capped ? ' (azami)' : ''} · seed ${seed.slice(0, 8)}…`);
    if (x >= 10) { onMood('bigwin'); scene.current?.awaken(); await F().awaken(Math.min(1.5, x / 50)); }
    onMood('base');
    B().setPinned([]);
    setReservoir(0);
  }, [hubTick, lock, onMood, scene, speed, statusOut]);

  const run = useCallback(async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } catch (e) { statusOut(`Hata: ${(e as Error).message}`); } finally { setBusy(false); } }, [busy, statusOut]);
  const singleSpin = useCallback(async () => { await B().release(); B().clearWins(); await spin(quietBoard(seeded(Math.floor(Math.random() * 1e9)))); }, [spin]);
  const doLock = useCallback(async () => { const s = Math.floor(Math.random() * 12); await lock([[0, s], [1, s], [2, s]]); }, [lock]);
  const doBeam = useCallback(async () => { await win(Math.floor(Math.random() * 12), 3 + Math.round(Math.random())); }, [win]);
  const doFalcon = useCallback(async () => {
    const ring = Math.floor(Math.random() * 4);
    const slices = [...new Set(Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => Math.floor(Math.random() * 12)))];
    const dropped: CezeriPos[] = [];
    await F().falcon(ring, slices, { onDrop: (_, s) => { dropped.push([ring, s]); B().setPinned([...dropped], [[ring, s]]); } });
  }, []);
  const doScatter = useCallback(async () => {
    const cells = ([[0, 1], [2, 5], [3, 9], [1, 10]] as CezeriPos[]).slice(0, 3 + Math.round(Math.random()));
    const b = cur.current.map((r) => r.slice());
    for (const [r, s] of cells) b[r]![s] = 'vessel';
    B().setBoard(b); cur.current = b;
    await sleep(60);
    B().showVessels(cells);
    await F().scatter(cells, { hold: 2000 });
    B().showVessels(null);
  }, []);
  const doAwaken = useCallback(async () => { onMood('bigwin'); scene.current?.awaken(); scene.current?.glow(1); await F().awaken(1.2); onMood('base'); }, [onMood, scene]);
  const doSteam = useCallback(async () => { for (const d of [45, 135, 225, 315]) { F().steam({ x: 500 + Math.sin((d * Math.PI) / 180) * 470, y: 500 - Math.cos((d * Math.PI) / 180) * 470 }, d, 7, 1.2); F().spray({ x: 500, y: 980 }, 0, 18, 1); } await sleep(800); }, []);
  const doHub = useCallback(async () => { await hubTick(Math.min(999, hubVal.current + 1)); }, [hubTick]);
  const doFill = useCallback(() => setReservoir((v) => (v >= 3 ? 0 : v + 1)), []);

  useEffect(() => {
    window.__cezeriLab = { sample, real, long: () => real('standard', LONG_CHAIN_SEED), spin: singleSpin, lock: doLock, beam: doBeam, falcon: doFalcon, scatter: doScatter, awaken: doAwaken, steam: doSteam, hub: doHub, fill: doFill, stats: () => fx.current?.stats, setMood: onMood } as unknown as LabApi;
    return () => { delete window.__cezeriLab; };
  }, [sample, real, singleSpin, doLock, doBeam, doFalcon, doScatter, doAwaken, doSteam, doHub, doFill, onMood]);

  const b = (label: string, fn: () => Promise<unknown> | void, id: string) => <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(async () => { await fn(); })} data-testid={id}>{label}</button>;
  return (
    <>
      <div className={styles.labMeter}><CezeriReservoir level={reservoir} /></div>
      <div className={styles.controls}>
        {b('Örnek zincir', sample, 'sample')}
        {b('Gerçek tur', () => real('standard'), 'real')}
        {b('Bonus satın al turu', () => real('buy'), 'real-buy')}
        {b('Uzun zincir (10 dönüş)', () => real('standard', LONG_CHAIN_SEED), 'real-long')}
        {b('Dönüş', singleSpin, 'spin')}
        {b('Dişli Kilidi', doLock, 'lock')}
        {b('Göbek +1', doHub, 'hub')}
        {b('Işın kazancı', doBeam, 'beam')}
        {b('Şahin', doFalcon, 'falcon')}
        {b('Su kapları', doScatter, 'scatter')}
        {b('Otomat uyanışı', doAwaken, 'awaken')}
        {b('Buhar + su', doSteam, 'steam')}
        <button type="button" className={styles.btn} onClick={doFill} data-testid="fill">Hazne +1</button>
        <button type="button" className={styles.btn} onClick={() => setSpeed((s) => (s === 1 ? 0.6 : s === 0.6 ? 0.35 : 1))} data-testid="speed">Hız: {speed === 1 ? 'normal' : speed === 0.6 ? 'hızlı' : 'turbo'}</button>
      </div>
      <div className={styles.labBoardWrap}>
        <div ref={hostRef} style={{ position: 'relative' }}>
          <CezeriFrame mood={mood === 'base' ? 'base' : 'feature'} spinning={spinning}>
            <CezeriBoard ref={board} initial={FIRST} hubValue={1} mood={mood === 'feature' ? 'feature' : 'base'} />
          </CezeriFrame>
          <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

function Gallery() {
  return (
    <div className={styles.galleryPage}>
      <section className={styles.panel}>
        <h2>Semboller · 120 px</h2>
        <div className={styles.symGrid}>
          {CEZERI_SYMBOLS.map((s) => (
            <figure key={s} className={styles.sym} data-testid={`sym-${s}`}>
              <CezeriSymbolArt symbol={s} size={120} />
              <figcaption>{CEZERI_SYMBOL_LABELS[s]} · {s}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>28 px (telefon iç halka) · 48 px · gri tonlama</h2>
        <div className={styles.smallRow}>{CEZERI_SYMBOLS.map((s) => <CezeriSymbolUse key={s} symbol={s} className={styles.s28} />)}</div>
        <div className={styles.smallRow}>{CEZERI_SYMBOLS.map((s) => <CezeriSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{CEZERI_SYMBOLS.map((s) => <CezeriSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{CEZERI_SYMBOLS.map((s) => <CezeriSymbolUse key={s} symbol={s} className={styles.s96} />)}</div>
      </section>
      <section className={styles.panel}>
        <h2>Logo · hazne</h2>
        <div className={styles.row}>
          <div style={{ width: 'min(560px, 100%)' }}><CezeriLogo /></div>
          <div style={{ width: 220 }}><CezeriLogo subtitle={false} /></div>
          {[0, 1, 2, 3].map((l) => <div key={l} style={{ width: 90 }}><CezeriReservoir level={l} /></div>)}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Çerçeve · temel / özellik</h2>
        <div className={styles.row}>
          {(['base', 'feature'] as const).map((m) => (
            <div key={m} style={{ width: 'min(460px, 100%)' }}>
              <CezeriFrame mood={m}><CezeriBoard initial={FIRST} hubValue={m === 'base' ? 5 : 12} mood={m} /></CezeriFrame>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CezeriArtLab() {
  const [tab, setTab] = useState<'scene' | 'gallery'>('scene');
  const [mood, setMood] = useState<CezeriMood>('base');
  const [fps, setFps] = useState('');
  const [status, setStatus] = useState('Hazır');
  const scene = useRef<CezeriSceneHandle>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') === 'gallery') setTab('gallery');
  }, []);
  return (
    <main className={styles.lab}>
      <CezeriSymbolSprites />
      <div className={styles.bar}>
        <button type="button" className={styles.btn} data-on={tab === 'scene' ? '' : undefined} onClick={() => setTab('scene')} data-testid="tab-scene">Sahne</button>
        <button type="button" className={styles.btn} data-on={tab === 'gallery' ? '' : undefined} onClick={() => setTab('gallery')} data-testid="tab-gallery">Galeri</button>
        {tab === 'scene' && ([['base', 'Temel'], ['feature', 'Fil Saati'], ['bigwin', 'Büyük kazanç']] as const).map(([m, l]) => (
          <button key={m} type="button" className={styles.btn} data-on={mood === m ? '' : undefined} onClick={() => setMood(m)} data-testid={`mood-${m}`}>{l}</button>
        ))}
        {tab === 'scene' && <span className={styles.mono} data-testid="fps">{fps}</span>}
      </div>
      {tab === 'scene' ? (
        <CezeriScene ref={scene} mood={mood} className={styles.labScene}>
          <div className={styles.labStage}>
            <div className={styles.labLogo}><CezeriLogo /></div>
            <LabBoard mood={mood} onMood={setMood} scene={scene} fpsOut={setFps} statusOut={setStatus} />
            <div className={styles.status} aria-live="polite" data-testid="status" style={{ position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center' }}>{status}</div>
          </div>
        </CezeriScene>
      ) : <Gallery />}
    </main>
  );
}
