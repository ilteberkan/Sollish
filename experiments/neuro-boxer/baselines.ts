/** Reference policies for honest comparison: random and relentless mixed aggression. */
import { createSparring, stepSparring, sparringBotInput, SPARRING_BOXING_ATTACKS, type SparringInput, type SparringSide, type SparringState } from "../../packages/protocol/src/combat-sparring";
export type Policy = (s: SparringState, side: SparringSide, rng: () => number) => SparringInput;
export const randomPolicy: Policy = (s, side, rng) => {
  if (s.tick % 4 !== side) return { moveX: 0, moveZ: 0, guard: false, action: null };
  const cmds = [null, null, null, "jab", "cross", "hook", "uppercut", "slip", "dash"] as const;
  return { moveX: rng() * 2 - 1, moveZ: rng() * 2 - 1, guard: rng() < .25, action: cmds[Math.floor(rng() * cmds.length)] ?? null };
};
export const aggroPolicy: Policy = (s, side) => {
  const me = s.fighters[side], op = s.fighters[side === 0 ? 1 : 0], d = Math.max(.01, Math.hypot(op.x - me.x, op.z - me.z));
  if (s.phase !== "fight" || s.tick < me.actionUntil) return { moveX: 0, moveZ: 0, guard: false, action: null };
  if (d > 1.0) return { moveX: (op.x - me.x) / d, moveZ: (op.z - me.z) / d, guard: false, action: null };
  return { moveX: 0, moveZ: 0, guard: false, action: SPARRING_BOXING_ATTACKS[(s.tick >> 3) % 4]! };
};
export function runPolicyBout(policy: Policy, style: "balanced" | "pressure" | "counter", seed: number, side: SparringSide, seconds = 45) {
  let r = seed >>> 0; const rng = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  let s = createSparring(seed, { durationSeconds: seconds, rounds: 1, breakSeconds: 4 }); const other: SparringSide = side === 0 ? 1 : 0;
  while (!s.finished) { const a = policy(s, side, rng), b = sparringBotInput(s, other, style); s = stepSparring(s, side === 0 ? [a, b] : [b, a]); }
  return s.winner === side ? 1 : s.winner === "draw" ? .5 : 0;
}

// --- neuro-2 opponent pool: experiment-only scripted corners (authored rules, not trained, not in the product) ---
const strikes = ["jab", "cross", "hook", "uppercut", "roundhouse"];
const striking = (action: string) => strikes.includes(action);
/** Deterministic per (seed, tick window, side): replayable, no Math.random. */
const cycleOf = (s: SparringState, side: SparringSide, window: number, mod: number) => ((s.seed ^ (Math.floor(s.tick / window) * 2654435761) ^ (side * 2246822519)) >>> 0) % mod;
function frame(s: SparringState, side: SparringSide) {
  const me = s.fighters[side], op = s.fighters[side === 0 ? 1 : 0], d = Math.max(.01, Math.hypot(op.x - me.x, op.z - me.z));
  const dx = (op.x - me.x) / d, dz = (op.z - me.z) / d;
  const threatening = striking(op.action) && op.phase === "startup" && s.tick - op.actionAt >= 2 && d < 1.45;
  const punishable = striking(op.action) && op.phase === "recovery" && !op.landed && d < 1.12;
  const busy = s.finished || s.phase !== "fight" || me.phase === "hitstun" || (striking(me.action) && s.tick < me.actionUntil);
  return { me, op, d, dx, dz, threatening, punishable, busy };
}
/** Cautious corner: guard-first, gives ground and circles, punishes whiffs, jabs only when fresh and in range. */
export function cautiousBotInput(s: SparringState, side: SparringSide): SparringInput {
  const { me, d, dx, dz, threatening, punishable, busy } = frame(s, side), input: SparringInput = { moveX: 0, moveZ: 0, guard: false, action: null };
  if (busy) return input;
  if (punishable && me.stamina >= 120) { input.action = d < 1.0 ? "cross" : "jab"; return input; }
  const strafe = (Math.floor(s.tick / 85) + side) % 2 ? 1 : -1;
  if (threatening) {
    input.guard = me.stamina >= 40; input.moveX = -dx * .55 - dz * strafe * .3; input.moveZ = -dz * .55 + dx * strafe * .3;
    if (d < 1.0 && me.stamina > 420 && cycleOf(s, side, 30, 4) === 0) input.action = "slip";
    return input;
  }
  if (d < 1.12) { input.moveX = -dx * .6 - dz * strafe * .6; input.moveZ = -dz * .6 + dx * strafe * .6; input.guard = me.stamina < 700; }
  else if (d > 1.7) { input.moveX = dx * .8; input.moveZ = dz * .8; input.guard = true; }
  else { input.moveX = -dz * strafe * .7; input.moveZ = dx * strafe * .7; input.guard = me.stamina < 500; }
  if (d < 1.18 && me.stamina > 650 && s.tick % 55 === (side * 27) % 55) { input.action = "jab"; input.guard = false; }
  return input;
}
/** Outboxer corner: holds jab range (~1.05-1.3 m), circles, leads with the jab (jab-cross when fresh), steps out when pressed. */
export function outboxerBotInput(s: SparringState, side: SparringSide): SparringInput {
  const { me, op, d, dx, dz, threatening, punishable, busy } = frame(s, side), input: SparringInput = { moveX: 0, moveZ: 0, guard: false, action: null };
  if (busy) {
    // Double up behind a landed jab while the combo window is open (the engine validates the chain).
    if (me.action === "jab" && me.landed && me.phase === "recovery" && me.stamina > 450 && cycleOf(s, side, 40, 3) === 0) input.action = "cross";
    return input;
  }
  if (punishable && me.stamina >= 65) { input.action = "jab"; return input; }
  const strafe = (Math.floor(s.tick / 70) + side) % 2 ? 1 : -1;
  if (threatening && d < 1.2) {
    input.guard = me.stamina >= 30; input.moveX = -dx * .7 - dz * strafe * .5; input.moveZ = -dz * .7 + dx * strafe * .5;
    if (me.stamina > 520 && cycleOf(s, side, 24, 3) === 0) { input.action = "dash"; input.guard = false; }
    return input;
  }
  const closing = (op.vx * -dx + op.vz * -dz) > .4;
  if (d < 1.02 || (closing && d < 1.15)) { input.moveX = -dx * .75 - dz * strafe * .55; input.moveZ = -dz * .75 + dx * strafe * .55; }
  else if (d > 1.32) { input.moveX = dx * .85 - dz * strafe * .2; input.moveZ = dz * .85 + dx * strafe * .2; }
  else { input.moveX = -dz * strafe * .8; input.moveZ = dx * strafe * .8; }
  if (d < 1.2 && d > .9 && me.stamina > 260 && s.tick % 24 === (side * 12) % 24) input.action = "jab";
  return input;
}
