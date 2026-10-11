import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MIX, beatSeconds, barSeconds, busGains, createRng, dbToGain, duckPlan, equalPowerCurve, linearRampValue, loopLengthSamples,
  loopPosition, microVariation, nextBoundary, normalizeMix, pickVariation, sliderToGain, swingBeat, type LoopClock,
} from '../lib/slot-audio/timing';
import { pumpGain } from '../lib/slot-audio/render';

const near = (a: number, b: number, eps = 1e-9, msg?: string) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} ≉ ${b}`);

test('tempo math: beats, bars and whole-sample loop lengths', () => {
  near(beatSeconds(120), 0.5);
  near(barSeconds(104), (60 / 104) * 4);
  // base theme: 20 bars of 4/4 at 104 BPM at 44.1 kHz, rounded once
  assert.equal(loopLengthSamples(20, 104, 4, 44100), 2035385);
  assert.ok(loopLengthSamples(20, 104, 4, 44100) / 44100 >= 36, 'base loop is at least 36 s');
  assert.ok(loopLengthSamples(16, 118, 4, 44100) / 44100 >= 30, 'feature loop is at least 30 s');
  // a whole number of bars: the beat grid continues across the seam (drift < 1 sample over the loop)
  const len = loopLengthSamples(16, 118, 4, 48000);
  near(len / 48000 / barSeconds(118), 16, 1 / 48000 / barSeconds(118) + 1e-12);
});

test('swing keeps on-beats, moves the off-beat eighth and never reorders events', () => {
  for (const ratio of [0.5, 0.58, 2 / 3]) {
    for (let beat = 0; beat < 4; beat++) near(swingBeat(beat, ratio), beat);
    near(swingBeat(1.5, ratio), 1 + ratio);
    let prev = -1;
    for (let t = 0; t <= 4; t += 0.0625) { const w = swingBeat(t, ratio); assert.ok(w > prev, 'monotonic'); prev = w; }
  }
  near(swingBeat(2.25, 0.5), 2.25, 1e-12);
});

test('beat/bar quantisation of a playing loop, including across the seam', () => {
  const clock: LoopClock = { startTime: 10, offset: 0, loopSeconds: 8, bpm: 120, beatsPerBar: 4 };
  near(nextBoundary(clock, 10.1, 'beat', 0), 10.5);
  near(nextBoundary(clock, 10.1, 'bar', 0), 12);
  near(nextBoundary(clock, 10.49, 'beat', 0.025), 11, 1e-9, 'too close to the next beat: take the one after');
  near(nextBoundary(clock, 17.9, 'bar', 0), 18, 1e-9, 'loop end is a bar line');
  near(nextBoundary(clock, 18.2, 'bar', 0), 20);
  near(nextBoundary(clock, 13.3, 'none', 0.02), 13.32);
  // a scene that started mid-loop (phase-aligned cross-fade): grid follows the loop position
  const shifted: LoopClock = { ...clock, offset: 1.25 };
  near(nextBoundary(shifted, 10, 'beat', 0), 10.25);
  near(loopPosition(shifted, 10), 1.25);
  near(loopPosition(clock, 10 + 8 * 3 + 0.5), 0.5);
  near(loopPosition(clock, 9.5), 7.5, 1e-9, 'before the start wraps backwards');
});

test('equal-power cross-fade curves keep constant power', () => {
  const a = equalPowerCurve(64, true), b = equalPowerCurve(64, false);
  near(a[0]!, 0); near(a[63]!, 1, 1e-7); near(b[0]!, 1); near(b[63]!, 0, 1e-7);
  for (let i = 0; i < 64; i++) near(a[i]! ** 2 + b[i]! ** 2, 1, 1e-6);
  near(equalPowerCurve(8, false, 0.5)[0]!, 0.5);
});

test('mix: slider law, mute, clamping and linear ramp values', () => {
  near(sliderToGain(1), 1); near(sliderToGain(0), 0); near(sliderToGain(0.5), 0.25);
  near(sliderToGain(2), 1); near(sliderToGain(Number.NaN), 0);
  const g = busGains({ master: 0.5, music: 1, sfx: 0.8, ambience: 0, muted: false });
  near(g.master, 0.25); near(g.music, 1); near(g.sfx, 0.64); near(g.ambience, 0);
  assert.equal(busGains({ ...DEFAULT_MIX, muted: true }).master, 0);
  const m = normalizeMix({ music: 3, sfx: -1 }, DEFAULT_MIX);
  assert.equal(m.music, 1); assert.equal(m.sfx, 0); assert.equal(m.master, DEFAULT_MIX.master); assert.equal(m.muted, false);
  assert.equal(normalizeMix({ muted: true }).muted, true);
  // 60 ms ramp from 1 to 0.25 is linear in between and holds at both ends
  near(linearRampValue(1, 0.25, 2, 0.06, 1.9), 1);
  near(linearRampValue(1, 0.25, 2, 0.06, 2.03), 0.625);
  near(linearRampValue(1, 0.25, 2, 0.06, 2.5), 0.25);
  near(linearRampValue(0, 1, 0, 0, 0), 1);
});

test('duck plan: depth, hold and release', () => {
  const p = duckPlan(5, 12, 1000, 40, 450);
  near(p.floor, dbToGain(-12));
  near(p.attack, 0.04); near(p.holdUntil, 5 + 0.04 + 1); near(p.releaseEnd, 5 + 0.04 + 1 + 0.45);
  near(duckPlan(0, -6, 0).floor, dbToGain(-6), 1e-12, 'sign of the amount does not matter');
});

test('variation picking never repeats and micro-variation stays in bounds', () => {
  const rng = createRng(7);
  let prev = -1;
  for (let i = 0; i < 500; i++) {
    const v = pickVariation(4, prev, rng);
    assert.ok(v >= 0 && v < 4); assert.notEqual(v, prev); prev = v;
  }
  assert.equal(pickVariation(1, 0, rng), 0);
  for (let i = 0; i < 200; i++) {
    const mv = microVariation(rng, 30, 1.5);
    assert.ok(mv.rate >= 2 ** (-30 / 1200) - 1e-12 && mv.rate <= 2 ** (30 / 1200) + 1e-12);
    assert.ok(mv.gain >= dbToGain(-1.5) - 1e-12 && mv.gain <= dbToGain(1.5) + 1e-12);
  }
});

test('feature pad pump dips on the beat and recovers smoothly', () => {
  near(pumpGain(0, 0.6), 1);
  near(pumpGain(0.04, 0.6), 0.4, 1e-9);
  near(pumpGain(0.999, 0.6), 1);
  let prev = pumpGain(0.04, 0.6);
  for (let p = 0.05; p < 1; p += 0.01) { const g = pumpGain(p, 0.6); assert.ok(g >= prev - 1e-12 && g <= 1); prev = g; }
});
