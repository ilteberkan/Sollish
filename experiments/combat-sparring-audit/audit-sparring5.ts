/**
 * Reproducible mechanics audit for the non-monetary Combat Club engine.
 * Runs real fixed-step rollouts of a chosen engine module against scripted
 * probe strategies. Probes are deliberately simple exploit attempts, not
 * learned agents. Output is JSON so baseline and candidate runs can be diffed.
 *
 *   node --import tsx experiments/combat-sparring-audit/audit-sparring5.ts sparring4|candidate [seeds] [firstSeed]
 * Copy of audit.ts (unchanged probes and metrics) that can also run the frozen sparring-4 engine.
 */
import * as baseline from "./baseline-sparring-1";
import * as candidate from "../../packages/protocol/src/combat-sparring";
import * as sparring2 from "./baseline-sparring-2";
import * as sparring4 from "./baseline-sparring-4";

type Engine = typeof baseline;
type State = ReturnType<Engine["createSparring"]>;
type Input = Parameters<Engine["stepSparring"]>[1][0];
type Side = 0 | 1;
type Policy = (engine: Engine, s: State, side: Side) => Input;

const neutral = (): Input => ({ moveX: 0, moveZ: 0, guard: false, action: null });
const rel = (s: State, side: Side) => {
  const me = s.fighters[side], other = s.fighters[side === 0 ? 1 : 0];
  const d = Math.max(.01, Math.hypot(other.x - me.x, other.z - me.z));
  return { me, other, d, dx: (other.x - me.x) / d, dz: (other.z - me.z) / d };
};
const busy = (s: State, side: Side) => s.tick < s.fighters[side].actionUntil;

/** Back away and circle off the ropes; never attacks. Tests "win by running". */
const runner: Policy = (_e, s, side) => {
  const { me, dx, dz } = rel(s, side), i = neutral();
  // Away from opponent, plus a tangent toward the ring centre so it never parks in a corner.
  let mx = -dx + -dz * .9, mz = -dz + dx * .9;
  mx += -me.x * .35; mz += -me.z * .35;
  const l = Math.max(1, Math.hypot(mx, mz)); i.moveX = mx / l; i.moveZ = mz / l;
  return i;
};
/** Fight with the balanced bot until ahead on health, then run for the clock. */
const hitAndRun: Policy = (e, s, side) => {
  const me = s.fighters[side], other = s.fighters[side === 0 ? 1 : 0];
  return me.health > other.health + 40 ? runner(e, s, side) : e.sparringBotInput(s, side, "balanced");
};
/** Approach, then throw roundhouse at every legal opportunity. Tests kick dominance. */
const kickSpam: Policy = (_e, s, side) => {
  const { d, dx, dz } = rel(s, side), i = neutral();
  if (busy(s, side)) return i;
  if (d > 1.15) { i.moveX = dx; i.moveZ = dz; return i; }
  i.action = "roundhouse"; return i;
};
const jabSpam: Policy = (_e, s, side) => {
  const { d, dx, dz } = rel(s, side), i = neutral();
  if (busy(s, side)) return i;
  if (d > .95) { i.moveX = dx; i.moveZ = dz; return i; }
  i.action = "jab"; return i;
};
const bot = (style: "balanced" | "pressure" | "counter"): Policy => (e, s, side) => e.sparringBotInput(s, side, style);

const POLICIES: Record<string, Policy> = {
  balanced: bot("balanced"), pressure: bot("pressure"), counter: bot("counter"),
  runner, hitAndRun, kickSpam, jabSpam,
};

const ZONES = [["head", .16], ["chest", .24]] as const;
const LIMB_RADIUS = { leftHand: .095, rightHand: .095, rightFoot: .12 } as const;

function rollout(e: Engine, seed: number, a: Policy, b: Policy, seconds = 90) {
  let s = e.createSparring(seed, { durationSeconds: seconds });
  const hitsBy: Record<string, number>[] = [{}, {}];
  let penetrationMax = 0; const penetrations: number[] = [];
  let lastContact = 0, longestGap = 0, farTicks = 0, ticks = 0, lowStamina = 0;
  while (!s.finished) {
    s = e.stepSparring(s, [a(e, s, 0), b(e, s, 1)]);
    ticks++;
    const [f0, f1] = s.fighters;
    if (Math.hypot(f0.x - f1.x, f0.z - f1.z) > 1.4) farTicks++;
    lowStamina += (f0.stamina < 180 ? 1 : 0) + (f1.stamina < 180 ? 1 : 0);
    for (const ev of s.events) {
      if (ev.type === "hit" || ev.type === "block") { longestGap = Math.max(longestGap, s.tick - lastContact); lastContact = s.tick; }
      if (ev.type === "hit" && ev.attack) hitsBy[ev.actor]![ev.attack] = (hitsBy[ev.actor]![ev.attack] ?? 0) + 1;
    }
    // Authoritative limb depth inside the opponent's declared hurt volumes, every tick.
    for (const side of [0, 1] as const) {
      const f = s.fighters[side], target = s.fighters[side === 0 ? 1 : 0];
      const pose = e.sparringPose(f, s.tick);
      if (!pose.striking) continue;
      const tp = e.sparringPose(target, s.tick), limb = pose[pose.striking];
      for (const [zone, r] of ZONES) {
        const c = tp[zone], depth = r + LIMB_RADIUS[pose.striking] - Math.hypot(limb.x - c.x, limb.y - c.y, limb.z - c.z);
        if (depth > 0) { penetrations.push(depth); penetrationMax = Math.max(penetrationMax, depth); }
      }
    }
  }
  longestGap = Math.max(longestGap, s.tick - lastContact);
  return { winner: s.winner, ko: s.fighters.some(f => f.health === 0), health: s.fighters.map(f => f.health), hitsBy, penetrationMax, penetrations, longestGapS: longestGap / e.SPARRING_HZ, farShare: farTicks / ticks, durationS: ticks / e.SPARRING_HZ, lowStaminaShare: lowStamina / (2 * ticks) };
}

const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const v = [...xs].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(q * v.length))]!; };
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function matchup(e: Engine, aName: string, bName: string, seeds: number) {
  // Both sides: each probe plays as KOR and as AYAZ so spawn side cannot bias it.
  let aScore = 0, games = 0, kos = 0; const pens: number[] = []; let penMax = 0; const gaps: number[] = []; const far: number[] = [];
  const techniques: Record<string, number> = {}; let aHits = 0, bHits = 0; const durations: number[] = []; let low = 0;
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) for (const swap of [false, true]) {
    const r = swap ? rollout(e, seed, POLICIES[bName]!, POLICIES[aName]!) : rollout(e, seed, POLICIES[aName]!, POLICIES[bName]!);
    const aSide: Side = swap ? 1 : 0;
    aScore += r.winner === "draw" ? .5 : r.winner === aSide ? 1 : 0; games++; if (r.ko) kos++;
    durations.push(r.durationS); low += r.lowStaminaShare;
    pens.push(...r.penetrations); penMax = Math.max(penMax, r.penetrationMax); gaps.push(r.longestGapS); far.push(r.farShare);
    for (const [k, v] of Object.entries(r.hitsBy[aSide]!)) { techniques[k] = (techniques[k] ?? 0) + v; aHits += v; }
    for (const v of Object.values(r.hitsBy[aSide === 0 ? 1 : 0]!)) bHits += v;
  }
  return { a: aName, b: bName, games, aScore: round(aScore / games), koShare: round(kos / games), aCleanHitsPerGame: round(aHits / games, 2), bCleanHitsPerGame: round(bHits / games, 2), aTechniqueShare: Object.fromEntries(Object.entries(techniques).map(([k, v]) => [k, round(v / Math.max(1, aHits))])), penetrationCm: { p95: round(pct(pens, .95) * 100, 1), max: round(penMax * 100, 1), overlapTicks: pens.length }, longestNoContactS: { p50: round(pct(gaps, .5), 1), max: round(Math.max(...gaps), 1) }, outOfRangeShare: round(far.reduce((x, y) => x + y, 0) / far.length), durationS: { p50: round(pct(durations, .5), 1), min: round(Math.min(...durations), 1) }, lowStaminaShare: round(low / games) };
}

const which = ["candidate", "sparring2", "sparring4"].includes(process.argv[2]!) ? process.argv[2]! : "baseline";
const seeds = Number(process.argv[3] ?? 24);
/** Seeds 1..24 were used while tuning sparring-2; 1001+ is the untouched held-out bank. */
const firstSeed = Number(process.argv[4] ?? 1);
const engine: Engine = which === "candidate" ? candidate as unknown as Engine : which === "sparring2" ? sparring2 as unknown as Engine : which === "sparring4" ? sparring4 as unknown as Engine : baseline;
const pairs: [string, string][] = [
  ["balanced", "pressure"], ["balanced", "counter"],
  ["runner", "pressure"], ["runner", "balanced"],
  ["hitAndRun", "pressure"], ["hitAndRun", "balanced"],
  ["kickSpam", "balanced"], ["kickSpam", "pressure"], ["kickSpam", "counter"],
  ["jabSpam", "balanced"], ["jabSpam", "pressure"], ["jabSpam", "counter"],
];
console.log(JSON.stringify({ engine: which, version: engine.SPARRING_VERSION, seeds, firstSeed, sidesPerSeed: 2, seconds: 90, results: pairs.map(([a, b]) => matchup(engine, a, b, seeds)) }, null, 1));
