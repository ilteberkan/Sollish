import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REALITY_INTERVAL_MS, acknowledgeRealityCheck, createRealityCheck, createSession, formatClock, formatDuration, msUntilRealityCheck, realityCheckDue, rebaseRealityCheck,
  recordSessionRound, sessionElapsedMs, sessionNetCents,
} from '../lib/slot-kit/session';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 11, 9, 5, 0);

test('session tracks elapsed time and net result without going negative', () => {
  let s = createSession(T0);
  assert.equal(sessionElapsedMs(s, T0), 0);
  assert.equal(sessionElapsedMs(s, T0 + 90_000), 90_000);
  assert.equal(sessionElapsedMs(s, T0 - 5000), 0, 'clock moved back');
  s = recordSessionRound(s, { costCents: 100, payoutCents: 0 });
  s = recordSessionRound(s, { costCents: 100, payoutCents: 350 });
  s = recordSessionRound(s, { costCents: 500, payoutCents: 0 });
  assert.equal(s.rounds, 3);
  assert.equal(s.spentCents, 700);
  assert.equal(s.wonCents, 350);
  assert.equal(sessionNetCents(s), -350);
  assert.ok(Object.isFrozen(s));
});

test('session inputs are validated', () => {
  for (const t of [-1, Number.NaN, Infinity]) assert.throws(() => createSession(t), RangeError);
  const s = createSession(T0);
  for (const r of [{ costCents: -1, payoutCents: 0 }, { costCents: 1.5, payoutCents: 0 }, { costCents: 0, payoutCents: Number.NaN }, { costCents: 0, payoutCents: -2 }]) {
    assert.throws(() => recordSessionRound(s, r), RangeError);
  }
});

test('reality check is due exactly at the interval (default 30 min)', () => {
  assert.equal(DEFAULT_REALITY_INTERVAL_MS, 30 * MIN);
  const rc = createRealityCheck(T0);
  assert.equal(realityCheckDue(rc, T0), false);
  assert.equal(realityCheckDue(rc, T0 + 30 * MIN - 1), false);
  assert.equal(realityCheckDue(rc, T0 + 30 * MIN), true);
  assert.equal(realityCheckDue(rc, T0 + 31 * MIN), true);
  assert.equal(msUntilRealityCheck(rc, T0 + 10 * MIN), 20 * MIN);
  assert.equal(msUntilRealityCheck(rc, T0 + 45 * MIN), 0);
});

test('acknowledging schedules one full interval from now, not from the missed due time', () => {
  let rc = createRealityCheck(T0, 30 * MIN);
  const late = T0 + 100 * MIN; // laptop slept
  assert.equal(realityCheckDue(rc, late), true);
  rc = acknowledgeRealityCheck(rc, late);
  assert.equal(rc.acknowledged, 1);
  assert.equal(realityCheckDue(rc, late + 29 * MIN), false);
  assert.equal(realityCheckDue(rc, late + 30 * MIN), true);
  assert.throws(() => acknowledgeRealityCheck(rc, Number.NaN), RangeError);
});

test('interval is configurable and validated', () => {
  const rc = createRealityCheck(T0, 5 * MIN);
  assert.equal(realityCheckDue(rc, T0 + 5 * MIN), true);
  assert.equal(createRealityCheck(T0, 1000).intervalMs, 1000);
  for (const i of [0, -1, 999, Number.NaN, Infinity]) assert.throws(() => createRealityCheck(T0, i), RangeError, String(i));
  assert.throws(() => createRealityCheck(-1), RangeError);
});

test('rebase pulls a far-future schedule back after a backwards clock jump', () => {
  const rc = createRealityCheck(T0 + 3 * 60 * MIN, 30 * MIN); // due ~3.5h after T0
  const jumped = rebaseRealityCheck(rc, T0);
  assert.equal(jumped.nextDueAtMs, T0 + 30 * MIN);
  const fine = createRealityCheck(T0);
  assert.equal(rebaseRealityCheck(fine, T0 + MIN), fine, 'a normal schedule is returned unchanged');
});

test('clock and duration formats', () => {
  assert.equal(formatClock(T0, 0), '09:05');
  assert.equal(formatClock(T0, 180), '12:05');
  assert.equal(formatClock(Date.UTC(2026, 0, 1, 23, 59, 59), 0), '23:59');
  assert.equal(formatClock(Date.UTC(2026, 0, 1, 0, 0, 0), 0), '00:00');
  assert.equal(formatClock(Number.NaN), '--:--');
  assert.match(formatClock(T0), /^\d{2}:\d{2}$/);
  assert.equal(formatDuration(0), '0 sn');
  assert.equal(formatDuration(45_999), '45 sn');
  assert.equal(formatDuration(60_000), '1 dk');
  assert.equal(formatDuration(12 * MIN + 59_000), '12 dk');
  assert.equal(formatDuration(60 * MIN), '1 sa 00 dk');
  assert.equal(formatDuration(65 * MIN), '1 sa 05 dk');
  assert.equal(formatDuration(-5), '0 sn');
  assert.equal(formatDuration(Number.NaN), '0 sn');
});
