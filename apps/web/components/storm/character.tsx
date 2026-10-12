'use client';

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import styles from './character.module.css';

/* Tarhun, the storm god of "Fırtına Tahtı". Original character drawn as hand-authored inline SVG,
   inspired by public-domain Bronze Age Anatolian storm-god iconography (conical horned cap,
   curled beard, short kilt, upturned boots, axe + triple lightning). Cut-out rig: every limb is
   its own <g> rotated around a fixed pivot by CSS (transform-box: view-box), so poses are pure
   CSS transitions and the SVG never re-renders while animating. No blur filters: glows are
   radial gradients, so the figure stays cheap on phones. */

export type StormPose = 'idle' | 'charge' | 'strike' | 'laugh' | 'triumph' | 'calm';
export type StormFraming = 'full' | 'bust' | 'auto';
export interface StormPoint { x: number; y: number }

export interface StormCharacterHandle {
  /** Viewport (client px) position of the held bolt's tip; null before mount. */
  getBoltPoint(): StormPoint | null;
  /** Switch pose imperatively (the `pose` prop wins again when it changes). */
  setPose(pose: StormPose): void;
  /** Wind up and hurl toward `target` (client px). Resolves at the release frame with the bolt-tip
      position, so the caller can draw the canvas bolt from there to a board cell. */
  strike(target: StormPoint): Promise<StormPoint | null>;
}

export interface StormCharacterProps {
  pose?: StormPose;
  /** Client-px point the strike pose aims at (also settable through `handle.strike`). */
  target?: StormPoint;
  framing?: StormFraming;
  className?: string;
  style?: CSSProperties;
  /** Return to `pose` this many ms after an imperative strike (0 = stay). */
  strikeHoldMs?: number;
  ref?: Ref<StormCharacterHandle>;
}

/* rig pivots in viewBox units */
const PIV = {
  waist: [210, 396],
  neck: [210, 236],
  chin: [210, 212],
  shA: [131, 262],
  elA: [129, 346],
  handA: [129, 432],
  shB: [289, 262],
  elB: [291, 346],
  handB: [291, 432],
  cloak: [210, 250],
} as const;
const origin = (p: readonly [number, number]): CSSProperties => ({ transformOrigin: `${p[0]}px ${p[1]}px` });

const VIEW = { full: '-60 -74 540 834', bust: '52 -44 316 380' } as const;

type Stop = readonly [number, string, number?];
const stops = (s: readonly Stop[]) => s.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />);
function LG({ id, x1 = 0, y1 = 0, x2 = 0, y2 = 1, s, user }: { id: string; x1?: number; y1?: number; x2?: number; y2?: number; s: readonly Stop[]; user?: boolean }) {
  return <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits={user ? 'userSpaceOnUse' : undefined}>{stops(s)}</linearGradient>;
}
function RG({ id, cx = 0.5, cy = 0.5, r = 0.5, fx, fy, s, user }: { id: string; cx?: number; cy?: number; r?: number; fx?: number; fy?: number; s: readonly Stop[]; user?: boolean }) {
  return <radialGradient id={id} cx={cx} cy={cy} r={r} fx={fx ?? cx} fy={fy ?? cy} gradientUnits={user ? 'userSpaceOnUse' : undefined}>{stops(s)}</radialGradient>;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const mirror = (d: string) => d.replace(/([MLCQSTHVAZmlcqsthvaz])([^MLCQSTHVAZmlcqsthvaz]*)/g, (_, cmd: string, args: string) => {
  const nums = args.trim().length ? args.trim().split(/[\s,]+/).map(Number) : [];
  if (cmd === 'H') return `H${r1(420 - nums[0]!)}`;
  if (cmd === 'V' || cmd === 'Z' || cmd === 'z') return `${cmd}${args}`;
  if (cmd === 'A') {
    const [rx, ry, rot, la, sw, x, y] = nums as [number, number, number, number, number, number, number];
    return `A${rx} ${ry} ${-rot} ${la} ${sw ? 0 : 1} ${r1(420 - x)} ${y}`;
  }
  if (cmd === 'h') return `h${-nums[0]!}`;
  if (cmd === 'a') return `a${nums[0]} ${nums[1]} ${-nums[2]!} ${nums[3]} ${nums[4] ? 0 : 1} ${-nums[5]!} ${nums[6]}`;
  if (cmd >= 'a') return cmd + nums.map((v, i) => (i % 2 === 0 ? -v : v)).join(' ');
  return cmd + nums.map((v, i) => (i % 2 === 0 ? r1(420 - v) : v)).join(' ');
});
/* small spiral curl (beard / hair rows) */
const curl = (x: number, y: number, r: number, flip = false) => {
  const s = flip ? -1 : 1;
  return `M${r1(x - s * r)} ${r1(y)}a${r} ${r} 0 1 ${flip ? 0 : 1} ${r1(s * r)} ${r1(r)}a${r1(r * 0.55)} ${r1(r * 0.55)} 0 1 ${flip ? 0 : 1} ${r1(-s * r * 0.55)} ${r1(-r * 0.55)}`;
};

const INK = '#170b05';

/* ------------------------------------------------------------------ paths (rest pose) */
const TORSO = 'M146 240C128 244 116 256 112 274C108 302 126 330 138 350C145 366 150 382 151 400H269C270 382 275 366 282 350C294 330 312 302 308 274C304 256 292 244 274 240C252 234 232 246 210 246C188 246 168 234 146 240Z';
const CLOAK = 'M132 246C94 254 70 310 60 392C46 488 26 600 -6 712C22 702 40 722 68 710C94 700 108 720 134 708C146 702 154 708 162 704L170 494H250L258 704C268 708 278 700 292 706C314 716 328 700 352 710C376 720 390 706 414 712C384 626 368 498 356 392C346 306 326 254 288 246Z';
const CLOAK_LINING = 'M60 392C46 488 26 600 -6 712C22 702 40 722 68 710C54 650 58 520 80 410C76 398 68 394 60 392Z';
const KILT = 'M150 398H270L292 470C278 480 264 466 248 476C234 486 220 472 206 482C192 492 174 478 158 488C148 494 136 488 126 486Z';
const APRON = 'M194 404H226L231 488L210 506L189 488Z';
const LEG_L = 'M150 478C135 516 125 556 129 600C120 630 123 664 132 704H172C174 668 181 634 179 602C191 566 203 520 209 480Z';
const BOOT_L = 'M133 688H176C180 706 181 726 180 744H112C94 744 82 734 79 719C77 708 83 699 92 699C100 699 103 706 98 711C106 715 114 712 120 705C125 699 129 693 133 688Z';
const GREAVE_L = 'M131 614C138 607 172 607 178 614C179 636 177 666 174 690C161 695 146 695 136 690C132 666 130 636 131 614Z';
const NECK = 'M188 204L186 242C198 252 222 252 234 242L232 204Z';
const FACE = 'M170 148C167 168 169 190 177 205C187 220 199 226 210 226C221 226 233 220 243 205C251 190 253 168 250 148Z';
const BEARD = 'M168 182C162 210 164 240 172 264C180 290 192 312 203 326L210 336L217 326C228 312 240 290 248 264C256 240 258 210 252 182C248 200 240 212 228 219C221 223 215 225 210 225C205 225 199 223 192 219C180 212 172 200 168 182Z';
const MUSTACHE_L = 'M210 203C199 201 187 204 181 212C177 218 171 219 168 213C169 222 178 227 187 221C194 215 202 212 210 212Z';
const BROW_L = 'M171 165C181 154 198 156 209.5 171.5L205 175.5C196 166.5 184 164.5 173.5 170Z';
const EYE_L = 'M180.5 178C185.5 174 196 173.4 203 177.2C197 180.6 186.5 181.2 180.5 178Z';
const LID_L = 'M177.5 177C184.5 170.6 197 170.2 205 176.4';
const EAR_L = 'M171 164C163 160 159 170 161 180C163 190 167 196 172 196Z';
const NOSE = 'M205 172C204 183 200 192 197 198C199 205 205 206 210 205C215 206 221 205 223 198C220 192 216 183 215 172Z';
const CONE = 'M163 142C166 112 186 70 212 30C234 70 254 112 257 142C236 134 184 134 163 142Z';
const BRIM = 'M158 158C178 146 242 146 262 158L259 140C238 131 182 131 161 140Z';
const BRAID_L = 'M168 168C160 190 154 214 150 238C147 252 146 262 148 272L160 272C160 262 162 250 166 236C170 216 176 194 180 172Z';
const UPPER_A = 'M102 262C93 286 94 314 102 336C105 344 108 350 110 354H150C155 340 160 322 160 302C160 286 158 272 156 262Z';
const PAULDRON_A = 'M90 282C84 254 104 232 132 232C156 232 170 248 166 276C154 266 142 266 131 271C116 265 102 270 90 282Z';
const FORE_A = 'M108 346C101 366 104 392 114 424H144C151 392 154 366 150 346Z';
const BRACER_A = 'M107 374H151L146 422H113Z';
const FIST_A = 'M109 422C107 411 116 405 129 405C142 405 151 411 149 422L150 442C150 453 143 459 129 459C115 459 108 453 108 442Z';
const AXE_BLADE = 'M122 304C110 300 96 290 86 274C62 288 46 306 46 324C46 342 60 358 84 372C96 356 110 346 122 340Z';
const AXE_SPIKE = 'M137 310L172 320L137 332Z';

/* lightning prongs, neutral orientation: grip at handB, pointing up */
const BOLT_C = 'M287 412L281 372L293 368L284 330L297 326L291 262L303 330L291 334L301 372L289 376L297 412Z';
const BOLT_L = 'M284 404L266 380L274 374L254 344L262 340L240 298L268 334L260 338L280 366L273 372L290 396Z';
const BOLT_TIP = [291, 262] as const;

function shift(d: string, dx: number) {
  return d.replace(/([MLC])([^MLCZ]*)/g, (_, c: string, a: string) => c + a.trim().split(/[\s,]+/).map(Number).map((v, i) => (i % 2 === 0 ? r1(v + dx) : v)).join(' '));
}
const BOLT_R_SH = shift(mirror(BOLT_L), 162); // mirrored about the bolt axis x=291

/* beard: flowing strands on top, rows of ringlets below */
const BEARD_CURLS: Array<[number, number, number]> = [];
([[276, 184, 236, 5, 7], [292, 190, 230, 4, 6.8], [307, 197, 223, 3, 6.4], [321, 204, 216, 2, 5.6]] as const).forEach(([y, a, b, n, r]) => {
  for (let i = 0; i < n; i++) BEARD_CURLS.push([r1(a + ((b - a) * i) / (n - 1)), y + (i % 2 ? 1.5 : 0), r]);
});
const BEARD_STRANDS = Array.from({ length: 11 }, (_, i) => {
  const x0 = 174 + i * 7.2;
  const x1 = 210 + (x0 - 210) * 0.78;
  const w = i % 2 ? 4 : -4;
  return `M${r1(x0)} 214C${r1(x0 + w)} 232 ${r1(x1 - w)} 250 ${r1(x1)} 272`;
});
const CHEEK_CURLS: Array<[number, number]> = [[176, 196], [178, 210], [186, 222], [244, 196], [242, 210], [234, 222]];
const HAIR_CURLS: Array<[number, number]> = [[168, 156], [167, 168], [252, 156], [253, 168]];

/* horns: three stacked pairs on the cone */
const HORNS = [
  { y: 128, span: 74, rise: 70, t: 17 },
  { y: 106, span: 42, rise: 40, t: 11 },
  { y: 84, span: 28, rise: 30, t: 8 },
].map(({ y, span, rise, t }) => {
  const w = 47 * Math.pow((y - 30) / 112, 0.85);
  const bx = 210 - w + 5;
  const tx = bx - span;
  const ty = y - rise;
  const d = `M${r1(bx)} ${y + t * 0.55}C${r1(bx - span * 0.55)} ${r1(y + t * 0.6)} ${r1(tx - 4)} ${r1(y - rise * 0.2)} ${r1(tx)} ${r1(ty)}C${r1(tx + span * 0.32)} ${r1(y - rise * 0.25)} ${r1(bx - span * 0.32)} ${r1(y - t * 0.55)} ${r1(bx)} ${r1(y - t * 0.45)}Z`;
  const ridges = [0.28, 0.46, 0.62].map((f) => {
    const x = bx - span * f;
    const yy = y + t * 0.4 - rise * f * f * 0.9;
    return `M${r1(x + 2)} ${r1(yy + t * 0.3 * (1 - f))}Q${r1(x - 4)} ${r1(yy - t * 0.3)} ${r1(x - 2 + f * 4)} ${r1(yy - t * 0.85 * (1 - f * 0.6))}`;
  });
  return { d, ridges, bx, y, t };
});

const SPARKS = [
  'M262 300l-8 -6l5 -3l-9 -8',
  'M320 296l8 -7l-5 -2l10 -7',
  'M291 248l-3 -10l4 1l-2 -11',
  'M246 340l-10 2l3 3l-10 3',
  'M336 338l10 1l-3 3l11 2',
];

/* ------------------------------------------------------------------ component */
export function StormCharacter({ pose = 'idle', target, framing = 'full', className, style, strikeHoldMs = 650, ref }: StormCharacterProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `tz${uid}${n}`;
  const url = (n: string) => `url(#${k(n)})`;
  const [current, setCurrent] = useState<StormPose>(pose);
  const [aim, setAim] = useState(-100);
  const [auto, setAuto] = useState<'full' | 'bust'>('full');
  const tipRef = useRef<SVGCircleElement>(null);
  const shoulderRef = useRef<SVGCircleElement>(null);
  const timers = useRef<number[]>([]);
  const poseRef = useRef(pose);

  useEffect(() => { poseRef.current = pose; setCurrent(pose); }, [pose]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  useEffect(() => {
    if (framing !== 'auto' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 760px), (max-aspect-ratio: 4/5)');
    const apply = () => setAuto(mq.matches ? 'bust' : 'full');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [framing]);

  const center = (el: Element | null): StormPoint | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const aimAt = useCallback((t: StormPoint) => {
    const s = center(shoulderRef.current);
    if (!s) return;
    const deg = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI - 90;
    setAim(Math.max(-172, Math.min(-12, deg)));
  }, []);

  useEffect(() => { if (target && current === 'strike') aimAt(target); }, [target, current, aimAt]);

  useImperativeHandle(ref, () => ({
    getBoltPoint: () => center(tipRef.current),
    setPose: (p) => setCurrent(p),
    strike: (t) => new Promise<StormPoint | null>((resolve) => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      aimAt(t);
      const release = () => {
        setCurrent('strike');
        timers.current.push(window.setTimeout(() => {
          resolve(center(tipRef.current));
          if (strikeHoldMs > 0) timers.current.push(window.setTimeout(() => setCurrent(poseRef.current), strikeHoldMs));
        }, reduce ? 0 : 150));
      };
      if (reduce) { release(); return; }
      setCurrent('charge');
      timers.current.push(window.setTimeout(release, 190));
    }),
  }), [aimAt, strikeHoldMs]);

  const frame = framing === 'auto' ? auto : framing;

  return (
    <div className={`${styles.root} ${className ?? ''}`} data-pose={current} data-framing={frame} style={{ ...style, '--aim': `${aim}deg` } as CSSProperties} aria-hidden="true">
      <div className={styles.aura} />
      <svg className={styles.svg} viewBox={VIEW[frame]} preserveAspectRatio={frame === 'bust' ? 'xMidYMin meet' : 'xMidYMax meet'} focusable="false">
        <defs>
          <RG id={k('skin')} cx={0.36} cy={0.32} r={0.82} s={[[0, '#ecc39a'], [0.38, '#c08458'], [0.75, '#8c522d'], [1, '#4f2712']]} />
          <LG id={k('limb')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#3e1e0e'], [0.16, '#8a5232'], [0.4, '#dba67c'], [0.6, '#b47648'], [0.84, '#74401f'], [1, '#371a0a']]} />
          <LG id={k('legG')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#331709'], [0.24, '#864e2a'], [0.48, '#c99064'], [0.76, '#703b1d'], [1, '#2e1407']]} />
          <LG id={k('bronze')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fff2c6'], [0.18, '#f1be6c'], [0.45, '#b6752d'], [0.62, '#e7b363'], [0.85, '#7a4415'], [1, '#3f2108']]} />
          <LG id={k('bronzeH')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#4a270b'], [0.22, '#a96b28'], [0.45, '#ffe3a2'], [0.6, '#e0a654'], [0.82, '#7c4614'], [1, '#3a1d06']]} />
          <LG id={k('lamella')} x1={0} y1={0} x2={1} y2={0.3} s={[[0, '#f6d38c'], [0.35, '#c88a3e'], [0.75, '#8a5420'], [1, '#4a280c']]} />
          <LG id={k('bronzeV')} s={[[0, '#ffe9b4'], [0.3, '#e1a554'], [0.7, '#9a5d20'], [1, '#4a260a']]} />
          <LG id={k('cone')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#3a1d07'], [0.16, '#8a5418'], [0.36, '#f3c674'], [0.48, '#fff0c4'], [0.6, '#d69b4b'], [0.82, '#6d3c10'], [1, '#2e1604']]} />
          <LG id={k('hornL')} x1={1} y1={1} x2={0} y2={0} s={[[0, '#7a5530'], [0.3, '#dcc597'], [0.62, '#f6ecd2'], [0.86, '#a88a62'], [1, '#2a1c10']]} />
          <LG id={k('hornR')} x1={0} y1={1} x2={1} y2={0} s={[[0, '#7a5530'], [0.3, '#dcc597'], [0.62, '#f6ecd2'], [0.86, '#a88a62'], [1, '#2a1c10']]} />
          <LG id={k('beard')} s={[[0, '#6b4322'], [0.35, '#462812'], [0.8, '#26150a'], [1, '#160b05']]} />
          <LG id={k('hairS')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#1d0f06'], [0.5, '#5a361a'], [1, '#1d0f06']]} />
          <LG id={k('kilt')} s={[[0, '#2a4f7a'], [0.55, '#183456'], [1, '#0b1a30']]} />
          <LG id={k('cloak')} x1={0} y1={0} x2={1} y2={0.4} s={[[0, '#2a0a07'], [0.3, '#6e2016'], [0.55, '#8a2c1c'], [0.8, '#4c140d'], [1, '#230604']]} />
          <LG id={k('lining')} s={[[0, '#16324e'], [1, '#0a1628']]} />
          <LG id={k('boot')} x1={0} y1={0} x2={0.4} y2={1} s={[[0, '#6a3f22'], [0.5, '#3e2210'], [1, '#1d0e05']]} />
          <LG id={k('wood')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#2b1708'], [0.4, '#7a4b25'], [0.6, '#9a6436'], [1, '#2b1708']]} />
          <LG id={k('blade')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#fff6d6'], [0.25, '#f6c776'], [0.6, '#b97a33'], [1, '#5a300c']]} />
          <LG id={k('faceLight')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#ff9a50', 0.16], [0.4, '#ff9a50', 0], [0.6, '#3fa9c9', 0], [1, '#3fa9c9', 0.3]]} />
          <LG id={k('shade')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#000', 0.55], [0.25, '#000', 0.05], [0.55, '#000', 0], [0.8, '#000', 0.25], [1, '#000', 0.6]]} />
          <LG id={k('shadeV')} s={[[0, '#000', 0], [0.6, '#000', 0.1], [1, '#000', 0.5]]} />
          <LG id={k('rim')} x1={0} y1={0} x2={1} y2={0} s={[[0, '#ffad5c', 0.95], [0.16, '#ffad5c', 0], [0.7, '#7fe8ff', 0], [1, '#9cf0ff', 1]]} />
          <LG id={k('rimT')} x1={0} y1={0} x2={1} y2={1} s={[[0, '#bff6ff', 0.9], [0.35, '#7fe8ff', 0], [1, '#7fe8ff', 0]]} />
          <LG id={k('boltF')} s={[[0, '#ffffff'], [0.5, '#e4fbff'], [1, '#7fe1ff']]} />
          <RG id={k('boltHalo')} s={[[0, '#bff6ff', 0.75], [0.35, '#5fd6ff', 0.32], [1, '#2a8cff', 0]]} />
          <RG id={k('eyeGlow')} s={[[0, '#e8fdff', 1], [0.25, '#7fe8ff', 0.85], [1, '#1fa8ff', 0]]} />
          <RG id={k('ground')} s={[[0, '#000', 0.6], [1, '#000', 0]]} />
          <RG id={k('cheek')} s={[[0, '#c0563a', 0.35], [1, '#c0563a', 0]]} />
          <RG id={k('hilite')} s={[[0, '#fff', 0.5], [1, '#fff', 0]]} />
          <pattern id={k('scales')} width="10" height="36" patternUnits="userSpaceOnUse">
            <rect width="10" height="36" fill="#1a0c03" />
            {[[0, 0], [5, 18], [-5, 18]].map(([x, y], i) => (
              <g key={i} transform={`translate(${x} ${y})`}>
                <path d="M.9 18.6V5C.9 2.4 2.7 .8 5 .8C7.3 .8 9.1 2.4 9.1 5V18.6Z" fill={url('lamella')} stroke="#1a0c03" strokeWidth=".7" />
                <path d="M2.6 4.4V15" stroke="#fff4d2" strokeWidth=".9" strokeLinecap="round" opacity=".55" />
                <circle cx="5" cy="4.2" r=".85" fill="#2a1404" />
                <circle cx="5" cy="15.6" r=".85" fill="#2a1404" />
              </g>
            ))}
            <path d="M0 17.6H10M0 35.6H10" stroke="#3a1c08" strokeWidth="1.4" />
            <path d="M0 17.6H10M0 35.6H10" stroke="#6fb9ad" strokeWidth=".6" strokeDasharray="1.4 1.6" opacity=".55" />
          </pattern>
          <clipPath id={k('torsoClip')}><path d={TORSO} /></clipPath>
          <clipPath id={k('faceClip')}><path d={FACE} /></clipPath>
          <clipPath id={k('beardClip')}><path d={BEARD} /></clipPath>
        </defs>

        <ellipse cx="210" cy="744" rx="200" ry="18" fill={url('ground')} />

        <g className={styles.body}>
          {/* ---------- cloak (behind) ---------- */}
          <g className={styles.cloak} style={origin(PIV.cloak)}>
            <path d={CLOAK} fill={url('cloak')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d={CLOAK_LINING} fill={url('lining')} stroke={INK} strokeWidth="2" />
            <path d="M-6 712C22 702 40 722 68 710C94 700 108 720 134 708C146 702 154 708 162 704" fill="none" stroke={url('bronzeH')} strokeWidth="5" strokeLinecap="round" />
            <path d="M258 704C268 708 278 700 292 706C314 716 328 700 352 710C376 720 390 706 414 712" fill="none" stroke={url('bronzeH')} strokeWidth="5" strokeLinecap="round" />
            <path d="M-6 712C22 702 40 722 68 710C94 700 108 720 134 708M258 704C268 708 278 700 292 706C314 716 328 700 352 710C376 720 390 706 414 712" fill="none" stroke="#2a1404" strokeWidth="1.6" strokeDasharray="2 6" />
            <path d="M98 330C86 420 74 540 50 660M320 330C332 420 346 540 370 660M120 300C110 420 110 540 118 680M300 300C310 420 312 540 306 680" fill="none" stroke="#1c0503" strokeWidth="5" strokeLinecap="round" opacity=".55" />
            <path d="M334 300C344 380 354 480 376 620M88 360C80 440 70 540 48 640" fill="none" stroke="#b8442c" strokeWidth="3" strokeLinecap="round" opacity=".45" />
            <path d={CLOAK} fill="none" stroke={url('rim')} strokeWidth="2.5" opacity=".9" />
          </g>

          {/* ---------- legs ---------- */}
          <g>
            {[false, true].map((m) => (
              <g key={String(m)}>
                <path d={m ? mirror(LEG_L) : LEG_L} fill={url('legG')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                <path d={m ? 'M266 496C262 526 256 556 254 584' : 'M154 496C158 526 164 556 166 584'} stroke="#f4c294" strokeWidth="3" strokeLinecap="round" opacity=".45" fill="none" />
                <ellipse cx={m ? 262 : 158} cy="602" rx="14" ry="9" fill="#000" opacity=".22" /><path d={m ? 'M252 594Q262 588 272 594' : 'M148 594Q158 588 168 594'} stroke="#f4c294" strokeWidth="2" fill="none" opacity=".45" />
                <path d={m ? mirror(GREAVE_L) : GREAVE_L} fill={url('bronzeH')} stroke={INK} strokeWidth="2.4" />
                <path d={m ? 'M278 620V686M262 616V690M248 620V686' : 'M142 620V686M158 616V690M172 620V686'} stroke="#4a2709" strokeWidth="1.4" opacity=".7" />
                <path d={m ? mirror(BOOT_L) : BOOT_L} fill={url('boot')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                <path d={m ? 'M244 690H287' : 'M133 690H176'} stroke={url('bronzeH')} strokeWidth="6" strokeLinecap="round" />
                <path d={m ? 'M240 736H308' : 'M112 736H180'} stroke="#000" strokeWidth="3" opacity=".35" />
                <path d={m ? 'M328 711C332 706 337 706 339 711' : 'M92 711C88 706 83 706 81 711'} fill="none" stroke="#c99254" strokeWidth="2" strokeLinecap="round" />
                <path d={m ? mirror(BOOT_L) : BOOT_L} fill="none" stroke={url('rim')} strokeWidth="2" />
                <path d={m ? mirror(LEG_L) : LEG_L} fill="none" stroke={url('rim')} strokeWidth="2.2" />
              </g>
            ))}
          </g>

          {/* ---------- kilt ---------- */}
          <g>
            <path d={KILT} fill={url('kilt')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d="M166 404L150 486M182 404L172 490M240 404L252 478M256 404L272 474" stroke="#081426" strokeWidth="2.5" opacity=".7" />
            <path d="M172 404L160 488M248 404L262 476" stroke="#4d7cae" strokeWidth="1.6" opacity=".5" />
            <path d="M126 486C136 488 148 494 158 488C174 478 192 492 206 482C220 472 234 486 248 476C264 466 278 480 292 470" fill="none" stroke={url('bronzeH')} strokeWidth="6" strokeLinecap="round" />
            {Array.from({ length: 14 }, (_, i) => {
              const x = 132 + i * 11.6;
              const y = 488 - i * 1.3 + (i % 2 ? -3 : 3);
              return <path key={i} d={`M${r1(x)} ${r1(y)}l-1 9`} stroke="#c78a3c" strokeWidth="2.4" strokeLinecap="round" />;
            })}
            <path d={APRON} fill="#122640" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M198 420H222M199 440H223M200 460H224M201 480H221" stroke={url('bronzeH')} strokeWidth="3" />
            <path d="M210 424L204 432L216 436L206 448M210 446L204 454L216 458L206 470" fill="none" stroke="#7fe8ff" strokeWidth="1.6" strokeLinejoin="round" opacity=".7" />
            <path d={KILT} fill={url('shadeV')} />
            <path d={KILT} fill="none" stroke={url('rim')} strokeWidth="2" />
          </g>

          {/* ---------- upper body ---------- */}
          <g className={styles.torso} style={origin(PIV.waist)}>
            <g className={styles.breath} style={origin(PIV.waist)}>
              <g className={styles.bounce}>
                {/* hair braids behind */}
                <path d={BRAID_L} fill={url('hairS')} stroke={INK} strokeWidth="2.4" />
                <path d={mirror(BRAID_L)} fill={url('hairS')} stroke={INK} strokeWidth="2.4" />
                {/* torso armour */}
                <path d={TORSO} fill="#2a1606" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
                <g clipPath={url('torsoClip')}>
                  <rect x="100" y="230" width="220" height="180" fill={url('scales')} />
                  <rect x="100" y="230" width="220" height="180" fill={url('shade')} />
                  <ellipse cx="170" cy="292" rx="44" ry="38" fill={url('hilite')} opacity=".85" />
                  <ellipse cx="290" cy="320" rx="30" ry="60" fill="#000" opacity=".25" />
                  <ellipse cx="250" cy="290" rx="34" ry="30" fill={url('hilite')} opacity=".35" />
                  <path d="M118 360C150 376 270 376 302 360V410H118Z" fill="#000" opacity=".3" />
                  {/* leather straps */}
                  <path d="M150 244L188 382M270 244L232 382" stroke="#3a1d0c" strokeWidth="11" />
                  <path d="M150 244L188 382M270 244L232 382" stroke="#6a3a1a" strokeWidth="7" />
                  {[0.18, 0.4, 0.62, 0.84].map((f) => (
                    <g key={f}>
                      <circle cx={150 + 38 * f} cy={244 + 138 * f} r="3.2" fill={url('bronze')} stroke={INK} strokeWidth=".8" />
                      <circle cx={270 - 38 * f} cy={244 + 138 * f} r="3.2" fill={url('bronze')} stroke={INK} strokeWidth=".8" />
                    </g>
                  ))}
                </g>
                <path d={TORSO} fill="none" stroke={url('rim')} strokeWidth="2.6" />
                {/* belt */}
                <path d="M148 378C190 390 230 390 272 378L274 408C230 418 190 418 146 408Z" fill={url('bronzeV')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                <path d="M150 386C190 397 230 397 270 386M149 401C190 411 230 411 271 401" fill="none" stroke="#4a2709" strokeWidth="1.6" />
                {[160, 176, 244, 260].map((x) => <path key={x} d={curl(x, 394, 4, x > 210)} fill="none" stroke="#5a300c" strokeWidth="1.5" />)}
                {/* dagger with crescent pommel */}
                <g>
                  <path d="M244 386L254 340" stroke="#3a1d0c" strokeWidth="8" strokeLinecap="round" />
                  <path d="M244 386L254 340" stroke={url('wood')} strokeWidth="5" strokeLinecap="round" />
                  <path d="M243 336C248 328 260 330 264 338C258 334 250 334 243 336Z" fill={url('bronze')} stroke={INK} strokeWidth="1.6" />
                  <path d="M238 388L252 392" stroke={url('bronze')} strokeWidth="5" strokeLinecap="round" />
                </g>
                {/* buckle: bull boss */}
                <circle cx="210" cy="398" r="17" fill={url('bronze')} stroke={INK} strokeWidth="2.6" />
                <circle cx="210" cy="398" r="12.5" fill="none" stroke="#5a300c" strokeWidth="1.2" />
                <path d="M200 390C196 386 196 381 199 378C200 384 204 387 207 388M220 390C224 386 224 381 221 378C220 384 216 387 213 388M204 389C204 396 206 404 210 406C214 404 216 396 216 389C212 387 208 387 204 389Z" fill="#4a2709" />
                <circle cx="204" cy="392" r="1.2" fill="#ffe3a2" />
                <path d="M201 388C204 384 210 383 216 386" stroke="#fff6d6" strokeWidth="1.2" fill="none" opacity=".8" />

                {/* neck + torc */}
                <path d={NECK} fill={url('limb')} stroke={INK} strokeWidth="2.6" />
                <path d="M188 214C200 222 220 222 232 214V226C220 232 200 232 188 226Z" fill="#000" opacity=".3" />
                <path d="M156 236C170 262 250 262 264 236" fill="none" stroke={INK} strokeWidth="14" strokeLinecap="round" />
                <path d="M156 236C170 262 250 262 264 236" fill="none" stroke={url('bronzeV')} strokeWidth="10" strokeLinecap="round" />
                <path d="M156 236C170 262 250 262 264 236" fill="none" stroke="#5a300c" strokeWidth="10" strokeDasharray="2.4 4.2" opacity=".55" />
                <path d="M158 233C172 257 248 257 262 233" fill="none" stroke="#fff3cf" strokeWidth="1.6" strokeDasharray="3 3.6" opacity=".6" />
                {[154, 266].map((x) => (
                  <g key={x}>
                    <circle cx={x} cy="234" r="7.5" fill={url('bronze')} stroke={INK} strokeWidth="2" />
                    <path d={x < 210 ? 'M148 230C144 222 146 216 150 214C150 220 152 224 156 227' : 'M272 230C276 222 274 216 270 214C270 220 268 224 264 227'} fill={url('bronze')} stroke={INK} strokeWidth="1.4" />
                  </g>
                ))}

                {/* ---------- head ---------- */}
                <g className={styles.head} style={origin(PIV.neck)}>
                  <g className={styles.headAnim} style={origin(PIV.neck)}>
                   <g transform="translate(210 240) scale(1.13) translate(-210 -240)">
                    {/* ears + earrings */}
                    <path d={EAR_L} fill={url('skin')} stroke={INK} strokeWidth="2.2" />
                    <path d={mirror(EAR_L)} fill={url('skin')} stroke={INK} strokeWidth="2.2" />
                    <circle cx="165" cy="200" r="6.5" fill="none" stroke={url('bronze')} strokeWidth="3" />
                    <circle cx="255" cy="200" r="6.5" fill="none" stroke={url('bronze')} strokeWidth="3" />
                    {/* face */}
                    <path d={FACE} fill={url('skin')} stroke={INK} strokeWidth="3" />
                    <g clipPath={url('faceClip')}>
                      <ellipse cx="236" cy="196" rx="22" ry="30" fill="#5a2810" opacity=".22" />
                      <ellipse cx="186" cy="194" rx="12" ry="8" fill={url('cheek')} />
                      <ellipse cx="234" cy="194" rx="12" ry="8" fill={url('cheek')} />
                      <path d="M170 150H250V166C236 158 184 158 170 166Z" fill="#000" opacity=".35" />
                      <path d="M176 172C184 166 198 166 206 174C198 171 186 171 176 176Z" fill="#2a1206" opacity=".45" />
                      <path d="M244 172C236 166 222 166 214 174C222 171 234 171 244 176Z" fill="#2a1206" opacity=".45" />
                      <path d="M178 188C186 192 196 192 202 188" fill="none" stroke="#6a3418" strokeWidth="2" opacity=".35" />
                      <path d="M218 188C224 192 234 192 242 188" fill="none" stroke="#6a3418" strokeWidth="2" opacity=".35" />
                      <ellipse cx="184" cy="187" rx="9" ry="4" fill="#fff" opacity=".14" />
                      <rect x="166" y="148" width="88" height="80" fill={url('faceLight')} />
                      <path d="M196 196C192 202 190 208 192 214M224 196C228 202 230 208 228 214" fill="none" stroke="#5a2a12" strokeWidth="1.4" opacity=".45" />
                      <path d="M180 184C177 186 175 189 175 192M240 184C243 186 245 189 245 192" fill="none" stroke="#5a2a12" strokeWidth="1" opacity=".4" />
                      <path d="M200 163Q204 160 208 163M212 163Q216 160 220 163" fill="none" stroke="#5a2a12" strokeWidth="1" opacity=".5" />
                      <path d="M251 150C252 172 250 192 243 205" fill="none" stroke="#9cf0ff" strokeWidth="3.4" opacity=".75" />
                    </g>
                    {/* hair locks under the cap */}
                    {HAIR_CURLS.map(([x, y], i) => (
                      <g key={i}>
                        <circle cx={x} cy={y} r="6.5" fill="#2e1a0b" stroke={INK} strokeWidth="1.4" />
                        <path d={curl(x, y, 4, x > 210)} fill="none" stroke="#a8743e" strokeWidth="1.3" />
                      </g>
                    ))}
                    {/* brows */}
                    <path d={BROW_L} fill="#24140a" stroke={INK} strokeWidth="1.2" />
                    <path d={mirror(BROW_L)} fill="#24140a" stroke={INK} strokeWidth="1.2" />
                    <path d="M178 166C186 161 196 162 204 169" fill="none" stroke="#7a4f2a" strokeWidth="1" opacity=".8" />
                    <path d="M207 165L209 172M213 165L211 172" stroke="#6a3418" strokeWidth="1.2" opacity=".7" />
                    {/* eyes */}
                    <path d={EYE_L} fill="#f3e2c6" />
                    <path d={mirror(EYE_L)} fill="#f3e2c6" />
                    <circle cx="193.5" cy="177.6" r="3.9" fill="#2c5466" />
                    <circle cx="229.5" cy="177.6" r="3.9" fill="#2c5466" />
                    <circle cx="193.8" cy="177.6" r="1.7" fill="#08131a" />
                    <circle cx="229.8" cy="177.6" r="1.7" fill="#08131a" />
                    <circle cx="192.4" cy="176.3" r=".9" fill="#fff" />
                    <circle cx="228.4" cy="176.3" r=".9" fill="#fff" />
                    <g className={styles.eyeGlow}>
                      <circle cx="193.5" cy="177.6" r="3.9" fill="#5fe0ff" />
                      <circle cx="229.5" cy="177.6" r="3.9" fill="#5fe0ff" />
                      <circle cx="193.8" cy="177.6" r="1.5" fill="#e8fdff" />
                      <circle cx="229.8" cy="177.6" r="1.5" fill="#e8fdff" />
                    </g>
                    <g className={styles.eyeFlare}>
                      <path d={EYE_L} fill="#c9fbff" />
                      <path d={mirror(EYE_L)} fill="#c9fbff" />
                      <circle cx="193.5" cy="177.6" r="3.2" fill="#fff" />
                      <circle cx="229.5" cy="177.6" r="3.2" fill="#fff" />
                      <circle cx="193.5" cy="177.6" r="24" fill={url('eyeGlow')} opacity=".7" />
                      <circle cx="229.5" cy="177.6" r="24" fill={url('eyeGlow')} opacity=".7" />
                    </g>
                    <path d={LID_L} fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
                    <path d={mirror(LID_L)} fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
                    <path d="M184 182C190 183.6 196 183.4 201 181M219 181C224 183.4 230 183.6 236 182" fill="none" stroke="#5a2a12" strokeWidth="1" opacity=".45" />
                    {/* nose */}
                    <path d={NOSE} fill={url('skin')} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M206 174C205 184 202 192 199 198C201 202 204 203 207 203" fill="none" stroke="#6a3418" strokeWidth="1.4" opacity=".6" />
                    <path d="M213 176C214 184 216 190 217 194" stroke="#ffe0b8" strokeWidth="2" strokeLinecap="round" opacity=".55" />
                    <ellipse cx="204.5" cy="201.5" rx="2.6" ry="1.5" fill="#3a1608" />
                    <ellipse cx="215.5" cy="201.5" rx="2.6" ry="1.5" fill="#3a1608" />
                    {/* beard */}
                    <g className={styles.beard} style={origin(PIV.chin)}>
                      <path d={BEARD} fill={url('beard')} stroke={INK} strokeWidth="3" />
                      <g clipPath={url('beardClip')}>
                        {BEARD_STRANDS.map((d, i) => (
                          <g key={i}>
                            <path d={d} fill="none" stroke="#1a0d05" strokeWidth="4.2" strokeLinecap="round" />
                            <path d={d} fill="none" stroke={i % 3 === 0 ? '#c08a52' : '#8a5a2e'} strokeWidth="1.7" strokeLinecap="round" opacity={i % 3 === 0 ? 0.9 : 0.75} />
                          </g>
                        ))}
                        {BEARD_CURLS.map(([x, y, r], i) => (
                          <g key={i}>
                            <circle cx={x} cy={y} r={r + 0.8} fill="#4a2b14" stroke="#140a04" strokeWidth="1.6" />
                            <path d={curl(x, y, r - 1, i % 2 === 1)} fill="none" stroke="#c08a52" strokeWidth="1.8" strokeLinecap="round" />
                            <circle cx={x - r * 0.35} cy={y - r * 0.4} r={r * 0.22} fill="#e2b072" opacity=".7" />
                          </g>
                        ))}
                        {CHEEK_CURLS.map(([x, y], i) => (
                          <g key={i}>
                            <circle cx={x} cy={y} r="5.6" fill="#1e1007" />
                            <path d={curl(x, y, 4.2, x > 210)} fill="none" stroke="#a06c38" strokeWidth="1.4" />
                          </g>
                        ))}
                        <path d="M252 190C256 214 252 244 244 268" fill="none" stroke="#9cf0ff" strokeWidth="5" opacity=".35" />
                      </g>
                      {/* bronze beard ring + tip */}
                      {/* mouth */}
                      <g className={styles.mouthShut}>
                        <path d="M200 213C206 217 214 217 220 213C214 220 206 220 200 213Z" fill="#8a3a24" stroke={INK} strokeWidth="1.2" />
                      </g>
                      <g className={styles.mouthOpen}>
                        <path d="M196 210C202 230 218 230 224 210C216 214 204 214 196 210Z" fill="#2a0805" stroke={INK} strokeWidth="1.6" />
                        <path d="M200 212C206 215 214 215 220 212L219 216C213 218 207 218 201 216Z" fill="#f6ead2" />
                        <path d="M204 224C208 226 212 226 216 224" stroke="#a23a2a" strokeWidth="2" fill="none" />
                      </g>
                      {/* moustache */}
                      <path d={MUSTACHE_L} fill={url('beard')} stroke={INK} strokeWidth="1.8" />
                      <path d={mirror(MUSTACHE_L)} fill={url('beard')} stroke={INK} strokeWidth="1.8" />
                      <path d="M205 206C196 206 188 209 183 215M215 206C224 206 232 209 237 215" fill="none" stroke="#b07a42" strokeWidth="1.2" opacity=".8" />
                      <path d={curl(170, 214, 3.4, true)} fill="none" stroke="#b07a42" strokeWidth="1.3" />
                      <path d={curl(250, 214, 3.4)} fill="none" stroke="#b07a42" strokeWidth="1.3" />
                    </g>

                    {/* ---------- horned conical cap ---------- */}
                    <g>
                      {HORNS.map((h, i) => (
                        <g key={i}>
                          <path d={h.d} fill={url('hornL')} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
                          <path d={mirror(h.d)} fill={url('hornR')} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
                          {h.ridges.map((r, j) => (
                            <g key={j}>
                              <path d={r} fill="none" stroke="#7a5a38" strokeWidth="1.3" opacity=".75" />
                              <path d={mirror(r)} fill="none" stroke="#7a5a38" strokeWidth="1.3" opacity=".75" />
                            </g>
                          ))}
                          <path d={mirror(h.d)} fill="none" stroke="#bff6ff" strokeWidth="1.4" opacity=".55" />
                        </g>
                      ))}
                      <path d={CONE} fill={url('cone')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                      <path d="M188 136C194 106 202 70 212 36M232 136C228 106 222 70 212 36" fill="none" stroke="#5a300c" strokeWidth="1.4" opacity=".7" />
                      <path d="M200 134C203 104 207 70 211 40" fill="none" stroke="#fff6d6" strokeWidth="2.4" strokeLinecap="round" opacity=".65" />
                      {[[116, 26], [94, 19], [72, 12]].map(([y, w]) => (
                        <path key={y} d={`M${210 - w * 1.62} ${y + 3}Q210 ${y - 5} ${210 + w * 1.62} ${y + 3}`} fill="none" stroke="#1f6f6a" strokeWidth="4" opacity=".85" />
                      ))}
                      {/* storm sign inlay */}
                      <path d="M213 76L206 94L215 96L207 116L222 92L213 90L220 76Z" fill="#9cf0ff" stroke="#123a4a" strokeWidth="1.4" strokeLinejoin="round" />
                      {HORNS.map((h, i) => (
                        <g key={i}>
                          <ellipse cx={h.bx + 2} cy={h.y} rx="5" ry={h.t * 0.62} fill={url('bronze')} stroke={INK} strokeWidth="1.6" />
                          <ellipse cx={420 - h.bx - 2} cy={h.y} rx="5" ry={h.t * 0.62} fill={url('bronze')} stroke={INK} strokeWidth="1.6" />
                        </g>
                      ))}
                      <circle cx="212" cy="31" r="5" fill={url('bronze')} stroke={INK} strokeWidth="2" />
                      <path d={CONE} fill="none" stroke={url('rim')} strokeWidth="2.2" />
                      <path d={BRIM} fill={url('bronzeV')} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
                      {[172, 191, 210, 229, 248].map((x, i) => (
                        <g key={x}>
                          <circle cx={x} cy={148 - (i === 0 || i === 4 ? -1 : i === 2 ? 3 : 1.5)} r="5.2" fill={i === 2 ? '#2fb6c9' : url('bronze')} stroke={INK} strokeWidth="1.4" />
                          <circle cx={x - 1.4} cy={146.4 - (i === 0 || i === 4 ? -1 : i === 2 ? 3 : 1.5)} r="1.4" fill="#fff" opacity=".7" />
                        </g>
                      ))}
                      <path d="M162 142C182 134 238 134 258 142" fill="none" stroke="#fff3cf" strokeWidth="1.4" opacity=".75" />
                    </g>
                   </g>
                  </g>
                </g>

                {/* ---------- axe arm (screen left) ---------- */}
                <g className={styles.armA} style={origin(PIV.shA)}>
                  <path d={UPPER_A} fill={url('limb')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                  <path d="M108 288C112 310 116 330 118 346" stroke="#ffd2a6" strokeWidth="3" strokeLinecap="round" opacity=".5" fill="none" />
                  <path d="M100 314H159L156 328H104Z" fill={url('bronzeH')} stroke={INK} strokeWidth="2" />
                  <path d={UPPER_A} fill="none" stroke={url('rim')} strokeWidth="2.2" />
                  <g className={styles.foreA} style={origin(PIV.elA)}>
                    <circle cx="129" cy="347" r="21" fill={url('limb')} stroke={INK} strokeWidth="2.6" />
                    <path d={FORE_A} fill={url('limb')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                    <path d={BRACER_A} fill={url('bronzeH')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M108 386H150M110 402H148" stroke="#4a2709" strokeWidth="1.5" />
                    <path d="M124 388L129 400L134 388" stroke="#9cf0ff" strokeWidth="1.4" fill="none" opacity=".75" />
                    <g className={styles.axe} style={origin(PIV.handA)}>
                      <rect x="124" y="296" width="10" height="228" rx="4" fill={url('wood')} stroke={INK} strokeWidth="2.4" />
                      {[470, 484, 498].map((y) => <path key={y} d={`M124 ${y}L134 ${y + 7}`} stroke="#2a1404" strokeWidth="2" />)}
                      <rect x="122" y="512" width="14" height="14" rx="3" fill={url('bronze')} stroke={INK} strokeWidth="2" />
                      <path d={AXE_SPIKE} fill={url('bronze')} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
                      <path d={AXE_BLADE} fill={url('blade')} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
                      <path d="M86 279C64 292 50 307 50 324C50 342 62 356 83 368" fill="none" stroke="#fff6d6" strokeWidth="2.6" strokeLinecap="round" opacity=".9" />
                      <path d="M100 302L116 308V334L100 342C92 334 92 312 100 302Z" fill="#7a4415" opacity=".55" />
                      <circle cx="80" cy="312" r="6" fill="#1c0e03" stroke="#5a300c" strokeWidth="1.6" /><circle cx="80" cy="337" r="6" fill="#1c0e03" stroke="#5a300c" strokeWidth="1.6" /><path d="M100 300C94 312 94 334 100 346" fill="none" stroke="#5a300c" strokeWidth="1.6" />
                      <rect x="119" y="298" width="20" height="46" rx="6" fill={url('bronzeH')} stroke={INK} strokeWidth="2.4" />
                      <path d="M120 310H138M120 332H138" stroke="#4a2709" strokeWidth="1.6" />
                      <circle cx="129" cy="321" r="3.4" fill="#2fb6c9" stroke={INK} strokeWidth="1" />
                    </g>
                    <path d={FIST_A} fill={url('limb')} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
                    <path d="M111 418q4.5 -5 9 0q4.5 -5 9 0q4.5 -5 9 0q4.5 -5 9 0M120 419V436M129 419V436M138 419V436" stroke="#6a3418" strokeWidth="1.4" opacity=".75" />
                    <path d="M109 434C120 430 136 432 146 438C140 448 120 449 109 444Z" fill={url('limb')} stroke={INK} strokeWidth="2" />
                  </g>
                  <path d={PAULDRON_A} fill={url('bronze')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                  <path d="M92 268C106 254 154 254 166 264M98 254C112 242 150 242 162 252" fill="none" stroke="#5a300c" strokeWidth="1.6" />
                  <path d="M100 252C108 240 120 236 132 236" stroke="#fff6d6" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".85" />
                  {[[96, 277], [112, 270], [131, 268], [150, 268], [163, 272]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.2" fill="#ffe3a2" stroke={INK} strokeWidth=".6" />)}
                </g>

                {/* ---------- lightning arm (screen right) ---------- */}
                <circle ref={shoulderRef} cx={PIV.shB[0]} cy={PIV.shB[1]} r="1" fill="none" />
                <g className={styles.armB} style={origin(PIV.shB)}>
                  <path d={mirror(UPPER_A)} fill={url('limb')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                  <path d="M320 314H261L264 328H316Z" fill={url('bronzeH')} stroke={INK} strokeWidth="2" />
                  <path d={mirror(UPPER_A)} fill="none" stroke={url('rim')} strokeWidth="2.4" />
                  <g className={styles.foreB} style={origin(PIV.elB)}>
                    <circle cx="291" cy="347" r="21" fill={url('limb')} stroke={INK} strokeWidth="2.6" />
                    <path d={mirror(FORE_A)} fill={url('limb')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                    <path d={mirror(BRACER_A)} fill={url('bronzeH')} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M312 386H270M310 402H272" stroke="#4a2709" strokeWidth="1.5" />
                    <path d={mirror(FORE_A)} fill="none" stroke={url('rim')} strokeWidth="2.2" />
                    <g className={styles.bolt} style={origin(PIV.handB)}>
                      <g className={styles.heldBolt}>
                        <g transform="translate(291 412) scale(1.28) translate(-291 -412)">
                        <ellipse className={styles.boltHalo} cx="291" cy="330" rx="80" ry="110" fill={url('boltHalo')} style={origin([291, 330])} />
                        {[BOLT_L, BOLT_R_SH, BOLT_C].map((d, i) => (
                          <g key={i}>
                            <path d={d} fill="none" stroke="#5fd6ff" strokeWidth="7" strokeLinejoin="round" opacity=".45" />
                            <path d={d} fill={url('boltF')} stroke="#2a8cd8" strokeWidth="1.6" strokeLinejoin="round" />
                          </g>
                        ))}
                        <path d="M291 404L290 372L293 340L291 270" stroke="#fff" strokeWidth="1.6" fill="none" opacity=".9" />
                        <g className={styles.sparks}>
                          {SPARKS.map((d, i) => <path key={i} d={d} fill="none" stroke={i % 2 ? '#e8fdff' : '#7fe8ff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animationDelay: `${i * -0.13}s` }} />)}
                        </g>
                        </g>
                      </g>
                      <circle ref={tipRef} cx={BOLT_TIP[0]} cy={r1(412 - (412 - BOLT_TIP[1]) * 1.28)} r="1" fill="none" />
                      <rect x="282" y="404" width="18" height="44" rx="6" fill={url('bronzeH')} stroke={INK} strokeWidth="2.2" />
                      <path d="M283 414H299M283 426H299M283 438H299" stroke="#4a2709" strokeWidth="1.4" />
                    </g>
                    <path d={mirror(FIST_A)} fill={url('limb')} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
                    <path d="M309 418q-4.5 -5 -9 0q-4.5 -5 -9 0q-4.5 -5 -9 0q-4.5 -5 -9 0M300 419V436M291 419V436M282 419V436" stroke="#6a3418" strokeWidth="1.4" opacity=".75" />
                    <path d="M311 434C300 430 284 432 274 438C280 448 300 449 311 444Z" fill={url('limb')} stroke={INK} strokeWidth="2" />
                    <path d={mirror(FIST_A)} fill="none" stroke={url('rim')} strokeWidth="2" />
                  </g>
                  <path d={mirror(PAULDRON_A)} fill={url('bronze')} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                  <path d="M328 268C314 254 266 254 254 264M322 254C308 242 270 242 258 252" fill="none" stroke="#5a300c" strokeWidth="1.6" />
                  <path d={mirror(PAULDRON_A)} fill="none" stroke={url('rimT')} strokeWidth="2.4" />
                  <path d={mirror(PAULDRON_A)} fill="none" stroke={url('rim')} strokeWidth="2.4" />
                  {[[324, 277], [308, 270], [289, 268], [270, 268], [257, 272]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.2" fill="#ffe3a2" stroke={INK} strokeWidth=".6" />)}
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
