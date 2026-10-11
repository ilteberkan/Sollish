// Live check of the Next route on the local dev server (http://127.0.0.1:3000; the server holds the key).
// Two real provider calls at most; each is appended to evidence/style-real-calls.jsonl before the next starts.
// Usage: node experiments/decision-agent/style-route-check.mjs
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:3000', URL_ = BASE + '/api/ringside/style', LOG = new URL('./evidence/style-real-calls.jsonl', import.meta.url);
const realCalls = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.providerCall !== false).reduce((n, r) => n + (r.calls ?? 1), 0) : 0;
const zero = { thrown: 0, landed: 0, blocked: 0, slipped: 0, counters: 0 }, fresh = { health: 1000, stamina: 1000, knockdowns: 0, cardPoints: 0, recent: zero };
const observations = [
  { point: 'start', round: 1, rounds: 3, roundSecondsLeft: 45, me: fresh, opponent: fresh },
  { point: 'midround', round: 2, rounds: 3, roundSecondsLeft: 15, me: { health: 420, stamina: 260, knockdowns: 1, cardPoints: 9, recent: { thrown: 6, landed: 1, blocked: 4, slipped: 0, counters: 0 } }, opponent: { health: 710, stamina: 540, knockdowns: 0, cardPoints: 10, recent: { thrown: 15, landed: 6, blocked: 3, slipped: 1, counters: 2 } } },
];
const post = (body, headers = {}) => fetch(URL_, { method: 'POST', headers: { origin: BASE, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const out = { get: await (await fetch(URL_)).json() };
const foreign = await post({ side: 0, requestTick: 0, observation: observations[0] }, { origin: 'https://evil.test' });
out.foreignOrigin = { status: foreign.status, body: await foreign.json() };
const invalid = await post({ side: 0, requestTick: 0, observation: { ...observations[0], seed: 1 } });
out.invalid = { status: invalid.status, body: await invalid.json() };
out.calls = [];
for (const [i, observation] of observations.entries()) {
  if (realCalls() >= 150) break;
  const t = performance.now(), res = await post({ side: i % 2, requestTick: i ? 1800 : 0, observation }), body = await res.json(), elapsedMs = Math.round(performance.now() - t);
  const row = { at: new Date().toISOString(), via: 'next-route-node', point: observation.point, status: res.status, elapsedMs, code: body.source === 'jev' ? 'OK' : body.code, style: body.style ?? null, confidence: body.confidence ?? null, keys: Object.keys(body).sort() };
  appendFileSync(LOG, JSON.stringify(row) + '\n'); out.calls.push(row);
}
console.log(JSON.stringify(out));
