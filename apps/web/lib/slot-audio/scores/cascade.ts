/**
 * Candy Cascade music: original compositions written as note data for the "night patisserie" theme.
 * Harmony, melodies, bass lines and grooves were written for this game; no existing game's or song's
 * melody, motif or sound is quoted or imitated. The recurring signature is a rising stepwise
 * "sugar step" (scale degrees 3→4→5 or 5→6→7 landing on a chord tone) used by the fanfare and big wins.
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score } from './types';

/* ---------------- arranging helpers ---------------- */

function pads(chords: ChordEvent[], count: number, lo: number, hi: number, v: number): PadEvent[] {
  let prev: number[] | null = null;
  return chords.map(c => { const ns = voice(c.tones, count, lo, hi, prev); prev = ns; return { t: c.t, d: c.d, ns, v }; });
}

type BassStyle = 'bounce' | 'long' | 'pedal' | 'drive' | 'half';

/** Bass from chord roots: styles are rhythmic templates with chromatic approach notes into the next chord. */
function bassLine(chords: ChordEvent[], styleOf: BassStyle | ((bar: number) => BassStyle | null), v: number, loop: boolean, centre = 36): NoteEvent[] {
  const out: NoteEvent[] = [];
  const fit = (n: number) => { let x = n; while (x > 45) x -= 12; while (x < 28) x += 12; return x; };
  chords.forEach((c, i) => {
    const root = fit(nearest(c.bass, centre));
    const fifth = root + 7 > 47 ? root - 5 : root + 7;
    const next = chords[i + 1] ?? (loop ? chords[0] : null);
    const nextRoot = next ? fit(nearest(next.bass, root)) : root;
    const approach = nextRoot === root ? fifth : nextRoot + (nextRoot > root ? -1 : 1);
    const style = typeof styleOf === 'function' ? styleOf(Math.floor(c.t / 4)) : styleOf;
    const push = (t: number, n: number, d: number, vel: number) => { if (t < c.d - 1e-9) out.push({ t: c.t + t, n, d: Math.min(d, c.d - t), v: vel }); };
    switch (style) {
      case null: break;
      case 'bounce':
        if (c.d >= 4) { push(0, root, 0.9, v); push(1.5, fifth, 0.45, v * 0.75); push(2, root, 0.9, v * 0.9); push(3, fifth, 0.45, v * 0.75); push(3.5, approach, 0.45, v * 0.8); }
        else { push(0, root, 0.9, v); push(1, fifth, 0.45, v * 0.75); push(1.5, approach, 0.45, v * 0.8); }
        break;
      case 'long':
        push(0, root, Math.min(1.9, c.d - 0.1), v);
        if (c.d >= 4) { push(2, fifth, 1.4, v * 0.8); push(3.5, approach, 0.45, v * 0.75); }
        break;
      case 'pedal': push(0, root, c.d - 0.1, v); break;
      case 'half': push(0, root, 1.9, v); if (c.d >= 4) push(2, fifth, 1.9, v * 0.85); break;
      case 'drive':
        for (let k = 0; k < c.d * 2; k++) {
          const last = k === c.d * 2 - 1 && next && nextRoot !== root;
          push(k * 0.5, last ? approach : k % 2 ? root + 12 : root, 0.42, k % 2 ? v * 0.72 : v);
        }
        break;
    }
  });
  return out;
}

/** Arpeggio over each chord's voicing; pattern indices past the voicing climb an octave. */
function arp(chords: ChordEvent[], pattern: number[], step: number, lo: number, hi: number, v: number, count = 4): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  for (const c of chords) {
    const vs = voice(c.tones, count, lo, hi, prev); prev = vs;
    const n = Math.round(c.d / step);
    for (let s = 0; s < n; s++) {
      const idx = pattern[s % pattern.length]!;
      const note = vs[idx % count]! + 12 * Math.floor(idx / count);
      out.push({ t: c.t + s * step, d: step * 0.9, n: note, v: v * (s % 2 === 0 ? 1 : 0.78) });
    }
  }
  return out;
}

const within = (chords: ChordEvent[], fromBar: number, toBar: number, bpb = 4) => chords.filter(c => c.t >= fromBar * bpb - 1e-9 && c.t < toBar * bpb - 1e-9);
const hits = (...lists: HitEvent[][]) => lists.flat();

/* =====================================================================================
 * BASE THEME — "Night Patisserie"
 * F major, 104 BPM, light swing (0.58), 20 bars = 46.2 s seamless loop.
 * Form: A (8 bars: hook + answer, celesta) · B (8 bars: wistful bridge via the minor iv, music box)
 *       · C (4 bars: breakdown on the hook fragment, glockenspiel, drum fill back into the hook).
 * ===================================================================================== */

const BASE_CHORDS = progression(`
  Fmaj7 | F#dim7 | Gm7 | C7 | Am7 | D7 | Gm7 | C7sus4 C7 |
  Bbmaj7 | Bbm6 | Am7 | D7 | Gm7 | C7 | Am7 | Abdim7 |
  Gm7 | C9 | Am7 Dm7 | Gm7 C7`);

/** The 4-bar hook: a rising "sugar step" C–F–A that turns back, a chromatic wink over the diminished chord, then the sequence a step higher. */
export const BASE_HOOK = `
  C5:.5 F5:.5 A5:1 G5:.5 F5:.5 E5:1 |
  Eb5:.5 D5:.5 C5:.5 A4:.5 C5:1.5 r:.5 |
  D5:.5 G5:.5 Bb5:1 A5:.5 G5:.5 F5:1 |
  E5:.5 G5:.5 Bb5:.5 A5:.25 G5:.25 E5:.5 C5:.5 r:.5 C5:.5`;
const BASE_ANSWER = `
  E5:1.5 D5:.5 C5:.5 E5:.5 A5:1 |
  F#5:.5 A5:.5 C6:1 A5:.5 F#5:.5 D5:1 |
  Bb5:.5 A5:.5 G5:.5 F5:.5 D5:1 Bb4:.5 C5:.5 |
  F5:1 E5:.5 G5:.5 C5:1.5 C5:.5`;
const BASE_BRIDGE = `
  A5:1.5 G5:.5 F5:1 D5:1 |
  Db5:1.5 Eb5:.5 F5:1.5 Db5:.5 |
  C5:1 E5:.5 G5:.5 A5:2 |
  F#5:.5 A5:.5 C6:1.5 A5:.5 F#5:1 |
  G5:1 F5:.5 D5:.5 Bb4:1 D5:1 |
  E5:1.5 G5:.5 Bb5:1 A5:.5 G5:.5 |
  A5:2 E5:1 C5:1 |
  B4:1 D5:1 F5:1 Ab5:1`;
const BASE_BREAKDOWN = `
  D5:.5 G5:.5 Bb5:1 A5:.5 G5:.5 F5:1 |
  E5:.5 G5:.5 D6:1 C6:.5 Bb5:.5 G5:1 |
  C6:.5 A5:.5 E5:1 F5:.5 A5:.5 D6:1 |
  Bb5:.5 A5:.5 G5:.5 E5:.5 C5:1 r:1`;
/** Counter line for the answer phrase (music box, an octave up): long guide tones. */
const BASE_COUNTER = `G5:2 E5:2 | F#5:2 A5:2 | F5:2 D5:2 | F5:2 E5:2`;

const baseKit = hits(
  steps('kick', 'x.......x.....o.', 0, 8), steps('brush', '....x.......x...', 0, 8),
  steps('kick', 'x.......o.......', 8, 8), steps('brush', '....o.......o...', 8, 8),
  steps('kick', 'x.......x.......', 18, 2), steps('brush', '....x...o.o.xxXX', 19, 1),
);
const basePerc = hits(
  steps('shaker', 'x.o.x.o.x.o.x.o.', 0, 8),
  steps('shaker', 'o.o.o.o.o.o.o.o.', 8, 8), steps('woodHi', '......o.......o.', 8, 8), steps('snap', '....o.......o...', 8, 8, 0.8),
  steps('shaker', 'o.o.o.o.o.o.o.o.', 16, 2), steps('wood', '....o.......o..o', 16, 2),
  steps('shaker', 'x.o.x.o.x.o.x.o.', 18, 2),
);
const baseFx: FxEvent[] = [
  { t: 19 * 4 + 1, d: 3, k: 'sparkle', v: 0.8, shape: 'swell', density: 30 },
  { t: 19 * 4 + 2, d: 2, k: 'swell', v: 0.35 },
  { t: 8 * 4, d: 2, k: 'sparkle', v: 0.5, shape: 'decay', density: 18 },
  { t: 12 * 4, d: 2, k: 'sparkle', v: 0.5, shape: 'decay', density: 18 },
];

export const BASE_THEME: Score = {
  id: 'cascade-base', bpm: 104, beatsPerBar: 4, bars: 20, swing: 0.58, loop: true, tail: 3, reverb: 'hall', reverbDb: -5,
  target: { lufs: -15, measure: 'integrated' },
  about: 'F major, 104 BPM light swing, 20-bar loop (A hook+answer / B bridge with the minor iv / C breakdown). Celesta lead, music-box counter and bridge, glockenspiel breakdown, kalimba-like plucked arpeggios, warm pad, round bass, brushes, shaker, wood block.',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'celesta', level: -20, send: 0.35, pan: -0.05, notes: [...melody(BASE_HOOK, 0), ...melody(BASE_ANSWER, 4), ...melody(BASE_BRIDGE, 8).map(n => ({ ...n, v: n.v * 0.55 }))], bright: 1.25 },
    { id: 'box', kind: 'pitched', voice: 'musicBox', level: -23, send: 0.45, pan: 0.38, transpose: 12, notes: [...melody(BASE_COUNTER, 4).map(n => ({ ...n, v: 0.55 })), ...melody(BASE_BRIDGE, 8), ...melody(BASE_BREAKDOWN, 16).map(n => ({ ...n, v: 0.5 }))] },
    { id: 'glock', kind: 'pitched', voice: 'glock', level: -27, send: 0.4, pan: -0.42, transpose: 12, notes: [...melody(BASE_BRIDGE, 8).filter(n => n.t >= 12 * 4).map(n => ({ ...n, v: 0.45 })), ...melody(BASE_BREAKDOWN, 16)] },
    {
      id: 'arp', kind: 'pitched', voice: 'pluck', level: -25, send: 0.25, pan: 0.45, bright: 0.45,
      notes: [...arp(within(BASE_CHORDS, 0, 8), [0, 2, 1, 3, 2, 1, 3, 1], 0.5, 60, 79, 0.7), ...arp(within(BASE_CHORDS, 8, 16), [0, 2, 1, 3], 1, 60, 79, 0.55), ...arp(within(BASE_CHORDS, 18, 20), [0, 2, 1, 3, 2, 1, 3, 1], 0.5, 60, 79, 0.65)],
    },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -26, send: 0.3, width: 1.6, chords: pads(BASE_CHORDS, 4, 53, 72, 0.6) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -29, send: 0.4, width: 1.6, chords: pads(within(BASE_CHORDS, 8, 16), 3, 62, 79, 0.5) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0.03, notes: bassLine(BASE_CHORDS, bar => (bar < 8 || bar >= 18 ? 'bounce' : bar < 16 ? 'long' : 'pedal'), 0.85, true) },
    { id: 'kit', kind: 'kit', level: -24, send: 0.1, hits: baseKit },
    { id: 'perc', kind: 'kit', level: -27.5, send: 0.16, width: 1.5, hits: basePerc },
    { id: 'fx', kind: 'fx', level: -29, send: 0.4, width: 1.5, fx: baseFx },
  ],
};

/* IDLE — the A section re-orchestrated for attract mode: music box and pad only, no drums.
   Same tempo and bars as base bars 1–8, so idle ↔ base cross-fades stay phase-aligned. */
export const IDLE_THEME: Score = {
  id: 'cascade-idle', bpm: 104, beatsPerBar: 4, bars: 8, swing: 0.58, loop: true, tail: 3, reverb: 'hall', reverbDb: -4,
  target: { lufs: -17, measure: 'integrated' },
  about: 'F major, 104 BPM, 8-bar loop: the base hook and answer on a soft music box over warm pad and pedal bass; no drums.',
  tracks: [
    { id: 'box', kind: 'pitched', voice: 'musicBox', level: -21, send: 0.5, pan: 0.15, transpose: 12, notes: [...melody(BASE_HOOK, 0), ...melody(BASE_ANSWER, 4)].map(n => ({ ...n, v: 0.6 })) },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -25, send: 0.35, width: 1.6, chords: pads(within(BASE_CHORDS, 0, 8), 4, 53, 72, 0.5) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -25, send: 0.05, notes: bassLine(within(BASE_CHORDS, 0, 8), 'half', 0.7, true) },
    { id: 'fx', kind: 'fx', level: -31, send: 0.5, fx: [{ t: 0, d: 2, k: 'sparkle', v: 0.5, shape: 'decay', density: 14 }, { t: 16, d: 2, k: 'sparkle', v: 0.45, shape: 'decay', density: 14 }] },
  ],
};

/* =====================================================================================
 * FEATURE THEME — "Caramel Storm"
 * D minor (relative of F), 118 BPM straight, 16 bars = 32.5 s loop.
 * Form: A (8 bars: syncopated riff, i–VI–III–VII then iv–V) · B (8 bars: answer climbs to G6, glock doubles).
 * Four-on-the-floor kick, claps, open hats, driving octave bass, pumping supersaw pad, 16th plucks.
 * ===================================================================================== */

const FEAT_CHORDS = progression(`Dm | Bb | F | C | Dm | Bb | Gm | A7 | Bb | C | Am | Dm | Gm | C | F | A7`);
const FEAT_MELODY = `
  D5:.5 F5:.5 A5:.75 G5:.25 A5:.5 D6:1 C6:.5 |
  Bb5:1 A5:.5 F5:.5 D5:.5 F5:.5 Bb5:.5 A5:.5 |
  A5:.75 G5:.25 F5:.5 C6:1 A5:.5 F5:.5 G5:.5 |
  G5:1.5 E5:.5 C5:.5 E5:.5 G5:1 |
  D5:.5 F5:.5 A5:.75 G5:.25 A5:.5 D6:1 E6:.5 |
  F6:1 D6:.5 Bb5:.5 F5:.5 Bb5:.5 D6:1 |
  Bb5:.5 A5:.5 G5:.5 Bb5:.5 D6:1 C6:.5 Bb5:.5 |
  A5:.5 C#6:.5 E6:1 C#6:.5 A5:.5 G5:.5 E5:.5 |
  D6:.5 r:.25 D6:.25 C6:.5 Bb5:.5 C6:.75 D6:.75 F5:.5 |
  E6:.5 r:.25 E6:.25 D6:.5 C6:.5 D6:.75 E6:.75 G5:.5 |
  E6:1 C6:.5 A5:.5 E5:.5 A5:.5 C6:1 |
  D6:2 A5:1 F5:.5 A5:.5 |
  Bb5:.5 D6:.5 G6:1 F6:.5 D6:.5 Bb5:1 |
  C6:.5 E6:.5 G6:1 E6:.5 C6:.5 G5:1 |
  A5:.5 C6:.5 F6:1.5 E6:.5 C6:1 |
  E6:.5 C#6:.5 A5:.5 G5:.5 E5:.5 C#5:.5 E5:.5 A5:.5`;

const featKit = hits(
  steps('kickPunch', 'x...x...x...x...', 0, 16),
  steps('clap', '....x.......x...', 0, 16),
  steps('snare', '............o.ox', 3, 1), steps('snare', '........o.o.oxox', 7, 1), steps('snare', '............o.ox', 11, 1),
  steps('snare', 'o.o.o.o.oxoxxxXX', 15, 1, 0.9), steps('tomHi', '............x...', 15, 1), steps('tomMid', '.............x..', 15, 1), steps('tomLo', '..............x.', 15, 1),
);
const featHats = hits(steps('hatOpen', '..o...o...o...o.', 0, 16), steps('shaker', 'ogogogogogogogog', 0, 16), steps('hat', 'g.g.g.g.g.g.g.g.', 8, 8));

export const FEATURE_THEME: Score = {
  id: 'cascade-feature', bpm: 118, beatsPerBar: 4, bars: 16, swing: 0.5, loop: true, tail: 3, reverb: 'hall', reverbDb: -6,
  target: { lufs: -14.5, measure: 'integrated' },
  about: 'D minor (relative of the base key), 118 BPM straight, 16-bar loop (A riff / B climbing answer). Bright synth-pluck lead doubled by celesta, glockenspiel in B, pumping supersaw pad, 16th plucks, driving octave bass, four-on-the-floor kit with claps, open hats and fills.',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'synthLead', level: -20, send: 0.22, pan: 0.05, notes: melody(FEAT_MELODY, 0), bright: 0.9 },
    { id: 'cel', kind: 'pitched', voice: 'celesta', level: -24, send: 0.3, pan: -0.3, notes: melody(FEAT_MELODY, 0).map(n => ({ ...n, v: 0.7 })), bright: 1.2 },
    { id: 'glock', kind: 'pitched', voice: 'glock', level: -28, send: 0.35, pan: 0.42, transpose: 12, notes: melody(FEAT_MELODY, 0).filter(n => n.t >= 32).map(n => ({ ...n, v: 0.5 })) },
    { id: 'arp', kind: 'pitched', voice: 'pluck', level: -26, send: 0.2, pan: -0.45, pump: 0.3, bright: 0.65, notes: arp(FEAT_CHORDS, [0, 1, 2, 3, 1, 2, 3, 4], 0.25, 62, 81, 0.65), swing: false },
    { id: 'pad', kind: 'pad', voice: 'padSaw', level: -25, send: 0.3, width: 1.7, pump: 0.6, chords: pads(FEAT_CHORDS, 4, 55, 74, 0.7) },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: bassLine(FEAT_CHORDS, 'drive', 0.85, true, 38) },
    { id: 'kit', kind: 'kit', level: -21, send: 0.08, hits: featKit },
    { id: 'hats', kind: 'kit', level: -28, send: 0.1, width: 1.6, hits: featHats },
    { id: 'fx', kind: 'fx', level: -28, send: 0.3, width: 1.5, fx: [
      { t: 0, d: 4, k: 'crash', v: 0.5 }, { t: 32, d: 4, k: 'crash', v: 0.45 },
      { t: 7 * 4 + 2, d: 2, k: 'swell', v: 0.4 }, { t: 15 * 4, d: 4, k: 'riser', v: 0.6 },
      { t: 32, d: 2, k: 'sparkle', v: 0.6, shape: 'decay', density: 30 },
    ] },
  ],
};

/* =====================================================================================
 * STINGERS
 * ===================================================================================== */

/** Free-spins intro: D minor fanfare at the feature tempo. 16th run, Bb and C stabs, landing on Dm(add9).
 *  Musical end at beat 6 (3.05 s): the feature loop enters there. */
export const FS_INTRO: Score = {
  id: 'cascade-fs-intro', bpm: 118, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 1.6, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 6,
  about: 'Free-spins fanfare, D minor, 118 BPM: rising 16th run, Bb and C stabs, the "sugar step" D–E–F landing on Dm(add9) with impact and cymbal; feature theme enters at beat 6 (3.05 s).',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'synthLead', level: -19, send: 0.25, notes: melody('D5:.25 F5:.25 A5:.25 D6:.25 F5:.25 A5:.25 D6:.25 F6:.25 D6:1 E6:1 | F6:2.5 r:1.5'), bright: 1 },
    { id: 'cel', kind: 'pitched', voice: 'celesta', level: -22, send: 0.35, notes: melody('D5:.25 F5:.25 A5:.25 D6:.25 F5:.25 A5:.25 D6:.25 F6:.25 D6:1 E6:1 | F6:2.5 r:1.5'), bright: 1.2 },
    { id: 'glock', kind: 'pitched', voice: 'glock', level: -25, send: 0.4, transpose: 12, notes: melody('r:2 D6:1 E6:1 | F6:1 A6:3') },
    { id: 'pad', kind: 'pad', voice: 'padSaw', level: -23, send: 0.3, chords: [{ t: 2, d: 0.9, ns: [58, 62, 65, 70], v: 0.8 }, { t: 3, d: 0.9, ns: [60, 64, 67, 72], v: 0.85 }, { t: 4, d: 2.5, ns: [57, 62, 65, 69, 76], v: 0.9 }] },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: melody('r:2 Bb1:1 C2:1 | D2:2.5 r:1.5') },
    { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: hits(steps('snare', 'gggoooooxx......', 0, 1), steps('tomHi', '........x.......', 0, 1), steps('tomLo', '............x...', 0, 1), steps('kickPunch', '........x...x...', 0, 1), steps('kickPunch', 'X...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.3, fx: [{ t: 0, d: 4, k: 'riser', v: 0.8 }, { t: 4, d: 0.5, k: 'impact', v: 1 }, { t: 4, d: 3, k: 'crash', v: 0.7 }, { t: 4, d: 2.5, k: 'sparkle', v: 0.8, shape: 'decay', density: 50, notes: [86, 89, 93, 98] }] },
  ],
};

/** Feature outro / total win: warm resolution back to F major (IV – V7sus – Imaj9), 104 BPM. */
export const FS_OUTRO: Score = {
  id: 'cascade-fs-outro', bpm: 104, beatsPerBar: 4, bars: 2, swing: 0.58, loop: false, tail: 2, reverb: 'hall', reverbDb: -4,
  target: { lufs: -15, measure: 'integrated' }, musicalEnd: 8,
  about: 'Total-win outro, F major, 104 BPM: Bbmaj7 – C7sus4 – Fmaj9 with a falling-then-rising celesta line, music-box arpeggio and sugar sparkles; base theme may return at beat 8 (4.6 s).',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.4, notes: melody('D6:.5 C6:.5 A5:1 C6:.5 Bb5:.5 G5:1 | A5:.5 C6:.5 F6:3'), bright: 1 },
    { id: 'box', kind: 'pitched', voice: 'musicBox', level: -24, send: 0.5, notes: melody('r:4 | F5:.25 A5:.25 C6:.25 E6:.25 G6:3') },
    { id: 'pad', kind: 'pad', voice: 'padWarm', level: -24, send: 0.35, chords: pads(progression('Bbmaj7:2 C7sus4:2 | Fmaj9'), 5, 53, 76, 0.75) },
    { id: 'bass', kind: 'pitched', voice: 'bass', level: -22, send: 0.03, notes: melody('Bb1:2 C2:2 | F1:4') },
    { id: 'kit', kind: 'kit', level: -27, send: 0.15, hits: hits(steps('shaker', 'x.o.x.o.x.o.o.g.', 0, 1), steps('kickSoft', 'x.......x.......', 0, 1), steps('kickSoft', 'x...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -27, send: 0.4, fx: [{ t: 2, d: 2, k: 'swell', v: 0.35 }, { t: 3, d: 3, k: 'sparkle', v: 0.7, shape: 'swell', density: 30 }, { t: 4, d: 3, k: 'sparkle', v: 0.7, shape: 'decay', density: 35 }] },
  ],
};

/** Big-win heads, 120 BPM F major. Each ends on a held tonic so it resolves even without a count-up bed. */
const BW_BPM = 120;
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = {
    1: { bars: 2, chords: 'F:2 Bb:1 C:1 | F', lead: 'F5:.25 A5:.25 C6:.25 F6:.25 A5:.25 C6:.25 F6:.25 A6:.25 F6:1 G6:1 | A6:3 r:1', bass: 'F2:2 Bb1:1 C2:1 | F1:3 r:1', lufs: -15 },
    2: { bars: 2, chords: 'F:1 Dm:1 Bb:1 C:1 | F', lead: 'F5:.25 G5:.25 A5:.25 C6:.25 D6:.25 F6:.25 A6:.5 F6:.5 D6:.5 G6:1 | A6:1 G6:.5 A6:.5 C7:2', bass: 'F2:1 D2:1 Bb1:1 C2:1 | F1:3 r:1', lufs: -14.5 },
    3: { bars: 3, chords: 'Dm:2 Bb:2 | Gm:2 C7:2 | F', lead: 'A5:.25 D6:.25 F6:.25 A6:.25 F6:.5 D6:.5 Bb5:.25 D6:.25 F6:.25 Bb6:.25 F6:1 | Bb5:.25 D6:.25 G6:.25 Bb6:.25 G6:.5 D6:.5 C6:.25 E6:.25 G6:.25 C7:.25 Bb6:1 | A6:3 r:1', bass: 'D2:2 Bb1:2 | G1:2 C2:2 | F1:3 r:1', lufs: -14 },
  }[tier];
  const chords = progression(spec.chords);
  const lastBar = spec.bars - 1;
  const kit = tier === 1
    ? hits(steps('kickPunch', 'x...x...x...x...', 0, 1), steps('snare', '............oxxX', 0, 1), steps('kickPunch', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('kickPunch', 'x...x...x...x...', 0, 1), steps('snare', '........ooxxxxXX', 0, 1), steps('clap', '....x.......x...', 0, 1), steps('kickPunch', 'X...............', 1, 1))
      : hits(steps('kickPunch', 'x.x.x.x.x.x.x.x.', 0, 2), steps('snare', 'o.o.o.o.x.x.xxXX', 1, 1), steps('tomHi', '............x...', 1, 1), steps('tomMid', '.............x..', 1, 1), steps('tomLo', '..............x.', 1, 1), steps('kickPunch', 'X...............', 2, 1), steps('timp', 'X...............', 2, 1));
  const fx: FxEvent[] = [
    { t: 0, d: 0.5, k: 'impact', v: 0.9 }, { t: 0, d: 3, k: 'crash', v: 0.55 },
    { t: lastBar * 4, d: 4, k: 'crash', v: 0.7 }, { t: lastBar * 4, d: 4, k: 'sparkle', v: 0.8, shape: 'decay', density: 40 + tier * 15 },
    ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.7 }, { t: 6, d: 2, k: 'swell' as const, v: 0.45 }] : []),
  ];
  return {
    id: `cascade-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2, reverb: 'hall', reverbDb: -5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier}, F major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): impact, rising arpeggio and the "sugar step" climb, resolving on a held tonic; a ${tier === 3 ? 'fuller' : 'lighter'} count-up bed can follow on the next bar line.`,
    tracks: [
      { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.35, notes: melody(spec.lead), bright: 1.2 },
      { id: 'synth', kind: 'pitched', voice: 'synthLead', level: -22 + tier, send: 0.25, pan: 0.25, notes: melody(spec.lead, 0, 4, -12), bright: 0.8 },
      { id: 'glock', kind: 'pitched', voice: 'glock', level: -25, send: 0.4, pan: -0.35, notes: melody(spec.lead).filter(n => n.d >= 0.5) },
      { id: 'pad', kind: 'pad', voice: 'padSaw', level: -23, send: 0.3, width: 1.6, chords: pads(chords, 4, 55, 76, 0.85) },
      ...(tier >= 2 ? [{ id: 'strings', kind: 'pad' as const, voice: 'padString' as const, level: -25, send: 0.4, chords: pads(chords, 3, 65, 84, 0.7) }] : []),
      { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: melody(spec.bass) },
      { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: kit },
      { id: 'fx', kind: 'fx', level: -25, send: 0.35, fx },
    ],
  };
}
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3)] as const;

/** Count-up beds: a 4-bar F–Dm–Bb–C celebration loop at 120 BPM, layered more fully per tier. */
const BED_CHORDS = progression('F | Dm | Bb | C');
const BED_LEAD = `C6:.75 A5:.25 C6:.5 F6:1.5 E6:.5 D6:.5 | D6:.75 A5:.25 D6:.5 F6:1.5 E6:.5 D6:.5 | D6:.75 Bb5:.25 D6:.5 F6:1 G6:.5 F6:.5 D6:.5 | E6:1 G6:1 C6:.5 D6:.5 E6:1`;
function bed(tier: 1 | 2 | 3): Score {
  const tracks: Score['tracks'] = [
    { id: 'arp', kind: 'pitched', voice: 'pluck', level: -23, send: 0.2, pan: 0.4, bright: 0.6, notes: arp(BED_CHORDS, [0, 1, 2, 3, 2, 1, 2, 3], 0.25, 65, 84, 0.7) },
    { id: 'pad', kind: 'pad', voice: tier === 1 ? 'padWarm' : 'padSaw', level: -25, send: 0.3, pump: tier >= 2 ? 0.45 : 0, chords: pads(BED_CHORDS, 4, 55, 74, 0.7) },
    { id: 'bass', kind: 'pitched', voice: tier === 1 ? 'bass' : 'bassDrive', level: -22, send: 0, notes: bassLine(BED_CHORDS, tier === 1 ? 'half' : 'drive', 0.85, true, 38) },
    { id: 'perc', kind: 'kit', level: -28, send: 0.12, hits: hits(steps('shaker', 'x.o.x.o.x.o.x.o.', 0, 4)) },
    { id: 'fx', kind: 'fx', level: -30, send: 0.4, fx: [0, 1, 2, 3].map(b => ({ t: b * 4, d: 2, k: 'sparkle' as const, v: 0.5 + tier * 0.1, shape: 'decay' as const, density: 15 + tier * 10 })) },
  ];
  if (tier >= 2) {
    tracks.push({ id: 'kit', kind: 'kit', level: -22, send: 0.08, hits: hits(steps('kickPunch', 'x...x...x...x...', 0, 4), steps('clap', '....x.......x...', 0, 4)) });
    tracks.push({ id: 'counter', kind: 'pitched', voice: 'celesta', level: -24, send: 0.3, pan: -0.38, notes: arp(BED_CHORDS, [3, 2, 1, 2], 1, 72, 91, 0.6, 3), bright: 1 });
  }
  if (tier >= 3) {
    tracks.push({ id: 'lead', kind: 'pitched', voice: 'celesta', level: -20, send: 0.35, notes: melody(BED_LEAD), bright: 1.2 });
    tracks.push({ id: 'glock', kind: 'pitched', voice: 'glock', level: -26, send: 0.4, notes: melody(BED_LEAD).filter(n => n.d >= 0.5) });
    tracks.push({ id: 'hats', kind: 'kit', level: -28, send: 0.1, hits: steps('hatOpen', '..o...o...o...o.', 0, 4) });
  }
  return {
    id: `cascade-bed-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -6,
    target: { lufs: -15, measure: 'integrated' },
    about: `Count-up bed tier ${tier}: F – Dm – Bb – C at 120 BPM, 4-bar seamless loop (8 s), ${tier === 1 ? 'plucks, pad, bass, shaker' : tier === 2 ? '+ kick, claps, pumping supersaw, celesta ostinato' : '+ celesta/glock lead melody and open hats'}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3)] as const;

/** Max win: the epic bVI – bVII – I cadence (Db – Eb – F), timpani, rolls and the brightest shower. */
export const MAX_WIN: Score = {
  id: 'cascade-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 2.4, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
  about: 'Max win, 120 BPM, 3 bars (6 s): Db – Eb – F (bVI–bVII–I) with octave celesta/synth lead, strings and supersaw, snare roll, timpani and a long sparkle shower on the final F.',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.35, notes: melody('Ab5:.5 C6:.5 Db6:.5 F6:.5 Ab6:2 | Bb5:.5 Eb6:.5 G6:.5 Bb6:.5 G6:1 Eb6:.5 G6:.5 | C6:.25 F6:.25 A6:.25 C7:.25 A6:3'), bright: 1.2 },
    { id: 'synth', kind: 'pitched', voice: 'synthLead', level: -20, send: 0.25, notes: melody('Ab5:.5 C6:.5 Db6:.5 F6:.5 Ab6:2 | Bb5:.5 Eb6:.5 G6:.5 Bb6:.5 G6:1 Eb6:.5 G6:.5 | C6:.25 F6:.25 A6:.25 C7:.25 A6:3', 0, 4, -12), bright: 0.9 },
    { id: 'glock', kind: 'pitched', voice: 'glock', level: -24, send: 0.4, notes: melody('Ab6:2 F6:2 | Bb6:2 G6:2 | A6:4') },
    { id: 'pad', kind: 'pad', voice: 'padSaw', level: -22, send: 0.3, chords: pads(progression('Db | Eb | Fadd9'), 5, 55, 79, 0.9) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -24, send: 0.45, chords: pads(progression('Db | Eb | Fadd9'), 3, 65, 86, 0.8) },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -20, send: 0, notes: melody('Db2:.5 Db2:.5 Db2:.5 Db2:.5 Db2:.5 Db2:.5 Db2:.5 Db2:.5 | Eb2:.5 Eb2:.5 Eb2:.5 Eb2:.5 Eb2:.5 Eb2:.5 Eb2:.5 Eb2:.5 | F1:3 r:1') },
    { id: 'kit', kind: 'kit', level: -20, send: 0.12, hits: hits(steps('kickPunch', 'x...x...x...x...', 0, 2), steps('snare', 'g.g.o.o.o.o.x.x.', 0, 1), steps('snare', 'oooooxxxxxxxXXXX', 1, 1), steps('timp', 'X...........x.x.', 1, 1), steps('kickPunch', 'X...............', 2, 1), steps('timp', 'X...............', 2, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.35, fx: [{ t: 0, d: 0.5, k: 'impact', v: 1 }, { t: 0, d: 4, k: 'crash', v: 0.6 }, { t: 0, d: 8, k: 'riser', v: 0.6 }, { t: 6, d: 2, k: 'swell', v: 0.5 }, { t: 8, d: 0.5, k: 'impact', v: 1 }, { t: 8, d: 4, k: 'crash', v: 0.8 }, { t: 8, d: 4, k: 'sparkle', v: 0.9, shape: 'decay', density: 90 }] },
  ],
};

/** Ambience bed: night-patisserie room tone plus occasional sugar sparkles; 16 s loop on the ambience bus. */
export const AMBIENCE: Score = {
  id: 'cascade-ambience', bpm: 60, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 1.5, reverb: 'hall', reverbDb: -2,
  target: { lufs: -30, measure: 'integrated' },
  about: 'Ambience, 16 s loop: soft dark room tone with slow breathing and five sparse sugar-sparkle flurries; no tempo-bound material.',
  tracks: [
    { id: 'room', kind: 'fx', level: -33, send: 0, fx: [{ t: 0, d: 16, k: 'room', v: 1 }] },
    { id: 'sparkle', kind: 'fx', level: -34, send: 0.6, fx: [1.3, 4.6, 7.9, 11.2, 14.1].map((t, i) => ({ t, d: 0.7 + (i % 2) * 0.4, k: 'sparkle' as const, v: 0.5, shape: 'decay' as const, density: 10, notes: [93, 96, 98, 100] })) },
  ],
};

export const CASCADE_SCORES = { base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, fsOutro: FS_OUTRO, bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], maxWin: MAX_WIN, ambience: AMBIENCE } as const;
export type CascadeScoreId = keyof typeof CASCADE_SCORES;
