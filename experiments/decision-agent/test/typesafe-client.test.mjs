import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, TYPESAFE_ORIGIN, DecisionError, createDecisionClient, decisionRequest, parseDecision } from '../typesafe-client.mjs';

// Entire suite is offline, including accidental calls without an injected transport.
globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN'); };
const env = { DECISION_AGENT_ENABLED: 'true', TYPESAFE_API_KEY: 'offline-test-not-a-real-key' };
const observation = { tick: 4, distanceMeters: 1.2, stamina: 0.8, opponentStamina: 0.6, opponentAction: 'jab', lastAction: 'guard' };
const payload = () => ({ model: 'jev-1.13.0', answers: { action: { type: 'choice', choice: 'guard', confidence: .82, probabilities: { guard: .5, jab: .15, cross: .1, slip_left: .1, slip_right: .1, step_back: .05 } } }, usage: { input_tokens: 223, output_tokens: 12 } });
const response = value => Response.json(value);
const client = (fetchImpl, extra = {}) => createDecisionClient({ env, fetchImpl, minIntervalMs: 0, ...extra });
const rejects = async (promise, code) => assert.rejects(promise, e => e instanceof DecisionError && e.code === code && e.message === code);

test('defaults disabled, missing credential and invalid observations make no network request', async () => {
  let requests = 0; const fetchImpl = async () => { requests++; return response(payload()); };
  await rejects(createDecisionClient({ env: {}, fetchImpl }).decide(observation), 'DISABLED');
  await rejects(createDecisionClient({ env: { DECISION_AGENT_ENABLED: 'true' }, fetchImpl }).decide(observation), 'MISSING_CREDENTIAL');
  await rejects(client(fetchImpl).decide({ ...observation, wallet: 'not-allowed' }), 'INVALID_OBSERVATION');
  await rejects(client(fetchImpl).decide({ ...observation, distanceMeters: Infinity }), 'INVALID_OBSERVATION');
  await rejects(client(fetchImpl).decide({ ...observation, opponentAction: 'withdraw' }), 'INVALID_OBSERVATION');
  assert.equal(requests, 0);
});

test('only exact official origin accepted; config cannot redirect bearer credentials', () => {
  for (const origin of ['http://api.typesafe.ai', 'https://api.typesafe.ai.evil.test', 'https://other.test', 'https://api.typesafe.ai/', 'https://user:pass@api.typesafe.ai', 'https://api.typesafe.ai:443']) {
    assert.throws(() => createDecisionClient({ origin }), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => createDecisionClient({ timeoutMs: 100_000 }), { code: 'INVALID_CONFIG' });
  assert.throws(() => createDecisionClient({ maxRequests: Infinity }), { code: 'INVALID_CONFIG' });
});

test('official model/state/questions payload and six movement-only choices', async () => {
  let sent;
  const c = client(async (url, options) => { sent = { url, options }; return response(payload()); });
  const result = await c.decide(observation);
  assert.equal(sent.url, TYPESAFE_ORIGIN + '/v1/systemone');
  assert.equal(sent.options.headers.authorization, 'Bearer ' + env.TYPESAFE_API_KEY);
  assert.equal(sent.options.method, 'POST'); assert.equal(sent.options.redirect, 'error'); assert.equal(sent.options.credentials, 'omit');
  const request = JSON.parse(sent.options.body);
  assert.deepEqual(Object.keys(request).sort(), ['model', 'questions', 'state']);
  assert.equal(request.model, 'jev-1.13.0'); assert.deepEqual(request.state, observation);
  assert.deepEqual(Object.keys(request.questions), ['action']);
  assert.equal(request.questions.action.type, 'choice');
  assert.deepEqual(Object.keys(request.questions.action.criteria), ACTIONS);
  assert.equal(result.action, 'guard'); assert.equal(result.usage.inputTokens, 223); assert.ok(Object.isFrozen(result));
});

test('observation boundaries and caller objects remain unchanged', () => {
  const before = structuredClone(observation); const r = decisionRequest(observation); r.state.tick = 9;
  assert.deepEqual(observation, before);
  for (const patch of [{ tick: -1 }, { tick: .5 }, { stamina: 1.01 }, { opponentStamina: -1 }, { distanceMeters: 10.01 }, { lastAction: 'pay' }]) assert.throws(() => decisionRequest({ ...observation, ...patch }), { code: 'INVALID_OBSERVATION' });
  assert.equal(decisionRequest({ ...observation, tick: 0, stamina: 0, opponentStamina: 1, distanceMeters: 10, opponentAction: 'unknown' }).state.tick, 0);
});

test('strict response rejects unexpected action, missing probabilities and malformed usage', () => {
  const changes = [
    x => x.answers.action.choice = 'transfer', x => x.answers.action.choice = 'jab', x => x.answers.action.confidence = '0.9',
    x => delete x.answers.action.probabilities.cross, x => x.answers.action.probabilities.pay = 0,
    x => x.answers.action.probabilities.guard = 1.1, x => x.answers.action.probabilities.guard = NaN,
    x => x.answers.action.type = 'noul', x => x.answers.action.extra = 'untrusted',
    x => delete x.usage, x => x.usage.input_tokens = -1, x => x.usage.output_tokens = '12',
    x => x.model = 'external-provider', x => x.model = 'jev-1.14.0', x => x.answers.finance = {},
  ];
  for (const change of changes) { const p = payload(); change(p); assert.throws(() => parseDecision(p), { code: 'INVALID_RESPONSE' }); }
});

test('provider rounding tolerance is bounded and probabilities are not silently normalized', () => {
  const p = payload(); p.answers.action.probabilities.guard = .48;
  assert.equal(parseDecision(p).probabilities.guard, .48);
  p.answers.action.probabilities.guard = .4;
  assert.throws(() => parseDecision(p), { code: 'INVALID_RESPONSE' });
});

test('HTTP failures are fixed safe codes, are not retried, and do not leak raw provider strings', async () => {
  for (const [status, code] of [[401, 'AUTH_REJECTED'], [403, 'AUTH_REJECTED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'HTTP_ERROR']]) {
    let calls = 0; const events = [];
    const c = client(async () => { calls++; return new Response('secret-body-' + env.TYPESAFE_API_KEY, { status }); }, { telemetry: e => events.push(e) });
    await rejects(c.decide(observation), code); assert.equal(calls, 1); assert.equal(c.budget().usedRequests, 1);
    assert.equal(JSON.stringify(events).includes(env.TYPESAFE_API_KEY), false);
    assert.deepEqual(Object.keys(events[0]).sort(), ['attempt', 'code', 'elapsedMs', 'event']);
  }
});

test('network exceptions never escape through error messages, causes or telemetry', async () => {
  const events = []; const c = client(async () => { throw new Error('raw request secret: ' + env.TYPESAFE_API_KEY); }, { telemetry: e => events.push(e) });
  await assert.rejects(c.decide(observation), e => e.code === 'NETWORK_ERROR' && e.cause === undefined && !e.stack.includes(env.TYPESAFE_API_KEY));
  assert.equal(JSON.stringify(events).includes(env.TYPESAFE_API_KEY), false);
});

test('deadline covers a hanging request and keeps the unknown attempt reserved', async () => {
  let signal; const c = client(async (_, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 250, maxRequests: 1 });
  await rejects(c.decide(observation), 'TIMEOUT'); assert.equal(signal.aborted, true);
  await rejects(c.decide(observation), 'REQUEST_BUDGET_EXHAUSTED');
});

test('deadline also cancels a hanging response body', async () => {
  let canceled = false;
  const c = client(async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 250 });
  await rejects(c.decide(observation), 'TIMEOUT'); assert.equal(canceled, true);
});

test('one in-flight request per client; success does not silently multiply calls', async () => {
  let resolve; let calls = 0;
  const c = client(async () => { calls++; return new Promise(r => { resolve = r; }); }, { maxRequests: 1 });
  const first = c.decide(observation); await rejects(c.decide(observation), 'IN_FLIGHT');
  resolve(response(payload())); await first;
  await rejects(c.decide(observation), 'REQUEST_BUDGET_EXHAUSTED'); assert.equal(calls, 1);
});

test('minimum start interval rejects bursts before a second network request', async () => {
  let calls = 0; const c = client(async () => { calls++; return response(payload()); }, { minIntervalMs: 60_000 });
  await c.decide(observation); await rejects(c.decide(observation), 'RATE_LIMITED'); assert.equal(calls, 1);
});

test('body cap enforced with and without Content-Length; HTML and bad UTF-8 rejected', async () => {
  for (const headers of [{ 'content-type': 'application/json', 'content-length': '20000' }, { 'content-type': 'application/json' }]) {
    const c = client(async () => new Response('x'.repeat(20_000), { headers }));
    await rejects(c.decide(observation), 'RESPONSE_TOO_LARGE');
  }
  await rejects(client(async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } })).decide(observation), 'INVALID_RESPONSE');
  await rejects(client(async () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } })).decide(observation), 'INVALID_RESPONSE');
});

test('redirected or foreign final response is rejected without consuming its body', async () => {
  for (const overrides of [{ redirected: true }, { url: 'https://foreign.test/v1/systemone' }]) {
    const c = client(async () => { const r = response(payload()); for (const [k, v] of Object.entries(overrides)) Object.defineProperty(r, k, { value: v }); return r; });
    await rejects(c.decide(observation), 'REDIRECT_REJECTED');
  }
});

test('telemetry has only safe counts/enums and a broken telemetry sink cannot change a result', async () => {
  const events = []; const c = client(async () => response(payload()), { telemetry: e => events.push(e) });
  await c.decide(observation);
  assert.deepEqual(Object.keys(events[0]).sort(), ['action', 'attempt', 'code', 'elapsedMs', 'event', 'inputTokens', 'outputTokens']);
  assert.equal(JSON.stringify(events).includes(env.TYPESAFE_API_KEY), false);
  const result = await client(async () => response(payload()), { telemetry: () => { throw new Error('sink failure'); } }).decide(observation);
  assert.equal(result.action, 'guard');
});

test('error construction cannot smuggle arbitrary text into telemetry', async () => {
  const events = []; const c = client(async () => { throw new DecisionError(env.TYPESAFE_API_KEY); }, { telemetry: e => events.push(e) });
  await rejects(c.decide(observation), 'INVALID_RESPONSE');
  assert.equal(JSON.stringify(events).includes(env.TYPESAFE_API_KEY), false);
});
