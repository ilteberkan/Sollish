'use client';

import { memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { GR_PALETTE as P } from './symbols';
import styles from './scene.module.css';

/* "Şafak Balonları" backdrop: Göreme valley at dawn. Back → front:
   pastel dawn sky (violet → rose → peach → gold) · the last stars · the sun on the horizon with a soft glow and slow
   turning light shafts · pink-lit cloud streaks · far balloons (behind the mesas) · lavender table mesas · mid balloons
   · a field of fairy chimneys (basalt caps, sun-lit flanks) on rolling tuff · near tuff cliffs left and right with cut
   windows and painted dovecote holes · poplars and vineyard rows on the valley floor · warm horizon haze · vignette.
   Moods: base (sun on the horizon) · feature (Şafak Şöleni: brighter sky, the sun climbs, more balloons, stronger
   shafts) · bigwin (golden wash). Layers are bottom-anchored and sized in viewport-relative units, so the same scene
   works on a 390 × 844 phone and a 1440 × 900 desktop. Only transform / opacity animate; balloon drift alternates
   (no jump at loop end); pointer parallax on fine pointers only and never with reduced motion.
   Everything is code-drawn and original. GoremeStage (below) is the recommended layout: logo, sky band and reel
   window, portrait and landscape. */

export type GoremeMood = 'base' | 'feature' | 'bigwin';
export interface GoremeSceneHandle {
  readonly element: HTMLDivElement | null;
  /** Root-relative centre of the sun (for GoremeFx.sunRays). */
  sunPoint(): { x: number; y: number } | null;
}
export interface GoremeSceneProps { mood?: GoremeMood; children?: ReactNode; className?: string; style?: CSSProperties; parallax?: boolean; ref?: Ref<GoremeSceneHandle> }

const f1 = (n: number) => Math.round(n * 10) / 10;
type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** One fairy chimney: slightly bulging cone with a basalt cap. Returns [body, cap]. */
function chimney(x: number, base: number, h: number, w: number): [string, string] {
  const top = base - h, nw = w * 0.13;
  const body = `M${f1(x - w / 2)} ${f1(base)}C${f1(x - w * 0.42)} ${f1(base - h * 0.45)} ${f1(x - w * 0.2)} ${f1(base - h * 0.82)} ${f1(x - nw)} ${f1(top)}L${f1(x + nw)} ${f1(top)}C${f1(x + w * 0.2)} ${f1(base - h * 0.82)} ${f1(x + w * 0.42)} ${f1(base - h * 0.45)} ${f1(x + w / 2)} ${f1(base)}Z`;
  const cw = w * 0.34, ch = w * 0.22;
  const cap = `M${f1(x - cw)} ${f1(top + ch * 0.25)}C${f1(x - cw)} ${f1(top - ch)} ${f1(x + cw)} ${f1(top - ch)} ${f1(x + cw)} ${f1(top + ch * 0.25)}C${f1(x + cw * 0.5)} ${f1(top + ch * 0.6)} ${f1(x - cw * 0.5)} ${f1(top + ch * 0.6)} ${f1(x - cw)} ${f1(top + ch * 0.25)}Z`;
  return [body, cap];
}
function field(seed: number, n: number, y0: number, hMin: number, hMax: number) {
  const r = rng(seed);
  const out: Array<{ body: string; cap: string; door: string | null }> = [];
  for (let i = 0; i < n; i++) {
    const x = (i + 0.2 + r() * 0.6) * (1600 / n);
    const h = hMin + r() * (hMax - hMin);
    const w = h * (0.34 + r() * 0.14);
    const base = y0 + r() * 16;
    const [body, cap] = chimney(x, base, h, w);
    const door = r() < 0.45 ? `M${f1(x - w * 0.05)} ${f1(base - h * 0.3)}v${f1(-h * 0.07)}a${f1(w * 0.05)} ${f1(w * 0.05)} 0 0 1 ${f1(w * 0.1)} 0v${f1(h * 0.07)}z` : null;
    out.push({ body, cap, door });
  }
  return out;
}
const MESAS = 'M0 300V176L60 172L84 150H180L204 168L320 170L350 132L380 126H470L492 150L560 158L640 160L668 140H740L770 162L900 166L940 120L962 112H1070L1100 140L1190 150L1240 146L1270 128H1350L1380 156L1480 160L1520 140H1600V300Z';
const BACK = field(7, 26, 214, 46, 90);
const FRONT = field(19, 15, 250, 90, 168);
const MOUNDS = 'M0 300V236C90 222 170 228 260 238C360 250 440 226 540 228C650 230 720 252 830 246C940 240 1010 222 1120 226C1230 230 1300 250 1410 246C1500 242 1560 232 1600 230V300Z';

const MesaArt = memo(function MesaArt() {
  return (
    <svg className={styles.full} viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grsMesa" x1="0" y1="110" x2="0" y2="300" gradientUnits="userSpaceOnUse">{stops([[0, '#b49ad0'], [0.5, '#9b7fbc'], [1, '#7c63a4']])}</linearGradient>
        <linearGradient id="grsMesaHaze" x1="0" y1="140" x2="0" y2="300" gradientUnits="userSpaceOnUse">{stops([[0, '#ffc8a8', 0], [1, '#ffc8a8', 0.45]])}</linearGradient>
      </defs>
      <path d={MESAS} fill="url(#grsMesa)" />
      <path d="M84 150H180M350 132L380 126H470M668 140H740M940 120L962 112H1070M1270 128H1350M1520 140H1600" fill="none" stroke="#ffd8c0" strokeWidth="2.4" opacity=".7" />
      <rect y="120" width="1600" height="180" fill="url(#grsMesaHaze)" />
    </svg>
  );
});

const FieldArt = memo(function FieldArt() {
  return (
    <svg className={styles.full} viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grsBack" x1="0" y1="0" x2="1" y2="0">{stops([[0, '#b98aa2'], [0.55, '#d8a8a8'], [1, '#f2c4ac']])}</linearGradient>
        <linearGradient id="grsFront" x1="0" y1="0" x2="1" y2="0">{stops([[0, '#c48a7c'], [0.45, '#e8b496'], [0.8, '#fbd8b8'], [1, '#fff0d8']])}</linearGradient>
        <linearGradient id="grsCap" x1="0" y1="0" x2="1" y2="1">{stops([[0, '#6a4a52'], [1, '#3a2630']])}</linearGradient>
        <linearGradient id="grsMound" x1="0" y1="220" x2="0" y2="300" gradientUnits="userSpaceOnUse">{stops([[0, '#e2a88e'], [1, '#a86a5e']])}</linearGradient>
        <linearGradient id="grsBackHaze" x1="0" y1="150" x2="0" y2="260" gradientUnits="userSpaceOnUse">{stops([[0, '#f6c0a8', 0.5], [1, '#f6c0a8', 0]])}</linearGradient>
      </defs>
      {BACK.map((c, i) => <g key={i}><path d={c.body} fill="url(#grsBack)" /><path d={c.cap} fill="#7a5a6e" /></g>)}
      <rect y="140" width="1600" height="120" fill="url(#grsBackHaze)" />
      {FRONT.map((c, i) => (
        <g key={i}>
          <path d={c.body} fill="url(#grsFront)" stroke="#8a5250" strokeWidth="1.2" strokeOpacity=".5" />
          <path d={c.cap} fill="url(#grsCap)" />
          {c.door && <path d={c.door} fill="#6a3a3e" opacity=".8" />}
        </g>
      ))}
      <path d={MOUNDS} fill="url(#grsMound)" />
      <path d="M0 236C90 222 170 228 260 238C360 250 440 226 540 228C650 230 720 252 830 246C940 240 1010 222 1120 226C1230 230 1300 250 1410 246C1500 242 1560 232 1600 230" fill="none" stroke="#ffe0c8" strokeWidth="2" opacity=".6" />
    </svg>
  );
});

/** A near tuff cliff, 600 × 640, drawn for the left side (the right one is mirrored). */
const CliffArt = memo(function CliffArt({ id, flip }: { id: string; flip?: boolean }) {
  const holes: Array<[number, number]> = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) holes.push([150 + i * 46 + row * 22, 300 + row * 54]);
  return (
    <svg className={styles.full} viewBox="0 0 600 640" preserveAspectRatio={flip ? 'xMaxYMax meet' : 'xMinYMax meet'} aria-hidden="true" focusable="false" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <defs>
        <linearGradient id={`${id}F`} x1="0" y1="0" x2="1" y2="0">{stops([[0, '#8a5654'], [0.55, '#c88a78'], [0.85, '#eab496'], [1, '#f8d2b2']])}</linearGradient>
        <linearGradient id={`${id}S`} x1="0" y1="0" x2="0" y2="1">{stops([[0, '#fff', 0.12], [0.6, '#000', 0], [1, '#2a1018', 0.45]])}</linearGradient>
        <linearGradient id={`${id}C`} x1="0" y1="0" x2="1" y2="1">{stops([[0, '#6e4c50'], [1, '#34222a']])}</linearGradient>
      </defs>
      {/* tall chimney behind the cliff */}
      <path d="M420 330C430 250 444 180 452 130H488C496 180 510 250 520 330Z" fill={`url(#${id}F)`} />
      <path d="M432 132C432 104 508 104 508 132C494 140 446 140 432 132Z" fill={`url(#${id}C)`} />
      {/* the cliff mass */}
      <path d="M0 640V170C30 150 64 150 90 176C110 120 160 90 210 100C250 60 320 60 356 110C390 140 410 190 420 250C450 280 470 330 480 380C520 410 560 470 580 540L600 640Z" fill={`url(#${id}F)`} />
      <path d="M0 640V170C30 150 64 150 90 176C110 120 160 90 210 100C250 60 320 60 356 110C390 140 410 190 420 250C450 280 470 330 480 380C520 410 560 470 580 540L600 640Z" fill={`url(#${id}S)`} />
      <path d="M90 176C110 120 160 90 210 100C250 60 320 60 356 110C390 140 410 190 420 250C450 280 470 330 480 380C520 410 560 470 580 540" fill="none" stroke="#ffe2c8" strokeWidth="3" opacity=".55" />
      {/* erosion flutes */}
      <path d="M120 200C116 300 110 420 100 600M200 140C200 260 196 420 190 620M300 120C306 240 310 420 304 620M380 220C390 320 400 440 404 620" stroke="#7a4448" strokeWidth="3" opacity=".3" fill="none" />
      {/* painted dovecote band and holes */}
      <rect x="128" y="274" width="268" height="12" fill="#fff4e6" opacity=".75" />
      {Array.from({ length: 22 }, (_, i) => <path key={i} d={`M${132 + i * 12} 286l6 -9l6 9z`} fill={P.madder.base} opacity=".75" />)}
      {holes.map(([x, y], i) => <path key={i} d={`M${x - 9} ${y + 14}V${y}A9 9 0 0 1 ${x + 9} ${y}V${y + 14}Z`} fill="#4a2228" stroke="#fff0dc" strokeWidth="3" strokeOpacity=".7" />)}
      {/* cut windows and a door */}
      <path d="M232 470V440A16 16 0 0 1 264 440V470Z M320 520V500A12 12 0 0 1 344 500V520Z M150 540V516A13 13 0 0 1 176 516V540Z" fill="#3e1c22" />
      <path d="M236 600V556A24 24 0 0 1 284 556V600Z" fill="#2e1418" />
      <path d="M230 600H290" stroke="#ffe2c8" strokeWidth="3" opacity=".4" />
    </svg>
  );
});

/** Valley floor, 1600 × 140: vineyard rows and poplars. */
const FloorArt = memo(function FloorArt() {
  const r = rng(41);
  const poplars: string[] = [];
  for (let i = 0; i < 16; i++) {
    const x = 200 + i * 78 + r() * 30, h = 50 + r() * 40, y = 70 + r() * 10;
    poplars.push(`M${f1(x)} ${f1(y)}C${f1(x - 9)} ${f1(y - h * 0.4)} ${f1(x - 6)} ${f1(y - h * 0.9)} ${f1(x)} ${f1(y - h)}C${f1(x + 6)} ${f1(y - h * 0.9)} ${f1(x + 9)} ${f1(y - h * 0.4)} ${f1(x)} ${f1(y)}Z`);
  }
  const rows: string[] = [];
  for (let i = 0; i < 6; i++) rows.push(`M0 ${84 + i * 10}Q800 ${74 + i * 10} 1600 ${86 + i * 10}`);
  return (
    <svg className={styles.full} viewBox="0 0 1600 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grsFloor" x1="0" y1="0" x2="0" y2="1">{stops([[0, '#b8786a'], [1, '#6a3a3e']])}</linearGradient>
        <linearGradient id="grsPoplar" x1="0" y1="0" x2="1" y2="0">{stops([[0, '#3c5a38'], [0.6, '#5e7e44'], [1, '#9aa860']])}</linearGradient>
      </defs>
      <path d="M0 140V78C300 66 600 72 800 70C1000 68 1300 64 1600 76V140Z" fill="url(#grsFloor)" />
      <path d={rows.join('')} fill="none" stroke="#4e5a34" strokeWidth="3" strokeDasharray="10 8" opacity=".55" />
      {poplars.map((d, i) => <path key={i} d={d} fill="url(#grsPoplar)" />)}
    </svg>
  );
});

/** Small background balloon (simplified envelope with stripes). */
const MINI_HUES: ReadonlyArray<readonly [string, string, string]> = [
  [P.madder.light, P.madder.deep, P.saffron.light], [P.turq.light, P.turq.deep, P.saffron.hi], [P.saffron.light, P.saffron.deep, P.madder.base],
  [P.plum.light, P.plum.deep, P.saffron.light], [P.indigo.light, P.indigo.deep, P.madder.light], [P.leaf.light, P.leaf.deep, '#fff4dc'],
];
const MiniBalloon = memo(function MiniBalloon({ hue, id }: { hue: number; id: string }) {
  const [a, b, c] = MINI_HUES[hue % MINI_HUES.length]!;
  return (
    <svg className={styles.full} viewBox="0 0 40 52" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id} cx=".36" cy=".3" r=".75">{stops([[0, a], [1, b]])}</radialGradient>
        <clipPath id={`${id}c`}><path d="M20 1C31 1 38 8 38 17C38 25 31 30 26 34L24 37H16L14 34C9 30 2 25 2 17C2 8 9 1 20 1Z" /></clipPath>
      </defs>
      <path d="M20 1C31 1 38 8 38 17C38 25 31 30 26 34L24 37H16L14 34C9 30 2 25 2 17C2 8 9 1 20 1Z" fill={`url(#${id})`} />
      <g clipPath={`url(#${id}c)`}>
        <rect x="0" y="12" width="40" height="5" fill={c} />
        <rect x="0" y="24" width="40" height="2.4" fill={c} opacity=".8" />
        <path d="M20 1Q8 18 18 37M20 1Q32 18 22 37" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth=".8" />
        <ellipse cx="13" cy="10" rx="7" ry="5" fill="#fff" opacity=".3" />
      </g>
      <path d="M16 37L17 43M24 37L23 43" stroke="#3a2026" strokeWidth=".8" />
      <rect x="16" y="43" width="8" height="6" rx="1" fill="#7a4a30" />
    </svg>
  );
});
/* [left %, top %, width vmin, hue, drift duration s, delay s, dx px, dy px, layer] layer 0 = behind mesas, 1 = mid, 2 = feature-only */
type Bl = readonly [number, number, number, number, number, number, number, number, 0 | 1 | 2];
const BALLOONS: readonly Bl[] = [
  [8, 34, 2.4, 0, 70, -10, 40, -30, 0], [22, 22, 1.8, 1, 90, -40, 30, -24, 0], [36, 40, 2.1, 2, 80, -20, -36, -28, 0],
  [58, 26, 1.6, 3, 95, -55, 30, -20, 0], [80, 38, 2.2, 4, 75, -5, -30, -30, 0], [92, 18, 1.5, 5, 88, -30, 24, -18, 0],
  [14, 14, 3.6, 3, 60, -25, 50, -36, 1], [70, 12, 3.2, 0, 66, -12, -44, -34, 1], [46, 8, 2.8, 1, 72, -48, 40, -26, 1], [88, 52, 3.8, 2, 58, -8, -36, -40, 1],
  [28, 6, 2.6, 4, 64, -18, 36, -28, 2], [62, 4, 2.4, 5, 70, -34, -30, -24, 2], [4, 50, 3, 1, 62, -6, 30, -30, 2], [52, 46, 2, 0, 80, -22, -26, -20, 2],
];
function Balloons({ layer }: { layer: 0 | 1 | 2 }) {
  return (
    <>
      {BALLOONS.map((b, i) => b[8] !== layer ? null : (
        <div key={i} className={styles.balloon} data-layer={layer} style={{ left: `${b[0]}%`, top: `${b[1]}%`, width: `${b[2]}cqmin`, ['--dur' as string]: `${b[4]}s`, ['--delay' as string]: `${b[5]}s`, ['--dx' as string]: `${b[6]}px`, ['--dy' as string]: `${b[7]}px` }}>
          <MiniBalloon hue={b[3]} id={`grsMb${i}`} />
        </div>
      ))}
    </>
  );
}

export function GoremeScene({ mood = 'base', children, className, style, parallax = true, ref }: GoremeSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sunRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    get element() { return rootRef.current; },
    sunPoint() {
      const el = sunRef.current, root = rootRef.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
      return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
    },
  }), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !parallax) return;
    const fine = window.matchMedia('(pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduced.matches) return;
    let raf = 0, tx = 0, ty = 0;
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; root.style.setProperty('--px', tx.toFixed(3)); root.style.setProperty('--py', ty.toFixed(3)); });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, [parallax]);

  return (
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-mood={mood} style={style}>
      <div className={styles.back} aria-hidden="true">
        <div className={styles.sky} />
        <div className={styles.skyFeature} />
        <div className={styles.stars} />
        <div className={`${styles.sunWrap} ${styles.pSun}`}>
          <div className={styles.sunMove}>
            <div className={styles.shafts} />
            <div className={styles.sunGlow} />
            <div ref={sunRef} className={styles.sun} />
          </div>
        </div>
        <div className={`${styles.cloud} ${styles.c1}`} /><div className={`${styles.cloud} ${styles.c2}`} /><div className={`${styles.cloud} ${styles.c3}`} />
        <div className={`${styles.balloons} ${styles.pFar}`}><Balloons layer={0} /></div>
        <div className={`${styles.mesas} ${styles.pFar}`}><MesaArt /></div>
        <div className={`${styles.balloons} ${styles.pMid}`}><Balloons layer={1} /><div className={styles.featureOnly}><Balloons layer={2} /></div></div>
        <div className={`${styles.field} ${styles.pMid}`}><FieldArt /></div>
        <div className={styles.haze} />
        <div className={`${styles.floor} ${styles.pNear}`}><FloorArt /></div>
        <div className={`${styles.cliff} ${styles.cliffL} ${styles.pNear}`}><CliffArt id="grsCL" /></div>
        <div className={`${styles.cliff} ${styles.cliffR} ${styles.pNear}`}><CliffArt id="grsCR" flip /></div>
        <div className={styles.moodBig} />
        <div className={styles.vignette} />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

/** Recommended layout over the scene: logo, sky band and the reel window; phone portrait stacks them, landscape puts
    the logo on the left column and the sky band directly above the reel window. Pass `side` for a desktop rail. */
export function GoremeStage({ logo, skyBand, board, side, className }: { logo?: ReactNode; skyBand?: ReactNode; board: ReactNode; side?: ReactNode; className?: string }) {
  return (
    <div className={`${styles.stage} ${className ?? ''}`}>
      {logo && <div className={styles.stageLogo}>{logo}</div>}
      <div className={styles.stageMain}>
        {skyBand && <div className={styles.stageBand}>{skyBand}</div>}
        <div className={styles.stageBoard}>{board}</div>
      </div>
      {side && <div className={styles.stageSide}>{side}</div>}
    </div>
  );
}
