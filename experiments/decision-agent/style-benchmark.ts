// Real TypeSafe Jev latency/validity benchmark for the Combat Club style question, using the production
// server client (apps/web/lib/server/typesafe-style.ts) exactly as the route calls it. Observations come
// from real Combat Club bouts (neuro-2 Jev corners on the fallback path, so the bouts are deterministic).
// Sequential calls; one JSON line per real call is appended to evidence/style-real-calls.jsonl BEFORE the
// next call starts (code, elapsed ms, token counts, style, confidence: never bodies, ids or the key).
// The cumulative real-call count across all of this task's evidence is checked before every call.
// Usage (key only in the child process env):
//   set -a; . ./.tooling/secrets/typesafe.env; set +a; bash scripts/use-node.sh apps/web/node_modules/.bin/tsx experiments/decision-agent/style-benchmark.ts 30
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commitStyleFallback, createStyleSession, fallbackStyle, stepStyleSession, type StyleRequest } from '../../packages/protocol/src/index';
import { NEURO2_GRAPH, NEURO2_INFO, NEURO2_PARAMS } from '../../packages/protocol/src/neuro-boxer-2-model';
import { askJevStyle, StyleAdvisorError, validTypesafeKey, TYPESAFE_STYLE_MODEL } from '../../apps/web/lib/server/typesafe-style';
import { COMBAT_CLUB_BOUT, cornerSpec, createCornerController, createCornerMemories, type CornerModels } from '../../apps/web/lib/sparring-corners';

const LOG = fileURLToPath(new URL('./evidence/style-real-calls.jsonl', import.meta.url));
export const TASK_REAL_CALL_LIMIT = 150;
const dry = process.argv[2] === 'dry', want = dry ? 30 : Math.min(40, Number(process.argv[2] ?? 30));
const realCalls = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(r => r.providerCall !== false).reduce((n, r) => n + (r.calls ?? 1), 0) : 0;
const key = process.env.TYPESAFE_API_KEY;

// Realistic observations: decision points of real bouts (both corners neuro-2 with the Jev strategist, fallback answers).
const models: CornerModels = { neuro1: null, neuro2: { graph: NEURO2_GRAPH, params: NEURO2_PARAMS, theta: NEURO2_INFO.thetaSha256, provisional: NEURO2_INFO.provisional !== false } };
const requests: StyleRequest[] = [], seen = new Set<string>();
for (const seed of [6101, 6102, 6103, 6104, 6105, 6106]) {
  const kinds = ['neuro2-jev', 'neuro2-jev'] as const, session = createStyleSession(seed, COMBAT_CLUB_BOUT, [cornerSpec(kinds[0], models), cornerSpec(kinds[1], models)]);
  const controller = createCornerController(kinds, models, createCornerMemories());
  const take = (rs: readonly StyleRequest[]) => { for (const r of rs) { if (!seen.has(r.obsHash)) { seen.add(r.obsHash); requests.push(r); } commitStyleFallback(session, r); } };
  take([...session.pending]);
  while (!session.state.finished) take(stepStyleSession(session, controller));
}
// Spread across points: the identical start observation once, then alternate mid-round and roundend.
const start = requests.filter(r => r.point === 'start').slice(0, 1), mid = requests.filter(r => r.point === 'midround'), end = requests.filter(r => r.point === 'roundend');
const picked = [...start]; for (let i = 0; picked.length < want && (i < mid.length || i < end.length); i++) { if (mid[i]) picked.push(mid[i]!); if (end[i] && picked.length < want) picked.push(end[i]!); }
console.log(`observations: ${requests.length} distinct (start ${start.length}, mid ${mid.length}, roundend ${end.length}); calling ${picked.length}; prior real calls ${realCalls()}`);

if (dry) process.exit(0);
if (!validTypesafeKey(key)) { console.error('TYPESAFE_API_KEY missing or malformed in this process env; nothing sent.'); process.exit(2); }
let authFailures = 0;
for (const [i, r] of picked.entries()) {
  if (realCalls() >= TASK_REAL_CALL_LIMIT) { console.error('task real-call limit reached; stopping'); break; }
  const started = performance.now();
  let row: Record<string, unknown>;
  try {
    const a = await askJevStyle(r.observation, { key: key! });
    row = { code: 'OK', style: a.style, confidence: a.confidence, inputTokens: a.usage.inputTokens, outputTokens: a.usage.outputTokens, pMax: Math.max(...Object.values(a.probabilities)) };
    authFailures = 0;
  } catch (e) { row = { code: e instanceof StyleAdvisorError ? e.code : 'NETWORK_ERROR' }; if (row.code === 'AUTH_REJECTED' || row.code === 'HTTP_ERROR' || row.code === 'INVALID_RESPONSE') authFailures++; }
  const line = { at: new Date().toISOString(), via: 'node-production-client', model: TYPESAFE_STYLE_MODEL, i, point: r.point, obsHash: r.obsHash, fallback: fallbackStyle(r.observation), elapsedMs: Math.round(performance.now() - started), ...row };
  appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(`${i} ${line.point} ${line.code} ${line.elapsedMs}ms ${row.style ?? '-'} ${row.confidence ?? ''}`);
  if (authFailures >= 2) { console.error('two provider rejections in a row; stopping (sanitized codes recorded)'); break; }
}
console.log(`real calls recorded in total: ${realCalls()}`);
