/** Non-monetary, input-driven prototype. No wagers, wallets or learned-policy claims. */
import { createSparringReferee, stepSparringReferee, type RefereeWorld, type SparringReferee } from "./combat-referee";
import { capsuleOverlap, pointSegDistance, sparringCapsules, sweepSphereCapsule, SPARRING_BODY_PARTS, SPARRING_CAPSULE_RADII, SPARRING_GUARD_PARTS, SPARRING_HURT_PARTS, type SparringCapsulePart } from "./combat-capsules";
// sparring-5 (unpublished): capsule body contact and smooth referee steering. sparring-4 is frozen
// byte-identically in experiments/combat-sparring-audit/baseline-sparring-4.ts for its evidence.
export const SPARRING_VERSION = "sparring-5" as const;
export const SPARRING_HZ = 60;
export const SPARRING_TICK_MS = 1000 / SPARRING_HZ;
export type SparringSide = 0 | 1;
export type SparringAttack = "jab" | "cross" | "hook" | "uppercut" | "roundhouse";
export type SparringCommand = SparringAttack | "slip" | "dash";
export type SparringAction = SparringCommand | "idle" | "move" | "guard" | "hitstun" | "knockdown" | "getup";
export type SparringPhase = "idle" | "startup" | "active" | "recovery" | "hitstun" | "knockdown" | "getup";
export type SparringVec3 = { x: number; y: number; z: number };
/** Movement is WORLD x/z, [-1,1]. action is a press edge; do not repeat it while held. */
export type SparringInput = { moveX: number; moveZ: number; guard: boolean; action?: SparringCommand | null; jump?: boolean };
export type SparringEvent = {
  id: number; tick: number; type: "attack" | "hit" | "block" | "dodge" | "miss" | "counter" | "combo" | "guardbreak" | "knockout" | "rejected" | "knockdown" | "count" | "getup" | "roundend" | "roundstart" | "decision";
  actor: SparringSide; target: SparringSide; attack: SparringAttack | null;
  point: SparringVec3 | null; damage: number; reason: string | null;
};
export type SparringFighter = {
  id: SparringSide; x: number; y: number; z: number; vx: number; vy: number; vz: number; facing: number;
  airAt: number; airUntil: number;
  health: number; stamina: number; action: SparringAction; phase: SparringPhase;
  actionAt: number; actionUntil: number; attackId: number; landed: boolean;
  lastHitAt: number; lastHitKind: "head" | "body" | "block" | null;
  lastAttack: SparringAttack | null; repeatCount: number; comboCount: number; comboUntil: number;
  lastSpendAt: number; stunUntil: number; counterUntil: number;
  buffered: { action: SparringCommand; until: number } | null;
  /** Strike extension (0..1) at which the current attack met a hurt volume; the limb stops there. */
  strikeStop: number | null;
  hits: number; blocks: number; damageDealt: number;
  /** Accumulated concussion from clean head shots; decays; crossing the threshold is a knockdown. */
  daze: number; knockdowns: number; roundDamage: number; roundKnockdowns: number;
};
export type SparringCount = { fighter: SparringSide; startAt: number; standAt: number | null; n: number };
export type SparringState = {
  version: typeof SPARRING_VERSION; seed: number; tick: number; durationTicks: number;
  fighters: [SparringFighter, SparringFighter]; events: SparringEvent[];
  nextEventId: number; nextAttackId: number; winner: SparringSide | "draw" | null; finished: boolean;
  /** sparring-4 bout structure. durationTicks is the length of one round. */
  rounds: number; round: number; roundTick: number; breakTicks: number; phase: "fight" | "count" | "break" | "finished"; phaseAt: number;
  count: SparringCount | null; scores: [number, number][]; method: "ko" | "tko" | "decision" | "draw" | null;
  /** Presentation-only official (combat-referee.ts): moves around the fighters, never collides with or affects them. */
  referee: SparringReferee;
};
/** Metres, y-up; facing=0 points +z, facing=PI/2 points +x. */
export type SparringPose = {
  head: SparringVec3; chest: SparringVec3; pelvis: SparringVec3;
  leftHand: SparringVec3; rightHand: SparringVec3; leftFoot: SparringVec3; rightFoot: SparringVec3;
  leftElbow: SparringVec3; rightElbow: SparringVec3; leftKnee: SparringVec3; rightKnee: SparringVec3;
  /** sparring-5 capsule anchors (combat-capsules.ts): upper-arm and thigh roots. */
  leftShoulder: SparringVec3; rightShoulder: SparringVec3; leftHip: SparringVec3; rightHip: SparringVec3;
  striking: "leftHand" | "rightHand" | "rightFoot" | null;
};
/** step: metres the root travels forward during startup (weight transfer into the strike). */
export type SparringAttackSpec = { startup: number; active: number; recovery: number; cost: number; damage: number; reach: number; height: number; stun: number; push: number; step: number };
// sparring-4 startups are 50 ms longer than sparring-3 so captured anticipation plays near real speed.
export const SPARRING_ATTACKS: Readonly<Record<SparringAttack, Readonly<SparringAttackSpec>>> = Object.freeze({
  jab: { startup: 9, active: 3, recovery: 13, cost: 65, damage: 25, reach: .76, height: 1.65, stun: 12, push: .65, step: .26 },
  cross: { startup: 13, active: 4, recovery: 19, cost: 100, damage: 39, reach: .78, height: 1.64, stun: 17, push: 1.0, step: .16 },
  hook: { startup: 15, active: 4, recovery: 20, cost: 115, damage: 43, reach: .72, height: 1.64, stun: 18, push: .85, step: .08 },
  uppercut: { startup: 14, active: 4, recovery: 21, cost: 110, damage: 42, reach: .64, height: 1.62, stun: 18, push: .75, step: .08 },
  roundhouse: { startup: 17, active: 5, recovery: 28, cost: 160, damage: 53, reach: .88, height: 1.12, stun: 21, push: 1.25, step: .07 },
});
for (const spec of Object.values(SPARRING_ATTACKS)) Object.freeze(spec);

/** sparring-3 runs boxing rules: kicks stay in the type for frozen history but are rejected. */
export const SPARRING_BOXING_ATTACKS: readonly SparringAttack[] = Object.freeze(["jab", "cross", "hook", "uppercut"]);
export const SPARRING_NEUTRAL_INPUT: Readonly<SparringInput> = Object.freeze({ moveX: 0, moveZ: 0, guard: false, action: null });
// sparring-3: 0.78 m root spacing; 0.64 m let real bladed mocap torsos and arms interpenetrate.
const RING = 3.15, BODY_DISTANCE = .78, BUFFER_TICKS = 8;
const attackNames: readonly SparringAttack[] = ["jab", "cross", "hook", "uppercut", "roundhouse"];
const isAttack = (action: SparringAction): action is SparringAttack => attackNames.includes(action as SparringAttack);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const distance = (a: SparringFighter, b: SparringFighter) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (f: SparringFighter, x: number, y: number, z: number): SparringVec3 => ({ x: f.x + Math.cos(f.facing) * x + Math.sin(f.facing) * z, y: f.y + y, z: f.z - Math.sin(f.facing) * x + Math.cos(f.facing) * z });
const lerpPoint = (a: SparringVec3, b: SparringVec3, t: number): SparringVec3 => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });
const total = (a: SparringAttack) => { const s = SPARRING_ATTACKS[a]; return s.startup + s.active + s.recovery; };

function fighter(id: SparringSide): SparringFighter {
  return { id, x: id === 0 ? -.85 : .85, y: 0, z: 0, vx: 0, vy: 0, vz: 0, airAt: -1000, airUntil: 0, facing: id === 0 ? Math.PI / 2 : -Math.PI / 2,
    health: 1000, stamina: 1000, action: "idle", phase: "idle", actionAt: 0, actionUntil: 0, attackId: 0, landed: false,
    lastHitAt: -1000, lastHitKind: null, lastAttack: null, repeatCount: 0, comboCount: 0, comboUntil: 0,
    lastSpendAt: -1000, stunUntil: 0, counterUntil: 0, buffered: null, strikeStop: null, hits: 0, blocks: 0, damageDealt: 0, daze: 0, knockdowns: 0, roundDamage: 0, roundKnockdowns: 0 };
}
/** durationSeconds is one round; rounds defaults to 1 (a single timed bout). */
export function createSparring(seed: number, options: { durationSeconds?: number; rounds?: number; breakSeconds?: number } = {}): SparringState {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Invalid sparring seed");
  const seconds = options.durationSeconds ?? 60, rounds = options.rounds ?? 1, rest = options.breakSeconds ?? 8;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError("Invalid sparring duration");
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 12 || !Number.isSafeInteger(rest) || rest < 1 || rest > 60) throw new RangeError("Invalid sparring rounds");
  return { version: SPARRING_VERSION, seed, tick: 0, durationTicks: seconds * SPARRING_HZ, fighters: [fighter(0), fighter(1)], events: [], nextEventId: 1, nextAttackId: 1, winner: null, finished: false,
    rounds, round: 1, roundTick: 0, breakTicks: rest * SPARRING_HZ, phase: "fight", phaseAt: 0, count: null, scores: [], method: null, referee: createSparringReferee() };
}
/** Count cadence (0.75 s per number, faster than a real 1 s count for broadcast pacing) and thresholds. */
export const SPARRING_COUNT_TICKS = 45, SPARRING_DAZE_KNOCKDOWN = 60, SPARRING_GETUP_TICKS = 162; // matches the 2.7 s licensed get-up capture

/** Authoritative simplified targets; rendered authored clips are presentation, not hit detection. */
export function sparringPose(f: SparringFighter, tick: number): SparringPose {
  const age = Math.max(0, tick - f.actionAt);
  const slipping = f.action === "slip" ? Math.sin(Math.PI * clamp(age / 20, 0, 1)) : 0;
  const side = f.id === 0 ? 1 : -1;
  const headX = .30 * slipping * side, duck = .20 * slipping;
  const pose: SparringPose = {
    head: point(f, headX, 1.65 - duck, .06), chest: point(f, headX * .4, 1.24 - duck * .45, .03), pelvis: point(f, 0, .89, 0),
    leftHand: point(f, -.15, 1.55 - duck * .6, .30), rightHand: point(f, .15, 1.55 - duck * .6, .26),
    // sparring-5 legs follow the rendered bladed stance (fightkit rig at 1.05, mean of idle/footwork clips):
    // lead knee 0.31 m ahead of the root. The lead thigh lies on the centre line (rendered hip/knee: 7 / 2.5 cm off
    // it) so square-on leg contact pushes along the root line, not sideways. Mirrored to this engine's lead side (local -x).
    leftFoot: point(f, -.175, .10, .27), rightFoot: point(f, .21, .095, -.32),
    leftElbow: point(f, -.30, 1.26, .08), rightElbow: point(f, .30, 1.26, .02),
    leftKnee: point(f, 0, .55, .31), rightKnee: point(f, .30, .52, -.10),
    leftShoulder: point(f, headX * .4 - .19, 1.45 - duck * .5, .04), rightShoulder: point(f, headX * .4 + .19, 1.45 - duck * .5, .04),
    leftHip: point(f, 0, .93, .07), rightHip: point(f, .07, .90, -.12), striking: null,
  };
  if (!isAttack(f.action)) return pose;
  const s = SPARRING_ATTACKS[f.action];
  const limb = f.action === "jab" || f.action === "hook" ? "leftHand" : f.action === "roundhouse" ? "rightFoot" : "rightHand";
  pose.striking = limb;
  // A landed/blocked strike stops at the surface it met instead of continuing through the body.
  const stop = f.strikeStop ?? 1;
  if (limb === "rightFoot") {
    const rest = pose.rightFoot, chamber = point(f, .20, .82, .18);
    if (age < s.startup) {
      const load = clamp(age / s.startup, 0, 1);
      pose.rightFoot = load < .7 ? lerpPoint(rest, chamber, load / .7) : lerpPoint(chamber, kickArc(f, 0), (load - .7) / .3);
    } else if (age < s.startup + s.active) {
      pose.rightFoot = kickArc(f, Math.min(stop, strikeExtension(f, tick)));
    } else {
      pose.rightFoot = lerpPoint(kickArc(f, stop), rest, clamp((age - s.startup - s.active) / Math.min(16, s.recovery), 0, 1));
    }
    pose.rightKnee = point(f, .24, .47 + .40 * clamp((pose.rightFoot.y - f.y - .07) / .75, 0, 1), .35);
    return pose;
  }
  // Anticipation loads the limb before its active sweep; recovery has no damage authority.
  const t = Math.min(stop, strikeExtension(f, tick));
  let lateral = limb === "leftHand" ? -.06 : .04;
  if (f.action === "hook") lateral += -.36 * Math.sin(Math.PI * t);
  let height = s.height;
  if (f.action === "uppercut") height = 1.05 + .57 * t;
  pose[limb] = lerpPoint(pose[limb], point(f, lateral, height, s.reach), t);
  return pose;
}
/** Unclamped strike extension: punches 0→1→0, the kick arc 0→1 through its active frames. */
function strikeExtension(f: SparringFighter, tick: number): number {
  if (!isAttack(f.action)) return 0;
  const s = SPARRING_ATTACKS[f.action], age = Math.max(0, tick - f.actionAt);
  if (age < s.startup) return 0;
  if (age < s.startup + s.active) return clamp((age - s.startup + 1) / s.active, 0, 1);
  if (f.action === "roundhouse") return 1;
  return 1 - clamp((age - s.startup - s.active) / Math.min(s.recovery, 12), 0, 1);
}
/** A sweep across the body, not constant forward reach plus an extra lateral extension. */
const kickArc = (f: SparringFighter, arc: number) => point(f, .42 * Math.cos(Math.PI * arc), SPARRING_ATTACKS.roundhouse.height, SPARRING_ATTACKS.roundhouse.reach * Math.sin(Math.PI * arc));

function validInput(input: SparringInput): void {
  if (!input || !Number.isFinite(input.moveX) || !Number.isFinite(input.moveZ) || Math.abs(input.moveX) > 1 || Math.abs(input.moveZ) > 1 || typeof input.guard !== "boolean" || (input.jump !== undefined && typeof input.jump !== "boolean") || (input.action != null && ![...attackNames, "slip", "dash"].includes(input.action))) throw new TypeError("Invalid sparring input");
}
function emit(s: SparringState, actor: SparringFighter, type: SparringEvent["type"], fields: Partial<Pick<SparringEvent, "point" | "damage" | "reason" | "attack">> = {}): void {
  s.events.push({ id: s.nextEventId++, tick: s.tick, actor: actor.id, target: actor.id === 0 ? 1 : 0, type,
    attack: isAttack(actor.action) ? actor.action : null, point: null, damage: 0, reason: null, ...fields });
}
function canChain(f: SparringFighter, next: SparringCommand, tick: number): boolean {
  if (!isAttack(f.action) || !isAttack(next) || !f.landed || f.comboCount >= 3 || tick > f.comboUntil || tick < f.actionAt + SPARRING_ATTACKS[f.action].startup + SPARRING_ATTACKS[f.action].active + 4) return false;
  const links: Record<SparringAttack, readonly SparringAttack[]> = { jab: ["cross", "uppercut"], cross: ["hook", "roundhouse"], hook: ["cross", "uppercut"], uppercut: ["hook", "roundhouse"], roundhouse: [] };
  return links[f.action].includes(next);
}
function startCommand(s: SparringState, f: SparringFighter, command: SparringCommand, input: SparringInput, chain: boolean): boolean {
  if (command === "roundhouse") { emit(s, f, "rejected", { reason: "ruleset", attack: command }); return false; }
  const cost = isAttack(command) ? SPARRING_ATTACKS[command].cost : command === "slip" ? 75 : 120;
  if (f.stamina < cost) { emit(s, f, "rejected", { reason: "stamina", attack: isAttack(command) ? command : null }); return false; }
  f.stamina -= cost; f.lastSpendAt = s.tick;
  if (isAttack(command)) {
    f.repeatCount = f.lastAttack === command && s.tick <= f.counterUntil + 75 ? f.repeatCount + 1 : 0;
    f.lastAttack = command; f.comboCount = chain ? f.comboCount + 1 : 1;
    f.actionUntil = s.tick + total(command); f.attackId = s.nextAttackId++; f.landed = false; f.strikeStop = null;
    f.comboUntil = 0; f.counterUntil = f.actionUntil + 8;
    if (chain) emit(s, f, "combo", { attack: command });
  } else {
    f.actionUntil = s.tick + (command === "slip" ? 20 : 16); f.comboCount = 0; f.comboUntil = 0;
    if (command === "dash") {
      const length = Math.hypot(input.moveX, input.moveZ);
      f.vx = length > .05 ? input.moveX / length * 2.6 : -Math.sin(f.facing) * 2.6;
      f.vz = length > .05 ? input.moveZ / length * 2.6 : -Math.cos(f.facing) * 2.6;
    }
  }
  f.action = command; f.actionAt = s.tick; f.phase = "startup"; f.buffered = null;
  if (isAttack(command)) emit(s, f, "attack");
  return true;
}

function updateFighter(s: SparringState, f: SparringFighter, opponent: SparringFighter, input: SparringInput): void {
  if (f.y > 0 || f.vy > 0) { f.vy -= 12 / SPARRING_HZ; f.y = Math.max(0, f.y + f.vy / SPARRING_HZ); if (f.y === 0) { f.vy = 0; f.airUntil = s.tick; } }
  if (f.health <= 0) { f.action = "knockdown"; f.phase = "knockdown"; f.vx *= .8; f.vz *= .8; return; }
  if (f.buffered && f.buffered.until < s.tick) f.buffered = null;
  const stunned = s.tick < f.stunUntil;
  const locked = s.tick < f.actionUntil && (isAttack(f.action) || f.action === "slip" || f.action === "dash");
  if (input.jump) {
    if (!stunned && !locked && f.y === 0 && f.vy === 0 && f.stamina >= 100) { f.vy = 3.6; f.y = f.vy / SPARRING_HZ; f.airAt = s.tick; f.airUntil = s.tick + 36; f.stamina -= 100; f.lastSpendAt = s.tick; }
    else emit(s, f, "rejected", { reason: "jump-unavailable", attack: null });
  }
  if (input.action) {
    if (stunned) emit(s, f, "rejected", { reason: "hitstun", attack: isAttack(input.action) ? input.action : null });
    else if (!locked || canChain(f, input.action, s.tick)) startCommand(s, f, input.action, input, locked);
    else f.buffered = { action: input.action, until: s.tick + BUFFER_TICKS };
  }
  if (stunned) { f.action = "hitstun"; f.phase = "hitstun"; f.x += f.vx / SPARRING_HZ; f.z += f.vz / SPARRING_HZ; f.vx *= .85; f.vz *= .85; return; }
  const isLocked = s.tick < f.actionUntil && (isAttack(f.action) || f.action === "slip" || f.action === "dash");
  if (f.buffered && (!isLocked || canChain(f, f.buffered.action, s.tick))) startCommand(s, f, f.buffered.action, input, isLocked);
  if (s.tick >= f.actionUntil) {
    f.action = input.guard ? "guard" : Math.hypot(input.moveX, input.moveZ) > .05 ? "move" : "idle";
    f.phase = "idle"; f.comboCount = 0;
  }
  if (isAttack(f.action)) {
    const spec = SPARRING_ATTACKS[f.action], age = s.tick - f.actionAt;
    f.phase = age < spec.startup ? "startup" : age < spec.startup + spec.active ? "active" : "recovery";
    // Committed facing and a finite step-in during startup; no homing once started.
    const lunge = age < spec.startup ? spec.step * SPARRING_HZ / spec.startup : 0;
    if (f.y > 0) { f.vx *= .995; f.vz *= .995; }
    else { f.vx = Math.sin(f.facing) * lunge; f.vz = Math.cos(f.facing) * lunge; }
  } else if (f.action === "slip") { f.phase = s.tick - f.actionAt < 4 ? "startup" : s.tick - f.actionAt < 14 ? "active" : "recovery"; f.vx *= .6; f.vz *= .6; }
  else if (f.action === "dash") { f.phase = s.tick - f.actionAt < 3 ? "startup" : s.tick - f.actionAt < 10 ? "active" : "recovery"; f.vx *= .92; f.vz *= .92; }
  else {
    const desired = Math.atan2(opponent.x - f.x, opponent.z - f.z);
    f.facing = angle(f.facing + clamp(angle(desired - f.facing), -.12, .12));
    const length = Math.max(1, Math.hypot(input.moveX, input.moveZ)), magnitude = Math.hypot(input.moveX, input.moveZ);
    // Footwork is faster forward than backward, so pressure can close distance and
    // an opponent cannot win a timed bout by backpedalling at the attacker's speed.
    const forward = magnitude > 1e-9 ? (input.moveX * Math.sin(f.facing) + input.moveZ * Math.cos(f.facing)) / magnitude : 0;
    // Boxing footwork speeds (captured boxers move ~0.3-0.8 m/s); still faster forward than back.
    const speed = (forward >= 0 ? mix(1.0, 1.35, forward) : mix(1.0, .72, -forward)) * (input.guard ? .5 : 1);
    f.vx += clamp(input.moveX / length * speed - f.vx, -.22, .22);
    f.vz += clamp(input.moveZ / length * speed - f.vz, -.22, .22);
  }
  f.x += f.vx / SPARRING_HZ; f.z += f.vz / SPARRING_HZ;
  if (f.y === 0 && !isAttack(f.action) && f.action !== "slip" && f.action !== "dash" && s.tick - f.lastSpendAt >= 24) f.stamina = Math.min(1000, f.stamina + (input.guard ? 2 : 3));
}

const room = (f: SparringFighter, x: number, z: number) => Math.max(0, Math.min(
  x > 1e-12 ? (RING - f.x) / x : x < -1e-12 ? (-RING - f.x) / x : Infinity,
  z > 1e-12 ? (RING - f.z) / z : z < -1e-12 ? (-RING - f.z) / z : Infinity));
/** Push b along +n and a along -n by `required` in total. The wall-bounded fighter's share transfers to the
 * other root; shareA 0 keeps a in place unless b is against the ropes. */
function separate(a: SparringFighter, b: SparringFighter, nx: number, nz: number, required: number, shareA = .5): void {
  const availableA = room(a, -nx, -nz), availableB = room(b, nx, nz);
  let moveA = Math.min(required * shareA, availableA);
  const moveB = Math.min(required - moveA, availableB);
  moveA += Math.min(required - moveA - moveB, availableA - moveA);
  a.x -= nx * moveA; a.z -= nz * moveA; b.x += nx * moveB; b.z += nz * moveB;
}
// sparring-5: beyond this root distance no trunk/head/thigh capsules can touch (largest reach ~0.5 m per body).
const BODY_BROADPHASE = 1.25, LYING_RADIUS = .18, STANDING_FOOTPRINT = .35;
/**
 * sparring-3 root spacing stays as the cheap first test; sparring-5 then resolves the deepest trunk, head or
 * thigh capsule overlap along its (horizontal) normal, at most 3 times. Arms never push a root. During a count
 * the standing fighter keeps its footprint clear of the lying body instead (ground-plane capsule, r 0.18).
 */
function constrain(s: SparringState): void {
  const fighters = s.fighters;
  for (const f of fighters) { f.x = clamp(f.x, -RING, RING); f.z = clamp(f.z, -RING, RING); }
  const [a, b] = fighters;
  if (s.phase === "count" && s.count) {
    const down = fighters[s.count.fighter], up = fighters[s.count.fighter === 0 ? 1 : 0];
    for (let i = 0; i < 3; i++) {
      const [bx, bz] = lyingBodyPoint(down, up.x, up.z), dx = up.x - bx, dz = up.z - bz, d = Math.hypot(dx, dz), need = LYING_RADIUS + STANDING_FOOTPRINT;
      if (d >= need - 1e-9) break;
      // Coincident with the body axis: step off sideways (perpendicular to the lying body).
      const nx = d > 1e-8 ? dx / d : Math.cos(down.facing), nz = d > 1e-8 ? dz / d : -Math.sin(down.facing);
      separate(down, up, nx, nz, need - d + 1e-6, 0);
    }
    return;
  }
  {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < BODY_DISTANCE) separate(a, b, d > 1e-8 ? dx / d : 1, d > 1e-8 ? dz / d : 0, BODY_DISTANCE - d);
  }
  for (let i = 0; i < 3; i++) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= BODY_BROADPHASE) return;
    const ca = sparringCapsules(sparringPose(a, s.tick)), cb = sparringCapsules(sparringPose(b, s.tick));
    let depth = .0005, nx = 0, nz = 0, scale = 1;
    for (const pa of SPARRING_BODY_PARTS) for (const pb of SPARRING_BODY_PARTS) {
      const o = capsuleOverlap(ca[pa], cb[pb]);
      if (o.depth <= depth) continue;
      // Roots move horizontally: resolve along the horizontal part of the contact normal; near-vertical
      // contacts (one body above the other) fall back to the root-to-root direction.
      const hx = o.normal?.x ?? 0, hz = o.normal?.z ?? 0, hl = Math.hypot(hx, hz);
      if (hl >= .25) { nx = hx / hl; nz = hz / hl; scale = 1 / hl; } else { nx = d > 1e-8 ? dx / d : 1; nz = d > 1e-8 ? dz / d : 0; scale = 1; }
      depth = o.depth;
    }
    if (nx === 0 && nz === 0) return;
    separate(a, b, nx, nz, depth * scale + 1e-4);
  }
}

/** Glove/foot radius; the glove is fitted from the rendered fightkit glove (was 0.095 through sparring-4). */
const limbRadius = (limb: "leftHand" | "rightHand" | "rightFoot") => limb === "rightFoot" ? .12 : SPARRING_CAPSULE_RADII.glove;
/**
 * A raised guard with stamina left makes the defender's forearms and gloves solid to strikes. Idle hands are not:
 * read literally (always solid) ~90 % of sparring-4's landed hits would have met the idle gloves first, turning
 * almost every punch into a block (contact-audit.ts, hitsThatWouldMeetIdleGuardFirst).
 */
const guardUp = (f: SparringFighter) => f.action === "guard" && f.stamina >= 15;
const GUARDED_TARGET: readonly SparringCapsulePart[] = [...SPARRING_GUARD_PARTS, ...SPARRING_HURT_PARTS];
const strikeTargets = (target: SparringFighter) => guardUp(target) ? GUARDED_TARGET : SPARRING_HURT_PARTS;
/** Deepest penetration of the striking limb into anything it can collide with (head, torso, raised guard). */
function limbDepth(f: SparringFighter, target: SparringFighter, tick: number): number {
  const pose = sparringPose(f, tick);
  if (!pose.striking) return 0;
  const limb = pose[pose.striking], r = limbRadius(pose.striking), body = sparringCapsules(sparringPose(target, tick));
  let depth = -Infinity;
  for (const part of strikeTargets(target)) { const c = body[part]; depth = Math.max(depth, r + c.r - pointSegDistance(limb, c.a, c.b)); }
  return depth;
}
/**
 * After contact or during a non-damaging retraction, a defender (or a head snapping
 * back from an interrupted slip) can move into a stopped limb. Shorten that limb to
 * the surface; this is presentation-consistent geometry and never deals damage.
 */
function retractFromBody(f: SparringFighter, target: SparringFighter, tick: number): void {
  if (!isAttack(f.action) || !(f.landed || f.phase === "recovery") || limbDepth(f, target, tick) <= .002) return;
  settleAtSurface(f, target, tick, 0, Math.min(f.strikeStop ?? 1, strikeExtension(f, tick)));
}
/** Largest extension in [lo, hi] whose limb does not enter the target; strike paths curve, so bisect. */
function settleAtSurface(f: SparringFighter, target: SparringFighter, tick: number, lo: number, hi: number): void {
  f.strikeStop = hi;
  if (limbDepth(f, target, tick) <= .002) return;
  f.strikeStop = lo;
  if (limbDepth(f, target, tick) > .002) { f.strikeStop = 0; return; } // Even the guard position touches; nothing shorter exists.
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; f.strikeStop = mid; if (limbDepth(f, target, tick) > .002) hi = mid; else lo = mid; }
  f.strikeStop = lo;
}



const hashInt = (...parts: number[]) => { let h = 2166136261; for (const p of parts) { h ^= p >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 15; } return h >>> 0; };
function finish(s: SparringState, winner: SparringSide | "draw", method: NonNullable<SparringState["method"]>): void {
  s.finished = true; s.phase = "finished"; s.phaseAt = s.tick; s.winner = winner; s.method = method; s.count = null;
}
/** Walk a fighter (not via inputs) toward a point; used for corners and neutral corners only. */
function walkTo(f: SparringFighter, x: number, z: number, faceX: number, faceZ: number, speed = 1.0): void {
  const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz), step = Math.min(d, speed / SPARRING_HZ);
  if (d > 1e-6) { f.x += dx / d * step; f.z += dz / d * step; }
  f.vx = d > .02 ? dx / d * speed : 0; f.vz = d > .02 ? dz / d * speed : 0;
  f.facing = angle(f.facing + clamp(angle(Math.atan2(faceX - f.x, faceZ - f.z) - f.facing), -.08, .08));
  f.action = d > .02 ? "move" : "idle"; f.phase = "idle"; f.buffered = null; f.comboCount = 0; f.landed = false;
}
function knockdown(s: SparringState, down: SparringFighter, by: SparringFighter): void {
  down.knockdowns++; down.roundKnockdowns++; down.daze = 0; down.buffered = null; down.stunUntil = 0;
  down.action = "knockdown"; down.phase = "knockdown"; down.actionAt = s.tick; down.actionUntil = s.tick + 100000;
  // The captured fall carries the body; the root does not slide as well.
  down.vx = 0; down.vz = 0;
  emit(s, by, "knockdown", { attack: null, reason: String(down.knockdowns) });
  // Three knockdowns in one bout stop the fight (TKO) without a count.
  if (down.knockdowns >= 3) { finish(s, by.id, "tko"); return; }
  // Rising count from the damage taken: deterministic per seed, tick and knockdown number.
  const rise = down.health <= 0 ? 10 : 2 + down.knockdowns * 2 + Math.floor((1000 - down.health) / 220) + hashInt(s.seed, s.tick, down.id) % 3;
  const startAt = s.tick + 30;
  s.phase = "count"; s.phaseAt = s.tick;
  // "Up at N": the rise starts early enough to be fully standing when the count reaches N (< 10).
  s.count = { fighter: down.id, startAt, standAt: rise >= 10 ? null : Math.max(startAt + 20, startAt + rise * SPARRING_COUNT_TICKS - SPARRING_GETUP_TICKS), n: 0 };
}
/** Closest point of a knocked-down fighter's body to (x, z). The licensed fall lands the pelvis ~1 m
 * behind the root: feet stay near the root, the head ends ~1.85 m behind it along the facing axis. */
export function lyingBodyPoint(f: Pick<SparringFighter, "x" | "z" | "facing">, x: number, z: number): [number, number] {
  const ux = Math.sin(f.facing), uz = Math.cos(f.facing), t = clamp((x - f.x) * ux + (z - f.z) * uz, -1.85, .15);
  return [f.x + ux * t, f.z + uz * t];
}
function stepCount(s: SparringState): void {
  const c = s.count!, down = s.fighters[c.fighter], other = s.fighters[c.fighter === 0 ? 1 : 0];
  down.vx *= .85; down.vz *= .85; down.x += down.vx / SPARRING_HZ; down.z += down.vz / SPARRING_HZ;
  // The standing fighter goes to the neutral corner farthest from the downed fighter.
  const corners = [[-2.6, 2.6], [2.6, -2.6]] as const, corner = corners.reduce((a, b) => Math.hypot(a[0] - down.x, a[1] - down.z) > Math.hypot(b[0] - down.x, b[1] - down.z) ? a : b);
  // Route around the lying body (see lyingBodyPoint), never over it.
  const [bx, bz] = lyingBodyPoint(down, other.x, other.z);
  let gx = corner[0] - other.x, gz = corner[1] - other.z; const gl = Math.max(.01, Math.hypot(gx, gz)); gx /= gl; gz /= gl;
  const rx = other.x - bx, rz = other.z - bz, rl = Math.max(.01, Math.hypot(rx, rz)), push = Math.max(0, 1.6 - rl) * 4;
  const wx = gx + rx / rl * push, wz = gz + rz / rl * push, wl = Math.max(.01, Math.hypot(wx, wz));
  walkTo(other, other.x + wx / wl * Math.min(gl, .5), other.z + wz / wl * Math.min(gl, .5), down.x, down.z, gl > .02 ? (rl < 1 ? 1.8 : 1.1) : 0);
  if (s.tick >= c.startAt) {
    const n = Math.floor((s.tick - c.startAt) / SPARRING_COUNT_TICKS) + 1;
    if (n !== c.n && n <= 10) { c.n = n; emit(s, other, "count", { reason: String(n), attack: null }); }
  }
  if (c.standAt !== null && s.tick === c.standAt) { down.action = "getup"; down.phase = "getup"; down.actionAt = s.tick; down.actionUntil = s.tick + SPARRING_GETUP_TICKS; emit(s, down, "getup", { attack: null }); }
  if (c.standAt === null && c.n >= 10) { emit(s, other, "knockout"); finish(s, other.id, "ko"); return; }
  // Mandatory eight count: the bout resumes once the fighter is up and the count reached eight.
  if (c.standAt !== null && c.n >= 8 && s.tick >= down.actionUntil) {
    for (const f of s.fighters) { f.action = "idle"; f.phase = "idle"; f.actionUntil = s.tick; f.stunUntil = 0; f.vx = f.vz = 0; f.stamina = Math.max(f.stamina, 400); }
    s.phase = "fight"; s.phaseAt = s.tick; s.count = null;
  }
}
function scoreRound(s: SparringState): void {
  const [a, b] = s.fighters, margin = a.roundDamage - b.roundDamage;
  // 10-point must: clean-damage winner 10-9 (even within 30 damage is 10-10), minus one per knockdown.
  let sa = 10, sb = 10;
  if (margin > 30) sb = 9; else if (margin < -30) sa = 9;
  sa -= a.roundKnockdowns; sb -= b.roundKnockdowns;
  s.scores = [...s.scores, [sa, sb]];
  emit(s, a, "roundend", { reason: `${s.round}:${sa}-${sb}`, attack: null });
  for (const f of s.fighters) { f.roundDamage = 0; f.roundKnockdowns = 0; }
}
function decide(s: SparringState): void {
  const total = s.scores.reduce((t, [x, y]) => [t[0]! + x, t[1]! + y], [0, 0]);
  const winner = total[0]! === total[1]! ? "draw" : total[0]! > total[1]! ? 0 : 1;
  emit(s, s.fighters[winner === 1 ? 1 : 0], "decision", { reason: `${total[0]}-${total[1]}`, attack: null });
  finish(s, winner, winner === "draw" ? "draw" : "decision");
}
function stepBreak(s: SparringState): void {
  const corners = [[-2.6, -2.6], [2.6, 2.6]] as const;
  // Arrive in the corner with time to spare, whatever the break length (0.6-2.4 m/s).
  const remaining = Math.max(.5, (s.breakTicks - (s.tick - s.phaseAt)) / SPARRING_HZ - .5);
  for (const f of s.fighters) walkTo(f, corners[f.id][0], corners[f.id][1], 0, 0, clamp(Math.hypot(corners[f.id][0] - f.x, corners[f.id][1] - f.z) / remaining * 1.2, .6, 2.4));
  if (s.tick - s.phaseAt >= s.breakTicks) {
    for (const f of s.fighters) {
      // Between-round recovery is bounded: a hurt fighter does not reset to fresh.
      f.health = Math.min(1000, f.health + 150); f.stamina = Math.min(1000, f.stamina + 350); f.daze = 0;
      f.action = "idle"; f.phase = "idle"; f.actionUntil = s.tick; f.stunUntil = 0; f.vx = f.vz = 0;
    }
    s.round++; s.roundTick = 0; s.phase = "fight"; s.phaseAt = s.tick;
    emit(s, s.fighters[0], "roundstart", { reason: String(s.round), attack: null });
  }
}
/** What the presentation-only official may see: public positions, lazily evaluated poses, who is down and how
 * close a fighter is to going down (he keeps out from behind a hurt fighter). Read-only; fighters never see him. */
function refereeWorld(s: SparringState): RefereeWorld {
  const view = (f: SparringFighter) => {
    const down = f.action === "knockdown" || f.action === "getup", ux = Math.sin(f.facing), uz = Math.cos(f.facing);
    let pose: SparringPose | undefined;
    return { x: f.x, z: f.z, vx: f.vx, vz: f.vz, facing: f.facing, down,
      lying: down ? [f.x - ux * 1.85, f.z - uz * 1.85, f.x + ux * .15, f.z + uz * .15] as const : null,
      // Same knockdown threshold as stepSparring: concussion share, or low health.
      risk: Math.min(1, Math.max(f.daze / (SPARRING_DAZE_KNOCKDOWN + f.health * .28), 1 - f.health / 500)),
      goal: goal(f), pose: () => pose ??= sparringPose(f, s.tick) };
  };
  // Where the engine walks a fighter (mirrors stepBreak's corners and stepCount's farthest neutral corner).
  const goal = (f: SparringFighter): readonly [number, number] | null => {
    if (s.phase === "break") return f.id === 0 ? [-2.6, -2.6] : [2.6, 2.6];
    if (s.phase !== "count" || !s.count || s.count.fighter === f.id) return null;
    const down = s.fighters[s.count.fighter], far = (x: number, z: number) => Math.hypot(x - down.x, z - down.z);
    return far(-2.6, 2.6) > far(2.6, -2.6) ? [-2.6, 2.6] : [2.6, -2.6];
  };
  return { tick: s.tick, phase: s.phase, countFighter: s.phase === "count" && s.count ? s.count.fighter : null, fighters: [view(s.fighters[0]), view(s.fighters[1])] };
}
function updateReferee(s: SparringState): void { s.referee = stepSparringReferee(s.referee, refereeWorld(s)); }
/** One fixed simulation tick. Inputs and prior state are never mutated. Render FPS is irrelevant. */
export function stepSparring(previous: SparringState, inputs: readonly [SparringInput, SparringInput]): SparringState {
  if (previous.version !== SPARRING_VERSION) throw new TypeError("Unsupported sparring version");
  validInput(inputs[0]); validInput(inputs[1]);
  if (previous.finished) return previous;
  const s: SparringState = { ...previous, tick: previous.tick + 1, events: [], fighters: previous.fighters.map(f => ({ ...f, buffered: f.buffered ? { ...f.buffered } : null })) as SparringState["fighters"],
    count: previous.count ? { ...previous.count } : null, referee: { ...previous.referee } };
  if (s.phase === "count") { stepCount(s); constrain(s); updateReferee(s); return s; }
  if (s.phase === "break") { stepBreak(s); constrain(s); updateReferee(s); return s; }
  s.roundTick++;
  const before = previous.fighters.map(f => sparringPose(f, previous.tick));
  for (const id of [0, 1] as const) updateFighter(s, s.fighters[id], previous.fighters[id === 0 ? 1 : 0], inputs[id]);
  constrain(s);
  const poses = s.fighters.map(f => sparringPose(f, s.tick));
  const impacts: { actor: SparringSide; target: SparringSide; blocked: boolean; counter: boolean; zone: "head" | "body"; damage: number; stun: number; push: number; point: SparringVec3; attack: SparringAttack }[] = [];
  for (const id of [0, 1] as const) {
    const f = s.fighters[id], target = id === 0 ? 1 : 0, other = s.fighters[target];
    if (!isAttack(f.action)) continue;
    const spec = SPARRING_ATTACKS[f.action];
    if (f.phase === "active" && !f.landed) {
      const limb = poses[id]!.striking!, was = sparringCapsules(before[target]!), now = sparringCapsules(poses[target]!);
      // sparring-5: swept glove sphere against head/torso capsules and, behind a raised guard, forearms and
      // gloves. Earliest contact wins; on an exact tie the guard (listed first) covers the target.
      const contacts = strikeTargets(other).flatMap((part, order) => {
        const time = sweepSphereCapsule(before[id]![limb], poses[id]![limb], was[part], now[part], limbRadius(limb));
        return time === null ? [] : [{ part, time, order }];
      }).sort((a, b) => a.time - b.time || a.order - b.order);
      if (contacts.length) {
        const contact = contacts[0]!, dir = Math.atan2(f.x - other.x, f.z - other.z);
        // Stop the limb at the struck surface (against this tick's target pose), not at full reach.
        settleAtSurface(f, other, s.tick, Math.min(strikeExtension(previous.fighters[id], previous.tick), strikeExtension(f, s.tick)), strikeExtension(f, s.tick));
        // Meeting the raised forearms/gloves first is a block; a facing guard still covers the target as before.
        const blocked = SPARRING_GUARD_PARTS.includes(contact.part) || (other.action === "guard" && Math.abs(angle(dir - other.facing)) < 1.25 && other.stamina >= 15);
        const counter = !blocked && (other.phase === "startup" || (other.phase === "recovery" && isAttack(other.action)));
        const repeatScale = Math.max(.45, 1 - f.repeatCount * .18), chainScale = 1 - Math.max(0, f.comboCount - 1) * .10;
        const damage = blocked ? Math.max(1, Math.floor(spec.damage * .055)) : Math.round(spec.damage * repeatScale * chainScale * (counter ? 1.18 : 1));
        impacts.push({ actor: id, target, blocked, counter, zone: contact.part === "head" ? "head" : "body", damage, stun: Math.max(6, Math.round(spec.stun * repeatScale)) + (counter ? 4 : 0), push: spec.push, point: lerpPoint(before[id]![limb], poses[id]![limb], contact.time), attack: f.action });
        f.landed = true; f.comboUntil = s.tick + 22;
      }
    }
    if (s.tick - f.actionAt === spec.startup + spec.active && !f.landed) {
      const actualSlip = other.action === "slip" && distance(f, other) < spec.reach + .3;
      emit(s, f, actualSlip ? "dodge" : "miss");
      f.comboUntil = 0;
    }
  }
  // Resolve a shared contact snapshot: simultaneous valid contacts trade fairly.
  for (const hit of impacts) {
    const f = s.fighters[hit.actor], other = s.fighters[hit.target];
    const actualDamage = Math.min(other.health, hit.damage);
    other.health -= actualDamage; f.damageDealt += actualDamage;
    other.lastHitAt = s.tick; other.lastHitKind = hit.blocked ? "block" : hit.zone;
    emit(s, f, hit.blocked ? "block" : "hit", { damage: actualDamage, point: hit.point, attack: hit.attack });
    if (hit.counter) emit(s, f, "counter", { point: hit.point, attack: hit.attack });
    if (hit.blocked) {
      // A block costs the defender less than the strike cost the attacker, and passive
      // defence pauses regeneration for half the normal delay; a full reset was a death spiral.
      other.blocks++; other.stamina = Math.max(0, other.stamina - Math.ceil(SPARRING_ATTACKS[hit.attack].cost * .40));
      other.lastSpendAt = Math.max(other.lastSpendAt, s.tick - 12);
      // Holding guard consumes a finite resource; it is not free permanent invulnerability.
      if (other.stamina === 0) { other.stunUntil = s.tick + 30; other.action = "hitstun"; other.phase = "hitstun"; other.buffered = null; emit(s, f, "guardbreak", { attack: hit.attack }); }
    } else {
      f.hits++; f.roundDamage += actualDamage; other.stunUntil = s.tick + hit.stun; other.actionUntil = other.stunUntil; other.actionAt = s.tick;
      other.daze += (hit.zone === "head" ? hit.damage : hit.damage * .35) * (hit.counter ? 1.5 : 1);
      other.action = "hitstun"; other.phase = "hitstun"; other.buffered = null; other.comboUntil = 0; other.landed = false;
      const d = Math.max(.01, distance(f, other)); other.vx = (other.x - f.x) / d * hit.push; other.vz = (other.z - f.z) / d * hit.push;
    }
  }
  for (const id of [0, 1] as const) retractFromBody(s.fighters[id], s.fighters[id === 0 ? 1 : 0], s.tick);
  const [a, b] = s.fighters;
  if (a.health <= 0 && b.health <= 0) {
    // Simultaneous exhaustion: both fall, the bout is stopped as a draw.
    for (const f of s.fighters) { f.action = "knockdown"; f.phase = "knockdown"; f.actionAt = s.tick; emit(s, s.fighters[f.id === 0 ? 1 : 0], "knockout"); }
    finish(s, "draw", "draw");
    return s;
  }
  for (const f of s.fighters) {
    const other = s.fighters[f.id === 0 ? 1 : 0];
    // A fresh fighter needs a heavier concussive sequence than a hurt one; exhausted health always drops.
    const threshold = SPARRING_DAZE_KNOCKDOWN + f.health * .28;
    if (s.phase === "fight" && (f.health <= 0 || f.daze >= threshold)) knockdown(s, f, other);
    f.daze = Math.max(0, f.daze - .8);
  }
  updateReferee(s);
  if (s.phase === "fight" && s.roundTick >= s.durationTicks) {
    scoreRound(s);
    if (s.round >= s.rounds) decide(s); else { s.phase = "break"; s.phaseAt = s.tick; }
  }
  return s;
}

/** Tactical scripted baseline for playability. Not trained or connectome-controlled. */
export function sparringBotInput(s: SparringState, side: SparringSide, style: "balanced" | "pressure" | "counter" = "balanced"): SparringInput {
  const me = s.fighters[side], other = s.fighters[side === 0 ? 1 : 0], d = distance(me, other);
  const input: SparringInput = { moveX: 0, moveZ: 0, guard: false, action: null };
  if (s.finished || s.phase !== "fight" || me.phase === "hitstun") return input;
  const dx = (other.x - me.x) / Math.max(d, .01), dz = (other.z - me.z) / Math.max(d, .01);
  const cycle = ((s.seed ^ (Math.floor(s.tick / 48) * 2654435761) ^ (side * 2246822519)) >>> 0) % 7;
  const threatening = isAttack(other.action) && other.phase === "startup" && s.tick - other.actionAt >= 3 && d < 1.4;
  // A whiffed or blocked strike leaves its thrower open; reachable means within a stepping jab/cross.
  const punishable = isAttack(other.action) && other.phase === "recovery" && !other.landed && d < 1.12;
  if (me.stamina < 180) {
    // Recover: guard only against a visible threat (guard halves regeneration), otherwise give ground.
    if (punishable && me.stamina >= SPARRING_ATTACKS.jab.cost) { input.action = "jab"; return input; }
    input.guard = threatening; input.moveX = -dx * .6; input.moveZ = -dz * .6; return input;
  }
  if (isAttack(me.action) && s.tick < me.actionUntil) {
    if (me.phase === "recovery" && me.landed && me.comboCount < 3 && me.stamina > 240) {
      const next: SparringAttack = me.action === "jab" ? "cross" : me.action === "cross" ? "hook" : "uppercut";
      if (canChain(me, next, s.tick + 1)) input.action = next;
    }
    return input;
  }
  if (punishable) { input.action = d < 1.0 ? "cross" : "jab"; return input; }
  if (threatening && style !== "pressure") { input.guard = true; if (cycle === 0 && me.stamina > 240) input.action = "slip"; return input; }
  if (d > 1.08) {
    // Cut off the ring: steer at where a retreating opponent will be, and close with a step when they run.
    const retreat = other.vx * dx + other.vz * dz, lead = Math.min(1.2, d / 1.35);
    const ax = other.x + other.vx * lead - me.x, az = other.z + other.vz * lead - me.z, al = Math.max(.01, Math.hypot(ax, az));
    input.moveX = ax / al; input.moveZ = az / al;
    if ((retreat > .3 && d < 2.4 && me.stamina > 450 && s.tick % 40 === side * 20) || (d > 2.2 && s.tick % 90 === side * 15 && me.stamina > 600)) input.action = "dash";
    return input;
  }
  if (d < .84) { input.moveX = -dx * .5; input.moveZ = -dz * .5; }
  if (style === "counter" && other.phase !== "recovery" && s.tick % 40 < 20) { input.guard = true; return input; }
  // Pace the output: below a reserve, only punish openings and work the feet/guard in range.
  const reserve = style === "pressure" ? 260 : 380;
  if (me.stamina < reserve) {
    const strafe = (Math.floor(s.tick / 70) + side) % 2 ? 1 : -1;
    input.guard = d < 1.15; input.moveX = -dz * strafe * .8 - dx * .25; input.moveZ = dx * strafe * .8 - dz * .25; return input;
  }
  // Boxing rules for the scripted corners: punches only, no kicks.
  const choices: readonly SparringAttack[] = d > 1.0 ? ["cross", "jab", "jab"] : ["jab", "cross", "hook", "uppercut", "jab", "hook", "cross"];
  input.action = choices[(cycle + (me.lastAttack === "jab" ? 1 : 0)) % choices.length]!;
  return input;
}
