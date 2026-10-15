'use client';
import { memo } from 'react';
import { type AsenaTemplateId } from '@sollish/protocol';
import { asenaTemplateGlyph } from './geometry';
import { asSparkle } from './symbols';

/** A constellation template as a small star chart (engine cells, authored stroke graph), for the info pages and the
 * feature screens. `transform` is ignored: the untransformed shape (transform 0) is the one the rules describe. */
export const AsenaTemplateGlyph = memo(function AsenaTemplateGlyph({ id, className, lit = true }: { id: AsenaTemplateId; className?: string; lit?: boolean }) {
  const g = asenaTemplateGlyph(id);
  const span = Math.max(g.width, g.height), cell = 56 / span;
  const ox = 32 - (g.width * cell) / 2, oy = 32 - (g.height * cell) / 2;
  const at = ([x, y]: readonly [number, number]) => [ox + (x + 0.5) * cell, oy + (y + 0.5) * cell] as const;
  const lines = g.edges.map(([a, b]) => { const p = at(g.cells[a]!), q = at(g.cells[b]!); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }).join('');
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d={lines} fill="none" stroke={lit ? '#cfe8ff' : 'rgba(150,170,230,.45)'} strokeWidth="2" strokeLinecap="round" strokeDasharray={lit ? undefined : '2 3'} />
      {g.cells.map((c, i) => { const [x, y] = at(c); return <path key={i} d={asSparkle(x, y, i === g.edges[0]![0] ? 6.6 : 4.8, 0.22)} fill={lit ? (i === g.edges[0]![0] ? '#ffe7a0' : '#ffffff') : '#5a6aa4'} />; })}
    </svg>
  );
});
