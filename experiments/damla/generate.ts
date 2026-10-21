/** Paytable generator for Damla `damla-terraces-1` (original formula, see the doc comment of packages/protocol/src/damla.ts).
 * Run: bash scripts/use-node.sh node --import tsx experiments/damla/generate.ts
 * For every (risk, rows): d = |k - R/2| / (R/2) in [0,1]; raw(k) = C + (E - C) * d^p (hundredths of the bet), with the centre
 * floor C and the edge E fixed per risk / rows and the exponent p solved by bisection so that the exact RTP is 98.5%. Then every
 * pool is rounded to a whole hundredth and the innermost four rings are nudged by +-1 hundredth (monotone, centre floor kept)
 * until the exact RTP is as close to 98.5% as integers allow. */
const RISKS = ["low", "medium", "high"] as const;
const ROWS = [8, 10, 12, 14, 16] as const;
const CENTRE_FLOOR = { low: 50, medium: 30, high: 20 } as const; // hundredths of the bet at k = R/2
const EDGE: Record<(typeof RISKS)[number], readonly number[]> = {
  low: [560, 800, 1000, 1300, 1600], medium: [1300, 2200, 3300, 5500, 11_000], high: [2600, 6000, 14_000, 36_000, 100_000],
};
const TARGET = 0.985;
const choose = (n: number, k: number): bigint => { let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i); return r; };
const rtpOf = (rows: number, table: readonly number[]): number => {
  let num = 0n; for (let k = 0; k <= rows; k++) num += choose(rows, k) * BigInt(table[k]!);
  return Number(num * 10_000_000n / (100n * (1n << BigInt(rows)))) / 10_000_000;
};
const build = (risk: (typeof RISKS)[number], rows: number, e: number, p: number): number[] => {
  const c = CENTRE_FLOOR[risk], half = rows / 2;
  const out = Array.from({ length: rows + 1 }, (_, k) => Math.round(c + (e - c) * Math.pow(Math.abs(k - half) / half, p)));
  return out;
};
const pools: Record<string, number[]> = {};
for (const risk of RISKS) ROWS.forEach((rows, i) => {
  const e = EDGE[risk][i]!;
  let lo = 0.05, hi = 40;
  for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; (rtpOf(rows, build(risk, rows, e, mid)) > TARGET ? lo = mid : hi = mid); }
  const half = rows / 2, t = build(risk, rows, e, (lo + hi) / 2);
  for (let guard = 0; guard < 200; guard++) {
    const cur = Math.abs(rtpOf(rows, t) - TARGET);
    let best: [number, number] | null = null, bestErr = cur;
    for (let ring = 0; ring < 4; ring++) for (const step of [-1, 1]) {
      const k = half + ring, v = t[k]! + step;
      if (ring === 0 && v < CENTRE_FLOOR[risk]) continue;
      if (v < (t[k - 1] ?? -Infinity) && ring > 0 || v > (t[k + 1] ?? Infinity)) continue; // non-decreasing outward
      t[k] = v; t[rows - k] = v;
      const err = Math.abs(rtpOf(rows, t) - TARGET);
      t[k] = v - step; t[rows - k] = v - step;
      if (err < bestErr) { bestErr = err; best = [k, v]; }
    }
    if (!best) break;
    t[best[0]] = best[1]; t[rows - best[0]] = best[1];
  }
  pools[`${risk}-${rows}`] = t;
});
for (const [mode, t] of Object.entries(pools)) console.log(`  "${mode}": [${t.join(", ")}],`);
