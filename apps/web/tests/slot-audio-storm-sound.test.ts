import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStormSound, STORM_CALLOUT_VALUES, type StormRenderService } from '../lib/slot-audio/storm-sound';
import { createCascadeSound } from '../lib/slot-audio/cascade-sound';
import { STORM_SCORES } from '../lib/slot-audio/scores/storm';
import { STORM_SFX } from '../lib/slot-audio/sfx/storm';
import { STORM_MULTIPLIER_CLASSES } from '../lib/slot-audio/storm-tiers';
import { VOICE_DELAY } from '../lib/slot-audio/win-tiers';
import type { RenderedAsset, SfxClip } from '../lib/slot-audio/render';

test('storm sound is a complete no-op without Web Audio (SSR, tests)', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  const sound = createStormSound();
  await sound.load(); await sound.loaded();
  await sound.resume(); sound.setEnabled(true);
  sound.setMix({ master: 0.5, music: 0.4, sfx: 0.9, ambience: 0.2, muted: false });
  assert.equal(sound.getMix().ambience, 0.2);
  for (const scene of ['idle', 'base', 'feature', 'bigwin', 'none'] as const) sound.setScene(scene);
  sound.spinStart(); sound.land(3); sound.symbolLand(); sound.winHighlight(5); sound.win(2); sound.shatter(12, 2); sound.pop(8, 0); sound.tumble();
  sound.orbLand(25); sound.orbCollect(); sound.orbArrive(25); sound.lightningStrike(4); sound.totalMultiplier(40);
  for (let n = 1; n <= 6; n++) sound.scatterLand(n);
  sound.scatter(2); sound.scatterTease(true); sound.scatterTease(false); sound.featureTrigger(); sound.freeSpinsIntro(); sound.retrigger(); sound.featureOutro(); sound.totalWinFanfare();
  for (const t of [1, 2, 3, 4] as const) sound.bigWin(t);
  sound.maxWin(); sound.countUp(true); sound.countUp(false);
  for (const c of STORM_MULTIPLIER_CLASSES) sound.multiplierCallout(STORM_CALLOUT_VALUES[c]);
  sound.laugh(); sound.nice(); sound.click(); sound.betChange(1); sound.betChange(-1); sound.denied(); sound.autoplay(true); sound.autoplay(false);
  sound.duck(10, 300); sound.playSfx('orb'); sound.playStinger('maxWin');
  assert.deepEqual(sound.status().rendered, []);
  assert.deepEqual(await sound.setVoiceBank('/audio/voice/storm').then(r => r.loaded), []);
  sound.dispose(); sound.dispose();
});

/** Fake Web Audio: records starts (with the buffer's duration, which identifies the clip) and gain automation. */
function fakeAudio(log: string[]) {
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
    createBufferSource() { return { buffer: null as { duration?: number } | null, playbackRate: { value: 1 }, loop: false, connect() {}, disconnect() {}, start(this: { buffer: { duration?: number } | null }, t: number) { log.push(`start(${t.toFixed(3)},${this.buffer?.duration ?? 0})`); }, stop() {} }; }
    createStereoPanner() { return { pan: { value: 0 }, connect() {}, disconnect() {} }; }
    createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, length, copyToChannel() {}, getChannelData: () => new Float32Array(length) }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {}, connect() {}, disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { duration: data.byteLength / 4 } as unknown as AudioBuffer; }
    async resume() {} async suspend() {} async close() {}
  };
}

/**
 * Instant fake render service: every effect id gets clips whose length encodes the id (so a start in the log
 * names the clip), every score a short silent asset with its real tempo and musical end.
 */
const SFX_INDEX = new Map(STORM_SFX.map((d, i) => [d.id, i]));
const clipSeconds = (id: string) => 0.3 + (SFX_INDEX.get(id) ?? 0) * 0.002;
function fakeService(): StormRenderService {
  const sr = 44100;
  return {
    parallelism: 0, workerJobs: 0, failure: null, trace: null, prefetch() {}, dispose() {},
    async score(score) {
      const n = Math.round(((score.musicalEnd ?? score.bars * score.beatsPerBar) * 60 / score.bpm + 0.5) * sr);
      return { id: score.id, sampleRate: sr, l: new Float32Array(n), r: new Float32Array(n), loop: score.loop, bpm: score.bpm, beatsPerBar: score.beatsPerBar, bars: score.bars, musicalEnd: ((score.musicalEnd ?? score.bars * score.beatsPerBar) * 60) / score.bpm, renderMs: 0, master: { gainDb: 0, limitDb: 0, lufs: -15 } } satisfies RenderedAsset;
    },
    async sfx(_catalog, ids) {
      const out = new Map<string, SfxClip[]>();
      for (const id of ids) {
        const def = STORM_SFX.find(d => d.id === id)!, n = Math.round(clipSeconds(id) * sr);
        out.set(id, Array.from({ length: def.variations }, (_, v) => ({ id, variation: v, l: new Float32Array(n), r: new Float32Array(n), sampleRate: sr })));
      }
      return out;
    },
  };
}
const startsOf = (log: string[], id: string) => log.filter(l => l.startsWith('start(') && l.endsWith(`,${(Math.round(clipSeconds(id) * 44100) / 44100)})`));

test('voice lines replace the non-verbal placeholder; missing lines fall back to it; music ducks under lines', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  scope.AudioContext = fakeAudio(log);
  scope.OfflineAudioContext = class {};
  const fetched: string[] = [];
  const lines: Record<string, number> = { 'x100.mp3': 6, 'win-big.mp3': 8, 'nice.mp3': 4 };
  scope.fetch = async (url: string) => { fetched.push(url); const k = Object.keys(lines).find(f => url.endsWith(`/${f}`)); return k ? { ok: true, arrayBuffer: async () => new ArrayBuffer(lines[k]!) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }; };
  try {
    const sound = createStormSound({ service: fakeService });
    sound.setEnabled(true);
    await sound.loaded();
    assert.ok(sound.status().core && sound.status().extended);
    assert.ok(STORM_SFX.every(d => sound.status().rendered.includes(d.id)), 'every effect installed');
    assert.ok(Object.keys(STORM_SCORES).every(id => sound.status().rendered.includes(id as never)), 'every score installed');

    // no voice bank yet: the ×100 callout plays its clip and the placeholder laugh after the impact
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1, log.join(' '));
    assert.equal(startsOf(log, 'vo-laugh').length, 1, 'placeholder vocal plays without a recorded line');
    assert.ok(startsOf(log, 'vo-laugh')[0]!.startsWith(`start(${(2 + VOICE_DELAY).toFixed(3)}`));

    const r = await sound.setVoiceBank('/audio/voice/storm');
    assert.deepEqual(r.loaded.sort(), ['nice', 'win-big', 'x100']);
    assert.equal(r.missing.length, 16); assert.equal(fetched.length, 19);
    assert.ok(fetched.includes('/audio/voice/storm/x2-9.mp3') && fetched.includes('/audio/voice/storm/feature-end.mp3'));

    // with the recorded line: the line plays (1.5 s), the placeholder does not, the music bus ducks
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 10;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1);
    assert.equal(startsOf(log, 'vo-laugh').length, 0, `no placeholder when the line exists: ${log.join(' ')}`);
    assert.ok(log.includes(`start(${(10 + VOICE_DELAY).toFixed(3)},1.5)`), 'recorded line after the impact');
    // buses: g0 master, g1 trim, g2 music, g3 scene duck, g4 sfx, g5 ambience, g6 voice duck
    assert.ok(log.some(l => l.startsWith('g6.ramp(0.398@')), 'music bus −8 dB under the line');

    // a class without a recorded line (×25) still gets its placeholder grunt
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 20;
    log.length = 0;
    sound.multiplierCallout(30);
    assert.equal(startsOf(log, 'callout-x25').length, 1);
    assert.equal(startsOf(log, 'vo-grunt').length, 1);
    // <10× has neither a placeholder nor (here) a line: the callout alone
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 25;
    log.length = 0;
    sound.multiplierCallout(4);
    assert.equal(startsOf(log, 'callout-x2').length, 1);
    assert.ok(!['vo-hum', 'vo-grunt', 'vo-laugh'].some(id => startsOf(log, id).length), log.join(' '));

    // big win: the recorded "Büyük kazanç!" replaces the placeholder; the head stinger plays on the music bus
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 30;
    log.length = 0;
    sound.bigWin(1);
    assert.ok(log.some(l => /^start\(30\.\d+,2\)$/.test(l)), 'the line (2 s) plays');
    assert.equal(startsOf(log, 'vo-grunt').length, 0);
    assert.equal(sound.status().voice.speaking, null, 'scheduled, not yet speaking');
    // a lower-priority line while it speaks is skipped; nice() has a 20 s cooldown
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 31;
    log.length = 0;
    sound.nice();
    assert.ok(!log.some(l => l.endsWith(',1)')), 'nice skipped while the big-win line speaks');
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 40;
    log.length = 0;
    sound.nice(); sound.nice();
    assert.equal(log.filter(l => l.endsWith(',1)')).length, 1, 'nice once');
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 45;
    log.length = 0;
    sound.nice();
    assert.equal(log.filter(l => l.endsWith(',1)')).length, 0, 'cooldown');

    // free spins: the trigger effect once even when featureTrigger() came first, the intro stinger, the scene waits for its end
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 60;
    log.length = 0;
    sound.featureTrigger(); sound.freeSpinsIntro();
    assert.equal(startsOf(log, 'trigger').length, 1, 'trigger effect not doubled');
    sound.setScene('feature');
    // scatter 3 starts the tease riser (and its placeholder hum)
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 80;
    log.length = 0;
    sound.scatterLand(3);
    assert.equal(startsOf(log, 'scatter3').length, 1); assert.ok(log.some(l => l.endsWith(`,${Math.round(clipSeconds('tease') * 44100) / 44100})`)), 'tease riser');
    sound.scatterTease(false);

    // escalation is the Candy Cascade behaviour: climb while counting, land on stop
    (sound.engine.context as unknown as { currentTime: number }).currentTime = 100;
    sound.bigWin(1); sound.countUp(true); sound.bigWin(3);
    assert.equal(sound.status().celebration.tier, 3);
    sound.maxWin();
    assert.equal(sound.status().celebration.max, true);
    log.length = 0;
    sound.countUp(false);
    assert.equal(startsOf(log, 'count-land-max').length, 1, 'max landing');
    assert.equal(sound.status().celebration.tier, 0);
    sound.dispose();
    assert.equal(sound.voiceLines.size, 0);
  } finally { delete scope.AudioContext; delete scope.OfflineAudioContext; if (realFetch) scope.fetch = realFetch; else delete scope.fetch; }
});

test('two games side by side: Candy Cascade keeps its own API and effects', () => {
  const cascade = createCascadeSound(), storm = createStormSound();
  assert.equal(typeof cascade.crystal, 'function'); assert.equal(typeof storm.orbLand, 'function');
  assert.ok(!('orbLand' in cascade));
  cascade.dispose(); storm.dispose();
});
