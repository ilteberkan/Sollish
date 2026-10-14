import { memo, useId } from 'react';
import type { ReactNode, Ref } from 'react';
import { CZ_PALETTE as P } from './symbols';
import styles from './art.module.css';

/* Cezeri board frame: the face of a brass astronomical clock set in a square tile panel.
   Square 1000 × 1000 art: a walnut-and-brass outer moulding, four spandrels of turquoise / cobalt eight-point
   star tiles (an original tessellation, drawn as an SVG pattern) each with a gilded rosette, then the round
   bezel: a beaded rim, an engraved band with twelve enamel cartouches on the spoke angles, a fixed toothed
   collar and the opening (the well) where the board sits. Four small brass pinions in the spandrels turn on
   the compositor (CSS, faster while `spinning`). The 'feature' mood fades in a water-light overlay as one
   layer; nothing inside the big SVG animates. */

export type CezeriFrameMood = 'base' | 'feature';
/** Board square inside the frame (percent of the frame side, each edge). */
export const CEZERI_FRAME_INSET = 9.4;
const R_WELL = 500 - CEZERI_FRAME_INSET * 10; // 406
const R_BEZEL = 470;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (r: number, deg: number) => { const a = (deg * Math.PI) / 180; return [r2(500 + Math.sin(a) * r), r2(500 - Math.cos(a) * r)] as const; };
const star = (cx: number, cy: number, n: number, r1: number, r0: number, rot = 0) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) { const a = ((rot + (i * 180) / n) * Math.PI) / 180, r = i % 2 ? r0 : r1; d += `${i ? 'L' : 'M'}${r2(cx + Math.sin(a) * r)} ${r2(cy - Math.cos(a) * r)}`; }
  return `${d}Z`;
};
const gearD = (cx: number, cy: number, n: number, r0: number, r1: number) => {
  let d = '';
  for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2, r = i % 4 < 2 ? r1 : r0; d += `${i ? 'L' : 'M'}${r2(cx + Math.cos(a) * r)} ${r2(cy + Math.sin(a) * r)}`; }
  return `${d}Z`;
};
const circle = (r: number) => `M${500 - r} 500A${r} ${r} 0 1 0 ${500 + r} 500A${r} ${r} 0 1 0 ${500 - r} 500Z`;

const FrameArt = memo(function FrameArt({ k }: { k: (n: string) => string }) {
  const u = (n: string) => `url(#${k(n)})`;
  return (
    <svg className={styles.frameArt} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('wood')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5a2e14" /><stop offset=".5" stopColor="#2e160a" /><stop offset="1" stopColor="#160a04" /></linearGradient>
        <linearGradient id={k('brass')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={P.brass.hi} /><stop offset=".3" stopColor={P.brass.light} /><stop offset=".6" stopColor={P.brass.base} /><stop offset=".85" stopColor={P.brass.deep} /><stop offset="1" stopColor={P.brass.dark} /></linearGradient>
        <radialGradient id={k('bezel')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={r2(R_WELL / 500)} stopColor={P.brass.dark} />
          <stop offset={r2((R_WELL + 8) / 500)} stopColor={P.brass.light} />
          <stop offset={r2((R_WELL + 22) / 500)} stopColor={P.brass.deep} />
          <stop offset={r2((R_WELL + 34) / 500)} stopColor={P.brass.base} />
          <stop offset={r2((R_BEZEL - 18) / 500)} stopColor={P.brass.hi} />
          <stop offset={r2((R_BEZEL - 6) / 500)} stopColor={P.brass.base} />
          <stop offset={r2(R_BEZEL / 500)} stopColor={P.brass.dark} />
        </radialGradient>
        <linearGradient id={k('sheen')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".4" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".35" /></linearGradient>
        {/* eight-point star tiles with cross tiles between (original pattern, 80 × 80) */}
        <pattern id={k('tiles')} width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
          <rect width="80" height="80" fill="#0b2a5c" />
          <path d={star(40, 40, 8, 30, 21)} fill="#1fb3ab" stroke="#f1e2c0" strokeWidth="2" />
          <path d={star(40, 40, 8, 17, 12, 22.5)} fill="#0e4f8a" stroke="#f1e2c0" strokeWidth="1.2" />
          <circle cx="40" cy="40" r="5" fill="#d6302c" stroke="#f1e2c0" strokeWidth="1" />
          {[[0, 0], [80, 0], [0, 80], [80, 80]].map(([x, y], i) => <path key={i} d={star(x!, y!, 4, 13, 5, 45)} fill="#f1e2c0" opacity=".9" />)}
          <path d="M40 0V8M40 72V80M0 40H8M72 40H80" stroke="#f1e2c0" strokeWidth="1.4" />
        </pattern>
        <radialGradient id={k('spanShade')} cx="500" cy="500" r="720" gradientUnits="userSpaceOnUse">
          <stop offset=".62" stopColor="#000" stopOpacity=".7" /><stop offset=".74" stopColor="#000" stopOpacity=".25" /><stop offset="1" stopColor="#000" stopOpacity=".5" />
        </radialGradient>
        <radialGradient id={k('enamel')} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor={P.turq.light} /><stop offset=".6" stopColor={P.turq.base} /><stop offset="1" stopColor={P.turq.dark} /></radialGradient>
        <radialGradient id={k('lapis')} cx=".4" cy=".35" r=".7"><stop offset="0" stopColor={P.lapis.light} /><stop offset=".6" stopColor={P.lapis.base} /><stop offset="1" stopColor={P.lapis.dark} /></radialGradient>
      </defs>
      {/* outer moulding */}
      <rect x="0" y="0" width="1000" height="1000" rx="34" fill={u('wood')} />
      <rect x="6" y="6" width="988" height="988" rx="30" fill="none" stroke={u('brass')} strokeWidth="9" />
      <rect x="22" y="22" width="956" height="956" rx="20" fill="none" stroke="#120804" strokeWidth="4" />
      {/* tile spandrels */}
      <path d={`M28 28H972V972H28Z${circle(R_BEZEL + 6)}`} fillRule="evenodd" fill={u('tiles')} />
      <path d={`M28 28H972V972H28Z${circle(R_BEZEL + 6)}`} fillRule="evenodd" fill={u('spanShade')} />
      <rect x="28" y="28" width="944" height="944" rx="16" fill="none" stroke={u('brass')} strokeWidth="5" />
      {/* corner rosettes */}
      {[[80, 80], [920, 80], [80, 920], [920, 920]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="50" fill="#120804" opacity=".55" />
          <path d={star(x!, y!, 12, 46, 35)} fill={u('brass')} stroke="#1a0d05" strokeWidth="3" />
          <circle cx={x} cy={y} r="31" fill={u("lapis")} stroke="#1a0d05" strokeWidth="2.4" />
          <path d={star(x!, y!, 8, 24, 13, 22.5)} fill={u('enamel')} stroke="#f1e2c0" strokeWidth="1.6" />
          <circle cx={x} cy={y} r="8" fill={P.verm.base} stroke="#f1e2c0" strokeWidth="1.4" />
        </g>
      ))}
      {/* bezel */}
      <circle cx="500" cy="500" r={R_BEZEL + 8} fill="#120804" />
      <path d={circle(R_BEZEL) + circle(R_WELL)} fillRule="evenodd" fill={u('bezel')} stroke="#1a0d05" strokeWidth="3" />
      {/* beading on the outer lip */}
      {Array.from({ length: 96 }, (_, i) => { const [x, y] = pt(R_BEZEL - 9, i * 3.75); return <circle key={i} cx={x} cy={y} r="3.4" fill={P.brass.hi} stroke="#4a2a08" strokeWidth=".9" />; })}
      {/* engraved band with spoke cartouches */}
      <circle cx="500" cy="500" r={R_WELL + 30} fill="none" stroke="#3a2004" strokeWidth="1.6" opacity=".8" />
      <circle cx="500" cy="500" r={R_BEZEL - 22} fill="none" stroke="#3a2004" strokeWidth="1.6" opacity=".8" />
      {Array.from({ length: 12 }, (_, s) => {
        const [x, y] = pt((R_WELL + 30 + R_BEZEL - 22) / 2, s * 30);
        return (
          <g key={s}>
            <ellipse cx={x} cy={y} rx="15" ry="15" fill={u(s % 3 === 0 ? 'lapis' : 'enamel')} stroke="#1a0d05" strokeWidth="2.4" />
            <path d={star(x, y, s % 3 === 0 ? 8 : 6, 9, 4.4)} fill="#f1e2c0" />
          </g>
        );
      })}
      {Array.from({ length: 12 }, (_, s) => {
        const [x, y] = pt((R_WELL + 30 + R_BEZEL - 22) / 2, s * 30 + 15);
        return <path key={s} d={star(x, y, 4, 6, 2.4, 45)} fill="#4a2a08" opacity=".9" />;
      })}
      {/* engraved arabesque between cartouches */}
      <g fill="none" stroke="#5a3408" strokeWidth="1.4" opacity=".75">
        {Array.from({ length: 24 }, (_, i) => {
          const a0 = i * 15 + 3.5, a1 = i * 15 + 11.5, rm = (R_WELL + 30 + R_BEZEL - 22) / 2;
          const [x0, y0] = pt(rm, a0), [x1, y1] = pt(rm, a1), [cx, cy] = pt(rm + (i % 2 ? 9 : -9), (a0 + a1) / 2);
          return <path key={i} d={`M${x0} ${y0}Q${cx} ${cy} ${x1} ${y1}`} />;
        })}
      </g>
      {/* inner collar where the board sits */}
      <circle cx="500" cy="500" r={R_WELL + 4} fill="none" stroke="#120804" strokeWidth="9" />
      <circle cx="500" cy="500" r={R_WELL + 10} fill="none" stroke={P.brass.hi} strokeWidth="2" opacity=".8" />
      <path d={circle(R_BEZEL + 6)} fill="none" stroke={u('sheen')} strokeWidth="8" opacity=".6" />
    </svg>
  );
});

const FeatureArt = memo(function FeatureArt({ k }: { k: (n: string) => string }) {
  return (
    <svg className={styles.frameFeature} viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={k('fglow')} cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse">
          <stop offset={r2((R_WELL - 2) / 500)} stopColor="#5ff0e0" stopOpacity="0" />
          <stop offset={r2((R_WELL + 14) / 500)} stopColor="#5ff0e0" stopOpacity=".14" />
          <stop offset={r2((R_BEZEL - 10) / 500)} stopColor="#5ff0e0" stopOpacity=".04" />
          <stop offset={r2((R_BEZEL + 30) / 500)} stopColor="#5ff0e0" stopOpacity=".26" />
          <stop offset="1" stopColor="#5ff0e0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1000" height="1000" fill={`url(#${k('fglow')})`} style={{ mixBlendMode: 'screen' }} />
      {Array.from({ length: 12 }, (_, s) => { const [x, y] = pt((R_WELL + 30 + R_BEZEL - 22) / 2, s * 30); return <circle key={s} cx={x} cy={y} r="17" fill="none" stroke="#bffff6" strokeWidth="2.4" opacity=".85" />; })}
    </svg>
  );
});

export function CezeriFrame({ mood = 'base', spinning = false, children, className, wellRef, ref }: { mood?: CezeriFrameMood; spinning?: boolean; children?: ReactNode; className?: string; wellRef?: Ref<HTMLDivElement>; ref?: Ref<HTMLDivElement> }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `czf${uid}${n}`;
  return (
    <div ref={ref} className={`${styles.frame} ${className ?? ''}`} data-mood={mood} data-spin={spinning ? '' : undefined}>
      <div className={styles.frameGlow} />
      <FrameArt k={k} />
      {/* pinions in the spandrels (compositor layers) */}
      {([[13.6, 13.6, 1], [86.4, 13.6, -1], [13.6, 86.4, -1], [86.4, 86.4, 1]] as const).map(([x, y, d], i) => (
        <div key={i} className={styles.pinion} style={{ left: `${x}%`, top: `${y}%`, animationDirection: d > 0 ? 'normal' : 'reverse' }}>
          <svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
            <path d={gearD(0, 0, 10, 36, 47)} fill={P.brass.base} stroke="#1a0d05" strokeWidth="3" />
            <circle r="30" fill="none" stroke={P.brass.hi} strokeWidth="2" opacity=".7" />
            {Array.from({ length: 5 }, (_, j) => { const a = (j / 5) * Math.PI * 2; return <circle key={j} cx={r2(Math.cos(a) * 18)} cy={r2(Math.sin(a) * 18)} r="6.4" fill="#1a0d05" />; })}
            <circle r="8" fill={P.verm.base} stroke="#1a0d05" strokeWidth="2" />
          </svg>
        </div>
      ))}
      <FeatureArt k={k} />
      <div ref={wellRef} className={styles.well} style={{ inset: `${CEZERI_FRAME_INSET}%` }}>{children}</div>
    </div>
  );
}
