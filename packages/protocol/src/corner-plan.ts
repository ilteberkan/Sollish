/** Contact 5 corner plans: every 9 seconds each corner gets a plan (intent, target, threat reading).
 * The plan is a public input of the in-match learner; it never picks a punch.
 *
 * Source is Jev (TypeSafe SystemOne, one call answers both corners) or the deterministic fallback
 * below. Every committed plan enters a hash chain that starts at the round's seed commitment and is
 * published live; a browser recomputes the observation hash from the seed and earlier plans, checks
 * the chain and replays the round. Because the server commits plans after betting closes, a remote
 * model's answer can change the result: Contact 5 stays DEMO-only (no real-asset gate opens).
 *
 * Observations are integer-only public fight data. No seed, tick, wager, balance or identity.
 */
import { FIGHT_STYLES, canonicalJson, sha256Utf8Hex, type FightStyle } from './fight-style';

export const PLAN_TARGETS = ['head', 'body'] as const;
export const PLAN_THREATS = ['straight', 'hook', 'upper', 'body'] as const;
export type PlanTarget = typeof PLAN_TARGETS[number];
export type PlanThreat = typeof PLAN_THREATS[number];
export type CornerPlan = { intent: FightStyle; target: PlanTarget; threat: PlanThreat };
export type PlanMix = { straight: number; hook: number; upper: number; body: number };
export type CornerFighterObservation = { health: number; stamina: number; knockdowns: number; points: number; thrown: number; landed: number; blocked: number; slipped: number; headLanded: number; bodyLanded: number; mix: PlanMix };
export type CornerObservation = { round: number; rounds: number; secondsLeft: number; kor: CornerFighterObservation; ayaz: CornerFighterObservation };
export type CornerSide = 'kor' | 'ayaz';

export const PLAN_TICKS = 180, PLAN_COUNT = 5, PLAN_WINDOW_TICKS = 360;
export const PLAN_LOG_VERSION = 'corner-log-1' as const;
export const PLAN_SOURCES = ['jev', 'fallback'] as const;
export type PlanSource = typeof PLAN_SOURCES[number];
export type PlanEntry = { index: number; tick: number; obsHash: string; plans: { kor: CornerPlan; ayaz: CornerPlan }; source: PlanSource; model: string | null; prev: string; hash: string };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uint = (v: unknown, max = 1_000_000): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const MIX_KEYS = ['body', 'hook', 'straight', 'upper'] as const;
const FIGHTER_KEYS = ['blocked', 'bodyLanded', 'headLanded', 'health', 'knockdowns', 'landed', 'mix', 'points', 'slipped', 'stamina', 'thrown'] as const;

export const isCornerPlan = (v: unknown): v is CornerPlan => exact(v, ['intent', 'target', 'threat']) && (FIGHT_STYLES as readonly unknown[]).includes(v.intent)
  && (PLAN_TARGETS as readonly unknown[]).includes(v.target) && (PLAN_THREATS as readonly unknown[]).includes(v.threat);
function fighterObservation(v: unknown): v is CornerFighterObservation {
  return exact(v, FIGHTER_KEYS) && uint(v.health, 1000) && uint(v.stamina, 1000) && uint(v.knockdowns, 3) && uint(v.points, 100_000)
    && ['thrown', 'landed', 'blocked', 'slipped', 'headLanded', 'bodyLanded'].every(k => uint(v[k], 400)) && exact(v.mix, MIX_KEYS) && MIX_KEYS.every(k => uint((v.mix as Record<string, unknown>)[k], 400));
}
export function parseCornerObservation(v: unknown): CornerObservation | null {
  return exact(v, ['ayaz', 'kor', 'round', 'rounds', 'secondsLeft']) && uint(v.round, 3) && v.round >= 1 && v.rounds === 3 && uint(v.secondsLeft, 45)
    && fighterObservation(v.kor) && fighterObservation(v.ayaz) ? v as CornerObservation : null;
}
export const cornerObsHash = (o: Readonly<CornerObservation>) => sha256Utf8Hex(canonicalJson(o));

/** Authored, deterministic fallback (not learned); first matching line wins. */
export function fallbackPlan(o: Readonly<CornerObservation>, side: CornerSide): CornerPlan {
  const me = o[side], op = o[side === 'kor' ? 'ayaz' : 'kor'];
  const threat: PlanThreat = (['straight', 'hook', 'upper', 'body'] as const).reduce((best, k) => op.mix[k] > op.mix[best] ? k : best, 'straight' as PlanThreat);
  const target: PlanTarget = me.landed >= 2 && op.mix.body * 3 < op.thrown && me.blocked > me.landed ? 'body' : 'head';
  let intent: FightStyle;
  if (op.health <= 300 && me.health >= op.health + 150) intent = 'finisher';
  else if (me.health <= 300 || me.stamina <= 200) intent = 'cautious';
  else if (o.round >= o.rounds && me.points < op.points) intent = 'pressure';
  else if (op.thrown >= 8 && op.landed * 3 <= op.thrown) intent = 'counter';
  else if (me.blocked >= 4 && me.blocked >= me.landed) intent = 'body';
  else if (op.thrown <= 3 || op.stamina <= 300) intent = 'pressure';
  else intent = me.health >= op.health ? 'outboxer' : 'pressure';
  return { intent, target: intent === 'body' ? 'body' : target, threat };
}
export const fallbackPlans = (o: Readonly<CornerObservation>) => ({ kor: fallbackPlan(o, 'kor'), ayaz: fallbackPlan(o, 'ayaz') });

// ---------------------------------------------------------------------------------------------------
// Decision log: entry.hash = sha256(canonicalJson(entry without hash)); entry 0's prev is the round's
// seed commitment, every later prev is the previous hash.

export function planEntry(prev: string, index: number, obsHash: string, plans: { kor: CornerPlan; ayaz: CornerPlan }, source: PlanSource, model: string | null): PlanEntry {
  const body = { index, tick: index * PLAN_TICKS, obsHash, plans: { kor: { ...plans.kor }, ayaz: { ...plans.ayaz } }, source, model, prev };
  return { ...body, hash: sha256Utf8Hex(canonicalJson(body)) };
}
const ENTRY_KEYS = ['hash', 'index', 'model', 'obsHash', 'plans', 'prev', 'source', 'tick'] as const;
export function isPlanEntry(v: unknown): v is PlanEntry {
  return exact(v, ENTRY_KEYS) && uint(v.index, PLAN_COUNT - 1) && v.tick === (v.index as number) * PLAN_TICKS && hex64(v.obsHash) && hex64(v.prev) && hex64(v.hash)
    && exact(v.plans, ['ayaz', 'kor']) && isCornerPlan(v.plans.kor) && isCornerPlan(v.plans.ayaz) && (PLAN_SOURCES as readonly unknown[]).includes(v.source)
    && (v.source === 'fallback' ? v.model === null : typeof v.model === 'string' && /^[a-z0-9][a-z0-9.-]{0,39}$/.test(v.model));
}
/** Checks shape, order and the hash chain from the commitment. Observation hashes are checked by replay. */
export function verifyPlanChain(entries: readonly unknown[], commitment: string): { ok: true; entries: PlanEntry[] } | { ok: false; index: number } {
  let prev = commitment;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i >= PLAN_COUNT || !isPlanEntry(e) || e.index !== i || e.prev !== prev) return { ok: false, index: i };
    const { hash, ...body } = e;
    if (sha256Utf8Hex(canonicalJson(body)) !== hash) return { ok: false, index: i };
    prev = hash;
  }
  return { ok: true, entries: entries as PlanEntry[] };
}

// ---------------------------------------------------------------------------------------------------
// Jev request/answer (pure: no key, no fetch here). One SystemOne call, six Choice questions.

export const JEV_CORNER_MODEL = 'jev-1.13.0';
export const JEV_CORNER_INSTRUCTIONS = 'You are the corner coach in a non-financial boxing simulation shown to spectators. The state is public match data only: for each fighter (kor and ayaz) health and stamina from 0 to 1000, knockdowns suffered, judges\' points so far, and in the last 18 seconds the punches thrown, landed clean, blocked by the other\'s guard, slipped by the other, clean head and body hits, and the mix of punch types thrown (straight, hook, upper, body). round and secondsLeft say where the bout is. Your answer is a plan for the next 9 seconds; a learning fighter reads it as advice and still chooses every punch itself.';
const INTENT_CRITERIA: Readonly<Record<FightStyle, string>> = Object.freeze({
  pressure: 'Walk the opponent down and keep punching. Fits a passive or tiring opponent, or a fighter who is behind.',
  counter: 'Stay behind the guard and punish missed or blocked punches. Fits an opponent who throws a lot but lands little.',
  cautious: 'Defend, recover stamina and health, take few risks. Fits a hurt or exhausted fighter.',
  outboxer: 'Keep long range with the jab and footwork, avoid exchanges. Fits a fighter who is ahead or being countered up close.',
  body: 'Attack the body to wear the opponent down. Fits when the opponent\'s guard blocks the head punches.',
  finisher: 'Commit to power punches to stop a badly hurt or exhausted opponent.',
});
const TARGET_CRITERIA = Object.freeze({ head: 'Aim mostly at the head: the guard is leaking or the opponent is hurt.', body: 'Aim mostly at the body: the head is well covered or the opponent is tiring.' });
const THREAT_CRITERIA = Object.freeze({ straight: 'The opponent\'s main danger is the jab and straight right: slip outside.', hook: 'The opponent\'s main danger is hooks: roll under.', upper: 'The opponent\'s main danger is the uppercut: keep the guard tight and do not duck straight down.', body: 'The opponent\'s main danger is body punches: keep the elbows in.' });
const who = (side: CornerSide) => side === 'kor' ? 'KOR (state.kor)' : 'AYAZ (state.ayaz)';
export function jevCornerRequest(o: Readonly<CornerObservation>) {
  const questions: Record<string, unknown> = {};
  for (const side of ['kor', 'ayaz'] as const) {
    questions[`${side}_intent`] = { type: 'choice', instructions: `${JEV_CORNER_INSTRUCTIONS} Choose the tactical intent for ${who(side)}.`, criteria: { ...INTENT_CRITERIA } };
    questions[`${side}_target`] = { type: 'choice', instructions: `${JEV_CORNER_INSTRUCTIONS} Choose where ${who(side)} should aim.`, criteria: { ...TARGET_CRITERIA } };
    questions[`${side}_threat`] = { type: 'choice', instructions: `${JEV_CORNER_INSTRUCTIONS} Read the opponent's main threat against ${who(side)}.`, criteria: { ...THREAT_CRITERIA } };
  }
  return { model: JEV_CORNER_MODEL, state: o, questions };
}
export const JEV_CORNER_QUESTIONS = ['ayaz_intent', 'ayaz_target', 'ayaz_threat', 'kor_intent', 'kor_target', 'kor_threat'] as const;
export type JevCornerAnswer = { plans: { kor: CornerPlan; ayaz: CornerPlan }; confidence: number; usage: { inputTokens: number; outputTokens: number } };
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
function choice(v: unknown, options: readonly string[]): { pick: string; confidence: number } | null {
  if (!exact(v, ['type', 'choice', 'confidence', 'probabilities']) || v.type !== 'choice' || typeof v.choice !== 'string' || !options.includes(v.choice) || !unit(v.confidence) || !exact(v.probabilities, options)) return null;
  const p = v.probabilities as Record<string, unknown>;
  if (!options.every(k => unit(p[k]))) return null;
  const sum = options.reduce((n, k) => n + (p[k] as number), 0);
  // Independently rounded probabilities may drift a little; larger drift or a non-arg-max pick is rejected.
  if (Math.abs(sum - 1) > .01 * options.length + 1e-9 || options.some(k => (p[k] as number) > (p[v.choice as string] as number) + 1e-12)) return null;
  return { pick: v.choice, confidence: v.confidence };
}
/** Strict closed-schema parse. Returns null for anything else; nothing raw escapes. */
export function parseJevCornerAnswer(v: unknown): JevCornerAnswer | null {
  if (!exact(v, ['model', 'answers', 'usage']) || v.model !== JEV_CORNER_MODEL || !exact(v.answers, JEV_CORNER_QUESTIONS) || !exact(v.usage, ['input_tokens', 'output_tokens'])
    || !uint(v.usage.input_tokens, 10_000_000) || !uint(v.usage.output_tokens, 10_000_000)) return null;
  const a = v.answers, plans = {} as { kor: CornerPlan; ayaz: CornerPlan };
  let confidence = 1;
  for (const side of ['kor', 'ayaz'] as const) {
    const intent = choice(a[`${side}_intent`], FIGHT_STYLES), target = choice(a[`${side}_target`], PLAN_TARGETS), threat = choice(a[`${side}_threat`], PLAN_THREATS);
    if (!intent || !target || !threat) return null;
    plans[side] = { intent: intent.pick as FightStyle, target: target.pick as PlanTarget, threat: threat.pick as PlanThreat };
    confidence = Math.min(confidence, intent.confidence, target.confidence, threat.confidence);
  }
  return { plans, confidence, usage: { inputTokens: v.usage.input_tokens as number, outputTokens: v.usage.output_tokens as number } };
}
