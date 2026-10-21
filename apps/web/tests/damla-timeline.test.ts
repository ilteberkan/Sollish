import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMLA_MODES, damlaSeedFromEntropy, playDamlaRound, type DamlaMode } from '@sollish/protocol';
import { DAMLA_HOP_MS, buildDamlaTimeline, damlaCelebration, damlaDropAt, damlaHistoryDetail, damlaHistorySummary, damlaLatticeXs, damlaTier } from '../lib/damla-timeline';

const seedOf = (v: number) => damlaSeedFromEntropy(new Uint32Array([v, v, v, v]));

test('the drop splashes in every basin of round.path, in order, and lands in round.slot', () => {
  for (let v = 1; v < 300; v++) {
    const mode = DAMLA_MODES[v % DAMLA_MODES.length]! as DamlaMode;
    const round = playDamlaRound(seedOf((v * 40_503) >>> 0), 100, mode);
    const tl = buildDamlaTimeline(round);
    const splashes = tl.events.filter(e => e.type === 'splash');
    assert.equal(splashes.length, round.rows);
    let basin = 0;
    splashes.forEach((e, i) => {
      if (e.type !== 'splash') return;
      assert.equal(e.terrace, i); assert.equal(e.basin, basin); assert.equal(e.x, basin - i / 2);
      assert.equal(e.from, i === 0 ? null : round.path[i - 1]);
      if (round.path[i] === 'R') basin++;
    });
    const land = tl.events.find(e => e.type === 'land');
    assert.ok(land && land.type === 'land');
    assert.equal(land.slot, round.slot); assert.equal(land.x, round.slot - round.rows / 2);
    assert.equal(land.multiplierHundredths, round.multiplierHundredths); assert.equal(land.payoutCents, round.payoutCents);
    assert.equal(land.signature, round.risk === 'high' && round.capped);
    // events in time order, settle after land, end last
    for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i]!.at >= tl.events[i - 1]!.at);
    assert.ok(tl.settleAt > tl.landAt); assert.equal(tl.events.at(-1)!.type, 'end');
  }
});

test('the sampled position passes through every basin centre and ends in the pool', () => {
  const round = playDamlaRound(seedOf(123_456), 100, 'high-16');
  const tl = buildDamlaTimeline(round, { speed: 'quick' });
  const xs = damlaLatticeXs(round);
  assert.equal(xs.length, round.rows + 1); assert.equal(xs.at(-1), round.slot - 8);
  for (let i = 0; i < round.rows; i++) {
    const at = tl.fall + i * tl.hop;
    const s = damlaDropAt(tl, xs, at + 0.001);
    assert.ok(Math.abs(s.x - xs[i]!) < 1e-3 && Math.abs(s.y - i) < 1e-3, `row ${i}: ${JSON.stringify(s)}`);
  }
  const end = damlaDropAt(tl, xs, tl.landAt + 1);
  assert.equal(end.phase, 'pool'); assert.equal(end.x, xs.at(-1)); assert.equal(end.y, round.rows);
  assert.equal(damlaDropAt(tl, xs, -5).phase, 'fall');
  // x stays between the two basins of a hop; y stays below the rim height
  for (let t = tl.fall; t < tl.landAt; t += 7) {
    const s = damlaDropAt(tl, xs, t);
    const i = s.to - 1;
    assert.ok(s.x >= Math.min(xs[i]!, xs[i + 1]!) - 1e-9 && s.x <= Math.max(xs[i]!, xs[i + 1]!) + 1e-9);
    assert.ok(s.y >= i - 0.17 && s.y <= i + 1 + 1e-9);
  }
});

test('speed only changes timing; turbo is shortest; the path is identical', () => {
  const round = playDamlaRound(seedOf(9), 100, 'medium-12');
  const n = buildDamlaTimeline(round, { speed: 'normal' }), q = buildDamlaTimeline(round, { speed: 'quick' }), t = buildDamlaTimeline(round, { speed: 'turbo' });
  assert.ok(n.duration > q.duration && q.duration > t.duration);
  assert.equal(n.hop, DAMLA_HOP_MS.normal);
  const path = (tl: typeof n) => tl.events.filter(e => e.type === 'splash').map(e => (e.type === 'splash' ? e.basin : -1));
  assert.deepEqual(path(n), path(t)); assert.deepEqual(path(n), path(q));
  assert.ok(buildDamlaTimeline(round, { reducedMotion: true }).duration < n.duration);
});

test('tiers and celebrations follow the multiplier; capped is Max', () => {
  assert.equal(damlaTier(20), 0); assert.equal(damlaTier(99), 0); assert.equal(damlaTier(100), 1); assert.equal(damlaTier(250), 2);
  assert.equal(damlaTier(700), 3); assert.equal(damlaTier(1300), 4); assert.equal(damlaTier(100_000), 5);
  assert.equal(damlaCelebration(900, false), null); assert.equal(damlaCelebration(1000, false), 1); assert.equal(damlaCelebration(3300, false), 2);
  assert.equal(damlaCelebration(5500, false), 3); assert.equal(damlaCelebration(14_000, false), 4); assert.equal(damlaCelebration(560, true), 5);
});

test('history summary and ledger line are derived from the round', () => {
  const round = playDamlaRound(seedOf(77), 200, 'low-8');
  const s = damlaHistorySummary(round);
  assert.equal(s.slot, round.slot); assert.equal(s.rights, round.slot); assert.equal(s.mode, 'low-8');
  assert.match(damlaHistoryDetail(round), /^low-8 · havuz \d+\/9 · \d+,\d{2}×$/);
  assert.throws(() => buildDamlaTimeline({ ...round, path: round.path.slice(1) }), RangeError);
});
