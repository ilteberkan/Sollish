/** Damla pool colours (pure; shared by the board, the verify figure and the info pages). */
/** Pool colour by distance from the centre (0 centre … 1 edge): aqua → turquoise → jade → amber → coral → gold. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0, [64, 128, 140]], [0.25, [38, 178, 190]], [0.5, [72, 196, 150]], [0.7, [226, 190, 84]], [0.86, [240, 128, 72]], [1, [255, 92, 112]],
];
export function poolColor(d: number, goldEdge: boolean): string {
  if (goldEdge && d >= 0.999) return 'rgb(255, 205, 70)';
  for (let i = 1; i < RAMP.length; i++) {
    const [b, cb] = RAMP[i]!, [a, ca] = RAMP[i - 1]!;
    if (d <= b) { const t = (d - a) / (b - a); return `rgb(${ca.map((c, j) => Math.round(c + (cb[j]! - c) * t)).join(', ')})`; }
  }
  return 'rgb(255, 92, 112)';
}
