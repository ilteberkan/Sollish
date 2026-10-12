import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melody, barCount } from '../lib/slot-audio/scores/notation';
import { STORM_HOOK, STORM_SCORES, type StormScoreId } from '../lib/slot-audio/scores/storm';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { STORM_SFX } from '../lib/slot-audio/sfx/storm';
import { CASCADE_SFX } from '../lib/slot-audio/sfx/cascade';
import { SFX_CATALOGS } from '../lib/slot-audio/render-protocol';
import { createRenderEnv, renderScore, renderSfx, scoreLength, splitTracks, tameStem } from '../lib/slot-audio/render';
import { loudness, samplePeakDb, seam } from '../lib/slot-audio/synth/master';
import {
  baglama, bronze, darbuka, davul, davulRim, deepVoice, frameDrum, glassHum, godVocal, horn, ney, rain, sizzle, softKnee, stoneShatter, stoneThud, taiko, thunderCrack, thunderRumble, wind, zurna,
} from '../lib/slot-audio/synth/anatolian';
import {
  ORB_STEPS, STORM_CLASS_VOICE, STORM_MULTIPLIER_CLASSES, STORM_PLACEHOLDER, STORM_TIER_VOICE, STORM_VOICE_LINES, loadStormVoiceBank, orbSemitones, stormMultiplierClass, stormVoiceBankUrls, voiceDecision,
} from '../lib/slot-audio/storm-tiers';
import { TIER_KEY } from '../lib/slot-audio/win-tiers';
import { createRng } from '../lib/slot-audio/timing';
import type { Score } from '../lib/slot-audio/scores/types';

const SR = 44100;
const seconds = (id: StormScoreId) => scoreLength(STORM_SCORES[id], SR).body / SR;
const endSeconds = (id: StormScoreId) => ((STORM_SCORES[id].musicalEnd ?? 0) * 60) / STORM_SCORES[id].bpm;
const A_HICAZ = new Set([9, 10, 1, 2, 4, 5, 7]); // A Bb C# D E F G

test('Tarhun scores fit their form: whole bars, events inside, tempos, loop and stinger lengths', () => {
  for (const [key, score] of Object.entries(STORM_SCORES)) {
    const beats = score.bars * score.beatsPerBar;
    const { body, total } = scoreLength(score, SR);
    assert.ok(total > body, key);
    assert.ok(score.id.startsWith('storm-'), `${key}: own id namespace`);
    if (!score.loop) assert.ok((score.musicalEnd ?? beats) <= beats, `${key}: musical end inside the score`);
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      assert.ok(times.length > 0, `${key}/${track.id} has events`);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} event at beat ${t} outside 0..${beats}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n + (track.transpose ?? 0) >= 24 && n.n + (track.transpose ?? 0) <= 100, `${key}/${track.id} pitch ${n.n}`);
      if (track.kind === 'pad') for (const c of track.chords) assert.ok(c.ns.every(n => n >= 28 && n <= 90), `${key}/${track.id} pad range`);
    }
  }
  // brief: base 92–100 BPM ≥ 40 s seamless loop; feature 112–120 BPM ≥ 32 s
  assert.ok(STORM_SCORES.base.bpm >= 92 && STORM_SCORES.base.bpm <= 100 && STORM_SCORES.base.loop);
  assert.ok(seconds('base') >= 40, `base ${seconds('base')} s`);
  assert.ok(STORM_SCORES.feature.bpm >= 112 && STORM_SCORES.feature.bpm <= 120 && STORM_SCORES.feature.loop);
  assert.ok(seconds('feature') >= 32, `feature ${seconds('feature')} s`);
  // idle shares the base tempo and grid (phase-aligned cross-fades), ambience loops
  assert.equal(STORM_SCORES.idle.bpm, STORM_SCORES.base.bpm); assert.ok(STORM_SCORES.idle.loop && STORM_SCORES.ambience.loop);
  // stingers: intro ≈ 3 s, retrigger short, outro and total win ≈ 4 s, heads 3–6 s
  assert.ok(Math.abs(endSeconds('fsIntro') - 3) < 0.2, `intro ${endSeconds('fsIntro')}`);
  assert.ok(endSeconds('retrigger') >= 1 && endSeconds('retrigger') <= 2.5);
  assert.ok(endSeconds('fsOutro') >= 3.5 && endSeconds('fsOutro') <= 4.5);
  assert.ok(Math.abs(endSeconds('totalWin') - 4) < 0.05);
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const) assert.ok(endSeconds(k) >= 3 && endSeconds(k) <= 6, k);
  // music targets inside −16…−14 LUFS (ambience is its own quiet bed)
  for (const [key, score] of Object.entries(STORM_SCORES)) if (key !== 'ambience' && key !== 'idle') assert.ok(score.target.lufs >= -16 && score.target.lufs <= -14, key);
});

test('base theme: A–B–C form in A Hicaz with a 4-bar hook, Anatolian instruments and a storm', () => {
  assert.equal(barCount(STORM_HOOK), 4);
  const hook = melody(STORM_HOOK);
  assert.ok(hook.every(n => A_HICAZ.has(n.n % 12)), 'the hook stays in A Hicaz');
  assert.ok(hook.some(n => n.n % 12 === 10) && hook.some(n => n.n % 12 === 1), 'it uses the augmented second Bb–C#');
  assert.equal(hook[0]!.n % 12, 9); assert.equal(hook[hook.length - 1]!.n % 12, 9); // starts and ends on A
  assert.ok(hook.some(n => n.d <= 0.125), 'ornamented (grace notes)');
  const base = STORM_SCORES.base;
  const voices = new Set(base.tracks.flatMap(t => ('voice' in t ? [t.voice] : t.kind === 'kit' ? t.hits.map(h => h.k) : t.fx.map(f => f.k))));
  for (const v of ['zurna', 'ney', 'baglama', 'hornSwell', 'padChoirMale', 'padHorn', 'davul', 'davulRim', 'dum', 'tek', 'ka', 'taiko', 'thunder', 'rumble']) assert.ok(voices.has(v as never), v);
  // section leads: zurna in A (bars 1–8), bağlama in B (9–14), ney in C (15–18)
  const span = (id: string) => { const t = base.tracks.find(x => x.id === id); assert.ok(t && t.kind === 'pitched'); return [Math.min(...t.notes.map(n => n.t)) / 4, Math.max(...t.notes.map(n => n.t)) / 4]; };
  const [z0, z1] = span('zurna'), [s0, s1] = span('saz'), [n0, n1] = span('ney');
  assert.ok(z0 === 0 && z1 < 8 && s0 >= 8 && s1 < 14 && n0 >= 14 && n1 < 18, `${z0}-${z1} ${s0}-${s1} ${n0}-${n1}`);
  // feature in D Hicaz: its riff uses Eb and F# (the D Hicaz augmented second)
  const zf = STORM_SCORES.feature.tracks.find(t => t.id === 'zurna');
  assert.ok(zf && zf.kind === 'pitched' && zf.notes.every(n => new Set([2, 3, 6, 7, 9, 10, 0]).has(n.n % 12)), 'feature lead in D Hicaz');
});

test('celebrations: the shared key ladder from A, layers added per tier, one 120 BPM grid', () => {
  // the bass of each head's last note is the tier tonic: A, B, C#, E, F#
  const tonicPc = (id: StormScoreId) => {
    const bass = STORM_SCORES[id].tracks.find(t => t.id === 'bass');
    assert.ok(bass && bass.kind === 'pitched');
    return bass.notes[bass.notes.length - 1]!.n % 12;
  };
  assert.deepEqual((['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const).map(tonicPc), [1, 2, 3, 4, 'max'].map(t => (9 + TIER_KEY[t as 1]) % 12));
  const beds = (['bed1', 'bed2', 'bed3', 'bed4', 'bedMax'] as const).map(id => STORM_SCORES[id]);
  for (let i = 1; i < beds.length; i++) {
    const prev = new Set(beds[i - 1]!.tracks.map(t => t.id)), next = new Set(beds[i]!.tracks.map(t => t.id));
    assert.ok([...prev].every(id => next.has(id)) && next.size > prev.size, `${beds[i]!.id} keeps every layer of ${beds[i - 1]!.id} and adds more`);
  }
  for (const b of beds) { assert.equal(b.bpm, 120); assert.equal(b.bars, 4); assert.ok(b.loop); }
  for (const id of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(STORM_SCORES[id].bpm, 120);
  assert.ok(STORM_SCORES.maxWin.tracks.length >= STORM_SCORES.bigWin4.tracks.length);
  for (const id of ['tier-up-2', 'tier-up-3', 'tier-up-4', 'tier-up-max', 'count-land-1', 'count-land-2', 'count-land-3', 'count-land-4', 'count-land-max']) assert.ok(STORM_SFX.some(d => d.id === id), id);
});

test('tracks split over workers cover every track exactly once', () => {
  for (const score of Object.values(STORM_SCORES)) for (const bins of [1, 2, 3, 4]) {
    const groups = splitTracks(score, bins);
    assert.ok(groups.length <= bins);
    assert.deepEqual(groups.flat().sort(), score.tracks.map(t => t.id).sort());
  }
});

test('effects: every event of the brief exists, unique ids, variation rules, own catalog next to Candy Cascade', () => {
  const ids = STORM_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const required = ['spin', 'land', 'tick', 'win', 'shatter-s', 'shatter-m', 'shatter-l', 'tumble', 'orb', 'orb-fly', 'orb-arrive', 'lightning', 'total-mult',
    'scatter1', 'scatter2', 'scatter3', 'scatter4', 'scatter5', 'scatter6', 'tease', 'trigger', 'click', 'bet-up', 'bet-down', 'denied', 'auto-on', 'auto-off', 'coin', 'ding',
    'vo-hum', 'vo-grunt', 'vo-laugh', ...STORM_MULTIPLIER_CLASSES.map(c => `callout-${c}`)];
  for (const id of required) assert.ok(ids.includes(id), id);
  for (const d of STORM_SFX) {
    if (d.late) assert.ok(d.variations >= 1 && d.variations <= 2 && d.jitter[0] > 0 && d.jitter[1] > 0, d.id);
    else assert.ok(d.variations >= 3 && d.variations <= 4, `${d.id}: frequent effects have 3–4 variations`);
  }
  // the core batch (fast first load) holds only base-game effects
  const core = STORM_SFX.filter(d => d.core).map(d => d.id);
  for (const id of ['spin', 'land', 'tick', 'win', 'shatter-s', 'orb', 'click', 'coin']) assert.ok(core.includes(id), id);
  assert.ok(!STORM_SFX.some(d => d.core && d.late));
  // the worker catalogue knows both games; Candy Cascade's effects are untouched
  assert.equal(SFX_CATALOGS.cascade, CASCADE_SFX); assert.equal(SFX_CATALOGS.storm, STORM_SFX);
  assert.ok(Object.keys(CASCADE_SCORES).every(k => !k.startsWith('storm')));
});

test('callouts grow with the class: seven classes, each longer than the one below', () => {
  const sr = 22050;
  const lengths = STORM_MULTIPLIER_CLASSES.map(c => {
    const def = STORM_SFX.find(d => d.id === `callout-${c}`)!;
    const st = def.build({ sr, rng: createRng(1) }, 0);
    let peak = 0;
    for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    let end = st.l.length;
    while (end > 0 && Math.abs(st.l[end - 1]!) < peak * 1e-3 && Math.abs(st.r[end - 1]!) < peak * 1e-3) end--;
    return end / sr;
  });
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! > lengths[i - 1]!, `${STORM_MULTIPLIER_CLASSES[i]} (${lengths[i]!.toFixed(2)} s) longer than ${STORM_MULTIPLIER_CLASSES[i - 1]} (${lengths[i - 1]!.toFixed(2)} s)`);
});

test('callout classes and orb pitch: <10, ≥10, ≥25, ≥50, ≥100, ≥250, 500', () => {
  const cases: [number, string][] = [[2, 'x2'], [9.99, 'x2'], [10, 'x10'], [24, 'x10'], [25, 'x25'], [50, 'x50'], [99, 'x50'], [100, 'x100'], [249, 'x100'], [250, 'x250'], [499, 'x250'], [500, 'x500'], [5000, 'x500'], [Number.NaN, 'x2'], [-1, 'x2']];
  for (const [v, c] of cases) assert.equal(stormMultiplierClass(v), c, `${v}×`);
  const pitches = [2, 10, 25, 50, 100, 250, 500].map(orbSemitones);
  for (let i = 1; i < pitches.length; i++) assert.ok(pitches[i]! > pitches[i - 1]!, 'orb hum rises with the class');
  assert.ok(ORB_STEPS.every(s => A_HICAZ.has((9 + s) % 12)), 'orb pitches stay in A Hicaz');
});

test('voice bank: the 19 script file names, folder and per-line urls, silent failures, placeholders and priority', async () => {
  assert.equal(STORM_VOICE_LINES.length, 19);
  for (const n of ['x2-9', 'x10', 'x25', 'x50', 'x100', 'x250', 'x500', 'scatter-tease', 'feature-trigger', 'feature-start', 'retrigger', 'win-big', 'win-mega', 'win-super', 'win-legend', 'win-max', 'laugh', 'nice', 'feature-end']) assert.ok((STORM_VOICE_LINES as readonly string[]).includes(n), n);
  const urls = stormVoiceBankUrls('/audio/voice/storm/');
  assert.equal(urls['x2-9'], '/audio/voice/storm/x2-9.mp3'); assert.equal(urls['win-max'], '/audio/voice/storm/win-max.mp3');
  assert.equal(stormVoiceBankUrls({ x100: '/v/yuz.ogg', x50: ' ' }).x50, null);
  assert.equal(stormVoiceBankUrls('').laugh, null);
  const bank = await loadStormVoiceBank(urls, async url => {
    if (url.endsWith('x10.mp3')) throw new Error('network');
    if (url.endsWith('x25.mp3')) return null;
    return url.endsWith('x100.mp3') ? { url } : null;
  });
  assert.equal(bank.size, 19); assert.equal(bank.get('x10'), null); assert.deepEqual(bank.get('x100'), { url: '/audio/voice/storm/x100.mp3' });
  // every class and tier has a line; every placeholder is a rendered vocal effect
  for (const c of STORM_MULTIPLIER_CLASSES) assert.ok(STORM_VOICE_LINES.includes(STORM_CLASS_VOICE[c]));
  for (const t of [1, 2, 3, 4, 'max'] as const) assert.ok(STORM_VOICE_LINES.includes(STORM_TIER_VOICE[t]));
  for (const line of STORM_VOICE_LINES) { const p = STORM_PLACEHOLDER[line]; if (p) assert.ok(STORM_SFX.some(d => d.id === p), p); }
  // one voice at a time: replace a lower-priority line, skip an equal or lower one, play when free
  assert.equal(voiceDecision(null, 'nice', 1), 'play');
  assert.equal(voiceDecision({ line: 'nice', until: 3 }, 'win-max', 1), 'replace');
  assert.equal(voiceDecision({ line: 'win-max', until: 3 }, 'x10', 1), 'skip');
  assert.equal(voiceDecision({ line: 'win-max', until: 1.1 }, 'x10', 1), 'play', 'the current line is about to end');
});

test('Anatolian and storm voices: finite, audible, bounded, deterministic', () => {
  const ctx = () => ({ sr: SR, rng: createRng(5) });
  const mono: [string, (c: ReturnType<typeof ctx>) => Float32Array][] = [
    ['davul', c => davul(c, 1)], ['davulRim', c => davulRim(c, 1)], ['dum', c => darbuka(c, 1, 'dum')], ['tek', c => darbuka(c, 1, 'tek')], ['ka', c => darbuka(c, 0.7, 'ka')],
    ['frame', c => frameDrum(c, 1)], ['taiko', c => taiko(c, 1)], ['zurna', c => zurna(c, 440, 0.8, 0.5)], ['ney', c => ney(c, 440, 0.8, 0.6)], ['baglama', c => baglama(c, 220, 0.8, 0.3)],
    ['horn', c => horn(c, 110, 0.8, 0.5)], ['bronze', c => bronze(c, 440, 0.8)], ['glassHum', c => glassHum(c, 880, 0.5, 0.8)], ['sizzle', c => sizzle(c, 0.4, 0.8)], ['stoneThud', c => stoneThud(c, 0.9)],
    ['hum', c => godVocal(c, 'hum')], ['grunt', c => godVocal(c, 'grunt')], ['laugh', c => godVocal(c, 'laugh')],
    ['deepVoice', c => deepVoice(c, [{ t: 0, dur: 0.3, f0: 100, f1: 90, from: 'ah', to: 'oh' }], 1)],
  ];
  for (const [name, make] of mono) {
    const a = make(ctx()), b = make(ctx());
    assert.ok(a.length > 100 && a.every(Number.isFinite), name);
    const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01 && peak < 4, `${name} peak ${peak}`);
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), `${name} is deterministic for a seed`);
  }
  for (const [name, st] of [['crack', thunderCrack(ctx(), 1)], ['rumble', thunderRumble(ctx(), 2, 1)], ['shatter', stoneShatter(ctx(), 1)], ['rain', rain(ctx(), 2)], ['wind', wind(ctx(), 2)]] as const) {
    assert.ok(st.l.every(Number.isFinite) && st.r.every(Number.isFinite), name);
    assert.ok(st.l.some(v => Math.abs(v) > 1e-3), `${name} audible`);
  }
  // loopable beds come back exactly at the requested length
  assert.equal(rain(ctx(), 2).l.length, 2 * SR); assert.equal(wind(ctx(), 2).l.length, 2 * SR);
  // the pitched voices are in tune: zero-crossing rate of a held ney A4 ≈ 440 Hz
  const n = ney(ctx(), 440, 0.8, 1), mid = n.subarray(Math.round(0.4 * SR), Math.round(0.9 * SR));
  let zc = 0; for (let i = 1; i < mid.length; i++) if (mid[i - 1]! < 0 && mid[i]! >= 0) zc++;
  assert.ok(Math.abs(zc / 0.5 - 440) < 25, `ney ${zc / 0.5} Hz`);
  // crest-factor helpers keep the waveform continuous and cap the peaks
  const x = davul(ctx(), 1), before = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  softKnee(x, 6, SR); assert.ok(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < before);
  const st = { l: davul(ctx(), 1), r: davul(ctx(), 1) }; tameStem(st, 0, st.l.length, 6);
  for (let i = 1; i < st.l.length; i++) assert.ok(Math.abs(st.l[i]! - st.l[i - 1]!) < 0.5, 'no step');
});

test('renderer with the new voices (inline): a one-bar loop masters to target with a seamless seam', async () => {
  const score: Score = {
    id: 'storm-test-loop', bpm: 120, beatsPerBar: 4, bars: 1, swing: 0.5, loop: true, tail: 1, reverb: 'room', reverbDb: -6,
    target: { lufs: -15, measure: 'integrated' }, about: 'test',
    tracks: [
      { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -20, send: 0.3, notes: melody('A4:1 Bb4:.5 C#5:.5 D5:2') },
      { id: 'saz', kind: 'pitched', voice: 'baglama', level: -24, send: 0.2, tame: 13, notes: melody('A3:.5 E4:.5 A3:.5 E4:.5 A3:.5 E4:.5 A3:.5 E4:.5') },
      { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -25, send: 0.4, chords: [{ t: 0, d: 4, ns: [45, 52, 57], v: 0.8 }] },
      { id: 'horns', kind: 'pad', voice: 'padHorn', level: -26, send: 0.3, chords: [{ t: 0, d: 4, ns: [45, 52, 57], v: 0.8 }] },
      { id: 'kit', kind: 'kit', level: -22, send: 0.1, tame: 12, hits: [{ t: 0, k: 'davul', v: 1 }, { t: 1, k: 'tek', v: 0.8 }, { t: 2, k: 'dum', v: 0.9 }, { t: 3, k: 'taiko', v: 0.8 }] },
      { id: 'fx', kind: 'fx', level: -28, send: 0.2, fx: [{ t: 0, d: 2, k: 'thunder', v: 0.8 }, { t: 0, d: 4, k: 'rain', v: 1 }] },
    ],
  };
  const a = await renderScore(score, { ...createRenderEnv(SR, 1e9), offline: false });
  assert.equal(a.l.length, 88200);
  assert.ok(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
  assert.ok(Math.abs(a.master.lufs - -15) < 0.5, `lufs ${a.master.lufs}`);
  assert.ok(samplePeakDb([a.l, a.r]) <= -1.6 + 1e-3);
  assert.ok(seam([a.l, a.r], SR).seamRatio < 6);
  assert.ok(loudness([a.l, a.r], SR).integrated > -16);
});

test('frequent effects render with their variations under the ceiling', async () => {
  const defs = STORM_SFX.filter(d => ['click', 'coin', 'land', 'orb'].includes(d.id));
  const clips = await renderSfx(defs, { ...createRenderEnv(SR, 1e9), offline: false });
  for (const d of defs) {
    const list = clips.get(d.id)!;
    assert.equal(list.length, d.variations);
    for (const c of list) { assert.ok(c.l.length > 100); assert.ok(samplePeakDb([c.l, c.r]) <= -1.6 + 1e-3); }
    assert.notDeepEqual(list[0]!.l.slice(0, 500), list[1]!.l.slice(0, 500), `${d.id}: variations differ`);
  }
});
