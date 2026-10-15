/**
 * Cezeri: Zamanın Çarkları music — original compositions written as note data for the world of al-Jazari's automata
 * (the elephant clock, water clocks, the automaton band, brass gear trains). Melodies, harmony, bass lines and grooves
 * were written for this game; no existing game's, film's or song's melody, motif or sound is quoted or imitated, no
 * commercial slot score is imitated and no real clock chime (Westminster or other) is used.
 *
 * Musical direction (12-tone equal temperament approximations of the makam colours):
 *   base theme — C Nikriz (C D Eb F# G A Bb): the augmented second Eb–F# gives the "exotic machine" colour; harmony
 *   Cm – D7 (the Nikriz II7) – Gm – Eb – Cm6 – F#dim7. Its B section opens to Eb Çargah (Eb major) — the elephant
 *   walks — and returns through G7; its C section is the water-clock breakdown.
 *   feature theme "Fil Saati" — C Çargah (C major): the same tonic turned bright and fast, an automaton band procession
 *   with the Nikriz F# kept as the chromatic neighbour of G; a bVI – bVII (Ab – Bb) lift before the turnaround.
 * The recurring signature, the "escapement turn", is the hook's opening gesture: the tonic, a leap to G, the pallet
 * rocking around it (G F# G F#) and the drop through the augmented second (Eb D C).
 * The clock mechanism is part of the band: an escapement tick-tock on the eighths, locked to the tempo, pawl-and-ratchet
 * rolls into the section changes, a brass gear clank as the mechanism engages, water-clock drips on tuned bowls and the
 * whirr of the gear train winding up into the loop point.
 * Instruments are synthesized (synth/cezeri.ts + shared voices): santur-like hammered dulcimer, automaton flute, water
 * organ, clock-gong chime rods, naqqara-like kettledrums, a great kös, hand cymbals, a zurna-like double reed and ney
 * (synth/anatolian.ts), a wordless male choir, and the clockwork itself.
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score, Track } from './types';
import { CELEBRATION_BPM, TIER_KEY, type WinTier } from '../win-tiers';

/* ---------------- arranging helpers ---------------- */

function pads(chords: ChordEvent[], count: number, lo: number, hi: number, v: number): PadEvent[] {
  let prev: number[] | null = null;
  return chords.map(c => { const ns = voice(c.tones, count, lo, hi, prev); prev = ns; return { t: c.t, d: c.d, ns, v }; });
}
/** The same voicings as single held notes, for a pitched sustained voice (the water organ). */
function held(chords: ChordEvent[], count: number, lo: number, hi: number, v: number, legato = 0.96): NoteEvent[] {
  return pads(chords, count, lo, hi, v).flatMap(p => p.ns.map(n => ({ t: p.t, d: p.d * legato, n, v: p.v })));
}

type BassStyle = 'half' | 'long' | 'pedal' | 'drive' | 'march';
/** Bass from chord roots. 'march' is the automaton band's step (root on 1, fifth on 3, root on the "and" of 4). */
function bassLine(chords: ChordEvent[], styleOf: BassStyle | ((bar: number) => BassStyle | null), v: number, centre = 40, lo = 31, hi = 47): NoteEvent[] {
  const out: NoteEvent[] = [];
  const fit = (n: number) => { let x = n; while (x > hi) x -= 12; while (x < lo) x += 12; return x; };
  chords.forEach(c => {
    const root = fit(nearest(c.bass, centre)), fifth = root + 7 > hi + 3 ? root - 5 : root + 7;
    const style = typeof styleOf === 'function' ? styleOf(Math.floor(c.t / 4)) : styleOf;
    const push = (t: number, n: number, d: number, vel: number) => { if (t < c.d - 1e-9) out.push({ t: c.t + t, n, d: Math.min(d, c.d - t), v: vel }); };
    switch (style) {
      case null: break;
      case 'pedal': push(0, root, c.d - 0.1, v); break;
      case 'long': push(0, root, Math.min(c.d, 4) - 0.1, v); if (c.d > 4) push(4, root, c.d - 4.1, v * 0.9); break;
      case 'half': push(0, root, 1.9, v); if (c.d >= 4) push(2, fifth, 1.9, v * 0.85); break;
      case 'march': push(0, root, 0.9, v); if (c.d >= 2) push(1.5, root, 0.4, v * 0.6); if (c.d >= 3) push(2, fifth, 0.9, v * 0.85); if (c.d >= 4) push(3.5, root, 0.4, v * 0.6); break;
      case 'drive': for (let k = 0; k < c.d * 2; k++) push(k * 0.5, k % 4 === 3 ? fifth : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.7 : v); break;
    }
  });
  return out;
}

/** Hammered ostinato over each chord's voicing; index −1 is the root below, indices past the voicing climb an octave. */
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
      const note = idx < 0 ? root : vs[idx % count]! + 12 * Math.floor(idx / count);
      out.push({ t: c.t + s * step, d: step * 0.95, n: note, v: v * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.85 : accent) });
    }
  }
  return out;
}

/** Santur tremolo (the hammers alternate on a long note): notes of at least `min` beats re-struck every `rate` beats. */
function tremolo(notes: NoteEvent[], min = 1, rate = 0.25): NoteEvent[] {
  return notes.flatMap(n => {
    if (n.d < min - 1e-9) return [n];
    const k = Math.round(n.d / rate);
    return Array.from({ length: k }, (_, i) => ({ t: n.t + i * rate, d: rate, n: n.n, v: n.v * (i === 0 ? 1 : i % 2 ? 0.58 : 0.7) }));
  });
}

/** A rolled chord on the santur: the notes a few ms apart, each held `d` beats. */
function strum(t: number, ns: number[], d: number, v: number, gap = 0.04): NoteEvent[] { return ns.map((n, i) => ({ t: t + i * gap, d, n, v: v * (1 - i * 0.04) })); }

const within = (chords: ChordEvent[], fromBar: number, toBar: number, bpb = 4) => chords.filter(c => c.t >= fromBar * bpb - 1e-9 && c.t < toBar * bpb - 1e-9);
const hits = (...lists: HitEvent[][]) => lists.flat();
const shiftNotes = (notes: NoteEvent[], k: number): NoteEvent[] => notes.map(n => ({ ...n, n: n.n + k }));
const shiftChords = (chords: ChordEvent[], k: number): ChordEvent[] => chords.map(c => ({ ...c, root: (c.root + k + 12) % 12, tones: c.tones.map(t => (t + k + 12) % 12), bass: (c.bass + k + 12) % 12 }));
const vel = (notes: NoteEvent[], v: number) => notes.map(n => ({ ...n, v: n.v * v }));
const at = (beats: number[], k: string, v: number): HitEvent[] => beats.map(t => ({ t, k, v }));

/** The escapement, locked to the tempo: tick on the beat, tock on the off-beat eighth, the bar's first tick accented. */
const clockwork = (fromBar: number, bars: number, gain = 1) => hits(steps('escTick', 'X...x...x...x...', fromBar, bars, gain), steps('escTock', '..o...o...o...o.', fromBar, bars, gain));

/* =====================================================================================
 * BASE THEME — "Zamanın Çarkları" (The Wheels of Time)
 * C Nikriz, 100 BPM straight, 20 bars = 48.0 s seamless loop.
 * Form: A (8 bars: the 4-bar hook — the escapement turn — on the automaton flute over a 16th santur "gear train", its
 *       answer on the santur; naqqara in a two-bar automaton-drummer figure, the escapement tick-tock throughout, a
 *       gear clank as the mechanism engages) · B (6 bars: Eb Çargah — the elephant walks — the ney sings over a water
 *       organ, the santur tremolos an octave below, kös on the downbeats, hand cymbals) · C (6 bars: the water-clock
 *       breakdown — drips on tuned bowls, the flute alone in Nikriz over F#dim7 and D7, then the gear train winds up
 *       with a ratchet roll and a santur run over G7 back into the hook).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  Cm | D7:2 Gm:2 | Eb:2 Cm:2 | D7:2 Cm:2 |
  Gm:2 D7:2 | Cm6 | F#dim7:2 D7:2 | D7:2 Cm:2 |
  Ab:2 Bb:2 | Eb:2 Cm:2 | Ab:2 Fm:2 | Bb7:2 Eb:2 | Ab:2 Fm:2 | G7 |
  Cm | Cm | F#dim7 | D7 | Eb:2 F#dim7:2 | D7:2 G7:2`);

/** The 4-bar hook: the escapement turn (C · G · F# G F# · Eb D C), its rise through the augmented second to A, the turn again a fourth up and the cadence. */
export const CEZERI_HOOK = `
  C5:.5 G5:1 F#5:.25 G5:.25 F#5:.5 Eb5:.5 D5:.5 C5:.5 |
  D5:.5 Eb5:.5 F#5:.5 A5:.5 G5:2 |
  Bb5:.5 A5:.5 G5:.5 F#5:.25 G5:.25 A5:.5 G5:.5 Eb5:1 |
  D5:.5 Eb5:.25 D5:.25 C5:.5 Bb4:.5 C5:2`;
const BASE_ANSWER = `
  G5:.5 A5:.5 Bb5:1 A5:.5 G5:.5 F#5:1 |
  Eb5:.5 F#5:.5 G5:.5 A5:.5 C6:1.5 Bb5:.5 |
  A5:.5 G5:.5 F#5:.5 Eb5:.5 D5:.5 Eb5:.5 F#5:.5 A5:.5 |
  G5:1 F#5:.25 Eb5:.25 D5:.5 C5:2`;
const BASE_B = `
  C6:1 Bb5:.5 Ab5:.5 G5:1 F5:1 |
  Eb5:.5 F5:.5 G5:.5 Bb5:.5 C6:1 Bb5:1 |
  Ab5:1 G5:.5 F5:.5 Eb5:1 C5:1 |
  D5:.5 Eb5:.5 F5:.5 Ab5:.5 G5:2 |
  C6:.5 Bb5:.5 Ab5:.5 C6:.5 Eb6:1 D6:.5 C6:.5 |
  B5:1 D6:.5 B5:.5 G5:1 F5:.5 D5:.5`;
const BASE_C = `
  G5:2 F#5:1 Eb5:1 |
  D5:1.5 Eb5:.5 C5:2 |
  A5:1 C6:1 Eb6:1 C6:.5 A5:.5 |
  F#5:1.5 G5:.5 A5:1 D5:1 |
  Eb5:.5 G5:.5 Bb5:1 A5:.5 C6:.5 Eb6:1 |
  D6:2 r:2`;
/** The santur's run over G7 at the loop point, down into the hook's C. */
const BASE_RUN = 'r:2 F5:.25 G5:.25 F5:.25 D5:.25 B4:.25 D5:.25 B4:.25 G4:.25';

const baseNaq = hits(
  // A: the automaton drummer's two-bar figure, a ghosted fill into bars 4 and 8
  steps('naqDum', 'X.......x.......', 0, 8), steps('naqTek', '....x...o.x.x...', 0, 3), steps('naqTek', '....x...o.x.xxxx', 3, 1, 0.8),
  steps('naqTek', '....x...o.x.x...', 4, 3), steps('naqTek', '....x.x.xxxxXXXX', 7, 1, 0.8),
  // B: livelier, the elephant's step
  steps('naqDum', 'X..x....X..x....', 8, 6), steps('naqTek', '....x.x.....x.xx', 8, 5), steps('naqTek', '....x.x.x.x.xxXX', 13, 1),
  // C: silent, then the roll back into the hook
  steps('naqTek', 'x.x.x.x.xxxxXXXX', 19, 1, 0.75),
);
const baseGears = hits(
  steps('ratchet', '............gggx', 3, 1), steps('ratchet', '........g.g.gggx', 7, 1),
  steps('ratchet', '............ggxx', 13, 1), steps('ratchet', 'g.g.g.g.gggggggX', 19, 1, 0.9),
  at([0, 32, 56], 'clank', 0.9),
);
const baseKos = hits(at([0, 32, 56], 'kos', 0.95), at([40, 48], 'kosLo', 0.75), at([76, 78], 'kos', 0.7));
const baseCymbal = hits(at([32], 'cymbal', 0.85), at([0, 16, 48, 72], 'cymbalSoft', 0.7));
/** The water clock: a drip on the first beat of every other bar in A, then quarter drips C6 / G5 through the breakdown. */
const baseDrips: NoteEvent[] = [
  ...[0, 8, 16, 24].map(t => ({ t, d: 1, n: 84, v: 0.6 })),
  ...Array.from({ length: 16 }, (_, i) => ({ t: 56 + i, d: 1, n: i % 2 ? 79 : 84, v: i % 4 === 0 ? 0.75 : 0.55 })),
];
const baseFx: FxEvent[] = [
  { t: 18 * 4, d: 8, k: 'whirr', v: 0.7, density: 60 },
  { t: 14 * 4, d: 8, k: 'pour', v: 0.5 },
];

export const BASE_THEME: Score = {
  id: 'cezeri-base', bpm: 100, beatsPerBar: 4, bars: 20, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -15, measure: 'integrated' },
  about: 'C Nikriz (C D Eb F# G A Bb), 100 BPM, 20-bar seamless loop (48 s). A: the 4-bar "escapement turn" hook (C · G · F# G F# · Eb D C) on an automaton flute over a 16th santur gear train, its answer on the santur, naqqara in an automaton-drummer figure, the escapement tick-tock on the eighths and a gear clank as the mechanism engages · B: Eb Çargah — the elephant walks — ney over a water organ, santur tremolo, kös and hand cymbals · C: the water-clock breakdown — drips on tuned bowls (C6/G5), the flute alone over F#dim7 and D7, then the gear train winds up (ratchet roll, whirr, naqqara roll) and a santur run over G7 back into the hook.',
  tracks: [
    { id: 'pipe', kind: 'pitched', voice: 'pipe', level: -20, send: 0.36, pan: 0.06, notes: [...melody(CEZERI_HOOK, 0), ...melody(BASE_C, 14)] },
    { id: 'santur', kind: 'pitched', voice: 'santur', level: -20.5, send: 0.3, pan: -0.08, bright: 1, notes: [...melody(BASE_ANSWER, 4), ...melody(BASE_RUN, 19)] },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -20.5, send: 0.45, pan: 0.12, notes: melody(BASE_B, 8) },
    { id: 'tremolo', kind: 'pitched', voice: 'santurSoft', level: -25.5, send: 0.3, pan: -0.32, transpose: -12, bright: 0.8, notes: vel(tremolo(melody(BASE_B, 8), 1, 0.25), 0.75) },
    {
      id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -27, send: 0.22, pan: 0.4, bright: 0.65,
      notes: [...ostinato(within(BASE_CHORDS, 0, 8), [-1, 0, 1, 2, 1, 0, 1, 2], 0.25, 55, 70, 0.7, 3, 0.6), ...ostinato(within(BASE_CHORDS, 16, 20), [0, 2, 1, 2], 0.5, 57, 72, 0.55)],
    },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -26.5, send: 0.45, pan: -0.05, notes: [...held(within(BASE_CHORDS, 4, 14), 3, 55, 72, 0.6), ...held(within(BASE_CHORDS, 16, 20), 3, 55, 70, 0.55)] },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -27, send: 0.5, pan: 0.25, notes: [{ t: 0, d: 2, n: 84, v: 0.8 }, { t: 0.02, d: 2, n: 79, v: 0.6 }, { t: 16, d: 2, n: 79, v: 0.65 }, { t: 32, d: 2, n: 87, v: 0.75 }, { t: 56, d: 2, n: 84, v: 0.7 }] },
    { id: 'drips', kind: 'pitched', voice: 'drip', level: -28, send: 0.42, pan: 0.32, notes: baseDrips },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -24.5, send: 0.03, notes: bassLine(BASE_CHORDS, bar => (bar < 8 ? 'half' : bar < 14 ? 'march' : bar < 16 ? 'pedal' : 'long'), 0.78, 38, 31, 46) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -30, send: 0.3, width: 1.5, chords: [{ t: 56, d: 16, ns: [36, 43, 48], v: 0.55 }] },
    { id: 'clock', kind: 'kit', level: -26.5, send: 0.12, width: 1.2, hits: clockwork(0, 20) },
    { id: 'naq', kind: 'kit', level: -24.5, send: 0.14, width: 1.3, hits: baseNaq },
    { id: 'gearkit', kind: 'kit', level: -28, send: 0.16, hits: baseGears },
    { id: 'kos', kind: 'kit', level: -26, send: 0.2, hits: baseKos },
    { id: 'cymbal', kind: 'kit', level: -30, send: 0.35, hits: baseCymbal },
    { id: 'fx', kind: 'fx', level: -30, send: 0.25, width: 1.4, fx: baseFx },
  ],
};

/* IDLE — the A section re-orchestrated for attract mode: the hook on the water organ, its answer on a soft santur, the
   escapement ticking quietly, water-clock drips and a C–G drone; no drums. Same tempo as base bars 1–8 (phase-aligned fades). */
export const IDLE_THEME: Score = {
  id: 'cezeri-idle', bpm: 100, beatsPerBar: 4, bars: 8, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -4,
  target: { lufs: -16, measure: 'integrated' },
  about: 'C Nikriz, 100 BPM, 8-bar loop (19.2 s): the hook on the water organ, its answer on a soft santur, the escapement ticking quietly, water-clock drips on C6/G5, a C–G drone and one chime-rod strike per phrase; no drums.',
  tracks: [
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -20, send: 0.5, pan: 0.05, notes: vel(melody(CEZERI_HOOK, 0), 0.8) },
    { id: 'santur', kind: 'pitched', voice: 'santurSoft', level: -22, send: 0.4, pan: -0.15, bright: 0.7, notes: vel(melody(BASE_ANSWER, 4, 4, -12), 0.75) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -25, send: 0.35, width: 1.6, chords: [{ t: 0, d: 32, ns: [36, 43, 48, 55], v: 0.5 }] },
    { id: 'drips', kind: 'pitched', voice: 'drip', level: -27, send: 0.45, pan: 0.3, notes: Array.from({ length: 16 }, (_, i) => ({ t: i * 2, d: 1, n: i % 2 ? 79 : 84, v: 0.55 })) },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -28, send: 0.5, pan: 0.25, notes: [{ t: 0, d: 2, n: 84, v: 0.7 }, { t: 16, d: 2, n: 79, v: 0.6 }] },
    { id: 'clock', kind: 'kit', level: -31, send: 0.15, hits: clockwork(0, 8, 0.6) },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Fil Saati" (The Elephant Clock)
 * C Çargah (C major, the Nikriz F# kept as G's chromatic neighbour), 112 BPM straight, 16 bars = 34.3 s loop.
 * Form: A (8 bars: the escapement turn in major on a zurna-like reed over a 16th santur gear train running fast, the
 *       naqqara driving, water organ chords, the clock ticking on the eighths) · B (8 bars: the procession — the
 *       automaton flute sings the answer, a horn below, the wordless male choir, santur tremolo, the kös on every
 *       downbeat, an Ab – Bb lift and the gear train winding into the turnaround).
 * ===================================================================================== */

const FEAT_CHORDS = progression(`
  C | G:2 C:2 | F:2 C:2 | D7:2 G:2 | C | Am:2 F:2 | Dm:2 G7:2 | C |
  F | G | C:2 Am:2 | F:2 G:2 | Am:2 F:2 | C:2 G:2 | Ab:2 Bb:2 | G:2 G7:2`);
export const CEZERI_FEATURE_RIFF = `
  C5:.5 G5:.5 F#5:.25 G5:.25 A5:.5 G5:.5 E5:.5 C5:1 |
  D5:.5 G5:.5 B5:.5 D6:.5 C6:1 G5:1 |
  A5:.5 C6:.5 F6:1 E6:.5 D6:.5 C6:1 |
  A5:.5 F#5:.5 A5:.5 C6:.5 B5:1 G5:1 |
  C5:.5 G5:.5 F#5:.25 G5:.25 A5:.5 G5:.5 E5:.5 G5:1 |
  C6:.5 B5:.5 A5:.5 E5:.5 F5:.5 A5:.5 C6:1 |
  D6:.5 C6:.5 A5:.5 F5:.5 G5:.5 B5:.5 D6:.5 F6:.5 |
  E6:1 D6:.5 B5:.5 C6:2`;
const FEAT_ANSWER = `
  A5:1.5 G5:.5 F5:.5 G5:.5 A5:1 |
  B5:1.5 A5:.5 G5:.5 A5:.5 B5:1 |
  C6:1 B5:.5 G5:.5 A5:1.5 C6:.5 |
  D6:1 C6:.5 A5:.5 B5:1 G5:1 |
  E6:.5 D6:.5 C6:.5 E6:.5 F6:1 E6:.5 C6:.5 |
  D6:.5 E6:.5 G6:.5 E6:.5 D6:1 B5:1 |
  C6:.5 Eb6:.5 C6:.5 Ab5:.5 D6:.5 F6:.5 D6:.5 Bb5:.5 |
  B5:1 D6:.5 F6:.5 G6:1.5 r:.5`;

const featNaq = hits(
  steps('naqDum', 'X.......X.......', 0, 8), steps('naqTek', '..x.x.x...x.x.x.', 0, 7), steps('naqTek', '..x.x.x.xxxxXXXX', 7, 1, 0.85),
  steps('naqDum', 'X..x....X..x....', 8, 7), steps('naqTek', '....x.x.x...x.x.', 8, 7), steps('naqTek', 'x.x.x.x.xxxxXXXX', 15, 1, 0.85),
);
const featKos = hits(at([0], 'kos', 1), Array.from({ length: 8 }, (_, i) => ({ t: (8 + i) * 4, k: i === 6 ? 'kosLo' : 'kos', v: 0.85 })), at([58, 60, 62], 'kos', 0.75));
const featCymbal = hits(at([0, 32], 'cymbal', 0.9), Array.from({ length: 4 }, (_, i) => ({ t: (9 + 2 * i) * 4 + 2, k: 'cymbalSoft', v: 0.7 })));

export const FEATURE_THEME: Score = {
  id: 'cezeri-feature', bpm: 112, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5.5,
  target: { lufs: -14.5, measure: 'integrated' },
  about: 'C Çargah (C major, the Nikriz F# kept as the chromatic neighbour of G), 112 BPM, 16-bar loop (34.3 s). A: the escapement turn in major on a zurna-like reed over a fast 16th santur gear train, naqqara driving, water-organ chords, the clock ticking on the eighths · B: the automaton procession — the flute sings the answer up to G6 with a horn below, wordless male choir, santur tremolo, kös on every downbeat, hand cymbals, an Ab – Bb lift and the gear train winding into the turnaround.',
  tracks: [
    { id: 'zurna', kind: 'pitched', voice: 'zurnaSoft', level: -20.5, send: 0.3, pan: 0.05, bright: 0.9, notes: melody(CEZERI_FEATURE_RIFF, 0) },
    { id: 'pipe', kind: 'pitched', voice: 'pipe', level: -20, send: 0.4, pan: 0.1, notes: melody(FEAT_ANSWER, 8) },
    { id: 'horn', kind: 'pitched', voice: 'hornSwell', level: -25.5, send: 0.35, pan: -0.2, bright: 0.8, notes: vel(melody(FEAT_ANSWER, 8, 4, -12).filter(n => n.d >= 1), 0.7) },
    { id: 'tremolo', kind: 'pitched', voice: 'santurSoft', level: -25.5, send: 0.28, pan: -0.32, transpose: -12, bright: 0.8, notes: vel(tremolo(melody(FEAT_ANSWER, 8), 1, 0.25), 0.7) },
    { id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -26, send: 0.18, pan: 0.42, bright: 0.7, notes: ostinato(FEAT_CHORDS, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 57, 74, 0.7, 3, 0.6) },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -27, send: 0.45, notes: held(within(FEAT_CHORDS, 0, 8), 3, 57, 74, 0.6) },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -25, send: 0.48, width: 1.6, chords: pads(within(FEAT_CHORDS, 8, 16), 4, 48, 67, 0.85) },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -27, send: 0.45, pan: 0.3, notes: [0, 16, 32, 48].map((t, i) => ({ t, d: 2, n: [84, 88, 89, 84][i]!, v: 0.75 })) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0, notes: bassLine(FEAT_CHORDS, bar => (bar < 8 ? 'march' : 'drive'), 0.8, 38, 33, 47) },
    { id: 'clock', kind: 'kit', level: -27, send: 0.1, width: 1.2, hits: clockwork(0, 16, 0.85) },
    { id: 'naq', kind: 'kit', level: -23, send: 0.12, width: 1.3, hits: featNaq },
    { id: 'kos', kind: 'kit', level: -25, send: 0.18, hits: featKos },
    { id: 'cymbal', kind: 'kit', level: -29, send: 0.35, hits: featCymbal },
    { id: 'gearkit', kind: 'kit', level: -28, send: 0.15, hits: hits(steps('ratchet', 'g.g.g.g.gggggggX', 15, 1, 0.9), at([32], 'clank', 0.9)) },
    { id: 'fx', kind: 'fx', level: -29, send: 0.25, width: 1.4, fx: [{ t: 15 * 4, d: 4, k: 'whirr', v: 0.75, density: 80 }] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Free-spins intro: the elephant clock strikes — a kös boom, chime rods counting down the C major triad, a santur glissando up C pentatonic, the water organ and the male choir open; the feature enters at beat 6 (3.21 s). */
export const FS_INTRO: Score = {
  id: 'cezeri-fs-intro', bpm: 112, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 6,
  about: 'Free-spins intro ("the elephant clock strikes"), C Çargah, 112 BPM: a kös boom and chime rods striking C7–G6–E6–C6 like the clock\'s hour, a 32nd-note santur glissando up the C pentatonic to A6, a naqqara roll and a rising gear whirr, then a C major roll on the santur with the water organ, male choir, hand cymbals and the kös on beat 4; the feature theme enters at beat 6 (3.21 s).',
  tracks: [
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -20, send: 0.5, pan: 0.2, notes: [96, 91, 88, 84].map((n, i) => ({ t: i * 0.5, d: 1, n, v: 0.9 - i * 0.05 })).concat([{ t: 4, d: 2, n: 84, v: 0.95 }, { t: 4.02, d: 2, n: 91, v: 0.7 }]) },
    { id: 'santur', kind: 'pitched', voice: 'santur', level: -19.5, send: 0.32, bright: 1.2, notes: [
      ...[60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93].map((n, i) => ({ t: 2 + i * 0.125, d: 0.5, n, v: 0.6 + i * 0.02 })),
      ...strum(4, [60, 64, 67, 72, 76], 2, 0.9),
    ] },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -23, send: 0.5, notes: [{ t: 4, d: 2, n: 60, v: 0.8 }, { t: 4, d: 2, n: 64, v: 0.75 }, { t: 4, d: 2, n: 67, v: 0.75 }] },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22.5, send: 0.5, width: 1.6, chords: [{ t: 1, d: 3, ns: [48, 55, 60], v: 0.7 }, { t: 4, d: 2.5, ns: [48, 52, 55, 60], v: 0.95 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: melody('C2:2 G1:2 | C2:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -21.5, send: 0.2, hits: hits(at([0], 'kos', 1), steps('naqTek', '........x.x.xxxx', 0, 1, 0.85), at([4], 'kos', 1), at([4], 'cymbal', 0.9), steps('naqDum', 'X.......x.......', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.3, width: 1.4, fx: [{ t: 1.5, d: 2.5, k: 'whirr', v: 0.8, density: 90 }] },
  ],
};

/** Retrigger (+4 spins): a santur flourish up to a held C6 with its tremolo, a chime-rod pair, a kös hit and the cymbal; musical end at beat 3 (1.61 s). */
export const RETRIGGER: Score = {
  id: 'cezeri-retrigger', bpm: 112, beatsPerBar: 4, bars: 1, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 3,
  about: 'Retrigger (+4), C Çargah, 112 BPM, 1 bar: a 32nd-note santur flourish G–A–C–D–E–G up to a held C6 with its tremolo, chime rods C6/G6, a kös hit, a hand cymbal and a ratchet burst; ends at beat 3 (1.61 s) and rings over the feature theme.',
  tracks: [
    { id: 'santur', kind: 'pitched', voice: 'santur', level: -19, send: 0.3, bright: 1.15, notes: [...melody('G4:.125 A4:.125 C5:.125 D5:.125 E5:.125 G5:.125 C6:.25 r:3'), ...tremolo([{ t: 1, d: 1.5, n: 84, v: 0.8 }], 1, 0.125)] },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -21, send: 0.45, pan: 0.25, notes: [{ t: 1, d: 1, n: 84, v: 0.9 }, { t: 1.5, d: 1, n: 91, v: 0.7 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0, notes: melody('r:1 C2:2 r:1') },
    { id: 'kit', kind: 'kit', level: -22, send: 0.2, hits: hits(at([1], 'kos', 0.95), steps('ratchet', 'xxxx............', 0, 1, 0.7), at([1], 'cymbalSoft', 0.85)) },
  ],
};

/** Feature outro: the clock winds down — back to C Nikriz, 100 BPM, Eb – D7 | Cm; the base theme may return at beat 6 (3.6 s). */
export const FS_OUTRO: Score = {
  id: 'cezeri-fs-outro', bpm: 100, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.5, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 6,
  about: 'Feature outro ("the clock winds down"), C Nikriz, 100 BPM: Eb – D7 | Cm with the escapement turn on the automaton flute falling to C, santur rolls, water organ, the last ticks of the escapement slowing, a final drip and a soft kös; the base theme may return at beat 6 (3.6 s).',
  tracks: [
    { id: 'pipe', kind: 'pitched', voice: 'pipe', level: -19, send: 0.45, notes: melody('G5:.5 F#5:.25 G5:.25 Eb5:1 D5:.5 Eb5:.5 F#5:1 | C5:3 r:1') },
    { id: 'santur', kind: 'pitched', voice: 'santurSoft', level: -23, send: 0.35, pan: -0.3, bright: 0.8, notes: [...strum(0, [51, 55, 58, 63], 1.5, 0.75), ...strum(2, [50, 54, 57, 60], 1.5, 0.75), ...strum(4, [48, 51, 55, 60, 63], 3, 0.85)] },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -24, send: 0.5, notes: held(progression('Eb:2 D7:2 | Cm'), 3, 55, 70, 0.6) },
    { id: 'drip', kind: 'pitched', voice: 'drip', level: -25, send: 0.5, pan: 0.3, notes: [{ t: 4, d: 2, n: 84, v: 0.8 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -24, send: 0.03, notes: melody('Eb2:2 D2:2 | C2:3 r:1') },
    { id: 'kit', kind: 'kit', level: -28, send: 0.22, hits: hits(at([0, 1, 2, 3.25, 4.75], 'escTick', 0.7), at([0.5, 1.6, 2.75], 'escTock', 0.6), at([4], 'kos', 0.7)) },
  ],
};

/* =====================================================================================
 * WIN CELEBRATIONS — the shared key ladder (win-tiers.ts TIER_KEY) from C: Büyük C → Mega D → Süper E → Efsane G →
 * Max win A, all Çargah-major (with the Nikriz F# as a neighbour note). 120 BPM so tier-up hits land on one pulse; every
 * tier adds layers.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
/** Melodies in keys above E are written lower (the tonic still rises; the santur stays in its sweet register). */
const leadShift = (key: number) => (key > 4 ? key - 12 : key);

/** Big-win heads 1–3 in their tier keys (1 C, 2 D, 3 E); each climbs and lands on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = {
    1: { bars: 2, chords: 'C:2 G:2 | C', lead: 'C5:.5 G5:.5 F#5:.25 G5:.25 A5:.5 G5:1 E5:.5 D5:.5 | C5:3 r:1', bass: 'C2:2 G1:2 | C2:3 r:1', lufs: -15 },
    2: { bars: 2, chords: 'C:1 Am:1 F:1 G:1 | C', lead: 'C5:.25 E5:.25 G5:.25 C6:.25 B5:.25 C6:.25 A5:.5 F5:.5 A5:.5 B5:1 | C6:1 G5:.5 A5:.5 C6:2', bass: 'C2:1 A1:1 F1:1 G1:1 | C2:3 r:1', lufs: -14.5 },
    3: { bars: 3, chords: 'Am:2 F:2 | Dm:2 G:2 | C', lead: 'E5:.25 A5:.25 C6:.25 E6:.25 C6:.5 A5:.5 F5:.25 A5:.25 C6:.25 F6:.25 C6:1 | D5:.25 F5:.25 A5:.25 D6:.25 A5:.5 F5:.5 G5:.25 B5:.25 D6:.25 G6:.25 F6:1 | E6:.5 D6:.5 C6:2 r:1', bass: 'A1:2 F1:2 | D2:2 G1:2 | C2:3 r:1', lufs: -14 },
  }[tier];
  const key = TIER_KEY[tier], lk = leadShift(key);
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, lk), bassNotes = melody(spec.bass, 0, 4, key).map(n => ({ ...n, n: n.n > 45 ? n.n - 12 : n.n }));
  const lastBar = spec.bars - 1, tonic = 48 + key;
  const kit = tier === 1
    ? hits(steps('naqDum', 'X.......x.......', 0, 1), steps('naqTek', '..x...x...x.xxxX', 0, 1), at([lastBar * 4], 'kos', 1), at([lastBar * 4], 'cymbal', 0.85))
    : tier === 2
      ? hits(steps('naqDum', 'X...x...X...x...', 0, 1), steps('naqTek', '..x...x.xxxxXXXX', 0, 1), clockwork(0, 1, 0.8), at([0, lastBar * 4], 'kos', 1), at([lastBar * 4], 'cymbal', 0.9))
      : hits(steps('naqDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('naqTek', 'x.x.x.x.xxxxXXXX', 1, 1), clockwork(0, 2, 0.8), at([0, 8], 'kos', 1), at([4], 'kosLo', 0.8), at([8], 'cymbal', 0.95));
  const tracks: Track[] = [
    { id: 'santur', kind: 'pitched', voice: 'santur', level: -19, send: 0.3, notes: lead, bright: 1.15 },
    { id: 'pipe', kind: 'pitched', voice: tier >= 2 ? 'zurnaSoft' : 'pipe', level: -24 + tier, send: 0.4, pan: 0.25, notes: vel(lead.filter(n => n.d >= 0.5), 0.8) },
    { id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -24.5, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 55 + Math.min(4, key), 76, 0.75) },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -25, send: 0.5, notes: held(chords, 3, 60, 76, 0.65) },
    ...(tier >= 2 ? [{ id: 'choir', kind: 'pad' as const, voice: 'padChoirMale' as const, level: -24, send: 0.5, width: 1.6, chords: pads(chords, 4, 48, 67, 0.8) }] : []),
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: bassNotes },
    { id: 'kit', kind: 'kit', level: -22, send: 0.14, hits: kit },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -24.5, send: 0.5, pan: 0.3, notes: [{ t: lastBar * 4, d: 2, n: nearest((key) % 12, 84), v: 0.9 }, { t: lastBar * 4 + 0.02, d: 2, n: nearest((7 + key) % 12, 91), v: 0.7 }] },
    { id: 'tonic', kind: 'pitched', voice: 'santurSoft', level: -25, send: 0.25, pan: -0.2, notes: strum(lastBar * 4, [tonic, tonic + 7, tonic + 12], 3, 0.9) },
    ...(tier === 3 ? [{ id: 'fx', kind: 'fx' as const, level: -26, send: 0.3, width: 1.4, fx: [{ t: 4, d: 4, k: 'whirr' as const, v: 0.7, density: 90 }, { t: 6, d: 2, k: 'swell' as const, v: 0.35 }] }] : []),
  ];
  return {
    id: `cezeri-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2.4, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'C', 'D', 'E'][tier]} Çargah-major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): ${tier === 1 ? 'the escapement turn in major' : 'a santur climb'} over a 16th santur gear train, water-organ chords, ${tier >= 2 ? 'zurna-like reed' : 'automaton flute'} on the long notes${tier >= 2 ? ', wordless male choir, the escapement ticking' : ''}, naqqara${tier === 3 ? ' in double time with a gear-train wind-up' : ''}; it lands on a held tonic with a kös, a hand cymbal, a santur roll and chime rods.`,
    tracks,
  };
}

/** Big win tier 4 — "Efsane", G Çargah-major, 120 BPM, 3 bars (6 s): the most radiant head. */
const EFSANE_LEAD = 'G4:.25 C5:.25 E5:.25 G5:.25 C6:1 G5:.5 A5:.5 F5:1 | F5:.5 E5:.25 D5:.25 F5:1 G5:.5 A5:.5 B4:.5 D5:.5 | C5:3 r:1';
const EFSANE_CHORDS = 'C:2 F:2 | Dm:2 G:2 | C';
function legend(): Score {
  const key = TIER_KEY[4], lk = leadShift(key);
  const chords = shiftChords(progression(EFSANE_CHORDS), key), lead = melody(EFSANE_LEAD, 0, 4, lk + 12);
  return {
    id: 'cezeri-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Big win tier 4 (Efsane), G Çargah-major, 120 BPM, 3 bars (6 s): I – IV | ii – V | I. Santur lead with the zurna-like reed doubling and santur tremolo an octave below, full male choir, water organ, chime rods on every downbeat, the escapement in double time, a naqqara roll into the last bar, kös and hand cymbals.',
    tracks: [
      { id: 'santur', kind: 'pitched', voice: 'santur', level: -19, send: 0.3, notes: lead, bright: 1.2 },
      { id: 'zurna', kind: 'pitched', voice: 'zurnaSoft', level: -21.5, send: 0.4, pan: 0.2, notes: vel(lead.filter(n => n.d >= 0.5), 0.85) },
      { id: 'tremolo', kind: 'pitched', voice: 'santurSoft', level: -24, send: 0.3, pan: -0.25, bright: 0.8, notes: vel(tremolo(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.5, 0.125), 0.65) },
      { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22.5, send: 0.5, width: 1.7, chords: pads(chords, 4, 50, 70, 0.95) },
      { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -24.5, send: 0.5, notes: held(chords, 3, 62, 79, 0.7) },
      { id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -24.5, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 57, 78, 0.75) },
      { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -23.5, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 91, v: 0.8 }, { t: 4, d: 2, n: 93, v: 0.75 }, { t: 8, d: 2, n: 91, v: 0.9 }, { t: 8.02, d: 2, n: 86, v: 0.7 }] },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20.5, send: 0, notes: melody('G1:2 C2:2 | A1:2 D2:2 | G1:3 r:1') },
      { id: 'kit', kind: 'kit', level: -21.5, send: 0.14, hits: hits(steps('naqDum', 'X...x...X...x...', 0, 2), steps('naqTek', 'x.x.x.x.x.x.xxxx', 1, 1), ...Array.from({ length: 8 }, (_, i) => [{ t: 6 + i * 0.25, k: 'naqTek', v: 0.45 + i * 0.07 }]), steps('escTick', 'x.x.x.x.x.x.x.x.', 0, 2, 0.7), at([0, 8], 'kos', 1), at([4], 'kosLo', 0.8), at([0, 8], 'cymbal', 0.9)) },
      { id: 'fx', kind: 'fx', level: -25, send: 0.3, width: 1.5, fx: [{ t: 4, d: 4, k: 'riser', v: 0.5 }, { t: 6, d: 2, k: 'whirr', v: 0.7, density: 100 }] },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), legend()] as const;

/**
 * Count-up beds: a 4-bar I – IV – vi – IV/V loop at 120 BPM per tier, in the tier's key, layered more fully per tier:
 * 1 santur 16ths, drone, bass, the escapement and naqqara tek · 2 + naqqara düm groove, water organ, hand cymbal ·
 * 3 + santur lead and tek 8ths · 4 + male choir, chime rods, kös · max + zurna-like reed doubling the lead, a ratchet roll and gear whirr.
 */
const BED_CHORDS = progression('C | F | Am | F:2 G:2');
const BED_LEAD = 'G5:.75 E5:.25 G5:.5 C6:1.5 D6:.5 E6:.5 | F6:.75 C6:.25 A5:.5 C6:1.5 D6:.5 C6:.5 | E6:.75 C6:.25 A5:.5 E6:1 F6:.5 E6:.5 C6:.5 | D6:1 F6:1 E6:.5 D6:.5 B5:1';
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tonic = 36 + key;
  const tracks: Track[] = [
    { id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -23, send: 0.2, pan: 0.4, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 55 + Math.min(4, key), 76, 0.7, 3, 0.6) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -27, send: 0.3, chords: [{ t: 0, d: 16, ns: [tonic, tonic + 7], v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.8, 40, 31, 47) },
    { id: 'perc', kind: 'kit', level: -27, send: 0.12, hits: hits(clockwork(0, 4, 0.7), steps('naqTek', '....x.......x...', 0, 4)) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'naq', kind: 'kit', level: -23, send: 0.1, hits: steps('naqDum', 'X...x...X...x...', 0, 4) });
    tracks.push({ id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -25.5, send: 0.5, notes: held(chords, 3, 60, 76, 0.65) });
    tracks.push({ id: 'cymbal', kind: 'kit', level: -30, send: 0.35, hits: at([0, 8], 'cymbalSoft', 0.65) });
  }
  if (level >= 3) {
    tracks.push({ id: 'santur', kind: 'pitched', voice: 'santur', level: -20, send: 0.3, notes: melody(BED_LEAD, 0, 4, lk), bright: 1.05 });
    tracks.push({ id: 'tek', kind: 'kit', level: -28, send: 0.1, hits: steps('naqTek', '..x...x...x...x.', 0, 4) });
  }
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -24.5, send: 0.5, width: 1.7, chords: pads(chords, 4, 48, 67, 0.85) });
    tracks.push({ id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -26, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 84), v: 0.7 })) });
    tracks.push({ id: 'kos', kind: 'kit', level: -26, send: 0.22, hits: chords.flatMap(c => [{ t: c.t, k: 'kos', v: 0.9 }, { t: c.t + c.d - 0.5, k: 'naqDum', v: 0.5 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'zurna', kind: 'pitched', voice: 'zurnaSoft', level: -24, send: 0.42, pan: -0.3, notes: vel(melody(BED_LEAD, 0, 4, lk).filter(n => n.d >= 0.5), 0.75) });
    tracks.push({ id: 'ratchet', kind: 'kit', level: -28, send: 0.12, hits: steps('ratchet', '........g.g.gggx', 3, 1) });
    tracks.push({ id: 'fx', kind: 'fx', level: -29, send: 0.25, fx: [{ t: 12, d: 4, k: 'whirr', v: 0.7, density: 90 }] });
  }
  const keyName = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A'][key];
  return {
    id: `cezeri-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -5.5,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – IV – vi – IV/V in ${keyName} Çargah-major at 120 BPM, 4-bar seamless loop (8 s); ${['santur 16ths, drone, bass, the escapement and naqqara tek', '+ naqqara düm groove, water organ, hand cymbal', '+ santur lead and tek 8ths', '+ male choir, chime rods, kös', '+ zurna-like reed doubling the lead, a ratchet roll and gear whirr'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/** Max win — the top of the ladder: A Çargah-major, 120 BPM, 3 bars (6 s), IV – V – bVII – I. */
const MAX_LEAD = 'C5:.5 E5:.5 A5:.5 C6:.5 E6:2 | D5:.5 G5:.5 B5:.5 D6:.5 D6:1 Bb5:1 | G5:.25 C6:.25 E6:.5 C6:.5 E6:2.5';
const MAX_CHORDS = 'F | G:2 Bb:2 | C';
function maxWin(): Score {
  const key = TIER_KEY.max, lk = leadShift(key);
  const chords = shiftChords(progression(MAX_CHORDS), key), lead = melody(MAX_LEAD, 0, 4, lk);
  return {
    id: 'cezeri-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3.2, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Max win, A (top of the key ladder), 120 BPM, 3 bars (6 s): IV – V – bVII – I (D – E – G – A) with santur and the zurna-like reed in octaves, santur tremolo, full male choir, water organ, chime rods climbing, a 16th santur gear train, a santur roll, double-time naqqara with a roll, the escapement racing, the kös and the biggest cymbal clash, the gear train winding up.',
    tracks: [
      { id: 'santur', kind: 'pitched', voice: 'santur', level: -19, send: 0.3, notes: lead, bright: 1.25 },
      { id: 'zurna', kind: 'pitched', voice: 'zurnaSoft', level: -21, send: 0.4, notes: vel(lead.filter(n => n.d >= 0.5), 0.9) },
      { id: 'tremolo', kind: 'pitched', voice: 'santurSoft', level: -23.5, send: 0.3, pan: -0.3, bright: 0.8, notes: vel(tremolo(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.5, 0.125), 0.65) },
      { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -21.5, send: 0.5, width: 1.8, chords: pads(chords, 4, 50, 72, 0.95) },
      { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -24, send: 0.5, notes: held(chords, 4, 60, 79, 0.7) },
      { id: 'gears', kind: 'pitched', voice: 'santurSoft', level: -24.5, send: 0.22, pan: 0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -23, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 86, v: 0.8 }, { t: 4, d: 1, n: 88, v: 0.8 }, { t: 6, d: 1, n: 91, v: 0.8 }, { t: 8, d: 2, n: 93, v: 0.95 }, { t: 8.02, d: 2, n: 88, v: 0.75 }] },
      { id: 'roll', kind: 'pitched', voice: 'santurSoft', level: -23.5, send: 0.2, notes: strum(8, [45, 52, 57, 61], 3, 0.95) },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20, send: 0, notes: melody('D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 D2:.5 | E2:.5 E2:.5 E2:.5 E2:.5 G1:.5 G1:.5 G1:.5 G1:.5 | A1:3 r:1') },
      { id: 'kit', kind: 'kit', level: -20.5, send: 0.14, hits: hits(steps('naqDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('naqTek', 'x.x.x.x.xxxxxxxx', 0, 2), ...Array.from({ length: 12 }, (_, i) => [{ t: 5 + i * 0.25, k: 'naqTek', v: 0.4 + i * 0.05 }]), steps('escTick', 'x.x.x.x.x.x.x.x.', 0, 2, 0.75), at([0, 4], 'kos', 1), at([8], 'kosLo', 1), at([8, 8.5], 'kos', 0.9), at([0], 'cymbalSoft', 0.8), at([8], 'cymbal', 1)) },
      { id: 'fx', kind: 'fx', level: -24, send: 0.3, width: 1.6, fx: [{ t: 0, d: 8, k: 'riser', v: 0.4 }, { t: 4, d: 4, k: 'whirr', v: 0.8, density: 110 }] },
    ],
  };
}
export const MAX_WIN = maxWin();

/** Total-win fanfare (end of the feature): C Çargah-major, 120 BPM, a festive santur, reed and flute flourish, 4 s to its musical end. */
const TOTAL_LEAD = 'C5:.25 E5:.25 G5:.5 r:.25 G5:.25 A5:.25 B5:.25 C6:.5 D6:.5 E6:.5 D6:.5 | F6:.5 D6:.5 C6:3';
export const TOTAL_WIN: Score = {
  id: 'cezeri-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win fanfare, C Çargah-major, 120 BPM, 4 s: C – Am – F | G – C. A festive santur flourish doubled by the zurna-like reed and the automaton flute, santur rolls, water organ, male choir on the final C with chime rods, naqqara, kös and a cymbal clash.',
  tracks: [
    { id: 'santur', kind: 'pitched', voice: 'santur', level: -19, send: 0.28, notes: melody(TOTAL_LEAD), bright: 1.15 },
    { id: 'zurna', kind: 'pitched', voice: 'zurnaSoft', level: -22, send: 0.4, pan: 0.25, notes: vel(melody(TOTAL_LEAD).filter(n => n.d >= 0.5), 0.8) },
    { id: 'pipe', kind: 'pitched', voice: 'pipe', level: -24, send: 0.4, pan: -0.2, notes: vel(melody(TOTAL_LEAD, 0, 4, 12).filter(n => n.d >= 0.5 && n.n <= 96), 0.7) },
    { id: 'strum', kind: 'pitched', voice: 'santurSoft', level: -24, send: 0.25, pan: -0.35, bright: 0.7, notes: [...strum(0, [48, 52, 55, 60], 0.8, 0.8), ...strum(1, [48, 52, 55, 60], 0.8, 0.7), ...strum(2, [45, 48, 52, 57], 0.8, 0.75), ...strum(3, [41, 45, 48, 53], 0.8, 0.75), ...strum(4, [43, 47, 50, 55], 0.8, 0.8), ...strum(5, [48, 52, 55, 60, 64], 3, 0.85)] },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -25, send: 0.5, notes: held(progression('C:2 Am:1 F:1 | G:1 C:3'), 3, 60, 76, 0.65) },
    { id: 'choir', kind: 'pad', voice: 'padChoirMale', level: -22.5, send: 0.5, width: 1.6, chords: [{ t: 5, d: 3, ns: [48, 52, 55, 60], v: 0.9 }] },
    { id: 'chime', kind: 'pitched', voice: 'chimeRod', level: -24, send: 0.5, notes: [{ t: 5, d: 3, n: 84, v: 0.85 }, { t: 5.5, d: 2.5, n: 91, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: melody('C2:2 A1:1 F1:1 | G1:1 C2:2 r:1') },
    { id: 'kit', kind: 'kit', level: -22, send: 0.14, hits: hits(steps('naqDum', 'X...x...X...x...', 0, 1), steps('naqTek', '..x...x.xxxxXXXX', 0, 1), steps('naqDum', 'X...x...........', 1, 1), at([5], 'kos', 1), at([5], 'cymbal', 0.95)) },
  ],
};

/* =====================================================================================
 * THE DİŞLİ KİLİDİ TENSION BED — two loops in lock-step (same length) that the runtime layers under a respin chain:
 * `chainBed` (the mechanism winding: kös heartbeat on C, the escapement in sixteenths, ratchet ghosts, a gear clank
 * per bar, an open-fifth water-organ drone, the gear whirr) and `chainBedHi` (the urgent layer: a santur gear train on
 * C–G–D, naqqara tek sixteenths, accented ratchets, kös eighths). Only C, G and D are pitched, so whichever hub tick
 * of the Nikriz or Çargah climb sounds over it, it stays consonant; the runtime opens a filter and raises the upper
 * layer with every respin.
 * ===================================================================================== */

export const CHAIN_BED: Score = {
  id: 'cezeri-chain-bed', bpm: 100, beatsPerBar: 4, bars: 2, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -7,
  target: { lufs: -16, measure: 'integrated' },
  about: 'Dişli Kilidi tension bed, 100 BPM, 2-bar seamless loop (4.8 s): kös heartbeat on C, the escapement in sixteenths, ratchet ghosts, a gear clank on each bar, an open-fifth water-organ drone (C2–G2–C3) and the whirr of the gear train. Pitched only on C and G.',
  tracks: [
    { id: 'kos', kind: 'kit', level: -21, send: 0.15, hits: steps('kos', 'X...x...X...x...', 0, 2, 0.9) },
    { id: 'clock', kind: 'kit', level: -24.5, send: 0.08, tame: 8, hits: hits(steps('escTick', 'X.x.x.x.X.x.x.x.', 0, 2), steps('escTock', '.o.o.o.o.o.o.o.o', 0, 2, 0.8)) },
    { id: 'ratchet', kind: 'kit', level: -28, send: 0.1, hits: steps('ratchet', '..g...g...g.g.g.', 0, 2) },
    { id: 'clank', kind: 'kit', level: -27, send: 0.18, hits: at([0, 4], 'clank', 0.8) },
    { id: 'organ', kind: 'pitched', voice: 'waterOrgan', level: -27, send: 0.3, notes: [36, 43, 48].map(n => ({ t: 0, d: 8, n, v: 0.6 })) },
    { id: 'fx', kind: 'fx', level: -29, send: 0.1, width: 1.3, fx: [{ t: 0, d: 8, k: 'whirr', v: 0.8, density: 60 }] },
  ],
};
export const CHAIN_BED_HI: Score = {
  id: 'cezeri-chain-bed-hi', bpm: 100, beatsPerBar: 4, bars: 2, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -7,
  target: { lufs: -16, measure: 'integrated' },
  about: 'Dişli Kilidi upper layer, 100 BPM, 2-bar loop in lock-step with the tension bed: a santur gear train in sixteenths on C–G–D, naqqara tek sixteenths, accented ratchets, kös eighths and a soft cymbal on the downbeat. Pitched only on C, G and D.',
  tracks: [
    { id: 'santur', kind: 'pitched', voice: 'santurSoft', level: -22, send: 0.2, bright: 0.8, notes: Array.from({ length: 32 }, (_, i) => ({ t: i * 0.25, d: 0.24, n: [72, 79, 84, 79, 86, 79, 84, 79][i % 8]!, v: i % 4 === 0 ? 0.85 : 0.6 })) },
    { id: 'naq', kind: 'kit', level: -24, send: 0.1, hits: hits(steps('naqTek', 'x.o.x.o.x.o.xoxo', 0, 2, 0.85), steps('naqDum', 'X.......X.......', 0, 2, 0.8)) },
    { id: 'ratchet', kind: 'kit', level: -26, send: 0.1, hits: steps('ratchet', 'x.g.x.g.x.g.xgxg', 0, 2, 0.8) },
    { id: 'kos', kind: 'kit', level: -24, send: 0.15, hits: steps('kos', '..x...x...x...x.', 0, 2, 0.7) },
    { id: 'cymbal', kind: 'kit', level: -30, send: 0.3, hits: at([0], 'cymbalSoft', 0.6) },
  ],
};

/** Ambience bed: the palace courtyard — fountain, the water clock dripping into its bowls, the far-off clock and a few water-whistle birds; 24 s loop. */
export const AMBIENCE: Score = {
  id: 'cezeri-ambience', bpm: 60, beatsPerBar: 4, bars: 6, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -6,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 24 s seamless loop: the palace courtyard — the fountain (falling water, splash and fine bubbles), the water clock dripping into two tuned bowls every 2.4 s, the far-off tick-tock of the great clock once a second and a few distant water-whistle birds, over a quiet room tone; no tempo-bound material.',
  tracks: [
    { id: 'courtyard', kind: 'fx', level: -32, send: 0.15, width: 1.3, fx: [{ t: 0, d: 24, k: 'courtyard', v: 1 }] },
    { id: 'room', kind: 'fx', level: -42, send: 0.05, width: 1.2, fx: [{ t: 0, d: 24, k: 'room', v: 1 }] },
  ],
};

export const CEZERI_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, retrigger: RETRIGGER, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, chainBed: CHAIN_BED, chainBedHi: CHAIN_BED_HI, ambience: AMBIENCE,
} as const;
export type CezeriScoreId = keyof typeof CEZERI_SCORES;

/**
 * Crest-factor control (render.ts `tame`) for the transient-heavy stems, so coincident naqqara, kös, clockwork and santur
 * attacks do not drive the master limiter: drums and clockwork 12 dB, hammered strings 13 dB, chime rods and drips 14 dB
 * above their gated RMS. The ambience is left untouched.
 */
for (const score of Object.values(CEZERI_SCORES)) {
  if (score === AMBIENCE) continue;
  for (const track of score.tracks) {
    if (track.tame !== undefined) continue;
    if (track.kind === 'kit') track.tame = 12;
    else if (track.kind === 'pitched' && (track.voice === 'santur' || track.voice === 'santurSoft')) track.tame = 13;
    else if (track.kind === 'pitched' && (track.voice === 'chimeRod' || track.voice === 'drip')) track.tame = 14;
  }
}
export const CEZERI_SCORE_IDS = Object.keys(CEZERI_SCORES) as CezeriScoreId[];
