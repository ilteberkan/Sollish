import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCezeriSound, scheduleRingRotate, scheduleSpokeBeam, startTensionBed, setTension, CEZERI_CALLOUT_VALUES, type CezeriRenderService } from '../lib/slot-audio/cezeri-sound';
import { createEbruSound } from '../lib/slot-audio/ebru-sound';
import { CEZERI_SCORES } from '../lib/slot-audio/scores/cezeri';
import { CEZERI_SFX } from '../lib/slot-audio/sfx/cezeri';
import { CEZERI_CALLOUT_CLASSES, beamPlan, ratchetPlan, tensionCutoff } from '../lib/slot-audio/cezeri-tiers';
import { VOICE_DELAY } from '../lib/slot-audio/win-tiers';
import type { RenderedAsset, SfxClip } from '../lib/slot-audio/render';

test('cezeri sound is a complete no-op without Web Audio (SSR, tests)', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  const sound = createCezeriSound();
  await sound.load(); await sound.loaded();
  await sound.resume(); sound.setEnabled(true);
  sound.setMix({ master: 0.5, music: 0.4, sfx: 0.9, ambience: 0.2, muted: false });
  assert.equal(sound.getMix().ambience, 0.2);
  for (const scene of ['idle', 'base', 'feature', 'bigwin', 'none'] as const) sound.setScene(scene);
  sound.spinStart(); sound.hubReveal(3); sound.hubReveal(12);
  assert.equal(sound.ringRotate(0, 36, 1500), 0);
  assert.equal(sound.rotate([{ ring: 0, distance: 30, ms: 1200 }, { ring: 3, distance: 40, ms: 1800, delayMs: 200 }]), 0);
  sound.ringStop(2);
  assert.equal(sound.spokeWin(4, 4, 'h1', { startRing: 0 }), 0);
  sound.winHighlight(5); sound.win(2); sound.gearLock(4, { respin: true });
  for (let k = 1; k <= 10; k++) { sound.hubTick(2 + k, k); sound.respin(k); }
  sound.chainEnd({ respins: 10, capped: true });
  for (let n = 1; n <= 6; n++) sound.vesselLand(n);
  sound.scatterLand(2); sound.scatter(1); sound.scatterTease(true); sound.scatterTease(false); sound.featureTrigger(); sound.freeSpinsIntro(); sound.retrigger();
  for (const l of [1, 2, 3]) sound.reservoirFill(l);
  sound.falconFlight(); sound.falconDrop(1, 3); sound.featureOutro(); sound.totalWinFanfare();
  for (const t of [1, 2, 3, 4] as const) sound.bigWin(t);
  sound.maxWin(); sound.countUp(true); sound.countUp(false);
  for (const c of CEZERI_CALLOUT_CLASSES) sound.multiplierCallout(CEZERI_CALLOUT_VALUES[c]);
  sound.nice(); sound.click(); sound.betChange(1); sound.betChange(-1); sound.denied(); sound.autoplay(true); sound.autoplay(false);
  sound.duck(10, 300); sound.playSfx('lock'); sound.playStinger('maxWin');
  assert.deepEqual(sound.status().rendered, []);
  assert.equal(sound.status().chain.active, false);
  assert.deepEqual(await sound.setVoiceBank('/audio/voice/cezeri').then(r => r.loaded), []);
  sound.dispose(); sound.dispose();
});

/** Fake Web Audio: records starts (with the buffer's duration, which identifies the clip), rates, curves and filter moves. */
function fakeAudio(log: string[]) {
  const param = (name: string) => ({
    value: 1,
    setValueAtTime(v: number, t: number) { log.push(`${name}.set(${v.toFixed(3)}@${t.toFixed(2)})`); },
    linearRampToValueAtTime(v: number, t: number) { log.push(`${name}.ramp(${v.toFixed(3)}@${t.toFixed(2)})`); },
    setValueCurveAtTime(c: Float32Array, t: number, d: number) { log.push(`${name}.curve(${c.length}@${t.toFixed(2)}+${d.toFixed(2)}:${c[0]!.toFixed(3)}..${c[c.length - 1]!.toFixed(3)})`); },
    setTargetAtTime(v: number, t: number) { log.push(`${name}.target(${v.toFixed(1)}@${t.toFixed(2)})`); },
    exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  });
  let gains = 0;
  return class FakeContext {
    state = 'running'; currentTime = 2; sampleRate = 44100; destination = {};
    createGain() { const id = gains++; return { gain: param(`g${id}`), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = {
        buffer: null as { duration?: number } | null, playbackRate: param('rate'), loop: false, loopStart: 0, loopEnd: 0, connect() {}, disconnect() {},
        start(t: number) { log.push(`start(${t.toFixed(3)},${node.buffer?.duration ?? 0}${node.loop ? ',loop' : ''})`); }, stop() {},
      };
      return node;
    }
    createStereoPanner() { return { pan: param('pan'), connect() {}, disconnect() {} }; }
    createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, length, copyToChannel() {}, getChannelData: () => new Float32Array(length) }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: param('cutoff'), Q: param('q'), connect() {}, disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { duration: data.byteLength / 4 } as unknown as AudioBuffer; }
    async resume() {} async suspend() {} async close() {}
  };
}

/** Instant fake render service: clip length encodes the effect id; scores are short silent assets with their real timing. */
const SFX_INDEX = new Map(CEZERI_SFX.map((d, i) => [d.id, i]));
const clipSeconds = (id: string) => 0.3 + (SFX_INDEX.get(id) ?? 0) * 0.002;
const dur = (id: string) => Math.round(clipSeconds(id) * 44100) / 44100;
const SCORE_IDS = Object.values(CEZERI_SCORES).map(s => s.id);
const scoreSeconds = (id: string) => 1 + SCORE_IDS.indexOf(id) * 0.01;
function fakeService(): CezeriRenderService {
  const sr = 44100;
  return {
    parallelism: 0, workerJobs: 0, failure: null, trace: null, prefetch() {}, dispose() {},
    async score(score) {
      const n = Math.round(scoreSeconds(score.id) * sr);
      return { id: score.id, sampleRate: sr, l: new Float32Array(n), r: new Float32Array(n), loop: score.loop, bpm: score.bpm, beatsPerBar: score.beatsPerBar, bars: score.bars, musicalEnd: ((score.musicalEnd ?? score.bars * score.beatsPerBar) * 60) / score.bpm, renderMs: 0, master: { gainDb: 0, limitDb: 0, lufs: -15 } } satisfies RenderedAsset;
    },
    async sfx(_catalog, ids) {
      const out = new Map<string, SfxClip[]>();
      for (const id of ids) {
        const def = CEZERI_SFX.find(d => d.id === id)!, n = Math.round(clipSeconds(id) * sr);
        out.set(id, Array.from({ length: def.variations }, (_, v) => ({ id, variation: v, l: new Float32Array(n), r: new Float32Array(n), sampleRate: sr })));
      }
      return out;
    },
  };
}
const startsOf = (log: string[], id: string) => log.filter(l => l.startsWith('start(') && (l.endsWith(`,${dur(id)})`) || l.endsWith(`,${dur(id)},loop)`)));

test('game events: rings click per slice, beams per ring, the chain climbs and opens, voice lines and celebrations', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  scope.AudioContext = fakeAudio(log);
  scope.OfflineAudioContext = class {};
  scope.fetch = async (url: string) => (url.endsWith('/x100.mp3') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(6) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  const ctxOf = (s: ReturnType<typeof createCezeriSound>) => s.engine.context as unknown as { currentTime: number };
  try {
    const sound = createCezeriSound({ service: fakeService, voicePolicy: { minGap: 0, repeatWindow: 0, minorCooldown: 0, ambientCooldown: 0 } }); sound.setVoicePolicy({ level: 'full' });
    sound.setEnabled(true);
    await sound.loaded();
    assert.ok(sound.status().core && sound.status().extended);
    assert.ok(CEZERI_SFX.every(d => sound.status().rendered.includes(d.id)), 'every effect installed');
    assert.ok(Object.keys(CEZERI_SCORES).every(id => sound.status().rendered.includes(id as never)), 'every score installed');

    // a ring: one click per planned slice, a looping whirr with rate/level curves, the stop at the end
    ctxOf(sound).currentTime = 5;
    log.length = 0;
    const secs = sound.ringRotate(1, 30, 1400);
    const plan = ratchetPlan(1, 30, 1400);
    assert.equal(secs, 1.4);
    assert.equal(startsOf(log, 'ratchet').length, plan.clicks.length);
    assert.equal(startsOf(log, 'ring-whirr').length, 1); assert.ok(startsOf(log, 'ring-whirr')[0]!.endsWith(',loop)'));
    assert.equal(startsOf(log, 'ring-stop').length, 1);
    assert.ok(startsOf(log, 'ring-stop')[0]!.startsWith(`start(${(5.005 + 1.4 - 0.004).toFixed(3)}`), 'the thunk lands on the stop');
    assert.ok(log.some(l => /^rate\.curve\(64@5\.0[01]\+1\.40/.test(l)), 'whirr rate follows the speed');
    // the four rings of a rotate step
    ctxOf(sound).currentTime = 8;
    log.length = 0;
    assert.ok(Math.abs(sound.rotate([0, 1, 2, 3].map(ring => ({ ring, distance: 30 + ring, ms: 1200 + ring * 200, delayMs: ring * 100 }))) - (0.3 + 1.8)) < 1e-9);
    assert.equal(startsOf(log, 'ring-stop').length, 4);

    // spoke wins: one chime per slice, consecutive wins queued, gear runs shimmer
    ctxOf(sound).currentTime = 12;
    log.length = 0;
    sound.spokeWin(3, 4, 'h1'); sound.spokeWin(7, 3, 'gear', { startRing: 1 });
    const beamStarts = ['beam-1', 'beam-2', 'beam-3'].flatMap(id => startsOf(log, id));
    assert.equal(beamStarts.length, 7);
    assert.equal(startsOf(log, 'beam-sweep').length, 2); assert.equal(startsOf(log, 'gear-wild').length, 1);
    const sweeps = startsOf(log, 'beam-sweep').map(l => Number(/start\(([\d.]+)/.exec(l)![1]));
    assert.ok(sweeps[1]! - sweeps[0]! >= 0.09 - 1e-6, 'the second beam waits its turn');

    // the chain: lock + pins, tension bed (two loops, filter), hub steps climbing, the class callout at ×10, release
    ctxOf(sound).currentTime = 20;
    log.length = 0;
    sound.gearLock(4, { respin: true });
    assert.equal(startsOf(log, 'lock').length, 1); assert.equal(startsOf(log, 'pin').length, 4);
    assert.equal(startsOf(log, 'chainBed').length, 0);
    const loops = log.filter(l => l.startsWith('start(') && l.endsWith(',loop)'));
    assert.equal(loops.length, 2, 'both tension loops start together');
    assert.ok(sound.status().chain.active);
    for (let k = 1; k <= 10; k++) {
      ctxOf(sound).currentTime = 20 + k * 2;
      log.length = 0;
      sound.hubTick(1 + k, k);
      assert.equal(startsOf(log, `hub-step-${k}`).length, 1, `hub step ${k}`);
      assert.ok(log.some(l => l === `cutoff.target(${tensionCutoff(k).toFixed(1)}@${(20 + k * 2).toFixed(2)})`), `filter opens at ${k}`);
      if (k === 9) assert.equal(startsOf(log, 'callout-x10').length, 1, 'hub reaches ×10');
      if (k === 3) assert.equal(startsOf(log, 'vo-hey').length, 1, 'chain-3 placeholder');
      assert.equal(sound.status().chain.round, k);
    }
    ctxOf(sound).currentTime = 50;
    log.length = 0;
    sound.chainEnd({ respins: 10, capped: true });
    assert.equal(startsOf(log, 'chain-full').length, 1);
    assert.equal(sound.status().chain.active, false);
    // a short chain ends on the open fifth; in the feature the hub step is bent onto Çargah
    ctxOf(sound).currentTime = 60; log.length = 0;
    sound.chainEnd({ respins: 1 });
    assert.equal(startsOf(log, 'chain-end').length, 1);
    sound.setScene('feature');
    ctxOf(sound).currentTime = 62; log.length = 0;
    sound.hubTick(4, 2);
    assert.equal(startsOf(log, 'hub-step-2').length, 1);
    sound.spinStart();
    assert.equal(sound.status().chain.active, false, 'a new spin closes a chain left open');

    // vessels, reservoir and falcon
    ctxOf(sound).currentTime = 70; log.length = 0;
    sound.vesselLand(2);
    assert.equal(startsOf(log, 'vessel2').length, 1); assert.equal(startsOf(log, 'tease').length, 1);
    ctxOf(sound).currentTime = 75; log.length = 0;
    sound.featureTrigger(); sound.freeSpinsIntro();
    assert.equal(startsOf(log, 'trigger').length, 1);
    ctxOf(sound).currentTime = 85; log.length = 0;
    sound.reservoirFill(3); sound.falconFlight(); sound.falconDrop(2, 3);
    assert.equal(startsOf(log, 'reservoir-3').length, 1); assert.equal(startsOf(log, 'falcon-flight').length, 1);
    assert.equal(startsOf(log, 'falcon-drop').length, 1); assert.equal(startsOf(log, 'pin').length, 3);

    // callout: clip + placeholder vocal, then the recorded line replaces the placeholder
    ctxOf(sound).currentTime = 100; log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1);
    assert.equal(startsOf(log, 'vo-joy').length, 1);
    assert.ok(startsOf(log, 'vo-joy')[0]!.startsWith(`start(${(100 + VOICE_DELAY).toFixed(3)}`));
    const r = await sound.setVoiceBank('/audio/voice/cezeri');
    assert.deepEqual(r.loaded, ['x100']); assert.equal(r.missing.length, 21);
    ctxOf(sound).currentTime = 110; log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'vo-joy').length, 0);
    assert.ok(log.includes(`start(${(110 + VOICE_DELAY).toFixed(3)},1.5)`), 'recorded line');

    // escalation: climb while counting, land on stop
    ctxOf(sound).currentTime = 200;
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

test('the live layers schedule on any context and skip missing clips', () => {
  const log: string[] = [];
  const Ctx = fakeAudio(log);
  const ctx = new Ctx() as unknown as BaseAudioContext;
  const buf = (s: number) => ({ duration: s }) as unknown as AudioBuffer;
  const plan = ratchetPlan(3, 20, 2000, 'outQuart');
  const v = scheduleRingRotate(ctx, {} as AudioNode, { clicks: [buf(0.05)], whirr: null, stop: null }, plan, 3);
  assert.equal(v.sources.length, plan.clicks.length);
  const clickStarts = log.filter(l => l.endsWith(',0.05)')).map(l => Number(/start\(([\d.]+)/.exec(l)![1]));
  assert.deepEqual(clickStarts.map(t => +(t - 3).toFixed(3)), plan.clicks.map(c => +c.at.toFixed(3)));
  v.stop();
  const beam = scheduleSpokeBeam(ctx, {} as AudioNode, { notes: { 'beam-2': buf(1) }, sweep: null, wild: null }, beamPlan(0, 4, 0, 'h3'), 1);
  assert.ok(beam.sources.length >= 1 && beam.sources.length <= 4);
  const bed = startTensionBed(ctx, {} as AudioNode, buf(4.8), buf(4.8), 2);
  assert.ok(bed && bed.sources.length === 2);
  log.length = 0;
  setTension(bed!, 10, 3);
  assert.ok(log.includes('cutoff.target(14000.0@3.00)'));
  bed!.stop();
});

test('four games side by side: Ebru keeps its own API', () => {
  const cezeri = createCezeriSound(), ebru = createEbruSound();
  assert.equal(typeof cezeri.hubTick, 'function'); assert.equal(typeof ebru.combSweep, 'function');
  assert.ok(!('combSweep' in cezeri)); assert.ok(!('hubTick' in ebru));
  cezeri.dispose(); ebru.dispose();
});
