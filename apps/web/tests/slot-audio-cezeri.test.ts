import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melody, barCount } from '../lib/slot-audio/scores/notation';
import { CEZERI_FEATURE_RIFF, CEZERI_HOOK, CEZERI_SCORES, type CezeriScoreId } from '../lib/slot-audio/scores/cezeri';
import { EBRU_SCORES } from '../lib/slot-audio/scores/ebru';
import { STORM_SCORES } from '../lib/slot-audio/scores/storm';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { CEZERI_SFX } from '../lib/slot-audio/sfx/cezeri';
import { EBRU_SFX } from '../lib/slot-audio/sfx/ebru';
import { SFX_CATALOGS } from '../lib/slot-audio/render-protocol';
import { createRenderEnv, renderScore, renderSfx, scoreLength, splitTracks, trackCost } from '../lib/slot-audio/render';
import { samplePeakDb, seam } from '../lib/slot-audio/synth/master';
import { birdWhistle, chimeRod, courtyard, drip, escapement, gearClank, gearWhirr, handCymbal, kos, naqqara, pipe, pour, ratchet, santur, wings } from '../lib/slot-audio/synth/cezeri';
import {
  BEAM_CLIPS, CEZERI_CALLOUT_CLASSES, CEZERI_CLASS_VOICE, CEZERI_LADDER, CEZERI_MAX_RESPINS, CEZERI_PLACEHOLDER, CEZERI_SYMBOLS, CEZERI_TIER_VOICE, CEZERI_VOICE_LINES, CEZERI_VOICE_TEXT,
  HUB_STEPS_CARGAH, HUB_STEPS_NIKRIZ, RATCHET_MIN_GAP, RING_EASES, beamPlan, cezeriCalloutClass, cezeriVoiceBankUrls, cezeriVoiceDecision, chainDuckDb, chainVoice, crossedClass, hubRevealId,
  hubStepRate, invertEase, loadCezeriVoiceBank, ratchetPlan, reservoirSemitones, spokePan, tensionCutoff, tensionUpper, vesselSemitones,
} from '../lib/slot-audio/cezeri-tiers';
import { TIER_KEY } from '../lib/slot-audio/win-tiers';
import { createRng } from '../lib/slot-audio/timing';
import type { Score } from '../lib/slot-audio/scores/types';

const SR = 44100;
const seconds = (id: CezeriScoreId) => scoreLength(CEZERI_SCORES[id], SR).body / SR;
const endSeconds = (id: CezeriScoreId) => ((CEZERI_SCORES[id].musicalEnd ?? 0) * 60) / CEZERI_SCORES[id].bpm;
const pc = (n: number) => ((n % 12) + 12) % 12;
const C_NIKRIZ = new Set([0, 2, 3, 6, 7, 9, 10]);
const C_CARGAH = new Set([0, 2, 4, 5, 7, 9, 11]);
const C_LADDER = new Set([0, 2, 7, 9]);

test('Cezeri scores fit their form: whole bars, events inside, own ids, tempos, loop and stinger lengths', () => {
  for (const [key, score] of Object.entries(CEZERI_SCORES)) {
    const beats = score.bars * score.beatsPerBar;
    const { body, total } = scoreLength(score, SR);
    assert.ok(total > body, key);
    assert.ok(score.id.startsWith('cezeri-'), `${key}: own id namespace`);
    if (!score.loop) assert.ok((score.musicalEnd ?? beats) <= beats, `${key}: musical end inside the score`);
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      assert.ok(times.length > 0, `${key}/${track.id} has events`);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} event at beat ${t} outside 0..${beats}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n + (track.transpose ?? 0) >= 24 && n.n + (track.transpose ?? 0) <= 100, `${key}/${track.id} pitch ${n.n}`);
      if (track.kind === 'pad') for (const c of track.chords) assert.ok(c.ns.every(n => n >= 28 && n <= 90), `${key}/${track.id} pad range`);
    }
  }
  assert.ok(CEZERI_SCORES.base.loop && seconds('base') >= 40, `base ${seconds('base')} s`);
  assert.ok(CEZERI_SCORES.feature.loop && seconds('feature') >= 30, `feature ${seconds('feature')} s`);
  assert.equal(CEZERI_SCORES.idle.bpm, CEZERI_SCORES.base.bpm); assert.ok(CEZERI_SCORES.idle.loop && CEZERI_SCORES.ambience.loop);
  assert.ok(Math.abs(endSeconds('fsIntro') - 3.2) < 0.25, `intro ${endSeconds('fsIntro')}`);
  assert.ok(endSeconds('retrigger') >= 1 && endSeconds('retrigger') <= 2.5);
  assert.ok(endSeconds('fsOutro') >= 3.5 && endSeconds('fsOutro') <= 4.5);
  assert.ok(Math.abs(endSeconds('totalWin') - 4) < 0.05);
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const) assert.ok(endSeconds(k) >= 3 && endSeconds(k) <= 6, k);
  for (const [key, score] of Object.entries(CEZERI_SCORES)) if (key !== 'ambience') assert.ok(score.target.lufs >= -16 && score.target.lufs <= -14, key);
  // the two tension-bed loops run in lock-step
  assert.ok(CEZERI_SCORES.chainBed.loop && CEZERI_SCORES.chainBedHi.loop);
  assert.equal(scoreLength(CEZERI_SCORES.chainBed, SR).body, scoreLength(CEZERI_SCORES.chainBedHi, SR).body);
  // ids never collide with the other games
  const ids = new Set(Object.values(CEZERI_SCORES).map(s => s.id));
  for (const s of [...Object.values(EBRU_SCORES), ...Object.values(STORM_SCORES), ...Object.values(CASCADE_SCORES)]) assert.ok(!ids.has(s.id), s.id);
});

test('base theme: a 4-bar C Nikriz hook built on the escapement turn, clockwork locked to the tempo, makam colours per section', () => {
  assert.equal(barCount(CEZERI_HOOK), 4);
  const hook = melody(CEZERI_HOOK);
  assert.ok(hook.every(n => C_NIKRIZ.has(pc(n.n))), 'the hook stays in C Nikriz');
  assert.ok(hook.some(n => pc(n.n) === 3) && hook.some(n => pc(n.n) === 6), 'the augmented second Eb–F# is in the hook');
  assert.equal(pc(hook[0]!.n), 0); assert.equal(pc(hook[hook.length - 1]!.n), 0, 'starts and cadences on C');
  // the signature: C, a leap to G, the pallet rocking G F# G F#, then the drop through Eb D C
  assert.deepEqual(hook.slice(0, 8).map(n => pc(n.n)), [0, 7, 6, 7, 6, 3, 2, 0]);
  const base = CEZERI_SCORES.base;
  const voices = new Set(base.tracks.flatMap(t => ('voice' in t ? [t.voice] : t.kind === 'kit' ? t.hits.map(h => h.k) : t.fx.map(f => f.k))));
  for (const v of ['pipe', 'santur', 'santurSoft', 'ney', 'waterOrgan', 'chimeRod', 'drip', 'escTick', 'escTock', 'ratchet', 'clank', 'naqDum', 'naqTek', 'kos', 'cymbal', 'whirr']) assert.ok(voices.has(v as never), v);
  // the escapement ticks on every beat and tocks on every off-beat eighth, all 20 bars long
  const clock = base.tracks.find(t => t.id === 'clock');
  assert.ok(clock && clock.kind === 'kit');
  const ticks = clock.hits.filter(h => h.k === 'escTick').map(h => h.t), tocks = clock.hits.filter(h => h.k === 'escTock').map(h => h.t);
  assert.equal(ticks.length, 80); assert.equal(tocks.length, 80);
  assert.ok(ticks.every((t, i) => t === i) && tocks.every((t, i) => t === i + 0.5));
  // B in Eb Çargah (Ab and the F natural), C in Nikriz again (F# and Eb)
  const ney = base.tracks.find(t => t.id === 'ney');
  assert.ok(ney && ney.kind === 'pitched' && ney.notes.every(n => n.t >= 32 && n.t < 56) && ney.notes.some(n => pc(n.n) === 8) && ney.notes.some(n => pc(n.n) === 5));
  const pipeC = base.tracks.find(t => t.id === 'pipe');
  assert.ok(pipeC && pipeC.kind === 'pitched');
  const c = pipeC.notes.filter(n => n.t >= 56);
  assert.ok(c.some(n => pc(n.n) === 6) && c.some(n => pc(n.n) === 3));
  // feature: C Çargah, the escapement turn in major with the F# neighbour
  assert.equal(barCount(CEZERI_FEATURE_RIFF), 8);
  const riff = melody(CEZERI_FEATURE_RIFF);
  assert.ok(riff.every(n => C_CARGAH.has(pc(n.n)) || pc(n.n) === 6));
  assert.deepEqual(riff.slice(0, 4).map(n => pc(n.n)), [0, 7, 6, 7]);
});

test('celebrations: the shared key ladder from C, layers added per tier, one 120 BPM grid', () => {
  const tonicPc = (id: CezeriScoreId) => { const bass = CEZERI_SCORES[id].tracks.find(t => t.id === 'bass'); assert.ok(bass && bass.kind === 'pitched'); return pc(bass.notes[bass.notes.length - 1]!.n); };
  assert.deepEqual((['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const).map(tonicPc), [1, 2, 3, 4, 'max'].map(t => TIER_KEY[t as 1] % 12));
  const beds = (['bed1', 'bed2', 'bed3', 'bed4', 'bedMax'] as const).map(id => CEZERI_SCORES[id]);
  for (let i = 1; i < beds.length; i++) {
    const prev = new Set(beds[i - 1]!.tracks.map(t => t.id)), next = new Set(beds[i]!.tracks.map(t => t.id));
    assert.ok([...prev].every(id => next.has(id)) && next.size > prev.size, `${beds[i]!.id} keeps every layer and adds more`);
  }
  for (const b of beds) { assert.equal(b.bpm, 120); assert.equal(b.bars, 4); assert.ok(b.loop); }
  for (const id of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(CEZERI_SCORES[id].bpm, 120);
  assert.ok(CEZERI_SCORES.maxWin.tracks.length >= CEZERI_SCORES.bigWin4.tracks.length);
  for (const id of ['tier-up-2', 'tier-up-3', 'tier-up-4', 'tier-up-max', 'count-land-1', 'count-land-2', 'count-land-3', 'count-land-4', 'count-land-max']) assert.ok(CEZERI_SFX.some(d => d.id === id), id);
  for (const score of Object.values(CEZERI_SCORES)) for (const bins of [1, 2, 3, 4]) assert.deepEqual(splitTracks(score, bins).flat().sort(), score.tracks.map(t => t.id).sort());
  // the tension beds are pitched only on C, G and D (consonant with every hub tick)
  for (const id of ['chainBed', 'chainBedHi'] as const) for (const t of CEZERI_SCORES[id].tracks) if (t.kind === 'pitched') assert.ok(t.notes.every(n => [0, 2, 7].includes(pc(n.n))), `${id}/${t.id}`);
  // Cezeri voices carry their measured cost weights
  const santurTrack = CEZERI_SCORES.base.tracks.find(t => t.id === 'santur')!;
  assert.ok(santurTrack.kind === 'pitched' && trackCost(santurTrack) > santurTrack.notes.length);
});

test('effects: every Cezeri event exists, unique ids, variation rules, the ring/beam/chain layers in the core, own catalog', () => {
  const ids = CEZERI_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const required = ['spin', 'ratchet', 'ring-stop', 'ring-whirr', 'hub-x1', 'hub-x2', 'hub-x3', 'hub-x5', 'hub-x10', ...Array.from({ length: 10 }, (_, i) => `hub-step-${i + 1}`),
    'lock', 'pin', 'respin', 'chain-end', 'chain-end-big', 'chain-full', 'beam-1', 'beam-2', 'beam-3', 'beam-sweep', 'gear-wild', 'win', 'coin', 'click', 'bet-up', 'bet-down', 'denied', 'ding',
    'vessel1', 'vessel2', 'vessel3', 'vessel4', 'vessel5', 'vessel6', 'tease', 'trigger', 'reservoir-1', 'reservoir-2', 'reservoir-3', 'falcon-flight', 'falcon-drop', 'auto-on', 'auto-off',
    'vo-hum', 'vo-hey', 'vo-joy', ...CEZERI_CALLOUT_CLASSES.map(c => `callout-${c}`)];
  for (const id of required) assert.ok(ids.includes(id), id);
  for (const d of CEZERI_SFX) {
    if (d.late) assert.ok(d.variations >= 1 && d.variations <= 2, d.id);
    else if (d.id.startsWith('hub-step-')) assert.equal(d.variations, 2, `${d.id}: each ladder step is its own pitch, two variations`);
    else assert.ok(d.variations >= 3 && d.variations <= 4, `${d.id}: frequent effects have 3–4 variations`);
  }
  const core = CEZERI_SFX.filter(d => d.core).map(d => d.id);
  for (const id of ['spin', 'ratchet', 'ring-stop', 'ring-whirr', 'hub-x1', 'hub-step-1', 'hub-step-2', 'lock', 'pin', 'respin', 'chain-end', 'beam-1', 'beam-2', 'beam-3', 'beam-sweep', 'click', 'coin']) assert.ok(core.includes(id), id);
  assert.ok(!CEZERI_SFX.some(d => d.core && d.late));
  assert.equal(SFX_CATALOGS.cezeri, CEZERI_SFX); assert.equal(SFX_CATALOGS.ebru, EBRU_SFX);
  for (const line of CEZERI_VOICE_LINES) { const p = CEZERI_PLACEHOLDER[line]; if (p) assert.ok(ids.includes(p), p); }
  // the hub ladder escalates: later steps are at least as loud a class and last longer
  const order = ['ui', 'light', 'medium', 'major', 'hero'];
  const steps = Array.from({ length: 10 }, (_, i) => CEZERI_SFX.find(d => d.id === `hub-step-${i + 1}`)!);
  for (let i = 1; i < 10; i++) assert.ok(order.indexOf(steps[i]!.level) >= order.indexOf(steps[i - 1]!.level));
  assert.equal(steps[9]!.level, 'hero');
});

test('callouts grow with the class: six classes, each longer than the one below; the hub crosses classes once', () => {
  const cases: [number, string][] = [[2, 'x2'], [9.99, 'x2'], [10, 'x10'], [25, 'x25'], [64, 'x50'], [128, 'x100'], [256, 'x250'], [Number.NaN, 'x2']];
  for (const [v, c] of cases) assert.equal(cezeriCalloutClass(v), c, `${v}×`);
  const lengths = CEZERI_CALLOUT_CLASSES.map(c => {
    const st = CEZERI_SFX.find(d => d.id === `callout-${c}`)!.build({ sr: 22050, rng: createRng(1) }, 0);
    let peak = 0; for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    let end = st.l.length; while (end > 0 && Math.abs(st.l[end - 1]!) < peak * 1e-3 && Math.abs(st.r[end - 1]!) < peak * 1e-3) end--;
    return end / 22050;
  });
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! > lengths[i - 1]!, `${CEZERI_CALLOUT_CLASSES[i]} ${lengths[i]!.toFixed(2)} s > ${lengths[i - 1]!.toFixed(2)} s`);
  for (const c of CEZERI_CALLOUT_CLASSES) { const l = CEZERI_CLASS_VOICE[c]; if (l) assert.ok(CEZERI_VOICE_LINES.includes(l)); }
  for (const t of [1, 2, 3, 4, 'max'] as const) assert.ok(CEZERI_VOICE_LINES.includes(CEZERI_TIER_VOICE[t]));
  assert.equal(crossedClass(9, 10), 'x10'); assert.equal(crossedClass(10, 11), null); assert.equal(crossedClass(24, 25), 'x25'); assert.equal(crossedClass(3, 4), null); assert.equal(crossedClass(Number.NaN, 12), 'x10');
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 20].map(hubRevealId), ['hub-x1', 'hub-x2', 'hub-x3', 'hub-x3', 'hub-x5', 'hub-x5', 'hub-x10', 'hub-x10']);
});

test('ring rotation: one pawl click per slice along the easing, thinning into the whirr, the last at the stop', () => {
  for (const ease of Object.keys(RING_EASES) as (keyof typeof RING_EASES)[]) {
    const fn = RING_EASES[ease];
    assert.ok(Math.abs(fn(0)) < 1e-9 && Math.abs(fn(1) - 1) < 1e-9, ease);
    for (const y of [0.1, 0.5, 0.9]) assert.ok(Math.abs(fn(invertEase(fn, y)) - y) < 1e-6, `${ease} inverse`);
  }
  const plan = ratchetPlan(2, 36, 1500, 'outCubic');
  assert.equal(plan.seconds, 1.5); assert.equal(plan.distance, 36); assert.equal(plan.ring, 2);
  const last = plan.clicks[plan.clicks.length - 1]!;
  assert.equal(last.slice, 36); assert.ok(Math.abs(last.at - 1.5) < 1e-9, 'the last click is the stop');
  for (let i = 1; i < plan.clicks.length; i++) {
    const a = plan.clicks[i - 1]!, b = plan.clicks[i]!;
    assert.ok(b.at - a.at >= RATCHET_MIN_GAP - 1e-9 && b.slice > a.slice);
    // every click sits exactly where the angle crosses its slice boundary
    assert.ok(Math.abs(RING_EASES.outCubic(b.at / 1.5) - b.slice / 36) < 1e-6);
  }
  // decelerating: the gaps grow, the clicks get louder as they slow
  const gaps = plan.clicks.slice(1).map((c, i) => c.at - plan.clicks[i]!.at);
  assert.ok(gaps[gaps.length - 1]! > gaps[0]!); assert.ok(last.gain >= plan.clicks[0]!.gain);
  // dense start: fewer clicks than slices (the rest is the whirr); a slow, short turn keeps every slice
  assert.ok(plan.clicks.length < 36 && plan.clicks.length <= 40);
  assert.equal(ratchetPlan(0, 6, 2000, 'linear').clicks.length, 6);
  // whirr follows the speed: fast at the start, silent at the stop
  assert.ok(plan.whirrRate[0]! > plan.whirrRate[plan.whirrRate.length - 2]!); assert.equal(plan.whirrLevel[plan.whirrLevel.length - 1], 0);
  // junk input is clamped
  const junk = ratchetPlan(9, Number.NaN, -5, x => x);
  assert.equal(junk.ring, 3); assert.equal(junk.distance, 12); assert.ok(junk.seconds >= 0.15 && junk.clicks.length >= 1);
});

test('spoke beam and pitch maps stay on the C ladder; the hub climbs the scene makam', () => {
  for (const sym of CEZERI_SYMBOLS) for (const len of [3, 4]) for (const startRing of [0, 1]) {
    const p = beamPlan(5, len, startRing, sym);
    const n = Math.min(len, 4 - startRing) >= 3 ? len : 3;
    assert.ok(p.notes.length === len || p.notes.length === n);
    assert.ok(p.notes.every(x => C_LADDER.has(pc(x.semitones))), `${sym} on the ladder`);
    for (let i = 1; i < p.notes.length; i++) { assert.ok(p.notes[i]!.semitones > p.notes[i - 1]!.semitones, 'the beam rises outward'); assert.ok(p.notes[i]!.at > p.notes[i - 1]!.at); }
    assert.ok(p.notes.every(x => x.rate >= 2 ** (-6 / 12) - 1e-9 && x.rate <= 2 ** (6 / 12) + 1e-9), 'no clip moves more than half an octave');
    assert.ok(p.notes[p.notes.length - 1]!.ring <= 3);
  }
  assert.ok(beamPlan(0, 3, 0, 'h1').notes[0]!.semitones > beamPlan(0, 3, 0, 'l4').notes[0]!.semitones, 'h1 above l4');
  assert.ok(beamPlan(0, 3, 0, 'gear').gear);
  assert.equal(BEAM_CLIPS.length, 3);
  assert.equal(spokePan(0), 0); assert.ok(spokePan(3) > 0.69 && spokePan(9) < -0.69); assert.equal(spokePan(15), spokePan(3));
  assert.ok(CEZERI_LADDER.every(s => C_LADDER.has(pc(s))));
  // hub ladder: Nikriz in the base game, Çargah in the feature, strictly rising, each degree within a semitone
  assert.equal(HUB_STEPS_NIKRIZ.length, CEZERI_MAX_RESPINS + 1); assert.equal(HUB_STEPS_CARGAH.length, CEZERI_MAX_RESPINS + 1);
  for (let k = 1; k <= CEZERI_MAX_RESPINS; k++) {
    assert.ok(HUB_STEPS_NIKRIZ[k]! > HUB_STEPS_NIKRIZ[k - 1]! && HUB_STEPS_CARGAH[k]! > HUB_STEPS_CARGAH[k - 1]!);
    assert.ok(C_NIKRIZ.has(pc(HUB_STEPS_NIKRIZ[k]!)) && C_CARGAH.has(pc(HUB_STEPS_CARGAH[k]!)));
    assert.ok(Math.abs(Math.log2(hubStepRate(k, 'cargah')) * 12) <= 1 + 1e-9);
  }
  assert.equal(pc(HUB_STEPS_NIKRIZ[CEZERI_MAX_RESPINS]!), 6, 'the tenth respin peaks on the tense F#');
  // tension opens with the chain
  for (let k = 2; k <= 10; k++) { assert.ok(tensionCutoff(k) > tensionCutoff(k - 1)); assert.ok(tensionUpper(k) >= tensionUpper(k - 1)); assert.ok(chainDuckDb(k) >= chainDuckDb(k - 1)); }
  assert.equal(tensionUpper(3), 0); assert.equal(tensionUpper(8), 1); assert.equal(tensionCutoff(10), 14000);
  assert.deepEqual([1, 3, 6, 10].map(chainVoice), [null, 'chain-3', 'chain-6', 'chain-max']);
  const vessels = [1, 2, 3, 4, 5, 6].map(vesselSemitones);
  for (let i = 1; i < 6; i++) assert.ok(vessels[i]! > vessels[i - 1]!);
  assert.deepEqual([1, 2, 3].map(reservoirSemitones), [0, 7, 14]);
});

test('voice bank: 22 lines with Turkish texts, folder and per-line urls, silent failures, one voice at a time', async () => {
  assert.equal(CEZERI_VOICE_LINES.length, 22);
  for (const line of CEZERI_VOICE_LINES) assert.ok(CEZERI_VOICE_TEXT[line].length > 2, line);
  const urls = cezeriVoiceBankUrls('/audio/voice/cezeri/');
  assert.equal(urls.x10, '/audio/voice/cezeri/x10.mp3'); assert.equal(urls['chain-max'], '/audio/voice/cezeri/chain-max.mp3');
  assert.equal(cezeriVoiceBankUrls({ x100: '/v/a.ogg', x50: ' ' }).x50, null);
  const bank = await loadCezeriVoiceBank(urls, async url => { if (url.endsWith('x10.mp3')) throw new Error('net'); return url.endsWith('x100.mp3') ? { url } : null; });
  assert.equal(bank.size, 22); assert.equal(bank.get('x10'), null); assert.deepEqual(bank.get('x100'), { url: '/audio/voice/cezeri/x100.mp3' });
  assert.equal(cezeriVoiceDecision(null, 'nice', 1), 'play');
  assert.equal(cezeriVoiceDecision({ line: 'lock', until: 3 }, 'win-max', 1), 'replace');
  assert.equal(cezeriVoiceDecision({ line: 'win-max', until: 3 }, 'x10', 1), 'skip');
});

test('Cezeri voices: finite, audible, bounded, deterministic, in tune', () => {
  const ctx = () => ({ sr: SR, rng: createRng(7) });
  const mono: [string, (c: ReturnType<typeof ctx>) => Float32Array][] = [
    ['santur', c => santur(c, 261.63, 0.8, 0.3)], ['pipe', c => pipe(c, 523.25, 0.8, 0.5)], ['organ', c => pipe(c, 261.63, 0.8, 0.5, { rank: 'organ' })], ['chimeRod', c => chimeRod(c, 523.25, 0.8)],
    ['handCymbal', c => handCymbal(c, 0.8)], ['tick', c => escapement(c, 0.9, 'tick')], ['tock', c => escapement(c, 0.9, 'tock')], ['ratchet', c => ratchet(c, 0.9)], ['clank', c => gearClank(c, 0.9)],
    ['naqDum', c => naqqara(c, 1, 'dum')], ['naqTek', c => naqqara(c, 1, 'tek')], ['kos', c => kos(c, 1)], ['drip', c => drip(c, 1046.5, 0.8)], ['bird', c => birdWhistle(c, 2600, 3200, 0.2, 0.8)],
  ];
  for (const [name, make] of mono) {
    const a = make(ctx()), b = make(ctx());
    assert.ok(a.length > 100 && a.every(Number.isFinite), name);
    const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01 && peak < 4, `${name} peak ${peak}`);
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), `${name} deterministic`);
  }
  for (const [name, st] of [['pour', pour(ctx(), 1, 0.8)], ['wings', wings(ctx(), 4, 0.15, 0.8)], ['whirr', gearWhirr(ctx(), 1, 0.8)], ['courtyard', courtyard(ctx(), 3)]] as const) {
    assert.ok(st.l.every(Number.isFinite) && st.r.every(Number.isFinite) && st.l.some(v => Math.abs(v) > 1e-3), name);
  }
  assert.equal(courtyard(ctx(), 3).l.length, 3 * SR);
  // santur C4 and the automaton flute C5 in tune (autocorrelation over the sustained part)
  const f0 = (x: Float32Array, from: number, lo: number, hi: number) => {
    const k = x.subarray(Math.round(from * SR));
    let best = -Infinity, lag = 0;
    for (let L = lo; L < hi; L++) { let s = 0; for (let i = 0; i < 6000; i++) s += k[i]! * k[i + L]!; if (s > best) { best = s; lag = L; } }
    return SR / lag;
  };
  assert.ok(Math.abs(f0(santur(ctx(), 261.63, 0.8, 0.8), 0.2, 100, 300) - 261.63) < 4, 'santur');
  assert.ok(Math.abs(f0(pipe(ctx(), 523.25, 0.8, 0.8), 0.2, 50, 150) - 523.25) < 8, 'pipe');
});

test('renderer with the Cezeri voices (inline): a one-bar clockwork loop masters to target with a seamless seam', async () => {
  const score: Score = {
    id: 'cezeri-test-loop', bpm: 100, beatsPerBar: 4, bars: 1, swing: 0.5, loop: true, tail: 1, reverb: 'room', reverbDb: -6,
    target: { lufs: -15, measure: 'integrated' }, about: 'test',
    tracks: [
      { id: 'santur', kind: 'pitched', voice: 'santur', level: -20, send: 0.3, tame: 13, notes: melody('C5:.5 G5:1 F#5:.25 G5:.25 F#5:.5 Eb5:.5 D5:.5 C5:.5') },
      { id: 'pipe', kind: 'pitched', voice: 'pipe', level: -22, send: 0.3, notes: [{ t: 0, d: 4, n: 72, v: 0.7 }] },
      { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -26, send: 0.4, notes: [{ t: 0, d: 4, n: 48, v: 0.7 }, { t: 0, d: 4, n: 55, v: 0.7 }] },
      { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -27, send: 0.4, notes: [{ t: 0, d: 1, n: 84, v: 0.8 }] },
      { id: 'drip', kind: 'pitched', voice: 'drip', level: -28, send: 0.4, notes: [{ t: 2, d: 1, n: 79, v: 0.8 }] },
      { id: 'kit', kind: 'kit', level: -22, send: 0.1, tame: 12, hits: [{ t: 0, k: 'kos', v: 1 }, { t: 1, k: 'naqDum', v: 0.8 }, { t: 2, k: 'naqTek', v: 0.8 }, { t: 3, k: 'cymbalSoft', v: 0.6 }, { t: 0.5, k: 'escTick', v: 0.8 }, { t: 1.5, k: 'escTock', v: 0.8 }, { t: 3.5, k: 'ratchet', v: 0.8 }, { t: 2.5, k: 'clank', v: 0.8 }] },
      { id: 'fx', kind: 'fx', level: -28, send: 0.2, fx: [{ t: 0, d: 4, k: 'whirr', v: 0.8 }, { t: 0, d: 4, k: 'courtyard', v: 1 }] },
    ],
  };
  const a = await renderScore(score, { ...createRenderEnv(SR, 1e9), offline: false });
  assert.equal(a.l.length, Math.round(2.4 * SR));
  assert.ok(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
  assert.ok(Math.abs(a.master.lufs - -15) < 0.5, `lufs ${a.master.lufs}`);
  assert.ok(samplePeakDb([a.l, a.r]) <= -1.6 + 1e-3);
  assert.ok(seam([a.l, a.r], SR).seamRatio < 6);
});

test('ring, beam and hub-step layers render with their variations under the ceiling', async () => {
  const defs = CEZERI_SFX.filter(d => ['ratchet', 'ring-whirr', 'beam-2', 'hub-step-1', 'lock'].includes(d.id));
  const clips = await renderSfx(defs, { ...createRenderEnv(SR, 1e9), offline: false });
  for (const d of defs) {
    const list = clips.get(d.id)!;
    assert.equal(list.length, d.variations);
    for (const c of list) { assert.ok(c.l.length > 100); assert.ok(samplePeakDb([c.l, c.r]) <= -1.6 + 1e-3); }
    assert.notDeepEqual(list[0]!.l.slice(0, 500), list[1]!.l.slice(0, 500), `${d.id}: variations differ`);
  }
  // the whirr is a long flat texture (the runtime loops it under turns of any length)
  for (const c of clips.get('ring-whirr')!) assert.ok(c.l.length / SR > 2.2, `whirr ${c.l.length / SR} s`);
});
