import { memo } from 'react';
import type { ReactNode, Ref } from 'react';
import { GR_PALETTE as P, grDiamond, grSteppedDiamond } from './symbols';
import styles from './art.module.css';

/* Tuff-stone reel window for the 6 × 5 board: a cream tuff rim cut from irregular blocks (speckled, with a sunlit top
   edge), a woven kilim band (madder ground, saffron stepped diamonds with indigo eyes, cream selvedge lines), a carved
   inner lip with a thin gold line, four tuff bosses with kilim eyes, a dawn-sun crest on top and a small plaque below.
   The well behind the board is a dusk-violet field with faint reel dividers. Feature mood: the kilim band and lip glow
   gold. Art is 1240 × 1040 (6 : 5 well); the well is inset GOREME_FRAME_INSET on every side (fractions of width and
   height). Static SVG; only the feature layer fades (opacity). */

export type GoremeFrameMood = 'base' | 'feature';
const W = 1240, H = 1040, WELL = 64;
export const GOREME_FRAME_INSET = { x: WELL / W, y: WELL / H } as const;
export const GOREME_FRAME_ASPECT = W / H;

const SEAMS = (() => {
  // irregular block joints on the rim (outer 0..16 and the outer half of the band is covered, so joints sit on the rim)
  let d = '';
  for (let x = 120; x < W - 80; x += 150 + ((x * 7) % 40)) { d += `M${x} 0V16M${x + 40} ${H - 16}V${H}`; }
  for (let y = 120; y < H - 80; y += 140 + ((y * 5) % 36)) { d += `M0 ${y}H16M${W - 16} ${y + 30}H${W}`; }
  return d;
})();
const BOSSES: Array<[number, number]> = [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]];

const FrameArt = memo(function FrameArt() {
  return (
    <svg className={styles.frameArt} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grfTuff" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={P.tuff.hi} /><stop offset=".2" stopColor={P.tuff.light} /><stop offset=".6" stopColor={P.tuff.base} /><stop offset="1" stopColor={P.tuff.deep} />
        </linearGradient>
        <pattern id="grfSpeck" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="1.1" fill="#7a4a3a" opacity=".28" /><circle cx="10" cy="9" r=".8" fill="#fff" opacity=".35" /><circle cx="7" cy="12" r=".7" fill="#7a4a3a" opacity=".2" />
        </pattern>
        <pattern id="grfKilim" width="36" height="36" patternUnits="userSpaceOnUse" x="16" y="16">
          <rect width="36" height="36" fill={P.madder.base} />
          <path d={grSteppedDiamond(18, 18, 13, 3)} fill={P.saffron.light} />
          <path d={grDiamond(18, 18, 6.5)} fill={P.indigo.base} />
          <path d={grDiamond(18, 18, 2.6)} fill={P.cream} />
          <path d={`${grDiamond(0, 0, 3.4)}${grDiamond(36, 0, 3.4)}${grDiamond(0, 36, 3.4)}${grDiamond(36, 36, 3.4)}`} fill={P.cream} />
        </pattern>
        <linearGradient id="grfWell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2a6a" /><stop offset=".55" stopColor="#2a1c4e" /><stop offset="1" stopColor="#1c1236" />
        </linearGradient>
        <radialGradient id="grfWellGlow" cx=".5" cy="0" r=".9"><stop offset="0" stopColor="#ffc8a0" stopOpacity=".28" /><stop offset="1" stopColor="#ffc8a0" stopOpacity="0" /></radialGradient>
        <radialGradient id="grfBoss" cx=".36" cy=".3" r=".75"><stop offset="0" stopColor={P.tuff.hi} /><stop offset=".55" stopColor={P.tuff.base} /><stop offset="1" stopColor={P.tuff.dark} /></radialGradient>
        <linearGradient id="grfGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={P.saffron.hi} /><stop offset=".5" stopColor={P.saffron.light} /><stop offset="1" stopColor={P.saffron.deep} /></linearGradient>
      </defs>
      {/* well */}
      <rect x={WELL - 4} y={WELL - 4} width={W - WELL * 2 + 8} height={H - WELL * 2 + 8} fill="url(#grfWell)" />
      <rect x={WELL} y={WELL} width={W - WELL * 2} height={H - WELL * 2} fill="url(#grfWellGlow)" />
      {/* tuff rim */}
      <path d={`M40 0H${W - 40}A40 40 0 0 1 ${W} 40V${H - 40}A40 40 0 0 1 ${W - 40} ${H}H40A40 40 0 0 1 0 ${H - 40}V40A40 40 0 0 1 40 0ZM${WELL} ${WELL}V${H - WELL}H${W - WELL}V${WELL}Z`} fill="url(#grfTuff)" fillRule="evenodd" />
      <path d={`M40 0H${W - 40}A40 40 0 0 1 ${W} 40V${H - 40}A40 40 0 0 1 ${W - 40} ${H}H40A40 40 0 0 1 0 ${H - 40}V40A40 40 0 0 1 40 0ZM${WELL} ${WELL}V${H - WELL}H${W - WELL}V${WELL}Z`} fill="url(#grfSpeck)" fillRule="evenodd" />
      <path d={SEAMS} stroke={P.tuff.dark} strokeWidth="2" opacity=".45" />
      <path d={`M40 2H${W - 40}`} stroke="#fff" strokeWidth="3" opacity=".7" />
      <rect x="1.5" y="1.5" width={W - 3} height={H - 3} rx="39" fill="none" stroke={P.ink} strokeWidth="3" opacity=".7" />
      {/* kilim band */}
      <path d={`M16 16H${W - 16}V${H - 16}H16ZM50 50V${H - 50}H${W - 50}V50Z`} fill="url(#grfKilim)" fillRule="evenodd" />
      <rect x="16" y="16" width={W - 32} height={H - 32} fill="none" stroke={P.cream} strokeWidth="3" />
      <rect x="21" y="21" width={W - 42} height={H - 42} fill="none" stroke={P.indigo.deep} strokeWidth="2" />
      <rect x="45" y="45" width={W - 90} height={H - 90} fill="none" stroke={P.indigo.deep} strokeWidth="2" />
      <rect x="50" y="50" width={W - 100} height={H - 100} fill="none" stroke={P.cream} strokeWidth="3" />
      {/* carved inner lip */}
      <rect x="57" y="57" width={W - 114} height={H - 114} fill="none" stroke={P.tuff.base} strokeWidth="12" />
      <rect x="57" y="57" width={W - 114} height={H - 114} fill="none" stroke="url(#grfTuff)" strokeWidth="8" />
      <rect x={WELL - 1} y={WELL - 1} width={W - WELL * 2 + 2} height={H - WELL * 2 + 2} fill="none" stroke="url(#grfGold)" strokeWidth="2.6" />
      <rect x={WELL + 2} y={WELL + 2} width={W - WELL * 2 - 4} height={H - WELL * 2 - 4} fill="none" stroke="#120a22" strokeWidth="4" opacity=".7" />
      {/* bosses */}
      {BOSSES.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="31" fill="url(#grfBoss)" stroke={P.ink} strokeWidth="2.6" />
          <path d={grSteppedDiamond(x, y, 20, 3)} fill={P.madder.base} stroke={P.ink} strokeWidth="1.6" />
          <path d={grDiamond(x, y, 10)} fill={P.saffron.light} />
          <path d={grDiamond(x, y, 4.4)} fill={P.indigo.deep} />
          <path d={`M${x - 20} ${y - 14}Q${x - 12} ${y - 26} ${x} ${y - 27}`} stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".6" />
        </g>
      ))}
      {/* bottom plaque */}
      <path d={`M${W / 2 - 96} ${H - 4}L${W / 2 - 76} ${H - 40}H${W / 2 + 76}L${W / 2 + 96} ${H - 4}Z`} fill="url(#grfTuff)" stroke={P.ink} strokeWidth="2.4" />
      <path d={`M${W / 2 - 60} ${H - 22}H${W / 2 + 60}`} stroke={P.madder.base} strokeWidth="6" />
      {[-40, -20, 0, 20, 40].map((dx) => <path key={dx} d={grDiamond(W / 2 + dx, H - 22, dx ? 5 : 7)} fill={dx ? P.saffron.light : P.cream} stroke={P.ink} strokeWidth="1" />)}
    </svg>
  );
});

const FeatureArt = memo(function FeatureArt() {
  return (
    <svg className={styles.frameFeature} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x="33" y="33" width={W - 66} height={H - 66} fill="none" stroke="#ffe08a" strokeWidth="30" opacity=".32" />
      <rect x="16" y="16" width={W - 32} height={H - 32} fill="none" stroke="#fff4c0" strokeWidth="4" />
      <rect x="50" y="50" width={W - 100} height={H - 100} fill="none" stroke="#fff4c0" strokeWidth="4" />
      <rect x={WELL - 1} y={WELL - 1} width={W - WELL * 2 + 2} height={H - WELL * 2 + 2} fill="none" stroke="#ffe8a0" strokeWidth="5" />
    </svg>
  );
});

/** Reel dividers inside the well (6 columns). */
const Reels = memo(function Reels() {
  return (
    <div className={styles.reels} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
    </div>
  );
});

/** Dawn-sun crest above the top edge. */
export const GoremeCrest = memo(function GoremeCrest({ className }: { className?: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI - Math.PI;
    const p = (r: number, da: number) => `${Math.round((100 + Math.cos(a + da) * r) * 10) / 10} ${Math.round((110 + Math.sin(a + da) * r) * 10) / 10}`;
    return `M${p(46, -0.12)}L${p(i % 2 ? 72 : 88, 0)}L${p(46, 0.12)}Z`;
  });
  return (
    <svg className={className} viewBox="0 0 200 130" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="grcRay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.saffron.hi} /><stop offset="1" stopColor={P.saffron.base} /></linearGradient>
        <radialGradient id="grcSun" cx=".45" cy=".4" r=".7"><stop offset="0" stopColor="#fffdf0" /><stop offset=".5" stopColor={P.saffron.light} /><stop offset="1" stopColor="#f08a2a" /></radialGradient>
        <linearGradient id="grcTuff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.tuff.hi} /><stop offset="1" stopColor={P.tuff.deep} /></linearGradient>
      </defs>
      {rays.map((d, i) => <path key={i} d={d} fill="url(#grcRay)" stroke={P.ink} strokeWidth="2" strokeLinejoin="round" />)}
      <path d="M38 110A62 62 0 0 1 162 110Z" fill={P.saffron.deep} stroke={P.ink} strokeWidth="2.4" />
      <path d="M48 110A52 52 0 0 1 152 110Z" fill="url(#grcSun)" />
      {[[76, 92], [100, 80], [124, 92]].map(([x, y], i) => <path key={i} d={grDiamond(x!, y!, 6)} fill="#fff6d6" opacity=".8" />)}
      <path d="M20 110H180L170 128H30Z" fill="url(#grcTuff)" stroke={P.ink} strokeWidth="2.4" />
      <path d="M40 119H160" stroke={P.madder.base} strokeWidth="4" />
    </svg>
  );
});

export function GoremeFrame({ children, mood = 'base', className, wellRef, crest = true, reels = true }: { children?: ReactNode; mood?: GoremeFrameMood; className?: string; wellRef?: Ref<HTMLDivElement>; crest?: boolean; reels?: boolean }) {
  const ix = `${GOREME_FRAME_INSET.x * 100}%`, iy = `${GOREME_FRAME_INSET.y * 100}%`;
  return (
    <div className={`${styles.frame} ${className ?? ''}`} data-mood={mood}>
      <div className={styles.frameGlow} aria-hidden="true" />
      <FrameArt />
      <FeatureArt />
      <div ref={wellRef} className={styles.well} style={{ left: ix, top: iy, right: ix, bottom: iy }}>
        {reels && <Reels />}
        {children}
      </div>
      {crest && <GoremeCrest className={styles.crest} />}
    </div>
  );
}
