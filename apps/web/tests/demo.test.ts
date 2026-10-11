import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashAt, grossPayout, parseDemoAmount, sampleCrash } from '../lib/demo';
test('demo amounts reject precision loss, exponents, signed values, overflow and limits', () => {
  for (const bad of ['', '0', '-1', '1e2', '500.01', 'Infinity', '1.001', '1,2.3', '99999']) assert.equal(parseDemoAmount(bad), null, bad);
  assert.equal(parseDemoAmount('1'), 100); assert.equal(parseDemoAmount('12,34'), 1234); assert.equal(parseDemoAmount('500.00'), 50000);
});
test('cashout is evaluated at current monotonic time, including missed animation frames', () => {
  const target = 2;
  const crashMs = Math.log(target) / 0.14 * 1000;
  assert.equal(crashAt(crashMs - 1, target).crashed, false);
  assert.equal(crashAt(crashMs + 1, target).crashed, true);
  assert.equal(crashAt(crashMs + 100_000, target).multiplier, target);
  assert.deepEqual(crashAt(-100, 2), { multiplier: 1, crashed: false });
});
test('demo randomness has explicit bounds and does not force a win', () => {
  assert.equal(sampleCrash(0), 1);
  assert.equal(sampleCrash(0.5), 1.96);
  assert.equal(sampleCrash(0.999999), 50);
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => sampleCrash(invalid));
});
test('local payout rounds down to demo cents', () => {
  assert.equal(grossPayout(101, 1.96), 197);
  assert.equal(grossPayout(100, 1.15), 115);
  assert.equal(grossPayout(1000, 0), 0);
  assert.throws(() => grossPayout(1.5, 2));
});
