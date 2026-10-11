/**
 * Fighting style ("character") for the non-monetary Combat Club: one closed vocabulary shared by the
 * learned NeuroBoxer v2 strategist (neuro-2) and the optional TypeSafe Jev style layer. A style is only
 * a label handed to a fighter's controller. It never carries wagers, balances, identities, private
 * session data or seeds, and it has no authority over contact, damage, scoring or results.
 *
 * Style layer (style-log-1). An external strategist (TypeSafe Jev through the server route, the
 * deterministic fallbackStyle rule, or a hash-pinned cache of recorded Jev answers) commits a style for a
 * corner at fixed points: before tick 0, at every roundend for the next roundstart, and every 900 fight
 * ticks mid-round with a 120-tick lead. The simulation waits at a decision's applyTick until it is
 * committed, so a bout is a pure function of (engine version, seed, bout options, corners, decision log).
 * Network timing only changes when frames are drawn, never the result. Learned-strategist (neuro) style
 * changes are logged too; replay recomputes and checks them.
 */
import { createSparring, stepSparring, SPARRING_HZ, SPARRING_VERSION, type SparringEvent, type SparringInput, type SparringSide, type SparringState } from "./combat-sparring";

export const FIGHT_STYLES = ["pressure", "counter", "cautious", "outboxer", "body", "finisher"] as const;
export type FightStyle = typeof FIGHT_STYLES[number];
export const FIGHT_STYLE_LABELS: Readonly<Record<FightStyle, string>> = Object.freeze({
  pressure: "Baskıcı", counter: "Kontracı", cautious: "Temkinli", outboxer: "Mesafeci", body: "Gövdeci", finisher: "Bitirici",
});
export const isFightStyle = (value: unknown): value is FightStyle => typeof value === "string" && (FIGHT_STYLES as readonly string[]).includes(value);

/** Who committed a style: the learned strategist head, TypeSafe Jev, the deterministic fallback rule, or a hash-pinned cached table. */
export const STYLE_SOURCES = ["neuro", "jev", "fallback", "cache"] as const;
export type StyleSource = typeof STYLE_SOURCES[number];
export const isStyleSource = (value: unknown): value is StyleSource => typeof value === "string" && (STYLE_SOURCES as readonly string[]).includes(value);
export const STYLE_SOURCE_LABELS: Readonly<Record<StyleSource, string>> = Object.freeze({ neuro: "öğrenilmiş", jev: "Jev", fallback: "yedek kural", cache: "önbellek" });
export type StyleDecision = {
  side: SparringSide;
  /** Engine tick whose public state the decision was made from. */
  requestTick: number;
  /** First engine tick the style applies to (>= requestTick). The simulation waits here until the decision is committed. */
  applyTick: number;
  style: FightStyle;
  source: StyleSource;
  /** Pinned provider model id (jev, cache), controller version (neuro), or null (fallback). */
  model: string | null;
  confidence: number | null;
  /** SHA-256 (hex) of the canonical public observation at requestTick (see canonicalJson, styleObsHash). */
  obsHash: string;
};
export const STYLE_LOG_VERSION = "style-log-1" as const;

/** Decision schedule in engine ticks (60 Hz): mid-round every 15 s of fight time, applied 2 s later. */
export const STYLE_MIDROUND_TICKS = 900, STYLE_MIDROUND_LEAD_TICKS = 120;
/** The "recent" counts of an observation cover the last 15 s of simulated time (all phases). */
export const STYLE_WINDOW_TICKS = 900;

// ---------------------------------------------------------------------------------------------------
// Public observation: what a corner (and an external advisor) may know when a style is chosen.

/** "learned" marks the observation logged with a learned-strategist change; Jev is asked only at the other three. */
export const STYLE_POINTS = ["start", "midround", "roundend", "learned"] as const;
export type StylePoint = typeof STYLE_POINTS[number];
export type StyleRequestPointKind = Exclude<StylePoint, "learned">;
/** A fighter's own punches in the window: thrown, landed clean, blocked by the other's guard, slipped by the other, counter hits landed. */
export type StyleRecent = { thrown: number; landed: number; blocked: number; slipped: number; counters: number };
export type StyleFighterObservation = { health: number; stamina: number; knockdowns: number; cardPoints: number; recent: StyleRecent };
/** Integers and closed enums only. No seed, tick, future state, positions, wagers, balances or identities. */
export type StyleObservation = { point: StylePoint; round: number; rounds: number; roundSecondsLeft: number; me: StyleFighterObservation; opponent: StyleFighterObservation };
export const STYLE_OBSERVATION_KEYS = ["me", "opponent", "point", "round", "roundSecondsLeft", "rounds"] as const;
export const STYLE_FIGHTER_KEYS = ["cardPoints", "health", "knockdowns", "recent", "stamina"] as const;
export const STYLE_RECENT_KEYS = ["blocked", "counters", "landed", "slipped", "thrown"] as const;

const RECENT_OF: Readonly<Partial<Record<SparringEvent["type"], keyof StyleRecent>>> = Object.freeze({ attack: "thrown", hit: "landed", block: "blocked", dodge: "slipped", counter: "counters" });
/**
 * Event history for observations. s.events holds only the events of the step that produced s, so the
 * history must see every tick exactly once and in order (tick 0 included); a gap or repeat throws.
 */
export type StyleHistory = { tick: number; events: { tick: number; actor: SparringSide; kind: keyof StyleRecent }[] };
export const createStyleHistory = (): StyleHistory => ({ tick: -1, events: [] });
export function recordStyleEvents(history: StyleHistory, s: Readonly<SparringState>): void {
  if (s.tick !== history.tick + 1) throw new RangeError("Style history must record every tick once, in order");
  for (const e of s.events) { const kind = RECENT_OF[e.type]; if (kind) history.events.push({ tick: s.tick, actor: e.actor, kind }); }
  let drop = 0; while (drop < history.events.length && history.events[drop]!.tick <= s.tick - STYLE_WINDOW_TICKS) drop++;
  if (drop) history.events.splice(0, drop);
  history.tick = s.tick;
}
const whole = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
/** Public match state at s.tick from side's point of view. The history must be exactly at s.tick (never ahead). */
export function styleObservation(s: Readonly<SparringState>, side: SparringSide, history: Readonly<StyleHistory>, point: StylePoint): StyleObservation {
  if (history.tick !== s.tick) throw new RangeError("Style history is not at this tick");
  const view = (id: SparringSide): StyleFighterObservation => {
    const f = s.fighters[id], recent: StyleRecent = { thrown: 0, landed: 0, blocked: 0, slipped: 0, counters: 0 };
    for (const e of history.events) if (e.actor === id) recent[e.kind]++;
    return { health: whole(f.health, 1000), stamina: whole(f.stamina, 1000), knockdowns: f.knockdowns, cardPoints: s.scores.reduce((t, card) => t + card[id], 0), recent };
  };
  return { point, round: s.round, rounds: s.rounds, roundSecondsLeft: Math.max(0, Math.ceil((s.durationTicks - s.roundTick) / SPARRING_HZ)), me: view(side), opponent: view(side === 0 ? 1 : 0) };
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const int = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
/** Closed-schema parse of an untrusted observation (server route, imported data). Returns a fresh copy or null. */
export function parseStyleObservation(value: unknown, points: readonly StylePoint[] = STYLE_POINTS): StyleObservation | null {
  if (!record(value) || !exactKeys(value, STYLE_OBSERVATION_KEYS) || typeof value.point !== "string" || !points.includes(value.point as StylePoint)
    || !int(value.rounds, 1, 12) || !int(value.round, 1, value.rounds as number) || !int(value.roundSecondsLeft, 0, 300)) return null;
  const fighter = (f: unknown): StyleFighterObservation | null => {
    if (!record(f) || !exactKeys(f, STYLE_FIGHTER_KEYS) || !int(f.health, 0, 1000) || !int(f.stamina, 0, 1000) || !int(f.knockdowns, 0, 99) || !int(f.cardPoints, 0, 120)) return null;
    const r = f.recent;
    if (!record(r) || !exactKeys(r, STYLE_RECENT_KEYS) || !STYLE_RECENT_KEYS.every(k => int(r[k], 0, 999))) return null;
    return { health: f.health, stamina: f.stamina, knockdowns: f.knockdowns, cardPoints: f.cardPoints,
      recent: { thrown: r.thrown as number, landed: r.landed as number, blocked: r.blocked as number, slipped: r.slipped as number, counters: r.counters as number } };
  };
  const me = fighter(value.me), opponent = fighter(value.opponent);
  return me && opponent ? { point: value.point as StylePoint, round: value.round, rounds: value.rounds, roundSecondsLeft: value.roundSecondsLeft, me, opponent } : null;
}

// ---------------------------------------------------------------------------------------------------
// Canonical hash. canonicalJson: object keys sorted by UTF-16 code units (Array.prototype.sort default),
// no whitespace, strings via JSON.stringify, numbers in ECMAScript's shortest round-trip form (observations
// are integers only). obsHash = lowercase hex SHA-256 (FIPS 180-4) of the UTF-8 bytes of that text.
// Pure and synchronous so the browser, the server and replay compute the same digest without WebCrypto.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("Non-finite number"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  throw new TypeError("Value has no canonical JSON form");
}
const K256 = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
/** Lowercase hex SHA-256 of the UTF-8 encoding of text. */
export function sha256Utf8Hex(text: string): string {
  const bytes = new TextEncoder().encode(text), blocks = new Uint8Array(((bytes.length + 72) >> 6) << 6), view = new DataView(blocks.buffer);
  blocks.set(bytes); blocks[bytes.length] = 0x80;
  view.setUint32(blocks.length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(blocks.length - 4, (bytes.length << 3) >>> 0);
  const H = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19), W = new Uint32Array(64);
  for (let off = 0; off < blocks.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]!, b = W[i - 2]!;
      W[i] = (W[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i]! + W[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = H[0]! + a; H[1] = H[1]! + b; H[2] = H[2]! + c; H[3] = H[3]! + d; H[4] = H[4]! + e; H[5] = H[5]! + f; H[6] = H[6]! + g; H[7] = H[7]! + h;
  }
  return Array.from(H, x => x.toString(16).padStart(8, "0")).join("");
}
export const styleObsHash = (observation: Readonly<StyleObservation>): string => sha256Utf8Hex(canonicalJson(observation));

/**
 * Deterministic fallback, committed when an external answer is missing, invalid or late. Authored rule,
 * not learned; first match wins. Thresholds are on the 0..1000 health/stamina scale.
 */
export function fallbackStyle(o: Readonly<StyleObservation>): FightStyle {
  const me = o.me, op = o.opponent, mine = me.recent, theirs = op.recent;
  if (op.health <= 300 && me.health >= op.health + 150) return "finisher"; // badly hurt opponent: go for the stoppage
  if (me.health <= 300 || me.stamina <= 200) return "cautious"; // hurt or empty: recover behind the guard
  if (o.round >= o.rounds && me.cardPoints < op.cardPoints) return "pressure"; // behind on the cards with the last round left
  if (theirs.counters >= 2 && theirs.counters * 3 >= mine.thrown) return "outboxer"; // being countered: stop leading in close
  if (theirs.thrown >= 8 && theirs.landed * 3 <= theirs.thrown) return "counter"; // busy but inaccurate opponent
  if (mine.blocked >= 4 && mine.blocked >= mine.landed) return "body"; // the guard takes the head punches: go downstairs
  if (theirs.thrown <= 3 || op.stamina <= 300) return "pressure"; // passive or tiring opponent
  return me.health >= op.health ? "outboxer" : "pressure";
}

// ---------------------------------------------------------------------------------------------------
// Schedule.

export type StyleRequestPoint = { point: StyleRequestPointKind; requestTick: number; applyTick: number };
/**
 * The decision point reached by the step prev -> s, if any (prev null: the initial state). Start: tick 0,
 * applied at 0. Roundend: applied at the next roundstart (roundend tick + breakTicks; never after the last
 * round). Mid-round: whenever roundTick reaches a positive multiple of STYLE_MIDROUND_TICKS before the
 * round's end (counts freeze roundTick), applied STYLE_MIDROUND_LEAD_TICKS later.
 */
export function styleDecisionPoint(prev: Readonly<SparringState> | null, s: Readonly<SparringState>): StyleRequestPoint | null {
  if (!prev) return s.tick === 0 ? { point: "start", requestTick: 0, applyTick: 0 } : null;
  if (s.finished) return null;
  if (s.phase === "break" && s.events.some(e => e.type === "roundend")) return { point: "roundend", requestTick: s.tick, applyTick: s.tick + s.breakTicks };
  if (s.roundTick !== prev.roundTick && s.roundTick > 0 && s.roundTick % STYLE_MIDROUND_TICKS === 0 && s.roundTick < s.durationTicks)
    return { point: "midround", requestTick: s.tick, applyTick: s.tick + STYLE_MIDROUND_LEAD_TICKS };
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Session: live bouts, tests and replay share one deterministic machine.

/** learned: the corner's own strategist head (neuro decisions are logged); jev / cache: external commits. */
export const STYLE_STRATEGISTS = ["learned", "jev", "cache"] as const;
export type StyleStrategist = typeof STYLE_STRATEGISTS[number];
/** controller/model identify the policy (e.g. "neuro-2" + its theta hash); null strategist: no style layer. */
export type StyleCornerSpec = { controller: string; model: string | null; strategist: StyleStrategist | null };
export type StyleBout = { durationSeconds: number; rounds: number; breakSeconds: number };
/** Replay = (engine version, seed, bout, corners, decision log). Network timing never enters it. */
export type StyleDecisionLog = { version: typeof STYLE_LOG_VERSION; engine: string; seed: number; bout: StyleBout; corners: [StyleCornerSpec, StyleCornerSpec]; decisions: StyleDecision[] };
const SOURCES_FOR: Readonly<Record<StyleStrategist, readonly StyleSource[]>> = Object.freeze({ learned: ["neuro"], jev: ["jev", "fallback"], cache: ["cache", "fallback"] });
export const isExternalCorner = (corner: Readonly<StyleCornerSpec>) => corner.strategist === "jev" || corner.strategist === "cache";

export type StyleRequest = { side: SparringSide; requestTick: number; applyTick: number; point: StyleRequestPointKind; observation: StyleObservation; obsHash: string };
export type StyleCommit = { style: FightStyle; source: Exclude<StyleSource, "neuro">; model: string | null; confidence: number | null };
/** learned: report a style the controller's own strategist just committed (logged as source "neuro"). */
export type StyleControllerResult = { input: SparringInput; learned?: { style: FightStyle; confidence: number | null; model: string } | null };
/** Called every tick for both corners (counts and breaks included); committed is the external style in force. */
export type StyleController = (s: Readonly<SparringState>, side: SparringSide, committed: FightStyle | null) => StyleControllerResult;
export type StyleSession = {
  readonly seed: number; readonly bout: Readonly<StyleBout>; readonly corners: readonly [StyleCornerSpec, StyleCornerSpec]; readonly external: readonly [boolean, boolean];
  state: SparringState; history: StyleHistory;
  /** Style each corner was handed on the last step (null: none yet, or no style layer). */
  styles: [FightStyle | null, FightStyle | null];
  /** Requests awaiting a commit (at most one per external corner can block). */
  pending: StyleRequest[];
  /** Canonical log order: (requestTick, side) strictly increasing. */
  decisions: StyleDecision[];
};

const ID = /^[a-z0-9][a-z0-9.:@_-]{0,79}$/;
function validCorner(c: unknown): c is StyleCornerSpec {
  return record(c) && exactKeys(c, ["controller", "model", "strategist"]) && typeof c.controller === "string" && ID.test(c.controller)
    && (c.model === null || (typeof c.model === "string" && ID.test(c.model))) && (c.strategist === null || (STYLE_STRATEGISTS as readonly unknown[]).includes(c.strategist));
}
const validBout = (b: unknown): b is StyleBout => record(b) && exactKeys(b, ["durationSeconds", "rounds", "breakSeconds"]) && int(b.durationSeconds, 1, 300) && int(b.rounds, 1, 12) && int(b.breakSeconds, 1, 60);

export function createStyleSession(seed: number, bout: StyleBout, corners: readonly [StyleCornerSpec, StyleCornerSpec]): StyleSession {
  if (!validBout(bout) || corners.length !== 2 || !corners.every(validCorner)) throw new TypeError("Invalid style session setup");
  const state = createSparring(seed, bout), history = createStyleHistory(); recordStyleEvents(history, state);
  const session: StyleSession = { seed, bout: Object.freeze({ ...bout }), corners: Object.freeze([{ ...corners[0] }, { ...corners[1] }] as [StyleCornerSpec, StyleCornerSpec]),
    external: Object.freeze([isExternalCorner(corners[0]), isExternalCorner(corners[1])] as [boolean, boolean]), state, history, styles: [null, null], pending: [], decisions: [] };
  session.pending.push(...requestsAt(session, styleDecisionPoint(null, state)));
  return session;
}
function requestsAt(session: StyleSession, point: StyleRequestPoint | null): StyleRequest[] {
  if (!point) return [];
  return ([0, 1] as const).filter(side => session.external[side]).map(side => {
    const observation = styleObservation(session.state, side, session.history, point.point);
    return { side, ...point, observation, obsHash: styleObsHash(observation) };
  });
}
function insertDecision(list: StyleDecision[], d: StyleDecision): void {
  let i = list.length; while (i > 0 && (list[i - 1]!.requestTick > d.requestTick || (list[i - 1]!.requestTick === d.requestTick && list[i - 1]!.side > d.side))) i--;
  list.splice(i, 0, d);
}
/** The request the simulation must wait for before stepping state.tick, if any. */
export function styleSessionWaiting(session: Readonly<StyleSession>): StyleRequest | null {
  if (session.state.finished) return null;
  let first: StyleRequest | null = null;
  for (const r of session.pending) if (r.applyTick <= session.state.tick && (!first || r.applyTick < first.applyTick)) first = r;
  return first;
}
/** Latest decision in force for side at the session's current tick (what the HUD shows). */
export function appliedStyleDecision(session: Readonly<StyleSession>, side: SparringSide): StyleDecision | null {
  let found: StyleDecision | null = null;
  for (const d of session.decisions) if (d.side === side && d.applyTick <= session.state.tick) found = d;
  return found;
}
const validConfidence = (c: unknown) => c === null || (typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1);
/** Commit an answer for a pending request. Returns null for a request that is no longer pending (stale, reset or finished bout). */
export function commitStyle(session: StyleSession, request: StyleRequest, commit: StyleCommit): StyleDecision | null {
  const index = session.pending.indexOf(request);
  if (index < 0) return null;
  const allowed = SOURCES_FOR[session.corners[request.side].strategist as StyleStrategist];
  if (!isFightStyle(commit.style) || !allowed.includes(commit.source) || !validConfidence(commit.confidence)
    || (commit.source === "fallback" ? commit.model !== null || commit.confidence !== null : typeof commit.model !== "string" || !ID.test(commit.model))) throw new TypeError("Invalid style commit");
  const decision: StyleDecision = { side: request.side, requestTick: request.requestTick, applyTick: request.applyTick, style: commit.style, source: commit.source, model: commit.model, confidence: commit.confidence, obsHash: request.obsHash };
  session.pending.splice(index, 1); insertDecision(session.decisions, decision);
  return decision;
}
export const commitStyleFallback = (session: StyleSession, request: StyleRequest) =>
  commitStyle(session, request, { style: fallbackStyle(request.observation), source: "fallback", model: null, confidence: null });

/**
 * One engine tick. Throws while a decision blocks (check styleSessionWaiting first). Returns the decision
 * requests created at the new tick; when the bout ends, pending requests are dropped (they could never apply).
 */
export function stepStyleSession(session: StyleSession, controller: StyleController): StyleRequest[] {
  const s = session.state;
  if (s.finished) return [];
  if (styleSessionWaiting(session)) throw new Error("A style decision is pending at this tick");
  const inputs = ([0, 1] as const).map(side => {
    if (session.external[side]) { let style: FightStyle | null = null; for (const d of session.decisions) if (d.side === side && d.applyTick <= s.tick) style = d.style; session.styles[side] = style; }
    const out = controller(s, side, session.external[side] ? session.styles[side] : null);
    if (out.learned && session.corners[side].strategist === "learned") {
      const { style, confidence, model } = out.learned;
      if (!isFightStyle(style) || !validConfidence(confidence) || !ID.test(model)) throw new TypeError("Invalid learned style report");
      insertDecision(session.decisions, { side, requestTick: s.tick, applyTick: s.tick, style, source: "neuro", model, confidence, obsHash: styleObsHash(styleObservation(s, side, session.history, "learned")) });
      session.styles[side] = style;
    }
    return out.input;
  });
  const next = stepSparring(s, [inputs[0]!, inputs[1]!]);
  recordStyleEvents(session.history, next);
  session.state = next;
  if (next.finished) { session.pending = []; return []; }
  const created = requestsAt(session, styleDecisionPoint(s, next));
  session.pending.push(...created);
  return created;
}
export function styleLog(session: Readonly<StyleSession>): StyleDecisionLog {
  return { version: STYLE_LOG_VERSION, engine: session.state.version, seed: session.seed, bout: { ...session.bout },
    corners: [{ ...session.corners[0] }, { ...session.corners[1] }], decisions: session.decisions.map(d => ({ ...d })) };
}

// ---------------------------------------------------------------------------------------------------
// Log validation and replay.

export const STYLE_LOG_MAX_DECISIONS = 4096;
const DECISION_KEYS = ["side", "requestTick", "applyTick", "style", "source", "model", "confidence", "obsHash"] as const;
export type StyleLogError = "SHAPE" | "VERSION" | "DECISION" | "ORDER" | "SOURCE";
/** Closed schema, valid styles/sources, per-corner source rules and strictly increasing (requestTick, side). */
export function validateStyleLog(value: unknown): { ok: true; log: StyleDecisionLog } | { ok: false; code: StyleLogError; index?: number } {
  if (!record(value) || !exactKeys(value, ["version", "engine", "seed", "bout", "corners", "decisions"])) return { ok: false, code: "SHAPE" };
  if (value.version !== STYLE_LOG_VERSION) return { ok: false, code: "VERSION" };
  if (typeof value.engine !== "string" || !/^[a-z0-9-]{1,32}$/.test(value.engine) || !int(value.seed, 0, 0xffffffff) || !validBout(value.bout)
    || !Array.isArray(value.corners) || value.corners.length !== 2 || !value.corners.every(validCorner)
    || !Array.isArray(value.decisions) || value.decisions.length > STYLE_LOG_MAX_DECISIONS) return { ok: false, code: "SHAPE" };
  const corners = value.corners as [StyleCornerSpec, StyleCornerSpec], decisions: StyleDecision[] = [];
  for (let i = 0; i < value.decisions.length; i++) {
    const d = value.decisions[i] as unknown;
    if (!record(d) || !exactKeys(d, DECISION_KEYS) || (d.side !== 0 && d.side !== 1) || !int(d.requestTick, 0, 10_000_000) || !int(d.applyTick, d.requestTick as number, (d.requestTick as number) + 100_000)
      || !isFightStyle(d.style) || !isStyleSource(d.source) || !validConfidence(d.confidence) || typeof d.obsHash !== "string" || !/^[0-9a-f]{64}$/.test(d.obsHash)
      || !(d.model === null || (typeof d.model === "string" && ID.test(d.model)))) return { ok: false, code: "DECISION", index: i };
    const strategist = corners[d.side].strategist;
    if (!strategist || !SOURCES_FOR[strategist].includes(d.source) || (d.source === "fallback" ? d.model !== null || d.confidence !== null : d.model === null)
      || (d.source === "neuro" && d.applyTick !== d.requestTick)) return { ok: false, code: "SOURCE", index: i };
    const prev = decisions[i - 1];
    if (prev && (d.requestTick < prev.requestTick || (d.requestTick === prev.requestTick && d.side <= prev.side))) return { ok: false, code: "ORDER", index: i };
    decisions.push({ side: d.side, requestTick: d.requestTick, applyTick: d.applyTick as number, style: d.style, source: d.source, model: d.model, confidence: d.confidence as number | null, obsHash: d.obsHash });
  }
  return { ok: true, log: { version: STYLE_LOG_VERSION, engine: value.engine, seed: value.seed, bout: { ...value.bout }, corners: [{ ...corners[0] }, { ...corners[1] }], decisions } };
}

export type StyleReplayError = "ENGINE_MISMATCH" | "LOG_MISMATCH" | "LOG_MISSING_DECISION" | "LOG_UNUSED_DECISION" | "LEARNED_MISMATCH" | "TOO_LONG";
export type StyleReplay = { ok: true; state: SparringState; events: SparringEvent[]; log: StyleDecisionLog } | { ok: false; code: StyleReplayError; tick: number };
/** Answer a pending request from the log, checking the schedule and the observation digest. */
export function commitFromLog(session: StyleSession, request: StyleRequest, log: Readonly<StyleDecisionLog>): "committed" | "absent" | "mismatch" {
  const d = log.decisions.find(x => x.side === request.side && x.requestTick === request.requestTick && x.source !== "neuro");
  if (!d) return "absent";
  if (d.applyTick !== request.applyTick || d.obsHash !== request.obsHash || d.source === "neuro") return "mismatch";
  return commitStyle(session, request, { style: d.style, source: d.source, model: d.model, confidence: d.confidence }) ? "committed" : "mismatch";
}
/**
 * Re-run a whole bout from a validated log with no network. External decisions are taken from the log
 * (schedule and obsHash must match the recomputed state); learned decisions are recomputed and must equal
 * the logged ones. controller must be built for log.corners.
 */
export function replayStyleLog(log: Readonly<StyleDecisionLog>, controller: StyleController, maxTicks = 200_000): StyleReplay {
  if (log.engine !== SPARRING_VERSION) return { ok: false, code: "ENGINE_MISMATCH", tick: 0 };
  const session = createStyleSession(log.seed, log.bout, log.corners), events: SparringEvent[] = [];
  const answer = (requests: readonly StyleRequest[]) => { for (const r of requests) if (commitFromLog(session, r, log) === "mismatch") return false; return true; };
  if (!answer([...session.pending])) return { ok: false, code: "LOG_MISMATCH", tick: 0 };
  while (!session.state.finished) {
    if (session.state.tick >= maxTicks) return { ok: false, code: "TOO_LONG", tick: session.state.tick };
    if (styleSessionWaiting(session)) return { ok: false, code: "LOG_MISSING_DECISION", tick: session.state.tick };
    const created = stepStyleSession(session, controller); events.push(...session.state.events);
    if (!answer(created)) return { ok: false, code: "LOG_MISMATCH", tick: session.state.tick };
  }
  const external = (list: readonly StyleDecision[]) => list.filter(d => d.source !== "neuro").length, learned = (list: readonly StyleDecision[]) => canonicalJson(list.filter(d => d.source === "neuro"));
  if (external(session.decisions) !== external(log.decisions)) return { ok: false, code: "LOG_UNUSED_DECISION", tick: session.state.tick };
  if (learned(session.decisions) !== learned(log.decisions)) return { ok: false, code: "LEARNED_MISMATCH", tick: session.state.tick };
  return { ok: true, state: session.state, events, log: styleLog(session) };
}
