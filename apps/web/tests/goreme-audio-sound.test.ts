import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoremeSound, type GoremeRenderService } from '../lib/slot-audio/goreme-sound';
import { GOREME_SCORES } from '../lib/slot-audio/scores/goreme';
import { GOREME_SFX } from '../lib/slot-audio/sfx/goreme';
import { SFX_CATALOGS } from '../lib/slot-audio/render-protocol';
import { ASENA_SCORES } from '../lib/slot-audio/scores/asena';
import { scoreLength } from '../lib/slot-audio/render';
import { melody } from '../lib/slot-audio/scores/notation';
import { GOREME_HOOK, GOREME_ANSWER, GOREME_SKY, GOREME_FEATURE_RIFF, GOREME_FEATURE_SKY } from '../lib/slot-audio/scores/goreme';
import { GOREME_CALLOUT_CLASSES, GOREME_CALLOUT_VALUES } from '../lib/slot-audio/goreme-tiers';
import { VOICE_DELAY } from '../lib/slot-audio/win-tiers';
import type { RenderedAsset, SfxClip } from '../lib/slot-audio/render';

const SR = 44100;

test('Göreme scores: own ids, whole bars, base ≥30 s loop, separate feature theme, stingers end on the bar', () => {
  const ids = new Set(Object.values(ASENA_SCORES).map(s => s.id));
  for (const [key, score] of Object.entries(GOREME_SCORES)) {
    assert.ok(score.id.startsWith('goreme-'), key); assert.ok(!ids.has(score.id));
    const beats = score.bars * score.beatsPerBar;
    if (!score.loop) { assert.ok((score.musicalEnd ?? beats) <= beats, key); assert.ok(Number.isInteger(score.musicalEnd ?? beats), `${key}: stinger ends on a beat`); }
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      assert.ok(times.length > 0, `${key}/${track.id}`);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} at ${t}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n >= 24 && n.n <= 100, `${key}/${track.id} pitch ${n.n}`);
    }
  }
  const sec = (s: { bars: number; bpm: number; beatsPerBar: number; loop: boolean; tail: number }) => scoreLength(s as never, SR).body / SR;
  assert.ok(GOREME_SCORES.base.loop && sec(GOREME_SCORES.base) >= 30, `base ${sec(GOREME_SCORES.base)} s`);
  assert.ok(GOREME_SCORES.feature.loop && sec(GOREME_SCORES.feature) >= 30, `feature ${sec(GOREME_SCORES.feature)} s`);
  assert.notEqual(GOREME_SCORES.base.bpm, GOREME_SCORES.feature.bpm);
  // modal colour: base F Acemaşiran (F G A Bb C D E), feature G Mahur (G A B C D E F#)
  const F = new Set([5, 7, 9, 10, 0, 2, 4]), G = new Set([7, 9, 11, 0, 2, 4, 6]);
  for (const src of [GOREME_HOOK, GOREME_ANSWER, GOREME_SKY]) for (const n of melody(src)) assert.ok(F.has(n.n % 12), `base note ${n.n}`);
  for (const src of [GOREME_FEATURE_RIFF, GOREME_FEATURE_SKY]) for (const n of melody(src)) assert.ok(G.has(n.n % 12), `feature note ${n.n}`);
  // celebrations follow the bar grid at 120 BPM
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(GOREME_SCORES[k].bpm, 120);
});

test('effects catalogue: registered for the worker, unique ids, variations for frequent events', () => {
  assert.equal(SFX_CATALOGS.goreme, GOREME_SFX);
  const ids = GOREME_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['spin', 'stop', 'tick', 'balloon-1', 'balloon-4', 'ways-0', 'ways-3', 'burner', 'gust-l', 'gust-r', 'breeze', 'merge', 'merge-big', 'flyaway', 'moor', 'sky-tick', 'sun1', 'sun6', 'tease', 'trigger', 'coin', 'respin']) assert.ok(ids.includes(id), id);
  for (const d of GOREME_SFX) if (['spin', 'stop', 'tick', 'coin', 'burner', 'merge', 'moor', 'sky-tick'].includes(d.id)) assert.ok(d.variations >= 3, d.id);
});

/** Fake Web Audio: logs buffer starts with the buffer duration (which identifies the clip). */
function fakeAudio(log: string[]) {
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  return class FakeContext {
    state = 'running'; currentTime = 2; sampleRate = 44100; destination = {};
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = { buffer: null as { duration?: number } | null, playbackRate: param(), loop: false, connect() {}, disconnect() {}, start(t: number) { log.push(`start(${t.toFixed(3)},${node.buffer?.duration ?? 0})`); }, stop() {} };
      return node;
    }
    createStereoPanner() { return { pan: param(), connect() {}, disconnect() {} }; }
    createBuffer(_c: number, length: number, rate: number) { return { duration: length / rate, length, copyToChannel() {}, getChannelData: () => new Float32Array(length) }; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {}, connect() {}, disconnect() {} }; }
    async decodeAudioData(data: ArrayBuffer) { return { duration: data.byteLength / 4 } as unknown as AudioBuffer; }
    async resume() {} async suspend() {} async close() {}
  };
}
const SFX_INDEX = new Map(GOREME_SFX.map((d, i) => [d.id, i]));
const clipSeconds = (id: string) => 0.3 + (SFX_INDEX.get(id) ?? 0) * 0.002;
const dur = (id: string) => Math.round(clipSeconds(id) * SR) / SR;
function fakeService(): GoremeRenderService {
  return {
    parallelism: 0, workerJobs: 0, failure: null, trace: null, prefetch() {}, dispose() {},
    async score(score) {
      const end = ((score.musicalEnd ?? score.bars * score.beatsPerBar) * 60) / score.bpm, n = Math.round((end + 0.5) * SR);
      return { id: score.id, sampleRate: SR, l: new Float32Array(n), r: new Float32Array(n), loop: score.loop, bpm: score.bpm, beatsPerBar: score.beatsPerBar, bars: score.bars, musicalEnd: end, renderMs: 0, master: { gainDb: 0, limitDb: 0, lufs: -15 } } satisfies RenderedAsset;
    },
    async sfx(_catalog, ids) {
      const out = new Map<string, SfxClip[]>();
      for (const id of ids) {
        const def = GOREME_SFX.find(d => d.id === id)!, n = Math.round(clipSeconds(id) * SR);
        out.set(id, Array.from({ length: def.variations }, (_, v) => ({ id, variation: v, l: new Float32Array(n), r: new Float32Array(n), sampleRate: SR })));
      }
      return out;
    },
  };
}
const startsOf = (log: string[], id: string) => log.filter(l => l.startsWith('start(') && l.endsWith(`,${dur(id)})`)).map(l => Number(/start\(([\d.]+)/.exec(l)![1]));

test('göreme sound is a complete no-op without Web Audio (SSR, tests)', async () => {
  const sound = createGoremeSound();
  await sound.load(); await sound.loaded(); await sound.resume(); sound.setEnabled(true);
  sound.spinStart(); for (let r = 0; r < 6; r++) sound.reelStop(r);
  sound.balloonLand(5, 2); sound.waysWin('h1', 3); sound.winHighlight(2);
  assert.equal(sound.lift({ wind: 'left', merges: [4], exits: [{ multiplier: 3, moored: true }] }), 0);
  sound.burner(); sound.wind('right'); sound.merge(9); sound.flyAway(); sound.moor(4); sound.respin(); sound.skyMultiplier(1, 12);
  for (let n = 1; n <= 6; n++) sound.sunLand(n);
  sound.featureTrigger(); sound.freeSpinsIntro(); sound.retrigger(); sound.featureOutro(); sound.totalWinFanfare();
  for (const t of [1, 2, 3, 4] as const) sound.bigWin(t);
  sound.maxWin(); sound.countUp(true); sound.countUp(false);
  for (const c of GOREME_CALLOUT_CLASSES) sound.multiplierCallout(GOREME_CALLOUT_VALUES[c]);
  sound.nice(); sound.click(); sound.betChange(-1); sound.denied(); sound.autoplay(true);
  assert.deepEqual(await sound.setVoiceBank('/audio/voice/goreme/tr').then(r => r.loaded), []);
  sound.dispose(); sound.dispose();
});

test('game events: reels, balloons, lift composite, sky ticks, missing voice → wordless placeholder, then a recorded line', async () => {
  const log: string[] = [];
  const scope = globalThis as Record<string, unknown>;
  const realFetch = scope.fetch;
  const requested: string[] = [];
  scope.AudioContext = fakeAudio(log);
  scope.OfflineAudioContext = class {};
  scope.fetch = async (url: string) => { requested.push(url); return url.includes('/x100.mp3') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(6) } : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const ctxOf = (s: ReturnType<typeof createGoremeSound>) => s.engine.context as unknown as { currentTime: number };
  try {
    const sound = createGoremeSound({ service: fakeService, voicePolicy: { minGap: 0, repeatWindow: 0, minorCooldown: 0, ambientCooldown: 0 } });
    sound.setVoicePolicy({ level: 'full' });
    sound.setEnabled(true);
    await sound.loaded();
    assert.ok(GOREME_SFX.every(d => sound.status().rendered.includes(d.id)));
    assert.ok(Object.keys(GOREME_SCORES).every(id => sound.status().rendered.includes(id as never)));

    log.length = 0;
    for (let r = 0; r < 6; r++) { ctxOf(sound).currentTime += 0.1; sound.reelStop(r); }
    assert.equal(startsOf(log, 'stop').length, 6);
    log.length = 0;
    sound.balloonLand(1, 0); sound.balloonLand(12, 5);
    assert.equal(startsOf(log, 'balloon-1').length, 1); assert.equal(startsOf(log, 'balloon-4').length, 1);

    // lift: burner now, gust 0.18 s later, a mooring and a big merge after it
    ctxOf(sound).currentTime = 10;
    log.length = 0;
    const secs = sound.lift({ wind: 'right', balloons: 3, lift: 1, merges: [12], exits: [{ multiplier: 4, moored: true }] });
    assert.ok(secs > 0.5);
    assert.deepEqual(startsOf(log, 'burner').map(t => +t.toFixed(2)), [10.01]);
    assert.deepEqual(startsOf(log, 'gust-r').map(t => +t.toFixed(2)), [10.19]);
    assert.equal(startsOf(log, 'moor').length, 1); assert.equal(startsOf(log, 'merge-big').length, 1);
    assert.equal(startsOf(log, 'gust-l').length, 0);
    log.length = 0;
    sound.lift({ wind: 'calm', exits: [{ multiplier: 2, moored: false }] });
    assert.equal(startsOf(log, 'breeze').length, 1); assert.equal(startsOf(log, 'flyaway').length, 1);

    // sky multiplier ×3 → ×11: one tick per step (max 8), and the "sky full" line (wordless stand-in)
    ctxOf(sound).currentTime = 20;
    log.length = 0;
    sound.skyMultiplier(3, 11);
    assert.equal(startsOf(log, 'sky-tick').length, 8);
    assert.equal(startsOf(log, 'vo-rise').length, 1);

    // ×100 callout with no recording: the callout clip and the wordless placeholder
    ctxOf(sound).currentTime = 30;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'callout-x100').length, 1);
    assert.deepEqual(startsOf(log, 'vo-joy').map(t => +t.toFixed(3)), [+(30 + VOICE_DELAY).toFixed(3)]);
    assert.equal(sound.status().voice.last?.kind, 'placeholder');

    // the bank of a folder that has no files yet (no generated version) makes no request at all
    const none = await sound.setVoiceBank('/audio/voice/goreme/xx', { requireVersion: true });
    assert.equal(requested.length, 0); assert.equal(none.missing.length, 18);
    // a folder with a file: the recorded line replaces the placeholder
    const v = await sound.setVoiceBank('/test/goreme/en');
    assert.deepEqual(v.loaded, ['x100']); assert.equal(v.missing.length, 17);
    ctxOf(sound).currentTime = 40;
    log.length = 0;
    sound.multiplierCallout(150);
    assert.equal(startsOf(log, 'vo-joy').length, 0);
    assert.ok(log.includes(`start(${(40 + VOICE_DELAY).toFixed(3)},1.5)`), 'recorded line');

    // escalation and landing
    ctxOf(sound).currentTime = 100;
    sound.bigWin(1); sound.countUp(true); sound.bigWin(3); sound.maxWin();
    assert.equal(sound.status().celebration.max, true);
    log.length = 0;
    sound.countUp(false);
    assert.equal(startsOf(log, 'count-land-max').length, 1);
    sound.dispose();
  } finally { delete scope.AudioContext; delete scope.OfflineAudioContext; if (realFetch) scope.fetch = realFetch; else delete scope.fetch; }
});
