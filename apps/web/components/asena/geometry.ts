/* Asena: Yıldız Kurdu — shared board geometry and the constellation stroke plan.

   Board units: the 6 × 6 star field is 600 × 600 units, one cell = 100 units, cell (col, row) has its centre at
   (col·100 + 50, row·100 + 50), row 0 on top (same orientation as the engine grid[col][row]).

   Constellation plan: every template has an authored stroke graph (edges between its cells, listed from a root
   node outward). The plan maps those edges through the ignition's transform and origin onto board cells and
   times them: an edge starts when its `from` node is lit and takes time proportional to its length, so a tree
   grows from its root and parallel branches draw together. The board (DOM links), the FX canvas (tracer, nodes,
   sky echo) and the sound layer all read the same plan, so they stay in sync. Presentation only. */

import { ASENA_COLS, ASENA_ROWS, ASENA_TEMPLATES, type AsenaTemplateId } from '@sollish/protocol';

export const AS_UNITS = 600;
export const AS_CELL = 100;
export type AsPos = readonly [col: number, row: number];
export interface AsPoint { x: number; y: number }

export const asCellCenter = (col: number, row: number): AsPoint => ({ x: col * AS_CELL + AS_CELL / 2, y: row * AS_CELL + AS_CELL / 2 });
export const asKey = (col: number, row: number) => col * ASENA_ROWS + row;
export const asInBoard = (col: number, row: number) => col >= 0 && col < ASENA_COLS && row >= 0 && row < ASENA_ROWS;

/** Stroke graph per template: [from, to] indices into ASENA_TEMPLATES[i].cells, root first, listed so every `from` is lit before. */
export const ASENA_TEMPLATE_EDGES: Readonly<Record<AsenaTemplateId, readonly (readonly [number, number])[]>> = {
  // nose → muzzle → cheeks → ear tips → ears close on the brow (a wolf head with pointed ears)
  'kurt-basi': [[6, 5], [5, 2], [5, 4], [2, 0], [4, 1], [0, 3], [1, 3]],
  // grip → both limbs → tips → the bowstring snaps across
  yay: [[2, 3], [2, 1], [3, 4], [1, 0], [4, 5], [0, 5]],
  // muzzle → poll → neck → withers → back
  at: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
  // body → both wings at once → wing tips
  kartal: [[4, 3], [4, 5], [3, 2], [5, 6], [2, 0], [6, 1]],
  // root → trunk → branches → crown closes
  'hayat-agaci': [[6, 5], [5, 4], [4, 2], [2, 1], [2, 3], [2, 0], [1, 0], [3, 0]],
  // the crescent opens from its middle
  hilal: [[2, 0], [2, 3], [0, 1], [3, 4]],
};

/** Turkish display names (same as the engine) and short sky-map labels. */
export const ASENA_TEMPLATE_INFO: Readonly<Record<AsenaTemplateId, { name: string; short: string }>> = {
  'kurt-basi': { name: 'Kurt Başı', short: 'Kurt' },
  yay: { name: 'Yay', short: 'Yay' },
  at: { name: 'At', short: 'At' },
  kartal: { name: 'Kartal', short: 'Kartal' },
  'hayat-agaci': { name: 'Hayat Ağacı', short: 'Ağaç' },
  hilal: { name: 'Hilal', short: 'Hilal' },
};

/** Same symmetry as the engine (mirror if t & 1, then (t >> 1) quarter turns clockwise, normalised to [0,0]) but keeps the
 * cell order, so authored edges stay attached to the right cells. */
export function asenaTransformKeepOrder(cells: readonly (readonly [number, number])[], transform: number): [number, number][] {
  let out = cells.map(([x, y]): [number, number] => [transform & 1 ? -x : x, y]);
  for (let k = (transform >> 1) & 3; k > 0; k--) out = out.map(([x, y]): [number, number] => [-y, x]);
  const minX = Math.min(...out.map(([x]) => x)), minY = Math.min(...out.map(([, y]) => y));
  return out.map(([x, y]): [number, number] => [x - minX, y - minY]);
}

export interface AsenaPlanEdge { a: AsPos; b: AsPos; /** ms from the start of the trace */ start: number; dur: number }
export interface AsenaConstellationPlan {
  templateId: AsenaTemplateId; templateIndex: number; multiplier: number; name: string;
  /** Board cells in template cell order. */
  nodes: AsPos[];
  /** When each node lights (ms), same order as nodes. */
  nodeAt: number[];
  edges: AsenaPlanEdge[];
  /** ms until the last edge is complete. */
  duration: number;
  /** Centre of the template's bounding box, board units. */
  center: AsPoint;
  /** Bounding box in cells (after transform). */
  width: number; height: number;
}
export interface AsenaIgnitionLike { templateId: AsenaTemplateId; transform: number; origin: readonly [number, number] }

/** Builds the timed stroke plan of one ignition (engine AsenaIgnition or a hand-made one). */
export function asenaConstellationPlan(ig: AsenaIgnitionLike, durationMs = 1400): AsenaConstellationPlan {
  const templateIndex = ASENA_TEMPLATES.findIndex((t) => t.id === ig.templateId);
  const t = ASENA_TEMPLATES[templateIndex];
  if (!t) throw new RangeError(`unknown template ${ig.templateId}`);
  const local = asenaTransformKeepOrder(t.cells, ig.transform);
  const nodes: AsPos[] = local.map(([x, y]) => [ig.origin[0] + x, ig.origin[1] + y] as const);
  const lit = new Array<number>(nodes.length).fill(Infinity);
  const edgesRaw = ASENA_TEMPLATE_EDGES[ig.templateId];
  lit[edgesRaw[0]![0]] = 0;
  const raw: Array<{ a: number; b: number; s: number; d: number }> = [];
  for (const [a, b] of edgesRaw) {
    const pa = nodes[a]!, pb = nodes[b]!;
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const s = Number.isFinite(lit[a]!) ? lit[a]! : 0;
    raw.push({ a, b, s, d: len });
    lit[b] = Math.min(lit[b]!, s + len);
  }
  const end = Math.max(...raw.map((e) => e.s + e.d));
  const unit = durationMs / Math.max(1e-6, end);
  const w = Math.max(...local.map(([x]) => x)) + 1, h = Math.max(...local.map(([, y]) => y)) + 1;
  return {
    templateId: t.id, templateIndex, multiplier: t.multiplier, name: t.name,
    nodes,
    nodeAt: lit.map((v) => (Number.isFinite(v) ? v * unit : 0)),
    edges: raw.map((e) => ({ a: nodes[e.a]!, b: nodes[e.b]!, start: e.s * unit, dur: e.d * unit })),
    duration: durationMs,
    center: { x: (ig.origin[0] + w / 2) * AS_CELL, y: (ig.origin[1] + h / 2) * AS_CELL },
    width: w, height: h,
  };
}

/** The untransformed glyph of a template for the sky map (cells + edges in template space). */
export function asenaTemplateGlyph(id: AsenaTemplateId) {
  const t = ASENA_TEMPLATES.find((x) => x.id === id)!;
  return { cells: t.cells, edges: ASENA_TEMPLATE_EDGES[id], width: t.width, height: t.height, multiplier: t.multiplier };
}

/** Does the plan cover exactly these positions? (lab self-check against the engine's ignition.positions) */
export function asenaPlanMatches(plan: AsenaConstellationPlan, positions: readonly (readonly [number, number])[]) {
  const a = new Set(plan.nodes.map(([c, r]) => asKey(c, r))), b = new Set(positions.map(([c, r]) => asKey(c, r)));
  return a.size === b.size && [...a].every((k) => b.has(k));
}
