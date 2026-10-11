/** Non-monetary, input-driven prototype. No wagers, wallets or learned-policy claims. */
export const SPARRING_VERSION = "sparring-1" as const;
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
export type SparringAttackSpec = { startup: number; active: number; recovery: number; cost: number; damage: number; reach: number; height: number; stun: number; push: number };
export const SPARRING_ATTACKS: Readonly<Record<SparringAttack, Readonly<SparringAttackSpec>>> = Object.freeze({
  jab: { startup: 6, active: 3, recovery: 13, cost: 65, damage: 55, reach: .76, height: 1.65, stun: 12, push: .65 },
  cross: { startup: 10, active: 4, recovery: 19, cost: 100, damage: 88, reach: .78, height: 1.64, stun: 17, push: 1.0 },
  hook: { startup: 12, active: 4, recovery: 20, cost: 115, damage: 95, reach: .72, height: 1.64, stun: 18, push: .85 },
  uppercut: { startup: 11, active: 4, recovery: 21, cost: 110, damage: 92, reach: .64, height: 1.62, stun: 18, push: .75 },
  roundhouse: { startup: 17, active: 5, recovery: 28, cost: 160, damage: 118, reach: .88, height: 1.12, stun: 21, push: 1.25 },
});
for (const spec of Object.values(SPARRING_ATTACKS)) Object.freeze(spec);

export const SPARRING_NEUTRAL_INPUT: Readonly<SparringInput> = Object.freeze({ moveX: 0, moveZ: 0, guard: false, action: null });
const RING = 3.15, BODY_DISTANCE = .64, BUFFER_TICKS = 8;
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
    lastSpendAt: -1000, stunUntil: 0, counterUntil: 0, buffered: null, hits: 0, blocks: 0, damageDealt: 0 };
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
  // Anticipation loads the limb before its active sweep; recovery has no damage authority.
  const t = age < s.startup ? 0 : age < s.startup + s.active ? clamp((age - s.startup + 1) / s.active, 0, 1) : 1 - clamp((age - s.startup - s.active) / Math.min(s.recovery, 12), 0, 1);
  const limb = f.action === "jab" || f.action === "hook" ? "leftHand" : f.action === "roundhouse" ? "rightFoot" : "rightHand";
  pose.striking = limb;
  let lateral = limb === "leftHand" ? -.06 : .04;
  if (f.action === "hook") lateral += -.36 * Math.sin(Math.PI * t);
  let height = s.height;
  if (f.action === "uppercut") height = 1.05 + .57 * t;
  if (limb === "rightFoot") {
    const rest = pose.rightFoot, chamber = point(f, .20, .82, .18);
    if (age < s.startup) {
      const load = clamp(age / s.startup, 0, 1);
      pose.rightFoot = load < .7 ? lerpPoint(rest, chamber, load / .7) : lerpPoint(chamber, point(f, .42, s.height, 0), (load - .7) / .3);
    } else if (age < s.startup + s.active) {
      const arc = clamp((age - s.startup + 1) / s.active, 0, 1);
      // A sweep across the body, not constant forward reach plus an extra lateral extension.
      pose.rightFoot = point(f, .42 * Math.cos(Math.PI * arc), s.height, s.reach * Math.sin(Math.PI * arc));
    } else {
      pose.rightFoot = lerpPoint(point(f, -.42, s.height, 0), rest, clamp((age - s.startup - s.active) / Math.min(16, s.recovery), 0, 1));
    }
    pose.rightKnee = point(f, .24, .47 + .40 * clamp((pose.rightFoot.y - f.y - .07) / .75, 0, 1), .35);
    return pose;
  }
  pose[limb] = lerpPoint(pose[limb], point(f, lateral, height, s.reach), t);
  return pose;
}

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
  const cost = isAttack(command) ? SPARRING_ATTACKS[command].cost : command === "slip" ? 75 : 120;
  if (f.stamina < cost) { emit(s, f, "rejected", { reason: "stamina", attack: isAttack(command) ? command : null }); return false; }
  f.stamina -= cost; f.lastSpendAt = s.tick;
  if (isAttack(command)) {
    f.repeatCount = f.lastAttack === command && s.tick <= f.counterUntil + 75 ? f.repeatCount + 1 : 0;
    f.lastAttack = command; f.comboCount = chain ? f.comboCount + 1 : 1;
    f.actionUntil = s.tick + total(command); f.attackId = s.nextAttackId++; f.landed = false;
    f.comboUntil = 0; f.counterUntil = f.actionUntil + 8;
    if (chain) emit(s, f, "combo", { attack: command });
  } else {
    f.actionUntil = s.tick + (command === "slip" ? 20 : 16); f.comboCount = 0; f.comboUntil = 0;
    if (command === "dash") {
      const length = Math.hypot(input.moveX, input.moveZ);
      f.vx = length > .05 ? input.moveX / length * 4 : -Math.sin(f.facing) * 4;
      f.vz = length > .05 ? input.moveZ / length * 4 : -Math.cos(f.facing) * 4;
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
    // Committed facing and a small, finite early step; no homing once started.
    const lunge = age < Math.min(4, spec.startup) ? .50 : 0;
    if (f.y > 0) { f.vx *= .995; f.vz *= .995; }
    else { f.vx = Math.sin(f.facing) * lunge; f.vz = Math.cos(f.facing) * lunge; }
  } else if (f.action === "slip") { f.phase = s.tick - f.actionAt < 4 ? "startup" : s.tick - f.actionAt < 14 ? "active" : "recovery"; f.vx *= .6; f.vz *= .6; }
  else if (f.action === "dash") { f.phase = s.tick - f.actionAt < 3 ? "startup" : s.tick - f.actionAt < 10 ? "active" : "recovery"; f.vx *= .92; f.vz *= .92; }
  else {
    const desired = Math.atan2(opponent.x - f.x, opponent.z - f.z);
    f.facing = angle(f.facing + clamp(angle(desired - f.facing), -.12, .12));
    const length = Math.max(1, Math.hypot(input.moveX, input.moveZ)), speed = input.guard ? .75 : 1.85;
    f.vx += clamp(input.moveX / length * speed - f.vx, -.22, .22);
    f.vz += clamp(input.moveZ / length * speed - f.vz, -.22, .22);
  }
  f.x += f.vx / SPARRING_HZ; f.z += f.vz / SPARRING_HZ;
  if (f.y === 0 && !isAttack(f.action) && f.action !== "slip" && f.action !== "dash" && s.tick - f.lastSpendAt >= 24) f.stamina = Math.min(1000, f.stamina + (input.guard ? 2 : 4));
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
      other.blocks++; other.stamina = Math.max(0, other.stamina - Math.ceil(SPARRING_ATTACKS[hit.attack].cost * .65)); other.lastSpendAt = s.tick;
      // Holding guard consumes a finite resource; it is not free permanent invulnerability.
      if (other.stamina === 0) { other.stunUntil = s.tick + 30; other.action = "hitstun"; other.phase = "hitstun"; other.buffered = null; emit(s, f, "guardbreak", { attack: hit.attack }); }
    } else {
      f.hits++; other.stunUntil = s.tick + hit.stun; other.actionUntil = other.stunUntil; other.actionAt = s.tick;
      other.action = "hitstun"; other.phase = "hitstun"; other.buffered = null; other.comboUntil = 0; other.landed = false;
      const d = Math.max(.01, distance(f, other)); other.vx = (other.x - f.x) / d * hit.push; other.vz = (other.z - f.z) / d * hit.push;
    }
  }
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
  if (me.stamina < 180) { input.guard = true; input.moveX = -dx * .45; input.moveZ = -dz * .45; return input; }
  if (isAttack(me.action) && s.tick < me.actionUntil) {
    if (me.phase === "recovery" && me.landed && me.comboCount < 3 && me.stamina > 240) {
      const next: SparringAttack = me.action === "jab" ? "cross" : me.action === "cross" ? "hook" : "uppercut";
      if (canChain(me, next, s.tick + 1)) input.action = next;
    }
    return input;
  }
  const threatening = isAttack(other.action) && other.phase === "startup" && s.tick - other.actionAt >= 3 && d < 1.4;
  if (threatening && style !== "pressure") { input.guard = true; if (cycle === 0 && me.stamina > 240) input.action = "slip"; return input; }
  if (d > 1.02) { input.moveX = dx; input.moveZ = dz; if (d > 2.2 && s.tick % 90 === side * 15 && me.stamina > 600) input.action = "dash"; return input; }
  if (d < .73) { input.moveX = -dx * .5; input.moveZ = -dz * .5; }
  if (style === "counter" && other.phase !== "recovery" && s.tick % 40 < 20) { input.guard = true; return input; }
  const choices: readonly SparringAttack[] = d > .95 ? ["cross", "roundhouse", "jab"] : ["jab", "cross", "hook", "uppercut", "jab", "roundhouse", "cross"];
  input.action = choices[(cycle + (me.lastAttack === "jab" ? 1 : 0)) % choices.length]!;
  return input;
}
