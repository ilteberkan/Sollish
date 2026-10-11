/** Real local workerd/SQLite/WebSocket checks for Contact 5 (in-match learner + live Jev corner plans).
 * The generated probe alone owns a test clock and a fake TypeSafe endpoint; production has neither.
 * Covers: Jev answer, one retry after a transient failure, malformed answer, provider timeout, missed
 * deadlines after a lost request, duplicate alarms, call budget exhaustion, restart, and the match ledger:
 * one betting window before round 1, closed between rounds, every pool settled once when the bout ends.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseRingServer, RINGSIDE_RESULT_MS, COMBAT_V5_VERSION, COMBAT_V5_DURATION_MS, V5_PLAN_LEAD_MS, PLAN_COUNT, MATCH_OPEN_MS, MATCH_MARKETS, combatResults, contactCommitmentInputV5, replayContactV5, verifyPlanChain, verifyMatchHistory, matchResults, matchSeedHash, roundOutcome } from '@sollish/protocol';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const folder = resolve(root, '.tooling/contact-arena-v5-integration');
const port = 18891, base = `http://127.0.0.1:${port}`, origin = 'http://localhost:3000', KEY = 'test-key-not-a-secret-0123456789';
const firstTime = Date.now() + 86_400_000;
await mkdir(folder, { recursive: true });
const entry = `import { ContactArenaV5 } from ${JSON.stringify(resolve(root, 'apps/realtime/src/contact-arena-v5.ts'))};
import { contactCommitmentInputV5, matchSeedHash } from ${JSON.stringify(resolve(root, 'packages/protocol/src/ringside.ts'))};
let fixtureNow=${firstTime};Date.now=()=>fixtureNow;
let mode='ok', calls=0, leaks=0, flip=false;
const choice=(pick,options)=>({type:'choice',choice:pick,confidence:0.8,probabilities:Object.fromEntries(options.map(o=>[o,o===pick?0.8:+(0.2/(options.length-1)).toFixed(2)]))});
const S=['pressure','counter','cautious','outboxer','body','finisher'],T=['head','body'],H=['straight','hook','upper','body'];
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 if(String(url)!=='https://api.typesafe.ai/v1/systemone')return realFetch(url,init);
 calls++;
 const body=String(init.body);if(init.headers.authorization!=='Bearer ${KEY}'||/seed|secret|session|balance/i.test(body)||init.redirect!=='manual')leaks++;
 if(mode==='slow')await new Promise(r=>setTimeout(r,2200));
 if(mode==='auth')return new Response('{}',{status:401,headers:{'content-type':'application/json'}});
 if(mode==='flaky'&&(flip=!flip))return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
 if(mode==='bad')return Response.json({model:'jev-1.13.0',answers:{},usage:{input_tokens:1,output_tokens:1}});
 return Response.json({model:'jev-1.13.0',usage:{input_tokens:1200,output_tokens:60},answers:{kor_intent:choice('body',S),kor_target:choice('body',T),kor_threat:choice('hook',H),ayaz_intent:choice('pressure',S),ayaz_target:choice('head',T),ayaz_threat:choice('straight',H)}});
};
export class Probe extends ContactArenaV5 {
 constructor(ctx,env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_clock(id INTEGER PRIMARY KEY, at INTEGER NOT NULL)');ctx.storage.sql.exec('INSERT OR IGNORE INTO fixture_clock VALUES(1,?)',fixtureNow);fixtureNow=ctx.storage.sql.exec('SELECT at FROM fixture_clock WHERE id=1').one().at;}
 async fetch(r){const u=new URL(r.url),path=u.pathname;
  if(path==='/__inspect')return Response.json({at:fixtureNow,calls,leaks,round:this.ctx.storage.sql.exec('SELECT body FROM ring_round WHERE id=1').toArray().map(x=>JSON.parse(x.body).public)[0]??null,usage:this.ctx.storage.sql.exec('SELECT * FROM jev_usage').one(),tickets:this.ctx.storage.sql.exec('SELECT * FROM ring_tickets ORDER BY seq').toArray(),sessions:this.ctx.storage.sql.exec('SELECT * FROM ring_sessions').toArray(),fees:this.ctx.storage.sql.exec('SELECT * FROM ring_fees').toArray()});
  if(path==='/__mode'){mode=u.searchParams.get('mode');return new Response('ok');}
  if(path==='/__clock'){const at=Number(u.searchParams.get('at'));fixtureNow=at;this.ctx.storage.sql.exec('UPDATE fixture_clock SET at=? WHERE id=1',at);await this.ctx.storage.sync();const alarm=u.searchParams.get('alarm')!=='0';try{if(alarm)await this.alarm();return new Response('ok');}catch(e){return new Response(String(e),{status:500});}}
  if(path==='/__seed'){const seed=u.searchParams.get('seed'),row=this.ctx.storage.sql.exec('SELECT body FROM ring_round WHERE id=1').one(),saved=JSON.parse(row.body);if(!/^[0-9a-f]{64}$/.test(seed)||saved.public.phase!=='open')return new Response('invalid',{status:409});const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(contactCommitmentInputV5(saved.public.id,seed,saved.public.bout)));saved.secretSeed=seed;saved.matchSeeds[0]=seed;saved.public.match.seedHashes[0]=matchSeedHash(saved.public.bout.id,1,seed);saved.public.commitment=[...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('');this.ctx.storage.sql.exec('UPDATE ring_round SET body=? WHERE id=1',JSON.stringify(saved));await this.ctx.storage.sync();return new Response('ok');}
  return super.fetch(r);
 }
}
export default {fetch(r,env){if(new URL(r.url).pathname==='/ready')return new Response('ready');return env.ARENA.get(env.ARENA.idFromName('ringside-v5')).fetch(r);}};`;
await writeFile(resolve(folder, 'entry.ts'), entry);
await writeFile(resolve(folder, 'wrangler.json'), JSON.stringify({ name: 'sollish-contact-v5-local-test', main: resolve(folder, 'entry.ts'), compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'],
  vars: { ALLOWED_ORIGINS: origin, LIVE_ARENA_ENABLED: 'true', TYPESAFE_API_KEY: KEY, DECISION_AGENT_ENABLED: 'true', JEV_CALL_BUDGET: '6' },
  durable_objects: { bindings: [{ name: 'ARENA', class_name: 'Probe' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['Probe'] }] }));
await rm(resolve(folder, 'state'), { recursive: true, force: true });

let child, logs = '', invalidFrame = null;
const checks = [], sockets = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 15_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (invalidFrame) throw new Error('INVALID_SERVER_FRAME: ' + invalidFrame); const v = await fn(); if (v) return v; await wait(15); } throw new Error('V5_TEST_TIMEOUT'); }
async function start() {
  child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', resolve(folder, 'wrangler.json'), '--port', String(port), '--ip', '127.0.0.1', '--persist-to', resolve(folder, 'state'), '--show-interactive-dev-session=false'], { cwd: resolve(root, 'apps/realtime'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (const s of [child.stdout, child.stderr]) s.on('data', b => { logs = (logs + b).slice(-30_000); });
  await until(async () => { try { return (await fetch(`${base}/ready`)).ok; } catch { return false; } }, 40_000);
}
async function stop() {
  for (const c of sockets) { try { c.ws.close(); } catch {} }
  if (!child) return;
  const stopped = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await Promise.race([stopped, wait(5_000)]); child = null;
  await until(async () => { try { await fetch(`${base}/ready`); return false; } catch { return true; } }, 8_000);
}
async function control(path) { const r = await fetch(base + path); assert.ok(r.ok, `${path}: HTTP ${r.status} ${await r.clone().text()}`); return r; }
const inspect = async () => (await control('/__inspect')).json();
const clock = (at, alarm = true) => control(`/__clock?at=${at}${alarm ? '' : '&alarm=0'}`);
const mode = m => control(`/__mode?mode=${m}`);
const latest = (c, type) => c.frames.findLast(f => f.type === type);
const send = (c, f) => c.ws.send(JSON.stringify({ v: 2, ...f }));
async function connect(token) {
  const c = { ws: new WebSocket(`ws://127.0.0.1:${port}/arena`, { headers: { Origin: origin } }), frames: [], token };
  sockets.push(c); let connected = false;
  c.ws.addEventListener('message', e => {
    const raw = String(e.data), frame = parseRingServer(raw);
    if (!frame) { invalidFrame = raw.slice(0, 1500); return; }
    c.frames.push(frame);
    if (frame.type === 'snapshot' && !connected) { connected = true; send(c, { type: 'session', ...(token ? { token } : {}) }); }
    if (frame.type === 'session' && frame.token) c.token = frame.token;
  });
  await until(() => latest(c, 'session'));
  return c;
}
const segment = 9000, requestAt = (r, k) => r.startsAt + k * segment - V5_PLAN_LEAD_MS, deadlineAt = (r, k) => r.startsAt + k * segment - 500;
const plansOf = async () => (await inspect()).round.plans;

try {
  await start();
  const a = await connect();
  await control('/__seed?seed=' + createHash('sha256').update('v5-arena-fixture').digest('hex'));
  let state = await inspect();
  const opening = state.round;
  assert.equal(opening.engine, COMBAT_V5_VERSION); assert.deepEqual(opening.plans, []); assert.equal(opening.closesAt - opening.openedAt, MATCH_OPEN_MS);
  assert.equal(opening.bout.round, 1); assert.equal(opening.match.seedHashes.length, 3); assert.deepEqual(opening.match.previous, []);
  send(a, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'winner', outcome: 'kor', amount: 1000 });
  await until(() => latest(a, 'error')?.code === 'INVALID_MESSAGE');
  const b0 = await connect();
  send(a, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'match-winner', outcome: 'kor', amount: 1000 });
  send(b0, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'match-winner', outcome: 'ayaz', amount: 700 });
  send(b0, { type: 'bet', id: randomUUID(), roundId: opening.id, market: 'match-knockdowns', outcome: '2', amount: 300 });
  await until(() => a.frames.some(f => f.type === 'ticket') && b0.frames.filter(f => f.type === 'ticket').length === 2);
  checks.push('match opens a 30 s window with three seed hashes; only match markets are accepted');

  // Cutoff: seed revealed, fight starts after the 2.5 s lead, plan 0 is requested at once.
  await mode('ok'); await clock(opening.closesAt);
  state = await inspect();
  const fight = state.round;
  assert.equal(fight.phase, 'fighting'); assert.equal(fight.startsAt, opening.closesAt + V5_PLAN_LEAD_MS); assert.equal(fight.endsAt - fight.startsAt, COMBAT_V5_DURATION_MS); assert.equal(fight.nextAt - fight.endsAt, RINGSIDE_RESULT_MS);
  assert.equal(createHash('sha256').update(contactCommitmentInputV5(fight.id, fight.seed, fight.bout)).digest('hex'), opening.commitment);
  assert.equal(matchSeedHash(fight.bout.id, 1, fight.seed), opening.match.seedHashes[0]);
  assert.equal(fight.plans.length, 1); assert.equal(fight.plans[0].source, 'jev'); assert.equal(fight.plans[0].model, 'jev-1.13.0');
  assert.deepEqual(fight.plans[0].plans.kor, { intent: 'body', target: 'body', threat: 'hook' });
  assert.equal(state.calls, 1); assert.equal(state.leaks, 0); assert.equal(state.usage.calls, 1); assert.equal(state.usage.input_tokens, 1200);
  await until(() => latest(a, 'snapshot').round.plans?.length === 1);
  checks.push('plan 0 comes from Jev at cutoff and is broadcast in the chained log');

  // Duplicate alarm at the same instant must not call Jev again.
  await clock(opening.closesAt); state = await inspect(); assert.equal(state.calls, 1); assert.equal(state.round.plans.length, 1);
  checks.push('duplicate alarms do not repeat a provider call or a plan');

  await mode('flaky'); await clock(requestAt(fight, 1));
  state = await inspect(); assert.equal(state.round.plans[1].source, 'jev'); assert.equal(state.calls, 3); assert.equal(state.usage.calls, 3);
  checks.push('a transient provider error is retried once and the Jev plan still arrives on time');

  await mode('bad'); await clock(requestAt(fight, 2));
  state = await inspect(); assert.equal(state.round.plans[2].source, 'fallback'); assert.equal(state.round.plans[2].model, null); assert.equal(state.calls, 5);
  checks.push('malformed Jev answers (after one retry) commit the deterministic fallback');

  // Lost request (e.g. a restart): no alarm at the request time; the next advance fills it by the deadline.
  await mode('ok'); await clock(deadlineAt(fight, 3), false); await clock(deadlineAt(fight, 3));
  state = await inspect(); assert.equal(state.round.plans[3].source, 'fallback'); assert.equal(state.calls, 5);
  checks.push('missed plan deadlines are filled with fallback plans, never left open');

  await mode('slow'); const t0 = Date.now(); await clock(requestAt(fight, 4));
  state = await inspect(); assert.equal(state.round.plans[4].source, 'fallback'); assert.ok(Date.now() - t0 >= 1400 && Date.now() - t0 < 4000, 'bounded by the 1.5 s deadline'); assert.equal(state.calls, 6, 'the budget leaves no retry');
  checks.push('provider timeout commits the fallback within the deadline');

  const plans = state.round.plans;
  assert.equal(plans.length, PLAN_COUNT); assert.ok(verifyPlanChain(plans, opening.commitment).ok);
  const replay = replayContactV5(fight.seed, fight.bout.initial, fight.bout.round, plans, false);
  assert.ok(replay.ok && replay.replay, 'every observation hash matches the replayed state');
  await clock(fight.endsAt); state = await inspect();
  assert.equal(state.round.phase, 'result'); assert.deepEqual(state.round.results, combatResults(replay.replay));
  const firstEnded = replay.replay.finish === 'stoppage', endState = state;
  if (!firstEnded) {
    assert.equal(state.round.match.results, null); assert.ok(state.tickets.every(t => t.status === 'accepted' && t.payout === 0)); assert.equal(state.fees.length, 0);
    await until(() => latest(a, 'snapshot').round.phase === 'result' && latest(a, 'snapshot').pools.every(p => p.status === 'locked'));
  }
  checks.push('round 1 result is replayable from the published log; pools stay locked until the bout ends');

  for (const f of a.frames) { const raw = JSON.stringify(f); assert.ok(!raw.includes(KEY) && !raw.includes('secretSeed')); }
  // wrangler dev echoes test vars at startup; the arena's own log lines must never carry the key.
  assert.ok(logs.split('\n').filter(l => l.includes('jev.corner')).every(l => !l.includes(KEY)), 'key never reaches arena logs');
  assert.ok(logs.includes('jev.corner'), 'arena logs each coach call');
  checks.push('the provider key never appears in frames or logs');

  await stop(); await start();
  const b = await connect(a.token); assert.equal(latest(b, 'snapshot').round.plans.length, PLAN_COUNT);
  await clock(fight.nextAt); state = await inspect();
  const next = state.round;
  if (fight.bout && replay.replay.finish !== 'stoppage') {
    assert.equal(next.bout.round, 2); assert.deepEqual(next.plans, []);
    const last = replay.replay.frames.at(-1);
    assert.equal(next.bout.initial.health.kor, Math.min(1000, last.kor.health + 250));
  }
  checks.push('restart keeps the log; the next round starts from the replayed final state');
  if (!firstEnded) {
    assert.equal(next.closesAt, next.openedAt, 'no betting window between rounds'); assert.equal(next.bout.id, fight.bout.id);
    assert.equal(next.match.previous.length, 1); assert.deepEqual(next.match.seedHashes, opening.match.seedHashes);
    await until(() => latest(b, 'snapshot').round.id === next.id);
    send(b, { type: 'bet', id: randomUUID(), roundId: next.bout.id, market: 'match-method', outcome: 'draw', amount: 500 });
    await until(() => latest(b, 'error')?.code === 'ROUND_CLOSED');
    const h = verifyMatchHistory(latest(b, 'snapshot').round); assert.ok(h.ok, 'browser replays round 1 from the published record'); assert.ok(h.carry && h.carry.kor.actor.length > 0, 'round 2 starts from the learner carry of round 1');
    checks.push('no bets between rounds; earlier rounds are published and replay in the browser');
    await mode('ok'); await clock(next.closesAt); state = await inspect();
    assert.equal(state.round.phase, 'fighting'); assert.equal(state.round.plans[0].source, 'fallback'); assert.equal(state.calls, 0, 'no provider call after the restart'); assert.equal(state.usage.calls, 6, 'budget of 6 calls holds across the restart');
    checks.push('call budget exhaustion falls back without calling the provider');
  }
  // Drive the bout to its end (fallback plans fill each deadline) and settle every pool once.
  if (firstEnded) state = endState;
  else {
    for (let guard = 0; guard < 12 && !(await inspect()).round.match.results; guard++) {
      const r = (await inspect()).round;
      await clock(r.phase === 'open' ? r.closesAt : r.phase === 'fighting' ? r.endsAt : r.nextAt);
    }
    state = await inspect();
  }
  const final = state.round, history = verifyMatchHistory(final);
  assert.ok(history.ok, 'final round history replays');
  const last = replayContactV5(final.seed, final.bout.initial, final.bout.round, final.plans, false, history.carry);
  assert.ok(last.ok && last.replay, 'the last round replays from the carry of the earlier rounds');
  assert.deepEqual(final.match.results, matchResults([...history.rounds, roundOutcome(last.replay)]));
  for (const m of MATCH_MARKETS) {
    const list = state.tickets.filter(t => t.market === m.id), fee = state.fees.find(f => f.market === m.id);
    assert.ok(fee, `pool ${m.id} settled once`);
    assert.equal(list.reduce((s, t) => s + t.payout, 0) + fee.fee, list.reduce((s, t) => s + t.amount, 0), `pool ${m.id} conserves`);
  }
  assert.ok(state.tickets.every(t => t.status !== 'accepted'));
  const winners = state.tickets.filter(t => t.market === 'match-winner');
  if (final.match.results['match-winner'] !== 'draw') assert.ok(winners.every(t => t.status === 'paid'), 'two-sided winner pool pays');
  if (!firstEnded) await until(() => latest(b, 'snapshot').round.match?.results);
  checks.push(`bout ends after ${final.bout.round} round(s); match pools settle on the replayed bout result and conserve`);
  const opened = state.round.nextAt; await clock(opened); state = await inspect();
  assert.equal(state.round.bout.round, 1); assert.equal(state.round.phase, 'open'); assert.notDeepEqual(state.round.match.seedHashes, opening.match.seedHashes);
  checks.push('the next match opens a fresh betting window');
  console.log(JSON.stringify({ ok: true, engine: COMBAT_V5_VERSION, checks }, null, 1));
} catch (error) {
  console.error(logs.slice(-6000));
  throw error;
} finally { await stop(); }
