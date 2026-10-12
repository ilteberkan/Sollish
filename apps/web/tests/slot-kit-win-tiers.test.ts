import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNT_UP_MIN_MS, COUNT_UP_STAGE_MS, MAX_WIN_LEVEL, SKIP_COUNT_UP_MS, SKIP_HOLD_MS, WIN_TIER_INFO, WIN_TIER_THRESHOLDS,
  countUpSchedule, countUpValueAt, levelAt, multiplierCalloutTier, roundCelebration, stageAt, winRatioHundredths, winTierOf,
  type CountUpSchedule,
} from '../lib/slot-kit/win-tiers';

test('tier thresholds: exact edges for Büyük 10x, Mega 25x, Süper 50x, Efsane 100x', () => {
  assert.deepEqual([...WIN_TIER_THRESHOLDS], [1000, 2500, 5000, 10_000]);
  const cases: Array<[number, number]> = [[0, 0], [1, 0], [999, 0], [1000, 1], [2499, 1], [2500, 2], [4999, 2], [5000, 3], [9999, 3], [10_000, 4], [500_000, 4]];
  for (const [total, tier] of cases) assert.equal(winTierOf(total), tier, String(total));
  assert.equal(winTierOf(Number.NaN), 0);
  assert.deepEqual([1, 2, 3, 4, 5].map(l => WIN_TIER_INFO[l as 1].title), ['Büyük Kazanç', 'Mega Kazanç', 'Süper Kazanç', 'Efsane Kazanç', 'Azami Kazanç']);
  assert.deepEqual([1, 2, 3, 4, 5].map(l => WIN_TIER_INFO[l as 1].word), ['BÜYÜK', 'MEGA', 'SÜPER', 'EFSANE', 'AZAMİ']);
});

test('payout to ratio and round presentation kind', () => {
  assert.equal(winRatioHundredths(10_000, 1000), 1000);
  assert.equal(winRatioHundredths(999, 100), 999);
  assert.equal(winRatioHundredths(0, 100), 0);
  assert.throws(() => winRatioHundredths(1, 0), RangeError);
  assert.throws(() => winRatioHundredths(-1, 100), RangeError);
  assert.equal(roundCelebration(0, false), 'none');
  assert.equal(roundCelebration(1, false), 'flourish');
  assert.equal(roundCelebration(999, false), 'flourish');
  assert.equal(roundCelebration(1000, false), 'celebration');
  assert.equal(roundCelebration(500, true), 'celebration', 'a capped round always celebrates');
});

test('multiplier callout tiers: 10x, 25x, 50x, 100x edges', () => {
  assert.deepEqual([0, 9, 10, 24, 25, 49, 50, 99, 100, 1000].map(multiplierCalloutTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

function checkSchedule(s: CountUpSchedule) {
  let at = 0;
  for (const stage of s.stages) {
    assert.ok(Number.isInteger(stage.at) && Number.isInteger(stage.dur) && stage.dur >= 0);
    assert.equal(stage.at, at, 'stages are contiguous');
    at += stage.dur;
    assert.ok(stage.to >= stage.from);
  }
  assert.equal(at, s.countUp, 'stage durations sum to the count-up');
  // Monotonic counter, exact final value.
  let last = -1;
  for (let t = -50; t <= s.countUp + 50; t += 7) {
    const v = countUpValueAt(s, t);
    assert.ok(Number.isInteger(v) && v >= last && v <= s.totalHundredths, `t=${t} v=${v}`);
    last = v;
  }
  assert.equal(countUpValueAt(s, s.countUp), s.totalHundredths);
  assert.equal(countUpValueAt(s, Number.POSITIVE_INFINITY), s.totalHundredths);
  assert.equal(countUpValueAt(s, 0), 0);
}

test('escalation: the counter opens as Büyük and upgrades exactly as it passes each threshold', () => {
  const s = countUpSchedule(13_555, false); // 135,55x -> Büyük, Mega, Süper, Efsane
  checkSchedule(s);
  assert.deepEqual(s.stages.map(x => x.level), [1, 2, 3, 4]);
  assert.deepEqual(s.stages.map(x => [x.from, x.to]), [[0, 2500], [2500, 5000], [5000, 10_000], [10_000, 13_555]]);
  assert.equal(s.finalLevel, 4);
  assert.equal(levelAt(s, 0), 1);
  for (let k = 1; k < s.stages.length; k++) {
    const stage = s.stages[k]!;
    assert.equal(levelAt(s, stage.at - 1), stage.level - 1);
    assert.equal(levelAt(s, stage.at), stage.level);
    assert.ok(countUpValueAt(s, stage.at - 1) < WIN_TIER_THRESHOLDS[stage.level - 1]!, 'below the threshold before the upgrade');
    assert.equal(countUpValueAt(s, stage.at), stage.from, 'on the threshold at the upgrade');
  }
  const mega = countUpSchedule(3996, false); // 39,96x -> Büyük then Mega
  assert.deepEqual(mega.stages.map(x => x.level), [1, 2]);
  const big = countUpSchedule(1000, false);
  assert.deepEqual(big.stages.map(x => [x.level, x.from, x.to]), [[1, 0, 1000]]);
});

test('count-up length grows with the tier (≈3–9 s at normal) and shrinks with speed / skipped screens', () => {
  const totals = [1062, 3066, 5008, 13_555];
  const normal = totals.map(t => countUpSchedule(t, false).countUp);
  assert.deepEqual(normal, [3000, 4800, 6600, 9000]);
  for (let i = 1; i < normal.length; i++) assert.ok(normal[i]! > normal[i - 1]!);
  assert.equal(COUNT_UP_STAGE_MS.reduce((a, b) => a + b, 0), 9000);
  for (const total of totals) {
    const n = countUpSchedule(total, false), q = countUpSchedule(total, false, { speed: 'quick' }), t = countUpSchedule(total, false, { speed: 'turbo' });
    const skip = countUpSchedule(total, false, { skipScreens: true }), reduced = countUpSchedule(total, false, { reducedMotion: true });
    for (const s of [n, q, t, skip, reduced]) checkSchedule(s);
    assert.ok(q.countUp < n.countUp && t.countUp <= q.countUp, `${total} speeds`);
    assert.ok(t.countUp >= COUNT_UP_MIN_MS && q.countUp >= COUNT_UP_MIN_MS && reduced.countUp >= COUNT_UP_MIN_MS);
    assert.equal(q.countUp, Math.max(COUNT_UP_MIN_MS, Math.round(n.countUp * 0.6)));
    assert.ok(skip.countUp <= SKIP_COUNT_UP_MS && skip.hold <= SKIP_HOLD_MS);
    assert.ok(reduced.countUp < n.countUp);
    assert.deepEqual(t.stages.map(s => s.level), n.stages.map(s => s.level), 'every speed climbs through the same tiers');
    assert.ok(n.hold >= t.hold);
  }
});

test('capped round ends on Azami after climbing the tiers; a test cap below 10x is one Azami band', () => {
  const s = countUpSchedule(500_000, true);
  checkSchedule(s);
  assert.deepEqual(s.stages.map(x => x.level), [1, 2, 3, 4, MAX_WIN_LEVEL]);
  assert.equal(s.finalLevel, MAX_WIN_LEVEL);
  assert.equal(levelAt(s, s.countUp - 1), 4);
  assert.equal(levelAt(s, s.countUp), MAX_WIN_LEVEL);
  assert.equal(stageAt(s, s.countUp).dur, 0);
  assert.ok(s.hold > countUpSchedule(500_000, false).hold, 'Azami holds longest');
  const low = countUpSchedule(800, true);
  checkSchedule(low);
  assert.deepEqual(low.stages.map(x => x.level), [MAX_WIN_LEVEL]);
  assert.throws(() => countUpSchedule(-1, false), RangeError);
  assert.throws(() => countUpSchedule(1.5, false), RangeError);
});
