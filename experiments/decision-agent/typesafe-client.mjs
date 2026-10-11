import { performance } from 'node:perf_hooks';

export const TYPESAFE_ORIGIN = 'https://api.typesafe.ai';
export const ACTIONS = Object.freeze(['guard', 'jab', 'cross', 'slip_left', 'slip_right', 'step_back']);
export const TYPESAFE_MODEL = 'jev-1.13.0';
const MODEL = TYPESAFE_MODEL;
const MAX_RESPONSE_BYTES = 16_384;
const criteria = Object.freeze({
  guard: 'Protect the head and body without attacking.',
  jab: 'A short straight lead-hand punch at reachable range.',
  cross: 'A straight rear-hand punch when there is an opening.',
  slip_left: 'Evade a straight incoming punch by moving the head left.',
  slip_right: 'Evade a straight incoming punch by moving the head right.',
  step_back: 'Create distance and recover without attacking.',
});
/** A closed Choice question: the provider must pick one of `choices` (criteria keys, in order). */
export const ACTION_SPEC = Object.freeze({ key: 'action', choices: ACTIONS, criteria,
  instructions: 'Choose the next legal movement for a non-financial boxing simulation. Use distance, stamina and the opposing movement. This is an advisory movement proposal only, never an outcome or a transaction.' });
// Fighting styles: identical text to apps/web/lib/server/typesafe-style.ts (a web unit test cross-checks it).
export const STYLES = Object.freeze(['pressure', 'counter', 'cautious', 'outboxer', 'body', 'finisher']);
export const STYLE_SPEC = Object.freeze({ key: 'style', choices: STYLES,
  instructions: 'Choose the fighting style for the fighter called "me" in the next phase of a non-financial boxing simulation (a spectator demo with no wagers). The state is public match data only: health and stamina from 0 to 1000, knockdowns suffered, judges\' card points so far, the round and the seconds left in it, and each fighter\'s own punches in the last 15 seconds (thrown, landed clean, blocked by the other\'s guard, slipped by the other, counter hits landed). point says whether this is the start of the bout, the middle of a round or the break after a round. The choice only adjusts the fighter\'s tactics; it never changes scoring or the result.',
  criteria: Object.freeze({
    pressure: 'Walk the opponent down and keep punching to force exchanges. Fits when the opponent is passive or tiring, or when "me" is behind and needs damage.',
    counter: 'Stay behind the guard and punish the opponent\'s missed or blocked punches. Fits an opponent who throws a lot but lands little.',
    cautious: 'Defend first, recover stamina and health, take few risks. Fits when "me" is hurt or low on stamina.',
    outboxer: 'Keep long range with the jab and footwork and avoid exchanges. Fits when "me" is ahead or the opponent lands counters up close.',
    body: 'Attack the body to wear the opponent down. Fits when the opponent\'s guard blocks many head punches.',
    finisher: 'Commit to power punches to stop a badly hurt or exhausted opponent. Fits when the opponent\'s health is very low.',
  }) });
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const bounded = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const uint = v => Number.isSafeInteger(v) && v >= 0;
const action = v => typeof v === 'string' && ACTIONS.includes(v);
const ERROR_CODES = new Set(['INVALID_OBSERVATION', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE', 'TIMEOUT', 'INVALID_CONFIG', 'DISABLED', 'MISSING_CREDENTIAL', 'IN_FLIGHT', 'REQUEST_BUDGET_EXHAUSTED', 'RATE_LIMITED', 'NETWORK_ERROR', 'REDIRECT_REJECTED', 'AUTH_REJECTED', 'PROVIDER_RATE_LIMITED', 'HTTP_ERROR']);
export class DecisionError extends Error {
  constructor(code) { const safe = ERROR_CODES.has(code) ? code : 'INVALID_RESPONSE'; super(safe); this.name = 'DecisionError'; this.code = safe; }
}
const fail = code => { throw new DecisionError(code); };

/** Official model/state/questions payload with one closed Choice question built from `spec`. */
export function choiceRequest(spec, state) {
  return { model: MODEL, state, questions: { [spec.key]: { type: 'choice', instructions: spec.instructions, criteria: { ...spec.criteria } } } };
}
/** Strict subset of the official SystemOneResponse/ChoiceAnswer for `spec`. No raw provider fields escape. */
export function parseChoice(value, spec) {
  const keys = spec.choices, inList = v => typeof v === 'string' && keys.includes(v);
  if (!exact(value, ['model', 'answers', 'usage']) || value.model !== MODEL
    || !exact(value.answers, [spec.key]) || !exact(value.usage, ['input_tokens', 'output_tokens'])
    || !uint(value.usage.input_tokens) || !uint(value.usage.output_tokens)) fail('INVALID_RESPONSE');
  const answer = value.answers[spec.key];
  if (!exact(answer, ['type', 'choice', 'confidence', 'probabilities']) || answer.type !== 'choice'
    || !inList(answer.choice) || !bounded(answer.confidence, 0, 1)
    || !exact(answer.probabilities, keys)
    || !keys.every(key => bounded(answer.probabilities[key], 0, 1))) fail('INVALID_RESPONSE');
  const sum = keys.reduce((n, key) => n + answer.probabilities[key], 0);
  // Six independently rounded two-decimal probabilities may total 0.97–1.03.
  // This experiment rejects larger drift and never silently renormalizes the response.
  if (Math.abs(sum - 1) > 0.030001
    || keys.some(key => answer.probabilities[key] > answer.probabilities[answer.choice] + 1e-12)) fail('INVALID_RESPONSE');
  return Object.freeze({
    choice: answer.choice, confidence: answer.confidence,
    probabilities: Object.freeze(Object.fromEntries(keys.map(key => [key, answer.probabilities[key]]))),
    usage: Object.freeze({ inputTokens: value.usage.input_tokens, outputTokens: value.usage.output_tokens }),
  });
}

/** Numeric/closed-enum simulation observations only. No player, wallet, bet or account data. */
export function decisionRequest(observation) {
  if (!exact(observation, ['tick', 'distanceMeters', 'stamina', 'opponentStamina', 'opponentAction', 'lastAction'])
    || !uint(observation.tick) || observation.tick > 1_000_000_000
    || !bounded(observation.distanceMeters, 0, 10)
    || !bounded(observation.stamina, 0, 1) || !bounded(observation.opponentStamina, 0, 1)
    || !(action(observation.opponentAction) || observation.opponentAction === 'unknown')
    || !action(observation.lastAction)) fail('INVALID_OBSERVATION');
  return choiceRequest(ACTION_SPEC, { ...observation });
}
export function parseDecision(value) {
  const { choice, ...rest } = parseChoice(value, ACTION_SPEC);
  return Object.freeze({ action: choice, ...rest });
}

/** Closed style observation (mirrors parseStyleObservation in packages/protocol/src/fight-style.ts; Jev is asked only at scheduled points). */
const intIn = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
function styleFighter(f) {
  return exact(f, ['cardPoints', 'health', 'knockdowns', 'recent', 'stamina']) && intIn(f.health, 0, 1000) && intIn(f.stamina, 0, 1000) && intIn(f.knockdowns, 0, 99) && intIn(f.cardPoints, 0, 120)
    && exact(f.recent, ['blocked', 'counters', 'landed', 'slipped', 'thrown']) && Object.values(f.recent).every(v => intIn(v, 0, 999));
}
export function styleRequest(observation) {
  if (!exact(observation, ['me', 'opponent', 'point', 'round', 'roundSecondsLeft', 'rounds']) || !['start', 'midround', 'roundend'].includes(observation.point)
    || !intIn(observation.rounds, 1, 12) || !intIn(observation.round, 1, observation.rounds) || !intIn(observation.roundSecondsLeft, 0, 300)
    || !styleFighter(observation.me) || !styleFighter(observation.opponent)) fail('INVALID_OBSERVATION');
  return choiceRequest(STYLE_SPEC, structuredClone(observation));
}
export function parseStyleDecision(value) {
  const { choice, ...rest } = parseChoice(value, STYLE_SPEC);
  return Object.freeze({ style: choice, ...rest });
}

async function boundedJson(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) fail('RESPONSE_TOO_LARGE');
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const parts = []; let size = 0;
  try {
    for (;;) {
      if (signal.aborted) fail('TIMEOUT');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); fail('RESPONSE_TOO_LARGE'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('INVALID_RESPONSE'); }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Server-only, opt-in, single-flight experiment. Importing this module makes no requests.
 * API keys come only from the environment; there is no key CLI argument or browser integration.
 * An injected fetch/environment is a test seam, not a provider redirect mechanism.
 */
export function createDecisionClient({ env = process.env, origin = TYPESAFE_ORIGIN, fetchImpl = globalThis.fetch,
  timeoutMs = 1500, maxRequests = 8, minIntervalMs = 250, telemetry = () => {} } = {}) {
  if (origin !== TYPESAFE_ORIGIN || !Number.isInteger(timeoutMs) || !bounded(timeoutMs, 250, 10_000)
    || !Number.isInteger(maxRequests) || !bounded(maxRequests, 1, 1000)
    || !Number.isInteger(minIntervalMs) || !bounded(minIntervalMs, 0, 60_000)
    || typeof fetchImpl !== 'function' || typeof telemetry !== 'function') fail('INVALID_CONFIG');
  let requests = 0, busy = false, lastStartedAt = -Infinity;
  async function call(build, parse, label) {
    if (env.DECISION_AGENT_ENABLED !== 'true') fail('DISABLED');
    const key = env.TYPESAFE_API_KEY;
    if (typeof key !== 'string' || key.length < 8 || key.length > 4096 || !/^[\x21-\x7E]+$/.test(key)) fail('MISSING_CREDENTIAL');
    const payload = build();
    if (busy) fail('IN_FLIGHT');
    if (requests >= maxRequests) fail('REQUEST_BUDGET_EXHAUSTED');
    const started = performance.now();
    if (started - lastStartedAt < minIntervalMs) fail('RATE_LIMITED');
    requests++; busy = true; lastStartedAt = started;
    const controller = new AbortController(); let timer; let result; let code = 'NETWORK_ERROR';
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new DecisionError('TIMEOUT')); }, timeoutMs);
      });
      const work = async () => {
        const response = await fetchImpl(TYPESAFE_ORIGIN + '/v1/systemone', {
          method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        if (response.redirected || (response.url && response.url !== TYPESAFE_ORIGIN + '/v1/systemone')) fail('REDIRECT_REJECTED');
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          fail(response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'HTTP_ERROR');
        }
        return parse(await boundedJson(response, controller.signal));
      };
      result = await Promise.race([work(), deadline]); code = 'OK'; return result;
    } catch (error) {
      code = error instanceof DecisionError ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
      throw new DecisionError(code); // Never preserve raw HTTP errors, bodies, request ids or causes.
    } finally {
      clearTimeout(timer); controller.abort(); busy = false;
      const event = { event: 'decision.completed', code, elapsedMs: Math.max(0, Math.round(performance.now() - started)), attempt: requests,
        ...(result ? { [label]: result[label], inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } : {}) };
      try { telemetry(Object.freeze(event)); } catch { /* Telemetry cannot change a decision or expose raw errors. */ }
    }
  }
  return Object.freeze({
    decide(observation) { return call(() => decisionRequest(observation), parseDecision, 'action'); },
    /** One fighting-style choice for a closed public observation. */
    decideStyle(observation) { return call(() => styleRequest(observation), parseStyleDecision, 'style'); },
    budget() { return Object.freeze({ usedRequests: requests, maxRequests }); },
  });
}

/** Jev answer or the caller's deterministic fallback (e.g. fallbackStyle from fight-style.ts); never throws, never retries. */
export async function styleOrFallback(client, observation, fallback) {
  try { const r = await client.decideStyle(observation); return Object.freeze({ style: r.style, source: 'jev', confidence: r.confidence, code: 'OK' }); }
  catch (error) { return Object.freeze({ style: fallback(observation), source: 'fallback', confidence: null, code: error instanceof DecisionError ? error.code : 'INVALID_RESPONSE' }); }
}
