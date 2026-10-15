'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ASENA_COLS, ASENA_MAP_MULTIPLIERS, ASENA_ROWS, ASENA_TEMPLATES, ASENA_TEMPLATE_IDS, asenaTransformCells, playAsenaRound,
  type AsenaFall, type AsenaGrid, type AsenaMode, type AsenaRound, type AsenaSymbol, type AsenaTemplateId, type AsenaWolfWalk,
} from '@sollish/protocol';
import { ASENA_IDLE_GRID, AsenaBoard, type AsenaBoardHandle } from './board';
import { AsenaFrame } from './frame';
import { AsenaFx, type AsenaMood } from './fx';
import { ASENA_TEMPLATE_INFO, asenaConstellationPlan, asenaPlanMatches, type AsPos, type AsenaConstellationPlan } from './geometry';
import { AsenaLogo } from './logo';
import { AsenaScene, type AsenaSceneHandle } from './scene';
import { AsenaSkyMap, type AsenaSkyMapHandle } from './sky-map';
import { ASENA_SYMBOLS, ASENA_SYMBOL_GLOW, ASENA_SYMBOL_LABELS, AsenaSymbolArt, AsenaSymbolSprites, AsenaSymbolUse } from './symbols';
import styles from './art.module.css';

/* Dev-only gallery for the Asena art (rendered by app/lab/asena-art, notFound in production). The scene tab holds the
   REFERENCE PLAYER of the presentation contract: playReal() turns a real playAsenaRound() round into board + FX +
   scene + sky-map calls, in the order documented in MAPPING (also shown in the gallery). The other buttons trigger
   each effect alone on synthetic data. Demo randomness (seeds, filler symbols) is Math.random; nothing here touches a
   balance. */

const PAY: AsenaSymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4'];
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const hexSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (w) => w.toString(16).padStart(8, '0')).join('');
const levelOf = (m: number) => (m >= ASENA_MAP_MULTIPLIERS.twice ? 3 : m >= ASENA_MAP_MULTIPLIERS[6] ? 2 : m >= ASENA_MAP_MULTIPLIERS[3] ? 1 : 0);
const cloneGrid = (g: AsenaGrid): AsenaGrid => g.map((c) => c.map((x) => ({ ...x })));
/** Seeds found with the probe (asena-stars-1): constellations + wolf walks in the base game, a 16-spin feature, a buy round reaching ×3. */
export const ASENA_LAB_SEEDS = {
  walkAndStars: 'a708a7ae0000000e00000062000000b6',
  constellation: '538453d700000007000000310000005b',
  feature: 'be1e08230000001300000085000000f7',
  buyMap: '00009576000005160000002a000000d2',
} as const;

/** The step → call contract (the game UI must follow the same order). */
export const ASENA_STEP_MAPPING: ReadonlyArray<readonly [engine: string, board: string, fx: string, other: string]> = [
  ['spin.kind === "free" (first free spin)', '—', '—', 'scene mood "feature" · frame/board mood "feature" · <AsenaSkyMap pieces={spin.mapBefore} multiplier={spin.globalMultiplierBefore}/> · scene.ergenekon(level)'],
  ['spin.steps[0].grid (start of every spin)', 'board.dropIn(grid, {speed, onColumn})', '—', 'sound: column landings'],
  ['exactly 2 moons on steps[0].grid', "board.moons(cells, 'tease')", 'fx.moons(cells, {tease: true})', 'cleared at spin end'],
  ['steps[k].grid (every step)', 'board.setGrid(grid) (reconcile; no-op when ids match)', '—', '—'],
  ['steps[k].clusters (non-empty)', 'board.highlight(clusters)', 'fx.clusterWin(cells, ASENA_SYMBOL_GLOW[symbol], size)', 'win meter += step.winHundredths'],
  ['cluster.constellation (each, in order)', 'board.constellation(plan)', 'fx.constellation(plan, {persist: free spin})', 'plan = asenaConstellationPlan(ignition, 1400·speed); at plan end: scene.howl() + fx.howl(scene.wolfPoint())'],
  ['steps[k].map.unlocked[]', '—', 'fx.flyStar(toPx(plan.center), skyMap.tile(template))', 'onArrive: skyMap pieces = map.pieces'],
  ['steps[k].map.globalMultiplierAfter > Before', '—', 'fx.ergenekon(scene.mountainPoint(), level) · fx.announce("×m")', 'skyMap multiplier · scene.ergenekon(level)'],
  ['steps[k].map.freeSpinsAwarded > 0', '—', 'fx.announce("+n", {sub: "DÖNÜŞ"})', 'free-spin counter'],
  ['steps[k].burst', 'board.clearConstellations() · board.clearHighlight() · board.burst(ids)', 'fx.burst(positions before the burst)', '—'],
  ['steps[k].fall', 'board.fall(fall, {speed, onLand})', '—', 'sound: landings'],
  ['steps[k].wolfWalks[i] (one after another)', 'board.wolfWalk(walk)', 'fx.wolfWalk(walk.from, walk.to, {duration: 640·speed})', '—'],
  ['last step: spin.scatterCount ≥ 3', "board.moons(cells, 'land')", 'fx.moons(cells)', 'fx.announce("+scatterSpinsAwarded")'],
  ['spin.totalHundredthsAfter', '—', '—', 'win meter (never reset inside a round)'],
  ['round.totalHundredths ≥ 10 × bet', 'board.dim(true)', 'fx.skyGate(intensity, {howlAt: scene.wolfPoint()})', 'scene mood "bigwin" · scene.howl() · celebration tiers'],
  ['end of feature', '—', 'fx.clearEcho()', 'scene.ergenekon(0) · mood "base"'],
];

function randomGrid(moons = 0, wolf = true): AsenaGrid {
  let id = -5000 - Math.floor(Math.random() * 1e6);
  const g: AsenaGrid = Array.from({ length: ASENA_COLS }, () => Array.from({ length: ASENA_ROWS }, () => ({ id: id--, symbol: PAY[Math.floor(Math.random() * 8)]! })));
  if (wolf) g[2 + Math.floor(Math.random() * 2)]![2 + Math.floor(Math.random() * 2)]!.symbol = 'wolf';
  const spots: AsPos[] = [[0, 1], [4, 4], [5, 0], [1, 5]];
  for (let i = 0; i < moons; i++) { const [c, r] = spots[i]!; g[c]![r]!.symbol = 'moon'; }
  return g;
}
let synthId = -9_000_000;
/** Lab-only gravity for synthetic bursts (the engine does this for real rounds). */
function synthFall(grid: AsenaGrid, burst: Set<number>): AsenaFall {
  const out: AsenaGrid = [], moves: AsenaFall['moves'] = [], drops: AsenaFall['drops'] = [];
  for (let c = 0; c < ASENA_COLS; c++) {
    const keep = grid[c]!.map((x, r) => ({ x, r })).filter((v) => !burst.has(v.x.id));
    const n = ASENA_ROWS - keep.length;
    const col = [] as AsenaGrid[number];
    for (let r = 0; r < n; r++) { const cell = { id: synthId--, symbol: PAY[Math.floor(Math.random() * 8)]! }; col.push(cell); drops.push({ id: cell.id, col: c, row: r, symbol: cell.symbol }); }
    keep.forEach((v, i) => { const to = n + i; col.push(v.x); if (to !== v.r) moves.push({ id: v.x.id, col: c, fromRow: v.r, toRow: to }); });
    out.push(col);
  }
  return { grid: out, moves, drops };
}

interface LabApi { [k: string]: (...a: never[]) => unknown }
declare global { interface Window { __asenaLab?: LabApi } }

function LabStage({ mood, onMood, scene, fpsOut }: { mood: AsenaMood; onMood: (m: AsenaMood) => void; scene: React.RefObject<AsenaSceneHandle | null>; fpsOut: (s: string) => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const board = useRef<AsenaBoardHandle>(null);
  const map = useRef<AsenaSkyMapHandle>(null);
  const fx = useRef<AsenaFx | null>(null);
  const grid = useRef<AsenaGrid>(cloneGrid(ASENA_IDLE_GRID));
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pieces, setPieces] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [mult, setMult] = useState(1);
  const [mapOn, setMapOn] = useState(false);
  const [win, setWin] = useState(0);
  const [status, setStatus] = useState('Hazır · gerçek tur için tohum gir ya da rastgele oynat');
  const [seed, setSeed] = useState<string>(ASENA_LAB_SEEDS.walkAndStars);
  const [mode, setMode] = useState<AsenaMode>('standard');
  const erg = useRef(0);
  const [clean, setClean] = useState(false);

  useEffect(() => {
    const root = stageRef.current, front = canvasRef.current;
    if (!root || !front) return;
    const f = new AsenaFx({ root, front, sky: scene.current?.skyCanvas ?? null, echo: scene.current?.echoCanvas ?? null, board: board.current?.element ?? null, mood });
    fx.current = f;
    return () => { f.destroy(); fx.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { fx.current?.setMood(mood); }, [mood]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = fx.current?.stats;
      if (s) fpsOut(`${s.running ? `${s.fps.toFixed(0)} fps · kare ${s.avgMs.toFixed(1)} ms (en kötü ${s.worstMs.toFixed(0)})` : 'FX boşta'} · ön ${s.drawMs.toFixed(2)} ms (en kötü ${s.drawWorstMs.toFixed(1)}) · gök ${s.skyMs.toFixed(2)} ms · ${s.particles} parçacık`);
    }, 1000);
    return () => window.clearInterval(id);
  }, [fpsOut]);

  const B = () => board.current!, F = () => fx.current!;
  const sp = speed;
  const tileCenter = (i: number) => F().centerOf(map.current?.tile(i) ?? null);

  /* ---------------------------------------------------------- reference player */
  const playRound = useCallback(async (round: AsenaRound) => {
    const bet = round.betCents;
    setWin(0);
    let feature = false;
    for (const spin of round.spins) {
      if (spin.kind === 'free' && !feature) {
        feature = true;
        onMood('feature');
        setMapOn(true);
        setPieces(spin.mapBefore.slice()); setMult(spin.globalMultiplierBefore);
        scene.current?.ergenekon(levelOf(spin.globalMultiplierBefore));
        F().announce('ERGENEKON', null, { sub: 'BEDAVA DÖNÜŞLER', tone: 'ice', life: 1800 });
        await sleep(1200 * sp);
      }
      setStatus(spin.kind === 'base' ? 'Temel dönüş' : `Ergenekon · dönüş ${spin.index} · kalan ${spin.freeSpinsLeft} · genel ×${spin.globalMultiplierAfter}`);
      const first = spin.steps[0]!;
      await B().dropIn(first.grid, { speed: sp });
      grid.current = first.grid;
      const moonCells = (g: AsenaGrid) => { const out: AsPos[] = []; g.forEach((col, c) => col.forEach((x, r) => { if (x.symbol === 'moon') out.push([c, r]); })); return out; };
      const tease = moonCells(first.grid);
      if (tease.length === 2) { B().moons(tease, 'tease'); void F().moons(tease, { tease: true, hold: 1600 }); }
      let running = spin.totalHundredthsAfter - spin.winHundredths;
      for (const step of spin.steps) {
        B().setGrid(step.grid);
        grid.current = step.grid;
        if (!step.clusters.length) break;
        B().highlight(step.clusters);
        const cells: AsPos[] = [];
        for (const cl of step.clusters) for (const id of cl.cells) { const p = B().positionOf(id); if (p) cells.push(p); }
        F().clusterWin(cells, ASENA_SYMBOL_GLOW[step.clusters[0]!.symbol], step.winHundredths / 100);
        running += step.winHundredths;
        setWin(running);
        await sleep(420 * sp);
        const plans: AsenaConstellationPlan[] = [];
        for (const cl of step.clusters) {
          if (!cl.constellation) continue;
          const plan = asenaConstellationPlan(cl.constellation, 1400 * Math.max(0.6, sp));
          if (!asenaPlanMatches(plan, cl.constellation.positions)) console.warn('[asena-lab] plan ≠ ignition.positions', cl.constellation);
          plans.push(plan);
          setStatus(`Takımyıldız: ${plan.name} ×${plan.multiplier} · ${ASENA_SYMBOL_LABELS[cl.symbol]} ${cl.size} hücre`);
          await Promise.all([B().constellation(plan), F().constellation(plan, { persist: spin.kind === 'free' })]);
          scene.current?.howl();
          void F().howl(scene.current?.wolfPoint() ?? null);
        }
        if (step.map) {
          const ev = step.map;
          await Promise.all(ev.unlocked.map((u, i) => {
            const to = tileCenter(u.template);
            const from = plans.find((p) => p.templateIndex === u.template)?.center;
            return to ? sleep(i * 120).then(() => F().flyStar(from ? F().toPx(from) : [2, 2], to, { onArrive: () => setPieces((p) => { const n = p.slice(); n[u.template] = u.count; return n; }) })) : Promise.resolve();
          }));
          setPieces(ev.pieces.slice());
          if (ev.globalMultiplierAfter > ev.globalMultiplierBefore) {
            setMult(ev.globalMultiplierAfter);
            const lv = levelOf(ev.globalMultiplierAfter);
            scene.current?.ergenekon(lv);
            const mp = scene.current?.mountainPoint();
            if (mp) void F().ergenekon(mp, lv);
            const em = F().centerOf(map.current?.emblem() ?? null);
            if (em) void F().ergenekon(em, lv, { scale: 0.45 });
            F().announce(`×${ev.globalMultiplierAfter}`, null, { sub: 'GENEL ÇARPAN' });
            setStatus(`Ergenekon: ${ev.distinct} takımyıldız · genel çarpan ×${ev.globalMultiplierAfter}${ev.freeSpinsAwarded ? ` · +${ev.freeSpinsAwarded} dönüş` : ''}`);
            await sleep(1300 * sp);
          }
          if (ev.freeSpinsAwarded && ev.globalMultiplierAfter === ev.globalMultiplierBefore) { F().announce(`+${ev.freeSpinsAwarded}`, null, { sub: 'DÖNÜŞ', tone: 'ice' }); await sleep(900 * sp); }
        }
        B().clearConstellations();
        B().clearHighlight();
        const burstAt = step.burst.map((id) => B().positionOf(id)).filter((p): p is AsPos => !!p);
        await Promise.all([B().burst(step.burst, { speed: sp }), F().burst(burstAt)]);
        if (step.fall) await B().fall(step.fall, { speed: sp });
        for (const w of step.wolfWalks) {
          setStatus(`Gök Kurt yürüdü: (${w.from[0] + 1},${w.from[1] + 1}) → (${w.to[0] + 1},${w.to[1] + 1}) · Yıldız İzi kaldı`);
          await Promise.all([B().wolfWalk(w, { speed: sp }), F().wolfWalk(w.from, w.to, { duration: 640 * sp })]);
        }
      }
      if (spin.scatterCount >= 3) {
        const mc = moonCells(spin.steps[spin.steps.length - 1]!.grid);
        B().moons(mc, 'land');
        await F().moons(mc, { hold: 2200 });
        if (spin.scatterSpinsAwarded) F().announce(`+${spin.scatterSpinsAwarded}`, null, { sub: spin.kind === 'base' ? 'BEDAVA DÖNÜŞ' : 'EK DÖNÜŞ', tone: 'ice' });
        await sleep(900 * sp);
      }
      B().moons(null);
      F().clearMoons();
      setWin(spin.totalHundredthsAfter);
      await sleep(260 * sp);
    }
    const x = round.totalHundredths / 100;
    setStatus(`Tur bitti · ${x.toFixed(2)}× bahis${round.capped ? ' (azami)' : ''} · ${(round.payoutCents / 100).toFixed(2)} DEMO · tohum ${round.seedHex.slice(0, 8)}… · ${round.mode}`);
    if (x * 100 >= 10 * 100 && round.betCents === bet) {
      onMood('bigwin'); B().dim(true);
      scene.current?.howl();
      await F().skyGate(Math.min(1.6, 0.7 + x / 120), { howlAt: scene.current?.wolfPoint() ?? null });
      B().dim(false);
    }
    if (feature) { F().clearEcho(); scene.current?.ergenekon(0); setMapOn(false); setPieces([0, 0, 0, 0, 0, 0]); setMult(1); }
    onMood('base');
  }, [onMood, scene, sp]);

  const playReal = useCallback(async (m: AsenaMode = mode, s?: string) => {
    const useSeed = s ?? hexSeed();
    setSeed(useSeed);
    const round = playAsenaRound(useSeed, 100, m);
    await playRound(round);
  }, [mode, playRound]);

  /* ---------------------------------------------------------- single effects */
  const spinRandom = useCallback(async (moons = 0) => { const g = randomGrid(moons); await B().dropIn(g, { speed: sp }); grid.current = g; }, [sp]);
  const doConstellation = useCallback(async (id?: AsenaTemplateId) => {
    const tid = id ?? ASENA_TEMPLATE_IDS[Math.floor(Math.random() * 6)]!;
    const t = ASENA_TEMPLATES.find((x) => x.id === tid)!;
    const transform = Math.floor(Math.random() * 8);
    const cells = asenaTransformCells(t.cells, transform);
    const w = Math.max(...cells.map(([x]) => x)) + 1, h = Math.max(...cells.map(([, y]) => y)) + 1;
    const origin: [number, number] = [Math.floor(Math.random() * (ASENA_COLS - w + 1)), Math.floor(Math.random() * (ASENA_ROWS - h + 1))];
    const plan = asenaConstellationPlan({ templateId: tid, transform, origin }, 1400 * Math.max(0.6, sp));
    const ids = plan.nodes.map(([c, r]) => grid.current[c]![r]!.id);
    B().highlight([{ symbol: 'h1', cells: ids }]);
    await Promise.all([B().constellation(plan), F().constellation(plan)]);
    scene.current?.howl();
    await F().howl(scene.current?.wolfPoint() ?? null);
    B().clearConstellations(); B().clearHighlight();
  }, [scene, sp]);
  const doBurst = useCallback(async () => {
    const c0 = Math.floor(Math.random() * 4), r0 = Math.floor(Math.random() * 4);
    const pos: AsPos[] = [[c0, r0], [c0 + 1, r0], [c0 + 2, r0], [c0, r0 + 1], [c0, r0 + 2], [c0 + 1, r0 + 2]];
    const ids = pos.map(([c, r]) => grid.current[c]![r]!).filter((x) => x.symbol !== 'wolf' && x.symbol !== 'moon').map((x) => x.id);
    B().highlight([{ symbol: grid.current[c0]![r0]!.symbol, cells: ids }]);
    F().clusterWin(pos, '#bfe6ff', 2);
    await sleep(500 * sp);
    B().clearHighlight();
    const at = ids.map((id) => B().positionOf(id)).filter((p): p is AsPos => !!p);
    await Promise.all([B().burst(ids, { speed: sp }), F().burst(at)]);
    const f = synthFall(grid.current, new Set(ids));
    await B().fall(f, { speed: sp });
    grid.current = f.grid;
  }, [sp]);
  const doWalk = useCallback(async () => {
    let wc = -1, wr = -1;
    grid.current.forEach((col, c) => col.forEach((x, r) => { if (x.symbol === 'wolf' && wc < 0) { wc = c; wr = r; } }));
    if (wc < 0) { const g = cloneGrid(grid.current); g[2]![2]!.symbol = 'wolf'; B().setGrid(g); grid.current = g; wc = 2; wr = 2; await sleep(50); }
    const opts = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [wc + dx, wr + dy] as const).filter(([c, r]) => c >= 0 && c < 6 && r >= 0 && r < 6 && grid.current[c]![r]!.symbol !== 'moon' && grid.current[c]![r]!.symbol !== 'wolf');
    if (!opts.length) return;
    const [tc, tr] = opts[Math.floor(Math.random() * opts.length)]!;
    const wolf = grid.current[wc]![wr]!, eaten = grid.current[tc]![tr]!;
    const trail = { id: synthId--, col: wc, row: wr };
    const w: AsenaWolfWalk = { id: wolf.id, from: [wc, wr], to: [tc, tr], path: [[wc, wr], [tc, tr]], trail, consumed: { id: eaten.id, symbol: eaten.symbol } };
    await Promise.all([B().wolfWalk(w, { speed: sp }), F().wolfWalk(w.from, w.to, { duration: 640 * sp })]);
    const g = cloneGrid(grid.current);
    g[tc]![tr] = wolf; g[wc]![wr] = { id: trail.id, symbol: 'trail' };
    grid.current = g;
  }, [sp]);
  const doMoons = useCallback(async (n: number) => {
    const g = cloneGrid(grid.current);
    const spots: AsPos[] = [[0, 1], [4, 4], [5, 0], [1, 5]];
    for (let i = 0; i < n; i++) { const [c, r] = spots[i]!; g[c]![r] = { ...g[c]![r]!, symbol: 'moon' }; }
    B().setGrid(g); grid.current = g;
    await sleep(60);
    const cells = spots.slice(0, n);
    B().moons(cells, n === 2 ? 'tease' : 'land');
    await F().moons(cells, { tease: n === 2, hold: 2400 });
    if (n >= 3) F().announce('+10', null, { sub: 'BEDAVA DÖNÜŞ', tone: 'ice' });
    await sleep(1400);
    B().moons(null);
  }, []);
  const doGate = useCallback(async () => { onMood('bigwin'); B().dim(true); scene.current?.howl(); await F().skyGate(1.2, { howlAt: scene.current?.wolfPoint() ?? null }); B().dim(false); onMood('base'); }, [onMood, scene]);
  const doErgenekon = useCallback(async () => {
    erg.current = (erg.current + 1) % 4;
    const lv = erg.current, m = [1, ASENA_MAP_MULTIPLIERS[3], ASENA_MAP_MULTIPLIERS[6], ASENA_MAP_MULTIPLIERS.twice][lv]!;
    setMapOn(lv > 0);
    setPieces(lv === 0 ? [0, 0, 0, 0, 0, 0] : lv === 1 ? [1, 0, 1, 0, 0, 1] : lv === 2 ? [2, 1, 1, 1, 2, 1] : [2, 2, 2, 2, 2, 2]);
    setMult(m);
    onMood(lv > 0 ? 'feature' : 'base');
    scene.current?.ergenekon(lv);
    if (lv > 0) {
      const mp = scene.current?.mountainPoint();
      if (mp) void F().ergenekon(mp, lv);
      const em = F().centerOf(map.current?.emblem() ?? null);
      if (em) void F().ergenekon(em, lv, { scale: 0.45 });
      F().announce(`×${m}`, null, { sub: 'GENEL ÇARPAN' });
      await sleep(1200);
    }
  }, [onMood, scene]);
  const doHowl = useCallback(async () => { scene.current?.howl(); await F().howl(scene.current?.wolfPoint() ?? null); }, [scene]);
  const doFly = useCallback(async () => {
    const i = Math.floor(Math.random() * 6), to = tileCenter(i);
    setMapOn(true);
    if (to) await F().flyStar([Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)], to, { onArrive: () => setPieces((p) => { const n = p.slice(); n[i] = Math.min(2, n[i]! + 1); return n; }) });
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } catch (e) { setStatus(`Hata: ${(e as Error).message}`); } finally { setBusy(false); } }, [busy]);

  useEffect(() => {
    window.__asenaLab = { real: (m: AsenaMode, s?: string) => playReal(m, s), seeds: () => ASENA_LAB_SEEDS, constellation: doConstellation, burst: doBurst, walk: doWalk, moons: doMoons, gate: doGate, ergenekon: doErgenekon, howl: doHowl, fly: doFly, spin: spinRandom, clean: () => setClean((c) => !c), stats: () => fx.current?.stats, setMood: onMood, busy: () => busy } as unknown as LabApi;
    return () => { delete window.__asenaLab; };
  }, [playReal, doConstellation, doBurst, doWalk, doMoons, doGate, doErgenekon, doHowl, doFly, spinRandom, onMood, busy]);

  const b = (label: string, fn: () => Promise<unknown> | void, id: string) => <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(async () => { await fn(); })} data-testid={id}>{label}</button>;
  return (
    <div ref={stageRef} className={styles.labStage} data-clean={clean || undefined}>
      <div className={styles.labLogo}><AsenaLogo /></div>
      <div className={styles.labMap}><AsenaSkyMap ref={map} pieces={pieces} multiplier={mult} inactive={!mapOn} orientation="column" /></div>
      <div className={styles.labBoardWrap}>
        <AsenaFrame mood={mood === 'feature' ? 'feature' : 'base'}>
          <AsenaBoard ref={board} mood={mood === 'feature' ? 'feature' : 'base'} />
        </AsenaFrame>
      </div>
      <div className={styles.winMeter} data-testid="win">KAZANÇ <b>{(win / 100).toFixed(2)}×</b></div>
      <div className={styles.controls}>
        <h3>GERÇEK MOTOR TURU</h3>
        <input className={styles.input} value={seed} onChange={(e) => setSeed(e.target.value.trim().toLowerCase())} aria-label="Tohum (32 hex)" data-testid="seed" />
        <div className={styles.row2}>
          <select className={styles.input} value={mode} onChange={(e) => setMode(e.target.value as AsenaMode)} aria-label="Mod" data-testid="mode">
            <option value="standard">standart</option><option value="ante">ante</option><option value="buy">satın alma</option>
          </select>
          {b('Tohumu oynat', () => playReal(mode, seed), 'play-seed')}
        </div>
        <div className={styles.row2}>
          {b('Rastgele tur', () => playReal('standard'), 'real')}
          {b('Bonus satın al', () => playReal('buy'), 'real-buy')}
        </div>
        <div className={styles.row2}>
          {b('Kurt + yıldız', () => playReal('standard', ASENA_LAB_SEEDS.walkAndStars), 'seed-walk')}
          {b('Özellik (16)', () => playReal('standard', ASENA_LAB_SEEDS.feature), 'seed-feature')}
        </div>
        <h3>TEK EFEKT</h3>
        <div className={styles.row2}>
          {b('Yeni dönüş', () => spinRandom(0), 'spin')}
          {b('Takımyıldız', () => doConstellation(), 'constellation')}
          {b('Küme patlaması', doBurst, 'burst')}
          {b('Kurt yürüyüşü', doWalk, 'walk')}
          {b('Ay Ata (2) tease', () => doMoons(2), 'tease')}
          {b('Ay Ata (3)', () => doMoons(3), 'moons')}
          {b('Uluma', doHowl, 'howl')}
          {b('Yıldız uçuşu', doFly, 'fly')}
          {b('Ergenekon seviye', doErgenekon, 'ergenekon')}
          {b('Gök kapısı açılır', doGate, 'gate')}
        </div>
        <div className={styles.row2}>
          {ASENA_TEMPLATE_IDS.map((id) => <button key={id} type="button" className={styles.btn} disabled={busy} onClick={() => void run(() => doConstellation(id))} data-testid={`tpl-${id}`}>{ASENA_TEMPLATE_INFO[id].name}</button>)}
        </div>
        <button type="button" className={styles.btn} onClick={() => setSpeed((s) => (s === 1 ? 0.6 : s === 0.6 ? 0.35 : 1))} data-testid="speed">Hız: {speed === 1 ? 'normal' : speed === 0.6 ? 'hızlı' : 'turbo'}</button>
      </div>
      <button type="button" className={styles.btn} style={{ position: 'absolute', right: 12, bottom: 34, zIndex: 12 }} onClick={() => setClean((c) => !c)} data-testid="clean">{clean ? 'Paneli göster' : 'Sahneyi göster'}</button>
      <div className={styles.status} aria-live="polite" data-testid="status">{status}</div>
      <canvas ref={canvasRef} className={styles.fxCanvas} aria-hidden="true" />
    </div>
  );
}

function Gallery() {
  return (
    <div className={styles.galleryPage}>
      <section className={styles.panel}>
        <h2>Semboller · 120 px</h2>
        <div className={styles.symGrid}>
          {ASENA_SYMBOLS.map((s) => (
            <figure key={s} className={styles.sym} data-testid={`sym-${s}`}>
              <AsenaSymbolArt symbol={s} size={120} />
              <figcaption>{ASENA_SYMBOL_LABELS[s]} · {s}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>36 px · 48 px · gri tonlama 48 / 96 px</h2>
        <div className={styles.smallRow}>{ASENA_SYMBOLS.map((s) => <AsenaSymbolUse key={s} symbol={s} className={styles.s36} />)}</div>
        <div className={styles.smallRow}>{ASENA_SYMBOLS.map((s) => <AsenaSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{ASENA_SYMBOLS.map((s) => <AsenaSymbolUse key={s} symbol={s} className={styles.s48} />)}</div>
        <div className={`${styles.smallRow} ${styles.gray}`}>{ASENA_SYMBOLS.map((s) => <AsenaSymbolUse key={s} symbol={s} className={styles.s96} />)}</div>
      </section>
      <section className={styles.panel}>
        <h2>Logo · Ergenekon haritası (sütun / satır)</h2>
        <div className={styles.row}>
          <div style={{ width: 'min(520px, 100%)' }}><AsenaLogo /></div>
          <div style={{ width: 200 }}><AsenaLogo subtitle={false} /></div>
        </div>
        <div className={styles.row} style={{ marginTop: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 290 }}><AsenaSkyMap inactive /></div>
          <div style={{ width: 290 }}><AsenaSkyMap pieces={[1, 0, 1, 0, 0, 1]} multiplier={2} /></div>
          <div style={{ width: 290 }}><AsenaSkyMap pieces={[2, 2, 2, 2, 2, 2]} multiplier={5} /></div>
          <div style={{ width: 'min(390px, 100%)' }}><AsenaSkyMap pieces={[2, 1, 1, 1, 2, 1]} multiplier={3} orientation="row" /></div>
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Çerçeve · temel / özellik</h2>
        <div className={styles.row}>
          {(['base', 'feature'] as const).map((m) => (
            <div key={m} style={{ width: 'min(440px, 100%)', marginTop: 40 }}>
              <AsenaFrame mood={m}><AsenaBoard mood={m} /></AsenaFrame>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <h2>Adım → çağrı eşlemesi (oyun arayüzü sözleşmesi)</h2>
        <table className={styles.table}>
          <thead><tr><th>Motor verisi</th><th>Tahta</th><th>FX</th><th>Sahne / harita / ses</th></tr></thead>
          <tbody>{ASENA_STEP_MAPPING.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><code>{c}</code></td>)}</tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

export function AsenaArtLab() {
  const [tab, setTab] = useState<'scene' | 'gallery'>('scene');
  const [mood, setMood] = useState<AsenaMood>('base');
  const [fps, setFps] = useState('');
  const scene = useRef<AsenaSceneHandle>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') === 'gallery') setTab('gallery');
  }, []);
  return (
    <main className={styles.lab}>
      <AsenaSymbolSprites />
      <div className={styles.bar}>
        <button type="button" className={styles.btn} data-on={tab === 'scene' ? '' : undefined} onClick={() => setTab('scene')} data-testid="tab-scene">Sahne</button>
        <button type="button" className={styles.btn} data-on={tab === 'gallery' ? '' : undefined} onClick={() => setTab('gallery')} data-testid="tab-gallery">Galeri</button>
        {tab === 'scene' && ([['base', 'Temel'], ['feature', 'Ergenekon'], ['bigwin', 'Büyük kazanç']] as const).map(([m, l]) => (
          <button key={m} type="button" className={styles.btn} data-on={mood === m ? '' : undefined} onClick={() => setMood(m)} data-testid={`mood-${m}`}>{l}</button>
        ))}
        {tab === 'scene' && <span className={styles.mono} data-testid="fps">{fps}</span>}
      </div>
      {tab === 'scene' ? (
        <AsenaScene ref={scene} mood={mood} className={styles.labScene}>
          <LabStage mood={mood} onMood={setMood} scene={scene} fpsOut={setFps} />
        </AsenaScene>
      ) : <Gallery />}
    </main>
  );
}
