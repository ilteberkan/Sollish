/** Non-monetary, input-driven prototype. No wagers, wallets or learned-policy claims. */
export const SPARRING_VERSION = "sparring-3" as const;
export const SPARRING_HZ = 60;
export const SPARRING_TICK_MS = 1000 / SPARRING_HZ;
export type SparringSide = 0 | 1;
export type SparringAttack = "jab" | "cross" | "hook" | "uppercut" | "roundhouse";
export type SparringCommand = SparringAttack | "slip" | "dash";
export type SparringAction = SparringCommand | "idle" | "move" | "guard" | "hitstun" | "knockdown";
export type SparringPhase = "idle" | "startup" | "active" | "recovery" | "hitstun" | "knockdown";
export type SparringVec3 = { x: number; y: number; z: number };
/** Movement is WORLD x/z, [-1,1]. action is a press edge; do not repeat it while held. */
export type SparringInput = { moveX: number; moveZ: number; guard: boolean; action?: SparringCommand | null; jump?: boolean };
export type SparringEvent = {
  id: number; tick: number; type: "attack" | "hit" | "block" | "dodge" | "miss" | "counter" | "combo" | "guardbreak" | "knockout" | "rejected";
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
};
export type SparringState = {
  version: typeof SPARRING_VERSION; seed: number; tick: number; durationTicks: number;
  fighters: [SparringFighter, SparringFighter]; events: SparringEvent[];
  nextEventId: number; nextAttackId: number; winner: SparringSide | "draw" | null; finished: boolean;
};
/** Metres, y-up; facing=0 points +z, facing=PI/2 points +x. */
export type SparringPose = {
  head: SparringVec3; chest: SparringVec3; pelvis: SparringVec3;
  leftHand: SparringVec3; rightHand: SparringVec3; leftFoot: SparringVec3; rightFoot: SparringVec3;
  leftElbow: SparringVec3; rightElbow: SparringVec3; leftKnee: SparringVec3; rightKnee: SparringVec3;
  striking: "leftHand" | "rightHand" | "rightFoot" | null;
};
/** step: metres the root travels forward during startup (weight transfer into the strike). */
export type SparringAttackSpec = { startup: number; active: number; recovery: number; cost: number; damage: number; reach: number; height: number; stun: number; push: number; step: number };
export const SPARRING_ATTACKS: Readonly<Record<SparringAttack, Readonly<SparringAttackSpec>>> = Object.freeze({
  jab: { startup: 6, active: 3, recovery: 13, cost: 65, damage: 36, reach: .76, height: 1.65, stun: 12, push: .65, step: .13 },
  cross: { startup: 10, active: 4, recovery: 19, cost: 100, damage: 56, reach: .78, height: 1.64, stun: 17, push: 1.0, step: .09 },
  hook: { startup: 12, active: 4, recovery: 20, cost: 115, damage: 62, reach: .72, height: 1.64, stun: 18, push: .85, step: .05 },
  uppercut: { startup: 11, active: 4, recovery: 21, cost: 110, damage: 60, reach: .64, height: 1.62, stun: 18, push: .75, step: .05 },
  roundhouse: { startup: 17, active: 5, recovery: 28, cost: 160, damage: 76, reach: .88, height: 1.12, stun: 21, push: 1.25, step: .07 },
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
    lastSpendAt: -1000, stunUntil: 0, counterUntil: 0, buffered: null, strikeStop: null, hits: 0, blocks: 0, damageDealt: 0 };
}
export function createSparring(seed: number, options: { durationSeconds?: number } = {}): SparringState {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Invalid sparring seed");
  const seconds = options.durationSeconds ?? 60;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError("Invalid sparring duration");
  return { version: SPARRING_VERSION, seed, tick: 0, durationTicks: seconds * SPARRING_HZ, fighters: [fighter(0), fighter(1)], events: [], nextEventId: 1, nextAttackId: 1, winner: null, finished: false };
}

/** Authoritative simplified targets; rendered authored clips are presentation, not hit detection. */
export function sparringPose(f: SparringFighter, tick: number): SparringPose {
  const age = Math.max(0, tick - f.actionAt);
  const slipping = f.action === "slip" ? Math.sin(Math.PI * clamp(age / 20, 0, 1)) : 0;
  const side = f.id === 0 ? 1 : -1;
  const headX = .30 * slipping * side, duck = .20 * slipping;
  const pose: SparringPose = {
    head: point(f, headX, 1.65 - duck, .06), chest: point(f, headX * .4, 1.24 - duck * .45, .03), pelvis: point(f, 0, .89, 0),
    leftHand: point(f, -.15, 1.55 - duck * .6, .30), rightHand: point(f, .15, 1.55 - duck * .6, .26),
    leftFoot: point(f, -.18, .07, .12), rightFoot: point(f, .19, .07, -.17),
    leftElbow: point(f, -.30, 1.26, .08), rightElbow: point(f, .30, 1.26, .02),
    leftKnee: point(f, -.18, .47, .16), rightKnee: point(f, .19, .47, -.08), striking: null,
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

function constrain(fighters: [SparringFighter, SparringFighter]): void {
  for (const f of fighters) { f.x = clamp(f.x, -RING, RING); f.z = clamp(f.z, -RING, RING); }
  const [a, b] = fighters, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (d >= BODY_DISTANCE) return;
  const nx = d > 1e-8 ? dx / d : 1, nz = d > 1e-8 ? dz / d : 0, required = BODY_DISTANCE - d;
  const room = (f: SparringFighter, x: number, z: number) => Math.max(0, Math.min(
    x > 1e-12 ? (RING - f.x) / x : x < -1e-12 ? (-RING - f.x) / x : Infinity,
    z > 1e-12 ? (RING - f.z) / z : z < -1e-12 ? (-RING - f.z) / z : Infinity));
  // The wall-bounded fighter's share transfers to the other root; no residual overlap.
  const availableA = room(a, -nx, -nz), availableB = room(b, nx, nz);
  let moveA = Math.min(required / 2, availableA);
  const moveB = Math.min(required - moveA, availableB);
  moveA += Math.min(required - moveA - moveB, availableA - moveA);
  a.x -= nx * moveA; a.z -= nz * moveA; b.x += nx * moveB; b.z += nz * moveB;
}

const HURT_ZONES = [["head", .16], ["chest", .24]] as const;
const limbRadius = (limb: "leftHand" | "rightHand" | "rightFoot") => limb === "rightFoot" ? .12 : .095;
function limbDepth(f: SparringFighter, target: SparringFighter, tick: number): number {
  const pose = sparringPose(f, tick);
  if (!pose.striking) return 0;
  const limb = pose[pose.striking], body = sparringPose(target, tick);
  return Math.max(...HURT_ZONES.map(([zone, r]) => r + limbRadius(pose.striking!) - Math.hypot(limb.x - body[zone].x, limb.y - body[zone].y, limb.z - body[zone].z)));
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

/** Relative-motion sweep: both the striking limb and defender volume can move. */
function sweep(a: SparringVec3, b: SparringVec3, c: SparringVec3, d: SparringVec3, radius: number): number | null {
  const x = a.x - c.x, y = a.y - c.y, z = a.z - c.z;
  const dx = b.x - a.x - d.x + c.x, dy = b.y - a.y - d.y + c.y, dz = b.z - a.z - d.z + c.z;
  const cc = x * x + y * y + z * z - radius * radius;
  if (cc <= 0) return 0;
  const aa = dx * dx + dy * dy + dz * dz; if (aa < 1e-12) return null;
  const bb = 2 * (x * dx + y * dy + z * dz), discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < 0) return null;
  const t = (-bb - Math.sqrt(discriminant)) / (2 * aa); return t >= 0 && t <= 1 ? t : null;
}

/** One fixed simulation tick. Inputs and prior state are never mutated. Render FPS is irrelevant. */
export function stepSparring(previous: SparringState, inputs: readonly [SparringInput, SparringInput]): SparringState {
  if (previous.version !== SPARRING_VERSION) throw new TypeError("Unsupported sparring version");
  validInput(inputs[0]); validInput(inputs[1]);
  if (previous.finished) return previous;
  const s: SparringState = { ...previous, tick: previous.tick + 1, events: [], fighters: previous.fighters.map(f => ({ ...f, buffered: f.buffered ? { ...f.buffered } : null })) as SparringState["fighters"] };
  const before = previous.fighters.map(f => sparringPose(f, previous.tick));
  for (const id of [0, 1] as const) updateFighter(s, s.fighters[id], previous.fighters[id === 0 ? 1 : 0], inputs[id]);
  constrain(s.fighters);
  const poses = s.fighters.map(f => sparringPose(f, s.tick));
  const impacts: { actor: SparringSide; target: SparringSide; blocked: boolean; counter: boolean; zone: "head" | "body"; damage: number; stun: number; push: number; point: SparringVec3; attack: SparringAttack }[] = [];
  for (const id of [0, 1] as const) {
    const f = s.fighters[id], target = id === 0 ? 1 : 0, other = s.fighters[target];
    if (!isAttack(f.action)) continue;
    const spec = SPARRING_ATTACKS[f.action];
    if (f.phase === "active" && !f.landed) {
      const limb = poses[id]!.striking!;
      const contacts = ([ ["head", .16], ["chest", .24] ] as const).flatMap(([zone, radius]) => {
        const time = sweep(before[id]![limb], poses[id]![limb], before[target]![zone], poses[target]![zone], radius + (limb === "rightFoot" ? .12 : .095));
        return time === null ? [] : [{ zone, time }];
      }).sort((a, b) => a.time - b.time);
      if (contacts.length) {
        const contact = contacts[0]!, dir = Math.atan2(f.x - other.x, f.z - other.z);
        // Stop the limb at the struck surface (against this tick's target pose), not at full reach.
        settleAtSurface(f, other, s.tick, Math.min(strikeExtension(previous.fighters[id], previous.tick), strikeExtension(f, s.tick)), strikeExtension(f, s.tick));
        const blocked = other.action === "guard" && Math.abs(angle(dir - other.facing)) < 1.25 && other.stamina >= 15;
        const counter = !blocked && (other.phase === "startup" || (other.phase === "recovery" && isAttack(other.action)));
        const repeatScale = Math.max(.45, 1 - f.repeatCount * .18), chainScale = 1 - Math.max(0, f.comboCount - 1) * .10;
        const damage = blocked ? Math.max(1, Math.floor(spec.damage * .055)) : Math.round(spec.damage * repeatScale * chainScale * (counter ? 1.18 : 1));
        impacts.push({ actor: id, target, blocked, counter, zone: contact.zone === "head" ? "head" : "body", damage, stun: Math.max(6, Math.round(spec.stun * repeatScale)) + (counter ? 4 : 0), push: spec.push, point: lerpPoint(before[id]![limb], poses[id]![limb], contact.time), attack: f.action });
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
      f.hits++; other.stunUntil = s.tick + hit.stun; other.actionUntil = other.stunUntil; other.actionAt = s.tick;
      other.action = "hitstun"; other.phase = "hitstun"; other.buffered = null; other.comboUntil = 0; other.landed = false;
      const d = Math.max(.01, distance(f, other)); other.vx = (other.x - f.x) / d * hit.push; other.vz = (other.z - f.z) / d * hit.push;
    }
  }
  for (const id of [0, 1] as const) retractFromBody(s.fighters[id], s.fighters[id === 0 ? 1 : 0], s.tick);
  if (s.fighters.some(f => f.health <= 0) || s.tick >= s.durationTicks) {
    s.finished = true;
    const [a, b] = s.fighters; s.winner = a.health === b.health ? "draw" : a.health > b.health ? 0 : 1;
    for (const f of s.fighters) if (f.health === 0) { f.action = "knockdown"; f.phase = "knockdown"; f.actionAt = s.tick; emit(s, s.fighters[f.id === 0 ? 1 : 0], "knockout"); }
  }
  return s;
}

/** Tactical scripted baseline for playability. Not trained or connectome-controlled. */
export function sparringBotInput(s: SparringState, side: SparringSide, style: "balanced" | "pressure" | "counter" = "balanced"): SparringInput {
  const me = s.fighters[side], other = s.fighters[side === 0 ? 1 : 0], d = distance(me, other);
  const input: SparringInput = { moveX: 0, moveZ: 0, guard: false, action: null };
  if (s.finished || me.phase === "hitstun") return input;
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
