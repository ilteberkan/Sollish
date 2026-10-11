import type { CSSProperties, ReactNode } from 'react';
import styles from './art.module.css';

/* Night patisserie: twilight sky, domed glass conservatory with warm windows, shelves with
   bokeh lights and floating sugar dust. Pure SVG + CSS, no filters, no JS. Parent must be
   position:relative (the backdrop fills it). */

function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n: number) => Math.round(n * 10) / 10;

const STARS = (() => {
  const r = rng(11);
  return Array.from({ length: 70 }, () => ({ x: f1(r() * 1600), y: f1(r() * 380), r: f1(0.6 + r() * 1.3), o: f1(0.25 + r() * 0.65) / 1 }));
})();

const BOKEH_COLORS = ['#ffc56e', '#ffb0cf', '#8fe9ff', '#ffd9a0', '#c9a7ff'];
const BOKEH = (() => {
  const r = rng(29);
  const pal = BOKEH_COLORS;
  return Array.from({ length: 26 }, (_, i) => {
    const left = i % 2 === 0;
    const x = left ? 20 + r() * 340 : 1240 + r() * 340;
    return { x: f1(x), y: f1(300 + r() * 520), r: f1(10 + r() * 34), c: Math.floor(r() * pal.length), o: f1(0.35 + r() * 0.5) };
  });
})();

const DUST = (() => {
  const r = rng(77);
  const pal = ['#ffe6a8', '#ffd1e3', '#d6f5ff', '#ffffff', '#e5d4ff'];
  return Array.from({ length: 26 }, () => ({
    x: f1(r() * 100),
    y: f1(10 + r() * 80),
    s: f1(3 + r() * 6),
    d: f1(14 + r() * 16),
    delay: f1(-r() * 26),
    o: f1(0.35 + r() * 0.5),
    sway: f1(-40 + r() * 80),
    c: pal[Math.floor(r() * pal.length)],
  }));
})();

const WINDOWS_L = [0, 1, 2, 3, 4];

/* meridians of the glass dome */
const CX = 800;
const BASE_Y = 500;
const RX = 410;
const RY = 330;
const MERIDIANS = [-0.8, -0.55, -0.28, 0, 0.28, 0.55, 0.8].map((f) => {
  const x = CX + RX * f;
  return f === 0 ? `M${CX} ${BASE_Y - RY}V${BASE_Y}` : `M${CX} ${BASE_Y - RY}A${Math.abs(f) * RX} ${RY} 0 0 ${f < 0 ? 0 : 1} ${f1(x)} ${BASE_Y}`;
});
const RINGS = [0.28, 0.5, 0.7, 0.86].map((h) => {
  const y = BASE_Y - RY * h;
  const w = RX * Math.sqrt(1 - h * h);
  return `M${f1(CX - w)} ${f1(y)}Q${CX} ${f1(y + 20)} ${f1(CX + w)} ${f1(y)}`;
});

function Shelf({ x, flip }: { x: number; flip?: boolean }) {
  const jars = [0, 1, 2, 3, 4];
  return (
    <g transform={flip ? `translate(${x + 330} 0) scale(-1 1)` : `translate(${x} 0)`}>
      {[590, 690, 790].map((y, row) => (
        <g key={y}>
          <rect x="0" y={y} width="330" height="11" rx="3" fill="url(#cbWood)" />
          <rect x="0" y={y + 10} width="330" height="2" fill="#ffb764" opacity=".35" />
          {jars.map((j) => {
            const jx = 24 + j * 62 + (row % 2) * 12;
            const hgt = 34 + ((j * 7 + row * 5) % 4) * 9;
            return (
              <g key={j}>
                {(j + row) % 2 === 0 ? (
                  <>
                    <path d={`M${jx} ${y}V${y - hgt + 14}A22 14 0 0 1 ${jx + 44} ${y - hgt + 14}V${y}Z`} fill="#1a1c44" stroke="#8d86d9" strokeOpacity=".4" strokeWidth="1.5" />
                    <rect x={jx + 6} y={y - hgt + 16} width="32" height={hgt - 18} rx="5" fill="url(#cbJar)" opacity=".85" />
                    <path d={`M${jx + 8} ${y - hgt + 20}V${y - 6}`} stroke="#fff" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <rect x={jx + 4} y={y - hgt} width="36" height={hgt} rx="9" fill="#1a1c44" stroke="#8d86d9" strokeOpacity=".4" strokeWidth="1.5" />
                    <rect x={jx + 9} y={y - hgt + 8} width="26" height={hgt - 12} rx="6" fill="url(#cbJar2)" opacity=".85" />
                    <rect x={jx + 8} y={y - hgt - 6} width="28" height="8" rx="3" fill="#b9782a" />
                  </>
                )}
              </g>
            );
          })}
        </g>
      ))}
      <rect x="-6" y="560" width="8" height="260" rx="3" fill="#2a1d2e" />
      <rect x="328" y="560" width="8" height="260" rx="3" fill="#2a1d2e" />
    </g>
  );
}

export function CascadeBackdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <svg className={styles.scene} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="cbSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#070b1e" />
            <stop offset="0.38" stopColor="#15174a" />
            <stop offset="0.68" stopColor="#3a2a66" />
            <stop offset="0.88" stopColor="#6a3b6b" />
            <stop offset="1" stopColor="#8a4a63" />
          </linearGradient>
          <radialGradient id="cbHaze" cx="0.5" cy="0.62" r="0.55">
            <stop offset="0" stopColor="#ffb86b" stopOpacity=".42" />
            <stop offset="0.5" stopColor="#ff8aa8" stopOpacity=".14" />
            <stop offset="1" stopColor="#ff8aa8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cbCity" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2156" />
            <stop offset="1" stopColor="#171538" />
          </linearGradient>
          <linearGradient id="cbGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8f86ff" stopOpacity=".28" />
            <stop offset="0.55" stopColor="#6f68d8" stopOpacity=".22" />
            <stop offset="1" stopColor="#ffb86b" stopOpacity=".34" />
          </linearGradient>
          <radialGradient id="cbInner" cx="0.5" cy="1" r="0.9">
            <stop offset="0" stopColor="#ffd08a" stopOpacity=".95" />
            <stop offset="0.4" stopColor="#ff9a62" stopOpacity=".5" />
            <stop offset="1" stopColor="#ff7a7a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cbBrass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7a4a14" />
            <stop offset="0.3" stopColor="#e9b35d" />
            <stop offset="0.55" stopColor="#fff0bd" />
            <stop offset="0.8" stopColor="#c58b3a" />
            <stop offset="1" stopColor="#6f3f10" />
          </linearGradient>
          <linearGradient id="cbWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6d4a3a" />
            <stop offset="1" stopColor="#35222a" />
          </linearGradient>
          <linearGradient id="cbJar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9fc4" />
            <stop offset="1" stopColor="#c04f86" />
          </linearGradient>
          <linearGradient id="cbJar2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8ff0d6" />
            <stop offset="1" stopColor="#2c9c9a" />
          </linearGradient>
          <radialGradient id="cbWin" cx="0.5" cy="0.7" r="0.8">
            <stop offset="0" stopColor="#fff2b8" />
            <stop offset="0.5" stopColor="#ffc368" />
            <stop offset="1" stopColor="#e5823a" />
          </radialGradient>
          <radialGradient id="cbFloor" cx="0.5" cy="0" r="0.9">
            <stop offset="0" stopColor="#ffb86b" stopOpacity=".5" />
            <stop offset="1" stopColor="#ffb86b" stopOpacity="0" />
          </radialGradient>
          {BOKEH_COLORS.map((c, i) => (
            <radialGradient key={c} id={`cbBk${i}`}>
              <stop offset="0" stopColor={c} stopOpacity=".18" />
              <stop offset="0.72" stopColor={c} stopOpacity=".4" />
              <stop offset="0.9" stopColor="#fff" stopOpacity=".5" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="cbLamp" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff6cf" />
            <stop offset="0.25" stopColor="#ffd37a" stopOpacity=".9" />
            <stop offset="1" stopColor="#ffb04a" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1600" height="900" fill="url(#cbSky)" />
        <rect width="1600" height="900" fill="url(#cbHaze)" />
        {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />)}
        <circle cx="1330" cy="130" r="46" fill="#fff4d6" opacity=".92" />
        <circle cx="1348" cy="120" r="42" fill="#15174a" opacity=".92" />
        <circle cx="1330" cy="130" r="120" fill="url(#cbLamp)" opacity=".1" />

        {/* distant skyline */}
        <path d="M0 640V560L40 560V520L70 500V560H120V480L150 450V560H210V530H260V570H330V510L360 490V570H1240V500L1270 480V570H1330V530H1390V580H1440V470L1475 440V580H1530V540H1600V640Z" fill="url(#cbCity)" opacity=".8" />
        {[
          [52, 535], [135, 505], [345, 530], [1262, 520], [1455, 500], [1500, 560],
        ].map(([x, y], i) => <rect key={i} x={x} y={y} width="7" height="10" rx="1.5" fill="#ffd38a" opacity=".7" />)}

        <ellipse cx="800" cy="430" rx="560" ry="360" fill="url(#cbHaze)" opacity=".8" />
        {/* conservatory: wings */}
        <g>
          <rect x="360" y="440" width="170" height="320" rx="6" fill="#161847" />
          <rect x="1070" y="440" width="170" height="320" rx="6" fill="#161847" />
          <path d="M350 440L445 380L540 440Z" fill="#1c1d58" stroke="url(#cbBrass)" strokeWidth="3" strokeLinejoin="round" />
          <path d="M1060 440L1155 380L1250 440Z" fill="#1c1d58" stroke="url(#cbBrass)" strokeWidth="3" strokeLinejoin="round" />
          {WINDOWS_L.slice(0, 3).map((i) => (
            <g key={i}>
              <path d={`M${385 + i * 48} 540V490A15 15 0 0 1 ${415 + i * 48} 490V540Z`} fill="url(#cbWin)" opacity=".85" />
              <path d={`M${1095 + i * 48} 540V490A15 15 0 0 1 ${1125 + i * 48} 490V540Z`} fill="url(#cbWin)" opacity=".85" />
            </g>
          ))}
        </g>

        {/* glass dome */}
        <g>
          <path d={`M${CX - RX} ${BASE_Y}A${RX} ${RY} 0 0 1 ${CX + RX} ${BASE_Y}Z`} fill="url(#cbGlass)" />
          <g className={styles.glowPulse}>
            <path d={`M${CX - RX} ${BASE_Y}A${RX} ${RY} 0 0 1 ${CX + RX} ${BASE_Y}Z`} fill="url(#cbInner)" opacity=".55" />
            {[[600, 400], [1000, 400], [800, 330], [700, 250], [900, 250]].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="60" fill="url(#cbLamp)" opacity=".55" />
                <circle cx={x} cy={y} r="5" fill="#fff6cf" />
                <path d={`M${x} ${y - 5}V${y - 60}`} stroke="#2a1d2e" strokeWidth="1.5" opacity=".6" />
              </g>
            ))}
          </g>
          {/* plant and cake-stand silhouettes inside */}
          <g fill="#241a40" opacity=".78">
            <path d="M560 500C560 450 580 430 596 400C612 430 632 450 632 500Z" />
            <path d="M980 500C980 440 1000 420 1020 380C1040 420 1060 440 1060 500Z" />
            <rect x="770" y="440" width="60" height="60" rx="4" />
            <ellipse cx="800" cy="438" rx="62" ry="8" />
            <path d="M770 430A30 24 0 0 1 830 430Z" />
            <rect x="798" y="398" width="4" height="16" />
          </g>
          {MERIDIANS.map((d, i) => <path key={i} d={d} fill="none" stroke="url(#cbBrass)" strokeWidth={i === 3 ? 3 : 2.2} opacity=".78" />)}
          {RINGS.map((d, i) => <path key={i} d={d} fill="none" stroke="url(#cbBrass)" strokeWidth="2.2" opacity=".65" />)}
          <path d={`M${CX - RX} ${BASE_Y}A${RX} ${RY} 0 0 1 ${CX + RX} ${BASE_Y}`} fill="none" stroke="url(#cbBrass)" strokeWidth="5" />
          <path d={`M${CX - RX + 40} ${BASE_Y - 140}C${CX - RX + 70} ${BASE_Y - 230} ${CX - 140} ${BASE_Y - 310} ${CX - 40} ${BASE_Y - 322}`} fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="9" strokeLinecap="round" />
          {/* lantern + finial */}
          <rect x={CX - 18} y={BASE_Y - RY - 34} width="36" height="40" rx="6" fill="#1c1d58" stroke="url(#cbBrass)" strokeWidth="2.5" />
          <path d={`M${CX - 24} ${BASE_Y - RY - 34}L${CX} ${BASE_Y - RY - 66}L${CX + 24} ${BASE_Y - RY - 34}Z`} fill="url(#cbBrass)" />
          <circle cx={CX} cy={BASE_Y - RY - 72} r="5" fill="#fff0bd" />
          <rect x={CX - 7} y={BASE_Y - RY - 28} width="14" height="26" rx="5" fill="url(#cbWin)" />
          {/* base plinth */}
          <rect x={CX - RX - 20} y={BASE_Y} width={RX * 2 + 40} height="16" rx="4" fill="url(#cbBrass)" />
          <rect x={CX - RX} y={BASE_Y + 16} width={RX * 2} height="250" fill="#14173f" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d={`M${CX - RX + 40 + i * 110} 700V560A34 34 0 0 1 ${CX - RX + 108 + i * 110} 560V700Z`} fill="url(#cbWin)" opacity=".5" stroke="url(#cbBrass)" strokeWidth="3" />
          ))}
        </g>

        {/* shelves + bokeh */}
        <Shelf x={20} />
        <Shelf x={1250} flip />
        {BOKEH.map((b, i) => <circle key={i} cx={b.x} cy={b.y} r={b.r} fill={`url(#cbBk${b.c})`} opacity={b.o} />)}

        {/* counter / floor */}
        <rect x="0" y="800" width="1600" height="100" fill="#120f2c" />
        <rect x="0" y="796" width="1600" height="8" fill="url(#cbBrass)" opacity=".85" />
        <ellipse cx="800" cy="812" rx="760" ry="46" fill="url(#cbFloor)" />
      </svg>
      <div className={styles.dustLayer}>
        {DUST.map((d, i) => (
          <span
            key={i}
            className={styles.dust}
            style={{ '--x': `${d.x}%`, '--y': `${d.y}%`, '--s': `${d.s}px`, '--d': `${d.d}s`, '--delay': `${d.delay}s`, '--o': d.o, '--sway': `${d.sway}px`, '--c': d.c } as CSSProperties}
          />
        ))}
      </div>
      <div className={styles.vignette} />
    </div>
  );
}

function Ornament({ className }: { className: string }) {
  return (
    <svg className={`${styles.corner} ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cbOrnG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c8" />
          <stop offset="0.4" stopColor="#e9b35d" />
          <stop offset="1" stopColor="#8a5316" />
        </linearGradient>
        <radialGradient id="cbOrnJ" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#ff9fc2" />
          <stop offset="1" stopColor="#b3225e" />
        </radialGradient>
      </defs>
      <path d="M2 2H40C40 10 34 14 28 14H14V28C14 34 10 40 2 40Z" fill="url(#cbOrnG)" stroke="#4a2806" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 8H34C32 11 30 12 27 12H12V27C12 30 11 32 8 34Z" fill="none" stroke="#fff4c8" strokeWidth=".9" opacity=".8" strokeLinejoin="round" />
      <path d="M18 18Q38 18 48 30Q52 36 60 36" fill="none" stroke="#4a2806" strokeWidth="4.6" strokeLinecap="round" />
      <path d="M18 18Q38 18 48 30Q52 36 60 36" fill="none" stroke="url(#cbOrnG)" strokeWidth="3" strokeLinecap="round" />
      <path d="M18 18Q18 38 30 48Q36 52 36 60" fill="none" stroke="#4a2806" strokeWidth="4.6" strokeLinecap="round" />
      <path d="M18 18Q18 38 30 48Q36 52 36 60" fill="none" stroke="url(#cbOrnG)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="36" r="2.8" fill="url(#cbOrnG)" stroke="#4a2806" strokeWidth=".8" />
      <circle cx="36" cy="60" r="2.8" fill="url(#cbOrnG)" stroke="#4a2806" strokeWidth=".8" />
      <circle cx="20" cy="20" r="8" fill="url(#cbOrnG)" stroke="#4a2806" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="5.4" fill="url(#cbOrnJ)" stroke="#6a3a0a" strokeWidth=".8" />
      <circle cx="18" cy="18" r="1.5" fill="#fff" />
    </svg>
  );
}

/* Frosted-glass vitrine with brass trim. Inner area is 6:5; children fill it absolutely
   (give them width/height 100%). The frame's width comes from its parent. */
export function BoardFrame({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.glass}>
        <div className={styles.content}>{children}</div>
        <div className={styles.sheen} aria-hidden="true" />
      </div>
      <Ornament className={styles.cTL} />
      <Ornament className={styles.cTR} />
      <Ornament className={styles.cBL} />
      <Ornament className={styles.cBR} />
      <svg className={styles.crest} viewBox="0 0 84 26" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="cbCrestG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff4c8" />
            <stop offset="0.45" stopColor="#e9b35d" />
            <stop offset="1" stopColor="#8a5316" />
          </linearGradient>
          <radialGradient id="cbCrestJ" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#8fe9ff" />
            <stop offset="1" stopColor="#1f7fa6" />
          </radialGradient>
        </defs>
        <path d="M2 18C14 18 18 8 30 8H54C66 8 70 18 82 18C82 22 78 24 72 24H12C6 24 2 22 2 18Z" fill="url(#cbCrestG)" stroke="#5a3208" strokeWidth="1" strokeLinejoin="round" />
        <circle cx="42" cy="12" r="7" fill="url(#cbCrestG)" stroke="#5a3208" strokeWidth="1" />
        <circle cx="42" cy="12" r="4.4" fill="url(#cbCrestJ)" stroke="#5a3208" strokeWidth=".7" />
        <circle cx="40.6" cy="10.6" r="1.2" fill="#fff" />
      </svg>
    </div>
  );
}
