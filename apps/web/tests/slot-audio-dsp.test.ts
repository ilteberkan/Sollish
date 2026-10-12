import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldLoop, limitInPlace, loudness, seam, truePeakDb, samplePeakDb, encodeWav16 } from '../lib/slot-audio/synth/master';
import { createRenderEnv, renderScore, renderSfx, decimate2 } from '../lib/slot-audio/render';
import { CASCADE_SFX } from '../lib/slot-audio/sfx/cascade';
import { melody, steps } from '../lib/slot-audio/scores/notation';
import type { Score } from '../lib/slot-audio/scores/types';

const SR = 44100;
const sine = (freq: number, seconds: number, amp: number, phase = 0) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * freq * (i / SR) + phase));

test('BS.1770 loudness: a −20 dBFS 997 Hz sine in both channels reads about −20 LUFS', () => {
  const x = sine(997, 3, 0.1);
  const m = loudness([x, x], SR);
  assert.ok(Math.abs(m.integrated - -20) < 0.3, `integrated ${m.integrated}`);
  assert.ok(Math.abs(m.momentaryMax - m.integrated) < 0.3);
  // one channel alone is 3 dB quieter
  const one = loudness([x, new Float32Array(x.length)], SR).integrated;
  assert.ok(Math.abs(m.integrated - one - 3.01) < 0.05);
  // the decimated estimate used for stem balancing stays close
  assert.ok(Math.abs(loudness([x, x], SR, 4).integrated - m.integrated) < 0.5);
  // silence is gated out entirely
  assert.equal(loudness([new Float32Array(SR), new Float32Array(SR)], SR).integrated, -Infinity);
});

test('true peak finds inter-sample overs that the sample peak misses', () => {
  const x = sine(SR / 4, 0.5, 0.9, Math.PI / 4); // samples land at ±0.636, the wave peaks at 0.9
  assert.ok(samplePeakDb([x]) < -3.5);
  assert.ok(Math.abs(truePeakDb([x]) - 20 * Math.log10(0.9)) < 0.3, `${truePeakDb([x])}`);
});

test('look-ahead limiter never passes the ceiling and stays seamless as a loop', () => {
  const l = sine(220, 1, 0.5), r = sine(330, 1, 0.5);
  for (let i = 1000; i < 1100; i++) { l[i] = 1.8 * Math.sin(i); r[i] = -1.5; }
  for (let i = l.length - 40; i < l.length; i++) l[i]! *= 3; // an over right before the seam
  const st = { l, r };
  const reduced = limitInPlace(st, -1.6, SR, { circular: true });
  assert.ok(reduced < -3);
  const ceiling = 10 ** (-1.6 / 20);
  for (let i = 0; i < l.length; i++) assert.ok(Math.abs(l[i]!) <= ceiling + 1e-6 && Math.abs(r[i]!) <= ceiling + 1e-6, `sample ${i}`);
  assert.equal(limitInPlace({ l: sine(100, 0.1, 0.1), r: sine(100, 0.1, 0.1) }, -1, SR), 0, 'quiet input untouched');
});

test('loop folding and seam metric: a whole-period sine loops perfectly', () => {
  const period = SR / 441; // 100 samples
  const n = period * 50;
  const x = Float32Array.from({ length: n + 300 }, (_, i) => Math.sin((2 * Math.PI * i) / period) * (i < n ? 1 : 0.5));
  const folded = foldLoop({ l: x, r: x }, n);
  assert.equal(folded.l.length, n);
  assert.ok(Math.abs(folded.l[10]! - Math.sin((2 * Math.PI * 10) / period) * 1.5) < 1e-5, 'tail added onto the head');
  const s = seam([sine(441, 1, 0.5), sine(441, 1, 0.5)], SR);
  assert.ok(s.seamRatio < 1.5 && Math.abs(s.rmsJumpDb) < 0.1, JSON.stringify(s));
});

test('2:1 decimation keeps the pass band and removes content near the old Nyquist', () => {
  const low = decimate2(sine(1000, 0.5, 0.5), SR), high = decimate2(sine(20000, 0.5, 0.5), SR);
  const rms = (a: Float32Array) => Math.sqrt(a.slice(2000).reduce((s, v) => s + v * v, 0) / (a.length - 2000));
  assert.ok(Math.abs(rms(low) - 0.5 / Math.SQRT2) < 0.01);
  assert.ok(rms(high) < 0.01);
});

test('WAV export is 16-bit PCM with the right header', () => {
  const wav = encodeWav16([new Float32Array(10), new Float32Array(10)], SR, () => 0.5);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(22, true), 2); assert.equal(v.getUint32(24, true), SR); assert.equal(v.getUint16(34, true), 16);
  assert.equal(wav.length, 44 + 10 * 2 * 2);
});

test('renderer (inline, no Web Audio): a one-bar loop masters to target with a seamless seam', async () => {
  const score: Score = {
    id: 'test-loop', bpm: 120, beatsPerBar: 4, bars: 1, swing: 0.5, loop: true, tail: 1, reverb: 'room', reverbDb: -6,
    target: { lufs: -16, measure: 'integrated' }, about: 'test',
    tracks: [
      { id: 'bell', kind: 'pitched', voice: 'celesta', level: -20, send: 0.3, notes: melody('C5:1 E5:1 G5:1 C6:1') },
      { id: 'kit', kind: 'kit', level: -22, send: 0.1, hits: steps('kick', 'x...x...x...x...', 0) },
    ],
  };
  const a = await renderScore(score, { ...createRenderEnv(SR, 1e9), offline: false });
  assert.equal(a.l.length, 88200, 'exactly one bar at 120 BPM');
  assert.ok(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
  assert.ok(Math.abs(a.master.lufs - -16) < 0.5, `lufs ${a.master.lufs}`);
  assert.ok(samplePeakDb([a.l, a.r]) <= -1.6 + 1e-3);
  assert.ok(seam([a.l, a.r], SR).seamRatio < 6);
});

test('effects render with their variations and stay under the ceiling', async () => {
  const defs = CASCADE_SFX.filter(d => ['click', 'coin', 'land'].includes(d.id));
  const clips = await renderSfx(defs, { ...createRenderEnv(SR, 1e9), offline: false });
  for (const d of defs) {
    const list = clips.get(d.id)!;
    assert.equal(list.length, d.variations);
    for (const c of list) { assert.ok(c.l.length > 100); assert.ok(samplePeakDb([c.l, c.r]) <= -1.6 + 1e-3); }
  }
  // every effect id is unique; frequent effects have 3–4 variations, the rare celebration moments (tier-ups,
  // landings, callouts: `late`) 1–2 plus per-play pitch/gain micro-variation
  const ids = CASCADE_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of CASCADE_SFX) {
    if (d.late) assert.ok(d.variations >= 1 && d.variations <= 2 && d.jitter[0] > 0 && d.jitter[1] > 0, d.id);
    else assert.ok(d.variations >= 3 && d.variations <= 4, d.id);
  }
});
