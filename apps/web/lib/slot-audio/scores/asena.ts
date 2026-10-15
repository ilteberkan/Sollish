/**
 * Asena: Yıldız Kurdu music — original compositions written as note data for a Turkic sky-myth world (Gök Tengri's
 * night over the steppe, Ay Ata the moon, Kün Ana the sun, the guiding sky wolf Asena, the Ergenekon escape through
 * the melted iron mountain). Melodies, harmony, bass lines and grooves were written for this game; no existing game's,
 * film's or song's melody, motif or sound is quoted or imitated, and no commercial slot score is imitated. The gallop
 * figure (three quick strokes per beat, the third accented) is the generic horse rhythm of steppe lute music, common
 * property like a waltz.
 *
 * Modal colour, kept tonal and memorable (12-tone equal temperament approximations; no makam the other games use —
 * Ebru G Rast, Tarhun A/D Hicaz, Cezeri C Nikriz/Çargah):
 *   base theme — E Hüseyni (E F# G A B C# D: the Uşşak lower tetrachord with the natural sixth C#, the dominant on B),
 *     built on the Central-Asian anhemitonic pentatonic E G A B D; vast, slow, nocturnal, over a throat-singing drone
 *     on E whose overtone whistle walks the drone's own harmonics (6, 7, 8, 9, 12, 16 = B, ~D, E, F#, B, E). The B
 *     section touches a C natural (the Kürdi shadow of the night) before the turn home.
 *   feature theme "Ergenekon" — B Kürdi (B C D E F# G A: the dark, Phrygian iron mountain, the C→B cadence) for the
 *     forge and the gallop, opening in its B section to E Hüseyni (the C# returns: the sky opens, the people ride out);
 *     12/8 gallop at 100 dotted-quarter beats per minute.
 *   celebrations — the sky opens into the major pentatonic of the tier key (Kün Ana's daylight): E → F# → G# → B → C#.
 * The recurring signature, "the Asena call", is the hook's opening: four stars rising E–G–B–D to a held E (the same
 * notes the Kurt Başı constellation traces before the howl), answered by the Hüseyni fall G–F#–E.
 * Instruments are synthesized (synth/asena.ts + ney and choir from the shared kit): kopuz/dombra-like lute, kıl-kopuz-like
 * bowed fiddle, throat-singing drone (khoomei / kargyraa), kam davulu with its pendants, hoofbeats, forge anvil,
 * crystalline star bells, the aurora pad, a wordless female choir, ney-like flute, and the steppe night bed.
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

/** 12/8 melody written in eighth notes (12 per bar), returned in beats (one beat = a dotted quarter = 3 eighths). */
export function m8(src: string, startBar = 0, transpose = 0): NoteEvent[] {
  return melody(src, startBar, 12, transpose).map(n => ({ ...n, t: n.t / 3, d: n.d / 3 }));
}
const STEP_V: Record<string, number> = { X: 1, x: 0.82, o: 0.55, g: 0.3 };
/** A 12-step (eighth-note) drum line for 12/8, repeated over `bars` bars. */
export function steps12(kind: string, pattern: string, startBar: number, bars = 1, gain = 1): HitEvent[] {
  const clean = pattern.replace(/\s+/g, '');
  if (clean.length !== 12) throw new Error(`12/8 pattern for ${kind} must have 12 steps, got ${clean.length}`);
  const out: HitEvent[] = [];
  for (let b = 0; b < bars; b++) for (let s = 0; s < 12; s++) { const v = STEP_V[clean[s]!]; if (v) out.push({ t: (startBar + b) * 4 + s / 3, k: kind, v: v * gain }); }
  return out;
}

/** Bass from chord roots: 'pedal' (one long note), 'long' (≤ 4 beats), 'gallop' (root on the beat, fifth on the third eighth: 12/8), 'drive' (8ths). */
function bassLine(chords: ChordEvent[], style: 'pedal' | 'long' | 'gallop' | 'drive' | 'half', v: number, centre = 40, lo = 28, hi = 45): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const c of chords) {
    const root = fitRange(nearest(c.bass, centre), lo, hi), fifth = root + 7 > hi + 3 ? root - 5 : root + 7;
    const push = (t: number, n: number, d: number, x: number) => { if (t < c.d - 1e-9) out.push({ t: c.t + t, n, d: Math.min(d, c.d - t), v: x }); };
    if (style === 'pedal') push(0, root, c.d - 0.1, v);
    else if (style === 'long') { push(0, root, Math.min(c.d, 4) - 0.1, v); if (c.d > 4) push(4, root, c.d - 4.1, v * 0.9); }
    else if (style === 'half') { push(0, root, 1.9, v); if (c.d >= 4) push(2, fifth, 1.9, v * 0.85); }
    else if (style === 'gallop') for (let b = 0; b < c.d - 1e-9; b++) { push(b, root, 0.6, b % 2 ? v * 0.8 : v); push(b + 2 / 3, b % 2 ? fifth : root, 0.3, v * 0.7); }
    else for (let k = 0; k < c.d * 2; k++) push(k * 0.5, k % 4 === 3 ? fifth : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.7 : v);
  }
  return out;
}

/** Plucked ostinato over each chord's voicing; index −1 is the root below, indices past the voicing climb an octave. */
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

/** Dombra tremolo: notes of at least `min` beats re-struck every `rate` beats (the right hand flutters on a long note). */
function tremolo(notes: NoteEvent[], min = 1.5, rate = 0.25): NoteEvent[] {
  return notes.flatMap(n => {
    if (n.d < min - 1e-9) return [n];
    const k = Math.round(n.d / rate);
    return Array.from({ length: k }, (_, i) => ({ t: n.t + i * rate, d: rate, n: n.n, v: n.v * (i === 0 ? 1 : i % 2 ? 0.55 : 0.68) }));
  });
}

/** The gallop strum (12/8): per beat three strokes of the chord's lower dyad — soft, soft, accented. */
function gallopStrums(chords: ChordEvent[], lo: number, hi: number, v: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const vs = voice(c.tones, 2, lo, hi, prev); prev = vs;
    for (let b = 0; b < c.d - 1e-9; b++) for (let k = 0; k < 3; k++) {
      const t = c.t + b + k / 3, x = k === 2 ? 1 : k === 0 ? 0.62 : 0.5;
      out.push({ t, d: 0.3, n: vs[k === 2 ? 1 : 0]!, v: v * x });
      if (k === 2) out.push({ t: t + 0.02, d: 0.3, n: vs[0]!, v: v * x * 0.8 });
    }
  }
  return out;
}

/** A strum: the chord's notes a few ms apart, each held `d` beats. */
function strum(t: number, ns: number[], d: number, v: number, gap = 0.04): NoteEvent[] { return ns.map((n, i) => ({ t: t + i * gap, d, n, v: v * (1 - i * 0.04) })); }
/** Long drone notes (a breath every `len` beats) from `from` to `to` beats. */
function drone(n: number, from: number, to: number, len = 8, v = 0.8): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let t = from; t < to - 1e-9; t += len) out.push({ t, d: Math.min(len, to - t) - 0.4, n, v });
  return out;
}
/** Star twinkles: high pentatonic bells at the given beats. */
const twinkles = (beats: number[], notes: number[], v = 0.6): NoteEvent[] => beats.map((t, i) => ({ t, d: 1, n: notes[i % notes.length]!, v: v * (0.85 + 0.15 * ((i * 7) % 3) / 2) }));
/** High E-pentatonic sparkle notes (E6 G6 A6 B6 D7). */
const SPARK = [88, 91, 93, 95, 98];

/* =====================================================================================
 * BASE THEME — "Gök Tengri'nin Gecesi" (Night of the Sky God)
 * E Hüseyni, 80 BPM straight, 14 bars = 42.0 s seamless loop.
 * Form: A (4 bars: the Asena call hook on the kopuz with its drone string, a star bell on every hook bar, the throat
 *       drone on E alone with its overtone whistle, a single kam davulu stroke per bar) · A' (4 bars: the kıl kopuz sings
 *       the low answer with the Hüseyni C#, kopuz ostinato, soft bass) · B (4 bars: the sky opens — ney high over the
 *       aurora pad, star bells on the changes, the drum's heartbeat; the C natural shadow
 *       in bar 12) · C (2 bars: breakdown — the deep kargyraa drone with twinkling stars, a kopuz turn into the hook).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  Em | Em:2 G:2 | D:2 Bm:2 | Bm:2 Em:2 |
  A | Em | D:2 A:2 | Bm:2 Em:2 |
  G | D:2 A:2 | Bm:2 Em:2 | C:2 Bsus4:2 |
  Em | D:2 Bsus4:2`);

/** The 4-bar hook: the Asena call (E G B D → E), its turn, the climb to F#5 and the Hüseyni fall G–F#–E. */
export const ASENA_HOOK = `
  E4:.5 G4:.5 B4:.5 D5:.5 E5:2 |
  D5:.5 E5:.25 D5:.25 B4:1 A4:.5 B4:.5 G4:1 |
  A4:.5 B4:.5 D5:.5 E5:.5 F#5:1.5 E5:.5 |
  D5:.5 B4:.5 A4:.5 G4:.25 A4:.25 F#4:.5 G4:.5 E4:1`;
/** The kıl kopuz answer (written an octave up, played an octave down): the natural sixth C# of Hüseyni. */
export const BASE_ANSWER = `
  B4:2 C#5:.5 B4:.5 A4:1 |
  G4:.5 A4:.5 B4:1.5 A4:.5 G4:1 |
  F#4:1 G4:.5 A4:.5 B4:.5 D5:.5 C#5:.5 B4:.5 |
  A4:1 G4:.5 F#4:.5 E4:2`;
/** B: the ney over the opened sky; the C natural of the last bar is the Kürdi shadow before the turn home. */
const BASE_NEY = `
  E5:1 G5:.5 A5:.5 B5:2 |
  A5:.5 B5:.5 D6:1 C#6:.5 B5:.5 A5:1 |
  B5:1.5 A5:.5 G5:.5 F#5:.5 E5:1 |
  G5:.5 F#5:.5 E5:.5 D5:.5 C5:1 B4:1`;
const BASE_KIL_B = 'B3:4 | A3:2 C#4:2 | D4:2 E4:2 | E4:2 F#4:1 E4:1';
/** The kopuz turn at the end of the loop, falling into the hook's E4. */
const BASE_TURN = 'r:2 D5:.25 B4:.25 A4:.25 G4:.25 F#4:.5 D4:.5';

const baseKam = hits(
  steps('kamDum', 'X...............', 0, 4), steps('kamTek', '........o.......', 1, 1), steps('kamTek', '........o...g...', 3, 1),
  steps('kamDum', 'x.......x.......', 4, 4), steps('kamTek', '....o.......o...', 4, 4, 0.9), steps('kamJingle', '..............x.', 7, 1, 0.8),
  steps('kamDum', 'X..o....x..o....', 8, 4), steps('kamTek', '....x.......x...', 8, 4, 0.75), steps('kamJingle', 'x...............', 8, 1, 0.7),
  steps('kamDum', 'x..o............', 12, 2, 0.8), steps('kamTek', '........x.x.xxxx', 13, 1, 0.65), steps('kamJingle', '............x...', 13, 1, 0.8),
);
const baseFx: FxEvent[] = [
  { t: 2, d: 2, k: 'sparkle', v: 0.55, density: 10, notes: SPARK, shape: 'decay' },
  { t: 30, d: 2, k: 'swell', v: 0.3 },
  { t: 32, d: 3, k: 'sparkle', v: 0.6, density: 14, notes: SPARK, shape: 'decay' },
  { t: 48, d: 7, k: 'sparkle', v: 0.5, density: 4, notes: SPARK, shape: 'flat' },
];

export const BASE_THEME: Score = {
  id: 'asena-base', bpm: 80, beatsPerBar: 4, bars: 14, swing: 0.5, loop: true, tail: 3.5, reverb: 'hall', reverbDb: -4,
  target: { lufs: -15, measure: 'integrated' },
  about: 'E Hüseyni (E F# G A B C# D) on the E minor pentatonic, 80 BPM, 14-bar seamless loop (42 s). A: the "Asena call" hook (E–G–B–D → E, then the Hüseyni fall G–F#–E) on a kopuz/dombra-like lute with its drone string and dombra tremolo, a star bell on every hook bar, a throat-singing drone on E whose overtone whistle walks the drone\'s harmonics, one kam davulu stroke per bar · A\': the kıl-kopuz-like bowed fiddle sings the low answer with the natural sixth C#, kopuz ostinato, soft bass · B: the sky opens — ney over an aurora pad, star bells on the changes, the drum heartbeat, a C natural (the Kürdi shadow) in the last bar · C: breakdown on the deep kargyraa drone with twinkling stars, a kopuz turn into the hook.',
  tracks: [
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -20, send: 0.3, pan: 0.06, bright: 1, notes: [...tremolo(melody(ASENA_HOOK, 0)), ...melody(BASE_TURN, 13)] },
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -27, send: 0.5, pan: 0.3, bright: 1.2, notes: [
      { t: 0, d: 1, n: 88, v: 0.75 }, { t: 4, d: 1, n: 86, v: 0.65 }, { t: 8, d: 1, n: 83, v: 0.7 }, { t: 12, d: 1, n: 88, v: 0.7 },
      ...within(BASE_CHORDS, 8, 12).map(c => ({ t: c.t, d: 1, n: nearest(c.root, 88), v: 0.6 })),
      ...twinkles([49, 51, 52.5, 54, 55], [95, 91, 88, 93, 86], 0.55),
    ] },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -21, send: 0.4, pan: -0.12, bright: 0.9, notes: [...melody(BASE_ANSWER, 4, 4, -12), ...vel(melody(BASE_KIL_B, 8), 0.7), { t: 48, d: 3.6, n: 52, v: 0.6 }, { t: 52, d: 1.8, n: 47, v: 0.55 }] },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.48, pan: 0.12, notes: melody(BASE_NEY, 8) },
    { id: 'ostinato', kind: 'pitched', voice: 'kopuz', level: -27, send: 0.22, pan: 0.4, bright: 0.55, notes: ostinato(within(BASE_CHORDS, 4, 12), [-1, 2, 1, 2, 0, 2, 1, 2], 0.5, 52, 67, 0.55) },
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -24, send: 0.32, pan: -0.05, bright: 1, notes: drone(40, 0, 48, 8, 0.8) },
    { id: 'kargyraa', kind: 'pitched', voice: 'kargyraa', level: -24.5, send: 0.3, pan: 0.05, notes: drone(40, 48, 56, 8, 0.85) },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -26, send: 0.5, width: 1.6, chords: pads(within(BASE_CHORDS, 8, 14), 4, 59, 79, 0.7) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -27, send: 0.04, notes: bassLine(within(BASE_CHORDS, 4, 12), 'long', 0.7, 40, 28, 43) },
    { id: 'kam', kind: 'kit', level: -25, send: 0.22, width: 1.3, hits: baseKam },
    { id: 'fx', kind: 'fx', level: -30, send: 0.4, width: 1.5, fx: baseFx },
  ],
};

/* IDLE — attract mode, the A section re-orchestrated: the throat drone, the hook on star bells, the bowed answer far below,
   an aurora breath and a slow heartbeat. Same tempo as the base theme (phase-aligned fades). */
export const IDLE_THEME: Score = {
  id: 'asena-idle', bpm: 80, beatsPerBar: 4, bars: 8, swing: 0.5, loop: true, tail: 3.5, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -16, measure: 'integrated' },
  about: 'E Hüseyni, 80 BPM, 8-bar loop (24 s): a throat-singing drone on E with its overtone whistle, the Asena call hook on crystalline star bells, the kıl kopuz answer far below, an aurora pad breathing E–B and a slow kam davulu heartbeat; no lute.',
  tracks: [
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -21, send: 0.55, pan: 0.08, bright: 1.1, notes: vel(melody(ASENA_HOOK, 0, 4, 12), 0.75) },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -23, send: 0.45, pan: -0.15, bright: 0.7, notes: vel(melody(BASE_ANSWER, 4, 4, -12), 0.7) },
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -22, send: 0.35, notes: drone(40, 0, 32, 8, 0.75) },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -26, send: 0.5, width: 1.6, chords: [{ t: 0, d: 16, ns: [52, 59, 64, 71], v: 0.6 }, { t: 16, d: 16, ns: [50, 57, 62, 69], v: 0.6 }] },
    { id: 'kam', kind: 'kit', level: -31, send: 0.3, hits: steps('kamDum', 'x..o............', 0, 8, 0.7) },
    { id: 'fx', kind: 'fx', level: -32, send: 0.4, width: 1.4, fx: [{ t: 0, d: 30, k: 'sparkle', v: 0.5, density: 1.5, notes: SPARK, shape: 'flat' }] },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Ergenekon"
 * 12/8 gallop, 100 dotted-quarter BPM (one beat = three eighths), 16 bars = 38.4 s loop.
 * Form: A (8 bars, B Kürdi: the iron mountain — the kıl kopuz leads low and wild with the kopuz doubling above, the
 *       kopuz gallop strums, hoofbeats, the kam davulu on 1 and 3 with its pendants on 2 and 4, the forge anvil, the
 *       kargyraa drone on B, the C→B Kürdi cadence) · B (8 bars, E Hüseyni: the people ride out — ney and choir sing the
 *       opened sky up to E6 with the C# returning, the aurora pad, star bells on the downbeats, the khoomei whistle on E,
 *       the gallop never stops); a riser and a kopuz pickup back into A.
 * ===================================================================================== */

const FEAT_CHORDS = progression(`
  Bm | C | Am | Bm | Em | C | Am:2 C:2 | Bm |
  Em | D | A | Em | G | D | A:2 Bm:2 | Bm`);
export const ASENA_FEATURE_RIFF = `
  B4:3 C5:1 B4:1 A4:1 B4:3 D5:3 |
  E5:2 D5:1 C5:3 E5:3 G5:3 |
  F#5:2 E5:1 D5:1 C5:1 B4:1 A4:3 C5:3 |
  B4:6 r:3 F#4:1 A4:1 B4:1 |
  G4:2 A4:1 B4:3 D5:2 C5:1 B4:3 |
  C5:2 D5:1 E5:3 G5:2 F#5:1 E5:3 |
  A5:2 G5:1 F#5:2 E5:1 G5:2 E5:1 C5:3 |
  D5:2 C5:1 B4:9`;
const FEAT_SKY = `
  E5:3 G5:3 B5:6 |
  A5:2 B5:1 D6:3 C#6:3 B5:3 |
  C#6:6 B5:2 A5:1 E5:3 |
  G5:3 F#5:2 G5:1 E5:6 |
  D5:3 E5:3 G5:3 A5:3 |
  B5:3 A5:2 B5:1 D6:6 |
  E6:3 D6:2 C#6:1 B5:3 A5:2 F#5:1 |
  B5:9 r:3`;
const FEAT_PICKUP = 'r:9 F#4:1 A4:1 B4:1';

const featKit = hits(
  steps12('hoof', 'goXgoXgoXgoX', 0, 16, 0.9),
  steps12('kamDum', 'X.....x.....', 0, 8), steps12('kamTek', '...x.....x..', 0, 8, 0.85), steps12('kamJingle', '...x.....x..', 0, 8, 0.45),
  steps12('anvil', '.........x.o', 0, 1, 0.8), steps12('anvil', '.........x.o', 2, 1, 0.8), steps12('anvil', '.........x.o', 4, 1, 0.8), steps12('anvil', '......x..x.o', 6, 1, 0.85),
  steps12('kamDum', 'X.....X.....', 8, 7), steps12('kamTek', '...x..x..x.x', 8, 7, 0.75), steps12('kamJingle', 'x...........', 8, 7, 0.55),
  steps12('kamDum', 'X.....x.....', 15, 1), steps12('kamTek', '......xxxxXX', 15, 1, 0.8),
);

export const FEATURE_THEME: Score = {
  id: 'asena-feature', bpm: 100, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' },
  about: '"Ergenekon": 12/8 gallop at 100 dotted-quarter BPM, 16-bar loop (38.4 s). A (B Kürdi, the iron mountain): the kıl-kopuz-like fiddle leads low and wild, the kopuz doubles above, kopuz gallop strums, hoofbeats (three per beat, the third accented), kam davulu on 1 and 3 with its pendants on 2 and 4, the forge anvil, a kargyraa drone on B, the Kürdi C→B cadence · B (E Hüseyni, the people ride out): ney and a wordless female choir sing the opened sky up to E6 with the C# returning, aurora pad, star bells on the downbeats, the khoomei whistle on E, a riser and a kopuz pickup back into A.',
  tracks: [
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -19.5, send: 0.32, pan: -0.06, bright: 1.15, notes: [...m8(ASENA_FEATURE_RIFF, 0, -12), ...vel(m8(FEAT_SKY, 8, -12).filter(n => n.d >= 1), 0.62)] },
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -24, send: 0.24, pan: 0.18, bright: 1.1, notes: [...vel(m8(ASENA_FEATURE_RIFF, 0), 0.75), ...m8(FEAT_PICKUP, 15)] },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -20, send: 0.45, pan: 0.1, notes: m8(FEAT_SKY, 8) },
    { id: 'gallop', kind: 'pitched', voice: 'kopuzMute', level: -24, send: 0.14, pan: 0.36, bright: 0.9, notes: gallopStrums(FEAT_CHORDS, 47, 64, 0.8) },
    { id: 'kargyraa', kind: 'pitched', voice: 'kargyraa', level: -25, send: 0.26, notes: drone(35, 0, 32, 8, 0.85) },
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -25, send: 0.32, bright: 1.1, notes: drone(40, 32, 64, 8, 0.8) },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -25.5, send: 0.5, width: 1.7, chords: pads(within(FEAT_CHORDS, 8, 16), 4, 59, 79, 0.75) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.48, width: 1.6, chords: pads(within(FEAT_CHORDS, 8, 16), 3, 57, 74, 0.8) },
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -26, send: 0.48, pan: 0.32, bright: 1, notes: within(FEAT_CHORDS, 8, 16).filter(c => c.t % 4 === 0).map(c => ({ t: c.t, d: 1, n: nearest(c.root, 88), v: 0.7 })) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22.5, send: 0, notes: bassLine(FEAT_CHORDS, 'gallop', 0.8, 38, 28, 45) },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, width: 1.3, hits: featKit },
    { id: 'fx', kind: 'fx', level: -28, send: 0.35, width: 1.5, fx: [
      { t: 30, d: 2, k: 'swell', v: 0.35 }, { t: 32, d: 4, k: 'sparkle', v: 0.6, density: 14, notes: SPARK, shape: 'decay' }, { t: 60, d: 4, k: 'riser', v: 0.45 },
    ] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Free-spins intro: Ay Ata opens the sky gate — star bells cascade up two octaves, the fiddle swells, the drum rolls; lands on B (the Kürdi tonic) at beat 3; the feature enters at beat 5 (3.0 s). */
export const FS_INTRO: Score = {
  id: 'asena-fs-intro', bpm: 100, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -4,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 5,
  about: 'Free-spins intro ("the sky gate opens"), 100 BPM: star bells cascade up the E pentatonic over two octaves while the kıl kopuz swells from B2 to B3, a choir swell, a kam davulu roll into a deep stroke with its pendants, then a B power-chord kopuz strum with a kargyraa drone on B on beat 3; the feature theme enters at beat 5 (3.0 s).',
  tracks: [
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -20, send: 0.5, pan: 0.15, bright: 1.1, notes: [64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95].map((n, i) => ({ t: i * 0.2, d: 0.8, n, v: 0.55 + i * 0.025 })).concat([{ t: 3, d: 2, n: 95, v: 0.85 }, { t: 3.02, d: 2, n: 83, v: 0.7 }]) },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -21, send: 0.42, pan: -0.15, bright: 1.1, notes: [{ t: 0, d: 2.9, n: 47, v: 0.75 }, { t: 3, d: 2.5, n: 59, v: 0.9 }] },
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -20, send: 0.3, bright: 1.2, notes: strum(3, [47, 54, 59, 66, 71], 2, 0.95) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.7, chords: [{ t: 0.5, d: 2.5, ns: [59, 64, 66, 71], v: 0.75 }, { t: 3, d: 2.5, ns: [59, 66, 71, 78], v: 0.9 }] },
    { id: 'kargyraa', kind: 'pitched', voice: 'kargyraa', level: -24, send: 0.3, notes: [{ t: 3, d: 3, n: 35, v: 0.9 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22.5, send: 0, notes: melody('E2:2 F#2:1 B1:1 | B1:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -21.5, send: 0.2, hits: hits(steps('kamDum', 'X...............', 0, 1), steps('kamTek', '....o.x.x.xxXXXX', 0, 1, 0.85), steps('kamDum', '....X...........', 0, 1), steps('kamJingle', '....X.......x...', 0, 1), steps('kamDum', 'x...............', 1, 1, 0.7)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.35, width: 1.5, fx: [{ t: 0, d: 3, k: 'riser', v: 0.5 }, { t: 3, d: 2, k: 'sparkle', v: 0.8, density: 22, notes: SPARK, shape: 'decay' }] },
  ],
};

/** Retrigger (+3 spins): a star-bell flourish up to B5 over a bowed B with its tremolo, a deep drum stroke; musical end at beat 3 (1.8 s). */
export const RETRIGGER: Score = {
  id: 'asena-retrigger', bpm: 100, beatsPerBar: 4, bars: 1, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 3,
  about: 'Retrigger (+3), B Kürdi/E pentatonic, 100 BPM, 1 bar: a 32nd-note star-bell and kopuz flourish B–D–E–F#–A–B up to B5, a bowed B3 with dombra tremolo, a kam davulu stroke with its pendants and a sparkle; ends at beat 3 (1.8 s) and rings over the feature theme.',
  tracks: [
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -20, send: 0.45, pan: 0.2, bright: 1.1, notes: [...melody('B4:.125 D5:.125 E5:.125 F#5:.125 A5:.125 B5:.125 E6:.25 r:3'), { t: 1, d: 1.5, n: 95, v: 0.85 }] },
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -21, send: 0.3, bright: 1.15, notes: [...melody('B3:.125 D4:.125 E4:.125 F#4:.125 A4:.125 B4:.125 r:3.25'), ...tremolo([{ t: 1, d: 1.5, n: 71, v: 0.8 }], 1, 0.125)] },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -22, send: 0.35, notes: [{ t: 1, d: 1.8, n: 59, v: 0.9 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0, notes: melody('r:1 B1:2 r:1') },
    { id: 'kit', kind: 'kit', level: -21.5, send: 0.2, hits: hits(steps('kamDum', '....X...........', 0, 1), steps('kamTek', 'xxxx............', 0, 1, 0.7), steps('kamJingle', '....X...........', 0, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, fx: [{ t: 1, d: 1.5, k: 'sparkle', v: 0.8, density: 24, notes: SPARK, shape: 'decay' }] },
  ],
};

/** Feature outro: out of Ergenekon, home to E Hüseyni — 80 BPM, C – D | Em; the base theme may return at beat 6 (4.5 s). */
export const FS_OUTRO: Score = {
  id: 'asena-fs-outro', bpm: 80, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 6,
  about: 'Feature outro ("out of Ergenekon"), E Hüseyni, 80 BPM: C – D | Em with a kıl kopuz phrase B–A–G–F#–G–F# falling to E, kopuz strums, the aurora pad and the choir, a last star bell on E6, the throat drone on E; the base theme may return at beat 6 (4.5 s).',
  tracks: [
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -19.5, send: 0.45, bright: 0.9, notes: melody('B3:1 A3:.5 G3:.5 F#3:1 G3:.5 F#3:.5 | E3:3 r:1') },
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -23, send: 0.35, pan: -0.3, bright: 0.75, notes: [...strum(0, [48, 55, 60, 64], 1.5, 0.75), ...strum(2, [50, 57, 62, 66], 1.5, 0.75), ...strum(4, [52, 59, 64, 67, 71], 3, 0.85)] },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -24, send: 0.5, width: 1.6, chords: pads(progression('C:2 D:2 | Em'), 4, 59, 79, 0.7) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -25, send: 0.5, width: 1.6, chords: pads(progression('C:2 D:2 | Em'), 3, 55, 72, 0.7) },
    { id: 'bell', kind: 'pitched', voice: 'starBell', level: -25, send: 0.5, pan: 0.3, notes: [{ t: 4, d: 2, n: 88, v: 0.8 }] },
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -26, send: 0.35, notes: [{ t: 0, d: 7, n: 40, v: 0.7 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -24, send: 0.03, notes: melody('C2:2 D2:2 | E1:3 r:1') },
    { id: 'kit', kind: 'kit', level: -28, send: 0.25, hits: hits(steps('kamDum', 'x.......x.......', 0, 1), steps('kamDum', 'X...............', 1, 1), steps('kamJingle', 'x...............', 1, 1, 0.7)) },
  ],
};

/* =====================================================================================
 * WIN CELEBRATIONS — the shared key ladder (win-tiers.ts TIER_KEY) from E: Büyük E → Mega F# → Süper G# → Efsane B →
 * Max win C#, all in the major pentatonic daylight of Kün Ana. 120 BPM so tier-up hits land on one pulse; the higher
 * tiers add the hoofbeat gallop as triplets on that pulse.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
/** Melodies in keys above G# are written lower (the tonic still rises; the kopuz stays in its sweet register). */
const leadShift = (key: number) => (key > 4 ? key - 12 : key);
/** Hoofbeat triplets on the 120 BPM grid (three per beat, the third accented) over `bars` bars from `startBar`. */
const hoofTriplets = (startBar: number, bars: number, gain = 0.8): HitEvent[] => Array.from({ length: bars * 12 }, (_, i) => ({ t: startBar * 4 + i / 3, k: 'hoof', v: gain * (i % 3 === 2 ? 1 : i % 3 === 0 ? 0.55 : 0.4) }));

const HEADS: Record<1 | 2 | 3, { bars: number; chords: string; lead: string; bass: string; lufs: number }> = {
  1: { bars: 2, chords: 'E:2 A:1 B:1 | E', lead: 'B4:.25 E5:.25 G#5:.25 B5:.25 G#5:.25 F#5:.25 E5:.25 F#5:.25 G#5:1 B5:.5 F#5:.5 | E5:3 r:1', bass: 'E2:2 A1:1 B1:1 | E2:3 r:1', lufs: -15 },
  2: { bars: 2, chords: 'E:1 C#m:1 A:1 B:1 | E', lead: 'E4:.25 F#4:.25 G#4:.25 B4:.25 C#5:.25 E5:.25 F#5:.5 E5:.5 C#5:.5 B5:1 | G#5:1 F#5:.5 G#5:.5 E5:2', bass: 'E2:1 C#2:1 A1:1 B1:1 | E2:3 r:1', lufs: -14.5 },
  3: { bars: 3, chords: 'C#m:2 A:2 | F#m:2 B:2 | E', lead: 'G#4:.25 C#5:.25 E5:.25 G#5:.25 E5:.5 C#5:.5 A4:.25 C#5:.25 E5:.25 A5:.25 E5:1 | A4:.25 C#5:.25 F#5:.25 A5:.25 F#5:.5 C#5:.5 B4:.25 D#5:.25 F#5:.25 B5:.25 A5:1 | G#5:.5 F#5:.5 E5:2 r:1', bass: 'C#2:2 A1:2 | F#1:2 B1:2 | E2:3 r:1', lufs: -14 },
};
const lowBass = (notes: NoteEvent[]) => notes.map(n => ({ ...n, n: fitRange(n.n, 28, 45) }));

/** Big-win heads 1–3 in their tier keys (1 E, 2 F#, 3 G#); each climbs and lands on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = HEADS[tier];
  const key = TIER_KEY[tier], lk = leadShift(key);
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, lk), bassNotes = lowBass(melody(spec.bass, 0, 4, key));
  const lastBar = spec.bars - 1, tonic = fitRange(40 + key, 38, 49);
  const kit = tier === 1
    ? hits(steps('kamDum', 'X.......x.......', 0, 1), steps('kamTek', '..x...x...x.xxxX', 0, 1), steps('kamDum', 'X...............', 1, 1), steps('kamJingle', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('kamDum', 'X...x...X...x...', 0, 1), steps('kamTek', '..x...x.xxxxXXXX', 0, 1), steps('kamDum', 'X...............', 1, 1), steps('kamJingle', 'X...x...........', 1, 1), hoofTriplets(0, 1, 0.6))
      : hits(steps('kamDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('kamTek', 'x.x.x.x.xxxxXXXX', 1, 1), steps('kamDum', 'X...............', 2, 1), steps('kamJingle', 'X.......X.......', 2, 1), hoofTriplets(0, 2, 0.75));
  const tracks: Track[] = [
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -19, send: 0.3, bright: 1.15, notes: tremolo(lead, 1.5, 0.125) },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -24 + tier, send: 0.4, pan: 0.22, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.8) },
    { id: 'ostinato', kind: 'pitched', voice: 'kopuz', level: -25, send: 0.2, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 55 + Math.min(4, key), 76, 0.7) },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -25, send: 0.5, width: 1.6, chords: pads(chords, 4, 59, 81, 0.75) },
    ...(tier >= 2 ? [{ id: 'choir', kind: 'pad' as const, voice: 'padChoir' as const, level: -23.5, send: 0.5, width: 1.6, chords: pads(chords, 4, 57, 76, 0.8) }] : []),
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -26, send: 0.3, notes: [{ t: 0, d: spec.bars * 4 - 0.2, n: tonic, v: 0.75 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: bassNotes },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, hits: kit },
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -24.5, send: 0.5, pan: 0.3, notes: [{ t: lastBar * 4, d: 2, n: nearest((4 + key) % 12, 88), v: 0.9 }, { t: lastBar * 4 + 0.02, d: 2, n: nearest((11 + key) % 12, 83), v: 0.65 }] },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, width: 1.5, fx: [
      { t: 0, d: 1.5, k: 'sparkle', v: 0.75, density: 18, notes: SPARK, shape: 'decay' }, { t: lastBar * 4, d: 2, k: 'sparkle', v: 0.85, density: 26, notes: SPARK, shape: 'decay' },
      ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.5 }, { t: 6, d: 2, k: 'swell' as const, v: 0.35 }] : []),
    ] },
  ];
  return {
    id: `asena-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2.6, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'E', 'F#', 'G#'][tier]} major pentatonic, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): a kopuz climb with dombra tremolo on the long notes over a 16th kopuz ostinato, the kıl kopuz an octave below, aurora pad${tier >= 2 ? ', wordless choir, hoofbeat triplets' : ''}, the throat drone on the tonic, kam davulu${tier === 3 ? ', a riser and double-time drum' : ''}; it lands on a held tonic with star bells, the drum's pendants and a star shower.`,
    tracks,
  };
}

/** Big win tier 4 — "Efsane", B major pentatonic, 120 BPM, 3 bars (6 s): the most radiant head. */
const EFSANE_LEAD = 'B4:.25 E5:.25 G#5:.25 B5:.25 E6:1 B5:.5 C#6:.5 A5:1 | A5:.5 G#5:.25 F#5:.25 A5:1 B5:.5 C#6:.5 D#5:.5 F#5:.5 | E5:3 r:1';
const EFSANE_CHORDS = 'E:2 A:2 | F#m:2 B:2 | E';
function legend(): Score {
  const key = TIER_KEY[4], lk = leadShift(key);
  const chords = shiftChords(progression(EFSANE_CHORDS), key), lead = melody(EFSANE_LEAD, 0, 4, lk);
  const tonic = fitRange(40 + key, 38, 49);
  return {
    id: 'asena-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Big win tier 4 (Efsane), B major pentatonic, 120 BPM, 3 bars (6 s): I – IV | ii – V | I. Kopuz lead with tremolo, the kıl kopuz doubling an octave below, full choir, aurora pad, throat drone, star bells on every downbeat, hoofbeat triplets, a kam davulu roll into the last bar and two star showers.',
    tracks: [
      { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -19, send: 0.3, bright: 1.2, notes: tremolo(lead, 1, 0.125) },
      { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -21.5, send: 0.4, pan: 0.2, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.85) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.95) },
      { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -24.5, send: 0.5, width: 1.7, chords: pads(chords, 4, 59, 81, 0.75) },
      { id: 'ostinato', kind: 'pitched', voice: 'kopuz', level: -25, send: 0.2, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 57, 78, 0.7) },
      { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -25.5, send: 0.3, notes: [{ t: 0, d: 11.8, n: tonic, v: 0.8 }] },
      { id: 'bells', kind: 'pitched', voice: 'starBell', level: -23.5, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 88, v: 0.8 }, { t: 4, d: 2, n: 90, v: 0.75 }, { t: 8, d: 2, n: 95, v: 0.9 }, { t: 8.02, d: 2, n: 87, v: 0.7 }] },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20.5, send: 0, notes: lowBass(melody('B1:2 E2:2 | C#2:2 F#1:2 | B1:3 r:1')) },
      { id: 'kit', kind: 'kit', level: -21.5, send: 0.16, hits: hits(steps('kamDum', 'X...x...X...x...', 0, 2), steps('kamTek', 'x.x.x.x.x.x.xxxx', 1, 1), ...Array.from({ length: 8 }, (_, i) => [{ t: 6 + i * 0.25, k: 'kamTek', v: 0.45 + i * 0.07 }]), steps('kamDum', 'X...............', 2, 1), steps('kamJingle', 'X.......X.......', 2, 1), hoofTriplets(0, 2, 0.75)) },
      { id: 'fx', kind: 'fx', level: -24.5, send: 0.35, width: 1.5, fx: [{ t: 0, d: 1.5, k: 'sparkle', v: 0.85, density: 20, notes: SPARK, shape: 'decay' }, { t: 4, d: 4, k: 'riser', v: 0.5 }, { t: 8, d: 2, k: 'sparkle', v: 0.95, density: 30, notes: SPARK, shape: 'decay' }] },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), legend()] as const;

/**
 * Count-up beds: a 4-bar I – bVII – IV – I/V loop at 120 BPM per tier, in the tier's key, layered more fully per tier:
 * 1 kopuz 16ths, throat drone, bass, kam davulu pulse · 2 + drum groove, aurora pad, pendants · 3 + kopuz lead and
 * hoofbeat triplets · 4 + choir, star bells, deep strokes · max + the kıl kopuz singing the lead an octave below and a
 * star shimmer.
 */
const BED_CHORDS = progression('E | D | A | E:2 B:2');
const BED_LEAD = 'B4:.75 G#4:.25 B4:.5 E5:1.5 F#5:.5 G#5:.5 | A5:.75 F#5:.25 D5:.5 F#5:1.5 E5:.5 D5:.5 | C#5:.75 E5:.25 A5:.5 C#6:1 B5:.5 A5:.5 E5:.5 | G#5:1 B5:1 A5:.5 G#5:.5 F#5:1';
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tonic = fitRange(40 + key, 38, 49);
  const tracks: Track[] = [
    { id: 'ostinato', kind: 'pitched', voice: 'kopuz', level: -23, send: 0.2, pan: 0.4, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 55 + Math.min(4, key), 76, 0.7, 3, 0.6) },
    { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -27, send: 0.3, notes: [{ t: 0, d: 15.6, n: tonic, v: 0.75 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.8, 40, 28, 45) },
    { id: 'perc', kind: 'kit', level: -27, send: 0.16, hits: hits(steps('kamDum', 'x.......x.......', 0, 4), steps('kamTek', '....x.......x...', 0, 4)) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'groove', kind: 'kit', level: -23, send: 0.12, hits: steps('kamDum', 'X...x...X...x...', 0, 4) });
    tracks.push({ id: 'aurora', kind: 'pad', voice: 'padAurora', level: -25.5, send: 0.5, width: 1.6, chords: pads(chords, 4, 59, 81, 0.7) });
    tracks.push({ id: 'jingle', kind: 'kit', level: -30, send: 0.35, hits: [0, 8].map(t => ({ t, k: 'kamJingle', v: 0.7 })) });
  }
  if (level >= 3) {
    tracks.push({ id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -20, send: 0.3, bright: 1.05, notes: melody(BED_LEAD, 0, 4, lk) });
    tracks.push({ id: 'hoof', kind: 'kit', level: -28, send: 0.1, hits: hoofTriplets(0, 4, 0.7) });
  }
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.85) });
    tracks.push({ id: 'bells', kind: 'pitched', voice: 'starBell', level: -26, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 86), v: 0.7 })) });
    tracks.push({ id: 'low', kind: 'kit', level: -27, send: 0.25, hits: chords.flatMap(c => [{ t: c.t, k: 'kamDum', v: 0.9 }, { t: c.t + c.d - 0.5, k: 'kamTek', v: 0.5 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -24, send: 0.42, pan: -0.25, notes: vel(melody(BED_LEAD, 0, 4, lk - 12).filter(n => n.d >= 0.5), 0.75) });
    tracks.push({ id: 'fx', kind: 'fx', level: -29, send: 0.35, fx: [{ t: 0, d: 7, k: 'sparkle', v: 0.6, density: 3, notes: SPARK, shape: 'flat' }, { t: 8, d: 7, k: 'sparkle', v: 0.6, density: 3, notes: SPARK, shape: 'flat' }] });
  }
  const keyName = ['E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#'][key];
  return {
    id: `asena-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -5.5,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – bVII – IV – I/V in ${keyName} major at 120 BPM, 4-bar seamless loop (8 s); ${['kopuz 16ths, throat drone, bass, kam davulu pulse', '+ drum groove, aurora pad, pendants', '+ kopuz lead and hoofbeat triplets', '+ choir, star bells, deep strokes', '+ the kıl kopuz an octave below and a star shimmer'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/** Max win — the top of the ladder: C# major pentatonic, 120 BPM, 3 bars (6 s), IV – V – bVII – I. */
const MAX_LEAD = 'A4:.5 C#5:.5 E5:.5 A5:.5 C#6:2 | B4:.5 D#5:.5 F#5:.5 B5:.5 A5:1 D6:1 | B5:.25 E6:.25 G#5:.5 B5:.5 E6:2.5';
const MAX_CHORDS = 'A | B:2 D:2 | E';
function maxWin(): Score {
  const key = TIER_KEY.max, lk = leadShift(key);
  const chords = shiftChords(progression(MAX_CHORDS), key), lead = melody(MAX_LEAD, 0, 4, lk);
  const tonic = fitRange(40 + key, 38, 49);
  return {
    id: 'asena-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3.2, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Max win, C# (top of the key ladder), 120 BPM, 3 bars (6 s): IV – V – bVII – I (F# – G# – B – C#) with kopuz and kıl kopuz in octaves, dombra tremolo, full choir and aurora, throat drone, star bells climbing, a 16th kopuz ostinato, a kopuz strum, double-time kam davulu with a roll and its pendants, hoofbeat triplets and the biggest star shower.',
    tracks: [
      { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -19, send: 0.3, bright: 1.25, notes: tremolo(lead, 1, 0.125) },
      { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -20.5, send: 0.4, notes: vel(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.9) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -21, send: 0.5, width: 1.8, chords: pads(chords, 4, 57, 78, 0.95) },
      { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -24, send: 0.5, width: 1.8, chords: pads(chords, 4, 61, 83, 0.8) },
      { id: 'ostinato', kind: 'pitched', voice: 'kopuz', level: -25, send: 0.2, pan: 0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'drone', kind: 'pitched', voice: 'khoomei', level: -25.5, send: 0.3, notes: [{ t: 0, d: 11.8, n: tonic, v: 0.8 }] },
      { id: 'bells', kind: 'pitched', voice: 'starBell', level: -23, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 85, v: 0.8 }, { t: 4, d: 1, n: 87, v: 0.8 }, { t: 6, d: 1, n: 90, v: 0.8 }, { t: 8, d: 2, n: 92, v: 0.95 }, { t: 8.02, d: 2, n: 85, v: 0.75 }] },
      { id: 'strum', kind: 'pitched', voice: 'kopuz', level: -23, send: 0.25, notes: strum(8, [49, 56, 61, 65, 68], 3, 0.95) },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20, send: 0, notes: lowBass(melody('F#1:.5 F#1:.5 F#1:.5 F#1:.5 F#1:.5 F#1:.5 F#1:.5 F#1:.5 | G#1:.5 G#1:.5 G#1:.5 G#1:.5 B1:.5 B1:.5 B1:.5 B1:.5 | C#2:3 r:1')) },
      { id: 'kit', kind: 'kit', level: -20.5, send: 0.16, hits: hits(steps('kamDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('kamTek', 'x.x.x.x.xxxxxxxx', 0, 2), ...Array.from({ length: 12 }, (_, i) => [{ t: 5 + i * 0.25, k: 'kamTek', v: 0.4 + i * 0.05 }]), steps('kamDum', 'X...............', 2, 1), steps('kamJingle', 'X...X...........', 2, 1), hoofTriplets(0, 2, 0.8)) },
      { id: 'fx', kind: 'fx', level: -23.5, send: 0.35, width: 1.6, fx: [{ t: 0, d: 2, k: 'sparkle', v: 0.85, density: 20, notes: SPARK, shape: 'decay' }, { t: 0, d: 8, k: 'riser', v: 0.4 }, { t: 8, d: 3, k: 'sparkle', v: 1, density: 34, notes: SPARK, shape: 'decay' }] },
    ],
  };
}
export const MAX_WIN = maxWin();

/** Total-win fanfare (end of the feature): E major pentatonic, 120 BPM, a festive kopuz flourish, 4 s to its musical end. */
const TOTAL_LEAD = 'E4:.25 G#4:.25 B4:.5 r:.25 B4:.25 C#5:.25 D#5:.25 E5:.5 F#5:.5 G#5:.5 F#5:.5 | A5:.5 F#5:.5 E5:3';
export const TOTAL_WIN: Score = {
  id: 'asena-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.4, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win fanfare, E major pentatonic, 120 BPM, 4 s: E – C#m – A | B – E. A festive kopuz flourish with the kıl kopuz doubling, kopuz strums, aurora pad, choir on the final E with star bells, kam davulu with its pendants, hoofbeat triplets and a star shower.',
  tracks: [
    { id: 'kopuz', kind: 'pitched', voice: 'kopuz', level: -19, send: 0.28, bright: 1.15, notes: tremolo(melody(TOTAL_LEAD), 1.5, 0.125) },
    { id: 'kil', kind: 'pitched', voice: 'kilKopuz', level: -22, send: 0.4, pan: 0.25, notes: vel(melody(TOTAL_LEAD, 0, 4, -12).filter(n => n.d >= 0.5), 0.8) },
    { id: 'strum', kind: 'pitched', voice: 'kopuz', level: -24, send: 0.25, pan: -0.35, bright: 0.7, notes: [...strum(0, [52, 56, 59, 64], 0.8, 0.8), ...strum(1, [52, 56, 59, 64], 0.8, 0.7), ...strum(2, [49, 52, 56, 61], 0.8, 0.75), ...strum(3, [45, 49, 52, 57], 0.8, 0.75), ...strum(4, [47, 51, 54, 59], 0.8, 0.8), ...strum(5, [52, 56, 59, 64, 68], 3, 0.85)] },
    { id: 'aurora', kind: 'pad', voice: 'padAurora', level: -25, send: 0.5, width: 1.6, chords: pads(progression('E:2 C#m:1 A:1 | B:1 E:3'), 4, 59, 81, 0.7) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.6, chords: [{ t: 5, d: 3, ns: [56, 59, 64, 68], v: 0.9 }] },
    { id: 'bells', kind: 'pitched', voice: 'starBell', level: -24, send: 0.5, notes: [{ t: 5, d: 3, n: 88, v: 0.85 }, { t: 5.5, d: 2.5, n: 83, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: lowBass(melody('E2:2 C#2:1 A1:1 | B1:1 E2:2 r:1')) },
    { id: 'kit', kind: 'kit', level: -22, send: 0.16, hits: hits(steps('kamDum', 'X...x...X...x...', 0, 1), steps('kamTek', '..x...x.xxxxXXXX', 0, 1), steps('kamDum', 'X...x...........', 1, 1), steps('kamJingle', '....X...........', 1, 1), hoofTriplets(0, 1, 0.6)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, width: 1.5, fx: [{ t: 3, d: 2, k: 'swell', v: 0.3 }, { t: 5, d: 2, k: 'sparkle', v: 0.9, density: 26, notes: SPARK, shape: 'decay' }] },
  ],
};

/** Ambience bed: a steppe night — wind over the grass with far gusts, crickets and a distant camp fire; 24 s loop. */
export const AMBIENCE: Score = {
  id: 'asena-ambience', bpm: 60, beatsPerBar: 4, bars: 6, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -8,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 24 s seamless loop: a steppe night — wind over open grass with slow far gusts, a faint whistle wandering through the grass, two distant crickets and a far camp fire (low flame roar and sparse crackles); no tempo-bound material.',
  tracks: [
    { id: 'steppe', kind: 'fx', level: -31, send: 0.12, width: 1.4, fx: [{ t: 0, d: 24, k: 'steppe', v: 1, density: 1 }] },
  ],
};

export const ASENA_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, retrigger: RETRIGGER, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, ambience: AMBIENCE,
} as const;
export type AsenaScoreId = keyof typeof ASENA_SCORES;

/**
 * Crest-factor control (render.ts `tame`) for the transient-heavy stems, so coincident drum, hoof and lute attacks do
 * not drive the master limiter: drums 12 dB, plucked lute 13 dB, star bells 14 dB above their gated RMS. The ambience
 * is left untouched.
 */
for (const score of Object.values(ASENA_SCORES)) {
  if (score === AMBIENCE) continue;
  for (const track of score.tracks) {
    if (track.tame !== undefined) continue;
    if (track.kind === 'kit') track.tame = 12;
    else if (track.kind === 'pitched' && (track.voice === 'kopuz' || track.voice === 'kopuzMute')) track.tame = 13;
    else if (track.kind === 'pitched' && track.voice === 'starBell') track.tame = 14;
  }
}
export const ASENA_SCORE_IDS = Object.keys(ASENA_SCORES) as AsenaScoreId[];
