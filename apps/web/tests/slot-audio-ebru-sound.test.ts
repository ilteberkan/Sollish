import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEbruSound, scheduleCombSweep, EBRU_CALLOUT_VALUES, type EbruRenderService } from '../lib/slot-audio/ebru-sound';
import { createStormSound } from '../lib/slot-audio/storm-sound';
import { EBRU_SCORES } from '../lib/slot-audio/scores/ebru';
import { EBRU_SFX } from '../lib/slot-audio/sfx/ebru';
import { EBRU_CALLOUT_CLASSES, combPlan } from '../lib/slot-audio/ebru-tiers';
import { VOICE_DELAY } from '../lib/slot-audio/win-tiers';
import type { RenderedAsset, SfxClip } from '../lib/slot-audio/render';

test('ebru sound is a complete no-op without Web Audio (SSR, tests)', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  const sound = createEbruSound();
  await sound.load(); await sound.loaded();
  await sound.resume(); sound.setEnabled(true);
  sound.setMix({ master: 0.5, music: 0.4, sfx: 0.9, ambience: 0.2, muted: false });
  assert.equal(sound.getMix().ambience, 0.2);
  for (const scene of ['idle', 'base', 'feature', 'bigwin', 'none'] as const) sound.setScene(scene);
  sound.spinStart(); for (let c = 0; c < 7; c++) sound.dropIn(c); sound.land(3); sound.symbolLand(); sound.bleed('c2', 3); sound.bleed();
  sound.clusterDissolve('c1', 12); sound.shatter(9, 1); sound.pop(5, 0); sound.winHighlight(5); sound.win(2); sound.fall(); sound.tumble();
  assert.equal(sound.combSweep([1, 2, 3, 2, 1, 0, -1], 1200, { pass: 2, createsWin: true }), 0);
  for (const v of [2, 4, 8, 256]) sound.stainGrow(v);
  for (let n = 1; n <= 6; n++) sound.scatterLand(n);
  sound.scatter(2); sound.scatterTease(true); sound.scatterTease(false); sound.featureTrigger(); sound.freeSpinsIntro(); sound.retrigger(); sound.featureOutro(); sound.totalWinFanfare();
  for (const t of [1, 2, 3, 4] as const) sound.bigWin(t);
  sound.maxWin(); sound.countUp(true); sound.countUp(false);
  for (const c of EBRU_CALLOUT_CLASSES) sound.multiplierCallout(EBRU_CALLOUT_VALUES[c]);
  sound.nice(); sound.click(); sound.betChange(1); sound.betChange(-1); sound.denied(); sound.autoplay(true); sound.autoplay(false);
  sound.duck(10, 300); sound.playSfx('drop'); sound.playStinger('maxWin');
  assert.deepEqual(sound.status().rendered, []);
  assert.deepEqual(await sound.setVoiceBank('/audio/voice/ebru').then(r => r.loaded), []);
  sound.dispose(); sound.dispose();
});

/** Fake Web Audio: records starts (with the buffer's duration, which identifies the clip), rates, pans and curves. */
function fakeAudio(log: string[]) {
  const param = (name: string) => ({
    value: 1,
    setValueAtTime(v: number, t: number) { log.push(`${name}.set(${v.toFixed(3)}@${t.toFixed(2)})`); },
    linearRampToValueAtTime(v: number, t: number) { log.push(`${name}.ramp(${v.toFixed(3)}@${t.toFixed(2)})`); },
    setValueCurveAtTime(c: Float32Array, t: number, d: number) { log.push(`${name}.curve(${c.length}@${t.toFixed(2)}+${d.toFixed(2)}:${c[0]!.toFixed(3)}..${c[c.length - 1]!.toFixed(3)})`); },
    exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {},
  });
  let gains = 0;
  return class FakeContext {
    state = 'running'; currentTime = 2; sampleRate = 44100; destination = {};
    createGain() { const id = gains++; return { gain: param(`g${id}`), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = {
        buffer: null as { duration?: number } | null, playbackRate: param('rate'), loop: false, connect() {}, disconnect() {},
        start(t: number) { log.push(`start(${t.toFixed(3)},${node.buffer?.duration ?? 0})`); }, stop() {},
      };
      return node;
    }
    createStereoPanner() { return { pan: param('pan'), connect() {}, disconnect() {} }; }
    createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, length, copyToChannel() {}, getChannelData: () => new Float32Array(length) }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {}, connect() {}, disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { duration: data.byteLength / 4 } as unknown as AudioBuffer; }
    async resume() {} async suspend() {} async close() {}
  };
}

/** Instant fake render service: clip length encodes the effect id; scores are short silent assets with their real timing. */
const SFX_INDEX = new Map(EBRU_SFX.map((d, i) => [d.id, i]));
const clipSeconds = (id: string) => 0.3 + (SFX_INDEX.get(id) ?? 0) * 0.002;
const dur = (id: string) => Math.round(clipSeconds(id) * 44100) / 44100;
function fakeService(): EbruRenderService {
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
        const def = EBRU_SFX.find(d => d.id === id)!, n = Math.round(clipSeconds(id) * sr);
        out.set(id, Array.from({ length: def.variations }, (_, v) => ({ id, variation: v, l: new Float32Array(n), r: new Float32Array(n), sampleRate: sr })));
      }
      return out;
    },
  };
}
const startsOf = (log: string[], id: string) => log.filter(l => l.startsWith('start(') && l.endsWith(`,${dur(id)})`));

test('game events play their clips at their pitch; the comb sweep follows the row shifts; voice lines and celebrations', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  scope.AudioContext = fakeAudio(log);
  scope.OfflineAudioContext = class {};
  scope.fetch = async (url: string) => (url.endsWith('/x100.mp3') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(6) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  const ctxOf = (s: ReturnType<typeof createEbruSound>) => s.engine.context as unknown as { currentTime: number };
  try {
    const sound = createEbruSound({ service: fakeService });
    sound.setEnabled(true);
    await sound.loaded();
    assert.ok(sound.status().core && sound.status().extended);
    assert.ok(EBRU_SFX.every(d => sound.status().rendered.includes(d.id)), 'every effect installed');
    assert.ok(Object.keys(EBRU_SCORES).every(id => sound.status().rendered.includes(id as never)), 'every score installed');

    // drops step up the scale left → right; blooms are pitched by colour (c1 above c8)
    log.length = 0;
    sound.dropIn(0); ctxOf(sound).currentTime += 0.1; sound.dropIn(6);
    const dropRates = log.filter(l => l.startsWith('rate.') || /^start/.test(l));
    assert.equal(startsOf(log, 'drop').length, 2, dropRates.join(' '));
    log.length = 0;
    sound.clusterDissolve('c1', 6); sound.clusterDissolve('c8', 14);
    assert.equal(startsOf(log, 'bloom-s').length, 1); assert.equal(startsOf(log, 'bloom-l').length, 1);

    // the comb: glide + its octave shadow with rate/pan/gain curves, 7 plucks, the bristle texture and the winning ending
    ctxOf(sound).currentTime = 5;
    log.length = 0;
    const seconds = sound.combSweep([0, 1, 2, 3, 2, 1, 0], 1400, { pass: 1, createsWin: true });
    assert.equal(seconds, 1.4);
    assert.equal(startsOf(log, 'comb-glide').length, 2, log.join(' '));
    assert.equal(startsOf(log, 'comb-pluck').length, 7);
    assert.equal(startsOf(log, 'comb-bristle').length, 1);
    assert.equal(startsOf(log, 'comb-win').length, 1); assert.equal(startsOf(log, 'comb-settle').length, 0);
    assert.ok(log.some(l => /^rate\.curve\(96@5\.01\+1\.40:1\.000\.\./.test(l)), 'glide rate curve starts on the first row (shift 0 → G)');
    assert.ok(log.some(l => l.startsWith('pan.curve(96@5.01')), 'pan follows the shifts');
    // a second sweep right away is ignored (one comb at a time); later, a non-winning pass ends with the settle
    log.length = 0;
    assert.equal(sound.combSweep([0, 0, 0, 0, 0, 0, 0], 800), 0);
    ctxOf(sound).currentTime = 8;
    sound.combSweep([0, -1, -2, -3, -2, -1, 0], 800, { pass: 2 });
    assert.equal(startsOf(log, 'comb-settle').length, 1);

    // stains rise with the value
    ctxOf(sound).currentTime = 10;
    log.length = 0;
    sound.stainGrow(256);
    assert.equal(startsOf(log, 'stain').length, 1);

    // scatter 2 starts the tease; the trigger is not doubled by the intro
    ctxOf(sound).currentTime = 12;
    log.length = 0;
    sound.scatterLand(2);
    assert.equal(startsOf(log, 'scatter2').length, 1); assert.equal(startsOf(log, 'tease').length, 1);
    ctxOf(sound).currentTime = 14;
    log.length = 0;
    sound.featureTrigger(); sound.freeSpinsIntro();
    assert.equal(startsOf(log, 'trigger').length, 1);

    // callout: clip + placeholder vocal, then the recorded line replaces the placeholder
    ctxOf(sound).currentTime = 20;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1);
    assert.equal(startsOf(log, 'vo-joy').length, 1);
    assert.ok(startsOf(log, 'vo-joy')[0]!.startsWith(`start(${(20 + VOICE_DELAY).toFixed(3)}`));
    const r = await sound.setVoiceBank('/audio/voice/ebru');
    assert.deepEqual(r.loaded, ['x100']); assert.equal(r.missing.length, 17);
    ctxOf(sound).currentTime = 30;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'vo-joy').length, 0);
    assert.ok(log.includes(`start(${(30 + VOICE_DELAY).toFixed(3)},1.5)`), 'recorded line');

    // escalation: climb while counting, land on stop
    ctxOf(sound).currentTime = 100;
    sound.bigWin(1); sound.countUp(true); sound.bigWin(3);
    assert.equal(sound.status().celebration.tier, 3);
    sound.maxWin();
    assert.equal(sound.status().celebration.max, true);
    log.length = 0;
    sound.countUp(false);
    assert.equal(startsOf(log, 'count-land-max').length, 1);
    assert.equal(sound.status().celebration.tier, 0);
    sound.dispose();
  } finally { delete scope.AudioContext; delete scope.OfflineAudioContext; if (realFetch) scope.fetch = realFetch; else delete scope.fetch; }
});

test('scheduleCombSweep schedules every layer on any context and skips missing clips', () => {
  const log: string[] = [];
  const Ctx = fakeAudio(log);
  const ctx = new Ctx() as unknown as BaseAudioContext;
  const buf = (s: number) => ({ duration: s }) as unknown as AudioBuffer;
  const plan = combPlan([1, 2, 3, 2, 1, 0, -1], 2000, 1);
  const v = scheduleCombSweep(ctx, {} as AudioNode, { glide: buf(6.5), plucks: [buf(0.8)], bristle: null, end: null }, plan, 3);
  assert.equal(v.sources.length, 2 + 7);
  assert.equal(v.end, 5);
  const pluckStarts = log.filter(l => l.endsWith(',0.8)')).map(l => Number(/start\(([\d.]+)/.exec(l)![1]));
  assert.deepEqual(pluckStarts.map(t => +(t - 3).toFixed(3)), plan.rows.map(r => +r.at.toFixed(3)));
  v.stop();
});

test('three games side by side: Tarhun keeps its own API', () => {
  const ebru = createEbruSound(), storm = createStormSound();
  assert.equal(typeof ebru.combSweep, 'function'); assert.equal(typeof storm.orbLand, 'function');
  assert.ok(!('orbLand' in ebru)); assert.ok(!('combSweep' in storm));
  ebru.dispose(); storm.dispose();
});
