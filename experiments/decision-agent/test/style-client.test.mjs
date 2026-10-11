import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionError, STYLES, STYLE_SPEC, TYPESAFE_ORIGIN, createDecisionClient, parseStyleDecision, styleOrFallback, styleRequest } from '../typesafe-client.mjs';

// Entire suite is offline, including accidental calls without an injected transport.
globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN'); };
const env = { DECISION_AGENT_ENABLED: 'true', TYPESAFE_API_KEY: 'offline-test-not-a-real-key' };
const fighter = (health, stamina, thrown, landed) => ({ health, stamina, knockdowns: 0, cardPoints: 10, recent: { thrown, landed, blocked: 2, slipped: 1, counters: 0 } });
const observation = { point: 'midround', round: 2, rounds: 3, roundSecondsLeft: 30, me: fighter(640, 410, 9, 3), opponent: fighter(720, 380, 14, 4) };
const payload = (patch = () => {}) => { const x = { model: 'jev-1.13.0', answers: { style: { type: 'choice', choice: 'counter', confidence: .58, probabilities: { pressure: .1, counter: .42, cautious: .12, outboxer: .2, body: .1, finisher: .06 } } }, usage: { input_tokens: 405, output_tokens: 8 } }; patch(x); return x; };
const client = (fetchImpl, extra = {}) => createDecisionClient({ env, fetchImpl, minIntervalMs: 0, ...extra });
const fallback = () => 'cautious';

test('style request: official payload, exactly six closed choices, state is a copy of the closed observation', async () => {
  let sent; const result = await client(async (url, options) => { sent = { url, options }; return Response.json(payload()); }).decideStyle(observation);
  assert.equal(sent.url, TYPESAFE_ORIGIN + '/v1/systemone');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']); assert.equal(body.model, 'jev-1.13.0');
  assert.deepEqual(Object.keys(body.questions), ['style']); assert.equal(body.questions.style.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.style.criteria), [...STYLES]); assert.equal(body.questions.style.instructions, STYLE_SPEC.instructions);
  assert.deepEqual(body.state, observation);
  const r = styleRequest(observation); r.state.me.health = 1; assert.equal(observation.me.health, 640);
  assert.equal(result.style, 'counter'); assert.equal(result.usage.inputTokens, 405); assert.ok(Object.isFrozen(result));
});

test('style request: extra or missing fields, learned points and out-of-range values are rejected before any request', async () => {
  let requests = 0; const c = client(async () => { requests++; return Response.json(payload()); });
  for (const bad of [{ ...observation, seed: 1 }, { ...observation, wallet: 'x' }, { ...observation, point: 'learned' }, { ...observation, round: 4 },
    { ...observation, me: { ...observation.me, health: 1001 } }, { ...observation, me: { ...observation.me, recent: { ...observation.me.recent, bets: 0 } } },
    { ...observation, opponent: { ...observation.opponent, stamina: 0.5 } }, (({ rounds, ...rest }) => rest)(observation)]) {
    await assert.rejects(c.decideStyle(bad), e => e instanceof DecisionError && e.code === 'INVALID_OBSERVATION');
  }
  assert.equal(requests, 0);
});

test('style answer: arg-max enforced, ties allowed, extra fields and foreign styles rejected', () => {
  assert.equal(parseStyleDecision(payload(x => { x.answers.style.probabilities = { pressure: .06, counter: .42, cautious: 0, outboxer: .42, body: .05, finisher: .05 }; })).style, 'counter');
  for (const change of [x => { x.answers.style.choice = 'outboxer'; }, x => { x.answers.style.choice = 'brawler'; }, x => { x.answers.style.extra = 1; },
    x => { x.answers.action = x.answers.style; delete x.answers.style; }, x => { x.answers.style.probabilities.wager = 0; }, x => { x.model = 'jev-latest'; }])
    assert.throws(() => parseStyleDecision(payload(change)), { code: 'INVALID_RESPONSE' });
});

test('timeout commits the deterministic fallback and keeps the unknown attempt reserved', async () => {
  const c = client(async () => new Promise(() => {}), { timeoutMs: 250, maxRequests: 1 });
  assert.deepEqual({ ...await styleOrFallback(c, observation, fallback) }, { style: 'cautious', source: 'fallback', confidence: null, code: 'TIMEOUT' });
  assert.deepEqual({ ...await styleOrFallback(c, observation, fallback) }, { style: 'cautious', source: 'fallback', confidence: null, code: 'REQUEST_BUDGET_EXHAUSTED' });
});

test('blocked network, disabled flag and bad answers all fall back; telemetry carries only counts and the style', async () => {
  assert.equal((await styleOrFallback(createDecisionClient({ env, minIntervalMs: 0 }), observation, fallback)).code, 'NETWORK_ERROR');
  assert.equal((await styleOrFallback(createDecisionClient({ env: {} }), observation, fallback)).code, 'DISABLED');
  assert.equal((await styleOrFallback(client(async () => Response.json(payload(x => { x.answers.style.choice = 'body'; }))), observation, fallback)).code, 'INVALID_RESPONSE');
  const events = []; const ok = await styleOrFallback(client(async () => Response.json(payload()), { telemetry: e => events.push(e) }), observation, fallback);
  assert.deepEqual({ ...ok }, { style: 'counter', source: 'jev', confidence: .58, code: 'OK' });
  assert.deepEqual(Object.keys(events[0]).sort(), ['attempt', 'code', 'elapsedMs', 'event', 'inputTokens', 'outputTokens', 'style']);
  assert.equal(JSON.stringify(events).includes(env.TYPESAFE_API_KEY), false);
});
