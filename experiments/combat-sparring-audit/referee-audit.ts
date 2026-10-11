/**
 * Referee audit (engine only, presentation-only official). Plays full 3×45 s bouts on the current engine twice:
 * once as shipped (A) and once with the frozen sparring-4 official swapped into the same engine source (B, see
 * referee-sparring4.ts). Fighters, events and results must be identical between A and B; only state.referee may
 * differ. Measures, every tick, the official's ground-plane clearance to the fighters' pose segments, crossings of
 * the segment between the fighters while fighting, and his per-tick yaw/position/velocity changes.
 *
 *   bash scripts/use-node.sh node --import tsx experiments/combat-sparring-audit/referee-audit.ts <label> [scripted=24] [neuro=6] [firstSeed=1]
 *
 * Scope: deterministic engine rollouts on this machine (fixture/unit level). Not a rendering, GPU or browser measurement.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as Live from "../../packages/protocol/src/combat-sparring";
import { createNeuroMemory, neuroInput } from "../../packages/protocol/src/neuro-boxer";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS } from "../../packages/protocol/src/neuro-boxer-model";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const [label = "run", scriptedArg = "24", neuroArg = "6", firstArg = "1"] = process.argv.slice(2);
const SCRIPTED = Number(scriptedArg), NEURO = Number(neuroArg), FIRST = Number(firstArg);
const BOUT = { durationSeconds: 45, rounds: 3, breakSeconds: 8 } as const, HZ = 60;
type Engine = typeof Live;
type State = Live.SparringState;
type Ref = { x: number; z: number; facing: number };
// SPARRING_SOURCE=<dir> audits a frozen copy of combat-sparring.ts (+ siblings found there) instead of the live file.
const SOURCE = process.env.SPARRING_SOURCE ? resolve(process.env.SPARRING_SOURCE) : resolve(ROOT, "packages/protocol/src");
// A: the engine as shipped (live official). B: the same engine source with the frozen sparring-4 official.
const tmp = mkdtempSync(resolve(ROOT, ".tooling/referee-audit-"));
const build = async (referee: string, file: string) => {
  const source = readFileSync(resolve(SOURCE, "combat-sparring.ts"), "utf8").replace(/from "\.\/([\w-]+)"/g, (_, name: string) => `from ${JSON.stringify(name === "combat-referee" ? referee
    : existsSync(resolve(SOURCE, name + ".ts")) ? resolve(SOURCE, name + ".ts") : resolve(ROOT, "packages/protocol/src", name + ".ts"))}`);
  writeFileSync(resolve(tmp, file), source);
  return await import(pathToFileURL(resolve(tmp, file)).href) as Engine;
};
const A = await build(resolve(ROOT, "packages/protocol/src/combat-referee.ts"), "engine-shipped.ts");
const B = await build(resolve(ROOT, "experiments/combat-sparring-audit/referee-sparring4.ts"), "engine-old-referee.ts");

const STYLES = [["balanced", "pressure"], ["pressure", "counter"], ["counter", "balanced"], ["pressure", "pressure"], ["balanced", "counter"], ["counter", "pressure"]] as const;
type Bout = { seed: number; corners: readonly [string, string] };
const bouts: Bout[] = [
  ...Array.from({ length: SCRIPTED }, (_, i) => ({ seed: FIRST + i, corners: STYLES[i % STYLES.length]! })),
  ...Array.from({ length: NEURO }, (_, i) => ({ seed: 20261003 + i, corners: ["neuro", "neuro"] as const })),
];

const seg2 = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const cross = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
const segmentsIntersect = (p0: Ref, p1: Ref, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const d1 = cross(a.x, a.z, b.x, b.z, p0.x, p0.z), d2 = cross(a.x, a.z, b.x, b.z, p1.x, p1.z);
  const d3 = cross(p0.x, p0.z, p1.x, p1.z, a.x, a.z), d4 = cross(p0.x, p0.z, p1.x, p1.z, b.x, b.z);
  return d1 * d2 < 0 && d3 * d4 < 0;
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const down = (f: Live.SparringFighter) => f.action === "knockdown" || f.action === "getup";
const SEGMENTS = [["pelvis", "head"], ["pelvis", "leftHand"], ["pelvis", "rightHand"], ["pelvis", "leftKnee"], ["pelvis", "rightKnee"]] as const;
const withoutReferee = (s: State) => JSON.stringify({ ...s, referee: null });

type Metrics = { ticks: number; fightTicks: number; minStanding: number; standingUnder055: number; minLying: number; lyingUnder060: number; lyingTicks: number; crossings: number;
  maxYaw: number; maxStep: number; maxDv: number; maxDspeed: number; maxBox: number; occluded: number; cameraSide: number; meanRadius: number; maxRadius: number; worstStanding: unknown; worstLying: unknown };
const fresh = (): Metrics => ({ ticks: 0, fightTicks: 0, minStanding: Infinity, standingUnder055: 0, minLying: Infinity, lyingUnder060: 0, lyingTicks: 0, crossings: 0, maxYaw: 0, maxStep: 0, maxDv: 0, maxDspeed: 0, maxBox: 0, occluded: 0, cameraSide: 0, meanRadius: 0, maxRadius: 0, worstStanding: null, worstLying: null });

function measure(engine: Engine, s: State, previous: State, m: Metrics, lastV: { x: number; z: number } | null) {
  const r = s.referee as Ref, p = previous.referee as Ref;
  m.ticks++;
  for (const f of s.fighters) {
    if (down(f)) {
      const ux = Math.sin(f.facing), uz = Math.cos(f.facing), d = seg2(r.x, r.z, f.x - ux * 1.85, f.z - uz * 1.85, f.x + ux * .15, f.z + uz * .15);
      m.lyingTicks++; if (d < .6) m.lyingUnder060++;
      if (d < m.minLying) { m.minLying = d; m.worstLying = { seed: s.seed, tick: s.tick, phase: s.phase, fighter: f.id }; }
    } else {
      const pose = engine.sparringPose(f, s.tick);
      const d = Math.min(...SEGMENTS.map(([a, b]) => seg2(r.x, r.z, pose[a].x, pose[a].z, pose[b].x, pose[b].z)));
      if (d < .55) m.standingUnder055++;
      if (d < m.minStanding) { m.minStanding = d; m.worstStanding = { seed: s.seed, tick: s.tick, phase: s.phase, fighter: f.id, action: f.action }; }
    }
  }
  const step = Math.hypot(r.x - p.x, r.z - p.z), v = { x: (r.x - p.x) * HZ, z: (r.z - p.z) * HZ };
  m.maxStep = Math.max(m.maxStep, step); m.maxYaw = Math.max(m.maxYaw, Math.abs(wrap(r.facing - p.facing)));
  if (lastV) { m.maxDv = Math.max(m.maxDv, Math.hypot(v.x - lastV.x, v.z - lastV.z)); m.maxDspeed = Math.max(m.maxDspeed, Math.abs(Math.hypot(v.x, v.z) - Math.hypot(lastV.x, lastV.z))); }
  m.maxBox = Math.max(m.maxBox, Math.abs(r.x), Math.abs(r.z));
  const [a, b] = s.fighters;
  if (s.phase === "fight" && previous.phase === "fight") {
    m.fightTicks++;
    const [pa, pb] = previous.fighters, t = ((r.x - a.x) * (b.x - a.x) + (r.z - a.z) * (b.z - a.z)) / Math.max(1e-9, (b.x - a.x) ** 2 + (b.z - a.z) ** 2);
    const flipped = Math.sign(cross(pa.x, pa.z, pb.x, pb.z, p.x, p.z)) * Math.sign(cross(a.x, a.z, b.x, b.z, r.x, r.z)) < 0 && t >= 0 && t <= 1;
    if (flipped || segmentsIntersect(p, r, a, b)) m.crossings++;
    // Broadcast proxy: camera ~3.4 m in +z from the fighters' midpoint (boxing-sparring-scene.tsx 'broadcast').
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, cx = mx + .25, cz = mz + 3.4, bearing = (x: number, z: number) => Math.atan2(x - cx, cz - z);
    const radius = Math.hypot(r.x - mx, r.z - mz); m.meanRadius += radius; m.maxRadius = Math.max(m.maxRadius, radius);
    if (s.fighters.some(f => cz - f.z < cz - r.z && Math.abs(wrap(bearing(r.x, r.z) - bearing(f.x, f.z))) < Math.atan(.3 / Math.max(.5, cz - f.z)))) m.occluded++;
    if (cz - r.z < Math.min(cz - a.z, cz - b.z) - .2) m.cameraSide++;
  }
  return v;
}

type Controller = (s: State, side: 0 | 1) => Live.SparringInput;
function controllers(engine: Engine, bout: Bout): [Controller, Controller] {
  return bout.corners.map(style => {
    if (style !== "neuro") return (s: State, side: 0 | 1) => engine.sparringBotInput(s, side, style as "balanced");
    const memory = createNeuroMemory();
    return (s: State, side: 0 | 1) => neuroInput(s as never, side, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, memory, { temperature: .8 });
  }) as [Controller, Controller];
}

const summary: Record<string, unknown>[] = [], totals = { A: fresh(), B: fresh() };
let mismatches = 0, knockdowns: { seed: number; tick: number; corners: string }[] = [];
const merge = (into: Metrics, m: Metrics) => {
  for (const key of ["ticks", "fightTicks", "standingUnder055", "lyingUnder060", "lyingTicks", "crossings", "occluded", "cameraSide", "meanRadius"] as const) into[key] += m[key];
  for (const key of ["maxYaw", "maxStep", "maxDv", "maxDspeed", "maxBox", "maxRadius"] as const) into[key] = Math.max(into[key], m[key]);
  if (m.minStanding < into.minStanding) { into.minStanding = m.minStanding; into.worstStanding = m.worstStanding; }
  if (m.minLying < into.minLying) { into.minLying = m.minLying; into.worstLying = m.worstLying; }
};
const started = Date.now();
for (const bout of bouts) {
  let a = A.createSparring(bout.seed, BOUT), b = B.createSparring(bout.seed, BOUT);
  const [ca0, ca1] = controllers(A, bout), [cb0, cb1] = controllers(B, bout);
  const ma = fresh(), mb = fresh(); let va: { x: number; z: number } | null = null, vb: { x: number; z: number } | null = null, firstMismatch: number | null = null;
  while (!a.finished || !b.finished) {
    const na = a.finished ? a : A.stepSparring(a, [ca0(a, 0), ca1(a, 1)]), nb = b.finished ? b : B.stepSparring(b as never, [cb0(b, 0), cb1(b, 1)]) as State;
    if (!a.finished) va = measure(A, na, a, ma, va);
    if (!b.finished) vb = measure(B, nb, b, mb, vb);
    if (firstMismatch === null && withoutReferee(na) !== withoutReferee({ ...nb, version: na.version } as State)) firstMismatch = na.tick;
    for (const event of na.events) if (event.type === "knockdown" && bout.corners[0] === "neuro") knockdowns.push({ seed: bout.seed, tick: event.tick, corners: bout.corners.join("/") });
    a = na; b = nb;
  }
  if (firstMismatch !== null) mismatches++;
  merge(totals.A, ma); merge(totals.B, mb);
  summary.push({ seed: bout.seed, corners: bout.corners.join("/"), winner: a.winner, method: a.method, ticks: a.tick, resultsIdentical: firstMismatch === null, firstMismatch,
    A: { minStanding: +ma.minStanding.toFixed(3), minLying: Number.isFinite(ma.minLying) ? +ma.minLying.toFixed(3) : null, crossings: ma.crossings, maxYaw: +ma.maxYaw.toFixed(4), maxStep: +ma.maxStep.toFixed(4), maxDv: +ma.maxDv.toFixed(4) },
    B: { minStanding: +mb.minStanding.toFixed(3), minLying: Number.isFinite(mb.minLying) ? +mb.minLying.toFixed(3) : null, crossings: mb.crossings, maxYaw: +mb.maxYaw.toFixed(4), maxStep: +mb.maxStep.toFixed(4), maxDv: +mb.maxDv.toFixed(4) } });
}
// Replay identity of the shipped engine: two independent rollouts hash identically (referee included).
const replay = bouts.slice(0, 4).map(bout => {
  const run = () => { let s = A.createSparring(bout.seed, BOUT); const [c0, c1] = controllers(A, bout); while (!s.finished) s = A.stepSparring(s, [c0(s, 0), c1(s, 1)]); return createHash("sha256").update(JSON.stringify(s)).digest("hex"); };
  const first = run(), second = run(); return { seed: bout.seed, identical: first === second, sha256: first.slice(0, 16) };
});
rmSync(tmp, { recursive: true, force: true });
const round = (m: Metrics) => ({ ticks: m.ticks, fightTicks: m.fightTicks, minStandingClearanceM: +m.minStanding.toFixed(4), ticksStandingUnder055: m.standingUnder055,
  minLyingClearanceM: Number.isFinite(m.minLying) ? +m.minLying.toFixed(4) : null, ticksLyingUnder060: m.lyingUnder060, lyingTicks: m.lyingTicks, crossingsWhileFighting: m.crossings,
  maxYawRadPerTick: +m.maxYaw.toFixed(4), maxStepMPerTick: +m.maxStep.toFixed(4), maxVelocityChangeMPerSPerTick: +m.maxDv.toFixed(4), maxSpeedChangeMPerSPerTick: +m.maxDspeed.toFixed(4), maxAbsCoordinateM: +m.maxBox.toFixed(3),
  broadcastOccludedShare: +(m.occluded / Math.max(1, m.fightTicks)).toFixed(4), cameraSideShare: +(m.cameraSide / Math.max(1, m.fightTicks)).toFixed(4),
  meanRadiusFromFightersMidpointM: +(m.meanRadius / Math.max(1, m.fightTicks)).toFixed(3), maxRadiusM: +m.maxRadius.toFixed(3), worstStanding: m.worstStanding, worstLying: m.worstLying });
const report = {
  schema: "sollish.referee-audit.v1", label, at: new Date().toISOString(), engineVersion: A.SPARRING_VERSION,
  engineSource: SOURCE, engineSha256: createHash("sha256").update(readFileSync(resolve(SOURCE, "combat-sparring.ts"))).digest("hex"),
  refereeSha256: createHash("sha256").update(readFileSync(resolve(ROOT, "packages/protocol/src/combat-referee.ts"))).digest("hex"),
  scope: "Deterministic engine rollouts (fixture level) on this machine; ground-plane (x,z) distances from the referee root to sparringPose segments pelvis→head/hands/knees and to the lying segment [root-1.85u, root+0.15u]. Not a rendering, GPU or browser measurement.",
  acceptance: { standingClearanceM: .55, lyingClearanceM: .6, crossings: 0, maxYawRadPerTick: .05, maxStepMPerTick: .025, maxSpeedChangeMPerSPerTick: 4 / 60 },
  bouts: bouts.length, boutShape: BOUT, scriptedPairs: STYLES, neuroBouts: NEURO, resultMismatchBouts: mismatches,
  shipped: round(totals.A), oldOfficialSameEngine: round(totals.B), replay, neuroKnockdowns: knockdowns.slice(0, 40), elapsedS: (Date.now() - started) / 1000, perBout: summary,
};
const out = resolve(ROOT, "experiments/combat-sparring-audit/evidence", `referee-${label}.json`);
writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ out, mismatches, shipped: round(totals.A), old: round(totals.B), replay, elapsedS: report.elapsedS }, (k, v) => k === "worstStanding" || k === "worstLying" ? JSON.stringify(v) : v));
