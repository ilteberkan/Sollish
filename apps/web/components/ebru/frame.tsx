import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { ebruRng } from './water';
import styles from './art.module.css';

/* Ebru board frame: the marbling tray (tekne) seen from above. A mitred walnut trough with grain running
   along each board, a brass lip with rivets, embossed brass corner caps with a tulip, a cream paper margin
   (pervaz) with a double gold rule (cetvel) and small gilded corner tezhip, then the water well — the square
   7 × 7 area. The art is one static SVG in a fixed 1000 × 1000 space, so the well keeps its exact square
   proportion at every size. The 'feature' mood fades in a second overlay SVG (margin flowers, a brighter
   gold) and a glow, as whole compositor layers; nothing inside the big SVG animates. No backdrop-filter. */

export type EbruFrameMood = 'base' | 'feature';

const S = 1000;
const WOOD = 30;
const LIP = 39;
const WELL = 76; // well inset: inner square 848
const f1 = (n: number) => Math.round(n * 10) / 10;

/* wood grain lines for one board (horizontal in local space 0..len × 0..WOOD), deterministic */
function grain(seed: number, len: number) {
  const r = ebruRng(seed);
  const out: Array<{ d: string; o: number; w: number }> = [];
  for (let i = 0; i < 9; i++) {
    const y0 = 2 + (i / 9) * (WOOD - 2) + r() * 2;
    let d = `M-10 ${f1(y0)}`;
    let y = y0;
    for (let x = 40; x <= len + 40; x += 40) {
      y += (r() - 0.5) * 2.4;
      y = Math.max(1, Math.min(WOOD - 1, y));
      d += `Q${f1(x - 20)} ${f1(y + (r() - 0.5) * 3)} ${f1(x)} ${f1(y)}`;
    }
    out.push({ d, o: 0.18 + r() * 0.3, w: 0.6 + r() * 1.4 });
  }
  // knots
  for (let i = 0; i < 2; i++) {
    const x = 120 + r() * (len - 240), y = 8 + r() * 14;
    out.push({ d: `M${f1(x - 26)} ${f1(y)}Q${f1(x)} ${f1(y - 9)} ${f1(x + 26)} ${f1(y)}Q${f1(x)} ${f1(y + 9)} ${f1(x - 26)} ${f1(y)}Z`, o: 0.35, w: 1 });
  }
  return out;
}
const GRAIN = [grain(11, S), grain(23, S), grain(37, S), grain(41, S)];

/* halkâr vine along the top margin (rotated for the other sides) */
const VINE_Y = (LIP + 7 + WELL - 6) / 2;
const { VINE, BUDS } = (() => {
  let d = `M110 ${VINE_Y}`;
  let b = '';
  const step = 39;
  for (let i = 0, x = 110; x < S - 110 - 1; i++, x += step) {
    const dir = i % 2 ? 1 : -1;
    d += `Q${f1(x + step / 2)} ${f1(VINE_Y + dir * 9)} ${f1(x + step)} ${VINE_Y}`;
    const bx = x + step / 2, by = VINE_Y + dir * 4.5;
    b += `M${f1(bx)} ${f1(by)}Q${f1(bx + 4)} ${f1(by - dir * 6)} ${f1(bx)} ${f1(by - dir * 10)}Q${f1(bx - 4)} ${f1(by - dir * 6)} ${f1(bx)} ${f1(by)}Z`;
  }
  return { VINE: d, BUDS: b };
})();

/* gilded corner tezhip in the paper margin (local space, corner at 0,0, pointing into +x +y) */
function Tezhip({ k }: { k: (n: string) => string }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <g>
      <path d="M2 2H34Q30 10 22 12Q14 14 12 22Q10 30 2 34Z" fill={u('gold')} stroke="#6a3c06" strokeWidth="1" strokeLinejoin="round" />
      <path d="M6 6H24Q20 12 14 14Q12 20 6 24Z" fill="#1d3a8a" stroke="#6a3c06" strokeWidth=".8" />
      <circle cx="11" cy="11" r="3" fill="#d42a3a" stroke="#6a3c06" strokeWidth=".7" />
      <path d="M34 2Q42 2 46 6Q40 8 36 6M2 34Q2 42 6 46Q8 40 6 36" fill="none" stroke={u('gold')} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 9.5Q10 8 12 8.4" stroke="#fff" strokeWidth=".8" strokeLinecap="round" opacity=".8" />
    </g>
  );
}

/* embossed brass corner cap (local space, corner at 0,0) */
function CornerCap({ k }: { k: (n: string) => string }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <g>
      <path d="M0 0H92Q96 0 96 4V18Q96 24 90 26Q60 34 40 40Q34 60 26 90Q24 96 18 96H4Q0 96 0 92Z" fill="#1a0e02" opacity=".5" transform="translate(2 3)" />
      <path d="M0 0H92Q96 0 96 4V18Q96 24 90 26Q60 34 40 40Q34 60 26 90Q24 96 18 96H4Q0 96 0 92Z" fill={u('brass')} stroke="#3a2002" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6 6H86Q88 6 88 9V16Q88 19 84 20Q56 27 35 35Q27 56 20 84Q19 88 16 88H9Q6 88 6 86Z" fill="none" stroke="#fff1b8" strokeWidth="1" opacity=".55" />
      {/* tulip boss */}
      <g transform="translate(26 26) rotate(-45) scale(.58) translate(-50 -50)">
        <circle cx="50" cy="50" r="36" fill={u('brassDk')} stroke="#3a2002" strokeWidth="2" />
        <path d="M50 22C54 28 56 34 56 40C59 35 64 31 70 29C71.5 39 69 48 64 55C60 61 55 65 50 67C45 65 40 61 36 55C31 48 28.5 39 30 29C36 31 41 35 44 40C44 34 46 28 50 22Z" fill={u('brass')} stroke="#3a2002" strokeWidth="2" strokeLinejoin="round" />
        <path d="M50 28C52 36 52.5 46 50 60C47.5 46 48 36 50 28Z" fill="#c42a34" stroke="#3a2002" strokeWidth="1.4" />
        <path d="M50 67V78M44 74Q50 70 56 74" fill="none" stroke="#3a2002" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      {[[70, 13], [13, 70], [52, 14], [14, 52]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="3.6" fill={u('stud')} stroke="#2a1602" strokeWidth=".9" />
          <circle cx={x! - 1} cy={y! - 1.1} r="1.1" fill="#fffbe6" opacity=".85" />
        </g>
      ))}
    </g>
  );
}

/* margin flowers for the feature mood (one sprig, local 0..40 × 0..30, pointing up) */
const SPRIG = {
  stem: 'M20 30C20 24 19.5 18 20 12',
  leafL: 'M20 24C14 24 9 20 7 15C13 15.5 18 19 20 24Z',
  leafR: 'M20 21C26 21 31 17 33 12C27 12.5 22 16 20 21Z',
  tulip: 'M20 2C22 4.5 23 7 23 9.5C24.5 7.5 26.5 6.2 29 5.6C29.4 9.6 28.4 13 26.2 15.6C24.6 17.4 22.4 18.6 20 19C17.6 18.6 15.4 17.4 13.8 15.6C11.6 13 10.6 9.6 11 5.6C13.5 6.2 15.5 7.5 17 9.5C17 7 18 4.5 20 2Z',
  carn: 'M10 12L11.6 6.4L14 10L15.6 3.8L18.2 9L20 2.6L21.8 9L24.4 3.8L26 10L28.4 6.4L30 12Q27 18 20 19Q13 18 10 12Z',
};

export function EbruFrame({ children, mood = 'base', className, wellRef }: { children?: ReactNode; mood?: EbruFrameMood; className?: string; wellRef?: Ref<HTMLDivElement> }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `ebf${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const boards: Array<{ poly: string; tf: string; light: string }> = [
    { poly: `0,0 ${S},0 ${S - WOOD},${WOOD} ${WOOD},${WOOD}`, tf: '', light: 'woodT' },
    { poly: `${S},0 ${S},${S} ${S - WOOD},${S - WOOD} ${S - WOOD},${WOOD}`, tf: `translate(${S} 0) rotate(90)`, light: 'woodR' },
    { poly: `0,${S} ${S},${S} ${S - WOOD},${S - WOOD} ${WOOD},${S - WOOD}`, tf: `translate(0 ${S}) scale(1 -1)`, light: 'woodB' },
    { poly: `0,0 0,${S} ${WOOD},${S - WOOD} ${WOOD},${WOOD}`, tf: `rotate(90) scale(1 -1)`, light: 'woodL' },
  ];
  const rivets: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) {
    const t = 150 + (i / 8) * 700;
    rivets.push([t, LIP - 4.5], [t, S - LIP + 4.5], [LIP - 4.5, t], [S - LIP + 4.5, t]);
  }
  const corners: Array<[number, number, number]> = [[0, 0, 0], [S, 0, 90], [S, S, 180], [0, S, 270]];
  const sprigs: Array<{ x: number; y: number; rot: number; kind: 'tulip' | 'carn' }> = [];
  for (let i = 0; i < 7; i++) {
    const t = 170 + (i / 6) * 660;
    const kind = i % 2 ? 'carn' : 'tulip';
    sprigs.push({ x: t, y: WELL - 3, rot: 0, kind }, { x: t, y: S - WELL + 3, rot: 180, kind }, { x: WELL - 3, y: t, rot: 270, kind }, { x: S - WELL + 3, y: t, rot: 90, kind });
  }
  return (
    <div className={`${styles.frame} ${className ?? ''}`} data-mood={mood}>
      <svg className={styles.frameArt} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={k('woodT')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a4e24" /><stop offset=".5" stopColor="#5e3016" /><stop offset="1" stopColor="#3a1a0a" /></linearGradient>
          <linearGradient id={k('woodR')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a240e" /><stop offset=".5" stopColor="#3a1c0a" /><stop offset="1" stopColor="#241004" /></linearGradient>
          <linearGradient id={k('woodB')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3e1e0c" /><stop offset=".6" stopColor="#2a1206" /><stop offset="1" stopColor="#1a0a04" /></linearGradient>
          <linearGradient id={k('woodL')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a4420" /><stop offset=".5" stopColor="#552a12" /><stop offset="1" stopColor="#341808" /></linearGradient>
          <linearGradient id={k('brass')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff2b8" /><stop offset=".25" stopColor="#e6b04a" /><stop offset=".6" stopColor="#a8701e" /><stop offset="1" stopColor="#5a3606" /></linearGradient>
          <linearGradient id={k('brassDk')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c8902e" /><stop offset="1" stopColor="#4a2a04" /></linearGradient>
          <radialGradient id={k('stud')} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#fffbe6" /><stop offset=".4" stopColor="#e6b04a" /><stop offset="1" stopColor="#5a3606" /></radialGradient>
          <linearGradient id={k('lip')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff0b0" /><stop offset=".5" stopColor="#c48a2c" /><stop offset="1" stopColor="#6a4008" /></linearGradient>
          <linearGradient id={k('gold')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffbe0" /><stop offset=".35" stopColor="#f2c650" /><stop offset=".75" stopColor="#b47816" /><stop offset="1" stopColor="#6a3c06" /></linearGradient>
          <radialGradient id={k('paper')} cx=".35" cy=".25" r="1"><stop offset="0" stopColor="#f3e4bf" /><stop offset=".6" stopColor="#e0c894" /><stop offset="1" stopColor="#c4a66e" /></radialGradient>
          <pattern id={k('fiber')} width="23" height="17" patternUnits="userSpaceOnUse">
            <path d="M1 4Q6 2 11 5M13 12Q17 10 22 13M4 14Q6 13 8 15" fill="none" stroke="#a88a5a" strokeWidth=".6" opacity=".35" />
            <circle cx="18" cy="4" r=".7" fill="#8a6a3a" opacity=".3" />
          </pattern>
          {boards.map((b, i) => <clipPath key={i} id={k(`b${i}`)}><polygon points={b.poly} /></clipPath>)}
        </defs>
        {/* walnut trough */}
        {boards.map((b, i) => (
          <g key={i} clipPath={u(`b${i}`)}>
            <polygon points={b.poly} fill={u(b.light)} />
            <g transform={b.tf}>
              {GRAIN[i]!.map((g, j) => <path key={j} d={g.d} fill="none" stroke={j % 3 ? '#1e0c04' : '#c07a44'} strokeWidth={g.w} opacity={g.o} />)}
            </g>
            <polygon points={b.poly} fill="none" stroke="#120602" strokeWidth="1.4" />
          </g>
        ))}
        <path d={`M1.5 1.5H${S - 1.5}`} stroke="#d49a62" strokeWidth="2" opacity=".55" />
        <path d={`M1.5 1.5V${S - 1.5}`} stroke="#c08850" strokeWidth="1.6" opacity=".4" />
        {/* brass lip */}
        <rect x={WOOD} y={WOOD} width={S - 2 * WOOD} height={S - 2 * WOOD} fill="none" stroke={u('lip')} strokeWidth={(LIP - WOOD) * 2 - 2} />
        <rect x={LIP} y={LIP} width={S - 2 * LIP} height={S - 2 * LIP} fill="none" stroke="#3a2002" strokeWidth="1.4" />
        <rect x={WOOD + 1.5} y={WOOD + 1.5} width={S - 2 * WOOD - 3} height={S - 2 * WOOD - 3} fill="none" stroke="#fff4c4" strokeWidth="1" opacity=".7" />
        {/* paper margin */}
        <path d={`M${LIP} ${LIP}H${S - LIP}V${S - LIP}H${LIP}Z M${WELL} ${WELL}V${S - WELL}H${S - WELL}V${WELL}Z`} fill={u('paper')} fillRule="evenodd" />
        <path d={`M${LIP} ${LIP}H${S - LIP}V${S - LIP}H${LIP}Z M${WELL} ${WELL}V${S - WELL}H${S - WELL}V${WELL}Z`} fill={u('fiber')} fillRule="evenodd" />
        {/* cetvel: double gold rule */}
        <rect x={LIP + 7} y={LIP + 7} width={S - 2 * LIP - 14} height={S - 2 * LIP - 14} fill="none" stroke={u('gold')} strokeWidth="3" />
        <rect x={LIP + 7} y={LIP + 7} width={S - 2 * LIP - 14} height={S - 2 * LIP - 14} fill="none" stroke="#5a3204" strokeWidth=".6" opacity=".6" />
        <rect x={WELL - 6} y={WELL - 6} width={S - 2 * WELL + 12} height={S - 2 * WELL + 12} fill="none" stroke={u('gold')} strokeWidth="1.6" />
        <rect x={WELL - 2} y={WELL - 2} width={S - 2 * WELL + 4} height={S - 2 * WELL + 4} fill="none" stroke="#1d3a8a" strokeWidth="2.4" />
        {/* halkâr: a gold vine with buds running round the margin */}
        <g fill="none" stroke={u('gold')} strokeWidth="1.5" strokeLinecap="round" opacity=".8">
          {[0, 90, 180, 270].map((r) => <path key={r} d={VINE} transform={`rotate(${r} ${S / 2} ${S / 2})`} />)}
        </g>
        <g fill={u('gold')} opacity=".85">
          {[0, 90, 180, 270].map((r) => <path key={r} d={BUDS} transform={`rotate(${r} ${S / 2} ${S / 2})`} />)}
        </g>
        {/* paper corner tezhip */}
        {corners.map(([x, y, r]) => <g key={`t${r}`} transform={`translate(${x} ${y}) rotate(${r}) translate(${LIP + 2} ${LIP + 2})`}><Tezhip k={k} /></g>)}
        {/* mid-edge brass rings (handles of the tray) */}
        {[[S / 2, WOOD / 2, 0], [S / 2, S - WOOD / 2, 0], [WOOD / 2, S / 2, 90], [S - WOOD / 2, S / 2, 90]].map(([x, y, r], i) => (
          <g key={`h${i}`} transform={`translate(${x} ${y}) rotate(${r})`}>
            <rect x="-34" y="-9" width="68" height="18" rx="9" fill="#1a0e02" opacity=".45" transform="translate(1.5 2)" />
            <rect x="-34" y="-9" width="68" height="18" rx="9" fill={u('brass')} stroke="#3a2002" strokeWidth="1.4" />
            <ellipse cx="0" cy="0" rx="12" ry="6.5" fill="#1d3a8a" stroke="#3a2002" strokeWidth="1.2" />
            <ellipse cx="0" cy="0" rx="5" ry="3" fill="#d42a3a" />
            <circle cx="-24" cy="0" r="3" fill={u('stud')} /><circle cx="24" cy="0" r="3" fill={u('stud')} />
          </g>
        ))}
        {rivets.map(([x, y], i) => <circle key={`r${i}`} cx={f1(x)} cy={f1(y)} r="2.4" fill={u('stud')} stroke="#2a1602" strokeWidth=".6" />)}
        {/* brass corner caps */}
        {corners.map(([x, y, r]) => <g key={`c${r}`} transform={`translate(${x} ${y}) rotate(${r})`}><CornerCap k={k} /></g>)}
      </svg>
      {/* feature overlay: flowers bloom in the margins, the gold rule glows */}
      <svg className={styles.frameFeature} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={k('fT')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff2b0" /><stop offset=".6" stopColor="#f2bf3c" /><stop offset="1" stopColor="#a8680c" /></linearGradient>
          <linearGradient id={k('fC')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffb3a8" /><stop offset=".6" stopColor="#e0283c" /><stop offset="1" stopColor="#7a0a1c" /></linearGradient>
          <linearGradient id={k('fG')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c2f7c8" /><stop offset="1" stopColor="#1f7a3e" /></linearGradient>
        </defs>
        <rect x={LIP + 7} y={LIP + 7} width={S - 2 * LIP - 14} height={S - 2 * LIP - 14} fill="none" stroke="#ffe9a0" strokeWidth="3.4" opacity=".9" />
        <rect x={WELL - 6} y={WELL - 6} width={S - 2 * WELL + 12} height={S - 2 * WELL + 12} fill="none" stroke="#fff4c8" strokeWidth="2" opacity=".85" />
        {sprigs.map((s, i) => (
          <g key={i} transform={`translate(${s.x} ${s.y}) rotate(${s.rot}) translate(-20 -30)`}>
            <path d={SPRIG.stem} fill="none" stroke="#1f6a34" strokeWidth="1.8" strokeLinecap="round" />
            <path d={SPRIG.leafL} fill={u('fG')} stroke="#0f3a1c" strokeWidth=".7" />
            <path d={SPRIG.leafR} fill={u('fG')} stroke="#0f3a1c" strokeWidth=".7" />
            <path d={s.kind === 'tulip' ? SPRIG.tulip : SPRIG.carn} fill={u(s.kind === 'tulip' ? 'fT' : 'fC')} stroke="#4a1a04" strokeWidth=".9" strokeLinejoin="round" />
          </g>
        ))}
      </svg>
      <div className={styles.frameGlow} aria-hidden="true" />
      <div ref={wellRef} className={styles.well}>
        <div className={styles.wellWater} aria-hidden="true" />
        <div className={styles.wellContent}>{children}</div>
        <div className={styles.wellShade} aria-hidden="true" />
      </div>
    </div>
  );
}
/** Inset of the water well as a fraction of the frame's width (for layout maths). */
export const EBRU_FRAME_WELL_INSET = WELL / S;
