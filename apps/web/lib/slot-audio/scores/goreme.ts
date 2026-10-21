/**
 * Göreme: Şafak Balonları music — original compositions written as note data for a dawn over the Göreme valley in
 * Cappadocia (fairy chimneys, dovecotes, Avanos pottery, kilim patterns, hot-air balloons rising into a pastel sky).
 * Melodies, harmony, bass lines and grooves were written for this game; no existing game's, film's or song's melody,
 * motif or sound is quoted or imitated, and no commercial slot score is imitated.
 *
 * Modal colour (12-tone equal temperament approximations; no makam another Sollish game uses — Ebru G Rast / A Uşşak,
 * Tarhun A/D Hicaz, Cezeri C Nikriz/Çargah, Asena E Hüseyni / B Kürdi):
 *   base theme "Şafak" — F Acemaşiran colour (F G A Bb C D E: a warm major with weight on the fourth Bb), 72 BPM, gentle
 *     and unhurried; the recurring signature, "the lift", is the hook's opening C–D–F (a balloon leaving the ground),
 *     answered by a slow fall to F. Sun-lit kanun arpeggios, a bağlama-like lute with sympathetic strings tuned to F,
 *     a breathy ney over a warm pad in the B section, a soft bendir-like frame drum.
 *   feature theme "Şafak Şöleni" — G Mahur colour (G A B C D E F#: bright major), a whole tone of lift above the base,
 *     100 BPM, a darbuka-and-frame groove, the kanun leading, the ney and a wordless choir soaring to G6.
 *   celebrations — the shared key ladder (win-tiers.ts) from F: Büyük F → Mega G → Süper A → Efsane C → Azami D, 120 BPM.
 * Instruments are synthesized (render.ts voices: kanun, the F-tuned bağlama `dawnSaz`, ney, choir, pads, frame drum,
 * darbuka, zil; synth/goreme.ts for the burner, the dawn bed).
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score, Track } from './types';
import { CELEBRATION_BPM, TIER_KEY, type WinTier } from '../win-tiers';

/* ---------------- arranging helpers ---------------- */

function pads(chords: ChordEvent[], count: number, lo: number, hi: number, v: number): PadEvent[] {
  let prev: number[] | null = null;
  return chords.map(c => { const ns = voice(c.tones, count, lo, hi, prev); prev = ns; return { t: c.t, d: c.d, ns, v }; });
}
const within = (chords: ChordEvent[], fromBar: number, toBar: number, bpb = 4) => chords.filter(c => c.t >= fromBar * bpb - 1e-9 && c.t < toBar * bpb - 1e-9);
const hits = (...lists: HitEvent[][]) => lists.flat();
const shiftNotes = (notes: NoteEvent[], k: number): NoteEvent[] => notes.map(n => ({ ...n, n: n.n + k }));
const shiftChords = (chords: ChordEvent[], k: number): ChordEvent[] => chords.map(c => ({ ...c, root: (c.root + k + 12) % 12, tones: c.tones.map(t => (t + k + 12) % 12), bass: (c.bass + k + 12) % 12 }));
const vel = (notes: NoteEvent[], v: number) => notes.map(n => ({ ...n, v: n.v * v }));
const fitRange = (n: number, lo: number, hi: number) => { let x = n; while (x > hi) x -= 12; while (x < lo) x += 12; return x; };

/** Bass from chord roots: 'long' (≤ 4 beats), 'half' (root + fifth), 'walk' (quarters root–fifth–octave–fifth), 'drive' (8ths). */
function bassLine(chords: ChordEvent[], style: 'long' | 'half' | 'walk' | 'drive', v: number, centre = 41, lo = 29, hi = 46): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const c of chords) {
    const root = fitRange(nearest(c.bass, centre), lo, hi), fifth = root + 7 > hi + 3 ? root - 5 : root + 7;
    const push = (t: number, n: number, d: number, x: number) => { if (t < c.d - 1e-9) out.push({ t: c.t + t, n, d: Math.min(d, c.d - t), v: x }); };
    if (style === 'long') { push(0, root, Math.min(c.d, 4) - 0.1, v); if (c.d > 4) push(4, root, c.d - 4.1, v * 0.9); }
    else if (style === 'half') { push(0, root, 1.9, v); if (c.d >= 4) push(2, fifth, 1.9, v * 0.85); }
    else if (style === 'walk') { const seq = [root, fifth, root + 12 <= hi + 5 ? root + 12 : root, fifth]; for (let b = 0; b < c.d - 1e-9; b++) push(b, seq[b % 4]!, 0.9, b % 2 ? v * 0.75 : v); }
    else for (let k = 0; k < c.d * 2; k++) push(k * 0.5, k % 4 === 3 ? fifth : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.7 : v);
  }
  return out;
}

/** Plucked arpeggio over each chord's voicing; index −1 is the root below, indices past the voicing climb an octave. */
function ostinato(chords: ChordEvent[], pattern: number[], step: number, lo: number, hi: number, v: number, count = 3, accent = 0.72): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const vs = voice(c.tones, count, lo, hi, prev); prev = vs;
    let root = nearest(c.root, vs[0]!);
    while (root >= vs[0]!) root -= 12;
    const n = Math.round(c.d / step);
    for (let s = 0; s < n; s++) {
      const idx = pattern[s % pattern.length]!;
      const note = idx < 0 ? root : vs[idx % count]! + 12 * Math.floor(idx / count);
      out.push({ t: c.t + s * step, d: step * 0.95, n: note, v: v * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.85 : accent) });
    }
  }
  return out;
}

/** Lute tremolo: notes of at least `min` beats re-struck every `rate` beats. */
function tremolo(notes: NoteEvent[], min = 1.5, rate = 0.25): NoteEvent[] {
  return notes.flatMap(n => {
    if (n.d < min - 1e-9) return [n];
    const k = Math.round(n.d / rate);
    return Array.from({ length: k }, (_, i) => ({ t: n.t + i * rate, d: rate, n: n.n, v: n.v * (i === 0 ? 1 : i % 2 ? 0.55 : 0.68) }));
  });
}
/** A strum: the chord's notes a few ms apart, each held `d` beats. */
function strum(t: number, ns: number[], d: number, v: number, gap = 0.04): NoteEvent[] { return ns.map((n, i) => ({ t: t + i * gap, d, n, v: v * (1 - i * 0.04) })); }
/** Sun-glint sparkle notes: F major pentatonic F6 G6 A6 C7 D7. */
const GLINT = [89, 91, 93, 96, 98];

/* =====================================================================================
 * BASE THEME — "Şafak" (Dawn)
 * F Acemaşiran colour, 72 BPM straight, 12 bars = 40.0 s seamless loop.
 * Form: A (4 bars: "the lift" hook on the F-tuned lute with tremolo on the long notes, kanun arpeggios like first
 *       light, a frame-drum heartbeat) · A' (4 bars: the ney answers low with the leading tone E, a soft walking bass) ·
 *       B (4 bars: the sky opens — the ney sings up to Bb5 over a warm pad, the kanun doubles, zil on the changes; a
 *       climb Bb–C–D–E into the hook's C).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  F | F:2 C:2 | Dm:2 Bb:2 | C:2 F:2 |
  F | Gm:2 C:2 | Bb:2 C:2 | F:2 Dm:2 |
  Dm | Gm:2 Bb:2 | C:2 Am:2 | Bb:2 C:2`);

/** The 4-bar hook: "the lift" C–D–F, the turn back, a climb to D5 and the slow fall to F. */
export const GOREME_HOOK = `
  C5:.5 D5:.5 F5:1 E5:.5 D5:.5 C5:1 |
  A4:.5 Bb4:.5 C5:1.5 A4:.5 G4:1 |
  F4:.5 G4:.5 A4:.5 C5:.5 D5:1.5 C5:.5 |
  Bb4:.5 A4:.5 G4:.5 A4:.25 G4:.25 F4:2`;
/** The answer (written in the ney's low register), with the leading tone E. */
export const GOREME_ANSWER = `
  A4:1.5 Bb4:.5 C5:1 A4:1 |
  G4:.5 A4:.5 Bb4:1 D5:1 C5:1 |
  Bb4:.5 A4:.5 G4:.5 F4:.5 G4:1 E4:1 |
  F4:1.5 G4:.5 A4:2`;
/** B: the ney over the opened sky, climbing into the hook. */
export const GOREME_SKY = `
  D5:1 F5:.5 G5:.5 A5:2 |
  G5:.5 A5:.5 Bb5:1 A5:.5 G5:.5 F5:1 |
  E5:1 F5:.5 G5:.5 A5:1 C5:1 |
  Bb4:.5 C5:.5 D5:.5 E5:.5 F5:2`;

const baseKit = hits(
  steps('frameLo', 'X.......x.......', 0, 4, 0.8), steps('frame', '........o.......', 0, 4, 0.6),
  steps('frameLo', 'X.......x..o....', 4, 4, 0.85), steps('frame', '....o.......o...', 4, 4, 0.7), steps('ka', '..g...g...g...g.', 4, 4, 0.5),
  steps('frameLo', 'X..o....x..o....', 8, 4, 0.9), steps('frame', '....x.......x...', 8, 4, 0.75), steps('ka', '..g.g.g...g.g.g.', 8, 3, 0.55),
  steps('zil', 'x...............', 8, 4, 0.55), steps('frame', '........x.x.xxxx', 11, 1, 0.6),
);
const baseFx: FxEvent[] = [
  { t: 0, d: 3, k: 'sparkle', v: 0.45, density: 8, notes: GLINT, shape: 'decay' },
  { t: 30, d: 2, k: 'swell', v: 0.25 },
  { t: 32, d: 3, k: 'sparkle', v: 0.55, density: 12, notes: GLINT, shape: 'decay' },
];

export const BASE_THEME: Score = {
  id: 'goreme-base', bpm: 72, beatsPerBar: 4, bars: 12, swing: 0.5, loop: true, tail: 3.5, reverb: 'hall', reverbDb: -4,
  target: { lufs: -15, measure: 'integrated' },
  about: 'Şafak: F Acemaşiran colour (F G A Bb C D E), 72 BPM, 12-bar seamless loop (40 s). A: "the lift" hook (C–D–F, then the slow fall to F) on a bağlama-like lute with sympathetic strings tuned to F and tremolo on the long notes, kanun arpeggios like first light, a bendir-like frame-drum heartbeat · A\': the ney answers low with the leading tone E, a soft walking bass, light darbuka ghost strokes · B: the sky opens — the ney climbs to Bb5 over a warm pad with the kanun doubling, zil on the downbeats, a Bb–C–D–E climb back into the hook.',
  tracks: [
    { id: 'saz', kind: 'pitched', voice: 'dawnSaz', level: -20, send: 0.3, pan: 0.05, bright: 1, notes: tremolo(melody(GOREME_HOOK, 0), 1.5, 0.25) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.45, pan: -0.08, notes: [...vel(melody(GOREME_ANSWER, 4), 0.85), ...melody(GOREME_SKY, 8)] },
    { id: 'kanun', kind: 'pitched', voice: 'kanunSoft', level: -25, send: 0.32, pan: 0.35, bright: 0.9, notes: ostinato(BASE_CHORDS, [0, 1, 2, 3, 2, 1, 0, 1], 0.5, 60, 76, 0.6) },
    { id: 'double', kind: 'pitched', voice: 'kanun', level: -27, send: 0.35, pan: 0.25, bright: 0.8, notes: vel(melody(GOREME_SKY, 8, 4, 12).filter(n => n.d >= 0.5), 0.6) },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -26, send: 0.45, width: 1.5, chords: pads(within(BASE_CHORDS, 4, 12), 4, 57, 76, 0.7) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -28, send: 0.5, width: 1.6, chords: pads(within(BASE_CHORDS, 8, 12), 3, 62, 81, 0.6) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -26, send: 0.04, notes: [...bassLine(within(BASE_CHORDS, 0, 4), 'long', 0.6), ...bassLine(within(BASE_CHORDS, 4, 12), 'half', 0.7)] },
    { id: 'kit', kind: 'kit', level: -25, send: 0.22, width: 1.2, hits: baseKit },
    { id: 'fx', kind: 'fx', level: -31, send: 0.4, width: 1.5, fx: baseFx },
  ],
};

/* IDLE — attract mode: the hook on the soft kanun, the ney answer far away, a breathing pad, a slow heartbeat (same tempo). */
export const IDLE_THEME: Score = {
  id: 'goreme-idle', bpm: 72, beatsPerBar: 4, bars: 8, swing: 0.5, loop: true, tail: 3.5, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -16, measure: 'integrated' },
  about: 'F Acemaşiran colour, 72 BPM, 8-bar loop (26.7 s): "the lift" hook on a soft kanun, the ney answer far below, a warm pad breathing F–C–Dm–Bb and a slow frame-drum heartbeat; no lute, no groove.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanunSoft', level: -21, send: 0.5, pan: 0.1, bright: 0.8, notes: vel(melody(GOREME_HOOK, 0, 4, 12), 0.75).map((n, i) => (i === 0 ? { ...n, v: n.v * 0.6 } : n)) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -23, send: 0.5, pan: -0.15, notes: vel(melody(GOREME_ANSWER, 4), 0.7) },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -24, send: 0.5, width: 1.6, chords: pads(progression('F:4 | C:4 | Dm:4 | Bb:2 C:2 | F | Gm:2 C:2 | Bb:2 C:2 | F'), 4, 57, 76, 0.6) },
    { id: 'kit', kind: 'kit', level: -31, send: 0.3, hits: steps('frameLo', '........x..o....', 0, 8, 0.7) },
    { id: 'fx', kind: 'fx', level: -32, send: 0.4, width: 1.4, fx: [{ t: 0, d: 30, k: 'sparkle', v: 0.45, density: 1.2, notes: GLINT, shape: 'flat' }] },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Şafak Şöleni" (the Dawn Festival)
 * G Mahur colour, 100 BPM, 16 bars = 38.4 s loop.
 * Form: A (8 bars: the kanun leads a dancing riff, the lute strums the off-beats, darbuka dum–tek with frame drum,
 *       zil on the bar lines) · B (8 bars: the ney and a wordless choir soar to G6 over a string pad, the groove opens
 *       up, the kanun arpeggiates; a riser and a pickup back into A).
 * ===================================================================================== */

const FEAT_CHORDS = progression(`
  G | D:2 Em:2 | C:2 D:2 | G | Em | C:2 D:2 | Am:2 D:2 | G |
  C | D | Bm:2 Em:2 | Am:2 D:2 | G | Em:2 C:2 | Am:2 D:2 | D`);
export const GOREME_FEATURE_RIFF = `
  D5:.5 G5:.5 B5:.5 A5:.5 G5:1 D5:1 |
  F#5:.5 G5:.5 A5:1 G5:.5 E5:.5 B4:1 |
  C5:.5 E5:.5 G5:1 F#5:.5 E5:.5 D5:1 |
  B4:.5 D5:.5 G5:2 r:1 |
  E5:.5 F#5:.5 G5:.5 B5:.5 A5:1 G5:1 |
  E5:.5 G5:.5 C6:1 B5:.5 A5:.5 F#5:1 |
  E5:.5 F#5:.5 A5:1 G5:.5 F#5:.5 D5:1 |
  G5:3 r:1`;
export const GOREME_FEATURE_SKY = `
  E5:1 G5:1 C6:2 |
  B5:.5 A5:.5 F#5:1 A5:2 |
  B5:1 D6:1 E6:1 B5:1 |
  A5:.5 B5:.5 C6:1 B5:.5 A5:.5 F#5:1 |
  G5:1 B5:.5 D6:.5 G6:2 |
  E6:1 D6:.5 B5:.5 C6:1 G5:1 |
  A5:1 C6:1 B5:.5 A5:.5 F#5:1 |
  G5:1 A5:.5 B5:.5 D5:2`;

const featKit = hits(
  steps('dum', 'X.....x...X.....', 0, 8, 0.9), steps('tek', '....x.....x.x.x.', 0, 8, 0.8), steps('ka', '..g...g.g.....g.', 0, 8, 0.6),
  steps('frameLo', 'x.......x.......', 0, 8, 0.6), steps('zil', 'x...............', 0, 8, 0.5),
  steps('dum', 'X.....x.X.....x.', 8, 7, 0.95), steps('tek', '....x.x.....x.xx', 8, 7, 0.85), steps('ka', '..g.....g.g.....', 8, 7, 0.6),
  steps('frameLo', 'X...x...X...x...', 8, 7, 0.65), steps('zil', 'x.......x.......', 8, 7, 0.5),
  steps('dum', 'X...............', 15, 1), steps('tek', '....x.x.xxxxXXXX', 15, 1, 0.85),
);

export const FEATURE_THEME: Score = {
  id: 'goreme-feature', bpm: 100, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' },
  about: 'Şafak Şöleni: G Mahur colour (G A B C D E F#), a whole tone above the base, 100 BPM, 16-bar loop (38.4 s). A: the kanun leads a dancing riff, the F/G-tuned lute strums the off-beats, darbuka dum–tek with the frame drum, zil on the bar lines · B: the ney and a wordless choir soar to G6 over a string pad, the kanun arpeggiates, the groove opens up; a riser and a pickup back into A.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.3, pan: 0.12, bright: 1.1, notes: [...melody(GOREME_FEATURE_RIFF, 0), ...melody('r:2 B4:.5 C5:.5 C#5:.5 D5:.5', 15)] },
    { id: 'arp', kind: 'pitched', voice: 'kanunSoft', level: -26, send: 0.3, pan: 0.35, bright: 0.9, notes: ostinato(within(FEAT_CHORDS, 8, 15), [0, 1, 2, 3, 2, 1], 0.25, 62, 79, 0.55) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -20, send: 0.45, pan: -0.1, notes: melody(GOREME_FEATURE_SKY, 8) },
    { id: 'saz', kind: 'pitched', voice: 'dawnSaz', level: -24, send: 0.2, pan: -0.32, bright: 0.9, notes: FEAT_CHORDS.flatMap(c => Array.from({ length: Math.round(c.d) }, (_, b) => strum(c.t + b + 0.5, voice(c.tones, 3, 55, 67, null), 0.4, 0.62, 0.02))).flat() },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.48, width: 1.6, chords: pads(within(FEAT_CHORDS, 8, 16), 3, 59, 76, 0.8) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -26, send: 0.5, width: 1.6, chords: pads(FEAT_CHORDS, 4, 55, 76, 0.65) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22.5, send: 0, notes: [...bassLine(within(FEAT_CHORDS, 0, 8), 'walk', 0.8, 43, 31, 48), ...bassLine(within(FEAT_CHORDS, 8, 16), 'drive', 0.8, 43, 31, 48)] },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, width: 1.3, hits: featKit },
    { id: 'fx', kind: 'fx', level: -28, send: 0.35, width: 1.5, fx: [
      { t: 30, d: 2, k: 'swell', v: 0.3 }, { t: 32, d: 4, k: 'sparkle', v: 0.6, density: 14, notes: [91, 93, 95, 98, 100], shape: 'decay' }, { t: 60, d: 4, k: 'riser', v: 0.4 },
    ] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Feature intro: the burners roar, kanun arpeggios climb two octaves, the choir swells; lands on G at beat 3, feature at beat 5 (3.0 s). */
export const FS_INTRO: Score = {
  id: 'goreme-fs-intro', bpm: 100, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -4,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 5,
  about: 'Feature intro ("dawn breaks"), 100 BPM: a balloon burner roars while kanun arpeggios climb the G major pentatonic over two octaves, a choir swell, a frame-drum roll into a darbuka dum with zil, then a G chord on the lute and kanun on beat 3; the feature theme enters at beat 5 (3.0 s).',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.45, pan: 0.15, bright: 1.1, notes: [55, 57, 59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86].map((n, i) => ({ t: i * 0.2, d: 0.6, n, v: 0.55 + i * 0.025 })).concat([{ t: 3, d: 2, n: 91, v: 0.85 }, { t: 3.02, d: 2, n: 83, v: 0.7 }]) },
    { id: 'saz', kind: 'pitched', voice: 'dawnSaz', level: -20, send: 0.3, bright: 1.2, notes: strum(3, [43, 50, 55, 59, 62, 67], 2, 0.95) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -22, send: 0.45, notes: [{ t: 2, d: 0.5, n: 74, v: 0.7 }, { t: 2.5, d: 0.5, n: 76, v: 0.75 }, { t: 3, d: 2, n: 79, v: 0.85 }] },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.7, chords: [{ t: 0.5, d: 2.5, ns: [60, 64, 67, 72], v: 0.75 }, { t: 3, d: 2.5, ns: [62, 67, 71, 74], v: 0.9 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22.5, send: 0, notes: melody('C2:2 D2:2 | G1:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -21.5, send: 0.2, hits: hits(steps('frameLo', 'X...............', 0, 1), steps('frame', '....o.x.x.xxXXXX', 0, 1, 0.85), steps('dum', 'X...............', 1, 1), steps('zil', 'X...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.3, width: 1.5, fx: [{ t: 0, d: 2.8, k: 'burner', v: 0.9, density: 0.8 }, { t: 0, d: 3, k: 'riser', v: 0.4 }, { t: 3, d: 2, k: 'sparkle', v: 0.8, density: 22, notes: [91, 93, 95, 98, 100], shape: 'decay' }] },
  ],
};

/** Retrigger (+5): a quick kanun flourish up to D6 over a lute strum, a darbuka stroke; musical end at beat 3 (1.8 s). */
export const RETRIGGER: Score = {
  id: 'goreme-retrigger', bpm: 100, beatsPerBar: 4, bars: 1, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 3,
  about: 'Retrigger (+5), G Mahur colour, 100 BPM, 1 bar: a 32nd-note kanun flourish G–A–B–D–E–G up to D6, a G lute strum with tremolo, a darbuka dum with zil and a sparkle; ends at beat 3 (1.8 s) and rings over the feature theme.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.4, pan: 0.2, bright: 1.1, notes: [...melody('G4:.125 A4:.125 B4:.125 D5:.125 E5:.125 G5:.125 B5:.25 r:3'), { t: 1, d: 1.5, n: 86, v: 0.85 }] },
    { id: 'saz', kind: 'pitched', voice: 'dawnSaz', level: -21, send: 0.3, bright: 1.15, notes: tremolo(strum(1, [55, 59, 62, 67], 1.5, 0.8), 1, 0.125) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0, notes: melody('r:1 G1:2 r:1') },
    { id: 'kit', kind: 'kit', level: -21.5, send: 0.2, hits: hits(steps('dum', '....X...........', 0, 1), steps('tek', 'xxxx............', 0, 1, 0.7), steps('zil', '....X...........', 0, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, fx: [{ t: 1, d: 1.5, k: 'sparkle', v: 0.8, density: 24, notes: [91, 93, 95, 98, 100], shape: 'decay' }] },
  ],
};

/** Feature outro: the sun is high, home to F — 72 BPM, Gm – C | F; the base theme may return at beat 5 (4.2 s). */
export const FS_OUTRO: Score = {
  id: 'goreme-fs-outro', bpm: 72, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 5,
  about: 'Feature outro ("the sun is high"), back to F, 72 BPM: Gm – C | F with the ney falling D–C–Bb–A–G to F, lute strums, a warm pad and the choir, a kanun glint on F6, a soft frame drum; the base theme may return at beat 5 (4.2 s).',
  tracks: [
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -19.5, send: 0.45, notes: melody('D5:1 C5:.5 Bb4:.5 A4:1 G4:1 | F4:3 r:1') },
    { id: 'saz', kind: 'pitched', voice: 'dawnSaz', level: -23, send: 0.35, pan: -0.3, bright: 0.75, notes: [...strum(0, [55, 58, 62, 67], 1.5, 0.75), ...strum(2, [48, 55, 60, 64], 1.5, 0.75), ...strum(4, [53, 57, 60, 65, 69], 3, 0.85)] },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -24, send: 0.5, width: 1.6, chords: pads(progression('Gm:2 C:2 | F'), 4, 57, 76, 0.7) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -25, send: 0.5, width: 1.6, chords: pads(progression('Gm:2 C:2 | F'), 3, 55, 72, 0.7) },
    { id: 'glint', kind: 'pitched', voice: 'kanunSoft', level: -25, send: 0.5, pan: 0.3, notes: [{ t: 4, d: 2, n: 89, v: 0.8 }, { t: 4.02, d: 2, n: 84, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -24, send: 0.03, notes: melody('G1:2 C2:2 | F1:3 r:1') },
    { id: 'kit', kind: 'kit', level: -28, send: 0.25, hits: hits(steps('frameLo', 'x.......x.......', 0, 1), steps('frameLo', 'X...............', 1, 1), steps('zil', 'x...............', 1, 1, 0.6)) },
  ],
};

/* =====================================================================================
 * WIN CELEBRATIONS — the shared key ladder (win-tiers.ts TIER_KEY) from F: Büyük F → Mega G → Süper A → Efsane C →
 * Azami D, 120 BPM so tier-up hits land on one pulse. Melodies are written in F and transposed; keys above A are
 * written lower so the lead stays in its sweet register.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
const leadShift = (key: number) => (key > 4 ? key - 12 : key);

const HEADS: Record<1 | 2 | 3, { bars: number; chords: string; lead: string; bass: string; lufs: number }> = {
  1: { bars: 2, chords: 'F:2 Bb:2 | C:2 F:2', lead: 'A4:.5 C5:.5 F5:.5 G5:.5 A5:1 G5:.5 F5:.5 | G5:.5 A5:.5 C6:1 F5:2', bass: 'F2:2 Bb1:2 | C2:2 F2:2', lufs: -15 },
  2: { bars: 2, chords: 'F:1 Dm:1 Bb:1 C:1 | F', lead: 'F4:.25 A4:.25 C5:.25 F5:.25 E5:.5 F5:.5 G5:.5 A5:.5 Bb5:1 | A5:.5 G5:.5 A5:.5 C6:.5 F5:2', bass: 'F2:1 D2:1 Bb1:1 C2:1 | F2:3 r:1', lufs: -14.5 },
  3: { bars: 3, chords: 'Dm:2 Bb:2 | Gm:2 C:2 | F', lead: 'C5:.25 D5:.25 F5:.25 A5:.25 G5:.5 F5:.5 D5:.5 F5:.5 A5:1 | Bb5:.5 A5:.5 G5:.5 F5:.5 G5:.5 A5:.5 C6:1 | A5:.5 G5:.5 F5:2 r:1', bass: 'D2:2 Bb1:2 | G1:2 C2:2 | F2:3 r:1', lufs: -14 },
};
const lowBass = (notes: NoteEvent[]) => notes.map(n => ({ ...n, n: fitRange(n.n, 29, 46) }));
const shower = (t: number, d: number, v: number, density: number): FxEvent => ({ t, d, k: 'sparkle', v, density, notes: GLINT, shape: 'decay' });

/** Big-win heads 1–3 in their tier keys (1 F, 2 G, 3 A); each climbs and lands on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = HEADS[tier];
  const key = TIER_KEY[tier], lk = leadShift(key);
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, lk), bassNotes = lowBass(melody(spec.bass, 0, 4, key));
  const lastBar = spec.bars - 1;
  const kit = tier === 1
    ? hits(steps('frameLo', 'X.......x.......', 0, 1), steps('frame', '..x...x...x.xxxX', 0, 1), steps('dum', 'X...............', 1, 1), steps('zil', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('dum', 'X...x...X...x...', 0, 1), steps('tek', '..x...x.xxxxXXXX', 0, 1), steps('dum', 'X...............', 1, 1), steps('zil', 'X...x...........', 1, 1), steps('frameLo', 'x.......x.......', 0, 1, 0.7))
      : hits(steps('dum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('tek', 'x.x.x.x.xxxxXXXX', 1, 1), steps('dum', 'X...............', 2, 1), steps('zil', 'X.......X.......', 2, 1), steps('frameLo', 'X...X...X...X...', 0, 2, 0.7));
  const tracks: Track[] = [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, bright: 1.15, notes: tremolo(lead, 1.5, 0.125) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -24 + tier, send: 0.4, pan: 0.22, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.8) },
    { id: 'arp', kind: 'pitched', voice: 'dawnSaz', level: -25, send: 0.2, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 55 + Math.min(4, key), 76, 0.7) },
    { id: 'pad', kind: 'pad', voice: 'padString', level: -25, send: 0.5, width: 1.6, chords: pads(chords, 4, 57, 79, 0.75) },
    ...(tier >= 2 ? [{ id: 'choir', kind: 'pad' as const, voice: 'padChoir' as const, level: -23.5, send: 0.5, width: 1.6, chords: pads(chords, 4, 57, 76, 0.8) }] : []),
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: bassNotes },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, hits: kit },
    { id: 'glint', kind: 'pitched', voice: 'kanunSoft', level: -24.5, send: 0.5, pan: 0.3, notes: [{ t: lastBar * 4, d: 2, n: nearest((5 + key) % 12, 89), v: 0.9 }, { t: lastBar * 4 + 0.02, d: 2, n: nearest((0 + key) % 12, 84), v: 0.65 }] },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, width: 1.5, fx: [
      shower(0, 1.5, 0.75, 18), shower(lastBar * 4, 2, 0.85, 26),
      ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.5 }, { t: 6, d: 2, k: 'swell' as const, v: 0.35 }] : []),
    ] },
  ];
  return {
    id: `goreme-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2.6, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'F', 'G', 'A'][tier]} major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): a kanun climb with tremolo on the long notes over a 16th lute arpeggio, the ney an octave below, a string pad${tier >= 2 ? ', wordless choir' : ''}, frame drum and darbuka${tier === 3 ? ', a riser and double-time drums' : ''}; it lands on a held tonic with a kanun glint, zil and a sun-glint shower.`,
    tracks,
  };
}

/** Big win tier 4 — "Efsane", C major, 120 BPM, 3 bars (6 s): the most radiant head. */
const EFSANE_LEAD = 'F4:.25 A4:.25 C5:.25 F5:.25 A5:1 G5:.5 A5:.5 C6:1 | Bb5:.5 A5:.5 G5:1 A5:.5 Bb5:.5 C6:1 | F5:3 r:1';
function legend(): Score {
  const key = TIER_KEY[4], lk = leadShift(key);
  const chords = shiftChords(progression('F:2 Bb:2 | Gm:2 C:2 | F'), key), lead = melody(EFSANE_LEAD, 0, 4, lk);
  return {
    id: 'goreme-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Big win tier 4 (Efsane), C major, 120 BPM, 3 bars (6 s): I – IV | ii – V | I. Kanun lead with tremolo, the ney doubling an octave below, full choir, string pad, lute arpeggio, a darbuka roll into the last bar with zil, a riser and two sun-glint showers.',
    tracks: [
      { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, bright: 1.2, notes: tremolo(lead, 1, 0.125) },
      { id: 'ney', kind: 'pitched', voice: 'ney', level: -21.5, send: 0.4, pan: 0.2, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.85) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.95) },
      { id: 'pad', kind: 'pad', voice: 'padString', level: -24.5, send: 0.5, width: 1.7, chords: pads(chords, 4, 59, 81, 0.75) },
      { id: 'arp', kind: 'pitched', voice: 'dawnSaz', level: -25, send: 0.2, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 57, 78, 0.7) },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20.5, send: 0, notes: lowBass(melody('C2:2 F2:2 | D2:2 G1:2 | C2:3 r:1')) },
      { id: 'kit', kind: 'kit', level: -21.5, send: 0.16, hits: hits(steps('dum', 'X...x...X...x...', 0, 2), steps('tek', 'x.x.x.x.x.x.xxxx', 1, 1), ...Array.from({ length: 8 }, (_, i) => [{ t: 6 + i * 0.25, k: 'tek', v: 0.45 + i * 0.07 }]), steps('dum', 'X...............', 2, 1), steps('zil', 'X.......X.......', 2, 1), steps('frameLo', 'X...X...X...X...', 0, 2, 0.7)) },
      { id: 'fx', kind: 'fx', level: -24.5, send: 0.35, width: 1.5, fx: [shower(0, 1.5, 0.85, 20), { t: 4, d: 4, k: 'riser', v: 0.5 }, shower(8, 2, 0.95, 30)] },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), legend()] as const;

/**
 * Count-up beds: a 4-bar I – vi – IV – V loop at 120 BPM per tier, in the tier's key, layered more fully per tier:
 * 1 lute 16ths, bass, frame pulse · 2 + darbuka groove, string pad, zil · 3 + kanun lead · 4 + choir, glints, deep
 * strokes · max + the ney an octave below and a glint shimmer.
 */
const BED_CHORDS = progression('F | Dm | Bb | C');
const BED_LEAD = 'C5:.75 A4:.25 C5:.5 F5:1.5 G5:.5 A5:.5 | A5:.75 F5:.25 D5:.5 F5:1.5 E5:.5 D5:.5 | D5:.75 F5:.25 Bb5:.5 D6:1 C6:.5 Bb5:.5 F5:.5 | E5:1 G5:1 C6:.5 Bb5:.5 G5:1';
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tracks: Track[] = [
    { id: 'arp', kind: 'pitched', voice: 'dawnSaz', level: -23, send: 0.2, pan: 0.4, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 55 + Math.min(4, key), 76, 0.7, 3, 0.6) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.8, 41, 29, 46) },
    { id: 'perc', kind: 'kit', level: -27, send: 0.16, hits: hits(steps('frameLo', 'x.......x.......', 0, 4), steps('frame', '....x.......x...', 0, 4)) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'groove', kind: 'kit', level: -23, send: 0.12, hits: hits(steps('dum', 'X.....x.X.......', 0, 4), steps('tek', '....x.....x.x.x.', 0, 4, 0.8)) });
    tracks.push({ id: 'pad', kind: 'pad', voice: 'padString', level: -25.5, send: 0.5, width: 1.6, chords: pads(chords, 4, 57, 79, 0.7) });
    tracks.push({ id: 'zil', kind: 'kit', level: -30, send: 0.35, hits: [0, 8].map(t => ({ t, k: 'zil', v: 0.7 })) });
  }
  if (level >= 3) tracks.push({ id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.3, bright: 1.05, notes: melody(BED_LEAD, 0, 4, lk) });
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.85) });
    tracks.push({ id: 'glint', kind: 'pitched', voice: 'kanunSoft', level: -26, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 86), v: 0.7 })) });
    tracks.push({ id: 'low', kind: 'kit', level: -27, send: 0.25, hits: chords.flatMap(c => [{ t: c.t, k: 'frameLo', v: 0.9 }, { t: c.t + c.d - 0.5, k: 'tek', v: 0.5 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'ney', kind: 'pitched', voice: 'ney', level: -24, send: 0.42, pan: -0.25, notes: vel(melody(BED_LEAD, 0, 4, lk - 12).filter(n => n.d >= 0.5), 0.75) });
    tracks.push({ id: 'fx', kind: 'fx', level: -29, send: 0.35, fx: [{ t: 0, d: 7, k: 'sparkle', v: 0.6, density: 3, notes: GLINT, shape: 'flat' }, { t: 8, d: 7, k: 'sparkle', v: 0.6, density: 3, notes: GLINT, shape: 'flat' }] });
  }
  const keyName = ['F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D'][key];
  return {
    id: `goreme-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -5.5,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – vi – IV – V in ${keyName} major at 120 BPM, 4-bar seamless loop (8 s); ${['lute 16ths, bass, frame pulse', '+ darbuka groove, string pad, zil', '+ kanun lead', '+ choir, kanun glints, deep strokes', '+ the ney an octave below and a glint shimmer'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/** Max win — the top of the ladder: D major, 120 BPM, 3 bars (6 s), IV – V – bVII – I. */
const MAX_LEAD = 'Bb4:.5 D5:.5 F5:.5 Bb5:.5 D6:2 | C5:.5 E5:.5 G5:.5 C6:.5 Bb5:1 Eb6:1 | C6:.25 F6:.25 A5:.5 C6:.5 F6:2.5';
function maxWin(): Score {
  const key = TIER_KEY.max, lk = leadShift(key);
  const chords = shiftChords(progression('Bb | C:2 Eb:2 | F'), key), lead = melody(MAX_LEAD, 0, 4, lk);
  return {
    id: 'goreme-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3.2, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Max win, D (top of the key ladder), 120 BPM, 3 bars (6 s): IV – V – bVII – I (G – A – C – D) with kanun and ney in octaves, tremolo, full choir and strings, a 16th lute arpeggio, a lute strum, a balloon burner roar, double-time darbuka with a roll and zil, and the biggest sun-glint shower.',
    tracks: [
      { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, bright: 1.25, notes: tremolo(lead, 1, 0.125) },
      { id: 'ney', kind: 'pitched', voice: 'ney', level: -20.5, send: 0.4, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.9) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -21, send: 0.5, width: 1.8, chords: pads(chords, 4, 57, 78, 0.95) },
      { id: 'pad', kind: 'pad', voice: 'padString', level: -24, send: 0.5, width: 1.8, chords: pads(chords, 4, 61, 83, 0.8) },
      { id: 'arp', kind: 'pitched', voice: 'dawnSaz', level: -25, send: 0.2, pan: 0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'strum', kind: 'pitched', voice: 'dawnSaz', level: -23, send: 0.25, notes: strum(8, [50, 57, 62, 66, 69], 3, 0.95) },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20, send: 0, notes: lowBass(melody('G1:.5 G1:.5 G1:.5 G1:.5 G1:.5 G1:.5 G1:.5 G1:.5 | A1:.5 A1:.5 A1:.5 A1:.5 C2:.5 C2:.5 C2:.5 C2:.5 | D2:3 r:1')) },
      { id: 'kit', kind: 'kit', level: -20.5, send: 0.16, hits: hits(steps('dum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('tek', 'x.x.x.x.xxxxxxxx', 0, 2), ...Array.from({ length: 12 }, (_, i) => [{ t: 5 + i * 0.25, k: 'tek', v: 0.4 + i * 0.05 }]), steps('dum', 'X...............', 2, 1), steps('zil', 'X...X...........', 2, 1), steps('frameLo', 'X...X...X...X...', 0, 2, 0.75)) },
      { id: 'fx', kind: 'fx', level: -23.5, send: 0.3, width: 1.6, fx: [shower(0, 2, 0.85, 20), { t: 0, d: 8, k: 'riser', v: 0.4 }, { t: 7, d: 1.2, k: 'burner', v: 0.7, density: 0.9 }, shower(8, 3, 1, 34)] },
    ],
  };
}
export const MAX_WIN = maxWin();

/** Total-win fanfare (end of the feature): F major, 120 BPM, a festive kanun flourish, 4 s to its musical end. */
const TOTAL_LEAD = 'F4:.25 A4:.25 C5:.5 r:.25 C5:.25 D5:.25 E5:.25 F5:.5 G5:.5 A5:.5 G5:.5 | Bb5:.5 G5:.5 F5:3';
export const TOTAL_WIN: Score = {
  id: 'goreme-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.4, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win fanfare, F major, 120 BPM, 4 s: F – Dm – Bb | C – F. A festive kanun flourish with the ney doubling, lute strums, string pad, choir on the final F with kanun glints, darbuka with zil and a sun-glint shower.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.28, bright: 1.15, notes: tremolo(melody(TOTAL_LEAD), 1.5, 0.125) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -22, send: 0.4, pan: 0.25, notes: vel(melody(TOTAL_LEAD, 0, 4, -12).filter(n => n.d >= 0.5), 0.8) },
    { id: 'strum', kind: 'pitched', voice: 'dawnSaz', level: -24, send: 0.25, pan: -0.35, bright: 0.7, notes: [...strum(0, [53, 57, 60, 65], 0.8, 0.8), ...strum(1, [53, 57, 60, 65], 0.8, 0.7), ...strum(2, [50, 53, 57, 62], 0.8, 0.75), ...strum(3, [46, 50, 53, 58], 0.8, 0.75), ...strum(4, [48, 52, 55, 60], 0.8, 0.8), ...strum(5, [53, 57, 60, 65, 69], 3, 0.85)] },
    { id: 'pad', kind: 'pad', voice: 'padString', level: -25, send: 0.5, width: 1.6, chords: pads(progression('F:2 Dm:1 Bb:1 | C:1 F:3'), 4, 57, 79, 0.7) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.6, chords: [{ t: 5, d: 3, ns: [57, 60, 65, 69], v: 0.9 }] },
    { id: 'glint', kind: 'pitched', voice: 'kanunSoft', level: -24, send: 0.5, notes: [{ t: 5, d: 3, n: 89, v: 0.85 }, { t: 5.5, d: 2.5, n: 84, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: lowBass(melody('F2:2 D2:1 Bb1:1 | C2:1 F2:2 r:1')) },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, hits: hits(steps('dum', 'X...x...X...x...', 0, 1), steps('tek', '..x...x.xxxxXXXX', 0, 1), steps('dum', 'X...x...........', 1, 1), steps('zil', '....X...........', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, width: 1.5, fx: [{ t: 3, d: 2, k: 'swell', v: 0.3 }, shower(5, 2, 0.9, 26)] },
  ],
};

/** Ambience bed: dawn over the valley — a soft breeze, distant birds, two far balloon burners; 24 s loop. */
export const AMBIENCE: Score = {
  id: 'goreme-ambience', bpm: 60, beatsPerBar: 4, bars: 6, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -8,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 24 s seamless loop: dawn over the Göreme valley — a soft breeze with slow gusts, sparse original synthesized bird phrases left and right, and two far balloon burners; no tempo-bound material.',
  tracks: [{ id: 'dawn', kind: 'fx', level: -31, send: 0.12, width: 1.4, fx: [{ t: 0, d: 24, k: 'dawn', v: 1 }] }],
};

export const GOREME_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, retrigger: RETRIGGER, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, ambience: AMBIENCE,
} as const;
export type GoremeScoreId = keyof typeof GOREME_SCORES;

/** Crest-factor control for transient-heavy stems: drums 12 dB, plucked lute and kanun 13 dB above their gated RMS. */
for (const score of Object.values(GOREME_SCORES)) {
  if (score === AMBIENCE) continue;
  for (const track of score.tracks) {
    if (track.tame !== undefined) continue;
    if (track.kind === 'kit') track.tame = 12;
    else if (track.kind === 'pitched' && (track.voice === 'dawnSaz' || track.voice === 'kanun' || track.voice === 'kanunSoft')) track.tame = 13;
  }
}
export const GOREME_SCORE_IDS = Object.keys(GOREME_SCORES) as GoremeScoreId[];
