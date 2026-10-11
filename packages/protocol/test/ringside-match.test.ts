import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayContactV5, replayMatchRounds, carryHash, COMBAT_V5_VERSION, type V5Carry, type V5Replay } from '../src/combat-v5';
import { PLAN_COUNT, cornerObsHash, fallbackPlans, planEntry, type PlanEntry } from '../src/corner-plan';
import { CONTACT_INITIAL, type ContactInitial } from '../src/combat-v3';
import { CONTACT_ENGINES, combatResults, contactCommitmentInputV5, parseRingServer, verifyMatchHistory, marketsOf, RINGSIDE_MARKETS, type ContactBout } from '../src/ringside';
import { MATCH_LEDGER, MATCH_MARKETS, MATCH_OPEN_MS, carryInitial, matchComplete, matchResults, matchSeedHash, roundOutcome } from '../src/ringside-match';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Built = { id: string; seed: string; bout: ContactBout; commitment: string; plans: PlanEntry[]; replay: V5Replay };
/** Plays a bout the way the arena does: fallback plans, carried state, stop at a stoppage or round 3. */
function bout(tag: string): { seeds: string[]; rounds: Built[] } {
  const seeds = [1, 2, 3].map(n => sha(`${tag}-${n}`)), rounds: Built[] = [];
  let initial: ContactInitial = structuredClone(CONTACT_INITIAL), score = { kor: 0, ayaz: 0 }, carry: V5Carry | undefined;
  for (let k = 1; k <= 3; k++) {
    const id = String(6 + k), b: ContactBout = { id: '7', round: k as 1 | 2 | 3, score: { ...score }, initial }, commitment = sha(contactCommitmentInputV5(id, seeds[k - 1]!, b));
    const plans: PlanEntry[] = [];
    for (let i = 0; i < PLAN_COUNT; i++) { const p = replayContactV5(seeds[k - 1]!, initial, k, plans, false, carry); assert.ok(p.ok && p.next); plans.push(planEntry(i ? plans[i - 1]!.hash : commitment, i, cornerObsHash(p.next), fallbackPlans(p.next), 'fallback', null)); }
    const p = replayContactV5(seeds[k - 1]!, initial, k, plans, false, carry); assert.ok(p.ok && p.replay);
    carry = p.replay.carry;
    rounds.push({ id, seed: seeds[k - 1]!, bout: b, commitment, plans, replay: p.replay });
    if (p.replay.finish === 'stoppage') break;
    if (p.replay.winner !== 'draw') score = { ...score, [p.replay.winner]: score[p.replay.winner] + 1 };
    initial = carryInitial(p.replay.frames.at(-1)!);
  }
  return { seeds, rounds };
}
const T = (k: number) => k === 1 ? { openedAt: 1000, closesAt: 31000, startsAt: 33500 } : { openedAt: 31000 + (k - 1) * 57500, closesAt: 31000 + (k - 1) * 57500, startsAt: 33500 + (k - 1) * 57500 };
function roundJson(m: ReturnType<typeof bout>, k: number, phase: 'open' | 'fighting' | 'result') {
  const r = m.rounds[k - 1]!, t = T(k), done = phase === 'result' && k === m.rounds.length, outcomes = m.rounds.slice(0, k).map(x => roundOutcome(x.replay));
  return { id: r.id, phase, openedAt: t.openedAt, closesAt: t.closesAt, startsAt: phase === 'open' ? null : t.startsAt, endsAt: phase === 'open' ? null : t.startsAt + 45000, nextAt: phase === 'open' ? null : t.startsAt + 55000,
    commitment: r.commitment, seed: phase === 'open' ? null : r.seed, engine: COMBAT_V5_VERSION, bout: r.bout,
    plans: phase === 'open' ? [] : phase === 'fighting' ? r.plans.slice(0, 2) : r.plans,
    match: { ledger: MATCH_LEDGER, openedAt: 1000, closesAt: 31000, seedHashes: m.seeds.map((s, i) => matchSeedHash('7', i + 1, s)), previous: m.rounds.slice(0, k - 1).map(x => ({ id: x.id, seed: x.seed, initial: x.bout.initial, plans: x.plans })), results: done ? matchResults(outcomes) : null },
    results: phase === 'result' ? combatResults(r.replay) : null };
}
const snapshot = (round: ReturnType<typeof roundJson>, status: string, at: number) => JSON.stringify({ v: 2, type: 'snapshot', revision: 1, at, round, online: 0, participants: 0, total: 0, count: 0,
  pools: MATCH_MARKETS.map(m => ({ market: m.id, total: 0, count: 0, sides: Object.fromEntries(m.outcomes.map(o => [o, 0])), fee: 0, distributed: 0, status })), tape: [] });

test('match results: a stoppage wins outright, otherwise rounds won decide', () => {
  const r = (winner: string, finish = 'decision', knockdowns = 0) => ({ winner, finish, knockdowns });
  assert.deepEqual(matchResults([r('ayaz', 'stoppage', 3)]), { 'match-winner': 'ayaz', 'match-method': 'ayaz-stop', 'match-knockdowns': '3-plus' });
  assert.deepEqual(matchResults([r('kor'), r('ayaz', 'decision', 1), r('kor')]), { 'match-winner': 'kor', 'match-method': 'kor-points', 'match-knockdowns': '0-1' });
  assert.deepEqual(matchResults([r('kor', 'decision', 1), r('ayaz', 'decision', 1), r('draw')]), { 'match-winner': 'draw', 'match-method': 'draw', 'match-knockdowns': '2' });
  assert.deepEqual(matchResults([r('ayaz'), r('ayaz'), r('kor', 'stoppage', 4)]), { 'match-winner': 'kor', 'match-method': 'kor-stop', 'match-knockdowns': '3-plus' }, 'a late stoppage beats a points lead');
  assert.equal(roundOutcome({ winner: 'kor', finish: 'decision', events: [{ type: 'hit' }, { type: 'knockdown' }, { type: 'knockdown' }] }).knockdowns, 2);
  assert.throws(() => matchResults([r('kor'), r('kor')]), /MATCH_NOT_COMPLETE/);
  assert.equal(matchComplete([r('kor')]), false); assert.equal(matchComplete([r('kor', 'stoppage')]), true);
  for (const m of MATCH_MARKETS) assert.ok(!RINGSIDE_MARKETS.some(x => x.id === m.id), 'match and round markets never share an id');
  assert.equal(marketsOf(COMBAT_V5_VERSION), MATCH_MARKETS);
  assert.equal(MATCH_OPEN_MS, 30_000);
});

test('match snapshots: one window before round 1, locked between rounds, settled at the end', () => {
  const m = bout('match-a');
  assert.ok(parseRingServer(snapshot(roundJson(m, 1, 'open'), 'open', 2000)), 'round 1 opens the betting window');
  const r1 = roundJson(m, 1, 'result');
  if (m.rounds.length === 1) { assert.ok(parseRingServer(snapshot(r1, 'refunded', 80000))); return; }
  assert.ok(parseRingServer(snapshot(r1, 'locked', 80000)), 'round 1 result keeps pools locked');
  assert.equal(parseRingServer(snapshot(r1, 'refunded', 80000)), null, 'no settlement before the bout ends');
  const r2 = roundJson(m, 2, 'open');
  assert.ok(parseRingServer(snapshot(r2, 'locked', r2.openedAt)), 'round 2 opens with no betting window');
  assert.equal(parseRingServer(snapshot(r2, 'open', r2.openedAt)), null, 'pools cannot reopen between rounds');
  assert.equal(parseRingServer(snapshot({ ...r2, closesAt: r2.openedAt + 20000 }, 'locked', r2.openedAt)), null);
  assert.equal(parseRingServer(snapshot({ ...r2, match: { ...r2.match, previous: [] } }, 'locked', r2.openedAt)), null, 'earlier rounds must be published');
  const last = roundJson(m, m.rounds.length, 'result');
  assert.ok(parseRingServer(snapshot(last, 'refunded', last.endsAt! + 1)), 'empty pools refund at the end');
  assert.equal(parseRingServer(snapshot({ ...last, match: { ...last.match, results: null } }, 'refunded', last.endsAt! + 1)), null);
});

test('browsers replay every earlier round and reject a swapped seed, log or score', () => {
  const m = bout('match-b'), k = m.rounds.length;
  const last = roundJson(m, k, 'result') as Parameters<typeof verifyMatchHistory>[0];
  const h = verifyMatchHistory(last);
  assert.ok(h.ok, 'full history replays'); assert.equal(h.ok && h.rounds.length, k - 1);
  if (h.ok) assert.deepEqual(last.match!.results, matchResults([...h.rounds, roundOutcome(m.rounds[k - 1]!.replay)]));
  assert.equal(verifyMatchHistory({ ...last, seed: sha('other') }).ok, false, 'revealed seed must match its published hash');
  if (k < 2) return;
  const prev = last.match!.previous;
  assert.equal(verifyMatchHistory({ ...last, match: { ...last.match!, previous: [{ ...prev[0]!, seed: sha('x') }, ...prev.slice(1)] } }).ok, false);
  assert.equal(verifyMatchHistory({ ...last, match: { ...last.match!, previous: [{ ...prev[0]!, plans: [prev[0]!.plans[1]!, ...prev[0]!.plans.slice(1)] }, ...prev.slice(1)] } }).ok, false);
  assert.equal(verifyMatchHistory({ ...last, bout: { ...last.bout!, score: { kor: last.bout!.score.kor, ayaz: last.bout!.score.ayaz + 1 } } }).ok, false, 'a score that does not match the replayed rounds is rejected');
  assert.equal(verifyMatchHistory({ ...last, bout: { ...last.bout!, initial: { ...last.bout!.initial, health: { kor: 1000, ayaz: 1000 } } } }).ok, last.bout!.initial.health.kor === 1000 && last.bout!.initial.health.ayaz === 1000, 'carried state is checked');
});

test('every match outcome is a valid pool outcome id', async () => {
  const { settlePariMutuelPool } = await import('../src/pari-mutuel');
  for (const m of MATCH_MARKETS) for (const won of m.outcomes) {
    const s = settlePariMutuelPool({ poolId: `7:${m.id}`, outcomes: [...m.outcomes], feeBps: 200n, escrowAmount: 300n, tickets: m.outcomes.slice(0, 2).map((o, i) => ({ ticketId: `t${i}`, outcome: o, stake: 150n })), winningOutcome: won });
    assert.equal(s.payoutTotal + s.platformFee, 300n);
  }
});

test('verifyMatchHistory threads the learner carry through earlier rounds and returns the one the current round starts from', () => {
  let m = bout('carry-a');
  for (const tag of ['carry-b', 'carry-c', 'carry-d', 'carry-e']) { if (m.rounds.length === 3) break; m = bout(tag); }
  assert.equal(m.rounds.length, 3, 'a three-round bout was found');
  // Round 1: no carry. Round k: the carry of rounds 1..k-1.
  const r1 = verifyMatchHistory(roundJson(m, 1, 'result') as Parameters<typeof verifyMatchHistory>[0]);
  assert.ok(r1.ok && r1.carry === undefined);
  for (const k of [2, 3]) {
    const round = roundJson(m, k, 'result') as Parameters<typeof verifyMatchHistory>[0], h = verifyMatchHistory(round);
    assert.ok(h.ok && h.carry, `round ${k} verifies with a carry`);
    assert.equal(carryHash(h.carry), carryHash(m.rounds[k - 2]!.replay.carry), `carry after round ${k - 1}`);
    // The engine registry simulates the current round from that carry exactly like the arena did.
    const sim = CONTACT_ENGINES[COMBAT_V5_VERSION].simulate(m.rounds[k - 1]!.seed, m.rounds[k - 1]!.bout.initial, k, m.rounds[k - 1]!.plans, h.carry) as V5Replay;
    assert.deepEqual(combatResults(sim), combatResults(m.rounds[k - 1]!.replay));
    assert.equal(carryHash(sim.carry), carryHash(m.rounds[k - 1]!.replay.carry));
    // Without the carry the round does not replay against its own plan log (or plays differently): memory is part of the result.
    assert.throws(() => CONTACT_ENGINES[COMBAT_V5_VERSION].simulate(m.rounds[k - 1]!.seed, m.rounds[k - 1]!.bout.initial, k, m.rounds[k - 1]!.plans), /PLAN_LOG_INVALID/);
    // A wrong carry does not replay either.
    const wrong: V5Carry = structuredClone(h.carry); wrong.kor.actor[3] = (wrong.kor.actor[3] ?? 0) + 0.5; wrong.ayaz.success = 0.05;
    const bad = replayContactV5(m.rounds[k - 1]!.seed, m.rounds[k - 1]!.bout.initial, k, m.rounds[k - 1]!.plans, false, wrong);
    assert.ok(!bad.ok || JSON.stringify(bad.replay?.events) !== JSON.stringify(m.rounds[k - 1]!.replay.events), 'tampered carry changes or breaks the replay');
  }
  // Tampering with an earlier round breaks the later history, because later rounds only replay from the true carry.
  const last = roundJson(m, 3, 'result') as Parameters<typeof verifyMatchHistory>[0], prev = last.match!.previous;
  const swapped = { ...last, match: { ...last.match!, previous: [prev[0]!, { ...prev[1]!, plans: prev[0]!.plans }] } };
  assert.equal(verifyMatchHistory(swapped).ok, false);
  // The helper used by servers gives the same chain of carries.
  const again = replayMatchRounds(prev);
  assert.ok(again && again.length === 2 && carryHash(again[1]!.carry) === carryHash(m.rounds[1]!.replay.carry));
});
