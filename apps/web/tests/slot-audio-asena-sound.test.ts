import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asenaConstellationPlan } from '../components/asena/geometry';
import { ASENA_CALLOUT_VALUES, createAsenaSound, type AsenaRenderService } from '../lib/slot-audio/asena-sound';
import { createEbruSound } from '../lib/slot-audio/ebru-sound';
import { ASENA_SCORES } from '../lib/slot-audio/scores/asena';
import { ASENA_SFX } from '../lib/slot-audio/sfx/asena';
import { ASENA_CALLOUT_CLASSES, HOWL_DELAY, constellationTrace, pawTimes } from '../lib/slot-audio/asena-tiers';
import { VOICE_DELAY } from '../lib/slot-audio/win-tiers';
import type { RenderedAsset, SfxClip } from '../lib/slot-audio/render';

test('asena sound is a complete no-op without Web Audio (SSR, tests)', async () => {
  const scope = globalThis as Record<string, unknown>;
  assert.equal(typeof scope.AudioContext, 'undefined');
  const sound = createAsenaSound();
  await sound.load(); await sound.loaded();
  await sound.resume(); sound.setEnabled(true);
  sound.setMix({ master: 0.5, music: 0.4, sfx: 0.9, ambience: 0.2, muted: false });
  assert.equal(sound.getMix().ambience, 0.2);
  for (const scene of ['idle', 'base', 'feature', 'bigwin', 'none'] as const) sound.setScene(scene);
  sound.spinStart(); for (let c = 0; c < 6; c++) sound.dropIn(c); sound.land(3); sound.symbolLand();
  sound.clusterWin('h1', 9); sound.starBurst('l2', 12); sound.shatter(9, 1); sound.pop(5, 0); sound.winHighlight(5); sound.win(2); sound.fall(); sound.tumble();
  assert.equal(sound.constellation('kurt-basi'), null);
  sound.howl(1.4); sound.wolfWalk({ ms: 640 });
  for (let n = 1; n <= 6; n++) sound.moonLand(n);
  sound.scatter(2); sound.moonTease(true); sound.scatterTease(false); sound.mapPiece(3, 2); sound.globalMultiplier(5); sound.mapSpins(5);
  sound.featureTrigger(); sound.freeSpinsIntro(); sound.retrigger(); sound.featureOutro(); sound.totalWinFanfare();
  for (const t of [1, 2, 3, 4] as const) sound.bigWin(t);
  sound.maxWin(); sound.countUp(true); sound.countUp(false);
  for (const c of ASENA_CALLOUT_CLASSES) sound.multiplierCallout(ASENA_CALLOUT_VALUES[c]);
  sound.nice(); sound.click(); sound.betChange(1); sound.betChange(-1); sound.denied(); sound.autoplay(true); sound.autoplay(false);
  sound.duck(10, 300); sound.playSfx('land'); sound.playStinger('maxWin');
  assert.deepEqual(sound.status().rendered, []);
  assert.deepEqual(await sound.setVoiceBank('/audio/voice/asena').then(r => r.loaded), []);
  sound.dispose(); sound.dispose();
});

/** Fake Web Audio: records starts (with the buffer's duration, which identifies the clip) and rates. */
function fakeAudio(log: string[]) {
  const param = (name: string) => ({
    value: 1,
    setValueAtTime(v: number, t: number) { log.push(`${name}.set(${v.toFixed(3)}@${t.toFixed(2)})`); },
    linearRampToValueAtTime(v: number, t: number) { log.push(`${name}.ramp(${v.toFixed(3)}@${t.toFixed(2)})`); },
    setValueCurveAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {},
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
const SFX_INDEX = new Map(ASENA_SFX.map((d, i) => [d.id, i]));
const clipSeconds = (id: string) => 0.3 + (SFX_INDEX.get(id) ?? 0) * 0.002;
const dur = (id: string) => Math.round(clipSeconds(id) * 44100) / 44100;
function fakeService(): AsenaRenderService {
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
        const def = ASENA_SFX.find(d => d.id === id)!, n = Math.round(clipSeconds(id) * sr);
        out.set(id, Array.from({ length: def.variations }, (_, v) => ({ id, variation: v, l: new Float32Array(n), r: new Float32Array(n), sampleRate: sr })));
      }
      return out;
    },
  };
}
const startsOf = (log: string[], id: string) => log.filter(l => l.startsWith('start(') && l.endsWith(`,${dur(id)})`)).map(l => Number(/start\(([\d.]+)/.exec(l)![1]));

test('game events: the constellation sounds every star at its plan time, ignites and howls; wolf walk, moons, Ergenekon, callouts, celebrations', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  scope.AudioContext = fakeAudio(log);
  scope.OfflineAudioContext = class {};
  scope.fetch = async (url: string) => (url.endsWith('/x100.mp3') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(6) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  const ctxOf = (s: ReturnType<typeof createAsenaSound>) => s.engine.context as unknown as { currentTime: number };
  try {
    const sound = createAsenaSound({ service: fakeService, voicePolicy: { minGap: 0, repeatWindow: 0, minorCooldown: 0, ambientCooldown: 0 } }); sound.setVoicePolicy({ level: 'full' });
    sound.setEnabled(true);
    await sound.loaded();
    assert.ok(sound.status().core && sound.status().extended);
    assert.ok(ASENA_SFX.every(d => sound.status().rendered.includes(d.id)), 'every effect installed');
    assert.ok(Object.keys(ASENA_SCORES).every(id => sound.status().rendered.includes(id as never)), 'every score installed');

    // drops: six columns, each a land clip
    log.length = 0;
    for (let c = 0; c < 6; c++) { ctxOf(sound).currentTime += 0.1; sound.dropIn(c); }
    assert.equal(startsOf(log, 'land').length, 6);

    // the constellation: every node at its plan time (from the real art plan), then the ignition and the great howl
    ctxOf(sound).currentTime = 10;
    log.length = 0;
    const plan = asenaConstellationPlan({ templateId: 'kurt-basi', transform: 3, origin: [1, 1] }, 1400);
    const r = sound.constellation('kurt-basi', { nodeAt: plan.nodeAt, durationMs: plan.duration, cols: plan.nodes.map(n => n[0]) });
    assert.ok(r);
    const nodeStarts = [...startsOf(log, 'node-lo'), ...startsOf(log, 'node'), ...startsOf(log, 'node-hi')].sort((a, b) => a - b);
    assert.equal(nodeStarts.length, 7, 'seven stars');
    const expected = plan.nodeAt.map(t => 10.01 + t / 1000).sort((a, b) => a - b);
    nodeStarts.forEach((t, i) => assert.ok(Math.abs(t - expected[i]!) < 2e-3, `star ${i} at ${t}, plan ${expected[i]}`));
    assert.deepEqual(startsOf(log, 'ignite-kurt-basi').map(t => +t.toFixed(2)), [+(10.01 + 1.4 - 0.02).toFixed(2)]);
    assert.deepEqual(startsOf(log, 'howl-great').map(t => +t.toFixed(3)), [+(10.01 + 1.4 + HOWL_DELAY).toFixed(3)]);
    assert.equal(startsOf(log, 'howl').length, 0);
    assert.ok(Math.abs(r.howlAt - (0.01 + 1.4 + HOWL_DELAY)) < 1e-6, 'returns when the howl starts');
    // another template uses its own ignition and the ordinary howl, with the default plan groups
    ctxOf(sound).currentTime = 20;
    log.length = 0;
    sound.constellation('hilal');
    assert.equal(startsOf(log, 'ignite-hilal').length, 1); assert.equal(startsOf(log, 'howl').length, 1);
    assert.equal([...startsOf(log, 'node-lo'), ...startsOf(log, 'node'), ...startsOf(log, 'node-hi')].length, constellationTrace('hilal').events.reduce((s, e) => s + e.notes.length, 0));

    // wolf walk: four paws over the walk and the star trail
    ctxOf(sound).currentTime = 30;
    log.length = 0;
    sound.wolfWalk({ ms: 800 });
    assert.deepEqual(startsOf(log, 'paw').map(t => +(t - 30.01).toFixed(4)), pawTimes(800));
    assert.equal(startsOf(log, 'trail').length, 1);

    // moon 2 starts the tease; the trigger is not doubled by the intro
    ctxOf(sound).currentTime = 40;
    log.length = 0;
    sound.moonLand(2);
    assert.equal(startsOf(log, 'moon2').length, 1); assert.equal(startsOf(log, 'tease').length, 1);
    ctxOf(sound).currentTime = 42;
    log.length = 0;
    sound.featureTrigger(); sound.freeSpinsIntro();
    assert.equal(startsOf(log, 'trigger').length, 1);

    // Ergenekon: a map piece, the mountain cracks at ×5, +5 spins
    ctxOf(sound).currentTime = 50;
    log.length = 0;
    sound.mapPiece(0, 1); sound.globalMultiplier(5); sound.globalMultiplier(1); sound.mapSpins(5);
    assert.equal(startsOf(log, 'piece').length, 1); assert.equal(startsOf(log, 'mount-3').length, 1); assert.equal(startsOf(log, 'mount-1').length, 0);
    assert.equal(startsOf(log, 'spins-plus').length, 1);

    // callout: clip + placeholder vocal, then the recorded line replaces the placeholder
    ctxOf(sound).currentTime = 60;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1);
    assert.deepEqual(startsOf(log, 'vo-joy').map(t => +t.toFixed(3)), [+(60 + VOICE_DELAY).toFixed(3)]);
    const v = await sound.setVoiceBank('/audio/voice/asena');
    assert.deepEqual(v.loaded, ['x100']); assert.equal(v.missing.length, 28);
    ctxOf(sound).currentTime = 70;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'vo-joy').length, 0);
    assert.ok(log.includes(`start(${(70 + VOICE_DELAY).toFixed(3)},1.5)`), 'recorded line');

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

test('games side by side: Ebru keeps its own API', () => {
  const asena = createAsenaSound(), ebru = createEbruSound();
  assert.equal(typeof asena.constellation, 'function'); assert.equal(typeof ebru.combSweep, 'function');
  assert.ok(!('combSweep' in asena)); assert.ok(!('constellation' in ebru));
  asena.dispose(); ebru.dispose();
});
