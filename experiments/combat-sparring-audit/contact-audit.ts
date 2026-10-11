/**
 * Engine-level body-contact audit for the non-monetary Combat Club (sparring-5 capsule body model).
 * Runs full product bouts (3 x 45 s, 8 s breaks) of an engine module and measures, every tick, how far
 * the sparring-5 capsules (combat-capsules.ts on the CURRENT sparringPose, applied to that engine's
 * states) interpenetrate. Fixture-level geometry on simplified capsules, not rendered meshes.
 *
 *   node --import tsx experiments/combat-sparring-audit/contact-audit.ts sparring4|candidate [seeds] [firstSeed]
 */
import * as sparring4 from "./baseline-sparring-4";
import * as candidate from "../../packages/protocol/src/combat-sparring";
import { sparringPose } from "../../packages/protocol/src/combat-sparring";
import { capsuleOverlap, sparringCapsules, sweepSphereCapsule, SPARRING_BODY_PARTS, SPARRING_CAPSULE_RADII, SPARRING_GUARD_PARTS, SPARRING_HURT_PARTS, type SparringCapsulePart } from "../../packages/protocol/src/combat-capsules";
import { createNeuroMemory, neuroInput, type NeuroMemory } from "../../packages/protocol/src/neuro-boxer";
import { NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS } from "../../packages/protocol/src/neuro-boxer-model";

type Engine = typeof candidate;
type State = ReturnType<Engine["createSparring"]>;
type Fighter = State["fighters"][0];
type Style = "neuro" | "balanced" | "pressure" | "counter";
const which = process.argv[2] === "candidate" ? "candidate" : "sparring4";
const engine = (which === "candidate" ? candidate : sparring4) as unknown as Engine;
const seeds = Number(process.argv[3] ?? 12), firstSeed = Number(process.argv[4] ?? 1);
const BOUT = { durationSeconds: 45, rounds: 3, breakSeconds: 8 } as const;
const guardUp = (f: Fighter) => f.action === "guard" && f.stamina >= 15;
const isAttack = (a: string) => ["jab", "cross", "hook", "uppercut", "roundhouse"].includes(a);
const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]!; };
const cm = (m: number) => Math.round(m * 1000) / 10;
const pairKey = (a: SparringCapsulePart, b: SparringCapsulePart) => [a, b].map(p => p.replace(/[LR]$/, "")).sort().join("-");

function bout(seed: number, a: Style, b: Style) {
  let s = engine.createSparring(seed, BOUT);
  const memories: [NeuroMemory, NeuroMemory] = [createNeuroMemory(), createNeuroMemory()];
  const decide = (st: State, side: 0 | 1, style: Style) => style === "neuro" ? neuroInput(st as never, side, NEURO_BOXER_GRAPH, NEURO_BOXER_PARAMS, memories[side], { temperature: .8 }) : engine.sparringBotInput(st, side, style);
  const r = { ticks: 0, bodyOverlap: [] as number[], bodyMax: 0, pairMax: {} as Record<string, number>, guardOverlapUp: [] as number[], guardOverlapDown: [] as number[], hurtMax: 0, armBodyMax: 0, hits: 0, blocks: 0, knockdowns: 0, hitsThroughIdleGuard: 0, method: "", winner: "" as string, minRoot: Infinity, lyingMin: Infinity };
  while (!s.finished) {
    const prev = s;
    s = engine.stepSparring(s, [decide(s, 0, a), decide(s, 1, b)]);
    r.ticks++;
    const [f0, f1] = s.fighters, standing = s.phase !== "count";
    r.minRoot = Math.min(r.minRoot, Math.hypot(f0.x - f1.x, f0.z - f1.z));
    const poses = s.fighters.map(f => sparringPose(f, s.tick)), caps = poses.map(sparringCapsules);
    if (standing) {
      let worst = 0;
      for (const pa of SPARRING_BODY_PARTS) for (const pb of SPARRING_BODY_PARTS) {
        const d = capsuleOverlap(caps[0]![pa], caps[1]![pb]).depth; if (d <= 0) continue;
        worst = Math.max(worst, d); const k = pairKey(pa, pb); r.pairMax[k] = Math.max(r.pairMax[k] ?? 0, d);
      }
      if (worst > 0) r.bodyOverlap.push(worst); r.bodyMax = Math.max(r.bodyMax, worst);
      // Non-striking arms (upper arm, forearm, glove) inside the other trunk/head: arms never push roots.
      for (const side of [0, 1] as const) for (const arm of ["upperArmL", "upperArmR", "forearmL", "forearmR", "gloveL", "gloveR"] as const) {
        const striking = poses[side]!.striking; if ((striking === "leftHand" && /L$/.test(arm)) || (striking === "rightHand" && /R$/.test(arm))) continue;
        for (const body of SPARRING_HURT_PARTS) r.armBodyMax = Math.max(r.armBodyMax, capsuleOverlap(caps[side]![arm], caps[side ? 0 : 1]![body]).depth);
      }
    } else if (s.count) {
      const down = s.fighters[s.count.fighter], up = s.fighters[s.count.fighter === 0 ? 1 : 0];
      const [bx, bz] = candidate.lyingBodyPoint(down, up.x, up.z); r.lyingMin = Math.min(r.lyingMin, Math.hypot(up.x - bx, up.z - bz));
    }
    for (const side of [0, 1] as const) {
      const pose = poses[side]!, target = s.fighters[side ? 0 : 1];
      if (!pose.striking || pose.striking === "rightFoot") continue;
      const glove = pose[pose.striking], tc = caps[side ? 0 : 1]!, sphere = { part: "gloveL" as const, a: glove, b: glove, r: SPARRING_CAPSULE_RADII.glove };
      let g = 0; for (const part of SPARRING_GUARD_PARTS) g = Math.max(g, capsuleOverlap(sphere, tc[part]).depth);
      if (g > 0) (guardUp(target) ? r.guardOverlapUp : r.guardOverlapDown).push(g);
      for (const part of SPARRING_HURT_PARTS) r.hurtMax = Math.max(r.hurtMax, capsuleOverlap(sphere, tc[part]).depth);
    }
    for (const e of s.events) {
      if (e.type === "hit") r.hits++; if (e.type === "block") r.blocks++; if (e.type === "knockdown") r.knockdowns++;
      if (e.type !== "hit") continue;
      // What-if (plan read literally): would this landed strike have met the defender's idle forearms/gloves first?
      const actor = e.actor, target = actor ? 0 : 1, before = sparringPose(prev.fighters[actor], prev.tick), now = poses[actor]!;
      if (!now.striking || now.striking === "rightFoot" || !isAttack(s.fighters[actor].action)) continue;
      const bc = sparringCapsules(sparringPose(prev.fighters[target], prev.tick)), nc = caps[target]!;
      const first = (parts: readonly SparringCapsulePart[]) => Math.min(...parts.map(p => sweepSphereCapsule(before[now.striking!], now[now.striking!], bc[p], nc[p], SPARRING_CAPSULE_RADII.glove) ?? Infinity));
      if (first(SPARRING_GUARD_PARTS) < first(SPARRING_HURT_PARTS)) r.hitsThroughIdleGuard++;
    }
  }
  r.method = s.method ?? ""; r.winner = String(s.winner);
  return r;
}

const matchups: [Style, Style][] = [["neuro", "neuro"], ["balanced", "pressure"], ["counter", "balanced"], ["pressure", "counter"]];
const rows = matchups.map(([a, b]) => {
  const bouts = [] as ReturnType<typeof bout>[];
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) { bouts.push(bout(seed, a, b)); if (a !== b) bouts.push(bout(seed, b, a)); }
  const all = (k: "bodyOverlap" | "guardOverlapUp" | "guardOverlapDown") => bouts.flatMap(x => x[k]);
  const ticks = bouts.reduce((n, x) => n + x.ticks, 0), sum = (k: "hits" | "blocks" | "knockdowns" | "hitsThroughIdleGuard") => bouts.reduce((n, x) => n + x[k], 0);
  const pairs: Record<string, number> = {}; for (const x of bouts) for (const [k, v] of Object.entries(x.pairMax)) pairs[k] = Math.max(pairs[k] ?? 0, v);
  const methods: Record<string, number> = {}; for (const x of bouts) methods[x.method] = (methods[x.method] ?? 0) + 1;
  return { matchup: `${a}-vs-${b}`, bouts: bouts.length, ticks,
    bodyCapsuleOverlapCm: { max: cm(Math.max(0, ...bouts.map(x => x.bodyMax))), p99OfOverlapTicks: cm(pct(all("bodyOverlap"), .99)), ticksOver2mm: all("bodyOverlap").filter(d => d > .002).length, shareTicksOver2mm: +(all("bodyOverlap").filter(d => d > .002).length / ticks).toFixed(4), pairMaxCm: Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, cm(v)])) },
    strikingGloveVsGuardCm: { defenderGuarding: { ticks: all("guardOverlapUp").length, max: cm(Math.max(0, ...all("guardOverlapUp"))), p95: cm(pct(all("guardOverlapUp"), .95)) }, defenderNotGuarding: { ticks: all("guardOverlapDown").length, max: cm(Math.max(0, ...all("guardOverlapDown"))), p95: cm(pct(all("guardOverlapDown"), .95)) } },
    strikingGloveInHeadTorsoMaxCm: cm(Math.max(...bouts.map(x => x.hurtMax))), nonStrikingArmInOtherTrunkMaxCm: cm(Math.max(...bouts.map(x => x.armBodyMax))),
    minRootDistanceM: +Math.min(...bouts.map(x => x.minRoot)).toFixed(3), minDistanceToLyingBodyM: +Math.min(...bouts.map(x => x.lyingMin)).toFixed(3),
    perBout: { hits: +(sum("hits") / bouts.length).toFixed(2), blocks: +(sum("blocks") / bouts.length).toFixed(2), knockdowns: +(sum("knockdowns") / bouts.length).toFixed(2) },
    hitsThatWouldMeetIdleGuardFirst: { count: sum("hitsThroughIdleGuard"), shareOfHits: +(sum("hitsThroughIdleGuard") / Math.max(1, sum("hits"))).toFixed(3) }, methods };
});
console.log(JSON.stringify({ audit: "contact-audit", engine: which, version: engine.SPARRING_VERSION, bodyModel: "sparring-5 capsules on the current sparringPose", radii: SPARRING_CAPSULE_RADII, bout: BOUT, seeds, firstSeed, sides: "bots play both corners; neuro-vs-neuro once per seed (temperature 0.8, product sampling)", scope: "engine fixture: simplified capsules, not rendered meshes", rows }, null, 1));
