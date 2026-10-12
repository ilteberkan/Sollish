/**
 * Tarhun: Fırtına Tahtı music — original compositions written as note data for an Anatolian Bronze Age
 * storm-god world (the Lion Gate citadel, bulls, thunder and rain). Melodies, harmony, bass lines and
 * grooves were written for this game; no existing game's, film's or song's melody, motif or sound is
 * quoted or imitated, and no commercial slot score is imitated.
 *
 * Modal colour: the base theme is in A Hicaz (A Bb C# D E F G — the Phrygian-dominant scale with its
 * augmented second Bb→C#), the feature theme in D Hicaz (D Eb F# G A Bb C), kept tonal: cadences land on
 * a major tonic through the half step above it (bII → I). The recurring signature — the "storm call" —
 * is the hook's opening gesture: a run up A–Bb–C# to an ornamented D that falls back to C#.
 * Instruments are synthesized (synth/anatolian.ts): zurna-like reed, ney-like flute, bağlama-like plucked
 * courses with sympathetic strings, low horns, male "oh" choir, davul, darbuka, frame drum, taiko, bronze.
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score, Track } from './types';
import { CELEBRATION_BPM, TIER_KEY, type WinTier } from '../win-tiers';

/* ---------------- arranging helpers ---------------- */

function pads(chords: ChordEvent[], count: number, lo: number, hi: number, v: number): PadEvent[] {
  let prev: number[] | null = null;
  return chords.map(c => { const ns = voice(c.tones, count, lo, hi, prev); prev = ns; return { t: c.t, d: c.d, ns, v }; });
}

type BassStyle = 'half' | 'long' | 'pedal' | 'drive' | 'davul';
/** Bass from chord roots (A1–A2 register). 'davul' locks to the davul pattern (1, 2½, 3½). */
function bassLine(chords: ChordEvent[], styleOf: BassStyle | ((bar: number) => BassStyle | null), v: number, centre = 38): NoteEvent[] {
  const out: NoteEvent[] = [];
  const fit = (n: number) => { let x = n; while (x > 47) x -= 12; while (x < 31) x += 12; return x; };
  chords.forEach(c => {
    const root = fit(nearest(c.bass, centre)), fifth = root + 7 > 50 ? root - 5 : root + 7;
    const style = typeof styleOf === 'function' ? styleOf(Math.floor(c.t / 4)) : styleOf;
    const push = (t: number, n: number, d: number, vel: number) => { if (t < c.d - 1e-9) out.push({ t: c.t + t, n, d: Math.min(d, c.d - t), v: vel }); };
    switch (style) {
      case null: break;
      case 'pedal': push(0, root, c.d - 0.1, v); break;
      case 'long': push(0, root, Math.min(c.d, 4) - 0.1, v); if (c.d > 4) push(4, root, c.d - 4.1, v * 0.9); break;
      case 'half': push(0, root, 1.9, v); if (c.d >= 4) push(2, fifth, 1.9, v * 0.85); break;
      case 'davul':
        push(0, root, 1.4, v);
        if (c.d >= 3) push(1.5, root, 0.9, v * 0.8);
        if (c.d >= 4) { push(2.5, fifth, 0.45, v * 0.75); push(3, root, 0.9, v * 0.85); }
        break;
      case 'drive': for (let k = 0; k < c.d * 2; k++) push(k * 0.5, k % 4 === 3 ? fifth : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.72 : v); break;
    }
  });
  return out;
}

/** Plucked ostinato over each chord's voicing; indices past the voicing climb an octave. */
function ostinato(chords: ChordEvent[], pattern: number[], step: number, lo: number, hi: number, v: number, count = 3, accent = 0.75): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const vs = voice(c.tones, count, lo, hi, prev); prev = vs;
    let root = nearest(c.root, vs[0]!);
    while (root >= vs[0]!) root -= 12;
    const n = Math.round(c.d / step);
    for (let s = 0; s < n; s++) {
      const idx = pattern[s % pattern.length]!;
      // index -1 is the root drone below the voicing (the bağlama's open lower course)
      const note = idx < 0 ? root : vs[idx % count]! + 12 * Math.floor(idx / count);
      out.push({ t: c.t + s * step, d: step * 0.95, n: note, v: v * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.85 : accent) });
    }
  }
  return out;
}

/** Bağlama tremolo: notes of at least `min` beats are re-struck every `rate` beats (alternate strokes softer). */
function tremolo(notes: NoteEvent[], min = 1, rate = 0.25): NoteEvent[] {
  return notes.flatMap(n => {
    if (n.d < min - 1e-9) return [n];
    const k = Math.round(n.d / rate);
    return Array.from({ length: k }, (_, i) => ({ t: n.t + i * rate, d: rate, n: n.n, v: n.v * (i === 0 ? 1 : i % 2 ? 0.62 : 0.74) }));
  });
}

const within = (chords: ChordEvent[], fromBar: number, toBar: number, bpb = 4) => chords.filter(c => c.t >= fromBar * bpb - 1e-9 && c.t < toBar * bpb - 1e-9);
const hits = (...lists: HitEvent[][]) => lists.flat();
const shiftNotes = (notes: NoteEvent[], k: number): NoteEvent[] => notes.map(n => ({ ...n, n: n.n + k }));
const shiftChords = (chords: ChordEvent[], k: number): ChordEvent[] => chords.map(c => ({ ...c, root: (c.root + k + 12) % 12, tones: c.tones.map(t => (t + k + 12) % 12), bass: (c.bass + k + 12) % 12 }));

/* =====================================================================================
 * BASE THEME — "Aslanlı Kapı" (The Lion Gate)
 * A Hicaz, 96 BPM straight, 18 bars = 45.0 s seamless loop.
 * Form: A (8 bars: the 4-bar "storm call" hook on zurna, then its answer climbing to C#6 with a low horn
 *       counter-line) · B (6 bars: D minor turn (iv) — bağlama melody with tremolo over the male "oh"
 *       choir and horn swells, davul in half time, a thunder crack on the downbeat) · C (4 bars: breakdown
 *       — ney plays the hook slowed down over a drone and darbuka, davul fill and a cymbal swell back into A).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  A | Gm:2 A:2 | Gm:2 Dm:2 | Dm:1 Bb:1 A:2 |
  F:2 Dm:2 | Gm:2 A:2 | Dm:2 Gm:1 A:1 | A:2 Gm:1 A:1 |
  Dm | Bb | C | F | Gm:2 Dm:2 | Gm:1 A:3 |
  A | A | Gm:2 A:2 | A`);

/** The 4-bar hook ("storm call"): up A–Bb–C# to an ornamented D, the augmented-second sigh, a rise to F and the Hicaz cadence Bb–C#–A. */
export const STORM_HOOK = `
  A4:.5 Bb4:.25 C#5:.25 E5:.125 D5:.875 E5:.5 D5:.5 C#5:1 |
  Bb4:.5 C#5:.5 E5:.75 D5:.25 C#5:.5 Bb4:.5 C#5:.125 A4:.875 |
  G4:.5 A4:.5 Bb4:.5 D5:.5 F5:1 E5:.5 D5:.5 |
  E5:.5 F5:.25 E5:.25 D5:.5 C#5:.5 Bb4:.75 C#5:.25 A4:1`;
const BASE_ANSWER = `
  A5:.75 G5:.25 F5:.5 E5:.5 F5:.5 G5:.5 A5:1 |
  Bb5:.5 A5:.5 G5:.5 F5:.5 E5:1 C#5:.5 E5:.5 |
  D5:.5 E5:.5 F5:.5 G5:.5 A5:.5 Bb5:.5 C#6:.5 Bb5:.5 |
  A5:1.5 G5:.25 F5:.25 E5:.5 D5:.5 C#5:.5 E5:.5`;
const BASE_COUNTER = `A3:2 F3:2 | G3:2 E3:2 | F3:2 D3:1 E3:1 | C#3:2 D3:1 E3:1`;
const BASE_BRIDGE = `
  D5:1 F5:.5 E5:.5 D5:.5 A4:.5 D5:1 |
  F5:1 Bb5:.5 A5:.5 G5:.5 F5:.5 D5:1 |
  E5:1 G5:.5 F5:.5 E5:.5 C5:.5 E5:1 |
  A5:1.5 G5:.5 F5:.5 E5:.5 F5:1 |
  G5:.5 A5:.5 Bb5:1 A5:.5 G5:.5 F5:1 |
  E5:.5 F5:.25 E5:.25 D5:.5 C#5:.5 Bb4:.5 C#5:.5 E5:1`;
const BASE_NEY = `
  A4:1 Bb4:.5 C#5:.5 D5:2 |
  E5:1.5 D5:.5 C#5:1 Bb4:.5 C#5:.5 |
  D5:.5 E5:.5 F5:1 E5:.5 D5:.5 C#5:1 |
  A4:2 r:2`;

const baseDrums = hits(
  // A: davul boom on 1, 2½, 3½ with the stick on the backbeats; a short stick fill into bar 4 and into B
  steps('davul', 'X.....x...x.....', 0, 7), steps('davulRim', '....x.o.....x.o.', 0, 7),
  steps('davul', 'X.....x...x.....', 7, 1), steps('davulRim', '....x.o.x.x.xxxX', 7, 1),
  // B: half time
  steps('davul', 'X.......o.......', 8, 6), steps('frame', '........x.......', 8, 6),
  // C: breakdown, then the fill back into the hook
  steps('frame', 'x.......x.......', 14, 3),
  steps('davul', 'x...x...x.x.XxXX', 17, 1), steps('davulRim', 'x.x.x.x.xxxxXXXX', 17, 1, 0.9),
);
const baseHand = hits(
  steps('dum', 'x.........x.....', 0, 8), steps('tek', '....x.......x...', 0, 8), steps('ka', '..g...g.g...g.gg', 0, 8),
  steps('tek', '....o.......o...', 8, 6), steps('ka', 'g.g.g.g.g.g.g.g.', 8, 6, 0.8),
  steps('dum', 'x.....x...x.....', 14, 3), steps('tek', '....x.......x.x.', 14, 3), steps('ka', '..g.g...g...g...', 14, 3),
  steps('dum', 'x...............', 17, 1), steps('tek', '....x.x.x.x.xxxx', 17, 1, 0.8),
);
const baseFx: FxEvent[] = [
  { t: 8 * 4, d: 3, k: 'thunder', v: 0.8 },
  { t: 8 * 4 + 0.5, d: 10, k: 'rumble', v: 0.7, density: 0.7 },
  { t: 14 * 4, d: 8, k: 'rumble', v: 0.55, density: 0.9 },
  { t: 17 * 4 + 1, d: 3, k: 'swell', v: 0.45 },
];

export const BASE_THEME: Score = {
  id: 'storm-base', bpm: 96, beatsPerBar: 4, bars: 18, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -15, measure: 'integrated' },
  about: 'A Hicaz (A Bb C# D E F G), 96 BPM, 18-bar seamless loop (45 s). A: the 4-bar "storm call" hook on a zurna-like reed (ornamented), its answer with a low horn counter-line · B: D minor (iv) — bağlama melody with tremolo over a male "oh" choir and horn swells, davul half time, thunder crack · C: breakdown — ney plays the hook slowed over a drone and darbuka, davul fill and cymbal swell into A. Bağlama ostinato, round bass, davul with stick, darbuka dum/tek/ka, frame drum, taiko and bronze gong accents.',
  tracks: [
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -20, send: 0.3, pan: 0.04, notes: [...melody(STORM_HOOK, 0), ...melody(BASE_ANSWER, 4)], bright: 1 },
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -21.5, send: 0.3, pan: -0.15, notes: tremolo(melody(BASE_BRIDGE, 8)), bright: 0.8 },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.45, pan: 0.1, notes: melody(BASE_NEY, 14) },
    {
      id: 'ostinato', kind: 'pitched', voice: 'baglama', level: -26, send: 0.22, pan: 0.42, bright: 0.5,
      notes: [...ostinato(within(BASE_CHORDS, 0, 8), [-1, 0, 2, 1, -1, 2, 1, 0], 0.5, 57, 72, 0.7), ...ostinato(within(BASE_CHORDS, 14, 17), [-1, 1, 2, 1], 1, 57, 72, 0.55)],
    },
    { id: 'hornline', kind: 'pitched', voice: 'hornSwell', level: -24.5, send: 0.3, pan: -0.3, notes: melody(BASE_COUNTER, 4).map(n => ({ ...n, v: 0.7 })), bright: 0.8 },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -24.5, send: 0.45, width: 1.6, chords: pads(within(BASE_CHORDS, 8, 14), 4, 45, 64, 0.8) },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -26, send: 0.35, width: 1.4, chords: [...pads(within(BASE_CHORDS, 8, 14), 3, 45, 60, 0.75), ...pads(within(BASE_CHORDS, 3, 4), 3, 45, 60, 0.6)] },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -29, send: 0.3, width: 1.5, chords: [{ t: 0, d: 32, ns: [45, 52, 57], v: 0.55 }, { t: 56, d: 16, ns: [45, 52, 57], v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0.03, notes: bassLine(BASE_CHORDS, bar => (bar < 8 ? 'davul' : bar < 14 ? 'long' : 'pedal'), 0.85) },
    { id: 'davul', kind: 'kit', level: -23, send: 0.12, hits: baseDrums },
    { id: 'hand', kind: 'kit', level: -26, send: 0.16, width: 1.4, hits: baseHand },
    { id: 'taiko', kind: 'kit', level: -27, send: 0.25, hits: [{ t: 0, k: 'taiko', v: 0.9 }, { t: 16, k: 'taiko', v: 0.6 }, { t: 32, k: 'taiko', v: 1 }, { t: 56, k: 'taikoLo', v: 0.6 }] },
    { id: 'gong', kind: 'pitched', voice: 'bronze', level: -28, send: 0.5, pan: 0.3, bright: 1.4, notes: [{ t: 0, d: 4, n: 45, v: 0.7 }, { t: 32, d: 4, n: 50, v: 0.8 }] },
    { id: 'fx', kind: 'fx', level: -27, send: 0.35, width: 1.5, fx: baseFx },
  ],
};

/* IDLE — the A section re-orchestrated for attract mode: ney and a drone, a few bağlama plucks, soft frame
   drum; no davul or zurna. Same tempo as base bars 1–8, so idle ↔ base cross-fades stay phase-aligned. */
export const IDLE_THEME: Score = {
  id: 'storm-idle', bpm: 96, beatsPerBar: 4, bars: 8, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -4,
  target: { lufs: -17, measure: 'integrated' },
  about: 'A Hicaz, 96 BPM, 8-bar loop (20 s): the hook and its answer on a breathy ney over an A–E drone, sparse bağlama plucks, low horn swells at the cadences and a soft frame drum; no davul.',
  tracks: [
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -20, send: 0.5, pan: 0.1, notes: [...melody(STORM_HOOK, 0), ...melody(BASE_ANSWER, 4, 4, -12)].map(n => ({ ...n, v: 0.7 })) },
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -25, send: 0.35, pan: -0.35, bright: 0.4, notes: ostinato(within(BASE_CHORDS, 0, 8), [-1, 2], 2, 57, 72, 0.6) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -25, send: 0.35, width: 1.6, chords: [{ t: 0, d: 32, ns: [45, 52, 57, 64], v: 0.5 }] },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -28, send: 0.45, width: 1.4, chords: [{ t: 12, d: 4, ns: [45, 52, 57], v: 0.5 }, { t: 28, d: 4, ns: [45, 52, 61], v: 0.5 }] },
    { id: 'frame', kind: 'kit', level: -30, send: 0.25, hits: hits(steps('frame', 'o.......o.......', 0, 8), steps('ka', '....g.......g...', 0, 8)) },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Gök Gürültüsü" (The Thunder)
 * D Hicaz (D Eb F# G A Bb C), 116 BPM straight, 16 bars = 33.1 s loop.
 * Form: A (8 bars: driving zurna riff over a 16th bağlama ostinato and syncopated horn stabs, davul in
 *       double time) · B (8 bars: the riff's answer climbs to F#6, male choir and horn swells, taiko on
 *       every downbeat, darbuka 16ths), riser and drum fill back into A.
 * ===================================================================================== */

const FEAT_CHORDS = progression(`
  D | Eb:2 D:2 | Cm:2 Gm:2 | Gm:1 Eb:1 D:2 | D | Cm:2 D:2 | Gm:2 Cm:2 | Eb:2 D:2 |
  Gm | Eb | Cm | D | Gm:2 Cm:2 | D | Cm:2 Eb:2 | D`);
const FEAT_RIFF = `
  D5:.5 Eb5:.25 F#5:.25 G5:.5 A5:.5 Bb5:.5 A5:.5 G5:.5 F#5:.5 |
  G5:.75 F#5:.25 Eb5:.5 F#5:.5 D5:1 r:.5 A4:.5 |
  C5:.5 Eb5:.5 G5:.75 F#5:.25 G5:.5 Bb5:.5 A5:1 |
  Bb5:.5 A5:.5 G5:.5 F#5:.5 Eb5:.75 F#5:.25 D5:1 |
  D5:.5 Eb5:.25 F#5:.25 A5:.5 D6:.5 C6:.5 Bb5:.5 A5:1 |
  C6:.5 Bb5:.5 A5:.5 G5:.5 F#5:1 A5:1 |
  G5:.5 A5:.5 Bb5:.5 C6:.5 D6:.5 Eb6:.5 D6:.5 C6:.5 |
  Bb5:.5 C6:.25 Bb5:.25 A5:.5 G5:.5 F#5:.5 Eb5:.5 D5:1`;
const FEAT_ANSWER = `
  G5:1 Bb5:.5 A5:.5 G5:.5 D5:.5 G5:1 |
  Bb5:1 Eb6:.5 D6:.5 C6:.5 Bb5:.5 G5:1 |
  C6:1 Eb6:.5 D6:.5 C6:.5 G5:.5 C6:1 |
  D6:1.5 C6:.5 Bb5:.5 A5:.5 F#5:1 |
  G5:.5 Bb5:.5 D6:1 Eb6:.5 D6:.5 C6:1 |
  D6:.5 Eb6:.5 F#6:1 Eb6:.5 D6:.5 C6:1 |
  Bb5:.5 A5:.5 G5:.5 Eb6:.5 D6:.5 C6:.5 Bb5:.5 A5:.5 |
  G5:.5 F#5:.5 Eb5:.5 D5:.5 r:1 A4:.5 C5:.5`;

/** Syncopated horn stabs on the A section (3+3+2 accents) on each chord's lower voicing. */
function stabs(chords: ChordEvent[], pattern: string, v: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const vs = voice(c.tones, 3, 50, 64, prev); prev = vs;
    for (let s = 0; s < 16; s++) {
      const t = s / 4;
      if (pattern[s] !== 'x' || t >= c.d - 1e-9) continue;
      for (const n of vs) out.push({ t: c.t + t, d: 0.3, n, v });
    }
  }
  return out;
}

const featDrums = hits(
  steps('davul', 'X...x.x.X...x.x.', 0, 15), steps('davulRim', '..x...x...x...x.', 0, 15), steps('davulRim', '.g.g.g.g.g.g.g.g', 8, 7, 0.7),
  steps('davul', 'X...x.x.x.x.XxXX', 15, 1), steps('davulRim', 'x.x.x.x.xxxxXXXX', 15, 1, 0.9),
);
const featHand = hits(
  steps('dum', 'x..x....x.......', 0, 16), steps('tek', '....x.......x...', 0, 16), steps('ka', 'gg.gg.g.gg.gg.g.', 0, 16, 0.85),
);

export const FEATURE_THEME: Score = {
  id: 'storm-feature', bpm: 116, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -6,
  target: { lufs: -14.5, measure: 'integrated' },
  about: 'D Hicaz (D Eb F# G A Bb C), 116 BPM, 16-bar loop (33.1 s). A: driving zurna riff over a 16th bağlama ostinato and syncopated 3+3+2 horn stabs, davul double time · B: the answer climbs to F#6 with male choir and horn swells, taiko on every downbeat; driving octave bass, darbuka 16ths, thunder on the downbeat, riser and fill back into A.',
  tracks: [
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19.5, send: 0.25, pan: 0.04, notes: [...melody(FEAT_RIFF, 0), ...melody(FEAT_ANSWER, 8)], bright: 1.05 },
    { id: 'zurna2', kind: 'pitched', voice: 'zurnaSoft', level: -26, send: 0.3, pan: -0.35, transpose: -12, notes: melody(FEAT_ANSWER, 8).map(n => ({ ...n, v: 0.6 })), bright: 0.8 },
    { id: 'ostinato', kind: 'pitched', voice: 'baglama', level: -24.5, send: 0.18, pan: 0.4, bright: 0.65, notes: ostinato(FEAT_CHORDS, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 57, 74, 0.7, 3, 0.6) },
    { id: 'stabs', kind: 'pitched', voice: 'horn', level: -24.5, send: 0.25, pan: -0.2, notes: stabs(within(FEAT_CHORDS, 0, 8), 'x..x..x...x.x...', 0.85), bright: 1.1 },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -25, send: 0.35, width: 1.5, chords: pads(within(FEAT_CHORDS, 8, 16), 3, 45, 62, 0.8) },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -24, send: 0.45, width: 1.7, chords: pads(within(FEAT_CHORDS, 8, 16), 4, 45, 64, 0.85) },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21.5, send: 0, notes: bassLine(FEAT_CHORDS, 'drive', 0.85, 38) },
    { id: 'davul', kind: 'kit', level: -21.5, send: 0.1, hits: featDrums },
    { id: 'hand', kind: 'kit', level: -26.5, send: 0.12, width: 1.5, hits: featHand },
    { id: 'taiko', kind: 'kit', level: -25, send: 0.25, hits: [0, ...[8, 9, 10, 11, 12, 13, 14, 15].map(b => b * 4)].map((t, i) => ({ t, k: i === 0 || t === 32 ? 'taikoLo' : 'taiko', v: i === 0 || t === 32 ? 1 : 0.75 })) },
    { id: 'fx', kind: 'fx', level: -27, send: 0.3, width: 1.5, fx: [
      { t: 0, d: 2, k: 'thunder', v: 0.7 }, { t: 32, d: 4, k: 'crash', v: 0.5 }, { t: 32, d: 8, k: 'rumble', v: 0.6, density: 0.6 },
      { t: 15 * 4, d: 4, k: 'riser', v: 0.6 }, { t: 7 * 4 + 2, d: 2, k: 'swell', v: 0.4 },
    ] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Free-spins intro: thunder and a horn call in D Hicaz at the feature tempo; the feature enters at beat 6 (3.10 s). */
export const FS_INTRO: Score = {
  id: 'storm-fs-intro', bpm: 116, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 6,
  about: 'Free-spins intro, D Hicaz, 116 BPM: lightning crack and taiko on the downbeat, a horn call D–A–D–Eb–F#–A over a male-choir swell and a davul roll, the zurna\'s Eb→D appoggiatura and a D major chord with gong and cymbal on beat 4; the feature theme enters at beat 6 (3.10 s).',
  tracks: [
    { id: 'horn', kind: 'pitched', voice: 'horn', level: -19, send: 0.3, notes: melody('D3:.5 A3:.5 D4:1 Eb4:.5 F#4:.5 A4:1 | D4:2.5 r:1.5'), bright: 1.2 },
    { id: 'horn8', kind: 'pitched', voice: 'horn', level: -23, send: 0.3, pan: 0.25, notes: melody('D4:.5 A4:.5 D5:1 Eb5:.5 F#5:.5 A5:1 | D5:2.5 r:1.5'), bright: 0.9 },
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -21, send: 0.3, pan: -0.1, notes: melody('r:3 Eb5:.5 C#5:.125 D5:.375 | D5:2.5 r:1.5'), bright: 1.1 },
    { id: 'chord', kind: 'pad', voice: 'padHorn', level: -22, send: 0.35, width: 1.4, chords: [{ t: 4, d: 2.5, ns: [50, 54, 57, 62], v: 0.95 }] },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22, send: 0.45, width: 1.6, chords: [{ t: 0.5, d: 3.5, ns: [45, 50, 57], v: 0.75 }, { t: 4, d: 2.5, ns: [50, 54, 57, 62], v: 0.95 }] },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: melody('D2:2 Eb2:1 C2:1 | D2:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -21, send: 0.14, hits: hits(steps('taikoLo', 'X...............', 0, 1), steps('davul', '........x.x.xxxx', 0, 1), steps('davulRim', '........xxxxXXXX', 0, 1, 0.9), steps('taiko', 'X.......x.......', 1, 1)) },
    { id: 'gong', kind: 'pitched', voice: 'bronze', level: -25, send: 0.5, bright: 1.5, notes: [{ t: 4, d: 2, n: 38, v: 0.9 }] },
    { id: 'fx', kind: 'fx', level: -23, send: 0.3, fx: [{ t: 0, d: 2, k: 'thunder', v: 1 }, { t: 0.5, d: 3.5, k: 'riser', v: 0.6 }, { t: 4, d: 3, k: 'crash', v: 0.6 }] },
  ],
};

/** Retrigger (+5 spins): a strike and a quick zurna flourish over the feature; musical end at beat 3 (1.55 s). */
export const RETRIGGER: Score = {
  id: 'storm-retrigger', bpm: 116, beatsPerBar: 4, bars: 1, swing: 0.5, loop: false, tail: 1.6, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 3,
  about: 'Retrigger (+5), D Hicaz, 116 BPM, 1 bar: lightning crack and taiko, a 32nd-note zurna flourish A–Bb–C–D–Eb–F# up to a held A5, horn stabs D–A–D on the "and" of 1 and on 2; ends at beat 3 (1.55 s) and rings over the feature theme.',
  tracks: [
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19.5, send: 0.3, notes: melody('A4:.125 Bb4:.125 C5:.125 D5:.125 Eb5:.25 F#5:.25 A5:1.5 r:1.5'), bright: 1.1 },
    { id: 'stabs', kind: 'pitched', voice: 'horn', level: -22, send: 0.3, notes: [1.5, 2].flatMap(t => [50, 57, 62].map(n => ({ t, d: t === 2 ? 0.9 : 0.3, n, v: 0.9 }))), bright: 1.2 },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -22, send: 0, notes: melody('D2:1.5 D2:.5 D2:1 r:1') },
    { id: 'kit', kind: 'kit', level: -21, send: 0.14, hits: hits(steps('taiko', 'X.....x.x.......', 0, 1), steps('davulRim', '....xxxx........', 0, 1)) },
    { id: 'fx', kind: 'fx', level: -23, send: 0.3, fx: [{ t: 0, d: 2, k: 'thunder', v: 0.9 }, { t: 2, d: 2, k: 'crash', v: 0.45 }] },
  ],
};

/** Feature outro: the storm subsides — back to A Hicaz (Gm – Bb – A), calm, 96 BPM; base theme may return at beat 6 (3.75 s). */
export const FS_OUTRO: Score = {
  id: 'storm-fs-outro', bpm: 96, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.5, reverb: 'hall', reverbDb: -4,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 6,
  about: 'Feature outro ("the storm subsides"), A Hicaz, 96 BPM: Gm – Bb – A with a ney phrase falling D–C#–Bb–A and rising to C#, bağlama strums, male choir and soft horn swell, a far rumble; base theme may return at beat 6 (3.75 s).',
  tracks: [
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -19, send: 0.45, notes: melody('D5:.5 C#5:.25 Bb4:.25 A4:1 G4:.5 Bb4:.5 C#5:1 | A4:3 r:1') },
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -23, send: 0.35, pan: -0.3, bright: 0.6, notes: [[0, [55, 62, 67]], [2, [58, 62, 65]], [4, [57, 61, 64, 69]]].flatMap(([t, ns]) => (ns as number[]).map((n, i) => ({ t: (t as number) + i * 0.06, d: 1.5, n, v: 0.75 }))) },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -23, send: 0.45, width: 1.6, chords: pads(progression('Gm:2 Bb:2 | A'), 4, 45, 64, 0.8) },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -26, send: 0.4, chords: [{ t: 4, d: 3, ns: [45, 52, 57], v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0.03, notes: melody('G1:2 Bb1:2 | A1:3 r:1') },
    { id: 'kit', kind: 'kit', level: -27, send: 0.2, hits: hits(steps('frame', 'x.......x.......', 0, 1), steps('taikoLo', 'x...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -28, send: 0.3, fx: [{ t: 0, d: 8, k: 'rumble', v: 0.5, density: 1 }] },
  ],
};

/* =====================================================================================
 * WIN CELEBRATIONS — the shared key ladder (win-tiers.ts TIER_KEY) from A: Büyük A → Mega B → Süper C#
 * → Efsane E → Max win F#, each in Hicaz-major (cadence bII → I). All at 120 BPM so tier-up hits land
 * on one pulse; every tier adds layers.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
/** Melodies above C# are written an octave lower (the tonic still rises; the zurna stays in its sweet register). */
const leadShift = (key: number) => (key > 4 ? key - 12 : key);

/** Big-win heads 1–3 in their tier keys (1 A, 2 B, 3 C#); each ends on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = {
    1: { bars: 2, chords: 'A:2 Bb:1 A:1 | A', lead: 'A4:.25 C#5:.25 E5:.25 A5:.25 E5:.25 A5:.25 C#6:.5 Bb5:1 A5:1 | A5:3 r:1', bass: 'A1:2 Bb1:1 A1:1 | A1:3 r:1', lufs: -15 },
    2: { bars: 2, chords: 'A:1 Dm:1 Bb:1 A:1 | A', lead: 'A4:.25 Bb4:.25 C#5:.25 D5:.25 E5:.25 F5:.25 A5:.5 F5:.5 D5:.5 Bb5:1 | A5:1 G5:.5 A5:.5 C#6:2', bass: 'A1:1 D2:1 Bb1:1 A1:1 | A1:3 r:1', lufs: -14.5 },
    3: { bars: 3, chords: 'Dm:2 Bb:2 | Gm:2 A:2 | A', lead: 'A4:.25 D5:.25 F5:.25 A5:.25 F5:.5 D5:.5 Bb4:.25 D5:.25 F5:.25 Bb5:.25 F5:1 | Bb4:.25 D5:.25 G5:.25 Bb5:.25 G5:.5 D5:.5 C#5:.25 E5:.25 A5:.25 C#6:.25 Bb5:1 | A5:3 r:1', bass: 'D2:2 Bb1:2 | G1:2 A1:2 | A1:3 r:1', lufs: -14 },
  }[tier];
  const key = TIER_KEY[tier], lk = leadShift(key);
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, lk), bassNotes = melody(spec.bass, 0, 4, key).map(n => ({ ...n, n: n.n > 45 ? n.n - 12 : n.n }));
  const lastBar = spec.bars - 1;
  const kit = tier === 1
    ? hits(steps('davul', 'X...x...X...x...', 0, 1), steps('davulRim', '..x...x...x.xxxX', 0, 1), steps('taiko', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('davul', 'X...x.x.X...x.x.', 0, 1), steps('davulRim', '..x...x.xxxxXXXX', 0, 1), steps('tek', '....x.......x...', 0, 1), steps('taiko', 'X...............', 1, 1))
      : hits(steps('davul', 'X.x.x.x.X.x.x.x.', 0, 2), steps('davulRim', 'x.x.x.x.xxxxXXXX', 1, 1), steps('taiko', 'X...............', 0, 1), steps('taikoLo', 'X...............', 2, 1));
  const tracks: Track[] = [
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19, send: 0.3, notes: lead, bright: 1.1 },
    { id: 'horn', kind: 'pitched', voice: 'horn', level: -23 + tier, send: 0.28, pan: 0.25, notes: shiftNotes(lead, -12), bright: 1 },
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -24, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 57 + Math.min(4, key), 76, 0.75) },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -23, send: 0.32, width: 1.5, chords: pads(chords, 3, 45, 64, 0.85) },
    ...(tier >= 2 ? [{ id: 'choir', kind: 'pad' as const, voice: 'padChoirMale' as const, level: -24, send: 0.45, width: 1.6, chords: pads(chords, 4, 45, 66, 0.8) }] : []),
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: bassNotes },
    { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: kit },
    { id: 'gong', kind: 'pitched', voice: 'bronze', level: -26, send: 0.5, bright: 1.3, notes: [{ t: lastBar * 4, d: 4, n: 45 + key, v: 0.8 }] },
    { id: 'fx', kind: 'fx', level: -24, send: 0.32, fx: [
      { t: 0, d: 2, k: 'thunder', v: 0.9 }, { t: 0, d: 3, k: 'crash', v: 0.5 }, { t: lastBar * 4, d: 4, k: 'crash', v: 0.65 },
      ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.7 }, { t: 6, d: 2, k: 'swell' as const, v: 0.45 }] : []),
    ] },
  ];
  return {
    id: `storm-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'A', 'B', 'C#'][tier]} Hicaz-major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): thunder crack, zurna arpeggio climb with horn doubling an octave below, bağlama 16ths, horn chords, davul${tier >= 2 ? ', male choir' : ''}${tier === 3 ? ', riser, double-time davul and low taiko' : ''}; the bII→I cadence lands on a held tonic with a bronze gong.`,
    tracks,
  };
}

/** Big win tier 4 — "Efsane", E Hicaz-major, 120 BPM, 3 bars (6 s): the most triumphant head. */
const EFSANE_LEAD = 'E5:.25 A5:.25 C#6:.25 E6:.25 A6:1 E6:.5 F6:.5 D6:1 | D6:.5 C#6:.25 Bb5:.25 D6:1 E6:.5 F6:.5 Bb5:.5 C#6:.5 | A5:3 r:1';
const EFSANE_CHORDS = 'A:2 Dm:2 | Bb:2 Gm:1 A:1 | A';
function legend(): Score {
  const key = TIER_KEY[4], lk = leadShift(key);
  const chords = shiftChords(progression(EFSANE_CHORDS), key), lead = melody(EFSANE_LEAD, 0, 4, lk);
  return {
    id: 'storm-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 2.8, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Big win tier 4 (Efsane), E Hicaz-major, 120 BPM, 3 bars (6 s): I – iv | bII – vii – I | I. Zurna lead with horn octave and horn chord stabs, full male choir, bağlama 16ths, bronze bells on every downbeat, taiko roll into the last bar, two thunder strikes, gong.',
    tracks: [
      { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19, send: 0.3, notes: lead, bright: 1.1 },
      { id: 'horn', kind: 'pitched', voice: 'horn', level: -21, send: 0.28, pan: 0.2, notes: shiftNotes(lead, -12), bright: 1.1 },
      { id: 'stabs', kind: 'pitched', voice: 'horn', level: -24, send: 0.3, pan: -0.2, notes: stabs(chords, 'x.....x.x.......', 0.85) },
      { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22, send: 0.45, width: 1.7, chords: pads(chords, 4, 45, 66, 0.95) },
      { id: 'horns', kind: 'pad', voice: 'padHorn', level: -24, send: 0.35, chords: pads(chords, 3, 45, 62, 0.8) },
      { id: 'saz', kind: 'pitched', voice: 'baglama', level: -24, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'bells', kind: 'pitched', voice: 'bronze', level: -23, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 4, n: 76, v: 0.8 }, { t: 4, d: 4, n: 77, v: 0.7 }, { t: 8, d: 4, n: 76, v: 0.9 }] },
      { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -20, send: 0, notes: melody('E2:2 A1:2 | F1:2 D2:1 E2:1 | E1:3 r:1') },
      { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: hits(steps('davul', 'X...x.x.X...x.x.', 0, 2), steps('davulRim', 'x.x.x.x.x.x.xxxx', 1, 1), ...Array.from({ length: 8 }, (_, i) => [{ t: 6 + i * 0.25, k: 'taiko', v: 0.45 + i * 0.07 }]), steps('taikoLo', 'X...............', 2, 1)) },
      { id: 'gong', kind: 'pitched', voice: 'bronze', level: -25, send: 0.5, bright: 1.6, notes: [{ t: 8, d: 4, n: 40, v: 0.95 }] },
      { id: 'fx', kind: 'fx', level: -24, send: 0.32, fx: [{ t: 0, d: 2, k: 'thunder', v: 1 }, { t: 0, d: 4, k: 'crash', v: 0.6 }, { t: 4, d: 4, k: 'riser', v: 0.7 }, { t: 8, d: 2, k: 'thunder', v: 1 }, { t: 8, d: 4, k: 'crash', v: 0.8 }] },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), legend()] as const;

/**
 * Count-up beds: a 4-bar I – bII – iv – bII/I loop at 120 BPM per tier, in the tier's key, layered more
 * fully per tier: 1 bağlama 16ths, drone, bass, frame drum and tek · 2 + davul groove, horn swells,
 * darbuka ka · 3 + zurna lead and davul stick 8ths · 4 + male choir, bronze bells, taiko · max + horn
 * stabs, a second zurna an octave below and thunder rumbles.
 */
const BED_CHORDS = progression('A | Bb | Dm | Bb:2 A:2');
const BED_LEAD = `E5:.75 C#5:.25 E5:.5 A5:1.5 G5:.5 F5:.5 | F5:.75 D5:.25 F5:.5 Bb5:1.5 A5:.5 G5:.5 | F5:.75 D5:.25 F5:.5 A5:1 Bb5:.5 A5:.5 F5:.5 | G5:1 Bb5:1 C#6:.5 Bb5:.5 A5:1`;
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tonic = 45 + key;
  const tracks: Track[] = [
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -23, send: 0.2, pan: 0.4, bright: 0.65, notes: ostinato(chords, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 57 + Math.min(4, key), 76, 0.7, 3, 0.6) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -27, send: 0.3, chords: [{ t: 0, d: 16, ns: [tonic - 12, tonic], v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: level === 1 ? 'bass' : 'bassDrive', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.85, 38) },
    { id: 'perc', kind: 'kit', level: -27, send: 0.12, hits: hits(steps('frame', 'x.......x.......', 0, 4), steps('tek', '....x.......x...', 0, 4)) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'davul', kind: 'kit', level: -22, send: 0.08, hits: steps('davul', 'X...x.x.X...x.x.', 0, 4) });
    tracks.push({ id: 'horns', kind: 'pad', voice: 'padHorn', level: -25, send: 0.32, width: 1.5, chords: pads(chords, 3, 45, 64, 0.75) });
    tracks.push({ id: 'ka', kind: 'kit', level: -29, send: 0.1, hits: steps('ka', 'gg.gg.g.gg.gg.g.', 0, 4) });
  }
  if (level >= 3) {
    tracks.push({ id: 'zurna', kind: 'pitched', voice: 'zurna', level: -20, send: 0.3, notes: melody(BED_LEAD, 0, 4, lk), bright: 1 });
    tracks.push({ id: 'stick', kind: 'kit', level: -28, send: 0.08, hits: steps('davulRim', '..x...x...x...x.', 0, 4) });
  }
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -24, send: 0.45, width: 1.7, chords: pads(chords, 4, 45, 66, 0.85) });
    tracks.push({ id: 'bells', kind: 'pitched', voice: 'bronze', level: -26, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 76), v: 0.7 })) });
    tracks.push({ id: 'taiko', kind: 'kit', level: -26, send: 0.25, hits: chords.flatMap(c => [{ t: c.t, k: 'taiko', v: 0.9 }, { t: c.t + c.d - 0.5, k: 'taiko', v: 0.45 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'stabs', kind: 'pitched', voice: 'horn', level: -24, send: 0.25, pan: 0.2, notes: stabs(chords, 'x..x..x...x.....', 0.8) });
    tracks.push({ id: 'zurnaLow', kind: 'pitched', voice: 'zurnaSoft', level: -26, send: 0.3, pan: -0.35, notes: melody(BED_LEAD, 0, 4, lk - 12).map(n => ({ ...n, v: 0.6 })) });
    tracks.push({ id: 'fx', kind: 'fx', level: -28, send: 0.3, fx: [{ t: 0, d: 7, k: 'rumble', v: 0.6, density: 0.5 }, { t: 8, d: 7, k: 'rumble', v: 0.6, density: 0.5 }] });
  }
  const keyName = ['A', 'Bb', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#'][key];
  return {
    id: `storm-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -6,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – bII – iv – bII/I in ${keyName} Hicaz-major at 120 BPM, 4-bar seamless loop (8 s); ${['bağlama 16ths, drone, bass, frame drum and tek', '+ davul groove, horn swells, darbuka ka', '+ zurna lead and davul stick 8ths', '+ male choir, bronze bells, taiko', '+ horn stabs, a second zurna an octave below, thunder rumbles'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/** Max win — the top of the ladder: F# Hicaz-major, 120 BPM, 3 bars (6 s), the bVI – bVII – I cadence. */
const MAX_LEAD = 'A4:.5 C5:.5 F5:.5 A5:.5 C6:2 | B4:.5 D5:.5 G5:.5 B5:.5 Bb5:1 D6:1 | C#6:.25 E6:.25 A6:.5 E6:.5 A6:2.5';
const MAX_CHORDS = 'F | G:2 Bb:2 | A';
function maxWin(): Score {
  const key = TIER_KEY.max, lk = leadShift(key);
  const chords = shiftChords(progression(MAX_CHORDS), key), lead = melody(MAX_LEAD, 0, 4, lk);
  return {
    id: 'storm-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Max win, F# (top of the key ladder), 120 BPM, 3 bars (6 s): bVI – bVII – bII – I (D – E – G – F#) with zurna and horn octaves, a second horn line, full male choir, horn chords, bağlama 16ths, bronze bells, double-time davul, a taiko roll, three thunder strikes, gong and the longest rumble.',
    tracks: [
      { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19, send: 0.3, notes: lead, bright: 1.15 },
      { id: 'horn', kind: 'pitched', voice: 'horn', level: -20.5, send: 0.28, notes: shiftNotes(lead, -12), bright: 1.15 },
      { id: 'zurnaLow', kind: 'pitched', voice: 'zurnaSoft', level: -25, send: 0.3, pan: -0.35, notes: shiftNotes(lead, -12).map(n => ({ ...n, v: 0.6 })) },
      { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -21, send: 0.45, width: 1.7, chords: pads(chords, 4, 45, 68, 0.95) },
      { id: 'horns', kind: 'pad', voice: 'padHorn', level: -23, send: 0.35, chords: pads(chords, 4, 45, 64, 0.9) },
      { id: 'saz', kind: 'pitched', voice: 'baglama', level: -24, send: 0.22, pan: 0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'bells', kind: 'pitched', voice: 'bronze', level: -23, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 4, n: 74, v: 0.8 }, { t: 4, d: 2, n: 76, v: 0.8 }, { t: 6, d: 2, n: 79, v: 0.8 }, { t: 8, d: 4, n: 78, v: 0.95 }] },
      { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -20, send: 0, notes: melody('D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 | E2:.5 E2:.5 E2:.5 E2:.5 G1:.5 G1:.5 G1:.5 G1:.5 | F#1:3 r:1') },
      { id: 'kit', kind: 'kit', level: -20, send: 0.12, hits: hits(steps('davul', 'X.x.x.x.X.x.x.x.', 0, 2), steps('davulRim', 'x.x.x.x.xxxxxxxx', 0, 2), ...Array.from({ length: 12 }, (_, i) => [{ t: 5 + i * 0.25, k: 'taiko', v: 0.4 + i * 0.05 }]), steps('taikoLo', 'X...............', 2, 1)) },
      { id: 'gong', kind: 'pitched', voice: 'bronze', level: -24, send: 0.5, bright: 1.8, notes: [{ t: 0, d: 4, n: 38, v: 0.8 }, { t: 8, d: 4, n: 42, v: 1 }] },
      { id: 'fx', kind: 'fx', level: -23.5, send: 0.32, fx: [{ t: 0, d: 2, k: 'thunder', v: 1 }, { t: 4, d: 2, k: 'thunder', v: 0.8 }, { t: 0, d: 8, k: 'riser', v: 0.5 }, { t: 8, d: 2, k: 'thunder', v: 1 }, { t: 8, d: 4, k: 'crash', v: 0.8 }, { t: 8.5, d: 6, k: 'rumble', v: 0.8, density: 0.3 }] },
    ],
  };
}
export const MAX_WIN = maxWin();

/** Total-win fanfare (end of the feature): A Hicaz-major, 120 BPM, a festive halay-like flourish, 4 s to its musical end. */
export const TOTAL_WIN: Score = {
  id: 'storm-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win fanfare, A Hicaz-major, 120 BPM, 4 s: A – Dm – Gm | Bb – A. Festive zurna flourish with a dotted halay-like rhythm doubled by horns, bağlama strums, davul with stick roll, male choir on the final A with bronze bells, gong and thunder.',
  tracks: [
    { id: 'zurna', kind: 'pitched', voice: 'zurna', level: -19, send: 0.28, notes: melody('A4:.25 C#5:.25 E5:.5 r:.25 E5:.25 D5:.25 E5:.25 F5:.5 E5:.5 D5:.5 C#5:.5 | Bb4:.5 C#5:.5 A5:3'), bright: 1.1 },
    { id: 'horn', kind: 'pitched', voice: 'horn', level: -21, send: 0.28, pan: 0.25, notes: melody('A4:.25 C#5:.25 E5:.5 r:.25 E5:.25 D5:.25 E5:.25 F5:.5 E5:.5 D5:.5 C#5:.5 | Bb4:.5 C#5:.5 A5:3', 0, 4, -12), bright: 1.1 },
    { id: 'saz', kind: 'pitched', voice: 'baglama', level: -24, send: 0.25, pan: -0.35, bright: 0.7, notes: ([[0, [57, 61, 64]], [1, [57, 61, 64]], [2, [57, 62, 65]], [3, [55, 58, 62]], [4, [58, 62, 65]], [5, [57, 61, 64, 69]]] as const).flatMap(([t, ns]) => ns.map((n, i) => ({ t: t + i * 0.04, d: t === 5 ? 3 : 0.8, n, v: 0.8 }))) },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22, send: 0.45, width: 1.6, chords: [{ t: 5, d: 3, ns: [45, 52, 57, 61], v: 0.9 }] },
    { id: 'horns', kind: 'pad', voice: 'padHorn', level: -24, send: 0.35, chords: pads(progression('A:2 Dm:1 Gm:1 | Bb:1 A:3'), 3, 45, 62, 0.85) },
    { id: 'bells', kind: 'pitched', voice: 'bronze', level: -24, send: 0.5, notes: [{ t: 5, d: 3, n: 81, v: 0.85 }, { t: 5.5, d: 2.5, n: 76, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: melody('A1:2 D2:1 G1:1 | Bb1:1 A1:2 r:1') },
    { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: hits(steps('davul', 'X...x.x.X...x...', 0, 1), steps('davulRim', '..x...x.xxxxXXXX', 0, 1), steps('davul', 'X...x...........', 1, 1), steps('taiko', '....X...........', 1, 1)) },
    { id: 'gong', kind: 'pitched', voice: 'bronze', level: -26, send: 0.5, bright: 1.4, notes: [{ t: 5, d: 3, n: 45, v: 0.9 }] },
    { id: 'fx', kind: 'fx', level: -25, send: 0.32, fx: [{ t: 3, d: 2, k: 'swell', v: 0.45 }, { t: 5, d: 2, k: 'thunder', v: 0.7 }, { t: 5, d: 3, k: 'crash', v: 0.7 }] },
  ],
};

/** Ambience bed: rain on stone, wind through the citadel, distant thunder rolls; 24 s loop on the ambience bus. */
export const AMBIENCE: Score = {
  id: 'storm-ambience', bpm: 60, beatsPerBar: 4, bars: 6, swing: 0.5, loop: true, tail: 2, reverb: 'hall', reverbDb: -3,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 24 s seamless loop: steady rain (hiss, patter and droplets on stone), wandering wind with gusts and three distant thunder rolls at different distances; no tempo-bound material.',
  tracks: [
    { id: 'rain', kind: 'fx', level: -33, send: 0.05, width: 1.2, fx: [{ t: 0, d: 24, k: 'rain', v: 1, density: 1 }] },
    { id: 'wind', kind: 'fx', level: -37, send: 0.1, width: 1.4, fx: [{ t: 0, d: 24, k: 'wind', v: 1 }] },
    { id: 'thunder', kind: 'fx', level: -36, send: 0.35, fx: [{ t: 3.5, d: 6, k: 'rumble', v: 0.8, density: 0.9 }, { t: 12.5, d: 5, k: 'rumble', v: 1, density: 0.6 }, { t: 19.5, d: 4, k: 'rumble', v: 0.7, density: 1 }] },
  ],
};

export const STORM_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, retrigger: RETRIGGER, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, ambience: AMBIENCE,
} as const;
export type StormScoreId = keyof typeof STORM_SCORES;

/**
 * Crest-factor control (render.ts `tame`) for the transient-heavy stems, so the mix is not driven into the
 * master limiter by coincident davul, darbuka and bağlama attacks: drums 12 dB, plucks 13 dB, thunder 15 dB
 * above their gated RMS. The ambience is left untouched.
 */
for (const score of Object.values(STORM_SCORES)) {
  if (score === AMBIENCE) continue;
  for (const track of score.tracks) {
    if (track.tame !== undefined) continue;
    if (track.kind === 'kit') track.tame = track.hits.every(h => h.k.startsWith('taiko')) ? 14 : 12;
    else if (track.kind === 'pitched' && track.voice === 'baglama') track.tame = 13;
    else if (track.kind === 'fx' && track.fx.some(f => f.k === 'thunder')) track.tame = 15;
  }
}
export const STORM_SCORE_IDS = Object.keys(STORM_SCORES) as StormScoreId[];
