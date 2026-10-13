/**
 * Ebru: Mürekkep Bahçesi music — original compositions written as note data for a Turkish paper-marbling
 * world (pigments floating on size water, golden combs, flower ebru). Melodies, harmony, bass lines and
 * grooves were written for this game; no existing game's, film's or song's melody, motif or sound is quoted
 * or imitated, and no commercial slot score is imitated. The rhythmic cycles borrow only the generic
 * shape of two traditional usul (Sofyan: düm – te-ke, Düyek: düm-tek · tek-düm · tek), which are common
 * property like a waltz or a clave.
 *
 * Modal colour, kept tonal and catchy (12-tone equal temperament approximations of the makam colours):
 *   base theme — G Rast (G A B C D E F#, with the descending F natural "acem"), its B section turns to
 *   A Uşşak (A minor with the Bb neighbour standing in for the lowered second), the C section breathes the
 *   Hüzzam / Hicaz colour over D (D Eb F# G) and resolves back to G through D7.
 *   feature theme — D Rast (D E F# G A B C#, C natural descending): the same world a fifth higher and faster.
 * The recurring signature, the "drop and ripple", is the hook's opening gesture: a high note falling like a
 * pigment drop, a quick four-note ripple turn around it, then the rings spreading downward (B5 · A B A G · E D).
 * Instruments are synthesized (synth/ebru.ts + synth/anatolian.ts): kanun-like zither, ud-like lute, ney-like
 * flute, glass harmonica, water glasses, kudüm-like kettle drums, frame drum, zil, a wordless "ah" choir and
 * water (bubbles, still-water bed).
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score, Track } from './types';
import { CELEBRATION_BPM, TIER_KEY, type WinTier } from '../win-tiers';

/* ---------------- arranging helpers ---------------- */

function pads(chords: ChordEvent[], count: number, lo: number, hi: number, v: number): PadEvent[] {
  let prev: number[] | null = null;
  return chords.map(c => { const ns = voice(c.tones, count, lo, hi, prev); prev = ns; return { t: c.t, d: c.d, ns, v }; });
}
/** The same voicings as single held notes, for a pitched pad voice (the glass harmonica). */
function held(chords: ChordEvent[], count: number, lo: number, hi: number, v: number, legato = 0.96): NoteEvent[] {
  return pads(chords, count, lo, hi, v).flatMap(p => p.ns.map(n => ({ t: p.t, d: p.d * legato, n, v: p.v })));
}

type BassStyle = 'half' | 'long' | 'pedal' | 'drive' | 'sofyan';
/** Bass from chord roots (G1–G2 register). 'sofyan' locks to the usul (1, the "and" of 2, 3). */
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
      case 'sofyan': push(0, root, 1.4, v); if (c.d >= 2) push(1.5, fifth, 0.45, v * 0.7); if (c.d >= 3) push(2, root, 1.8, v * 0.85); break;
      case 'drive': for (let k = 0; k < c.d * 2; k++) push(k * 0.5, k % 4 === 3 ? fifth : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.7 : v); break;
    }
  });
  return out;
}

/** Plucked ostinato over each chord's voicing; index −1 is the root below, indices past the voicing climb an octave. */
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

/** Kanun tremolo (the plectrum flutters on a long note): notes of at least `min` beats re-struck every `rate` beats. */
function tremolo(notes: NoteEvent[], min = 1, rate = 0.25): NoteEvent[] {
  return notes.flatMap(n => {
    if (n.d < min - 1e-9) return [n];
    const k = Math.round(n.d / rate);
    return Array.from({ length: k }, (_, i) => ({ t: n.t + i * rate, d: rate, n: n.n, v: n.v * (i === 0 ? 1 : i % 2 ? 0.58 : 0.7) }));
  });
}

/** A strum: the chord's notes a few ms apart (kanun or ud), each held `d` beats. */
function strum(t: number, ns: number[], d: number, v: number, gap = 0.05): NoteEvent[] { return ns.map((n, i) => ({ t: t + i * gap, d, n, v: v * (1 - i * 0.04) })); }

const within = (chords: ChordEvent[], fromBar: number, toBar: number, bpb = 4) => chords.filter(c => c.t >= fromBar * bpb - 1e-9 && c.t < toBar * bpb - 1e-9);
const hits = (...lists: HitEvent[][]) => lists.flat();
const shiftNotes = (notes: NoteEvent[], k: number): NoteEvent[] => notes.map(n => ({ ...n, n: n.n + k }));
const shiftChords = (chords: ChordEvent[], k: number): ChordEvent[] => chords.map(c => ({ ...c, root: (c.root + k + 12) % 12, tones: c.tones.map(t => (t + k + 12) % 12), bass: (c.bass + k + 12) % 12 }));
const vel = (notes: NoteEvent[], v: number) => notes.map(n => ({ ...n, v: n.v * v }));

/* =====================================================================================
 * BASE THEME — "Su Üstünde Renkler" (Colours on the Water)
 * G Rast, 96 BPM straight, 18 bars = 45.0 s seamless loop.
 * Form: A (8 bars: the 4-bar "drop and ripple" hook on kanun, a water-glass ping doubling each drop, its
 *       answer with the descending acem F and the ascending F# back, ud low plucks in Sofyan usul) ·
 *       B (6 bars: A Uşşak turn — the ud sings the melody with its Bb neighbour, the ney joins an octave
 *       up, the "ah" choir and glass harmonica open, kudüm in Düyek) · C (4 bars: breakdown in the Hüzzam
 *       colour over D — ney alone over glass drones and a frame-drum heartbeat, bubbles rising, a kanun
 *       run up into the hook).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  G:2 Em:2 | C:2 G:2 | Am:2 D:2 | D:2 G:2 |
  C | G:2 Am:2 | Am:2 F:2 | D:2 E7sus4:2 |
  Am | F:2 G:2 | Am:2 Em:2 | F | Dm:2 Bb:2 | E7sus4:2 E:2 |
  D | Cm:2 D:2 | Gm:2 D:2 | D7`);

/** The 4-bar hook: the "drop and ripple" (B5 · A B A G · E D), its rising answer to D6, the ripple a step lower and the cadence on G. */
export const EBRU_HOOK = `
  B5:1 A5:.25 B5:.25 A5:.25 G5:.25 E5:1 D5:1 |
  E5:.5 G5:.5 A5:.5 B5:.5 D6:1.5 B5:.5 |
  A5:1 G5:.25 A5:.25 G5:.25 F#5:.25 D5:1 E5:.5 F#5:.5 |
  A5:.75 B5:.25 A5:.5 F#5:.5 G5:2`;
const BASE_ANSWER = `
  C6:1 B5:.5 A5:.5 G5:1 E5:1 |
  D5:.5 E5:.5 G5:.5 B5:.5 A5:2 |
  C6:.5 B5:.5 A5:.5 G5:.5 F5:1 E5:.5 D5:.5 |
  E5:.5 F#5:.5 G5:.5 A5:.5 B5:1 A5:1`;
const BASE_UD = `
  E4:.5 A4:.5 C5:.75 Bb4:.25 A4:1 G4:.5 A4:.5 |
  F4:.5 A4:.5 C5:.5 D5:.5 E5:1 D5:.5 C5:.5 |
  C5:.5 D5:.5 E5:.5 G5:.5 E5:.5 D5:.25 E5:.25 B4:1 |
  A4:.5 C5:.5 F5:1.5 E5:.25 D5:.25 C5:1 |
  D5:.5 F5:.5 A5:1 Bb5:.5 A5:.25 G5:.25 F5:1 |
  E5:1 D5:.5 C5:.5 B4:.5 C5:.25 B4:.25 G#4:1`;
const BASE_NEY = `
  D5:1 Eb5:.5 F#5:.5 G5:2 |
  A5:1 G5:.5 F#5:.5 Eb5:1 D5:1 |
  Bb4:.5 C5:.5 D5:.5 Eb5:.5 F#5:1 G5:.5 A5:.5 |
  A5:1.5 G5:.25 F#5:.25 D5:1 r:1`;
/** The kanun's pickup run at the end of the loop, up into the hook (C6 resolves to the hook's B5). */
const BASE_RUN = 'r:3 D5:.125 E5:.125 F#5:.125 G5:.125 A5:.25 C6:.25';

const baseKudum = hits(
  // A: Sofyan — düm on 1, te on 3, ke on 4; a ghosted fill into bars 4 and 8
  steps('kudumDum', 'X...............', 0, 8), steps('kudumTek', '........x...o...', 0, 3), steps('kudumTek', '........x...o.gg', 3, 1),
  steps('kudumTek', '........x...o...', 4, 3), steps('kudumTek', '........x.g.xgxx', 7, 1),
  // B: Düyek — düm-tek · tek-düm · tek
  steps('kudumDum', 'x.......x.......', 8, 6), steps('kudumTek', '..x...x.....x...', 8, 5), steps('kudumTek', '..x...x.x.x.xxXX', 13, 1),
  // C: breakdown, then a roll back into the hook
  steps('kudumTek', 'x.x.x.x.xxxxXXXX', 17, 1, 0.7),
);
const baseFrame = hits(
  steps('frame', 'x.......o.......', 0, 8), steps('frameLo', 'X...............', 0, 1), steps('frameLo', 'x...............', 4, 1),
  steps('frame', 'x...........o...', 8, 6),
  steps('frame', 'o.......o.......', 14, 3), steps('frameLo', 'x...............', 17, 1),
);
const baseFx: FxEvent[] = [
  { t: 0, d: 1.5, k: 'bubbles', v: 0.7, density: 14 },
  { t: 8 * 4, d: 2, k: 'bubbles', v: 0.7, density: 12 },
  { t: 14 * 4, d: 6, k: 'bubbles', v: 0.6, density: 5, shape: 'flat' },
  { t: 17 * 4, d: 4, k: 'bubbles', v: 0.7, density: 10, shape: 'swell' },
];

export const BASE_THEME: Score = {
  id: 'ebru-base', bpm: 96, beatsPerBar: 4, bars: 18, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -15, measure: 'integrated' },
  about: 'G Rast (G A B C D E F#, descending F), 96 BPM, 18-bar seamless loop (45 s). A: the 4-bar "drop and ripple" hook on a kanun-like zither with a water-glass ping on every drop, its answer (acem F down, F# up) over ud low plucks in Sofyan usul · B: A Uşşak — the ud sings with its Bb neighbour, ney an octave up, wordless "ah" choir and glass harmonica, kudüm in Düyek · C: breakdown in the Hüzzam colour over D — ney over glass drones, frame-drum heartbeat, rising bubbles, a kanun run up into the hook.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.3, pan: 0.05, notes: [...melody(EBRU_HOOK, 0), ...melody(BASE_ANSWER, 4), ...melody(BASE_RUN, 17)], bright: 1 },
    { id: 'drops', kind: 'pitched', voice: 'waterGlass', level: -27, send: 0.45, pan: 0.3, notes: [{ t: 0, d: 1, n: 83, v: 0.8 }, { t: 8, d: 1, n: 81, v: 0.7 }, { t: 16, d: 1, n: 84, v: 0.75 }, { t: 24, d: 1, n: 84, v: 0.7 }] },
    { id: 'ud', kind: 'pitched', voice: 'ud', level: -21.5, send: 0.25, pan: -0.12, notes: melody(BASE_UD, 8), bright: 0.9 },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.45, pan: 0.12, notes: [...vel(melody(BASE_UD, 8, 4, 12).filter(n => n.t >= 11 * 4), 0.75), ...melody(BASE_NEY, 14)] },
    {
      id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -26.5, send: 0.24, pan: 0.42, bright: 0.6,
      notes: [...ostinato(within(BASE_CHORDS, 0, 8), [-1, 0, 2, 1, -1, 2, 1, 0], 0.5, 55, 71, 0.7), ...ostinato(within(BASE_CHORDS, 8, 14), [0, 1, 2, 1], 1, 57, 72, 0.55)],
    },
    { id: 'udbass', kind: 'pitched', voice: 'ud', level: -24, send: 0.12, pan: -0.25, bright: 0.5, notes: bassLine(within(BASE_CHORDS, 0, 8), 'sofyan', 0.85, 46, 40, 52) },
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -26, send: 0.5, pan: -0.05, notes: [...held(within(BASE_CHORDS, 4, 14), 3, 62, 76, 0.65), ...held(within(BASE_CHORDS, 14, 18), 2, 62, 74, 0.6)] },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -25, send: 0.5, width: 1.6, chords: pads(within(BASE_CHORDS, 8, 14), 3, 55, 72, 0.75) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -29.5, send: 0.3, width: 1.5, chords: [{ t: 0, d: 16, ns: [43, 50, 55], v: 0.5 }, { t: 56, d: 16, ns: [38, 45, 50], v: 0.55 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -25, send: 0.03, notes: bassLine(BASE_CHORDS, bar => (bar < 8 ? 'pedal' : bar < 14 ? 'long' : 'pedal'), 0.75) },
    { id: 'kudum', kind: 'kit', level: -25, send: 0.14, width: 1.3, hits: baseKudum },
    { id: 'frame', kind: 'kit', level: -26, send: 0.18, hits: baseFrame },
    { id: 'zil', kind: 'kit', level: -31, send: 0.4, hits: [0, 16, 32, 48].map(t => ({ t, k: 'zil', v: 0.6 })) },
    { id: 'fx', kind: 'fx', level: -29, send: 0.35, width: 1.5, fx: baseFx },
  ],
};

/* IDLE — the A section re-orchestrated for attract mode: the hook on the glass harmonica, its answer on the ney,
   a few kanun plucks, a drone and a soft frame drum; no kudüm. Same tempo as base bars 1–8 (phase-aligned fades). */
export const IDLE_THEME: Score = {
  id: 'ebru-idle', bpm: 96, beatsPerBar: 4, bars: 8, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -16, measure: 'integrated' },
  about: 'G Rast, 96 BPM, 8-bar loop (20 s): the hook on a glass harmonica, its answer on a breathy ney, sparse kanun plucks, a G–D drone, "ah" choir at the cadences, a soft frame drum and slow bubbles; no kudüm.',
  tracks: [
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -20, send: 0.5, pan: 0.05, notes: vel(melody(EBRU_HOOK, 0), 0.8) },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.5, pan: 0.1, notes: vel(melody(BASE_ANSWER, 4, 4, -12), 0.7) },
    { id: 'kanun', kind: 'pitched', voice: 'kanunSoft', level: -25, send: 0.35, pan: -0.35, bright: 0.5, notes: ostinato(within(BASE_CHORDS, 0, 8), [-1, 2], 2, 55, 71, 0.6) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -25, send: 0.35, width: 1.6, chords: [{ t: 0, d: 32, ns: [43, 50, 55, 62], v: 0.5 }] },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -28, send: 0.5, width: 1.5, chords: [{ t: 12, d: 4, ns: [55, 59, 62, 67], v: 0.5 }, { t: 28, d: 4, ns: [54, 57, 62, 66], v: 0.5 }] },
    { id: 'frame', kind: 'kit', level: -31, send: 0.25, hits: steps('frame', 'o.......o.......', 0, 8) },
    { id: 'fx', kind: 'fx', level: -31, send: 0.35, width: 1.4, fx: [{ t: 0, d: 30, k: 'bubbles', v: 0.6, density: 1.2, shape: 'flat' }] },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Lale Ebrusu" (The Tulip Bloom)
 * D Rast (D E F# G A B C#, C natural descending), 116 BPM straight, 16 bars = 33.1 s loop.
 * Form: A (8 bars: the kanun riff — the drop-and-ripple motif a fifth up and twice as busy — over a 16th
 *       kanun ostinato, ud riff and kudüm in a driving Düyek) · B (8 bars: the ney sings the euphoric answer up
 *       to F#6 with kanun tremolo an octave below, the "ah" choir and glass bells on every downbeat, frame
 *       drum on the beat); bubbles and a roll back into A.
 * ===================================================================================== */

const FEAT_CHORDS = progression(`
  D | Bm:2 G:2 | Em:2 A:2 | D:2 A:2 | D | G:2 A:2 | Bm:2 C:2 | A7sus4:2 A:2 |
  G | A | F#m:2 Bm:2 | G:2 A:2 | Em:2 G:2 | A:2 Bm:2 | C:2 G:2 | A:2 A7:2`);
export const EBRU_FEATURE_RIFF = `
  F#5:.5 E5:.25 F#5:.25 E5:.25 D5:.25 B4:.5 A4:.5 D5:.5 F#5:.5 A5:.5 |
  B5:1 A5:.5 F#5:.5 G5:.75 F#5:.25 E5:.5 D5:.5 |
  E5:.5 G5:.5 B5:.5 G5:.5 A5:.5 C#6:.5 E6:.5 C#6:.5 |
  D6:1 C#6:.5 B5:.5 A5:1 r:.5 A4:.5 |
  F#5:.5 E5:.25 F#5:.25 E5:.25 D5:.25 B4:.5 A4:.5 D5:.5 F#5:.5 B5:.5 |
  D6:.5 B5:.5 G5:.5 B5:.5 C#6:.5 E6:.5 A5:1 |
  B5:.5 C#6:.25 D6:.25 F#5:.5 B5:.5 C6:.5 B5:.25 A5:.25 G5:.5 E5:.5 |
  D6:.5 C#6:.5 B5:.5 A5:.5 G5:.5 E5:.5 C#5:.5 E5:.5`;
const FEAT_ANSWER = `
  B5:1.5 A5:.5 G5:.5 A5:.5 B5:1 |
  C#6:1.5 B5:.5 A5:.5 B5:.5 C#6:1 |
  D6:1 C#6:.5 A5:.5 B5:1.5 D6:.5 |
  E6:1 D6:.5 B5:.5 C#6:1 A5:1 |
  G5:.5 A5:.5 B5:.5 D6:.5 E6:1.5 D6:.5 |
  C#6:.5 D6:.5 E6:.5 C#6:.5 D6:1 F#6:1 |
  E6:.5 D6:.5 C6:.5 B5:.5 D6:1 B5:1 |
  A5:1 B5:.5 C#6:.5 E6:.5 D6:.25 C#6:.25 A5:1`;
/** Ud riff under the A section: a two-bar figure on the chord roots and fifths. */
function udRiff(chords: ChordEvent[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const c of chords) {
    const root = nearest(c.root, 50), r = root > 55 ? root - 12 : root;
    const fig: [number, number, number][] = c.d >= 4 ? [[0, 0, 0.75], [0.75, 7, 0.25], [1, 12, 0.5], [1.5, 7, 0.5], [2.5, 0, 0.5], [3, 10, 0.5], [3.5, 7, 0.5]] : [[0, 0, 0.75], [0.75, 7, 0.25], [1, 12, 0.5], [1.5, 7, 0.5]];
    for (const [t, k, d] of fig) if (t < c.d - 1e-9) out.push({ t: c.t + t, d: d * 0.9, n: r + (k === 10 ? (c.tones.includes((c.root + 10) % 12) ? 10 : 9) : k), v: t === 0 ? 0.9 : 0.68 });
  }
  return out;
}

const featKudum = hits(
  steps('kudumDum', 'x.......x.......', 0, 15), steps('kudumTek', '..x...x.....x.x.', 0, 15), steps('kudumTek', '.g.g.g.g.g.g.g.g', 8, 7, 0.7),
  steps('kudumDum', 'x.......x.......', 15, 1), steps('kudumTek', 'x.x.x.x.xxxxXXXX', 15, 1, 0.85),
);
const featFrame = hits(steps('frame', 'x...x...x...x...', 0, 8, 0.8), steps('frameLo', 'X...............', 8, 8), steps('frame', '....x...x...x...', 8, 8, 0.8));

export const FEATURE_THEME: Score = {
  id: 'ebru-feature', bpm: 116, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' },
  about: 'D Rast (D E F# G A B C#, C natural descending), 116 BPM, 16-bar loop (33.1 s). A: the kanun riff (the drop-and-ripple motif a fifth up, twice as busy) over a 16th kanun ostinato, an ud riff and kudüm in a driving Düyek · B: the ney sings the euphoric answer up to F#6 with kanun tremolo an octave below, "ah" choir, glass bells and a low frame drum on every downbeat; driving bass, bubbles, a kudüm roll back into A.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19.5, send: 0.26, pan: 0.05, notes: melody(EBRU_FEATURE_RIFF, 0), bright: 1.1 },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -20, send: 0.42, pan: 0.1, notes: melody(FEAT_ANSWER, 8) },
    { id: 'tremolo', kind: 'pitched', voice: 'kanun', level: -24, send: 0.3, pan: -0.3, transpose: -12, bright: 0.8, notes: vel(tremolo(melody(FEAT_ANSWER, 8), 1, 0.25), 0.7) },
    { id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -25.5, send: 0.18, pan: 0.42, bright: 0.7, notes: ostinato(FEAT_CHORDS, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 57, 74, 0.7, 3, 0.6) },
    { id: 'udriff', kind: 'pitched', voice: 'ud', level: -23.5, send: 0.15, pan: -0.2, bright: 0.9, notes: udRiff(within(FEAT_CHORDS, 0, 8)) },
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -26, send: 0.5, notes: held(within(FEAT_CHORDS, 0, 8), 3, 62, 78, 0.6) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -23.5, send: 0.48, width: 1.7, chords: pads(within(FEAT_CHORDS, 8, 16), 4, 57, 74, 0.85) },
    { id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -26, send: 0.45, pan: 0.32, notes: within(FEAT_CHORDS, 8, 16).filter(c => c.t % 4 === 0).map(c => ({ t: c.t, d: 1, n: nearest(c.root, 86), v: 0.75 })) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22.5, send: 0, notes: bassLine(FEAT_CHORDS, 'drive', 0.8, 38, 33, 47) },
    { id: 'kudum', kind: 'kit', level: -23, send: 0.12, width: 1.3, hits: featKudum },
    { id: 'frame', kind: 'kit', level: -25, send: 0.16, hits: featFrame },
    { id: 'zil', kind: 'kit', level: -29, send: 0.35, hits: [0, 8, 16, 24, 32, 40, 48, 56].map(t => ({ t, k: 'zil', v: t === 32 ? 0.8 : 0.55 })) },
    { id: 'fx', kind: 'fx', level: -28, send: 0.3, width: 1.5, fx: [
      { t: 0, d: 1.5, k: 'bubbles', v: 0.7, density: 16 }, { t: 32, d: 2, k: 'bubbles', v: 0.8, density: 18 }, { t: 15 * 4, d: 4, k: 'bubbles', v: 0.7, density: 12, shape: 'swell' },
    ] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Free-spins intro: the golden comb chime cascade — a kanun glissando up D Rast, water glasses falling, "ah" swell; the feature enters at beat 6 (3.10 s). */
export const FS_INTRO: Score = {
  id: 'ebru-fs-intro', bpm: 116, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 6,
  about: 'Free-spins intro, D Rast, 116 BPM: the golden chime cascade — a 32nd-note kanun glissando up the D pentatonic to A6 while water glasses fall back down, an "ah" choir swell, a frame-drum roll and rising bubbles, then a D major strum with glass bells, zil and a low ud D on beat 4; the feature theme enters at beat 6 (3.10 s).',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.32, bright: 1.2, notes: [
      ...[62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86, 88, 90, 93].map((n, i) => ({ t: i * 0.125, d: 0.5, n, v: 0.65 + i * 0.02 })),
      ...strum(4, [62, 66, 69, 74, 78], 2, 0.9, 0.04),
    ] },
    { id: 'glass', kind: 'pitched', voice: 'waterGlass', level: -22, send: 0.5, pan: 0.25, notes: [93, 90, 88, 86, 83, 81, 78, 74].map((n, i) => ({ t: 1.75 + i * 0.25, d: 1, n, v: 0.8 - i * 0.03 })).concat([{ t: 4, d: 2, n: 86, v: 0.9 }, { t: 4.02, d: 2, n: 81, v: 0.7 }]) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -21.5, send: 0.5, width: 1.7, chords: [{ t: 0.5, d: 3.5, ns: [57, 62, 66, 69], v: 0.75 }, { t: 4, d: 2.5, ns: [62, 66, 69, 74], v: 0.95 }] },
    { id: 'ud', kind: 'pitched', voice: 'ud', level: -22, send: 0.2, notes: [{ t: 4, d: 2, n: 50, v: 0.95 }, { t: 4.04, d: 2, n: 57, v: 0.8 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: melody('D2:2 E2:1 C#2:1 | D2:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -22, send: 0.18, hits: hits(steps('frameLo', 'X...............', 0, 1), steps('frame', '........x.x.xxxx', 0, 1, 0.85), steps('kudumTek', '........xxxxXXXX', 0, 1, 0.8), steps('frameLo', 'X.......x.......', 1, 1), steps('zil', 'X...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.32, width: 1.5, fx: [{ t: 0, d: 4, k: 'bubbles', v: 0.8, density: 14, shape: 'swell' }, { t: 4, d: 2, k: 'bubbles', v: 0.8, density: 16 }] },
  ],
};

/** Retrigger (+4 spins): a kanun flourish to a held D6 with zil and water glasses; musical end at beat 3 (1.55 s). */
export const RETRIGGER: Score = {
  id: 'ebru-retrigger', bpm: 116, beatsPerBar: 4, bars: 1, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 3,
  about: 'Retrigger (+4), D Rast, 116 BPM, 1 bar: a 32nd-note kanun flourish A–B–D–E–F#–A up to a held D6 with its tremolo, water-glass pings D6/A6, zil and a kudüm hit, a puff of bubbles; ends at beat 3 (1.55 s) and rings over the feature theme.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, bright: 1.15, notes: [...melody('A4:.125 B4:.125 D5:.125 E5:.125 F#5:.125 A5:.125 D6:.25 r:3'), ...tremolo([{ t: 1, d: 1.5, n: 86, v: 0.8 }], 1, 0.125)] },
    { id: 'glass', kind: 'pitched', voice: 'waterGlass', level: -21.5, send: 0.45, pan: 0.25, notes: [{ t: 1, d: 1, n: 86, v: 0.9 }, { t: 1.5, d: 1, n: 93, v: 0.7 }] },
    { id: 'ud', kind: 'pitched', voice: 'ud', level: -23, send: 0.2, notes: [{ t: 1, d: 1.5, n: 50, v: 0.9 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -23, send: 0, notes: melody('r:1 D2:2 r:1') },
    { id: 'kit', kind: 'kit', level: -22, send: 0.2, hits: hits(steps('kudumDum', '....X...........', 0, 1), steps('kudumTek', 'xxxx............', 0, 1, 0.7), steps('zil', '....X...........', 0, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.3, fx: [{ t: 1, d: 1.5, k: 'bubbles', v: 0.8, density: 16 }] },
  ],
};

/** Feature outro: the garden settles — back to G Rast, 96 BPM, C – D | G; the base theme may return at beat 6 (3.75 s). */
export const FS_OUTRO: Score = {
  id: 'ebru-fs-outro', bpm: 96, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.5, reverb: 'hall', reverbDb: -3.5,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 6,
  about: 'Feature outro ("the garden settles"), G Rast, 96 BPM: C – D | G with a ney phrase D–E–D–B–A–B–D falling to G, kanun strums, glass harmonica and "ah" choir, a last water-glass drop and slow bubbles; the base theme may return at beat 6 (3.75 s).',
  tracks: [
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -19, send: 0.45, notes: melody('D5:.5 E5:.25 D5:.25 B4:1 A4:.5 B4:.5 D5:1 | G4:3 r:1') },
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -23, send: 0.35, pan: -0.3, bright: 0.7, notes: [...strum(0, [60, 64, 67, 72], 1.5, 0.75), ...strum(2, [62, 66, 69, 74], 1.5, 0.75), ...strum(4, [55, 59, 62, 67, 71], 3, 0.85)] },
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -24, send: 0.5, notes: held(progression('C:2 D:2 | G'), 3, 62, 76, 0.6) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.5, width: 1.6, chords: pads(progression('C:2 D:2 | G'), 4, 55, 72, 0.75) },
    { id: 'drop', kind: 'pitched', voice: 'waterGlass', level: -25, send: 0.5, pan: 0.3, notes: [{ t: 4, d: 2, n: 79, v: 0.8 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -24, send: 0.03, notes: melody('C2:2 D2:2 | G1:3 r:1') },
    { id: 'kit', kind: 'kit', level: -28, send: 0.22, hits: hits(steps('frame', 'x.......x.......', 0, 1), steps('frameLo', 'x...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -29, send: 0.35, fx: [{ t: 0, d: 8, k: 'bubbles', v: 0.6, density: 3, shape: 'flat' }] },
  ],
};

/* =====================================================================================
 * WIN CELEBRATIONS — the shared key ladder (win-tiers.ts TIER_KEY) from G: Büyük G → Mega A → Süper B →
 * Efsane D → Max win E, all Rast-major (G major with the bVII colour of the descending acem). 120 BPM so
 * tier-up hits land on one pulse; every tier adds layers.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
/** Melodies in keys above B are written lower (the tonic still rises; the kanun stays in its sweet register). */
const leadShift = (key: number) => (key > 4 ? key - 12 : key);

/** Big-win heads 1–3 in their tier keys (1 G, 2 A, 3 B); each ripples up and lands on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = {
    1: { bars: 2, chords: 'G:2 C:1 D:1 | G', lead: 'D5:.25 G5:.25 B5:.25 D6:.25 B5:.25 A5:.25 B5:.25 A5:.25 G5:1 A5:.5 F#5:.5 | G5:3 r:1', bass: 'G1:2 C2:1 D2:1 | G1:3 r:1', lufs: -15 },
    2: { bars: 2, chords: 'G:1 Em:1 C:1 D:1 | G', lead: 'G4:.25 A4:.25 B4:.25 D5:.25 E5:.25 G5:.25 A5:.5 G5:.5 E5:.5 D6:1 | B5:1 A5:.5 B5:.5 G5:2', bass: 'G1:1 E2:1 C2:1 D2:1 | G1:3 r:1', lufs: -14.5 },
    3: { bars: 3, chords: 'Em:2 C:2 | Am:2 D:2 | G', lead: 'B4:.25 E5:.25 G5:.25 B5:.25 G5:.5 E5:.5 C5:.25 E5:.25 G5:.25 C6:.25 G5:1 | C5:.25 E5:.25 A5:.25 C6:.25 A5:.5 E5:.5 D5:.25 F#5:.25 A5:.25 D6:.25 C6:1 | B5:.5 A5:.5 G5:2 r:1', bass: 'E2:2 C2:2 | A1:2 D2:2 | G1:3 r:1', lufs: -14 },
  }[tier];
  const key = TIER_KEY[tier], lk = leadShift(key);
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, lk), bassNotes = melody(spec.bass, 0, 4, key).map(n => ({ ...n, n: n.n > 45 ? n.n - 12 : n.n }));
  const lastBar = spec.bars - 1, tonic = 43 + key;
  const kit = tier === 1
    ? hits(steps('kudumDum', 'X.......x.......', 0, 1), steps('kudumTek', '..x...x...x.xxxX', 0, 1), steps('frameLo', 'X...............', 1, 1), steps('zil', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('kudumDum', 'X...x...X...x...', 0, 1), steps('kudumTek', '..x...x.xxxxXXXX', 0, 1), steps('frame', 'x...x...x...x...', 0, 1, 0.8), steps('frameLo', 'X...............', 1, 1), steps('zil', 'X...............', 1, 1))
      : hits(steps('kudumDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('kudumTek', 'x.x.x.x.xxxxXXXX', 1, 1), steps('frame', 'x...x...x...x...', 0, 2, 0.85), steps('frameLo', 'X...............', 0, 1), steps('frameLo', 'X...............', 2, 1), steps('zil', 'X...............', 2, 1));
  const tracks: Track[] = [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, notes: lead, bright: 1.15 },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -24 + tier, send: 0.4, pan: 0.25, notes: vel(lead.filter(n => n.d >= 0.5), 0.8) },
    { id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -24.5, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 55 + Math.min(4, key), 76, 0.75) },
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -24, send: 0.5, notes: held(chords, 3, 62, 79, 0.7) },
    ...(tier >= 2 ? [{ id: 'choir', kind: 'pad' as const, voice: 'padChoir' as const, level: -23.5, send: 0.5, width: 1.6, chords: pads(chords, 4, 55, 74, 0.8) }] : []),
    { id: 'ud', kind: 'pitched', voice: 'ud', level: -24, send: 0.18, pan: -0.2, notes: [{ t: lastBar * 4, d: 3, n: tonic, v: 0.95 }, { t: lastBar * 4 + 0.04, d: 3, n: tonic + 7, v: 0.8 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: bassNotes },
    { id: 'kit', kind: 'kit', level: -22, send: 0.14, hits: kit },
    { id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -25, send: 0.5, pan: 0.3, notes: [{ t: lastBar * 4, d: 2, n: nearest((7 + key) % 12, 86), v: 0.9 }] },
    { id: 'fx', kind: 'fx', level: -25, send: 0.32, width: 1.5, fx: [
      { t: 0, d: 1.5, k: 'bubbles', v: 0.8, density: 18 }, { t: lastBar * 4, d: 2, k: 'bubbles', v: 0.8, density: 20 },
      ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.5 }, { t: 6, d: 2, k: 'swell' as const, v: 0.35 }] : []),
    ] },
  ];
  return {
    id: `ebru-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2.4, reverb: 'hall', reverbDb: -4.5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'G', 'A', 'B'][tier]} Rast-major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): a kanun ripple climbing over a 16th kanun ostinato, glass harmonica chords, ney on the long notes${tier >= 2 ? ', "ah" choir' : ''}, kudüm and frame drum${tier === 3 ? ', a riser and double-time kudüm' : ''}; it lands on a held tonic with an ud strum, a water-glass bell, zil and a burst of bubbles.`,
    tracks,
  };
}

/** Big win tier 4 — "Efsane", D Rast-major, 120 BPM, 3 bars (6 s): the most radiant head. */
const EFSANE_LEAD = 'D5:.25 G5:.25 B5:.25 D6:.25 G6:1 D6:.5 E6:.5 C6:1 | C6:.5 B5:.25 A5:.25 C6:1 D6:.5 E6:.5 F#5:.5 A5:.5 | G5:3 r:1';
const EFSANE_CHORDS = 'G:2 C:2 | Am:2 D:2 | G';
function legend(): Score {
  const key = TIER_KEY[4], lk = leadShift(key);
  const chords = shiftChords(progression(EFSANE_CHORDS), key), lead = melody(EFSANE_LEAD, 0, 4, lk);
  return {
    id: 'ebru-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Big win tier 4 (Efsane), D Rast-major, 120 BPM, 3 bars (6 s): I – IV | ii – V | I. Kanun lead with ney doubling and kanun tremolo an octave below, full "ah" choir, glass harmonica, water-glass bells on every downbeat, kudüm roll into the last bar, zil and two bubble bursts.',
    tracks: [
      { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, notes: lead, bright: 1.2 },
      { id: 'ney', kind: 'pitched', voice: 'ney', level: -21, send: 0.4, pan: 0.2, notes: vel(lead.filter(n => n.d >= 0.5), 0.85) },
      { id: 'tremolo', kind: 'pitched', voice: 'kanun', level: -24, send: 0.3, pan: -0.25, bright: 0.8, notes: vel(tremolo(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.5, 0.125), 0.65) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.95) },
      { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -24, send: 0.5, notes: held(chords, 3, 62, 79, 0.7) },
      { id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -24.5, send: 0.22, pan: -0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 57, 78, 0.75) },
      { id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -23.5, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 86, v: 0.8 }, { t: 4, d: 2, n: 88, v: 0.75 }, { t: 8, d: 2, n: 86, v: 0.9 }, { t: 8.02, d: 2, n: 81, v: 0.7 }] },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20.5, send: 0, notes: melody('D2:2 G1:2 | E2:2 A1:2 | D2:3 r:1') },
      { id: 'kit', kind: 'kit', level: -21.5, send: 0.14, hits: hits(steps('kudumDum', 'X...x...X...x...', 0, 2), steps('kudumTek', 'x.x.x.x.x.x.xxxx', 1, 1), ...Array.from({ length: 8 }, (_, i) => [{ t: 6 + i * 0.25, k: 'kudumTek', v: 0.45 + i * 0.07 }]), steps('frameLo', 'X...............', 2, 1), steps('zil', 'X.......X.......', 2, 1)) },
      { id: 'fx', kind: 'fx', level: -24.5, send: 0.32, width: 1.5, fx: [{ t: 0, d: 1.5, k: 'bubbles', v: 0.85, density: 18 }, { t: 4, d: 4, k: 'riser', v: 0.5 }, { t: 8, d: 2, k: 'bubbles', v: 0.9, density: 24 }] },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), legend()] as const;

/**
 * Count-up beds: a 4-bar I – IV – vi – IV/V loop at 120 BPM per tier, in the tier's key, layered more fully per
 * tier: 1 kanun 16ths, drone, bass, frame drum and kudüm tek · 2 + kudüm düm groove, glass harmonica, zil ·
 * 3 + kanun lead and tek 8ths · 4 + "ah" choir, water-glass bells, low frame drum · max + ney lead an octave
 * up, an ud riff and bubbles.
 */
const BED_CHORDS = progression('G | C | Em | C:2 D:2');
const BED_LEAD = 'D5:.75 B4:.25 D5:.5 G5:1.5 A5:.5 B5:.5 | C6:.75 G5:.25 E5:.5 G5:1.5 A5:.5 G5:.5 | B5:.75 G5:.25 E5:.5 B5:1 C6:.5 B5:.5 G5:.5 | A5:1 C6:1 B5:.5 A5:.5 F#5:1';
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tonic = 43 + key;
  const tracks: Track[] = [
    { id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -23, send: 0.2, pan: 0.4, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 0, 2, 0, 1, 0], 0.25, 55 + Math.min(4, key), 76, 0.7, 3, 0.6) },
    { id: 'drone', kind: 'pad', voice: 'padWarm', level: -27, send: 0.3, chords: [{ t: 0, d: 16, ns: [tonic - 12 > 28 ? tonic - 12 : tonic, tonic + 7], v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.8, 40, 31, 47) },
    { id: 'perc', kind: 'kit', level: -27, send: 0.14, hits: hits(steps('frame', 'x.......x.......', 0, 4), steps('kudumTek', '....x.......x...', 0, 4)) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'kudum', kind: 'kit', level: -23, send: 0.1, hits: steps('kudumDum', 'X...x...X...x...', 0, 4) });
    tracks.push({ id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -25, send: 0.5, notes: held(chords, 3, 62, 79, 0.65) });
    tracks.push({ id: 'zil', kind: 'kit', level: -30, send: 0.35, hits: [0, 8].map(t => ({ t, k: 'zil', v: 0.6 })) });
  }
  if (level >= 3) {
    tracks.push({ id: 'kanun', kind: 'pitched', voice: 'kanun', level: -20, send: 0.3, notes: melody(BED_LEAD, 0, 4, lk), bright: 1.05 });
    tracks.push({ id: 'tek', kind: 'kit', level: -28, send: 0.1, hits: steps('kudumTek', '..x...x...x...x.', 0, 4) });
  }
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.5, width: 1.7, chords: pads(chords, 4, 57, 76, 0.85) });
    tracks.push({ id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -26, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 84), v: 0.7 })) });
    tracks.push({ id: 'low', kind: 'kit', level: -27, send: 0.25, hits: chords.flatMap(c => [{ t: c.t, k: 'frameLo', v: 0.9 }, { t: c.t + c.d - 0.5, k: 'frame', v: 0.5 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'ney', kind: 'pitched', voice: 'ney', level: -24, send: 0.42, pan: -0.3, notes: vel(melody(BED_LEAD, 0, 4, lk + 12).filter(n => n.d >= 0.5), 0.75) });
    tracks.push({ id: 'udriff', kind: 'pitched', voice: 'ud', level: -25, send: 0.15, pan: 0.2, notes: udRiff(chords) });
    tracks.push({ id: 'fx', kind: 'fx', level: -28, send: 0.3, fx: [{ t: 0, d: 7, k: 'bubbles', v: 0.7, density: 3, shape: 'flat' }, { t: 8, d: 7, k: 'bubbles', v: 0.7, density: 3, shape: 'flat' }] });
  }
  const keyName = ['G', 'Ab', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E'][key];
  return {
    id: `ebru-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -5.5,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – IV – vi – IV/V in ${keyName} Rast-major at 120 BPM, 4-bar seamless loop (8 s); ${['kanun 16ths, drone, bass, frame drum and kudüm tek', '+ kudüm groove, glass harmonica, zil', '+ kanun lead and tek 8ths', '+ "ah" choir, water-glass bells, low frame drum', '+ ney an octave up, an ud riff and bubbles'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/** Max win — the top of the ladder: E Rast-major, 120 BPM, 3 bars (6 s), IV – V – bVII – I. */
const MAX_LEAD = 'E5:.5 G5:.5 C6:.5 E6:.5 G6:2 | F#5:.5 A5:.5 D6:.5 F#6:.5 F6:1 C6:1 | B5:.25 D6:.25 G6:.5 D6:.5 G6:2.5';
const MAX_CHORDS = 'C | D:2 F:2 | G';
function maxWin(): Score {
  const key = TIER_KEY.max, lk = leadShift(key);
  const chords = shiftChords(progression(MAX_CHORDS), key), lead = melody(MAX_LEAD, 0, 4, lk);
  return {
    id: 'ebru-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 3.2, reverb: 'hall', reverbDb: -4,
    target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
    about: 'Max win, E (top of the key ladder), 120 BPM, 3 bars (6 s): IV – V – bVII – I (A – B – D – E) with kanun and ney in octaves, kanun tremolo, full "ah" choir, glass harmonica, water-glass bells climbing, a 16th kanun ostinato, an ud strum, double-time kudüm with a roll, zil and the biggest bubble bloom.',
    tracks: [
      { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.3, notes: lead, bright: 1.25 },
      { id: 'ney', kind: 'pitched', voice: 'ney', level: -20.5, send: 0.4, notes: vel(lead.filter(n => n.d >= 0.5), 0.9) },
      { id: 'tremolo', kind: 'pitched', voice: 'kanun', level: -23.5, send: 0.3, pan: -0.3, bright: 0.8, notes: vel(tremolo(shiftNotes(lead.filter(n => n.d >= 0.5), -12), 0.5, 0.125), 0.65) },
      { id: 'choir', kind: 'pad', voice: 'padChoir', level: -21, send: 0.5, width: 1.8, chords: pads(chords, 4, 57, 78, 0.95) },
      { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -23.5, send: 0.5, notes: held(chords, 4, 62, 81, 0.7) },
      { id: 'ostinato', kind: 'pitched', voice: 'kanunSoft', level: -24.5, send: 0.22, pan: 0.35, bright: 0.7, notes: ostinato(chords, [-1, 0, 1, 2], 0.25, 59, 78, 0.75) },
      { id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -23, send: 0.5, pan: 0.3, notes: [{ t: 0, d: 2, n: 81, v: 0.8 }, { t: 4, d: 1, n: 83, v: 0.8 }, { t: 6, d: 1, n: 86, v: 0.8 }, { t: 8, d: 2, n: 88, v: 0.95 }, { t: 8.02, d: 2, n: 83, v: 0.75 }] },
      { id: 'ud', kind: 'pitched', voice: 'ud', level: -23, send: 0.18, notes: strum(8, [40, 47, 52, 56], 3, 0.95, 0.04) },
      { id: 'bass', kind: 'pitched', voice: 'bass', level: -20, send: 0, notes: melody('A1:.5 A1:.5 A1:.5 A1:.5 A1:.5 A1:.5 A1:.5 A1:.5 | B1:.5 B1:.5 B1:.5 B1:.5 D2:.5 D2:.5 D2:.5 D2:.5 | E2:3 r:1') },
      { id: 'kit', kind: 'kit', level: -20.5, send: 0.14, hits: hits(steps('kudumDum', 'X.x.X.x.X.x.X.x.', 0, 2), steps('kudumTek', 'x.x.x.x.xxxxxxxx', 0, 2), ...Array.from({ length: 12 }, (_, i) => [{ t: 5 + i * 0.25, k: 'kudumTek', v: 0.4 + i * 0.05 }]), steps('frameLo', 'X.......X.......', 0, 1), steps('frameLo', 'X...............', 2, 1), steps('zil', 'X...X...........', 2, 1)) },
      { id: 'fx', kind: 'fx', level: -23.5, send: 0.32, width: 1.6, fx: [{ t: 0, d: 2, k: 'bubbles', v: 0.85, density: 18 }, { t: 0, d: 8, k: 'riser', v: 0.4 }, { t: 8, d: 3, k: 'bubbles', v: 1, density: 28 }] },
    ],
  };
}
export const MAX_WIN = maxWin();

/** Total-win fanfare (end of the feature): G Rast-major, 120 BPM, a festive kanun and ney flourish, 4 s to its musical end. */
const TOTAL_LEAD = 'G4:.25 B4:.25 D5:.5 r:.25 D5:.25 E5:.25 F#5:.25 G5:.5 A5:.5 B5:.5 A5:.5 | C6:.5 A5:.5 G5:3';
export const TOTAL_WIN: Score = {
  id: 'ebru-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 2.2, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win fanfare, G Rast-major, 120 BPM, 4 s: G – Em – C | D – G. A festive kanun flourish with ney doubling, kanun strums, glass harmonica, "ah" choir on the final G with water-glass bells, kudüm and frame drum, zil and a bloom of bubbles.',
  tracks: [
    { id: 'kanun', kind: 'pitched', voice: 'kanun', level: -19, send: 0.28, notes: melody(TOTAL_LEAD), bright: 1.15 },
    { id: 'ney', kind: 'pitched', voice: 'ney', level: -21.5, send: 0.4, pan: 0.25, notes: vel(melody(TOTAL_LEAD, 0, 4, 12).filter(n => n.d >= 0.5), 0.8) },
    { id: 'strum', kind: 'pitched', voice: 'kanunSoft', level: -24, send: 0.25, pan: -0.35, bright: 0.7, notes: [...strum(0, [55, 59, 62, 67], 0.8, 0.8), ...strum(1, [55, 59, 62, 67], 0.8, 0.7), ...strum(2, [52, 55, 59, 64], 0.8, 0.75), ...strum(3, [48, 52, 55, 60], 0.8, 0.75), ...strum(4, [50, 54, 57, 62], 0.8, 0.8), ...strum(5, [55, 59, 62, 67, 71], 3, 0.85)] },
    { id: 'glass', kind: 'pitched', voice: 'glassHarp', level: -24.5, send: 0.5, notes: held(progression('G:2 Em:1 C:1 | D:1 G:3'), 3, 62, 79, 0.65) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.5, width: 1.6, chords: [{ t: 5, d: 3, ns: [55, 59, 62, 67], v: 0.9 }] },
    { id: 'bells', kind: 'pitched', voice: 'waterGlass', level: -24, send: 0.5, notes: [{ t: 5, d: 3, n: 86, v: 0.85 }, { t: 5.5, d: 2.5, n: 79, v: 0.6 }] },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -21.5, send: 0, notes: melody('G1:2 E2:1 C2:1 | D2:1 G1:2 r:1') },
    { id: 'kit', kind: 'kit', level: -22, send: 0.14, hits: hits(steps('kudumDum', 'X...x...X...x...', 0, 1), steps('kudumTek', '..x...x.xxxxXXXX', 0, 1), steps('kudumDum', 'X...x...........', 1, 1), steps('frameLo', '....X...........', 1, 1), steps('zil', '....X...........', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.32, width: 1.5, fx: [{ t: 3, d: 2, k: 'bubbles', v: 0.7, density: 10, shape: 'swell' }, { t: 5, d: 2, k: 'bubbles', v: 0.9, density: 22 }] },
  ],
};

/** Ambience bed: still size water in the marbling trough — lapping, a faint hiss, small bubbles and slow drips; 24 s loop. */
export const AMBIENCE: Score = {
  id: 'ebru-ambience', bpm: 60, beatsPerBar: 4, bars: 6, swing: 0.5, loop: true, tail: 2, reverb: 'room', reverbDb: -6,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 24 s seamless loop: still size water in the marbling trough — slow lapping, a faint surface hiss, small bubbles and an occasional drip, with a quiet room tone; no tempo-bound material.',
  tracks: [
    { id: 'water', kind: 'fx', level: -32, send: 0.15, width: 1.3, fx: [{ t: 0, d: 24, k: 'water', v: 1, density: 1 }] },
    { id: 'room', kind: 'fx', level: -40, send: 0.05, width: 1.2, fx: [{ t: 0, d: 24, k: 'room', v: 1 }] },
  ],
};

export const EBRU_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, retrigger: RETRIGGER, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, ambience: AMBIENCE,
} as const;
export type EbruScoreId = keyof typeof EBRU_SCORES;

/**
 * Crest-factor control (render.ts `tame`) for the transient-heavy stems, so coincident kudüm, frame-drum and kanun
 * attacks do not drive the master limiter: drums 12 dB, plucked strings 13 dB, water-glass bells 14 dB above their
 * gated RMS. The ambience is left untouched.
 */
for (const score of Object.values(EBRU_SCORES)) {
  if (score === AMBIENCE) continue;
  for (const track of score.tracks) {
    if (track.tame !== undefined) continue;
    if (track.kind === 'kit') track.tame = 12;
    else if (track.kind === 'pitched' && (track.voice === 'kanun' || track.voice === 'kanunSoft' || track.voice === 'ud')) track.tame = 13;
    else if (track.kind === 'pitched' && track.voice === 'waterGlass') track.tame = 14;
  }
}
export const EBRU_SCORE_IDS = Object.keys(EBRU_SCORES) as EbruScoreId[];
