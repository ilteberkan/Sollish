'use client';
import { DAMLA_PAYTABLES, type DamlaMode, type DamlaRound } from '@sollish/protocol';
import { damlaMultiplierText } from '@/lib/damla-controls';
import { damlaLatticeXs } from '@/lib/damla-timeline';
import type { Locale } from '@/lib/i18n/config';
import { poolColor } from './colors';

/**
 * A Damla round as a static figure (for /verify and /replay): the terrace basins, the drop's path over them (L/R per
 * terrace, exactly round.path) and the pool row with the winning pool marked. `upTo` reveals the path terrace by terrace
 * (replay player). Accessible as one image with the path written out.
 */
export function DamlaPathFigure({ round, locale, label, upTo }: { round: Pick<DamlaRound, 'path' | 'rows' | 'slot' | 'mode' | 'risk'>; locale: Locale; label: string; upTo?: number }) {
  const rows = round.rows, pools = DAMLA_PAYTABLES[round.mode as DamlaMode];
  const W = 340, top = 16, dx = W / (rows + 2), dy = Math.min(22, 230 / rows), cx = W / 2, poolY = top + rows * dy + 14, H = poolY + 26;
  const xs = damlaLatticeXs(round);
  const shown = Math.max(0, Math.min(rows, upTo ?? rows));
  const pt = (i: number) => [cx + xs[i]! * dx, i >= rows ? poolY : top + i * dy] as const;
  const d = Array.from({ length: shown + 1 }, (_, i) => pt(i)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 520, height: 'auto', display: 'block' }} data-testid="damla-path-figure">
      <rect x="0" y="0" width={W} height={H} rx="10" fill="#0e2e3c" />
      {Array.from({ length: rows }, (_, i) => (
        <g key={i}>
          <rect x={cx - (i / 2 + 0.6) * dx} y={top + i * dy - 3} width={(i + 1.2) * dx} height={6} rx="3" fill="#efe9dd" opacity=".9" />
          {Array.from({ length: i + 1 }, (_, b) => <ellipse key={b} cx={cx + (b - i / 2) * dx} cy={top + i * dy} rx={dx * 0.3} ry="2.4" fill="#3fd0d4" />)}
        </g>
      ))}
      {pools.map((h, k) => {
        const dd = Math.abs(k - rows / 2) / (rows / 2), hit = shown >= rows && k === round.slot;
        return (
          <g key={k}>
            <rect x={cx + (k - rows / 2) * dx - dx * 0.46} y={poolY - 9} width={dx * 0.92} height={20} rx="4" fill={poolColor(dd, round.risk === 'high')} opacity={hit ? 1 : 0.55} stroke={hit ? '#fff' : 'none'} strokeWidth="2" />
            <text x={cx + (k - rows / 2) * dx} y={poolY + 5} textAnchor="middle" fontSize={Math.min(9, dx * 0.42)} fontWeight="700" fill="#06202a">{damlaMultiplierText(h, locale)}</text>
          </g>
        );
      })}
      <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {Array.from({ length: shown }, (_, i) => { const [x, y] = pt(i); return <circle key={i} cx={x} cy={y} r="2.6" fill="#ffffff" />; })}
      {(() => { const [x, y] = pt(shown); return <circle cx={x} cy={y - 3} r="4.5" fill="#c9fbff" stroke="#fff" strokeWidth="1.5" />; })()}
    </svg>
  );
}
