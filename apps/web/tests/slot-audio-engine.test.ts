import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotAudioEngine } from '../lib/slot-audio/engine';
import { createCascadeSound, loadMixSettings, saveMixSettings } from '../lib/slot-audio/cascade-sound';
import { createCascadeAudio } from '../lib/cascade-audio';
import { DEFAULT_MIX } from '../lib/slot-audio/timing';

test('engine and game API are complete no-ops without Web Audio (SSR, tests)', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  assert.equal(SlotAudioEngine.supported(), false);
  const engine = new SlotAudioEngine();
  assert.equal(engine.ensure(), null);
  await engine.resume();
  engine.setMix({ music: 0.2 }); engine.duck(12, 500); engine.duckHold(10); engine.duckRelease();
  assert.equal(engine.setScene('base'), null);
  assert.equal(engine.desiredScene, 'base', 'the wish is kept for when audio becomes available');
  assert.equal(engine.quantizedTime('bar'), 0);
  engine.dispose(); engine.dispose();

  const sound = createCascadeSound();
  await sound.load(); await sound.loaded();
  await sound.resume(); sound.setEnabled(true);
  sound.setMix({ master: 0.5, music: 0.4, sfx: 0.9, ambience: 0.1, muted: false });
  assert.equal(sound.getMix().music, 0.4);
  for (const scene of ['idle', 'base', 'feature', 'bigwin', 'none'] as const) sound.setScene(scene);
  sound.duck(10, 300); sound.countUp(true); sound.countUp(false);
  sound.click(); sound.betChange(1); sound.betChange(-1); sound.denied(); sound.tumble(); sound.symbolLand();
  sound.multiplierApply(25); sound.scatterTease(true); sound.scatterTease(false); sound.featureOutro(); sound.maxWin(); sound.autoplay(true); sound.autoplay(false);
  sound.crystalArrive(10); sound.playSfx('pop-l'); sound.playStinger('maxWin');
  for (const tier of [1, 2, 3] as const) sound.bigWin(tier);
  assert.deepEqual(sound.status().rendered, []);
  sound.dispose(); sound.dispose();
  assert.equal(typeof createCascadeAudio().load, 'function', 'the adapter returns the full sound API');
});

/** Minimal fake context that records gain automation. */
function fakeContext(log: string[]) {
  const param = (name: string) => ({
    value: 1,
    setValueAtTime(v: number, t: number) { log.push(`${name}.set(${v.toFixed(3)}@${t.toFixed(2)})`); },
    linearRampToValueAtTime(v: number, t: number) { log.push(`${name}.ramp(${v.toFixed(3)}@${t.toFixed(2)})`); },
    setValueCurveAtTime(c: Float32Array, t: number, d: number) { log.push(`${name}.curve(${c[0]!.toFixed(2)}→${c[c.length - 1]!.toFixed(2)}@${t.toFixed(2)}+${d.toFixed(2)})`); },
    cancelScheduledValues() {}, setTargetAtTime() {},
  });
  let gains = 0;
  return class FakeContext {
    state = 'running'; currentTime = 1; sampleRate = 44100; destination = {};
    createGain() { const id = gains++; return { gain: param(`g${id}`), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBufferSource() { log.push('source'); return { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(t: number, o: number) { log.push(`start(${t.toFixed(3)},${o.toFixed(3)})`); }, stop() {} }; }
    createStereoPanner() { return { pan: { value: 0 }, connect() {}, disconnect() {} }; }
    async resume() {} async suspend() {} async close() {}
  };
}

test('engine with a context: mix ramps, phase-aligned scene cross-fade on the bar, duck automation', () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  scope.AudioContext = fakeContext(log);
  try {
    const engine = new SlotAudioEngine();
    const ctx = engine.ensure()!;
    assert.ok(ctx);
    // buses: g0 master, g1 trim, g2 music, g3 duck, g4 sfx, g5 ambience
    log.length = 0;
    engine.setMix({ music: 0.5 });
    assert.ok(log.includes('g2.ramp(0.250@1.06)'), log.join(' '));
    engine.setMix({ muted: true });
    assert.ok(log.includes('g0.ramp(0.000@1.06)'), 'mute ramps the master to zero');
    engine.setMix({ muted: false });

    const buffer = { duration: 8 } as AudioBuffer;
    engine.registerScene('idle', { buffer, bpm: 120, beatsPerBar: 4 });
    engine.registerScene('base', { buffer, bpm: 120, beatsPerBar: 4 });
    log.length = 0;
    const t0 = engine.setScene('idle');
    assert.ok(t0 !== null && Math.abs(t0 - 1.02) < 1e-9, 'nothing playing: starts at once');
    assert.ok(log.some(l => l.startsWith('start(1.020,0.000)')));
    (ctx as unknown as { currentTime: number }).currentTime = 3.3;
    log.length = 0;
    const t1 = engine.setScene('base')!;
    assert.ok(Math.abs(t1 - 5.02) < 1e-9, `next bar line of the idle loop, got ${t1}`);
    assert.ok(log.some(l => l === 'start(5.020,4.000)'), `phase-aligned offset: ${log.join(' ')}`);
    assert.ok(log.some(l => /curve\(0\.00→1\.00@5\.02\+1\.20\)/.test(l)) && log.some(l => /curve\(1\.00→0\.00@5\.02\+1\.20\)/.test(l)), 'equal-power in and out');
    assert.equal(engine.scene, 'base');
    // stinger quantisation follows the scene grid, which continues the old one (same tempo, aligned phase)
    assert.ok(Math.abs(engine.quantizedTime('beat') - 3.52) < 1e-9, `${engine.quantizedTime('beat')}`);

    log.length = 0;
    engine.duck(12, 1000);
    assert.ok(log.some(l => l.startsWith('g3.ramp(0.251@3.34)')), log.join(' '));
    assert.ok(log.some(l => l.startsWith('g3.ramp(1.000@4.79)')), 'released after hold + 450 ms');
    engine.dispose();
    assert.equal(engine.context, null);
  } finally { delete scope.AudioContext; }
});

test('mix settings persist through localStorage when available', () => {
  const scope = globalThis as Record<string, unknown>;
  const store = new Map<string, string>();
  scope.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    assert.equal(loadMixSettings(), null);
    saveMixSettings({ ...DEFAULT_MIX, music: 0.3 });
    assert.equal(loadMixSettings()?.music, 0.3);
  } finally { delete scope.localStorage; }
  assert.equal(loadMixSettings(), null, 'no storage: null, no throw');
});
