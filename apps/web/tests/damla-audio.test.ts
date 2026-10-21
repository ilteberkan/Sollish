import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakAbs } from '../lib/slot-audio/synth/dsp';
import { seam } from '../lib/slot-audio/synth/master';
import { DAMLA_LOOP_SECONDS, damlaRng, renderAmbience, renderChime, renderClick, renderDenied, renderGoldStinger, renderMusic, renderPlink, renderSplash } from '../lib/slot-audio/sfx/damla';

const SR = 22_050;
const ctx = () => ({ sr: SR, rng: damlaRng(7) });
const noYield = async () => {};

test('effects render finite, audible, unclipped buffers; chimes grow with the tier; renders are deterministic', () => {
  const plinks = [0, 1, 2, 3].map(v => renderPlink(ctx(), 587, 0.9, v));
  for (const p of plinks) { assert.ok(p.length > 0.2 * SR); assert.ok(peakAbs(p) > 0.2 && peakAbs(p) < 1.5); assert.ok(p.every(Number.isFinite)); }
  assert.notDeepEqual(plinks[0], plinks[3], 'variants differ');
  assert.deepEqual(renderPlink(ctx(), 587, 0.9, 1), renderPlink(ctx(), 587, 0.9, 1), 'same seed, same buffer');
  const chimes = [0, 1, 2, 3, 4, 5].map(t => renderChime(ctx(), t));
  for (let t = 1; t < chimes.length; t++) assert.ok(chimes[t]!.l.length > chimes[t - 1]!.l.length, `tier ${t} longer`);
  for (const c of chimes) assert.ok(peakAbs(c.l) > 0.05 && c.l.every(Number.isFinite));
  const gold = renderGoldStinger(ctx());
  assert.ok(gold.l.length >= 3.4 * SR); assert.ok(peakAbs(gold.l) <= 10 ** (-1.4 / 20) && peakAbs(gold.r) <= 10 ** (-1.4 / 20), 'limited below -1.5 dBFS');
  for (const b of [renderSplash(ctx(), 0.7), renderClick(ctx()), renderDenied(ctx())]) assert.ok(peakAbs(b) > 0.01 && b.every(Number.isFinite));
});

test('ambient water loop and music bed are >= 30 s, limited and seamless', async () => {
  for (const [name, render] of [['ambience', renderAmbience], ['music', renderMusic]] as const) {
    const loop = await render(ctx(), DAMLA_LOOP_SECONDS, noYield);
    assert.equal(loop.l.length, Math.round(DAMLA_LOOP_SECONDS * SR), `${name} length`);
    assert.ok(loop.l.length / SR >= 30, `${name} at least 30 s`);
    assert.ok(loop.l.every(Number.isFinite) && loop.r.every(Number.isFinite));
    assert.ok(peakAbs(loop.l) < 1 && peakAbs(loop.r) < 1, `${name} not clipped`);
    assert.ok(peakAbs(loop.l) > 0.02, `${name} audible`);
    const s = seam([loop.l, loop.r], SR);
    assert.ok(s.seamDelta <= s.p999Delta, `${name} seam is an ordinary step (${JSON.stringify(s)})`);
    // the bed has no level jump at the seam; the music starts on its downbeat (an onset), so only its tail must still ring
    if (name === 'ambience') assert.ok(Math.abs(s.rmsJumpDb) < 3, `${name} no level jump at the seam (${s.rmsJumpDb.toFixed(2)} dB)`);
    else assert.ok(s.rmsEndDb > -50, `${name} tail rings into the seam (${s.rmsEndDb.toFixed(1)} dB)`);
  }
});
