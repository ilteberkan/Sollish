import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASENA_TEMPLATES } from '@sollish/protocol';
import { asenaConstellationPlan } from '../components/asena/geometry';
import { melody, barCount } from '../lib/slot-audio/scores/notation';
import { ASENA_FEATURE_RIFF, ASENA_HOOK, BASE_ANSWER, ASENA_SCORES, m8, steps12, type AsenaScoreId } from '../lib/slot-audio/scores/asena';
import { EBRU_SCORES } from '../lib/slot-audio/scores/ebru';
import { STORM_SCORES } from '../lib/slot-audio/scores/storm';
import { CASCADE_SCORES } from '../lib/slot-audio/scores/cascade';
import { CEZERI_SCORES } from '../lib/slot-audio/scores/cezeri';
import { ASENA_SFX } from '../lib/slot-audio/sfx/asena';
import { SFX_CATALOGS } from '../lib/slot-audio/render-protocol';
import { createRenderEnv, renderScore, renderSfx, scoreLength, splitTracks } from '../lib/slot-audio/render';
import { samplePeakDb, seam } from '../lib/slot-audio/synth/master';
import { KHOOMEI_HARMONICS, auroraChord, fireCrackle, hoof, ironCrack, kamDavul, khoomeiFast, kilKopuzFast, kopuz, paw, skyHowl, starBell, steppeNight } from '../lib/slot-audio/synth/asena';
import {
  ASENA_CALLOUT_CLASSES, ASENA_CLASS_VOICE, ASENA_LADDER, ASENA_MOTIFS, ASENA_PLACEHOLDER, ASENA_SYMBOL_IDS, ASENA_TEMPLATE_ORDER, ASENA_TEMPLATE_VOICE, ASENA_TIER_VOICE, ASENA_VOICE_LINES, ASENA_VOICE_TEXT,
  COLUMN_STEPS, DEFAULT_GROUPS, SYMBOL_SEMITONES, asenaCalloutClass, asenaVoiceBankUrls, asenaVoiceDecision, burstSize, constellationTrace, loadAsenaVoiceBank, mountainLevel, nodeClipFor, pawTimes, pieceSemitones,
} from '../lib/slot-audio/asena-tiers';
import { TIER_KEY } from '../lib/slot-audio/win-tiers';
import { createRng } from '../lib/slot-audio/timing';
import type { Score } from '../lib/slot-audio/scores/types';

const SR = 44100;
const seconds = (id: AsenaScoreId) => scoreLength(ASENA_SCORES[id], SR).body / SR;
const endSeconds = (id: AsenaScoreId) => ((ASENA_SCORES[id].musicalEnd ?? 0) * 60) / ASENA_SCORES[id].bpm;
const E_HUSEYNI = new Set([4, 6, 7, 9, 11, 1, 2]);
const B_KURDI = new Set([11, 0, 2, 4, 6, 7, 9]);
const E_PENTA = new Set([4, 7, 9, 11, 2]);
const pcOfSemi = (s: number) => (((4 + s) % 12) + 12) % 12;

test('Asena scores fit their form: whole bars, events inside, own ids, tempos, loop and stinger lengths', () => {
  for (const [key, score] of Object.entries(ASENA_SCORES)) {
    const beats = score.bars * score.beatsPerBar;
    const { body, total } = scoreLength(score, SR);
    assert.ok(total > body, key);
    assert.ok(score.id.startsWith('asena-'), `${key}: own id namespace`);
    if (!score.loop) assert.ok((score.musicalEnd ?? beats) <= beats, `${key}: musical end inside the score`);
    for (const track of score.tracks) {
      const times = track.kind === 'pitched' ? track.notes.map(n => n.t) : track.kind === 'pad' ? track.chords.map(c => c.t) : track.kind === 'kit' ? track.hits.map(h => h.t) : track.fx.map(f => f.t);
      assert.ok(times.length > 0, `${key}/${track.id} has events`);
      for (const t of times) assert.ok(t >= 0 && t < beats, `${key}/${track.id} event at beat ${t} outside 0..${beats}`);
      if (track.kind === 'pitched') for (const n of track.notes) assert.ok(n.n + (track.transpose ?? 0) >= 24 && n.n + (track.transpose ?? 0) <= 100, `${key}/${track.id} pitch ${n.n}`);
      if (track.kind === 'pad') for (const c of track.chords) assert.ok(c.ns.every(n => n >= 28 && n <= 90), `${key}/${track.id} pad range`);
    }
  }
  assert.ok(ASENA_SCORES.base.loop && seconds('base') >= 40, `base ${seconds('base')} s`);
  assert.ok(ASENA_SCORES.feature.loop && seconds('feature') >= 32, `feature ${seconds('feature')} s`);
  assert.equal(ASENA_SCORES.idle.bpm, ASENA_SCORES.base.bpm); assert.ok(ASENA_SCORES.idle.loop && ASENA_SCORES.ambience.loop);
  assert.ok(Math.abs(endSeconds('fsIntro') - 3) < 0.2, `intro ${endSeconds('fsIntro')}`);
  assert.ok(endSeconds('retrigger') >= 1 && endSeconds('retrigger') <= 2.5);
  assert.ok(endSeconds('fsOutro') >= 3.5 && endSeconds('fsOutro') <= 4.5);
  assert.ok(Math.abs(endSeconds('totalWin') - 4) < 0.05);
  for (const k of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin'] as const) assert.ok(endSeconds(k) >= 3 && endSeconds(k) <= 6, k);
  for (const [key, score] of Object.entries(ASENA_SCORES)) if (key !== 'ambience') assert.ok(score.target.lufs >= -16 && score.target.lufs <= -14, key);
  const ids = new Set(Object.values(ASENA_SCORES).map(s => s.id));
  for (const s of [...Object.values(STORM_SCORES), ...Object.values(CASCADE_SCORES), ...Object.values(EBRU_SCORES), ...Object.values(CEZERI_SCORES)]) assert.ok(!ids.has(s.id), s.id);
});

test('base theme: E Hüseyni, the Asena call hook = the Kurt Başı motif, C# in the answer, the Kürdi C shadow in B, the throat drone', () => {
  assert.equal(barCount(ASENA_HOOK), 4);
  const hook = melody(ASENA_HOOK);
  assert.ok(hook.every(n => E_HUSEYNI.has(n.n % 12)), 'the hook stays in E Hüseyni');
  assert.equal(hook[hook.length - 1]!.n % 12, 4, 'it cadences on E');
  // the signature: four stars rising E–G–B–D to a held E — the same intervals the Kurt Başı constellation traces
  const call = hook.slice(0, 5).map(n => n.n - hook[0]!.n);
  assert.deepEqual(call, ASENA_MOTIFS['kurt-basi'].map(s => s - ASENA_MOTIFS['kurt-basi'][0]!));
  assert.ok(hook[4]!.d >= 2, 'the call lands on a held E');
  // the Hüseyni fall G–F#–E closes the hook
  assert.deepEqual(hook.slice(-3).map(n => n.n % 12), [6, 7, 4]);
  assert.ok(melody(BASE_ANSWER).some(n => n.n % 12 === 1), 'answer has the natural sixth C#');
  const base = ASENA_SCORES.base;
  const voices = new Set(base.tracks.flatMap(t => ('voice' in t ? [t.voice] : t.kind === 'kit' ? t.hits.map(h => h.k) : t.fx.map(f => f.k))));
  for (const v of ['kopuz', 'kilKopuz', 'khoomei', 'kargyraa', 'starBell', 'ney', 'padAurora', 'padChoir', 'kamDum', 'kamTek', 'kamJingle']) assert.ok(voices.has(v as never), v);
  const ney = base.tracks.find(t => t.id === 'ney'); assert.ok(ney && ney.kind === 'pitched');
  assert.ok(ney.notes.some(n => n.n % 12 === 0) && ney.notes.some(n => n.n % 12 === 1), 'B section: C# and the C natural shadow');
  const drone = base.tracks.find(t => t.id === 'drone'); assert.ok(drone && drone.kind === 'pitched');
  assert.ok(drone.notes.every(n => n.n === 40), 'drone on E2');
});

test('feature "Ergenekon": 12/8 gallop, B Kürdi riff, the sky opens to E Hüseyni', () => {
  assert.equal(barCount(ASENA_FEATURE_RIFF), 8);
  const riff = m8(ASENA_FEATURE_RIFF);
  assert.ok(riff.every(n => B_KURDI.has(n.n % 12)), 'riff in B Kürdi');
  assert.ok(riff.some(n => n.n % 12 === 0), 'the Kürdi C');
  assert.equal(riff[riff.length - 1]!.n % 12, 11, 'C → B cadence');
  assert.ok(Math.abs(riff[riff.length - 1]!.t + riff[riff.length - 1]!.d - 32) < 1e-9, 'eight 12/8 bars = 32 beats');
  const f = ASENA_SCORES.feature;
  const ney = f.tracks.find(t => t.id === 'ney'); assert.ok(ney && ney.kind === 'pitched');
  assert.ok(ney.notes.every(n => n.t >= 32) && ney.notes.some(n => n.n % 12 === 1), 'B section with C#');
  const kit = f.tracks.find(t => t.id === 'kit'); assert.ok(kit && kit.kind === 'kit');
  const hoofs = kit.hits.filter(h => h.k === 'hoof');
  assert.equal(hoofs.length, 16 * 12, 'a hoofbeat on every eighth of 16 bars');
  for (const h of hoofs) assert.ok(Math.abs(h.t * 3 - Math.round(h.t * 3)) < 1e-9, 'gallop on the triplet grid');
  assert.ok(hoofs.filter((_, i) => i % 3 === 2).every(h => h.v > hoofs[0]!.v), 'the third stroke of each beat is the accent');
  assert.throws(() => steps12('hoof', 'x.x', 0));
});

test('celebrations: the shared key ladder from E, layers added per tier, one 120 BPM grid', () => {
  const tonicPc = (id: AsenaScoreId) => { const bass = ASENA_SCORES[id].tracks.find(t => t.id === 'bass'); assert.ok(bass && bass.kind === 'pitched'); return bass.notes[bass.notes.length - 1]!.n % 12; };
  assert.deepEqual((['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const).map(tonicPc), [1, 2, 3, 4, 'max', 1].map(t => (4 + TIER_KEY[t as 1]) % 12));
  const beds = (['bed1', 'bed2', 'bed3', 'bed4', 'bedMax'] as const).map(id => ASENA_SCORES[id]);
  for (let i = 1; i < beds.length; i++) {
    const prev = new Set(beds[i - 1]!.tracks.map(t => t.id)), next = new Set(beds[i]!.tracks.map(t => t.id));
    assert.ok([...prev].every(id => next.has(id)) && next.size > prev.size, `${beds[i]!.id} keeps every layer and adds more`);
  }
  for (const b of beds) { assert.equal(b.bpm, 120); assert.equal(b.bars, 4); assert.ok(b.loop); }
  for (const id of ['bigWin1', 'bigWin2', 'bigWin3', 'bigWin4', 'maxWin', 'totalWin'] as const) assert.equal(ASENA_SCORES[id].bpm, 120);
  for (const id of ['tier-up-2', 'tier-up-3', 'tier-up-4', 'tier-up-max', 'count-land-1', 'count-land-2', 'count-land-3', 'count-land-4', 'count-land-max']) assert.ok(ASENA_SFX.some(d => d.id === id), id);
  for (const score of Object.values(ASENA_SCORES)) for (const bins of [1, 2, 3, 4]) assert.deepEqual(splitTracks(score, bins).flat().sort(), score.tracks.map(t => t.id).sort());
});

test('effects: every Asena event exists, unique ids, variation rules, constellation layers and howl in the core, own catalog', () => {
  const ids = ASENA_SFX.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const required = ['spin', 'land', 'tick', 'win', 'burst-s', 'burst-m', 'burst-l', 'fall', 'node-lo', 'node', 'node-hi', ...ASENA_TEMPLATE_ORDER.map(t => `ignite-${t}`), 'howl', 'howl-great', 'paw', 'trail',
    'coin', 'click', 'bet-up', 'bet-down', 'ding', 'moon1', 'moon2', 'moon3', 'moon4', 'moon5', 'moon6', 'tease', 'trigger', 'piece', 'mount-1', 'mount-2', 'mount-3', 'spins-plus', 'denied', 'auto-on', 'auto-off',
    'vo-breath', 'vo-call', 'vo-joy', ...ASENA_CALLOUT_CLASSES.map(c => `callout-${c}`)];
  for (const id of required) assert.ok(ids.includes(id), id);
  for (const d of ASENA_SFX) {
    if (d.late) assert.ok(d.variations >= 1 && d.variations <= 2, d.id);
    else if (d.id.startsWith('ignite-') || d.id.startsWith('mount-') || d.id === 'howl-great') assert.equal(d.variations, 2, d.id);
    else assert.ok(d.variations >= 3 && d.variations <= 4, `${d.id}: frequent effects have 3–4 variations`);
  }
  const core = ASENA_SFX.filter(d => d.core).map(d => d.id);
  for (const id of ['spin', 'land', 'burst-s', 'burst-m', 'fall', 'node-lo', 'node', 'node-hi', 'howl', 'paw', 'trail', 'click', 'coin', ...ASENA_TEMPLATE_ORDER.map(t => `ignite-${t}`)]) assert.ok(core.includes(id), id);
  assert.ok(!ASENA_SFX.some(d => d.core && d.late));
  assert.equal(SFX_CATALOGS.asena, ASENA_SFX);
  for (const line of ASENA_VOICE_LINES) { const p = ASENA_PLACEHOLDER[line]; if (p) assert.ok(ids.includes(p), p); }
});

test('callouts grow with the class: six classes, each longer than the one below', () => {
  const cases: [number, string][] = [[2, 'x2'], [9.99, 'x2'], [10, 'x10'], [25, 'x25'], [64, 'x50'], [128, 'x100'], [256, 'x250'], [Number.NaN, 'x2']];
  for (const [v, c] of cases) assert.equal(asenaCalloutClass(v), c, `${v}×`);
  const lengths = ASENA_CALLOUT_CLASSES.map(c => {
    const st = ASENA_SFX.find(d => d.id === `callout-${c}`)!.build({ sr: 22050, rng: createRng(1) }, 0);
    let peak = 0; for (let i = 0; i < st.l.length; i++) peak = Math.max(peak, Math.abs(st.l[i]!), Math.abs(st.r[i]!));
    let end = st.l.length; while (end > 0 && Math.abs(st.l[end - 1]!) < peak * 1e-3 && Math.abs(st.r[end - 1]!) < peak * 1e-3) end--;
    return end / 22050;
  });
  for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! > lengths[i - 1]!, `${ASENA_CALLOUT_CLASSES[i]} ${lengths[i]!.toFixed(2)} s > ${lengths[i - 1]!.toFixed(2)} s`);
  for (const c of ASENA_CALLOUT_CLASSES) assert.ok(ASENA_VOICE_LINES.includes(ASENA_CLASS_VOICE[c]));
  for (const t of [1, 2, 3, 4, 'max'] as const) assert.ok(ASENA_VOICE_LINES.includes(ASENA_TIER_VOICE[t]));
});

test('constellation trace follows the real art plan: one rising motif note per lighting event, chords for nodes that light together', () => {
  assert.deepEqual([...ASENA_TEMPLATE_ORDER], ASENA_TEMPLATES.map(t => t.id), 'template order = engine index order');
  const contours = new Set<string>();
  for (const t of ASENA_TEMPLATES) {
    const motif = ASENA_MOTIFS[t.id];
    for (let k = 1; k < motif.length; k++) assert.ok(motif[k]! > motif[k - 1]!, `${t.id} motif rises`);
    for (const s of motif) assert.ok(E_PENTA.has(pcOfSemi(s)), `${t.id} motif on the E pentatonic`);
    contours.add(motif.slice(1).map((s, k) => s - motif[k]!).join(','));
    for (let transform = 0; transform < 8; transform++) {
      const plan = asenaConstellationPlan({ templateId: t.id, transform, origin: [0, 0] }, 1400);
      const tr = constellationTrace(t.id, plan.nodeAt, plan.duration, plan.nodes.map(n => n[0]));
      assert.deepEqual(tr.events.map(e => e.notes.length), [...DEFAULT_GROUPS[t.id]], `${t.id} t${transform}: lighting groups`);
      assert.equal(tr.events.reduce((s, e) => s + e.notes.length, 0), t.cells.length, 'every node sounds once');
      assert.deepEqual(tr.events.map(e => e.notes[0]!.semitones), motif.slice(0, tr.events.length), `${t.id}: lead = motif`);
      for (const e of tr.events) {
        assert.ok(Math.abs(e.at * 1000 - Math.min(...e.notes.map(n => plan.nodeAt[n.node]!))) < 1e-6, 'event at its node time');
        for (const n of e.notes) {
          assert.ok(E_PENTA.has(pcOfSemi(n.semitones)), 'every star on the ladder');
          const clip = { 'node-lo': -12, node: 0, 'node-hi': 12 }[n.clip];
          assert.ok(Math.abs(n.semitones - clip) <= 6 && Math.abs(2 ** ((n.semitones - clip) / 12) - n.rate) < 1e-9, 'nearest clip, at most half an octave');
          assert.ok(n.pan >= -1 && n.pan <= 1 && n.gain > 0 && n.gain <= 1);
        }
        e.notes.slice(1).forEach(n => assert.ok(n.semitones < e.notes[0]!.semitones, 'harmony below the lead'));
      }
      assert.ok(Math.abs(tr.igniteAt - 1.4) < 1e-9 && tr.howlAt > tr.igniteAt);
    }
  }
  assert.equal(contours.size, 6, 'six distinct motif contours');
  // no plan times: the default groups spread over the duration
  const d = constellationTrace('kartal', null, 2000);
  assert.deepEqual(d.events.map(e => e.notes.length), [...DEFAULT_GROUPS.kartal]);
  assert.ok(Math.abs(d.events[d.events.length - 1]!.at - 2) < 1e-9);
  // junk input is cleaned
  const j = constellationTrace('nope', [Number.NaN, -5, 1e9], Number.NaN);
  assert.equal(j.templateId, 'hilal'); assert.ok(j.events.every(e => e.at >= 0 && e.at <= j.seconds));
  assert.deepEqual(nodeClipFor(19), { clip: 'node-hi', rate: 2 ** (7 / 12) });
  for (const t of ASENA_TEMPLATE_ORDER) assert.ok(ASENA_VOICE_LINES.includes(ASENA_TEMPLATE_VOICE[t]));
});

test('pitch maps: symbols, columns, pieces stay on the ladder and are ordered; paw times and mountain levels', () => {
  const sym = ASENA_SYMBOL_IDS.map(s => SYMBOL_SEMITONES[s]);
  assert.equal(new Set(sym).size, 8);
  for (let i = 1; i < 8; i++) assert.ok(sym[i]! < sym[i - 1]!, 'h1 highest');
  for (const s of [...sym, ...COLUMN_STEPS, ...[0, 1, 2, 3, 4, 5].flatMap(t => [pieceSemitones(t, 1), pieceSemitones(t, 2)])]) assert.ok(ASENA_LADDER.includes(s), `${s} on the ladder`);
  for (let i = 1; i < COLUMN_STEPS.length; i++) assert.ok(COLUMN_STEPS[i]! > COLUMN_STEPS[i - 1]!);
  assert.equal(new Set([0, 1, 2, 3, 4, 5].map(t => pieceSemitones(t))).size, 6);
  for (const t of [0, 1, 2, 3, 4, 5]) assert.ok(pieceSemitones(t, 2) > pieceSemitones(t, 1) && pieceSemitones(t, 2) <= 12);
  const p = pawTimes(640); assert.equal(p.length, 4); assert.ok(p.every((x, i) => x > 0 && x < 0.64 && (i === 0 || x > p[i - 1]!)));
  assert.deepEqual([1, 2, 3, 4, 5, 9, Number.NaN].map(mountainLevel), [0, 1, 2, 2, 3, 3, 0]);
  assert.equal(burstSize(5), 's'); assert.equal(burstSize(8), 'm'); assert.equal(burstSize(12), 'l'); assert.equal(burstSize(Number.NaN), 's');
});

test('voice bank: 29 lines with Turkish texts, folder and per-line urls, silent failures, one voice at a time', async () => {
  assert.equal(ASENA_VOICE_LINES.length, 29);
  for (const line of ASENA_VOICE_LINES) assert.ok(ASENA_VOICE_TEXT[line].length > 1, line);
  assert.equal(ASENA_VOICE_TEXT['sky-open'], 'Gök açıldı!'); assert.equal(ASENA_VOICE_TEXT['feature-start'], 'Ergenekon!'); assert.equal(ASENA_VOICE_TEXT['wolf-guides'], 'Kurt yol gösteriyor…');
  const urls = asenaVoiceBankUrls('/audio/voice/asena/');
  assert.equal(urls['x2-9'], '/audio/voice/asena/x2-9.mp3'); assert.equal(urls['tpl-kurt-basi'], '/audio/voice/asena/tpl-kurt-basi.mp3');
  assert.equal(asenaVoiceBankUrls({ x100: '/v/a.ogg', x50: ' ' }).x50, null);
  const bank = await loadAsenaVoiceBank(urls, async url => { if (url.endsWith('x10.mp3')) throw new Error('net'); return url.endsWith('x100.mp3') ? { url } : null; });
  assert.equal(bank.size, 29); assert.equal(bank.get('x10'), null); assert.deepEqual(bank.get('x100'), { url: '/audio/voice/asena/x100.mp3' });
  assert.equal(asenaVoiceDecision(null, 'nice', 1), 'play');
  assert.equal(asenaVoiceDecision({ line: 'nice', until: 3 }, 'win-max', 1), 'replace');
  assert.equal(asenaVoiceDecision({ line: 'win-max', until: 3 }, 'x10', 1), 'skip');
});

/** Level (dB) of frequency `f` in a 4096-sample Hann window starting at `at` seconds (Goertzel). */
function tone(x: Float32Array, f: number, at: number, n = 4096, sr = SR): number {
  const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  const st = Math.round(at * sr);
  for (let i = 0; i < n; i++) { const s = (x[st + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)) + c * s1 - s2; s2 = s1; s1 = s; }
  return 20 * Math.log10(Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / n + 1e-12);
}

test('Asena voices: finite, audible, bounded, deterministic, in tune; the throat whistle walks the harmonics; the howl scoops and falls', () => {
  const ctx = () => ({ sr: SR, rng: createRng(7) });
  const mono: [string, (c: ReturnType<typeof ctx>) => Float32Array][] = [
    ['kopuz', c => kopuz(c, 329.63, 0.8, 0.4)], ['kopuzMute', c => kopuz(c, 246.94, 0.8, 0.1, 1, { mute: true, drone: -5 })], ['kilKopuz', c => kilKopuzFast(c, 246.94, 0.8, 1)],
    ['khoomei', c => khoomeiFast(c, 82.41, 0.8, 2)], ['starBell', c => starBell(c, 659.26, 0.8)], ['kamDum', c => kamDavul(c, 1, 'dum')], ['kamTek', c => kamDavul(c, 1, 'tek')],
    ['kamJingle', c => kamDavul(c, 1, 'jingle')], ['hoof', c => hoof(c, 1)], ['paw', c => paw(c, 1)], ['howl', c => skyHowl(c, 659.26, 2, 0.9)],
  ];
  for (const [name, make] of mono) {
    const a = make(ctx()), b = make(ctx());
    assert.ok(a.length > 100 && a.every(Number.isFinite), name);
    const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.01 && peak < 4, `${name} peak ${peak}`);
    assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000), `${name} deterministic`);
  }
  for (const [name, st] of [['aurora', auroraChord({ sr: SR / 2, rng: createRng(3) }, [164.8, 246.9], 0.8, 1)], ['steppe', steppeNight(ctx(), 3)], ['fire', fireCrackle(ctx(), 1, 0.8)], ['iron', ironCrack(ctx(), 1, 2)]] as const) {
    assert.ok(st.l.every(Number.isFinite) && st.r.every(Number.isFinite) && st.l.some(v => Math.abs(v) > 1e-3), name);
  }
  assert.equal(steppeNight(ctx(), 3).l.length, 3 * SR, 'the steppe bed loops to its exact length');
  // in tune: the fundamental dominates its neighbours (and the half frequency) for the lute, the fiddle and the bell
  for (const [name, x, f, at] of [['kopuz', kopuz(ctx(), 329.63, 0.8, 0.6), 329.63, 0.15], ['kilKopuz', kilKopuzFast(ctx(), 246.94, 0.8, 1.5), 246.94, 0.6], ['starBell', starBell(ctx(), 659.26, 0.8), 659.26, 0.2]] as const) {
    const at0 = tone(x, f, at);
    assert.ok(at0 > tone(x, f * 2 ** (1 / 12), at) + 6 && at0 > tone(x, f / 2, at) + 6, `${name} in tune`);
  }
  // the whistle: over 8 s the strongest of harmonics 5..16 moves, and only to harmonics of the path
  const kh = khoomeiFast(ctx(), 82.41, 0.8, 8);
  const hs = [5, 6, 7, 8, 9, 10, 12, 14, 16];
  const tops = new Set<number>();
  for (let t = 0.6; t < 7.6; t += 1.15) { const lv = hs.map(h => tone(kh, 82.41 * h, t)); tops.add(hs[lv.indexOf(Math.max(...lv))]!); }
  assert.ok(tops.size >= 3, `whistle walks: ${[...tops]}`);
  for (const h of tops) assert.ok((KHOOMEI_HARMONICS as readonly number[]).includes(h), `harmonic ${h} on the path`);
  // the howl: scoop up into E5, then fall well below it at the end
  const howl = skyHowl(ctx(), 659.26, 2.4, 0.9, { from: 7, fall: 10 });
  const pitch = (t: number) => { let best = -Infinity, at = 0; for (let s = -14; s <= 4; s += 0.5) { const v = tone(howl, 659.26 * 2 ** (s / 12), t, 2048); if (v > best) { best = v; at = s; } } return at; };
  assert.ok(pitch(0.05) <= -3, `scoop starts low (${pitch(0.05)})`); assert.equal(pitch(0.9), 0); assert.ok(pitch(2.3) <= -6, `falls (${pitch(2.3)})`);
});

test('renderer with the Asena voices (inline): a one-bar loop masters to target with a seamless seam', async () => {
  const score: Score = {
    id: 'asena-test-loop', bpm: 120, beatsPerBar: 4, bars: 1, swing: 0.5, loop: true, tail: 1, reverb: 'room', reverbDb: -6,
    target: { lufs: -15, measure: 'integrated' }, about: 'test',
    tracks: [
      { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -20, send: 0.3, tame: 13, notes: melody('E4:.5 G4:.5 B4:.5 D5:.5 E5:2') },
      { id: 'mute', kind: 'pitched', voice: 'kopuzMute', level: -26, send: 0.1, notes: melody('B3:.5 B3:.5 B3:.5 B3:.5 E3:.5 E3:.5 E3:.5 E3:.5') },
      { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -22, send: 0.3, notes: melody('B3:2 A3:2') },
      { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -24, send: 0.2, notes: [{ t: 0, d: 3.8, n: 40, v: 0.8 }] },
      { id: 'bell', kind: 'pitched', voice: 'starBell', level: -27, send: 0.4, notes: [{ t: 0, d: 1, n: 88, v: 0.8 }] },
      { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -26, send: 0.4, chords: [{ t: 0, d: 4, ns: [64, 71, 76], v: 0.7 }] },
      { id: 'kit', kind: 'kit', level: -22, send: 0.1, tame: 12, hits: [{ t: 0, k: 'kamDum', v: 1 }, { t: 1, k: 'kamTek', v: 0.8 }, { t: 2, k: 'hoof', v: 0.8 }, { t: 3, k: 'anvil', v: 0.6 }, { t: 3.5, k: 'kamJingle', v: 0.6 }] },
      { id: 'fx', kind: 'fx', level: -30, send: 0.1, fx: [{ t: 0, d: 4, k: 'steppe', v: 1, density: 1 }] },
    ],
  };
  const a = await renderScore(score, { ...createRenderEnv(SR, 1e9), offline: false });
  assert.equal(a.l.length, 88200);
  assert.ok(a.l.every(Number.isFinite) && a.r.every(Number.isFinite));
  assert.ok(Math.abs(a.master.lufs - -15) < 0.5, `lufs ${a.master.lufs}`);
  assert.ok(samplePeakDb([a.l, a.r]) <= -1.6 + 1e-3);
  assert.ok(seam([a.l, a.r], SR).seamRatio < 6);
});

test('constellation layers and frequent effects render with their variations under the ceiling', async () => {
  const defs = ASENA_SFX.filter(d => ['node', 'howl', 'paw', 'land', 'ignite-hilal'].includes(d.id));
  const clips = await renderSfx(defs, { ...createRenderEnv(SR, 1e9), offline: false });
  for (const d of defs) {
    const list = clips.get(d.id)!;
    assert.equal(list.length, d.variations);
    for (const c of list) { assert.ok(c.l.length > 100); assert.ok(samplePeakDb([c.l, c.r]) <= -1.6 + 1e-3); }
    assert.notDeepEqual(list[0]!.l.slice(0, 500), list[1]!.l.slice(0, 500), `${d.id}: variations differ`);
  }
  for (const c of clips.get('howl')!) assert.ok(c.l.length / SR > 2.2, `howl ${c.l.length / SR} s`);
});
