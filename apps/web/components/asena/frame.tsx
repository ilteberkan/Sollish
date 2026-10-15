import { memo } from 'react';
import type { ReactNode, Ref } from 'react';
import { AS_PALETTE as P, AS_WOLF_HEAD, asSparkle } from './symbols';
import styles from './art.module.css';

/* Felt-and-bronze frame around the 6 × 6 star field: a cast-bronze outer rim, a band of deep red felt stitched with
   cream thread and stamped with bronze ornament glyphs (invented, Göktürk-runic-INSPIRED strokes; they spell
   nothing), a beaded inner lip, four corner medallions with turquoise star inlays, and a wolf-head crest above the top
   edge. Feature mood: the felt glyphs and the inner lip glow aurora-teal. 1000 × 1000 art; the well (board) is inset
   by ASENA_FRAME_WELL_INSET of the side on every edge. Static SVG, only the feature layer fades (opacity). */

export type AsenaFrameMood = 'base' | 'feature';
const S = 1000, WELL = 62;
export const ASENA_FRAME_WELL_INSET = WELL / S;

/** Ornament glyphs in a 20 × 24 box (decorative strokes, not letters). */
const GLYPHS = [
  'M10 1L18 12L10 23L2 12ZM10 7V17',
  'M3 20L10 5L17 20M10 11V24',
  'M10 23V13C10 6 3 4 2.6 9.4C2.4 13 7 13.4 7 10.4M10 13C10 6 17 4 17.4 9.4C17.6 13 13 13.4 13 10.4',
  'M3 5L10 11L17 5M3 13L10 19L17 13',
  'M10 2L12.4 9.6L20 12L12.4 14.4L10 22L7.6 14.4L0 12L7.6 9.6Z',
];
function band(): string {
  // glyphs along all four sides of the felt band (centre line 31), skipping corners and the crest
  let d = '';
  const step = 40, mid = 31, a = 92, b = S - 92;
  let i = 0;
  const place = (x: number, y: number, rot: number) => {
    const g = GLYPHS[i++ % GLYPHS.length]!;
    d += `<path d="${g}" transform="translate(${x} ${y}) rotate(${rot}) translate(-10 -12) scale(1)"/>`;
  };
  for (let x = a; x <= b; x += step) if (Math.abs(x - S / 2) > 110) place(x, mid, 0);
  for (let x = a; x <= b; x += step) place(x, S - mid, 180);
  for (let y = a; y <= b; y += step) { place(mid, y, -90); place(S - mid, y, 90); }
  return d;
}
const BAND = band();
const DOTS = (() => {
  const out: Array<[number, number]> = [];
  const r = 54, a = 80, b = S - 80;
  for (let t = a; t <= b; t += 22) { out.push([t, r], [t, S - r], [r, t], [S - r, t]); }
  return out;
})();
const CORNERS: Array<[number, number]> = [[34, 34], [S - 34, 34], [34, S - 34], [S - 34, S - 34]];

const FrameArt = memo(function FrameArt() {
  return (
    <svg className={styles.frameArt} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="asfBronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.bronze.hi} /><stop offset=".18" stopColor={P.bronze.light} /><stop offset=".5" stopColor={P.bronze.base} /><stop offset=".78" stopColor={P.bronze.light} /><stop offset="1" stopColor={P.bronze.deep} />
        </linearGradient>
        <linearGradient id="asfFelt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.felt.light} /><stop offset=".5" stopColor={P.felt.base} /><stop offset="1" stopColor={P.felt.deep} />
        </linearGradient>
        <radialGradient id="asfMed" cx=".38" cy=".32" r=".7"><stop offset="0" stopColor={P.bronze.hi} /><stop offset=".55" stopColor={P.bronze.base} /><stop offset="1" stopColor={P.bronze.dark} /></radialGradient>
        <pattern id="asfNap" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="transparent" /><circle cx="1.5" cy="1.5" r=".7" fill="#000" opacity=".22" /><circle cx="4.5" cy="4.5" r=".6" fill="#fff" opacity=".06" /></pattern>
      </defs>
      {/* bronze outer rim */}
      <path d={`M34 0H${S - 34}A34 34 0 0 1 ${S} 34V${S - 34}A34 34 0 0 1 ${S - 34} ${S}H34A34 34 0 0 1 0 ${S - 34}V34A34 34 0 0 1 34 0ZM${WELL} ${WELL}V${S - WELL}H${S - WELL}V${WELL}Z`} fill="url(#asfBronze)" fillRule="evenodd" />
      <rect x="3" y="3" width={S - 6} height={S - 6} rx="31" fill="none" stroke="#fff4d6" strokeOpacity=".5" strokeWidth="2" />
      {/* felt band */}
      <path d={`M14 14H${S - 14}V${S - 14}H14ZM48 48V${S - 48}H${S - 48}V48Z`} fill="url(#asfFelt)" fillRule="evenodd" />
      <path d={`M14 14H${S - 14}V${S - 14}H14ZM48 48V${S - 48}H${S - 48}V48Z`} fill="url(#asfNap)" fillRule="evenodd" />
      <rect x="19" y="19" width={S - 38} height={S - 38} fill="none" stroke="#f4e2c0" strokeOpacity=".55" strokeWidth="1.4" strokeDasharray="6 5" />
      <rect x="43" y="43" width={S - 86} height={S - 86} fill="none" stroke="#f4e2c0" strokeOpacity=".55" strokeWidth="1.4" strokeDasharray="6 5" />
      <g fill="none" stroke={P.bronze.light} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: BAND }} />
      {/* beaded inner lip */}
      <rect x="48" y="48" width={S - 96} height={S - 96} fill="none" stroke="url(#asfBronze)" strokeWidth="16" />
      {DOTS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.4" fill={P.bronze.hi} stroke={P.bronze.dark} strokeWidth="1" />)}
      <rect x={WELL - 2} y={WELL - 2} width={S - WELL * 2 + 4} height={S - WELL * 2 + 4} rx="10" fill="none" stroke="#05040a" strokeWidth="4" />
      {/* corner medallions */}
      {CORNERS.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="31" fill="url(#asfMed)" stroke={P.bronze.dark} strokeWidth="2.4" />
          <circle cx={x} cy={y} r="23" fill={P.turq.deep} stroke={P.bronze.hi} strokeWidth="2" />
          <path d={asSparkle(x, y, 18, 0.24)} fill={P.turq.light} stroke={P.bronze.dark} strokeWidth="1.4" />
          <path d={asSparkle(x, y, 11, 0.24)} fill="#fff" opacity=".85" transform={`rotate(45 ${x} ${y})`} />
        </g>
      ))}
      {/* bottom plaque */}
      <path d={`M${S / 2 - 70} ${S - 6}L${S / 2 - 54} ${S - 42}H${S / 2 + 54}L${S / 2 + 70} ${S - 6}Z`} fill="url(#asfBronze)" stroke={P.bronze.dark} strokeWidth="2" />
      {[-30, 0, 30].map((dx) => <path key={dx} d={asSparkle(S / 2 + dx, S - 24, dx ? 7 : 10)} fill={dx ? P.turq.light : '#fff6d0'} stroke={P.bronze.dark} strokeWidth="1" />)}
    </svg>
  );
});
const FeatureArt = memo(function FeatureArt() {
  return (
    <svg className={styles.frameFeature} viewBox={`0 0 ${S} ${S}`} aria-hidden="true" focusable="false">
      <g fill="none" stroke="#7ffff0" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity=".9" dangerouslySetInnerHTML={{ __html: BAND }} />
      <rect x="48" y="48" width={S - 96} height={S - 96} fill="none" stroke="#5ff0d0" strokeWidth="5" opacity=".7" />
    </svg>
  );
});
export const AsenaCrest = memo(function AsenaCrest({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ascrB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={P.bronze.hi} /><stop offset=".4" stopColor={P.bronze.light} /><stop offset=".75" stopColor={P.bronze.base} /><stop offset="1" stopColor={P.bronze.deep} /></linearGradient>
        <radialGradient id="ascrF" cx=".5" cy=".35" r=".7"><stop offset="0" stopColor="#2a3a8e" /><stop offset="1" stopColor="#060a26" /></radialGradient>
        <linearGradient id="ascrW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor={P.silver.light} /><stop offset="1" stopColor={P.silver.base} /></linearGradient>
      </defs>
      {/* felt tassels behind */}
      <path d="M40 70L10 96L22 100L4 128L34 112ZM160 70L190 96L178 100L196 128L166 112Z" fill={P.felt.base} stroke="#1a0406" strokeWidth="2" />
      <path d="M100 4L170 30V96C170 140 136 172 100 196C64 172 30 140 30 96V30Z" fill="url(#ascrB)" stroke="#2a1406" strokeWidth="3" />
      <path d="M100 18L156 39V95C156 131 130 157 100 178C70 157 44 131 44 95V39Z" fill="url(#ascrF)" stroke={P.bronze.dark} strokeWidth="2" />
      {[[64, 52], [140, 60], [72, 140], [130, 146], [100, 30]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 4 ? 2.4 : 1.5} fill="#e6eeff" />)}
      <g transform="translate(58 44) scale(.84)">
        <path d={AS_WOLF_HEAD} fill="url(#ascrW)" stroke="#070a1c" strokeWidth="3" strokeLinejoin="round" />
        <path d="M30.4 51C34.6 48 39.4 48.6 43 52.4C39.4 54.8 34.6 54.8 30.4 51ZM69.6 51C65.4 48 60.6 48.6 57 52.4C60.6 54.8 65.4 54.8 69.6 51Z" fill="#ffd25a" />
        <path d="M43.4 79.6C45.6 76.6 54.4 76.6 56.6 79.6C55.6 84 52.4 86.4 50 86.4C47.6 86.4 44.4 84 43.4 79.6Z" fill="#0b0f26" />
        <path d={asSparkle(50, 40.6, 7)} fill={P.gold.light} />
      </g>
      <path d="M100 4L170 30V96C170 140 136 172 100 196" fill="none" stroke="#fff4d6" strokeWidth="2" opacity=".35" />
    </svg>
  );
});

export function AsenaFrame({ children, mood = 'base', className, wellRef, crest = true }: { children?: ReactNode; mood?: AsenaFrameMood; className?: string; wellRef?: Ref<HTMLDivElement>; crest?: boolean }) {
  const inset = `${ASENA_FRAME_WELL_INSET * 100}%`;
  return (
    <div className={`${styles.frame} ${className ?? ''}`} data-mood={mood}>
      <div className={styles.frameGlow} aria-hidden="true" />
      <FrameArt />
      <FeatureArt />
      <div ref={wellRef} className={styles.well} style={{ left: inset, top: inset, right: inset, bottom: inset }}>{children}</div>
      {crest && <AsenaCrest className={styles.crest} />}
    </div>
  );
}
