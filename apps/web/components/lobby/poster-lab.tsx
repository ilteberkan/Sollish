'use client';
/* Lobby key-art compositions (development only, /lab/lobby-posters). Each poster is composed from the game's own art
   components (scene, character, symbols, logo) or, for Crash/Coinflip/Ringside, from original Sollish drawings and the
   project's Ringside art. scripts/lobby-posters.mjs screenshots every [data-poster] element with reduced motion and writes
   small WebP files to public/images/lobby/, so the lobby ships images (cached, lazy) instead of this markup and JS.
   Posters carry no text in any language other than the brand names, so one file serves every locale. */
import type { CSSProperties, ReactNode } from 'react';
import { StormScene } from '@/components/storm/scene';
import { StormCharacter } from '@/components/storm/character';
import { StormLogo } from '@/components/storm/logo';
import { StormSymbolArt } from '@/components/storm/symbols';
import { EbruScene } from '@/components/ebru/scene';
import { EbruLogo } from '@/components/ebru/logo';
import { EbruSymbolArt, EbruStainArt } from '@/components/ebru/symbols';
import { CezeriScene } from '@/components/cezeri/scene';
import { CezeriLogo } from '@/components/cezeri/logo';
import { CezeriSymbolArt } from '@/components/cezeri/symbols';
import { AsenaScene } from '@/components/asena/scene';
import { AsenaLogo } from '@/components/asena/logo';
import { AsenaSymbolArt } from '@/components/asena/symbols';
import { CascadeBackdrop } from '@/components/cascade/backdrop';
import { SymbolArt } from '@/components/cascade/symbols';
import { BrandMark } from '@/components/icons';
import { POSTER_SIZES, type PosterVariant } from '@/lib/lobby/posters';
import styles from './poster-lab.module.css';

type Box = { x: number; y: number; w: number; r?: number; z?: number; o?: number };
/** Absolutely placed layer: x/y are the centre in % of the poster, w the width in % of the poster width. */
function At({ x, y, w, r = 0, z = 2, o = 1, children }: Box & { children: ReactNode }) {
  const style: CSSProperties = { left: `${x}%`, top: `${y}%`, width: `${w}%`, transform: `translate(-50%, -50%) rotate(${r}deg)`, zIndex: z, opacity: o };
  return <div className={styles.at} style={style}>{children}</div>;
}
/** Left-side fade for the wide hero (the HTML copy sits there) and a soft floor fade for the others. */
function Fade({ variant }: { variant: PosterVariant }) {
  return <div className={styles.fade} data-variant={variant} />;
}
function Frame({ id, variant, children }: { id: string; variant: PosterVariant; children: ReactNode }) {
  const [width, height] = POSTER_SIZES[variant];
  return <div className={styles.poster} data-poster={`${id}-${variant}`} style={{ width, height }}>{children}<Fade variant={variant} /></div>;
}

type Layout = Record<PosterVariant, Box[]>;
/* Positions per variant: [logo, hero subject, symbol a, symbol b, symbol c]. */
const L = (layout: Partial<Layout>) => layout;

function Tarhun({ variant }: { variant: PosterVariant }) {
  const p = L({
    tile: [{ x: 50, y: 82, w: 96, z: 5 }, { x: 50, y: 43, w: 128 }, { x: 16, y: 20, w: 26, r: -10, z: 4 }, { x: 85, y: 24, w: 24, r: 8, z: 4 }],
    wide: [{ x: 78, y: 78, w: 40, z: 5 }, { x: 64, y: 50, w: 34 }, { x: 89, y: 28, w: 11, r: 8, z: 4 }, { x: 52, y: 26, w: 9, r: -10, z: 4 }],
    narrow: [{ x: 70, y: 78, w: 58, z: 5 }, { x: 28, y: 52, w: 60 }, { x: 74, y: 32, w: 22, r: 8, z: 4 }, { x: 56, y: 18, w: 14, r: -10, z: 1 }],
  })[variant]!;
  return <Frame id="tarhun" variant={variant}>
    <StormScene parallax={false} className={styles.scene} />
    <At {...p[1]!}><StormCharacter pose="strike" framing="bust" /></At>
    <At {...p[2]!}><StormSymbolArt symbol="orb" multiplier={100} /></At>
    <At {...p[3]!}><StormSymbolArt symbol="h1" /></At>
    <At {...p[0]!}><StormLogo variant="compact" size="100%" /></At>
  </Frame>;
}

function Ebru({ variant }: { variant: PosterVariant }) {
  const p = L({
    tile: [{ x: 50, y: 80, w: 92, z: 5 }, { x: 50, y: 40, w: 62 }, { x: 18, y: 18, w: 30, r: -12, z: 3 }, { x: 84, y: 22, w: 30, r: 10, z: 3 }, { x: 80, y: 56, w: 26, r: 4, z: 4 }],
    wide: [{ x: 78, y: 74, w: 38, z: 5 }, { x: 66, y: 34, w: 17 }, { x: 87, y: 30, w: 13, r: 10, z: 3 }, { x: 52, y: 66, w: 11, r: -12, z: 3 }, { x: 95, y: 58, w: 9, r: 4, z: 4 }],
    narrow: [{ x: 50, y: 76, w: 70, z: 5 }, { x: 50, y: 32, w: 30 }, { x: 22, y: 30, w: 22, r: -12, z: 3 }, { x: 78, y: 30, w: 22, r: 10, z: 3 }, { x: 88, y: 64, w: 15, r: 4, z: 4 }],
  })[variant]!;
  return <Frame id="ebru" variant={variant}>
    <EbruScene parallax={false} className={styles.scene} />
    <At {...p[1]!}><EbruSymbolArt symbol="c1" /></At>
    <At {...p[2]!}><EbruSymbolArt symbol="c2" /></At>
    <At {...p[3]!}><EbruSymbolArt symbol="c5" /></At>
    <At {...p[4]!}><EbruStainArt value={64} /></At>
    <At {...p[0]!}><EbruLogo subtitle={false} /></At>
  </Frame>;
}

function Cezeri({ variant }: { variant: PosterVariant }) {
  const p = L({
    tile: [{ x: 50, y: 82, w: 86, z: 5 }, { x: 50, y: 40, w: 66 }, { x: 16, y: 20, w: 30, r: -8, z: 3 }, { x: 86, y: 18, w: 28, r: 12, z: 3 }, { x: 84, y: 58, w: 24, z: 4 }],
    wide: [{ x: 76, y: 78, w: 40, z: 5 }, { x: 70, y: 36, w: 20 }, { x: 52, y: 30, w: 11, r: -8, z: 3 }, { x: 90, y: 30, w: 12, r: 12, z: 3 }, { x: 93, y: 62, w: 9, z: 4 }],
    narrow: [{ x: 50, y: 78, w: 72, z: 5 }, { x: 50, y: 34, w: 34 }, { x: 20, y: 30, w: 22, r: -8, z: 3 }, { x: 80, y: 28, w: 22, r: 12, z: 3 }, { x: 88, y: 60, w: 14, z: 4 }],
  })[variant]!;
  return <Frame id="cezeri" variant={variant}>
    <CezeriScene parallax={false} className={styles.scene} />
    <At {...p[1]!}><CezeriSymbolArt symbol="h1" /></At>
    <At {...p[2]!}><CezeriSymbolArt symbol="h4" /></At>
    <At {...p[3]!}><CezeriSymbolArt symbol="gear" /></At>
    <At {...p[4]!}><CezeriSymbolArt symbol="vessel" /></At>
    <At {...p[0]!}><CezeriLogo subtitle={false} /></At>
  </Frame>;
}

function Asena({ variant }: { variant: PosterVariant }) {
  const p = L({
    tile: [{ x: 50, y: 82, w: 92, z: 5 }, { x: 50, y: 40, w: 64 }, { x: 17, y: 18, w: 28, r: -10, z: 3 }, { x: 84, y: 20, w: 28, r: 10, z: 3 }, { x: 82, y: 58, w: 22, z: 4 }],
    wide: [{ x: 76, y: 78, w: 38, z: 5 }, { x: 70, y: 36, w: 19 }, { x: 52, y: 30, w: 11, r: -10, z: 3 }, { x: 89, y: 28, w: 11, r: 10, z: 3 }, { x: 93, y: 60, w: 8, z: 4 }],
    narrow: [{ x: 50, y: 78, w: 70, z: 5 }, { x: 50, y: 34, w: 32 }, { x: 20, y: 30, w: 21, r: -10, z: 3 }, { x: 80, y: 28, w: 21, r: 10, z: 3 }, { x: 88, y: 60, w: 14, z: 4 }],
  })[variant]!;
  return <Frame id="asena" variant={variant}>
    <AsenaScene parallax={false} className={styles.scene} />
    <At {...p[1]!}><AsenaSymbolArt symbol="wolf" /></At>
    <At {...p[2]!}><AsenaSymbolArt symbol="h3" /></At>
    <At {...p[3]!}><AsenaSymbolArt symbol="moon" /></At>
    <At {...p[4]!}><AsenaSymbolArt symbol="h1" /></At>
    <At {...p[0]!}><AsenaLogo subtitle={false} /></At>
  </Frame>;
}

/** Candy Cascade has no logo component yet: an original two-line candy wordmark (brand name only). */
function CandyWordmark() {
  return <svg viewBox="0 0 520 220" width="100%" role="img" aria-label="Candy Cascade" style={{ display: 'block', overflow: 'visible' }}>
    <defs>
      <linearGradient id="ccFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff2fb" /><stop offset=".45" stopColor="#ff8ccf" /><stop offset="1" stopColor="#d6337f" /></linearGradient>
      <linearGradient id="ccFill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffbe8" /><stop offset=".5" stopColor="#ffd25a" /><stop offset="1" stopColor="#f0862a" /></linearGradient>
      <pattern id="ccStripe" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="26" height="26" fill="transparent" /><rect width="9" height="26" fill="#ffffff" opacity=".28" /></pattern>
      <filter id="ccShadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="7" stdDeviation="5" floodColor="#2a0b3a" floodOpacity=".75" /></filter>
    </defs>
    <g filter="url(#ccShadow)" style={{ fontFamily: "var(--font-barlow-face), Barlow, sans-serif" }} fontWeight="600" textAnchor="middle" strokeLinejoin="round" paintOrder="stroke">
      <text x="260" y="96" fontSize="104" letterSpacing="-2" fill="url(#ccFill)" stroke="#5a1446" strokeWidth="14">Candy</text>
      <text x="260" y="96" fontSize="104" letterSpacing="-2" fill="url(#ccStripe)">Candy</text>
      <text x="260" y="196" fontSize="92" letterSpacing="-1" fill="url(#ccFill2)" stroke="#5a2a0e" strokeWidth="13">Cascade</text>
    </g>
  </svg>;
}
function Cascade({ variant }: { variant: PosterVariant }) {
  const p = L({
    tile: [{ x: 50, y: 80, w: 86, z: 5 }, { x: 50, y: 40, w: 56 }, { x: 18, y: 24, w: 32, r: -12, z: 3 }, { x: 83, y: 20, w: 30, r: 10, z: 3 }, { x: 82, y: 56, w: 26, r: 6, z: 4 }],
  })[variant]!;
  return <Frame id="cascade" variant={variant}>
    <div className={styles.scene}><CascadeBackdrop /></div>
    <At {...p[1]!}><SymbolArt symbol="crown" /></At>
    <At {...p[2]!}><SymbolArt symbol="donut" /></At>
    <At {...p[3]!}><SymbolArt symbol="strawberry" /></At>
    <At {...p[4]!}><SymbolArt symbol="crystal" multiplier={25} /></At>
    <At {...p[0]!}><CandyWordmark /></At>
  </Frame>;
}

/* Crash and Coinflip: original Sollish drawings in the platform palette (KOR orange, AYAZ cyan). No numbers or
   outcomes are drawn: a poster must not look like game data. */
function Wordmark({ text, size = 120 }: { text: string; size?: number }) {
  return <svg viewBox={`0 0 ${text.length * size * 0.62} ${size * 1.1}`} width="100%" role="img" aria-label={text} style={{ display: 'block', overflow: 'visible' }}>
    <text x="50%" y={size * 0.86} textAnchor="middle" style={{ fontFamily: "var(--font-barlow-face), Barlow, sans-serif" }} fontWeight="600" fontSize={size} letterSpacing={-size * 0.03} fill="#f3f5f8">{text}</text>
  </svg>;
}
function CrashArt({ wide }: { wide: boolean }) {
  const w = wide ? 1600 : 720, h = wide ? 900 : 960;
  const end = wide ? [1340, 130] : [640, 120], start = wide ? 180 : -20;
  const path = wide ? `M180 820 C 560 800 820 700 980 540 S 1220 240 1340 130` : `M-20 700 C 200 690 360 610 450 470 S 590 200 640 120`;
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" className={styles.fill} aria-hidden="true">
    <defs>
      <radialGradient id={`crBg${wide}`} cx=".78" cy=".2" r=".9"><stop offset="0" stopColor="#3a1a14" /><stop offset=".45" stopColor="#141019" /><stop offset="1" stopColor="#090b10" /></radialGradient>
      <linearGradient id={`crLine${wide}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#ff6a3d" stopOpacity=".2" /><stop offset=".6" stopColor="#ff6a3d" /><stop offset="1" stopColor="#ffd0a8" /></linearGradient>
      <linearGradient id={`crArea${wide}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6a3d" stopOpacity=".32" /><stop offset="1" stopColor="#ff6a3d" stopOpacity="0" /></linearGradient>
      <filter id={`crGlow${wide}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14" /></filter>
    </defs>
    <rect width={w} height={h} fill={`url(#crBg${wide})`} />
    {Array.from({ length: 12 }, (_, i) => <path key={`v${i}`} d={`M${(i + 1) * (w / 12)} 0V${h}`} stroke="#ffffff" strokeOpacity=".045" />)}
    {Array.from({ length: 8 }, (_, i) => <path key={`h${i}`} d={`M0 ${(i + 1) * (h / 8)}H${w}`} stroke="#ffffff" strokeOpacity=".045" />)}
    <path d={`${path} L ${end[0]} ${h + 40} L ${start} ${h + 40} Z`} fill={`url(#crArea${wide})`} />
    <path d={path} stroke="#ff6a3d" strokeWidth="34" fill="none" opacity=".55" filter={`url(#crGlow${wide})`} />
    <path d={path} stroke={`url(#crLine${wide})`} strokeWidth="12" strokeLinecap="round" fill="none" />
    <g transform={wide ? 'translate(1340 130) rotate(-42)' : 'translate(640 120) rotate(-58)'}>
      <circle r="46" fill="#ff6a3d" opacity=".35" filter={`url(#crGlow${wide})`} />
      <path d="M-30 -18 L 34 0 L -30 18 L -18 0 Z" fill="#fff2e6" />
    </g>
  </svg>;
}
function Crash({ variant }: { variant: PosterVariant }) {
  const wide = variant === 'land' || variant === 'wide';
  return <Frame id="crash" variant={variant}>
    <CrashArt wide={wide} />
    {!wide && <At x={50} y={80} w={82} z={5}><Wordmark text="Crash" /></At>}
  </Frame>;
}
function Coin({ face }: { face: 'heads' | 'tails' }) {
  return <svg viewBox="0 0 200 200" width="100%" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
    <defs>
      <radialGradient id={`cf${face}`} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#ffe3b0" /><stop offset=".45" stopColor="#f0a24c" /><stop offset="1" stopColor="#9a4a1c" /></radialGradient>
      <linearGradient id={`cfe${face}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd59a" /><stop offset="1" stopColor="#6e2f12" /></linearGradient>
    </defs>
    <ellipse cx="100" cy="110" rx="92" ry="92" fill="#3a1a0c" />
    <circle cx="100" cy="100" r="92" fill={`url(#cfe${face})`} />
    <circle cx="100" cy="100" r="80" fill={`url(#cf${face})`} />
    <circle cx="100" cy="100" r="70" fill="none" stroke="#fff2d8" strokeOpacity=".55" strokeWidth="3" strokeDasharray="2 7" />
    {face === 'heads'
      ? <g transform="translate(66 62) scale(2.3)" color="#5a230c"><BrandMark /></g>
      : <text x="100" y="128" textAnchor="middle" fontSize="80" style={{ fontFamily: "var(--font-barlow-face), Barlow, sans-serif" }} fontWeight="600" fill="#5a230c">Ⅱ</text>}
  </svg>;
}
function Coinflip({ variant }: { variant: PosterVariant }) {
  const wide = variant === 'land' || variant === 'wide';
  return <Frame id="coinflip" variant={variant}>
    <svg viewBox="0 0 900 900" preserveAspectRatio="xMidYMid slice" className={styles.fill} aria-hidden="true">
      <defs><radialGradient id={`cfBg${variant}`} cx=".5" cy=".38" r=".75"><stop offset="0" stopColor="#123a46" /><stop offset=".5" stopColor="#0d1824" /><stop offset="1" stopColor="#080b11" /></radialGradient></defs>
      <rect width="900" height="900" fill={`url(#cfBg${variant})`} />
      {[260, 360, 470].map((r, i) => <ellipse key={r} cx="450" cy="380" rx={r} ry={r * 0.62} fill="none" stroke="#6fd6e6" strokeOpacity={0.22 - i * 0.05} strokeWidth="2" transform="rotate(-18 450 380)" />)}
    </svg>
    <At x={wide ? 44 : 38} y={wide ? 54 : 36} w={wide ? 34 : 50} r={-14} z={3}><Coin face="heads" /></At>
    <At x={wide ? 64 : 72} y={wide ? 34 : 22} w={wide ? 20 : 30} r={18} z={2} o={0.9}><Coin face="tails" /></At>
    {!wide && <At x={50} y={80} w={86} z={5}><Wordmark text="Coinflip" /></At>}
  </Frame>;
}

/** Ringside: the project's own arena illustration, cropped per format, with the brand name. */
function Ringside({ variant }: { variant: PosterVariant }) {
  const position = variant === 'tile' ? '64% 50%' : variant === 'narrow' ? '70% 50%' : '70% 40%';
  return <Frame id="ringside" variant={variant}>
    {/* eslint-disable-next-line @next/next/no-img-element -- dev-only composition page */}
    <img src="/images/ringside-hero.jpg" alt="" className={styles.fill} style={{ objectFit: 'cover', objectPosition: position }} />
    {variant === 'tile' && <At x={50} y={86} w={86} z={5}><Wordmark text="Ringside" /></At>}
  </Frame>;
}

const POSTERS: Array<[string, (props: { variant: PosterVariant }) => ReactNode, PosterVariant[]]> = [
  ['tarhun', Tarhun, ['tile', 'wide', 'narrow']],
  ['ebru', Ebru, ['tile', 'wide', 'narrow']],
  ['cezeri', Cezeri, ['tile', 'wide', 'narrow']],
  ['asena', Asena, ['tile', 'wide', 'narrow']],
  ['cascade', Cascade, ['tile']],
  ['crash', Crash, ['tile', 'land']],
  ['coinflip', Coinflip, ['tile', 'land']],
  ['ringside', Ringside, ['tile', 'wide', 'narrow']],
];

export function PosterLab() {
  return <div className={styles.lab}>
    <h1>Lobby posters (development)</h1>
    <p>scripts/lobby-posters.mjs screenshots each frame below into public/images/lobby/*.webp.</p>
    {POSTERS.map(([id, Poster, variants]) => <section key={id}><h2>{id}</h2><div className={styles.row}>{variants.map(v => <Poster key={v} variant={v} />)}</div></section>)}
  </div>;
}
