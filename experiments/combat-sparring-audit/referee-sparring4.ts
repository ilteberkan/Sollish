/**
 * Frozen sparring-4 referee steering for the referee audit: stepSparringReferee copied verbatim from the
 * coordinator's extraction (packages/protocol/src/combat-referee.ts SHA256 c4b63591…ee00), plus the
 * createSparringReferee initial state. Used to rebuild "the current engine with the old official" and
 * to measure the old behaviour; never imported by the product.
 */
type View = { x: number; z: number };
type World = { phase: string; countFighter: 0 | 1 | null; fighters: readonly [View, View] };
export type SparringReferee = { x: number; z: number; facing: number; vx: number; vz: number };
const HZ = 60;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const createSparringReferee = (): SparringReferee => ({ x: 0, z: -1.6, facing: 0, vx: 0, vz: 0 });
export function stepSparringReferee(previous: Readonly<SparringReferee>, world: World): SparringReferee {
  const r = { ...previous }, [a, b] = world.fighters, x0 = r.x, z0 = r.z;
  let tx: number, tz: number, fx: number, fz: number;
  if (world.phase === "count" && world.countFighter !== null) {
    const down = world.fighters[world.countFighter], up = world.fighters[world.countFighter === 0 ? 1 : 0];
    const dx = up.x - down.x, dz = up.z - down.z, d = Math.max(.01, Math.hypot(dx, dz));
    tx = down.x + dx / d * 1.0; tz = down.z + dz / d * 1.0; fx = down.x; fz = down.z;
  } else if (world.phase === "break") { tx = 0; tz = 0; fx = 0; fz = 1; }
  else {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ax = b.x - a.x, az = b.z - a.z, d = Math.max(.01, Math.hypot(ax, az));
    // Stand on the far side of the fighters (away from the broadcast side, +z) so the official never blocks the main view.
    let px = -az / d, pz = ax / d; if (pz > 0 || (Math.abs(pz) < .2 && (r.x - mx) * px < 0)) { px = -px; pz = -pz; }
    tx = mx + px * 1.7; tz = mz + pz * 1.7; fx = mx; fz = mz;
  }
  tx = clamp(tx, -2.95, 2.95); tz = clamp(tz, -2.95, 2.95);
  const dx = tx - r.x, dz = tz - r.z, dd = Math.hypot(dx, dz), step = Math.min(dd, 1.7 / HZ);
  if (dd > 1e-6) { r.x += dx / dd * step; r.z += dz / dd * step; }
  // Keep clear of both fighters; only the referee moves.
  for (const f of world.fighters) { const ex = r.x - f.x, ez = r.z - f.z, e = Math.hypot(ex, ez); if (e < .9) { const k = e > 1e-6 ? .9 / e : 0; r.x = f.x + (k ? ex * k : .9); r.z = f.z + (k ? ez * k : 0); } }
  r.x = clamp(r.x, -3.0, 3.0); r.z = clamp(r.z, -3.0, 3.0);
  r.facing = Math.atan2(fx - r.x, fz - r.z); r.vx = (r.x - x0) * HZ; r.vz = (r.z - z0) * HZ;
  return r;
}
