import { test } from 'node:test';
import assert from 'node:assert/strict';
import { melody, barCount } from '../lib/slot-audio/scores/notation';
import { EBRU_FEATURE_RIFF, EBRU_HOOK, EBRU_SCORES, type EbruScoreId } from '../lib/slot-audio/scores/ebru';
import { STORM_SCORES } from '../lib/slot-audio/scores/storm';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { EBRU_SFX } from '../lib/slot-audio/sfx/ebru';
import { STORM_SFX } from '../lib/slot-audio/sfx/storm';
import { CASCADE_SFX } from '../lib/slot-audio/sfx/cascade';
import { SFX_CATALOGS } from '../lib/slot-audio/render-protocol';
import { createRenderEnv, renderScore, renderSfx, scoreLength, splitTracks } from '../lib/slot-audio/render';
import { samplePeakDb, seam } from '../lib/slot-audio/synth/master';
import { bristles, bubble, bubbles, glassHarp, kanun, kudum, ud, waterBed, waterGlass, zil } from '../lib/slot-audio/synth/ebru';
import {
  COLOUR_SEMITONES, COMB_MAX_SECONDS, COMB_MIN_SECONDS, DROP_STEPS, EBRU_CALLOUT_CLASSES, EBRU_CLASS_VOICE, EBRU_INKS, EBRU_LADDER, EBRU_PLACEHOLDER, EBRU_TIER_VOICE, EBRU_VOICE_LINES,
  bloomSize, combPlan, ebruCalloutClass, ebruVoiceBankUrls, ebruVoiceDecision, loadEbruVoiceBank, stainLevel, stainSemitones,
} from '../lib/slot-audio/ebru-tiers';
import { TIER_KEY } from '../lib/slot-audio/win-tiers';
import { createRng } from '../lib/slot-audio/timing';
import type { Score } from '../lib/slot-audio/scores/types';

const SR = 44100;
const seconds = (id: EbruScoreId) => scoreLength(EBRU_SCORES[id], SR).body / SR;
const endSeconds = (id: EbruScoreId) => ((EBRU_SCORES[id].musicalEnd ?? 0) * 60) / EBRU_SCORES[id].bpm;
const G_MAJOR = new Set([7, 9, 11, 0, 2, 4, 6]);
const G_PENTA = new Set([7, 9, 11, 2, 4]);
/** The engine's integer comb formula (packages/protocol/src/ebru.ts) for the test cases. */
const SIN = Array.from({ length: 64 }, (_, i) => Math.round(1000 * Math.sin((2 * Math.PI * i) / 64)));
const engineShifts = (A: number, p: number, q: number) => Array.from({ length: 7 }, (_, r) => { const x = (A * SIN[(p + r * q) % 64]!) / 1000; return Math.sign(x) * Math.round(Math.abs(x)); });

test('Ebru scores fit their form: whole bars, events inside, own ids, tempos, loop and stinger lengths', () => {
  for (const [key, score] of Object.entries(EBRU_SCORES)) {
    const beats = score.bars * score.beatsPerBar;
    const { body, total } = scoreLength(score, SR);
    assert.ok(total > body, key);
    assert.ok(score.id.startsWith('ebru-'), `${key}: own id namespace`);
    if (!score.loop) assert.ok((score.musicalEnd ?? beats) <= beats, `${key}: musical end inside the score`);
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      assert.ok(times.length > 0, `${key}/${track.id} has events`);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} event at beat ${t} outside 0..${beats}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n + (track.transpose ?? 0) >= 24 && n.n + (track.transpose ?? 0) <= 100, `${key}/${track.id} pitch ${n.n}`);
      if (track.kind === 'pad') for (const c of track.chords) assert.ok(c.ns.every(n => n >= 28 && n <= 90), `${key}/${track.id} pad range`);
    }
  }
  assert.ok(EBRU_SCORES.base.loop && seconds('base') >= 40, `base ${seconds('base')} s`);
  assert.ok(EBRU_SCORES.feature.loop && seconds('feature') >= 32, `feature ${seconds('feature')} s`);
  assert.equal(EBRU_SCORES.idle.bpm, EBRU_SCORES.base.bpm); assert.ok(EBRU_SCORES.idle.loop && EBRU_SCORES.ambience.loop);
  assert.ok(Math.abs(endSeconds('fsIntro') - 3) < 0.2, `intro ${endSeconds('fsIntro')}`);
  assert.ok(endSeconds('retrigger') >= 1 && endSeconds('retrigger') <= 2.5);
  assert.ok(endSeconds('fsOutro') >= 3.5 && endSeconds('fsOutro') <= 4.5);
  assert.ok(Math.abs(endSeconds('totalWin') - 4) < 0.05);
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const) assert.ok(endSeconds(k) >= 3 && endSeconds(k) <= 6, k);
  for (const [key, score] of Object.entries(EBRU_SCORES)) if (key !== 'ambience') assert.ok(score.target.lufs >= -16 && score.target.lufs <= -14, key);
  // ids never collide with the other games
  const ids = new Set(Object.values(EBRU_SCORES).map(s => s.id));
  for (const s of [...Object.values(STORM_SCORES), ...Object.values(CASCADE_SCORES)]) assert.ok(!ids.has(s.id), s.id);
});

test('base theme: A–B–C form, a 4-bar G Rast hook with the drop-and-ripple, the makam colours per section', () => {
  assert.equal(barCount(EBRU_HOOK), 4);
  const hook = melody(EBRU_HOOK);
  assert.ok(hook.every(n => G_MAJOR.has(n.n % 12)), 'the hook stays in G Rast');
  assert.equal(hook[hook.length - 1]!.n % 12, 7, 'it cadences on G');
  // the signature: a held high note, then a four-note 16th ripple around it
  assert.ok(hook[0]!.d >= 1 && hook.slice(1, 5).every(n => n.d === 0.25) && hook[1]!.n < hook[0]!.n, 'drop and ripple');
  const base = EBRU_SCORES.base;
  const voices = new Set(base.tracks.flatMap(t => ('voice' in t ? [t.voice] : t.kind === 'kit' ? t.hits.map(h => h.k) : t.fx.map(f => f.k))));
  for (const v of ['kanun', 'kanunSoft', 'ud', 'ney', 'glassHarp', 'waterGlass', 'padChoir', 'kudumDum', 'kudumTek', 'frame', 'zil', 'bubbles']) assert.ok(voices.has(v as never), v);
  const span = (id: string) => { const t = base.tracks.find(x => x.id === id); assert.ok(t && t.kind === 'pitched'); return t.notes; };
  // A: kanun bars 1–8 (+ the pickup run in bar 18); B: ud melody bars 9–14 with the Uşşak Bb; C: ney with the Hüzzam Eb–F#
  const kanunNotes = span('kanun');
  assert.ok(kanunNotes.filter(n => n.t < 68).every(n => n.t < 32));
  const udNotes = span('ud');
  assert.ok(udNotes.every(n => n.t >= 32 && n.t < 56) && udNotes.some(n => n.n % 12 === 10), 'ud in B with Bb');
  const neyC = span('ney').filter(n => n.t >= 56);
  assert.ok(neyC.some(n => n.n % 12 === 3) && neyC.some(n => n.n % 12 === 6), 'Eb and F# in C');
  // answer uses the descending acem F and the ascending F#
  assert.ok(kanunNotes.some(n => n.n % 12 === 5) && kanunNotes.some(n => n.n % 12 === 6));
  // feature in D Rast: riff in D major (C natural allowed as the descending acem)
  assert.equal(barCount(EBRU_FEATURE_RIFF), 8);
  assert.ok(melody(EBRU_FEATURE_RIFF).every(n => new Set([2, 4, 6, 7, 9, 11, 1, 0]).has(n.n % 12)));
});

test('celebrations: the shared key ladder from G, layers added per tier, one 120 BPM grid', () => {
  const tonicPc = (id: EbruScoreId) => { const bass = EBRU_SCORES[id].tracks.find(t => t.id === 'bass'); assert.ok(bass && bass.kind === 'pitched'); return bass.notes[bass.notes.length - 1]!.n % 12; };
  assert.deepEqual((['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const).map(tonicPc), [1, 2, 3, 4, 'max'].map(t => (7 + TIER_KEY[t as 1]) % 12));
  const beds = (['bed1', 'bed2', 'bed3', 'bed4', 'bedMax'] as const).map(id => EBRU_SCORES[id]);
  for (let i = 1; i < beds.length; i++) {
    const prev = new Set(beds[i - 1]!.tracks.map(t => t.id)), next = new Set(beds[i]!.tracks.map(t => t.id));
    assert.ok([...prev].every(id => next.has(id)) && next.size > prev.size, `${beds[i]!.id} keeps every layer and adds more`);
  }
  for (const b of beds) { assert.equal(b.bpm, 120); assert.equal(b.bars, 4); assert.ok(b.loop); }
  for (const id of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(EBRU_SCORES[id].bpm, 120);
  assert.ok(EBRU_SCORES.maxWin.tracks.length >= EBRU_SCORES.bigWin4.tracks.length);
  for (const id of ['tier-up-2', 'tier-up-3', 'tier-up-4', 'tier-up-max', 'count-land-1', 'count-land-2', 'count-land-3', 'count-land-4', 'count-land-max']) assert.ok(EBRU_SFX.some(d => d.id === id), id);
  for (const score of Object.values(EBRU_SCORES)) for (const bins of [1, 2, 3, 4]) assert.deepEqual(splitTracks(score, bins).flat().sort(), score.tracks.map(t => t.id).sort());
});

test('effects: every Ebru event exists, unique ids, variation rules, the comb layers in the core, own catalog', () => {
  const ids = EBRU_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const required = ['spin', 'drop', 'tick', 'win', 'bloom-s', 'bloom-m', 'bloom-l', 'bleed', 'fall', 'stain', 'coin', 'click', 'bet-up', 'bet-down', 'denied', 'ding',
    'comb-glide', 'comb-pluck', 'comb-bristle', 'comb-win', 'comb-settle', 'scatter1', 'scatter2', 'scatter3', 'scatter4', 'scatter5', 'scatter6', 'tease', 'trigger', 'auto-on', 'auto-off',
    'vo-sigh', 'vo-bloom', 'vo-joy', ...EBRU_CALLOUT_CLASSES.map(c => `callout-${c}`)];
  for (const id of required) assert.ok(ids.includes(id), id);
  for (const d of EBRU_SFX) {
    if (d.late) assert.ok(d.variations >= 1 && d.variations <= 2, d.id);
    else assert.ok(d.variations >= 3 && d.variations <= 4, `${d.id}: frequent effects have 3–4 variations`);
  }
  const core = EBRU_SFX.filter(d => d.core).map(d => d.id);
  for (const id of ['spin', 'drop', 'bloom-s', 'bleed', 'stain', 'fall', 'comb-glide', 'comb-pluck', 'comb-bristle', 'comb-win', 'comb-settle', 'click', 'coin']) assert.ok(core.includes(id), id);
  assert.ok(!EBRU_SFX.some(d => d.core && d.late));
  assert.equal(SFX_CATALOGS.ebru, EBRU_SFX); assert.equal(SFX_CATALOGS.storm, STORM_SFX); assert.equal(SFX_CATALOGS.cascade, CASCADE_SFX);
  for (const line of EBRU_VOICE_LINES) { const p = EBRU_PLACEHOLDER[line]; if (p) assert.ok(ids.includes(p), p); }
});

test('callouts grow with the class: six classes (<10, ≥10, ≥25, ≥50, ≥100, ≥250), each longer than the one below', () => {
  const cases: [number, string][] = [[2, 'x2'], [9.99, 'x2'], [10, 'x10'], [25, 'x25'], [64, 'x50'], [128, 'x100'], [256, 'x250'], [12544, 'x250'], [Number.NaN, 'x2']];
  for (const [v, c] of cases) assert.equal(ebruCalloutClass(v), c, `${v}×`);
  const lengths = EBRU_CALLOUT_CLASSES.map(c => {
    const st = EBRU_SFX.find(d => d.id === `callout-${c}`)!.build({ sr: 22050, rng: createRng(1) }, 0);
    let peak = 0; for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    let end = st.l.length; while (end > 0 && Math.abs(st.l[end - 1]!) < peak * 1e-3 && Math.abs(st.r[end - 1]!) < peak * 1e-3) end--;
    return end / 22050;
  });
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! > lengths[i - 1]!, `${EBRU_CALLOUT_CLASSES[i]} ${lengths[i]!.toFixed(2)} s > ${lengths[i - 1]!.toFixed(2)} s`);
  for (const c of EBRU_CALLOUT_CLASSES) assert.ok(EBRU_VOICE_LINES.includes(EBRU_CLASS_VOICE[c]));
  for (const t of [1, 2, 3, 4, 'max'] as const) assert.ok(EBRU_VOICE_LINES.includes(EBRU_TIER_VOICE[t]));
});

test('comb plan: the pitch contour follows the row shifts on the G pentatonic, sine-shaped between rows, clamped', () => {
  const shifts = engineShifts(3, 0, 10);
  const plan = combPlan(shifts, 1400, 1);
  assert.equal(plan.seconds, 1.4); assert.equal(plan.rows.length, 7); assert.equal(plan.amplitude, 3);
  // every row at its own time, in order, its pitch a ladder step that rises with the shift
  for (let r = 0; r < 7; r++) { assert.ok(Math.abs(plan.rows[r]!.at - (1.4 * (r + 0.5)) / 7) < 1e-9); assert.ok(G_PENTA.has(((7 + plan.rows[r]!.semitones) % 12 + 12) % 12)); }
  for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) if (plan.rows[a]!.shift > plan.rows[b]!.shift) assert.ok(plan.rows[a]!.semitones > plan.rows[b]!.semitones);
  // the rate curve passes through each row's rate and never leaves the rows' range (raised-cosine interpolation)
  const rates = plan.rows.map(r => r.rate), lo = Math.min(...rates), hi = Math.max(...rates);
  assert.ok(plan.rate.every(v => v >= lo - 1e-6 && v <= hi + 1e-6));
  for (const row of plan.rows) { const i = Math.round((row.at / plan.seconds) * (plan.rate.length - 1)); assert.ok(Math.abs(Math.log2(plan.rate[i]! / row.rate)) < 0.12, `row ${row.row}`); }
  // pan follows the shift direction; bigger shifts move more water
  for (const row of plan.rows) { assert.equal(Math.sign(row.pan), Math.sign(row.shift)); assert.ok(row.level >= 0.55 && row.level <= 1); }
  // later passes sit higher; a flat comb (all zero) is one held pitch; junk input is clamped
  const p3 = combPlan(shifts, 1400, 3);
  for (let r = 0; r < 7; r++) assert.ok(p3.rows[r]!.semitones > plan.rows[r]!.semitones);
  assert.ok(combPlan([0, 0, 0, 0, 0, 0, 0], 800).rate.every(v => v === 1));
  const junk = combPlan([9, -9, Number.NaN] as number[], -5, 7);
  assert.equal(junk.seconds, COMB_MIN_SECONDS); assert.equal(junk.pass, 3); assert.deepEqual(junk.rows.map(r => r.shift), [3, -3, 0, 0, 0, 0, 0]);
  assert.equal(combPlan(shifts, 1e6).seconds, COMB_MAX_SECONDS);
  // the rate range stays within an octave either way (the glide clip is long enough for any sweep)
  for (const A of [1, 2, 3]) for (const q of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]) for (const pass of [1, 2, 3]) {
    const p = combPlan(engineShifts(A, 13, q), 3000, pass);
    assert.ok(p.rate.every(v => v >= 0.5 && v <= 2.01));
    assert.ok(p.rate.reduce((s, v) => s + v, 0) / p.rate.length * p.seconds < 6.2, 'glide clip covers the sweep');
  }
});

test('pitch maps: colours, stains and drops stay on the ladder and are ordered', () => {
  const colours = EBRU_INKS.map(c => COLOUR_SEMITONES[c]);
  assert.equal(new Set(colours).size, 8);
  for (let i = 1; i < 8; i++) assert.ok(colours[i]! < colours[i - 1]!, 'c1 highest');
  for (const s of [...colours, ...DROP_STEPS]) assert.ok(EBRU_LADDER.includes(s), `${s} on the ladder`);
  const stains = [2, 4, 8, 16, 32, 64, 128, 256].map(stainSemitones);
  for (let i = 1; i < stains.length; i++) assert.ok(stains[i]! > stains[i - 1]!, 'stain ping rises');
  assert.equal(stainSemitones(0), 0); assert.equal(stainSemitones(1e9), stains[7]); assert.equal(stainLevel(2), 0); assert.equal(stainLevel(256), 1);
  assert.equal(bloomSize(5), 's'); assert.equal(bloomSize(8), 'm'); assert.equal(bloomSize(12), 'l'); assert.equal(bloomSize(Number.NaN), 's');
});

test('voice bank: 18 lines, folder and per-line urls, silent failures, one voice at a time', async () => {
  assert.equal(EBRU_VOICE_LINES.length, 18);
  const urls = ebruVoiceBankUrls('/audio/voice/ebru/');
  assert.equal(urls['x2-9'], '/audio/voice/ebru/x2-9.mp3'); assert.equal(urls.comb, '/audio/voice/ebru/comb.mp3');
  assert.equal(ebruVoiceBankUrls({ x100: '/v/a.ogg', x50: ' ' }).x50, null);
  const bank = await loadEbruVoiceBank(urls, async url => { if (url.endsWith('x10.mp3')) throw new Error('net'); return url.endsWith('x100.mp3') ? { url } : null; });
  assert.equal(bank.size, 18); assert.equal(bank.get('x10'), null); assert.deepEqual(bank.get('x100'), { url: '/audio/voice/ebru/x100.mp3' });
  assert.equal(ebruVoiceDecision(null, 'nice', 1), 'play');
  assert.equal(ebruVoiceDecision({ line: 'nice', until: 3 }, 'win-max', 1), 'replace');
  assert.equal(ebruVoiceDecision({ line: 'win-max', until: 3 }, 'x10', 1), 'skip');
});

test('Ebru voices: finite, audible, bounded, deterministic, in tune', () => {
  const ctx = () => ({ sr: SR, rng: createRng(7) });
  const mono: [string, (c: ReturnType<typeof ctx>) => Float32Array][] = [
    ['kanun', c => kanun(c, 392, 0.8, 0.3)], ['ud', c => ud(c, 98, 0.8, 0.4)], ['glassHarp', c => glassHarp(c, 784, 0.8, 0.5)], ['waterGlass', c => waterGlass(c, 784, 0.8)],
    ['kudumDum', c => kudum(c, 1, 'dum')], ['kudumTek', c => kudum(c, 1, 'tek')], ['zil', c => zil(c, 0.8)], ['bubble', c => bubble(c, 900, 0.8)],
  ];
  for (const [name, make] of mono) {
    const a = make(ctx()), b = make(ctx());
    assert.ok(a.length > 100 && a.every(Number.isFinite), name);
    const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01 && peak < 4, `${name} peak ${peak}`);
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), `${name} deterministic`);
  }
  for (const [name, st] of [['bubbles', bubbles(ctx(), 1, 20, 0.8)], ['waterBed', waterBed(ctx(), 2)], ['bristles', bristles(ctx(), 1.5, 0.8)]] as const) {
    assert.ok(st.l.every(Number.isFinite) && st.r.every(Number.isFinite) && st.l.some(v => Math.abs(v) > 1e-3), name);
  }
  assert.equal(waterBed(ctx(), 2).l.length, 2 * SR);
  // glass harmonica G5 ≈ 784 Hz by zero crossings; kanun G4 ≈ 392 Hz
  const zc = (x: Float32Array, a: number, b: number) => { const m = x.subarray(Math.round(a * SR), Math.round(b * SR)); let n = 0; for (let i = 1; i < m.length; i++) if (m[i - 1]! < 0 && m[i]! >= 0) n++; return n / (b - a); };
  assert.ok(Math.abs(zc(glassHarp(ctx(), 784, 0.8, 1), 0.3, 0.8) - 784) < 20);
  // the bright kanun is measured by autocorrelation (its zero crossings count the upper partials too)
  const k = kanun(ctx(), 392, 0.8, 0.8).subarray(Math.round(0.2 * SR));
  let best = 0, lag = 0;
  for (let L = 40; L < 400; L++) { let s = 0; for (let i = 0; i < 8000; i++) s += k[i]! * k[i + L]!; if (s > best) { best = s; lag = L; } }
  assert.ok(Math.abs(SR / lag - 392) < 6, `kanun ${SR / lag} Hz`);
});

test('renderer with the Ebru voices (inline): a one-bar loop masters to target with a seamless seam', async () => {
  const score: Score = {
    id: 'ebru-test-loop', bpm: 120, beatsPerBar: 4, bars: 1, swing: 0.5, loop: true, tail: 1, reverb: 'room', reverbDb: -6,
    target: { lufs: -15, measure: 'integrated' }, about: 'test',
    tracks: [
      { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.3, tame: 13, notes: melody('B5:1 A5:.25 B5:.25 A5:.25 G5:.25 E5:1 D5:1') },
      { id: 'ud', kind: 'pitched', voice: 'ud', level: -24, send: 0.2, notes: melody('G2:1 D3:1 G2:1 D3:1') },
      { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -26, send: 0.4, notes: [{ t: 0, d: 4, n: 67, v: 0.7 }, { t: 0, d: 4, n: 71, v: 0.7 }] },
      { id: 'bell', kind: 'pitched', voice: 'waterGlass', level: -27, send: 0.4, notes: [{ t: 0, d: 1, n: 83, v: 0.8 }] },
      { id: 'kit', kind: 'kit', level: -22, send: 0.1, tame: 12, hits: [{ t: 0, k: 'kudumDum', v: 1 }, { t: 2, k: 'kudumTek', v: 0.8 }, { t: 3, k: 'zil', v: 0.6 }, { t: 1, k: 'frameLo', v: 0.8 }] },
      { id: 'fx', kind: 'fx', level: -28, send: 0.2, fx: [{ t: 0, d: 2, k: 'bubbles', v: 0.8, density: 12 }, { t: 0, d: 4, k: 'water', v: 1 }] },
    ],
  };
  const a = await renderScore(score, { ...createRenderEnv(SR, 1e9), offline: false });
  assert.equal(a.l.length, 88200);
  assert.ok(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
  assert.ok(Math.abs(a.master.lufs - -15) < 0.5, `lufs ${a.master.lufs}`);
  assert.ok(samplePeakDb([a.l, a.r]) <= -1.6 + 1e-3);
  assert.ok(seam([a.l, a.r], SR).seamRatio < 6);
});

test('comb layers and frequent effects render with their variations under the ceiling', async () => {
  const defs = EBRU_SFX.filter(d => ['comb-glide', 'comb-pluck', 'drop', 'stain'].includes(d.id));
  const clips = await renderSfx(defs, { ...createRenderEnv(SR, 1e9), offline: false });
  for (const d of defs) {
    const list = clips.get(d.id)!;
    assert.equal(list.length, d.variations);
    for (const c of list) { assert.ok(c.l.length > 100); assert.ok(samplePeakDb([c.l, c.r]) <= -1.6 + 1e-3); }
    assert.notDeepEqual(list[0]!.l.slice(0, 500), list[1]!.l.slice(0, 500), `${d.id}: variations differ`);
  }
  // the glide is long enough for the longest sweep at the highest pitch it is asked for
  for (const c of clips.get('comb-glide')!) assert.ok(c.l.length / SR > 6, `glide ${c.l.length / SR} s`);
});
