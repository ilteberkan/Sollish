'use client';

import { memo, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { AS_PALETTE as P } from './symbols';
import type { AsenaMood } from './fx';
import styles from './scene.module.css';

/* "Yıldız Kurdu" backdrop: the steppe at night under Gök Tengri. Back → front:
   sky gradient · the sky canvas slot (AsenaFx draws stars, aurora and the sky-gate rays there) · Ay Ata,
   the full moon with a faint face · far mountain ranges with moonlit snow · Ergenekon, the iron mountain (right),
   whose cracks glow per map level and whose cleft opens at ×5 · rolling hills with a wishing tree (cloth strips)
   and standing stones · an otağ camp (felt tents with lit doors, rising smoke) · the howling wolf on its rock
   (left; the head is its own layer) · front grass · the echo canvas (the constellation's large sky echo) · mood washes and vignette · children.
   Everything is code-drawn and original. Layers are bottom-anchored and sized in viewport-relative units, so the
   same scene works on a 390 × 844 phone and a 1440 × 900 desktop. Moods: base, feature (aurora wash, mountain
   veins wake), bigwin (gold-violet wash). Only transform / opacity animate; pointer parallax on fine pointers only,
   never with reduced motion. */

export type { AsenaMood };
export interface AsenaSceneHandle {
  /** The canvas behind the silhouettes (pass to AsenaFx as `sky`). */
  readonly skyCanvas: HTMLCanvasElement | null;
  /** The canvas above the silhouettes for the constellation sky echo (pass to AsenaFx as `echo`). */
  readonly echoCanvas: HTMLCanvasElement | null;
  /** The wolf on the rock throws its head back and howls (~1.6 s). */
  howl(): void;
  /** Ergenekon map level 0..3 (0 dark · 1 ×2 cracks · 2 ×3 veins · 3 ×5 the cleft opens). */
  ergenekon(level: number): void;
  /** Root-relative points for FX: the wolf's muzzle and the iron mountain's heart. */
  wolfPoint(): { x: number; y: number } | null;
  mountainPoint(): { x: number; y: number } | null;
  /** The scene root (AsenaFx root when the scene hosts the whole game). */
  readonly element: HTMLDivElement | null;
}
export interface AsenaSceneProps { mood?: AsenaMood; children?: ReactNode; className?: string; style?: CSSProperties; parallax?: boolean; ref?: Ref<AsenaSceneHandle> }

const f1 = (n: number) => Math.round(n * 10) / 10;
type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Jagged ridge from x 0 to w with peaks; returns a closed path to the bottom. */
function ridge(seed: number, w: number, h: number, base: number, amp: number, n: number, peaks: Array<[number, number]> = []) {
  const r = rng(seed);
  let d = `M0 ${h}L0 ${f1(base)}`;
  for (let i = 1; i <= n; i++) {
    const x = (i / n) * w;
    let y = base - r() * amp * (i % 2 ? 1 : 0.45);
    for (const [px, ph] of peaks) { const k = Math.max(0, 1 - Math.abs(x - px) / (w * 0.09)); y = Math.min(y, base - ph * k * (0.9 + r() * 0.1)); }
    d += `L${f1(x)} ${f1(y)}`;
  }
  return `${d}L${w} ${h}Z`;
}

const FAR1 = ridge(11, 1600, 360, 250, 70, 34, [[300, 190], [760, 150], [1180, 210]]);
const FAR2 = ridge(23, 1600, 360, 300, 50, 46, [[520, 120], [980, 110], [1420, 140]]);
const SNOW = ((): string => {
  const r = rng(5);
  let d = '';
  for (const [px, py, s] of [[300, 62, 1], [760, 102, 0.8], [1180, 42, 1.1], [520, 182, 0.6], [980, 192, 0.6]] as const) {
    d += `M${px} ${py}L${f1(px - 36 * s)} ${f1(py + 40 * s)}L${f1(px - 18 * s)} ${f1(py + 34 * s)}L${f1(px - 8 * s)} ${f1(py + 46 * s + r() * 6)}L${f1(px + 6 * s)} ${f1(py + 30 * s)}Z`;
  }
  return d;
})();
const HILLS = 'M0 260V120C120 92 220 70 340 78C460 86 520 120 640 124C760 128 860 96 980 92C1100 88 1180 112 1300 110C1420 108 1520 92 1600 96V260Z';
const HILLS2 = 'M0 260V176C160 150 300 158 420 170C560 184 700 160 840 162C980 164 1100 186 1240 180C1380 174 1500 160 1600 166V260Z';

const MountainArt = memo(function MountainArt() {
  return (
    <svg className={styles.full} viewBox="0 0 1600 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="asmFar1" x1="0" y1="80" x2="0" y2="360" gradientUnits="userSpaceOnUse">{stops([[0, '#2a3878'], [0.5, '#18215a'], [1, '#0c1238']])}</linearGradient>
        <linearGradient id="asmFar2" x1="0" y1="140" x2="0" y2="360" gradientUnits="userSpaceOnUse">{stops([[0, '#1a2460'], [1, '#080c2a']])}</linearGradient>
        <linearGradient id="asmHaze" x1="0" y1="200" x2="0" y2="360" gradientUnits="userSpaceOnUse">{stops([[0, '#5a6ad0', 0], [1, '#5a6ad0', 0.18]])}</linearGradient>
      </defs>
      <path d={FAR1} fill="url(#asmFar1)" />
      <path d={SNOW} fill="#c8d4ff" opacity=".42" />
      <rect y="200" width="1600" height="160" fill="url(#asmHaze)" />
      <path d={FAR2} fill="url(#asmFar2)" />
    </svg>
  );
});

/** Ergenekon: the iron mountain, 420 × 300. */
const IronArt = memo(function IronArt() {
  const veins = 'M210 96L198 132L214 160L196 204L208 250M214 160L246 188L240 230M198 132L170 156L160 196';
  return (
    <svg className={styles.full} viewBox="0 0 420 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="asiL" x1="0" y1="0" x2="1" y2="1">{stops([[0, '#5a6280'], [0.4, '#2c3044'], [1, '#12141e']])}</linearGradient>
        <linearGradient id="asiR" x1="1" y1="0" x2="0" y2="1">{stops([[0, '#22263a'], [0.6, '#14161f'], [1, '#08090f']])}</linearGradient>
        <radialGradient id="asiMolten" cx="210" cy="250" r="160" gradientUnits="userSpaceOnUse">{stops([[0, '#ffb84a', 0.85], [0.35, '#ff6a1a', 0.4], [1, '#ff3a0a', 0]])}</radialGradient>
        <linearGradient id="asiCleft" x1="0" y1="0" x2="0" y2="1">{stops([[0, '#fff6d0'], [0.5, '#ffc46a'], [1, '#ff7a2a']])}</linearGradient>
      </defs>
      <g className={styles.molten}><ellipse cx="210" cy="250" rx="200" ry="110" fill="url(#asiMolten)" /></g>
      {/* faceted iron massif: lit west faces, dark east faces */}
      <path d="M0 300L60 210L96 222L150 120L190 140L210 60L232 128L270 112L330 196L360 186L420 300Z" fill="url(#asiR)" />
      <path d="M0 300L60 210L96 222L150 120L176 196L210 60L196 300ZM270 112L254 220L330 196Z" fill="url(#asiL)" />
      <path d="M150 120L176 196M210 60L196 300M270 112L254 220M60 210L84 300M330 196L344 300" stroke="#8a94c0" strokeWidth="1.4" opacity=".45" />
      <path d="M210 60L190 140L150 120M210 60L232 128L270 112" fill="none" stroke="#c8d4ff" strokeWidth="2" opacity=".55" />
      {/* iron strata */}
      <path d="M40 252L120 236L200 250L300 232L392 254M70 274L170 262L260 276L360 266" stroke="#000" strokeWidth="3" opacity=".35" fill="none" />
      {/* cracks per level */}
      <g className={styles.crack1} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={veins} stroke="#ff7a2a" strokeWidth="9" opacity=".45" /><path d={veins} stroke="#ffc46a" strokeWidth="3.4" /><path d={veins} stroke="#fff6d0" strokeWidth="1.2" />
      </g>
      <g className={styles.crack2} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M150 120L134 176L150 214L126 262M270 112L284 160L268 196L292 250M96 222L112 258M330 196L318 240" stroke="#ff7a2a" strokeWidth="8" opacity=".45" />
        <path d="M150 120L134 176L150 214L126 262M270 112L284 160L268 196L292 250M96 222L112 258M330 196L318 240" stroke="#ffc46a" strokeWidth="3" />
      </g>
      <g className={styles.crack3}>
        <path d="M210 70L196 150L214 210L200 300H228L238 210L222 150Z" fill="url(#asiCleft)" />
        <path d="M210 70L196 150L214 210L200 300H228L238 210L222 150Z" fill="none" stroke="#fff" strokeWidth="2" opacity=".8" />
      </g>
    </svg>
  );
});

const HillArt = memo(function HillArt() {
  const strips = [['#d84a3a', 0], ['#3ab8d8', 14], ['#f2c040', 28], ['#ffffff', 42], ['#6ad87a', 58]] as const;
  return (
    <svg className={styles.full} viewBox="0 0 1600 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ashH1" x1="0" y1="70" x2="0" y2="260" gradientUnits="userSpaceOnUse">{stops([[0, '#141c4a'], [1, '#070a22']])}</linearGradient>
        <linearGradient id="ashH2" x1="0" y1="150" x2="0" y2="260" gradientUnits="userSpaceOnUse">{stops([[0, '#0c1236'], [1, '#04061a']])}</linearGradient>
      </defs>
      <path d={HILLS} fill="url(#ashH1)" />
      <path d={HILLS} fill="none" stroke="#8ea6ff" strokeWidth="1.6" opacity=".3" />
      {/* wishing tree on the right hill: wind-bent branches, cloth strips tied on */}
      <g transform="translate(1330 112)">
        <path d="M-4 0C-6 -16 -4 -30 -8 -46C-10 -58 -6 -68 2 -78M-7 -40C-20 -50 -34 -52 -48 -48M-6 -54C4 -64 18 -68 34 -66M-3 -30C8 -36 20 -38 30 -34M2 -78C10 -84 18 -86 26 -84M-8 -46C-16 -62 -24 -70 -34 -74" fill="none" stroke="#04061a" strokeWidth="4.4" strokeLinecap="round" />
        <path d="M-9 0L-6 -40L0 -40L3 0Z" fill="#04061a" />
        {strips.map(([c, x], i) => <path key={i} className={styles.strip} style={{ animationDelay: `${-i * 0.7}s` }} d={`M${-44 + x * 1.3} ${-52 + (i % 2) * 8 - (i === 3 ? 10 : 0)}l2 13l-4 -1z`} fill={c} opacity=".8" />)}
      </g>
      {/* standing stones */}
      {[[220, 84, 14, 34], [250, 82, 10, 24], [276, 80, 12, 30]].map(([x, y, w, h], i) => <path key={i} d={`M${x} ${y}L${x + 2} ${y - h}Q${x + w / 2} ${y - h - 6} ${x + w - 2} ${y - h}L${x + w} ${y}Z`} fill="#06081e" />)}
      <path d={HILLS2} fill="url(#ashH2)" />
    </svg>
  );
});

/** Otağ camp, 560 × 200: three felt tents, door light is a separate glow layer. */
const OTAG = [[40, 92, 1], [210, 70, 1.25], [400, 100, 0.9]] as const;
const CampArt = memo(function CampArt() {
  return (
    <svg className={styles.full} viewBox="0 0 560 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ascFelt" x1="0" y1="0" x2="1" y2="0">{stops([[0, '#2a1e30'], [0.4, '#4a3448'], [1, '#160e1c']])}</linearGradient>
        <linearGradient id="ascDoor" x1="0" y1="0" x2="0" y2="1">{stops([[0, '#ffd27a'], [1, '#ff8a2a']])}</linearGradient>
      </defs>
      {OTAG.map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
          <ellipse cx="80" cy="122" rx="96" ry="10" fill="#000" opacity=".45" />
          <path d="M0 120V70C10 40 50 20 80 18C110 20 150 40 160 70V120Z" fill="url(#ascFelt)" stroke="#05040a" strokeWidth="2" />
          <path d="M0 70C10 40 50 20 80 18C110 20 150 40 160 70" fill="none" stroke="#c8d4ff" strokeWidth="1.6" opacity=".35" />
          <path d="M66 18Q80 10 94 18" fill="none" stroke="#05040a" strokeWidth="4" />
          <rect x="0" y="70" width="160" height="11" fill={P.felt.base} />
          <path d={Array.from({ length: 10 }, (_, j) => `M${j * 16 + 2} 79L${j * 16 + 8} 72L${j * 16 + 14} 79`).join('')} fill="none" stroke={P.bronze.light} strokeWidth="1.6" opacity=".8" />
          <path d="M14 26L80 18L146 26" fill="none" stroke="#05040a" strokeWidth="1.4" opacity=".6" />
          <rect x="66" y="86" width="28" height="34" fill="url(#ascDoor)" opacity=".9" />
          <path d="M64 86H96" stroke={P.bronze.base} strokeWidth="3" />
        </g>
      ))}
      {/* horse-hair standard pole */}
      <path d="M190 100V20" stroke="#05040a" strokeWidth="3" />
      <path d="M190 22C182 30 182 44 186 54C190 44 196 34 190 22Z" fill="#05040a" />
    </svg>
  );
});

/** The howling wolf on its rock, 300 × 300. The head is a separate layer (rotates about the neck). */
const WOLF_BODY = 'M100 206C84 208 62 206 34 216C48 200 70 190 92 187C92 167 98 145 112 127C122 113 134 101 146 91L161 81L180 95C186 107 188 120 184 134L191 140L183 146L189 154L181 158C179 172 179 190 183 202L196 207H164C162 192 158 180 152 172C144 184 137 196 137 207Z';
const WOLF_HEAD = 'M150 92C144 78 145 64 153 54L147 33L164 45C170 41 176 37 182 31L205 11L210 15C204 23 198 29 193 33L200 33C193 43 187 53 183 63C181 77 181 89 183 100Z';
const WolfRockArt = memo(function WolfRockArt({ headRef }: { headRef: Ref<SVGGElement> }) {
  return (
    <svg className={styles.full} viewBox="0 0 300 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="aswRock" x1="0" y1="0" x2="1" y2="1">{stops([[0, '#2a3460'], [0.5, '#121838'], [1, '#05071a']])}</linearGradient>
      </defs>
      <path d="M0 300L0 240L30 216L70 206L120 202L204 206L246 218L272 240L292 270L300 300Z" fill="url(#aswRock)" />
      <path d="M30 216L70 206L120 202L204 206L246 218L272 240" fill="none" stroke="#9fb6ff" strokeWidth="2.2" opacity=".6" />
      <path d="M60 240L110 228L150 246M200 236L236 252" fill="none" stroke="#000" strokeWidth="3" opacity=".35" />
      <path d={WOLF_BODY} fill="#04061a" stroke="#9fb6ff" strokeWidth="1.6" strokeOpacity=".5" strokeLinejoin="round" />
      <g ref={headRef} className={styles.wolfHead}>
        <path d={WOLF_HEAD} fill="#04061a" stroke="#bcd0ff" strokeWidth="1.8" strokeOpacity=".7" strokeLinejoin="round" />
        <path d="M168 47L176 44" stroke="#ffd970" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </svg>
  );
});

const GrassArt = memo(function GrassArt() {
  const r = rng(77);
  let d = 'M0 120V70';
  for (let x = 0; x <= 1600; x += 9) d += `L${x} ${f1(62 - r() * 26)}L${x + 4} ${f1(74 + r() * 4)}`;
  d += 'L1600 120Z';
  return <svg className={styles.full} viewBox="0 0 1600 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><path d={d} fill="#02030c" /></svg>;
});

/** Ay Ata: the full moon with the faint face of the moon father. */
const MoonArt = memo(function MoonArt() {
  return (
    <svg className={styles.full} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="asmoon" cx=".42" cy=".38" r=".62">{stops([[0, '#ffffff'], [0.5, '#eceaf6'], [0.85, '#c4c4e0'], [1, '#9a9ac8']])}</radialGradient>
      </defs>
      <circle cx="100" cy="100" r="64" fill="url(#asmoon)" />
      <g fill="#8a8ab8" opacity=".25"><circle cx="128" cy="76" r="9" /><circle cx="72" cy="124" r="7" /><circle cx="134" cy="128" r="5" /><circle cx="84" cy="70" r="4" /></g>
      <g fill="none" stroke="#7a7aa8" strokeWidth="2.4" strokeLinecap="round" opacity=".3">
        <path d="M70 88Q80 82 90 88M110 88Q120 82 130 88M74 96Q80 100 86 96M114 96Q120 100 126 96M100 94V112M84 124Q100 138 116 124" />
      </g>
    </svg>
  );
});

export function AsenaScene({ mood = 'base', children, className, style, parallax = true, ref }: AsenaSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const echoRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const wolfRef = useRef<HTMLDivElement>(null);
  const ironRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    get skyCanvas() { return skyRef.current; },
    get echoCanvas() { return echoRef.current; },
    get element() { return rootRef.current; },
    howl() {
      const el = wolfRef.current;
      if (!el) return;
      el.removeAttribute('data-howl');
      void el.offsetWidth;
      el.setAttribute('data-howl', '');
      window.setTimeout(() => el.removeAttribute('data-howl'), 1700);
    },
    ergenekon(level) { rootRef.current?.setAttribute('data-erg', String(Math.max(0, Math.min(3, Math.round(level))))); },
    wolfPoint() {
      const el = wolfRef.current, root = rootRef.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
      return { x: r.left - o.left + r.width * (206 / 300), y: r.top - o.top + r.height * (46 / 300) };
    },
    mountainPoint() {
      const el = ironRef.current, root = rootRef.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect(), o = root.getBoundingClientRect();
      return { x: r.left - o.left + r.width * 0.5, y: r.top - o.top + r.height * 0.5 };
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
    <div ref={rootRef} className={`${styles.root} ${className ?? ''}`} data-mood={mood} data-erg="0" style={style}>
      <div className={styles.back} aria-hidden="true">
        <div className={styles.sky} />
        <canvas ref={skyRef} className={styles.skyCanvas} />
        <div className={`${styles.moon} ${styles.pMoon}`}><div className={styles.moonHalo} /><MoonArt /></div>
        <div className={`${styles.far} ${styles.pFar}`}><MountainArt /></div>
        <div ref={ironRef} className={`${styles.iron} ${styles.pIron}`}><IronArt /></div>
        <div className={`${styles.hills} ${styles.pMid}`}><HillArt /></div>
        <div className={`${styles.camp} ${styles.pCamp}`}>
          <CampArt />
          {OTAG.map(([x, y, s], i) => <span key={i} className={styles.doorGlow} style={{ left: `${((x + 80 * s) / 560) * 100}%`, top: `${((y + 104 * s) / 200) * 100}%`, animationDelay: `${-i * 1.1}s` }} />)}
          {OTAG.map(([x, y, s], i) => <span key={`s${i}`} className={styles.smoke} style={{ left: `${((x + 80 * s) / 560) * 100}%`, top: `${((y + 14 * s) / 200) * 100}%`, animationDelay: `${-i * 2.3}s` }} />)}
        </div>
        <div ref={wolfRef} className={`${styles.wolf} ${styles.pWolf}`}><WolfRockArt headRef={headRef} /></div>
        <div className={styles.grass}><GrassArt /></div>
        <canvas ref={echoRef} className={styles.skyCanvas} />
        <div className={styles.moodFeature} />
        <div className={styles.moodBig} />
        <div className={styles.vignette} />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
