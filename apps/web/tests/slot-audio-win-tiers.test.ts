import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTIPLIER_CLASSES, TIER_KEY, TIER_UP_PRE, VOICE_DELAY, loadVoiceBank, multiplierClass, planTierUp, tierAction, toWinTier, voiceBankUrls, winTierFor,
} from '../lib/slot-audio/win-tiers';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { CASCADE_SFX } from '../lib/slot-audio/sfx/cascade';
import { createCascadeSound } from '../lib/slot-audio/cascade-sound';
import { createRng } from '../lib/slot-audio/timing';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('win tiers follow the owner thresholds (Büyük 10×, Mega 25×, Süper 50×, Efsane 100×)', () => {
  assert.equal(winTierFor(9.99), 0); assert.equal(winTierFor(10), 1); assert.equal(winTierFor(24.9), 1); assert.equal(winTierFor(25), 2);
  assert.equal(winTierFor(49.99), 2); assert.equal(winTierFor(50), 3); assert.equal(winTierFor(99), 3); assert.equal(winTierFor(100), 4); assert.equal(winTierFor(5000), 4);
  assert.equal(winTierFor(Number.NaN), 0);
  assert.equal(toWinTier(0), 1); assert.equal(toWinTier(3), 3); assert.equal(toWinTier(4), 4); assert.equal(toWinTier(9), 4); assert.equal(toWinTier(Number.NaN), 1);
});

test('multiplier callout classes: <10, ≥10, ≥25, ≥50, ≥100, ≥250', () => {
  const cases: [number, string][] = [[1, 'x2'], [2, 'x2'], [9.9, 'x2'], [10, 'x10'], [24, 'x10'], [25, 'x25'], [49, 'x25'], [50, 'x50'], [99, 'x50'], [100, 'x100'], [249, 'x100'], [250, 'x250'], [1e6, 'x250'], [Number.NaN, 'x2'], [-5, 'x2']];
  for (const [v, c] of cases) assert.equal(multiplierClass(v), c, `${v}×`);
  // every class has its own rendered callout
  for (const c of MULTIPLIER_CLASSES) assert.ok(CASCADE_SFX.some(d => d.id === `callout-${c}`), c);
});

test('tier-up transition: the hit lands on the next beat of the celebration grid', () => {
  const grid = { start: 10, bpm: 120 }; // beats every 0.5 s from t = 10
  // plenty of time: the whole whoosh fits before the hit
  let p = planTierUp(11.1, grid, 0.4, 0.12);
  near(p.hitAt, 11.5); near(p.clipAt, 11.1); near(p.clipOffset, 0);
  p = planTierUp(10.95, grid, 0.4, 0.12);
  near(p.hitAt, 11.5); near(p.clipAt, 11.1); near(p.clipOffset, 0);
  // late call: the clip starts now, partway into the whoosh, and the hit still lands on the beat
  p = planTierUp(11.3, grid, 0.4, 0.12);
  near(p.hitAt, 11.5); near(p.clipAt, 11.3); near(p.clipOffset, 0.2);
  assert.ok(p.hitAt - 11.3 >= 0.12, 'never closer than the minimum lead');
  // exactly on a beat but inside the lead: the next beat
  p = planTierUp(11.45, grid, 0.4, 0.12);
  near(p.hitAt, 12); near(p.clipAt, 11.6); near(p.clipOffset, 0);
  // the hit is always on the grid and the clip offset + gap = pre
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const now = 10 + rng() * 20, q = planTierUp(now, grid, TIER_UP_PRE, 0.12);
    near(((q.hitAt - 10) / 0.5) % 1 < 0.5 ? ((q.hitAt - 10) / 0.5) % 1 : 1 - (((q.hitAt - 10) / 0.5) % 1), 0, 1e-6);
    assert.ok(q.hitAt >= now + 0.12 - 1e-9 && q.hitAt < now + 0.12 + 0.5 + 1e-9);
    near(q.clipOffset + (q.hitAt - q.clipAt), TIER_UP_PRE, 1e-9);
    assert.ok(q.clipAt >= now - 1e-12);
  }
  // a grid that starts in the future (bed scheduled on the head's end) still yields a grid point
  p = planTierUp(9, { start: 10, bpm: 120 }, 0.4, 0.12);
  near(p.hitAt, 9.5);
  // no grid: as soon as possible
  p = planTierUp(5, null, 0.4, 0.12);
  near(p.hitAt, 5.12); near(p.clipAt, 5); near(p.clipOffset, 0.28);
});

test('bigWin calls: start, climb, ignore repeats, restart on a lower tier', () => {
  assert.equal(tierAction(0, 2, false), 'start');
  assert.equal(tierAction(2, 3, false), 'start', 'nothing running: fresh start');
  assert.equal(tierAction(1, 2, true), 'up'); assert.equal(tierAction(1, 4, true), 'up');
  assert.equal(tierAction(3, 3, true), 'ignore');
  assert.equal(tierAction(3, 1, true), 'start');
});

test('voice bank: folder and per-class urls; failures and missing files are skipped silently', async () => {
  const urls = voiceBankUrls('/audio/voice/cascade/');
  assert.equal(urls.x100, '/audio/voice/cascade/x100.mp3'); assert.equal(urls.x2, '/audio/voice/cascade/x2.mp3');
  assert.deepEqual(Object.keys(urls).sort(), [...MULTIPLIER_CLASSES].sort());
  const some = voiceBankUrls({ x50: '/v/fifty.ogg', x100: '  ' });
  assert.equal(some.x50, '/v/fifty.ogg'); assert.equal(some.x100, null); assert.equal(some.x10, null);
  assert.equal(voiceBankUrls('').x25, null);
  const asked: string[] = [];
  const bank = await loadVoiceBank(urls, async url => {
    asked.push(url);
    if (url.endsWith('x10.mp3')) throw new Error('network');
    if (url.endsWith('x25.mp3')) return null; // 404
    if (url.endsWith('x50.mp3')) return Promise.reject(new Error('decode'));
    return { url };
  });
  assert.equal(asked.length, 6);
  assert.equal(bank.get('x10'), null); assert.equal(bank.get('x25'), null); assert.equal(bank.get('x50'), null);
  assert.deepEqual(bank.get('x100'), { url: '/audio/voice/cascade/x100.mp3' });
  assert.equal(bank.size, 6);
});

test('celebration scores: the key ladder rises tier by tier and every tier adds layers', () => {
  const ladder = [TIER_KEY[1], TIER_KEY[2], TIER_KEY[3], TIER_KEY[4], TIER_KEY.max];
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i]! > ladder[i - 1]!, 'every step modulates upward');
  // the bass of each head's last note is the tier tonic (F, G, A, C, D)
  const tonicPc = (id: keyof typeof CASCADE_SCORES) => {
    const bass = CASCADE_SCORES[id].tracks.find(t => t.id === 'bass');
    assert.ok(bass && bass.kind === 'pitched');
    return bass.notes[bass.notes.length - 1]!.n % 12;
  };
  assert.deepEqual((['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const).map(tonicPc), [5, 7, 9, 0, 2]);
  const beds = (['bed1', 'bed2', 'bed3', 'bed4', 'bedMax'] as const).map(id => CASCADE_SCORES[id]);
  for (let i = 1; i < beds.length; i++) {
    const prev = new Set(beds[i - 1]!.tracks.map(t => t.id)), next = new Set(beds[i]!.tracks.map(t => t.id));
    assert.ok([...prev].every(id => next.has(id)) && next.size > prev.size, `${beds[i]!.id} keeps every layer of ${beds[i - 1]!.id} and adds more`);
  }
  for (const b of beds) { assert.equal(b.bpm, 120); assert.equal(b.bars, 4); assert.ok(b.loop); assert.ok(b.target.lufs >= -16 && b.target.lufs <= -14); }
  // Efsane: choir pad, tower bells and timpani
  const legend = CASCADE_SCORES.bigWin4;
  for (const voice of ['padChoir', 'bell', 'timpani']) assert.ok(legend.tracks.some(t => 'voice' in t && t.voice === voice), voice);
  assert.ok(CASCADE_SCORES.maxWin.tracks.length >= legend.tracks.length, 'max win is the fullest');
  // every rendered head shares the 120 BPM grid, so tier-up hits line up with the bed
  for (const id of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(CASCADE_SCORES[id].bpm, 120);
  // tier-ups and landings exist for every reachable step
  for (const id of ['tier-up-2', 'tier-up-3', 'tier-up-4', 'tier-up-max', 'count-land-1', 'count-land-2', 'count-land-3', 'count-land-4', 'count-land-max']) assert.ok(CASCADE_SFX.some(d => d.id === id), id);
});

test('callouts grow with the class: longer motif and more sound', () => {
  const sr = 22050;
  const lengths = MULTIPLIER_CLASSES.map(c => {
    const def = CASCADE_SFX.find(d => d.id === `callout-${c}`)!;
    const st = def.build({ sr, rng: createRng(1) }, 0);
    let peak = 0;
    for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    let end = st.l.length;
    while (end > 0 && Math.abs(st.l[end - 1]!) < peak * 1e-3 && Math.abs(st.r[end - 1]!) < peak * 1e-3) end--;
    return end / sr;
  });
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! > lengths[i - 1]!, `${MULTIPLIER_CLASSES[i]} (${lengths[i]!.toFixed(2)} s) longer than ${MULTIPLIER_CLASSES[i - 1]} (${lengths[i - 1]!.toFixed(2)} s)`);
});

/** Fake Web Audio context that records starts and gain automation (no real audio). */
function fakeContext(log: string[]) {
  const param = (name: string) => ({
    value: 1,
    setValueAtTime(v: number, t: number) { log.push(`${name}.set(${v.toFixed(3)}@${t.toFixed(2)})`); },
    linearRampToValueAtTime(v: number, t: number) { log.push(`${name}.ramp(${v.toFixed(3)}@${t.toFixed(2)})`); },
    exponentialRampToValueAtTime() {}, setValueCurveAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {},
  });
  let gains = 0;
  return class FakeContext {
    state = 'running'; currentTime = 2; sampleRate = 44100; destination = {};
    createGain() { const id = gains++; return { gain: param(`g${id}`), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBufferSource() { return { buffer: null as { duration?: number } | null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(this: { buffer: { duration?: number } | null }, t: number) { log.push(`start(${t.toFixed(3)}${this.buffer?.duration ? `,${this.buffer.duration}s` : ''})`); }, stop() {} }; }
    createStereoPanner() { return { pan: { value: 0 }, connect() {}, disconnect() {} }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBuffer(_c: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {}, connect() {}, disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { duration: data.byteLength / 4 } as unknown as AudioBuffer; }
    async resume() {} async suspend() {} async close() {}
  };
}

test('voice lines: loaded per class, missing ones skipped, layered over the callout with the music bus ducked', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  scope.AudioContext = fakeContext(log);
  const fetched: string[] = [];
  scope.fetch = async (url: string) => { fetched.push(url); return url.endsWith('/x100.mp3') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(6) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }; };
  try {
    const sound = createCascadeSound({ workerFactory: null, voicePolicy: { minGap: 0, repeatWindow: 0, minorCooldown: 0, ambientCooldown: 0 } });
    sound.setEnabled(true);
    const r = await sound.setVoiceBank('/audio/voice/cascade');
    assert.deepEqual(r.loaded, ['x100']);
    assert.deepEqual(r.missing.sort(), ['x10', 'x2', 'x25', 'x250', 'x50']);
    assert.equal(fetched.length, 6);
    assert.equal(sound.voiceLines.get('x100')?.duration, 1.5);
    assert.equal(sound.voiceLines.get('x25'), null);
    log.length = 0;
    sound.multiplierCallout(30); // no voice line for x25: no voice start, no music-bus duck
    assert.ok(!log.some(l => l.includes(',1.5s')) && !log.some(l => l.startsWith('g6.')), log.join(' '));
    log.length = 0;
    sound.multiplierCallout(150);
    // buses: g0 master, g1 trim, g2 music, g3 scene duck, g4 sfx, g5 ambience, g6 voice duck
    assert.ok(log.includes(`start(${(2 + VOICE_DELAY).toFixed(3)},1.5s)`), `voice starts after the impact: ${log.join(' ')}`);
    assert.ok(log.some(l => l.startsWith('g6.ramp(0.398@')), 'music bus ducked by 8 dB under the voice');
    assert.ok(log.some(l => /^g6\.ramp\(1\.000@3\.9/.test(l)), `released after the line: ${log.filter(l => l.startsWith('g6')).join(' ')}`);
    // bigWin / countUp / tier-ups / landing / total win stay safe with nothing rendered
    sound.bigWin(1); sound.countUp(true); sound.bigWin(2); sound.bigWin(4); sound.maxWin(); sound.countUp(false); sound.totalWinFanfare();
    assert.equal(sound.status().celebration.counting, false);
    sound.dispose();
    assert.equal(sound.voiceLines.size, 0);
  } finally { delete scope.AudioContext; if (realFetch) scope.fetch = realFetch; else delete scope.fetch; }
});
