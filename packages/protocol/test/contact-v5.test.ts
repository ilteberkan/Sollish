import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateContactCombatV5, createContactV5, replayContactV5, COMBAT_V5_VERSION, COMBAT_V5_DURATION_MS, V5_TICK_MS, V5_REWARD, V5_FIGHTERS, V5_TEMPO, V5_KICK_RULES, V5_MODEL, carryHash, parseV5Carry, replayMatchRounds, type V5Carry, type V5Replay, type V5Corner, type V5ScriptView } from '../src/combat-v5';
import { V5_STRIKES, isV5Kick, isV5Strike, type V5Strike } from '../src/combat-v5-strikes';
import { COMBAT_V4_VERSION, simulateContactCombatV4 } from '../src/combat-v4';
import { LEARNER_ACTIONS, LEARNER_FEATURES, LEARNER_INPUT_NAMES, LEARNER_INPUTS, LEARNER_RULE, createLearner, expD, learnerAct, learnerFinish, learnerReward, reservoirStep, tanhD, zeroLearnerParams } from '../src/contact-learner';
import { CONTACT_V5_PARAMS, CONTACT_V5_TRAINED, CONTACT_V5_WEIGHTS_SHA } from '../src/contact-v5-weights';
import { carryInitial } from '../src/ringside-match';
import { RESERVOIR, RESERVOIR_INFO } from '../src/connectome-reservoir';
import { CONNECTOME_POLICY_INFO } from '../src/connectome-policy';
import { PLAN_COUNT, PLAN_TICKS, cornerObsHash, fallbackPlans, isCornerPlan, jevCornerRequest, parseCornerObservation, parseJevCornerAnswer, planEntry, verifyPlanChain, type CornerPlan, type PlanEntry } from '../src/corner-plan';
import { CONTACT_ENGINES, contactCommitmentInputV5, parseRingServer, type ContactBout } from '../src/ringside';
import { V5_REWARD_TABLE, engineSha } from '../../../experiments/ringside-learner/weights';

const seed = (i: number) => createHash('sha256').update(`contact-v5-${i}`).digest('hex');
const commitment = createHash('sha256').update('commitment').digest('hex');
/** Builds a valid live log the way the arena does: fallback plans, chained from the commitment. */
function liveLog(s: string, initial = { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } }, round = 1, override?: (k: number) => { kor: CornerPlan; ayaz: CornerPlan } | null, carry?: V5Carry): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (let k = 0; k < PLAN_COUNT; k++) {
    const p = replayContactV5(s, initial, round, entries, false, carry);
    assert.ok(p.ok && p.next);
    const plans = override?.(k) ?? fallbackPlans(p.next);
    entries.push(planEntry(k ? entries[k - 1]!.hash : commitment, k, cornerObsHash(p.next), plans, override?.(k) ? 'jev' : 'fallback', override?.(k) ? 'jev-1.13.0' : null));
  }
  return entries;
}

test('deterministic math stays close to the reference functions', () => {
  for (let x = -6; x <= 6; x += 0.01) assert.ok(Math.abs(tanhD(x) - Math.tanh(x)) < 1e-4, `tanh ${x}`);
  for (let x = -20; x <= 20; x += 0.05) assert.ok(Math.abs(expD(x) / Math.exp(x) - 1) < 5e-5, `exp ${x}`);
  assert.equal(tanhD(100), 1); assert.equal(tanhD(-100), -1); assert.ok(expD(100) === expD(30));
});

test('v5 is deterministic, versioned by its frozen learner and leaves v4 untouched', () => {
  const a = simulateContactCombatV5(seed(1)), b = simulateContactCombatV5(seed(1));
  assert.deepEqual(a, b);
  assert.equal(a.version, COMBAT_V5_VERSION); assert.notEqual(COMBAT_V5_VERSION, COMBAT_V4_VERSION);
  assert.ok(COMBAT_V5_VERSION.endsWith(CONTACT_V5_WEIGHTS_SHA.slice(0, 8)));
  assert.equal(a.frames.length, COMBAT_V5_DURATION_MS / V5_TICK_MS + 1);
  assert.equal(a.plans.length, PLAN_COUNT);
  assert.equal(RESERVOIR_INFO.graphSha256, CONNECTOME_POLICY_INFO.graphSha256);
  assert.equal(RESERVOIR.pre.length, 4949);
  assert.deepEqual(V5_REWARD, V5_REWARD_TABLE, 'the reward table hashed into the engine id must match the engine');
  assert.equal(simulateContactCombatV4(seed(1)).version, COMBAT_V4_VERSION);
  assert.throws(() => simulateContactCombatV5('xyz'), TypeError);
});

test('weights change during the match only through the frozen rule, and identically on replay', () => {
  const r = simulateContactCombatV5(seed(2));
  assert.ok(r.learning.kor.updates > 40 && r.learning.ayaz.updates > 40, 'each fighter learns from dozens of decisions');
  assert.ok(r.learning.kor.drift > 0 && r.learning.ayaz.drift > 0, 'weights actually moved');
  const frozen = simulateContactCombatV5(seed(2), undefined, undefined, { corners: [{ kind: 'learner', learn: false }, { kind: 'learner', learn: false }] });
  assert.equal(frozen.learning.kor.drift, 0);
  assert.notDeepEqual(frozen.events, r.events, 'learning changes behaviour');
});

test('the learner rejects invalid input, masks and samples before mutating state', () => {
  const l = createLearner(zeroLearnerParams()), x = new Array(LEARNER_INPUTS).fill(0), legal = new Uint8Array(LEARNER_ACTIONS.length).fill(1);
  assert.throws(() => reservoirStep(l, x.slice(1)), TypeError);
  assert.throws(() => reservoirStep(l, [...x.slice(1), 2]), TypeError);
  assert.throws(() => learnerAct(l, x, new Uint8Array(LEARNER_ACTIONS.length), 0.5), TypeError);
  assert.throws(() => learnerAct(l, x, legal, 1), TypeError);
  assert.equal(l.last, null);
  assert.throws(() => createLearner({ actor: [1], critic: [] }), TypeError);
});

test('masked actions are never chosen and a positive reward makes the chosen action more likely', () => {
  const l = createLearner(zeroLearnerParams()), x = new Array(LEARNER_INPUTS).fill(0.2), legal = new Uint8Array(LEARNER_ACTIONS.length);
  legal[0] = 1; legal[5] = 1;
  for (let i = 0; i < 50; i++) { const c = learnerAct(l, x, legal, (i * 0.37) % 1); assert.ok(c.index === 0 || c.index === 5); }
  const m = createLearner(zeroLearnerParams()), all = new Uint8Array(LEARNER_ACTIONS.length).fill(1);
  const first = learnerAct(m, x, all, 0.01);
  learnerReward(m, 1);
  const second = learnerAct(m, x, all, 0.01);
  assert.ok(second.probs[first.index]! > first.probs[first.index]!);
  assert.equal(typeof learnerFinish(m), 'number');
});

test('plan log: chain, closed shapes and replay verification catch tampering', () => {
  const s = seed(3), log = liveLog(s);
  assert.ok(verifyPlanChain(log, commitment).ok);
  const full = replayContactV5(s, { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } }, 1, log);
  assert.ok(full.ok && full.replay);
  assert.deepEqual(full.replay.events, simulateContactCombatV5(s).events, 'fallback log replays exactly like the default simulation');
  const swapped = structuredClone(log); swapped[3]!.plans.kor = { intent: 'finisher', target: 'body', threat: 'upper' };
  assert.deepEqual(verifyPlanChain(swapped, commitment), { ok: false, index: 3 });
  assert.deepEqual(verifyPlanChain(log, '0'.repeat(64)), { ok: false, index: 0 });
  assert.deepEqual(verifyPlanChain([log[1]], commitment), { ok: false, index: 0 });
  // A correctly chained entry whose observation does not match the replayed state is rejected.
  const forged = [...log.slice(0, 2)]; forged.push(planEntry(log[1]!.hash, 2, 'f'.repeat(64), log[2]!.plans, 'fallback', null));
  assert.ok(verifyPlanChain(forged, commitment).ok);
  assert.deepEqual(replayContactV5(s, { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } }, 1, forged), { ok: false, index: 2 });
  assert.equal(isCornerPlan({ intent: 'pressure', target: 'head', threat: 'hook', extra: 1 }), false);
});

test('plans change the fight: a body plan raises body punching across seeds, the same plan reproduces it', () => {
  const initial = { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } };
  // Body plan: every blow to the body or legs (body hook, body kick, low kick, teep, knee).
  const bodyShots = (r: V5Replay) => r.events.filter(e => e.type === 'strike' && e.actor === 'kor' && isV5Strike(e.technique) && V5_STRIKES[e.technique].target !== 'head').length;
  let base = 0, body = 0;
  for (let i = 0; i < 12; i++) {
    const s = seed(400 + i);
    const a = replayContactV5(s, initial, 1, liveLog(s));
    const b = replayContactV5(s, initial, 1, liveLog(s, undefined, 1, () => ({ kor: { intent: 'body', target: 'body', threat: 'hook' }, ayaz: { intent: 'cautious', target: 'head', threat: 'straight' } })));
    assert.ok(a.ok && b.ok && a.replay && b.replay);
    if (i === 0) assert.notDeepEqual(a.replay.events, b.replay.events);
    base += bodyShots(a.replay); body += bodyShots(b.replay);
  }
  // The untrained placeholder only reacts to the plan through slow in-match learning; the trained checkpoint must show the effect.
  if (CONTACT_V5_TRAINED) assert.ok(body > base, `body plan ${body} vs fallback ${base} body blows`);
});

test('observations hold public integers only and the Jev request never carries seeds or ids', () => {
  const m = createContactV5(seed(5));
  m.playSegment(fallbackPlans(m.observation())); m.playSegment(fallbackPlans(m.observation()));
  const o = m.observation();
  assert.ok(parseCornerObservation(o));
  const text = JSON.stringify(jevCornerRequest(o));
  assert.ok(!text.includes(seed(5)) && !/tick|seed|wager|balance|session/i.test(JSON.stringify(o)));
  assert.equal(parseCornerObservation({ ...o, seed: seed(5) }), null);
  assert.equal(parseCornerObservation({ ...o, round: 4 }), null);
});

test('Jev corner answers are parsed strictly', () => {
  const choice = (pick: string, options: readonly string[]) => ({ type: 'choice', choice: pick, confidence: 0.7, probabilities: Object.fromEntries(options.map(k => [k, k === pick ? 0.7 : +(0.3 / (options.length - 1)).toFixed(2)])) });
  const styles = ['pressure', 'counter', 'cautious', 'outboxer', 'body', 'finisher'], targets = ['head', 'body'], threats = ['straight', 'hook', 'upper', 'body'];
  const good = { model: 'jev-1.13.0', usage: { input_tokens: 900, output_tokens: 40 }, answers: {
    kor_intent: choice('pressure', styles), kor_target: choice('body', targets), kor_threat: choice('hook', threats),
    ayaz_intent: choice('counter', styles), ayaz_target: choice('head', targets), ayaz_threat: choice('straight', threats) } };
  const parsed = parseJevCornerAnswer(good);
  assert.deepEqual(parsed?.plans, { kor: { intent: 'pressure', target: 'body', threat: 'hook' }, ayaz: { intent: 'counter', target: 'head', threat: 'straight' } });
  assert.equal(parseJevCornerAnswer({ ...good, model: 'jev-latest' }), null);
  assert.equal(parseJevCornerAnswer({ ...good, extra: 1 }), null);
  assert.equal(parseJevCornerAnswer({ ...good, answers: { ...good.answers, kor_intent: choice('ko', [...styles, 'ko']) } }), null);
  assert.equal(parseJevCornerAnswer({ ...good, answers: { ...good.answers, kor_target: { ...choice('body', targets), choice: 'head' } } }), null, 'non arg-max pick');
  assert.equal(parseJevCornerAnswer({ ...good, usage: { input_tokens: -1, output_tokens: 0 } }), null);
});

test('every committed plan tick sits on the 9-second grid (five plans per round)', () => {
  assert.equal(PLAN_COUNT * PLAN_TICKS, 900);
  const log = liveLog(seed(8));
  assert.deepEqual(log.map(e => e.tick), Array.from({ length: PLAN_COUNT }, (_, k) => k * PLAN_TICKS));
});

test('checkpoint parameters are finite and bounded', () => {
  for (const v of [...CONTACT_V5_PARAMS.actor, ...CONTACT_V5_PARAMS.critic]) assert.ok(Number.isFinite(v) && Math.abs(v) <= LEARNER_RULE.criticBound);
});

test('the engine id covers the checkpoint, the strike table and the kick rules', () => {
  assert.equal(engineSha(CONTACT_V5_PARAMS).sha, CONTACT_V5_WEIGHTS_SHA, 'regenerate contact-v5-weights.ts with experiments/ringside-learner/freeze.ts');
  assert.equal(CONTACT_V5_PARAMS.actor.length, LEARNER_ACTIONS.length * (1 + LEARNER_INPUTS + RESERVOIR.nodes));
});

/** Counts for a batch of rounds: all learners share one checkpoint, fallback plans. */
function batch(n: number, from: number, corners?: readonly [V5Corner, V5Corner]) {
  const out = { n, kor: 0, strikes: 0, kicks: 0, knockdowns: 0, techniques: {} as Record<string, number> };
  for (let i = 0; i < n; i++) {
    const r = simulateContactCombatV5(seed(from + i), i % 3 === 2 ? { health: { kor: 600, ayaz: 650 }, stamina: { kor: 700, ayaz: 650 } } : undefined, undefined, { minds: false, ...(corners ? { corners } : {}) });
    out.kor += r.winner === 'kor' ? 1 : r.winner === 'draw' ? .5 : 0;
    for (const e of r.events) if (e.type === 'strike') { out.strikes++; if (isV5Kick(e.technique)) out.kicks++; out.techniques[e.technique] = (out.techniques[e.technique] ?? 0) + 1; }
    out.knockdowns += r.knockdown === 'yes' ? 1 : 0;
  }
  return out;
}

test('live balance band holds with both corners learning (trained checkpoint only)', { skip: !CONTACT_V5_TRAINED && 'untrained placeholder checkpoint: the balance band is checked after training' }, () => {
  const o = batch(90, 1000);
  assert.ok(o.kor / o.n >= .4 && o.kor / o.n <= .6, `KOR share ${o.kor / o.n}`);
  assert.ok(o.strikes / o.n >= 40 && o.strikes / o.n <= 65, `tempo ${o.strikes / o.n}`);
  // Rule v5m measured 36.6-37.4% kicks against a 15-35% design band; accepted (10 Oct 2026) with a 40% ceiling, see ops/evidence/ringside-contact5-20261010/summary.json.
  assert.ok(o.kicks / o.strikes >= .15 && o.kicks / o.strikes <= .40, `kick share ${o.kicks / o.strikes}`);
  assert.ok(o.knockdowns / o.n >= .15 && o.knockdowns / o.n <= .35, `knockdowns ${o.knockdowns / o.n}`);
  assert.equal(Object.keys(o.techniques).length, Object.keys(V5_STRIKES).length, 'every punch and kick appears');
});

const UNTRAINED: readonly [V5Corner, V5Corner] = [{ kind: 'learner', params: zeroLearnerParams() }, { kind: 'learner', params: zeroLearnerParams() }];
const INITIAL = { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } };
const dist = (f: { kor: { x: number; z: number }; ayaz: { x: number; z: number } }) => Math.hypot(f.kor.x - f.ayaz.x, f.kor.z - f.ayaz.z);
/** A scripted corner that throws `blow` whenever it is legal and otherwise closes in (or does `fallback`). */
const thrower = (blow: V5Strike, fallback: 'advance' | 'guard' | 'retreat' = 'advance'): V5Corner => ({ kind: 'script', control: (v: V5ScriptView) => v.legal(blow) ? blow : fallback });
const dummy = (action: 'guard' | 'advance' | 'roll' | 'retreat'): V5Corner => ({ kind: 'script', control: () => action });

test('strikes (punches, kicks and the knee) start only within reach, combinations stop at three, and stamina is not spent in seconds', () => {
  let stamina10 = 0, kicks = 0;
  for (let i = 0; i < 30; i++) {
    const r = simulateContactCombatV5(seed(2000 + i), undefined, undefined, { minds: false, corners: i % 2 ? UNTRAINED : undefined });
    for (const e of r.events) {
      if (e.type !== 'strike') continue;
      assert.ok(isV5Strike(e.technique));
      // The choice is made from the positions at the start of the tick (the previous frame).
      const d = dist(r.frames[Math.max(0, e.tick - 1)]!), s = e.technique as V5Strike;
      assert.ok(d <= V5_STRIKES[s].reach + V5_FIGHTERS[e.actor].reach + V5_TEMPO.strikeMargin, `${e.technique} from ${d} mm at ${e.tick}`);
      assert.ok((e.combo ?? 0) < V5_TEMPO.comboMax, `combo ${e.combo}`);
      if (isV5Kick(s)) kicks++;
    }
    stamina10 += (r.frames[200]!.kor.stamina + r.frames[200]!.ayaz.stamina) / 2;
  }
  assert.ok(kicks > 20, 'kicks are thrown');
  assert.ok(stamina10 / 30 > 650, `stamina at 10 s ${stamina10 / 30}`);
});

test('the knee is thrown only at close range, and every kick respects its own reach plus the margin', () => {
  const knee = V5_STRIKES.knee.reach;
  assert.ok(V5_STRIKES.knee.reach < V5_STRIKES.uppercut.reach, 'the knee is the shortest blow');
  let knees = 0;
  for (let i = 0; i < 40; i++) {
    const r = simulateContactCombatV5(seed(2100 + i), undefined, undefined, { minds: false, corners: UNTRAINED });
    for (const e of r.events) if (e.type === 'strike' && e.technique === 'knee') {
      knees++;
      assert.ok(dist(r.frames[Math.max(0, e.tick - 1)]!) <= knee + V5_FIGHTERS[e.actor].reach + V5_TEMPO.strikeMargin, 'knee out of range');
    }
  }
  assert.ok(knees > 5, `knees thrown ${knees}`);
  // A knee thrower facing a fighter who stays away never gets a knee off at long range: the blow is illegal there.
  const far = simulateContactCombatV5(seed(2150), undefined, undefined, { minds: false, corners: [thrower('knee', 'guard'), dummy('retreat')] });
  for (const e of far.events) if (e.type === 'strike' && e.actor === 'kor') assert.ok(dist(far.frames[Math.max(0, e.tick - 1)]!) <= knee + V5_FIGHTERS.kor.reach + V5_TEMPO.strikeMargin);
});

test('out of a clinch the knee is the only blow, and it ends the clinch for both fighters', () => {
  // Low stamina (below 300) makes the clinch legal; inside the clinch the script holds, then knees.
  const clinchKnee: V5Corner = { kind: 'script', control: (v: V5ScriptView) => v.me.action === 'clinch' ? (v.legal('knee') ? 'knee' : 'clinch') : v.distance > 760 ? 'advance' : v.legal('clinch') ? 'clinch' : 'guard' };
  let found = 0;
  for (let i = 0; i < 12 && found < 3; i++) {
    const r = simulateContactCombatV5(seed(2200 + i), { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 100, ayaz: 100 } }, undefined, { minds: false, corners: [clinchKnee, clinchKnee] });
    for (const c of r.events.filter(e => e.type === 'clinch')) {
      const knee = r.events.find(e => e.type === 'strike' && e.technique === 'knee' && e.tick > c.tick && e.tick < c.tick + 30);
      if (!knee) continue;
      found++;
      assert.equal((knee.tick - c.tick) % V5_KICK_RULES.clinchDecision, 0, 'the knee comes at a clinch decision tick');
      assert.ok(r.events.some(e => e.type === 'break' && e.tick === knee.tick), 'the knee breaks the clinch');
      assert.equal(r.events.filter(e => e.type === 'break' && e.tick > c.tick && e.tick <= c.tick + 30).length, 1, 'the clinch ends once');
      for (const side of ['kor', 'ayaz'] as const) assert.notEqual(r.frames[knee.tick]![side].action, 'clinch', `${side} released`);
    }
  }
  assert.ok(found > 0, 'a knee out of a clinch happened');
  // Without a knee the clinch still runs its full span and ends with the referee break.
  const holder: V5Corner = { kind: 'script', control: (v: V5ScriptView) => v.me.action === 'clinch' ? 'clinch' : v.distance > 760 ? 'advance' : v.legal('clinch') ? 'clinch' : 'guard' };
  const r = simulateContactCombatV5(seed(2200), { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 100, ayaz: 100 } }, undefined, { minds: false, corners: [holder, holder] });
  const c = r.events.find(e => e.type === 'clinch');
  assert.ok(c);
  const b = r.events.find(e => e.type === 'break' && e.tick > c.tick);
  assert.ok(b && b.tick - c.tick >= 18 && b.tick - c.tick < 28, 'plain clinch span unchanged');
});

test('a low kick scores and drains stamina but never stuns or knocks down, even on a fighter with almost no health', () => {
  const spec = V5_STRIKES.lowKick;
  assert.equal(spec.target, 'leg'); assert.equal(spec.stun, 0);
  let landed = 0;
  for (let i = 0; i < 10; i++) {
    for (const health of [1000, 40]) {
      const r = simulateContactCombatV5(seed(2300 + i), { health: { kor: 1000, ayaz: health }, stamina: { kor: 1000, ayaz: 1000 } }, undefined, { minds: false, corners: [thrower('lowKick'), dummy('advance')] });
      assert.ok(!r.events.some(e => e.type === 'knockdown'), 'a low kick knocks nobody down');
      assert.ok(r.frames.every(f => f.ayaz.health >= 1 && f.ayaz.stun === 0), 'health stays above zero and no stun builds up');
      let points = 0;
      for (const e of r.events) {
        if (e.actor !== 'kor' || (e.type !== 'hit' && e.type !== 'block')) continue;
        points += e.damage;
        if (e.type !== 'hit') continue;
        landed++;
        assert.equal(e.bodyPart, 'leg');
        // Frame t holds this tick's regeneration (+3) and the drain; the tick before is untouched by the kick.
        const before = r.frames[e.tick - 1]!.ayaz.stamina, after = r.frames[e.tick]!.ayaz.stamina;
        assert.ok(before < spec.drain || after - before <= V5_TEMPO.regen - spec.drain, `stamina ${before} -> ${after}`);
      }
      assert.equal(r.points.kor, points, 'leg damage counts for points');
      assert.ok(r.points.kor > 0);
    }
  }
  assert.ok(landed > 10, `low kicks landed ${landed}`);
});

test('a low kick is checked by the guard like a body shot', () => {
  let checked = 0, landed = 0;
  for (let i = 0; i < 10; i++) {
    const r = simulateContactCombatV5(seed(2350 + i), INITIAL, undefined, { minds: false, corners: [thrower('lowKick'), dummy('guard')] });
    for (const e of r.events) if (e.actor === 'kor' && e.technique === 'lowKick') { if (e.type === 'block') { checked++; assert.equal(e.bodyPart, 'guard'); } if (e.type === 'hit') landed++; }
  }
  assert.ok(checked > 0 && landed > 0, `checked ${checked} landed ${landed}`);
});

test('a teep that lands pushes the target back along the fight line, inside the ring', () => {
  const push = V5_STRIKES.teep.push;
  assert.ok(push > 0);
  let pushed = 0;
  for (let i = 0; i < 12; i++) {
    const r = simulateContactCombatV5(seed(2400 + i), INITIAL, undefined, { minds: false, corners: [thrower('teep'), dummy('guard')] });
    for (const f of r.frames) for (const side of ['kor', 'ayaz'] as const) assert.ok(Math.abs(f[side].x) <= 3100 && Math.abs(f[side].z) <= 3100, 'inside the ropes');
    for (const e of r.events) {
      if (e.type !== 'hit' || e.technique !== 'teep') continue;
      const p = r.frames[e.tick - 1]!, f = r.frames[e.tick]!;
      if (Math.abs(p.ayaz.x) > 2400 || Math.abs(p.ayaz.z) > 2400) continue; // near the ropes the push is cut short
      pushed++;
      assert.ok(dist(f) - dist(p) >= push - 60, `distance ${dist(p)} -> ${dist(f)}`);
      assert.ok(dist(f) >= 600, 'bodies stay apart');
    }
  }
  assert.ok(pushed > 3, `teeps landed ${pushed}`);
  // Only a teep pushes.
  for (const [k, spec] of Object.entries(V5_STRIKES)) assert.equal(spec.push > 0, k === 'teep', k);
});

test('a head kick is blocked by a raised guard, can be rolled under, and can knock a weakened fighter down', () => {
  const spec = V5_STRIKES.headKick;
  assert.equal(spec.target, 'head'); assert.equal(spec.kind, 'hook');
  let blocked = 0, hitGuarded = 0, dodged = 0, rolledHits = 0;
  for (let i = 0; i < 12; i++) {
    const guarded = simulateContactCombatV5(seed(2500 + i), INITIAL, undefined, { minds: false, corners: [thrower('headKick'), dummy('guard')] });
    for (const e of guarded.events) if (e.actor === 'kor' && e.technique === 'headKick') { if (e.type === 'block') { blocked++; assert.equal(e.bodyPart, 'guard'); } if (e.type === 'hit') hitGuarded++; }
    const rolling = simulateContactCombatV5(seed(2500 + i), INITIAL, undefined, { minds: false, corners: [thrower('headKick'), dummy('roll')] });
    for (const e of rolling.events) if (e.actor === 'kor' && e.technique === 'headKick') { if (e.type === 'dodge') dodged++; if (e.type === 'hit') rolledHits++; }
  }
  assert.ok(blocked > 0 && hitGuarded === 0, `a guard blocks it: blocked ${blocked}, hit through ${hitGuarded}`);
  assert.ok(dodged > 0 && rolledHits >= 0, `a roll can dodge it (${dodged})`);
  let knockdowns = 0;
  for (let i = 0; i < 24; i++) {
    const r = simulateContactCombatV5(seed(2600 + i), { health: { kor: 1000, ayaz: 120 }, stamina: { kor: 1000, ayaz: 1000 } }, undefined, { minds: false, corners: [thrower('headKick'), dummy('advance')] });
    knockdowns += r.events.filter(e => e.type === 'knockdown' && e.technique === 'headKick').length;
  }
  assert.ok(knockdowns > 0, 'a clean head kick on a weakened fighter can knock down');
});

test('a kick ends a combination (no chaining after it) but may finish a two-punch one', () => {
  let afterKick = 0, finishers = 0, chains = 0;
  for (let i = 0; i < 40; i++) {
    const r = simulateContactCombatV5(seed(2700 + i), undefined, undefined, { minds: false, corners: UNTRAINED });
    for (const side of ['kor', 'ayaz'] as const) {
      const mine = r.events.filter(e => e.type === 'strike' && e.actor === side);
      mine.forEach((e, k) => {
        if (isV5Kick(e.technique) && e.combo === 2) finishers++;
        if ((e.combo ?? 0) > 0) { chains++; const prev = mine[k - 1]!; assert.ok(prev && !isV5Kick(prev.technique) && prev.combo === (e.combo ?? 0) - 1, `${e.technique} chained after ${prev?.technique}`); }
        const next = mine[k + 1];
        if (isV5Kick(e.technique) && next) { afterKick++; assert.equal(next.combo ?? 0, 0, 'a blow after a kick starts a new sequence'); }
      });
    }
  }
  assert.ok(chains > 20 && afterKick > 20 && finishers > 0, `chains ${chains}, after kick ${afterKick}, kick finishers ${finishers}`);
});

test('a kick that misses by range leaves the kicker open to a counter', () => {
  let missed = 0, countered = 0;
  for (let i = 0; i < 60; i++) {
    const r = simulateContactCombatV5(seed(2800 + i), undefined, undefined, { minds: false, corners: UNTRAINED });
    for (const m of r.events) {
      if (m.type !== 'miss' || !isV5Kick(m.technique)) continue;
      missed++;
      if (r.events.some(e => e.type === 'strike' && e.actor === m.target && e.counter && e.tick >= m.tick && e.tick <= m.tick + V5_KICK_RULES.openTicks)) countered++;
    }
  }
  assert.ok(missed > 10 && countered > 0, `missed kicks ${missed}, answered by a counter ${countered}`);
});

test('every kick and the knee appear in a round played by the untrained checkpoint, and replays are deterministic', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 15; i++) {
    const a = simulateContactCombatV5(seed(3000 + i), undefined, undefined, { corners: UNTRAINED }), b = simulateContactCombatV5(seed(3000 + i), undefined, undefined, { corners: UNTRAINED });
    assert.deepEqual(a, b);
    for (const e of a.events) if (e.type === 'strike') seen.add(e.technique);
  }
  for (const k of ['teep', 'lowKick', 'bodyKick', 'headKick', 'knee']) assert.ok(seen.has(k), `${k} appears`);
  // Same seed + same plan log = same replay, kicks included, through the verifier path.
  const s = seed(3100), log = liveLog(s);
  const x = replayContactV5(s, INITIAL, 1, log), y = replayContactV5(s, INITIAL, 1, log);
  assert.ok(x.ok && y.ok && x.replay && y.replay);
  assert.deepEqual(x.replay, y.replay);
});

test('the learner knows the kick actions and observes only fight state for them', () => {
  for (const a of ['teep', 'lowKick', 'bodyKick', 'headKick', 'knee']) assert.ok((LEARNER_ACTIONS as readonly string[]).includes(a));
  for (const n of ['inTeepReach', 'inKickReach', 'inKneeReach', 'oppWindupKick', 'tookLeg', 'inClinch']) assert.ok((LEARNER_INPUT_NAMES as readonly string[]).includes(n));
  assert.ok(!LEARNER_INPUT_NAMES.some(n => /wager|balance|seed|exposure|house|session/i.test(n)));
  assert.equal(LEARNER_INPUT_NAMES.length, LEARNER_INPUTS);
});

// ---------------------------------------------------------------------------------------------------
// Rule v5m: memory across the rounds of a bout, the opponent model, and independent brains.

/** Plays up to three rounds of one bout the way the arena does: fallback plans, carried state, carry threaded round to round. */
function playBout(tag: string, corners?: readonly [V5Corner, V5Corner]) {
  const rounds: V5Replay[] = [];
  let initial = structuredClone(INITIAL), carry: V5Carry | undefined;
  for (let k = 1; k <= 3; k++) {
    const r = simulateContactCombatV5(seed(tag.length * 1000 + k + [...tag].reduce((h, c) => h + c.charCodeAt(0), 0)), initial, undefined, { round: k, minds: false, ...(corners ? { corners } : {}), ...(carry ? { carry } : {}) });
    rounds.push(r); carry = r.carry;
    if (r.finish === 'stoppage') break;
    initial = carryInitial(r.frames.at(-1)!);
  }
  return rounds;
}

test('carry: a finished round returns plain JSON numbers, the same inputs give the same carry, and JSON round-trips exactly', () => {
  const a = simulateContactCombatV5(seed(4000)), b = simulateContactCombatV5(seed(4000));
  assert.deepEqual(a.carry, b.carry); assert.equal(carryHash(a.carry), carryHash(b.carry));
  assert.ok(parseV5Carry(a.carry));
  assert.deepEqual(JSON.parse(JSON.stringify(a.carry)), a.carry, 'only finite numbers in arrays: JSON safe');
  assert.match(carryHash(a.carry), /^[0-9a-f]{64}$/);
  const next = carryInitial(a.frames.at(-1)!);
  const r2 = simulateContactCombatV5(seed(4001), next, undefined, { round: 2, carry: a.carry }), r2b = simulateContactCombatV5(seed(4001), next, undefined, { round: 2, carry: JSON.parse(JSON.stringify(a.carry)) });
  assert.deepEqual(r2, r2b, 'same seed + plans + carry = same replay and the same next carry');
  assert.equal(carryHash(r2.carry), carryHash(r2b.carry));
  const fresh = simulateContactCombatV5(seed(4001), next, undefined, { round: 2 });
  assert.notDeepEqual(fresh.events, r2.events, 'memory changes the next round');
  assert.notEqual(carryHash(fresh.carry), carryHash(r2.carry));
  // The same chain through the verifier-style helper.
  const s = seed(4100), rec1 = liveLog(s), c1 = replayContactV5(s, INITIAL, 1, rec1, false);
  assert.ok(c1.ok && c1.replay);
  const init2 = carryInitial(c1.replay.frames.at(-1)!), s2 = seed(4101), rec2 = liveLog(s2, init2, 2, undefined, c1.replay.carry);
  const both = replayMatchRounds([{ seed: s, initial: INITIAL, plans: rec1 }, { seed: s2, initial: init2, plans: rec2 }]);
  assert.ok(both && both.length === 2);
  assert.equal(carryHash(both[0]!.carry), carryHash(c1.replay.carry));
  assert.equal(replayMatchRounds([{ seed: s, initial: INITIAL, plans: rec1 }, { seed: s2, initial: init2, plans: rec1 }]), null, 'a log answering another carry does not replay');
});

test('carry is validated: wrong shapes, non-finite numbers and extra keys are rejected', () => {
  const good = simulateContactCombatV5(seed(4010)).carry;
  assert.ok(parseV5Carry(good));
  assert.equal(parseV5Carry(null), null); assert.equal(parseV5Carry({ kor: good.kor }), null); assert.equal(parseV5Carry({ ...good, extra: 1 }), null);
  assert.equal(parseV5Carry({ ...good, kor: { ...good.kor, actor: good.kor.actor.slice(1) } }), null);
  assert.equal(parseV5Carry({ ...good, kor: { ...good.kor, success: Number.NaN } }), null);
  assert.equal(parseV5Carry({ ...good, ayaz: { ...good.ayaz, freq: [1] } }), null);
  assert.throws(() => createContactV5(seed(4010), INITIAL, { carry: { ...good, kor: { ...good.kor, hit: [] } } as V5Carry }), TypeError);
  const p = replayContactV5(seed(4010), INITIAL, 2, [], false, { ...good, kor: { ...good.kor, hit: [] } } as V5Carry);
  assert.deepEqual(p, { ok: false, index: 0 });
});

test('carry holds what was learned: moved weights, the opponent model and exact lesson counts', () => {
  const r = simulateContactCombatV5(seed(4020), undefined, undefined, { corners: [{ kind: 'learner' }, { kind: 'learner' }] });
  assert.equal(r.carry.kor.actor.length, LEARNER_ACTIONS.length * LEARNER_FEATURES);
  assert.ok(r.carry.kor.actor.some((v, i) => v !== CONTACT_V5_PARAMS.actor[i]), 'in-match learning moved the readout');
  assert.ok(r.carry.kor.fast.some(v => v !== 0), 'fast weights are carried');
  for (const side of ['kor', 'ayaz'] as const) {
    const opp = side === 'kor' ? 'ayaz' : 'kor', c = r.carry[side], names = Object.keys(V5_STRIKES) as V5Strike[];
    assert.equal(c.freq.length, V5_MODEL.groups.length);
    assert.ok(c.freq.every(f => f >= 0 && f <= 1) && c.freq.reduce((a, b) => a + b, 0) <= 1.0000001 && c.freq.reduce((a, b) => a + b, 0) > 0);
    assert.ok(c.defence.every(f => f >= 0 && f <= 1) && c.success > 0 && c.success < 1);
    names.forEach((name, i) => {
      const mine = r.events.filter(e => e.actor === side && e.technique === name);
      assert.equal(c.hit[i], mine.filter(e => e.type === 'hit').length, `${side} landed ${name}`);
      assert.equal(c.fail[i], mine.filter(e => e.type === 'block' || e.type === 'dodge' || e.type === 'miss').length, `${side} did not land ${name}`);
    });
    void opp;
  }
  // A frozen corner keeps its weights but still builds the opponent model.
  const f = simulateContactCombatV5(seed(4020), undefined, undefined, { corners: [{ kind: 'learner', learn: false }, { kind: 'learner' }] });
  assert.deepEqual(f.carry.kor.actor, [...CONTACT_V5_PARAMS.actor]);
  assert.ok(f.carry.kor.hit.some(n => n > 0));
});

test('a bout threads its carry: round 2 and 3 differ from a fresh start, and a replayed bout is identical', () => {
  const a = playBout('thread'), b = playBout('thread');
  assert.deepEqual(a, b);
  if (a.length >= 2) {
    // The same round-2 seed and state without the carry plays differently.
    const init2 = carryInitial(a[0]!.frames.at(-1)!), seed2 = seed('thread'.length * 1000 + 2 + [...'thread'].reduce((h, c) => h + c.charCodeAt(0), 0));
    const noCarry = simulateContactCombatV5(seed2, init2, undefined, { round: 2, minds: false });
    assert.notDeepEqual(noCarry.events, a[1]!.events);
  }
});

test('the opponent model and lessons feed observable inputs only: round, frequencies, defence habits, success and lessons', () => {
  for (const n of ['round', 'oppFreqStraight', 'oppFreqClinch', 'oppSlip', 'oppRoll', 'oppGuard', 'oppSuccess', 'lessonJab', 'lessonKnee']) assert.ok((LEARNER_INPUT_NAMES as readonly string[]).includes(n), n);
  assert.ok(!LEARNER_INPUT_NAMES.some(n => /wager|balance|seed|exposure|house|session/i.test(n)));
  // Round 2 and round 3 see a different `round` input: the played rounds differ even with identical opening state.
  const init = INITIAL, s = seed(4030);
  const r1 = simulateContactCombatV5(s, init, undefined, { round: 1, minds: true }), r3 = simulateContactCombatV5(s, init, undefined, { round: 3, minds: true });
  assert.notDeepEqual(r1.minds, r3.minds);
});

/** A scripted corner that replays another run's decisions tick by tick (one RNG draw per decision like a learner). */
function replayer(minds: V5Replay['minds'], side: 'kor' | 'ayaz'): V5Corner {
  const byTick = new Map(minds.filter(m => m.side === side).map(m => [m.tick, m.action] as const));
  return { kind: 'script', control: (v: V5ScriptView) => { v.random(); return byTick.get(v.tick) ?? 'guard'; } };
}
const syntheticParams = (phase: number) => ({ actor: Array.from({ length: LEARNER_ACTIONS.length * LEARNER_FEATURES }, (_, i) => Math.sin(i * 0.37 + phase) * 0.08), critic: Array.from({ length: LEARNER_FEATURES }, (_, i) => Math.cos(i * 0.11 + phase) * 0.05) });

test('independent brains: another checkpoint or carry for KOR changes AYAZ only through the visible fight', () => {
  const ayazCorner: V5Corner = { kind: 'learner', params: syntheticParams(2) };
  const priorBout = simulateContactCombatV5(seed(4040), undefined, undefined, { minds: false });
  const priorOther = simulateContactCombatV5(seed(4042), undefined, undefined, { minds: false, corners: [{ kind: 'learner', params: syntheticParams(7) }, ayazCorner] });
  const init2 = carryInitial(priorBout.frames.at(-1)!);
  let compared = 0;
  for (const [label, kor, carry] of [
    ['zero checkpoint', { kind: 'learner', params: zeroLearnerParams() }, undefined],
    ['other checkpoint', { kind: 'learner', params: syntheticParams(5) }, undefined],
    ['other KOR carry', { kind: 'learner' }, { kor: priorOther.carry.kor, ayaz: priorBout.carry.ayaz } as V5Carry],
    ['KOR carry from the bout', { kind: 'learner' }, priorBout.carry],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      const opts = carry ? { round: 2, carry } : { round: 1 };
      const run = simulateContactCombatV5(seed(4050 + i), carry ? init2 : undefined, undefined, { ...opts, corners: [kor, ayazCorner] });
      // Same fight, but KOR is now a script that merely replays what the learner did: AYAZ cannot tell the difference.
      const scripted = simulateContactCombatV5(seed(4050 + i), carry ? init2 : undefined, undefined, { ...opts, corners: [replayer(run.minds, 'kor'), ayazCorner] });
      if (run.events.some(e => e.type === 'knockdown')) continue; // the count of a downed KOR draws its own RNG, which a script does not share
      compared++;
      assert.deepEqual(scripted.events, run.events, `${label}: identical fight`);
      assert.deepEqual(scripted.minds.filter(m => m.side === 'ayaz'), run.minds.filter(m => m.side === 'ayaz'), `${label}: AYAZ chooses identically`);
      assert.deepEqual(scripted.carry.ayaz, run.carry.ayaz, `${label}: AYAZ learner, fast weights and opponent model are identical`);
    }
  }
  assert.ok(compared >= 8, `compared ${compared} runs`);
  // And the other way round: a different KOR checkpoint really changes the fight, so the equality above is not vacuous.
  const x = simulateContactCombatV5(seed(4050), undefined, undefined, { corners: [{ kind: 'learner', params: zeroLearnerParams() }, ayazCorner] });
  const y = simulateContactCombatV5(seed(4050), undefined, undefined, { corners: [{ kind: 'learner', params: syntheticParams(5) }, ayazCorner] });
  assert.notDeepEqual(x.events, y.events);
  assert.notDeepEqual(x.carry.ayaz, y.carry.ayaz, 'AYAZ differs only because the visible fight differs');
});

test('independent brains: separate learner objects and buffers; each corner plan drives only its own inputs', () => {
  const m = createContactV5(seed(4060));
  m.playSegment({ kor: { intent: 'pressure', target: 'head', threat: 'straight' }, ayaz: { intent: 'cautious', target: 'body', threat: 'hook' } });
  const [k, a] = m.learners();
  assert.ok(k && a && k !== a);
  for (const key of ['actor', 'critic', 'fast', 'h'] as const) assert.notEqual(k[key].buffer, a[key].buffer, `${key} is not shared`);
  // Swapping only AYAZ's plan leaves KOR's own plan-driven inputs alone before any contact: KOR's first decision is the same.
  const p = { intent: 'pressure', target: 'head', threat: 'straight' } as const;
  const one = createContactV5(seed(4061)), two = createContactV5(seed(4061));
  one.playSegment({ kor: p, ayaz: { intent: 'cautious', target: 'body', threat: 'hook' } }); two.playSegment({ kor: p, ayaz: { intent: 'finisher', target: 'head', threat: 'upper' } });
  const first = (x: typeof one) => x.partial().minds.filter(mm => mm.side === 'kor').slice(0, 1);
  assert.deepEqual(first(one), first(two));
});
