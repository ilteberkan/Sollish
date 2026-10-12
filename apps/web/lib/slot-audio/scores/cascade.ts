/**
 * Candy Cascade music: original compositions written as note data for the "night patisserie" theme.
 * Harmony, melodies, bass lines and grooves were written for this game; no existing game's or song's
 * melody, motif or sound is quoted or imitated. The recurring signature is a rising stepwise
 * "sugar step" (scale degrees 3→4→5 or 5→6→7 landing on a chord tone) used by the fanfare and big wins.
 */
import { melody, nearest, progression, steps, voice, type ChordEvent, type HitEvent, type NoteEvent } from './notation';
import type { FxEvent, PadEvent, Score } from './types';
import { CELEBRATION_BPM, TIER_KEY, type WinTier } from '../win-tiers';

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

/* =====================================================================================
 * WIN CELEBRATIONS — a key ladder (win-tiers.ts): Büyük F major → Mega G → Süper A → Efsane C → Max win D.
 * Every tier climbs to a higher tonic and adds layers, so a count-up that crosses tiers keeps lifting.
 * All at 120 BPM so tier-up transitions land on the same pulse.
 * ===================================================================================== */

const BW_BPM = CELEBRATION_BPM;
const shiftChords = (chords: ChordEvent[], k: number): ChordEvent[] => chords.map(c => ({ ...c, root: (c.root + k + 12) % 12, tones: c.tones.map(t => (t + k + 12) % 12), bass: (c.bass + k + 12) % 12 }));
const shiftNotes = (notes: NoteEvent[], k: number): NoteEvent[] => notes.map(n => ({ ...n, n: n.n + k }));
/** Melodies above A major are written an octave lower (the tonic still rises; the register stays sweet). */
const leadShift = (key: number) => (key > 4 ? key - 12 : key);

/** Big-win heads 1–3: the original F-major heads, each now in its own tier key (1 F, 2 G, 3 A). Each ends on a held tonic. */
function bigWinHead(tier: 1 | 2 | 3): Score {
  const spec = {
    1: { bars: 2, chords: 'F:2 Bb:1 C:1 | F', lead: 'F5:.25 A5:.25 C6:.25 F6:.25 A5:.25 C6:.25 F6:.25 A6:.25 F6:1 G6:1 | A6:3 r:1', bass: 'F2:2 Bb1:1 C2:1 | F1:3 r:1', lufs: -15 },
    2: { bars: 2, chords: 'F:1 Dm:1 Bb:1 C:1 | F', lead: 'F5:.25 G5:.25 A5:.25 C6:.25 D6:.25 F6:.25 A6:.5 F6:.5 D6:.5 G6:1 | A6:1 G6:.5 A6:.5 C7:2', bass: 'F2:1 D2:1 Bb1:1 C2:1 | F1:3 r:1', lufs: -14.5 },
    3: { bars: 3, chords: 'Dm:2 Bb:2 | Gm:2 C7:2 | F', lead: 'A5:.25 D6:.25 F6:.25 A6:.25 F6:.5 D6:.5 Bb5:.25 D6:.25 F6:.25 Bb6:.25 F6:1 | Bb5:.25 D6:.25 G6:.25 Bb6:.25 G6:.5 D6:.5 C6:.25 E6:.25 G6:.25 C7:.25 Bb6:1 | A6:3 r:1', bass: 'D2:2 Bb1:2 | G1:2 C2:2 | F1:3 r:1', lufs: -14 },
  }[tier];
  const key = TIER_KEY[tier];
  const chords = shiftChords(progression(spec.chords), key);
  const lead = melody(spec.lead, 0, 4, key), bassNotes = melody(spec.bass, 0, 4, key);
  const lastBar = spec.bars - 1;
  const kit = tier === 1
    ? hits(steps('kickPunch', 'x...x...x...x...', 0, 1), steps('snare', '............oxxX', 0, 1), steps('kickPunch', 'X...............', 1, 1))
    : tier === 2
      ? hits(steps('kickPunch', 'x...x...x...x...', 0, 1), steps('snare', '........ooxxxxXX', 0, 1), steps('clap', '....x.......x...', 0, 1), steps('kickPunch', 'X...............', 1, 1))
      : hits(steps('kickPunch', 'x.x.x.x.x.x.x.x.', 0, 2), steps('snare', 'o.o.o.o.x.x.xxXX', 1, 1), steps('tomHi', '............x...', 1, 1), steps('tomMid', '.............x..', 1, 1), steps('tomLo', '..............x.', 1, 1), steps('kickPunch', 'X...............', 2, 1));
  const fx: FxEvent[] = [
    { t: 0, d: 0.5, k: 'impact', v: 0.9 }, { t: 0, d: 3, k: 'crash', v: 0.55 },
    { t: lastBar * 4, d: 4, k: 'crash', v: 0.7 }, { t: lastBar * 4, d: 4, k: 'sparkle', v: 0.8, shape: 'decay', density: 40 + tier * 15, notes: [84, 86, 89, 91, 93, 96].map(n => n + leadShift(key)) },
    ...(tier === 3 ? [{ t: 4, d: 4, k: 'riser' as const, v: 0.7 }, { t: 6, d: 2, k: 'swell' as const, v: 0.45 }] : []),
  ];
  const tonic = 41 + key; // F2 + key: the timpani tonic of the tier
  return {
    id: `cascade-bigwin-${tier}`, bpm: BW_BPM, beatsPerBar: 4, bars: spec.bars, swing: 0.5, loop: false, tail: 2, reverb: 'hall', reverbDb: -5,
    target: { lufs: spec.lufs, measure: 'integrated' }, musicalEnd: spec.bars * 4,
    about: `Big win tier ${tier} (${['', 'Büyük', 'Mega', 'Süper'][tier]}), ${['', 'F', 'G', 'A'][tier]} major, 120 BPM, ${spec.bars} bars (${spec.bars * 2} s): impact, rising arpeggio and the "sugar step" climb, resolving on a held tonic${tier >= 2 ? '; strings added' : ''}${tier === 3 ? '; snare/tom fill and timpani' : ''}.`,
    tracks: [
      { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.35, notes: lead, bright: 1.2 },
      { id: 'synth', kind: 'pitched', voice: 'synthLead', level: -22 + tier, send: 0.25, pan: 0.25, notes: shiftNotes(lead, -12), bright: 0.8 },
      { id: 'glock', kind: 'pitched', voice: 'glock', level: -25, send: 0.4, pan: -0.35, notes: lead.filter(n => n.d >= 0.5) },
      { id: 'pad', kind: 'pad', voice: 'padSaw', level: -23, send: 0.3, width: 1.6, chords: pads(chords, 4, 55, 76, 0.85) },
      ...(tier >= 2 ? [{ id: 'strings', kind: 'pad' as const, voice: 'padString' as const, level: -25, send: 0.4, chords: pads(chords, 3, 65, 84, 0.7) }] : []),
      { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: bassNotes.map(n => ({ ...n, n: n.n > 47 ? n.n - 12 : n.n })) },
      { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: kit },
      ...(tier === 3 ? [{ id: 'timp', kind: 'pitched' as const, voice: 'timpani' as const, level: -23, send: 0.25, notes: [{ t: 8, d: 2, n: tonic, v: 1 }] }] : []),
      { id: 'fx', kind: 'fx', level: -25, send: 0.35, fx },
    ],
  };
}

/**
 * Big win tier 4 — "Efsane" (legendary), C major, 120 BPM, 3 bars (6 s). The most triumphant head: a wordless
 * choir pad, brass-like stabs, tower bells on the downbeats, a timpani roll into the final bar and the densest
 * sparkle shower. Melody: an arpeggio launch into a held fifth, then a step-wise climb to the high tonic.
 */
const EFSANE_LEAD = 'E5:.25 G5:.25 C6:.25 E6:.25 G6:1 E6:.5 G6:.5 A6:1 | A6:.5 G6:.25 F6:.25 A6:1 B6:.5 C7:.5 D7:1 | C7:3 r:1';
const EFSANE_CHORDS = 'C:2 Am:2 | F:2 G7sus4:1 G7:1 | Cadd9';
export const BIG_WIN_LEGEND: Score = {
  id: 'cascade-bigwin-4', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 2.6, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
  about: 'Big win tier 4 (Efsane), C major, 120 BPM, 3 bars (6 s): C – Am | F – G7sus4 – G7 | Cadd9. Celesta + brass-like lead, wordless "ah" choir pad, strings, tower bells on each downbeat, timpani roll into the last bar, impact, crash and the densest sparkle shower.',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.35, notes: melody(EFSANE_LEAD), bright: 1.2 },
    { id: 'brass', kind: 'pitched', voice: 'brass', level: -21, send: 0.28, pan: 0.2, notes: melody(EFSANE_LEAD, 0, 4, -12), bright: 1 },
    { id: 'stabs', kind: 'pitched', voice: 'brass', level: -24, send: 0.3, pan: -0.2, notes: [0, 1.5, 2, 4, 5.5, 6, 7].flatMap(t => { const tones = t < 4 ? (t < 2 ? [60, 64, 67] : [57, 60, 64]) : t < 6 ? [57, 60, 65] : [59, 62, 67]; return tones.map(n => ({ t, d: 0.35, n, v: 0.8 })); }) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -22, send: 0.45, width: 1.7, chords: pads(progression(EFSANE_CHORDS), 4, 55, 76, 0.9) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -25, send: 0.4, chords: pads(progression(EFSANE_CHORDS), 3, 67, 86, 0.75) },
    { id: 'bells', kind: 'pitched', voice: 'bell', level: -22, send: 0.5, pan: -0.3, notes: melody('C6:4 | A5:2 G5:2 | C6:4') },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -20, send: 0, notes: melody('C2:2 A1:2 | F1:2 G1:2 | C2:3 r:1') },
    { id: 'timp', kind: 'pitched', voice: 'timpani', level: -21, send: 0.25, notes: [{ t: 0, d: 1, n: 36, v: 1 }, ...Array.from({ length: 16 }, (_, i) => ({ t: 6 + i * 0.125, d: 0.125, n: 43, v: 0.35 + (0.6 * i) / 15 })), { t: 8, d: 2, n: 36, v: 1 }] },
    { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: hits(steps('kickPunch', 'x...x...x...x...', 0, 2), steps('snare', '....o.......o...', 0, 1), steps('snare', 'o.o.o.o.oooooxxX', 1, 1), steps('kickPunch', 'X...............', 2, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.35, fx: [
      { t: 0, d: 0.5, k: 'impact', v: 1 }, { t: 0, d: 4, k: 'crash', v: 0.6 }, { t: 4, d: 4, k: 'riser', v: 0.7 }, { t: 6, d: 2, k: 'swell', v: 0.5 },
      { t: 8, d: 0.5, k: 'impact', v: 1 }, { t: 8, d: 4, k: 'crash', v: 0.8 }, { t: 8, d: 4, k: 'sparkle', v: 0.9, shape: 'decay', density: 110, notes: [84, 88, 91, 93, 96, 100] },
    ] },
  ],
};
export const BIG_WIN_HEADS = [bigWinHead(1), bigWinHead(2), bigWinHead(3), BIG_WIN_LEGEND] as const;

/**
 * Count-up beds: the 4-bar I–vi–IV–V celebration loop at 120 BPM, one per tier in the tier's key, layered
 * more fully per tier: 1 plucks/pad/bass/shaker · 2 + kick, claps, pumping supersaw, celesta ostinato ·
 * 3 + celesta/glock lead and open hats · 4 + wordless choir, tower bells and timpani · max + strings,
 * brass stabs and 16th hats.
 */
const BED_CHORDS = progression('F | Dm | Bb | C');
const BED_LEAD = `C6:.75 A5:.25 C6:.5 F6:1.5 E6:.5 D6:.5 | D6:.75 A5:.25 D6:.5 F6:1.5 E6:.5 D6:.5 | D6:.75 Bb5:.25 D6:.5 F6:1 G6:.5 F6:.5 D6:.5 | E6:1 G6:1 C6:.5 D6:.5 E6:1`;
type BedLevel = 1 | 2 | 3 | 4 | 5;
function bed(level: BedLevel): Score {
  const key = level === 5 ? TIER_KEY.max : TIER_KEY[level as WinTier];
  const chords = shiftChords(BED_CHORDS, key), lk = leadShift(key);
  const name = level === 5 ? 'max' : String(level);
  const tracks: Score['tracks'] = [
    { id: 'arp', kind: 'pitched', voice: 'pluck', level: -23, send: 0.2, pan: 0.4, bright: 0.6, notes: arp(chords, [0, 1, 2, 3, 2, 1, 2, 3], 0.25, 65, 84, 0.7) },
    { id: 'pad', kind: 'pad', voice: level === 1 ? 'padWarm' : 'padSaw', level: -25, send: 0.3, pump: level >= 2 ? 0.45 : 0, chords: pads(chords, 4, 55, 74, 0.7) },
    { id: 'bass', kind: 'pitched', voice: level === 1 ? 'bass' : 'bassDrive', level: -22, send: 0, notes: bassLine(chords, level === 1 ? 'half' : 'drive', 0.85, true, 38) },
    { id: 'perc', kind: 'kit', level: -28, send: 0.12, hits: hits(steps('shaker', 'x.o.x.o.x.o.x.o.', 0, 4)) },
    { id: 'fx', kind: 'fx', level: -30, send: 0.4, fx: [0, 1, 2, 3].map(b => ({ t: b * 4, d: 2, k: 'sparkle' as const, v: Math.min(0.95, 0.5 + level * 0.1), shape: 'decay' as const, density: 15 + level * 10, notes: [84, 86, 89, 91, 93, 96].map(n => n + lk) })) },
  ];
  if (level >= 2) {
    tracks.push({ id: 'kit', kind: 'kit', level: -22, send: 0.08, hits: hits(steps('kickPunch', 'x...x...x...x...', 0, 4), steps('clap', '....x.......x...', 0, 4)) });
    tracks.push({ id: 'counter', kind: 'pitched', voice: 'celesta', level: -24, send: 0.3, pan: -0.38, notes: arp(chords, [3, 2, 1, 2], 1, 72, 91, 0.6, 3), bright: 1 });
  }
  if (level >= 3) {
    const lead = melody(BED_LEAD, 0, 4, lk);
    tracks.push({ id: 'lead', kind: 'pitched', voice: 'celesta', level: -20, send: 0.35, notes: lead, bright: 1.2 });
    tracks.push({ id: 'glock', kind: 'pitched', voice: 'glock', level: -26, send: 0.4, notes: lead.filter(n => n.d >= 0.5) });
    tracks.push({ id: 'hats', kind: 'kit', level: -28, send: 0.1, hits: steps('hatOpen', '..o...o...o...o.', 0, 4) });
  }
  if (level >= 4) {
    tracks.push({ id: 'choir', kind: 'pad', voice: 'padChoir', level: -24, send: 0.45, width: 1.7, chords: pads(chords, 4, 55, 74, 0.8) });
    tracks.push({ id: 'bells', kind: 'pitched', voice: 'bell', level: -25, send: 0.5, pan: -0.3, notes: chords.map(c => ({ t: c.t, d: 2, n: nearest(c.root, 79), v: 0.75 })) });
    tracks.push({ id: 'timp', kind: 'pitched', voice: 'timpani', level: -25, send: 0.25, notes: chords.flatMap(c => [{ t: c.t, d: 1, n: nearest(c.root, 40), v: 0.9 }, { t: c.t + 3.5, d: 0.5, n: nearest(c.root, 40), v: 0.45 }]) });
  }
  if (level >= 5) {
    tracks.push({ id: 'strings', kind: 'pad', voice: 'padString', level: -26, send: 0.4, chords: pads(chords, 3, 67, 86, 0.7) });
    tracks.push({ id: 'stabs', kind: 'pitched', voice: 'brass', level: -25, send: 0.25, pan: 0.2, notes: chords.flatMap(c => voice(c.tones, 3, 57, 72, null).flatMap(n => [0, 1.5, 2.5].map(t => ({ t: c.t + t, d: 0.3, n, v: 0.75 })))) });
    tracks.push({ id: 'hats16', kind: 'kit', level: -30, send: 0.08, hits: steps('hat', 'g.o.g.o.g.o.g.o.', 0, 4) });
  }
  const keyName = ['F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D'][key];
  return {
    id: `cascade-bed-${name}`, bpm: BW_BPM, beatsPerBar: 4, bars: 4, swing: 0.5, loop: true, tail: 2.5, reverb: 'hall', reverbDb: -6,
    target: { lufs: -15 + Math.min(1, (level - 1) * 0.25), measure: 'integrated' },
    about: `Count-up bed ${level === 5 ? 'max win' : `tier ${level}`}: I – vi – IV – V in ${keyName} major at 120 BPM, 4-bar seamless loop (8 s); ${['plucks, pad, bass, shaker', '+ kick, claps, pumping supersaw, celesta ostinato', '+ celesta/glock lead melody and open hats', '+ wordless choir, tower bells on every chord, timpani', '+ strings, brass-like stabs and 16th hats'].slice(0, level).join(' ')}.`,
    tracks,
  };
}
export const BIG_WIN_BEDS = [bed(1), bed(2), bed(3), bed(4)] as const;
export const MAX_WIN_BED = bed(5);

/**
 * Max win — the ultimate: D major (the top of the key ladder), 120 BPM, 3 bars (6 s). The epic bVI – bVII – I
 * cadence (Bb – C – D) with octave celesta/brass lead, choir, strings, supersaw, tower bells, a snare roll,
 * a timpani roll into the last bar and the longest, brightest shower.
 */
const MAX_LEAD = 'F5:.5 A5:.5 Bb5:.5 D6:.5 F6:2 | G5:.5 C6:.5 E6:.5 G6:.5 E6:1 C6:.5 E6:.5 | A5:.25 D6:.25 F#6:.25 A6:.25 F#6:3';
const MAX_CHORDS = 'Bbadd9 | Cadd9 | Dadd9';
export const MAX_WIN: Score = {
  id: 'cascade-max-win', bpm: BW_BPM, beatsPerBar: 4, bars: 3, swing: 0.5, loop: false, tail: 2.8, reverb: 'hall', reverbDb: -4.5,
  target: { lufs: -14, measure: 'integrated' }, musicalEnd: 12,
  about: 'Max win, D major (top of the key ladder), 120 BPM, 3 bars (6 s): Bb – C – D (bVI–bVII–I) with octave celesta/brass lead, wordless choir, strings and supersaw, tower bells, driving octave bass, snare roll, timpani roll into the last bar, two impacts and the longest sparkle shower.',
  tracks: [
    { id: 'lead', kind: 'pitched', voice: 'celesta', level: -19, send: 0.35, notes: melody(MAX_LEAD), bright: 1.2 },
    { id: 'brass', kind: 'pitched', voice: 'brass', level: -20, send: 0.25, notes: melody(MAX_LEAD, 0, 4, -12), bright: 1 },
    { id: 'glock', kind: 'pitched', voice: 'glock', level: -24, send: 0.4, notes: melody('F6:2 D6:2 | G6:2 E6:2 | F#6:4') },
    { id: 'pad', kind: 'pad', voice: 'padSaw', level: -23, send: 0.3, chords: pads(progression(MAX_CHORDS), 5, 55, 79, 0.9) },
    { id: 'choir', kind: 'pad', voice: 'padChoir', level: -21, send: 0.45, width: 1.7, chords: pads(progression(MAX_CHORDS), 4, 57, 76, 0.95) },
    { id: 'strings', kind: 'pad', voice: 'padString', level: -24, send: 0.45, chords: pads(progression(MAX_CHORDS), 3, 65, 86, 0.8) },
    { id: 'bells', kind: 'pitched', voice: 'bell', level: -22, send: 0.5, pan: 0.3, notes: melody('Bb5:4 | C6:4 | D6:2 A5:2') },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -20, send: 0, notes: melody('Bb1:.5 Bb1:.5 Bb1:.5 Bb1:.5 Bb1:.5 Bb1:.5 Bb1:.5 Bb1:.5 | C2:.5 C2:.5 C2:.5 C2:.5 C2:.5 C2:.5 C2:.5 C2:.5 | D2:3 r:1') },
    { id: 'timp', kind: 'pitched', voice: 'timpani', level: -21, send: 0.25, notes: [{ t: 0, d: 1, n: 34, v: 1 }, { t: 4, d: 1, n: 36, v: 1 }, ...Array.from({ length: 16 }, (_, i) => ({ t: 6 + i * 0.125, d: 0.125, n: 45, v: 0.35 + (0.6 * i) / 15 })), { t: 8, d: 2, n: 38, v: 1 }] },
    { id: 'kit', kind: 'kit', level: -20, send: 0.12, hits: hits(steps('kickPunch', 'x...x...x...x...', 0, 2), steps('snare', 'g.g.o.o.o.o.x.x.', 0, 1), steps('snare', 'oooooxxxxxxxXXXX', 1, 1), steps('kickPunch', 'X...............', 2, 1)) },
    { id: 'fx', kind: 'fx', level: -24, send: 0.35, fx: [{ t: 0, d: 0.5, k: 'impact', v: 1 }, { t: 0, d: 4, k: 'crash', v: 0.6 }, { t: 0, d: 8, k: 'riser', v: 0.6 }, { t: 6, d: 2, k: 'swell', v: 0.5 }, { t: 8, d: 0.5, k: 'impact', v: 1 }, { t: 8, d: 4, k: 'crash', v: 0.8 }, { t: 8, d: 4, k: 'sparkle', v: 0.95, shape: 'decay', density: 130, notes: [86, 90, 93, 95, 98, 102] }] },
  ],
};

/**
 * Total-win fanfare (end of the free-spins feature): F major, 120 BPM, a parade-style flourish distinct from
 * the tier stingers — brass-like dotted stabs, a marimba pickup run, march snare roll and an "applause" of
 * sparkles; the tonic lands at beat 4 and rings to the musical end at beat 6 (3 s).
 */
export const TOTAL_WIN: Score = {
  id: 'cascade-total-win', bpm: BW_BPM, beatsPerBar: 4, bars: 2, swing: 0.5, loop: false, tail: 1.8, reverb: 'hall', reverbDb: -5,
  target: { lufs: -14.5, measure: 'integrated' }, musicalEnd: 6,
  about: 'Total-win fanfare, F major, 120 BPM, 3 s to its musical end: Bb – Gm – C – C7 – F; brass-like lead with dotted parade rhythm, marimba pickup run, celesta doubling, march snare roll into a crash, bells and an applause-like sparkle shower on the final F.',
  tracks: [
    { id: 'brass', kind: 'pitched', voice: 'brass', level: -19, send: 0.25, notes: melody('C5:.25 D5:.25 F5:.5 r:.25 F5:.25 A5:.5 G5:.25 A5:.25 C6:.5 D6:.75 C6:.25 | F6:2 r:2', 0, 4, -12), bright: 1.1 },
    { id: 'cel', kind: 'pitched', voice: 'celesta', level: -21, send: 0.35, notes: melody('C5:.25 D5:.25 F5:.5 r:.25 F5:.25 A5:.5 G5:.25 A5:.25 C6:.5 D6:.75 C6:.25 | F6:2 r:2'), bright: 1.2 },
    { id: 'marimba', kind: 'pitched', voice: 'marimba', level: -25, send: 0.2, pan: -0.35, notes: melody('F4:.125 G4:.125 A4:.125 C5:.125 D5:.125 F5:.125 G5:.125 A5:.125 r:3') },
    { id: 'stabs', kind: 'pitched', voice: 'brass', level: -23, send: 0.25, pan: 0.25, notes: ([[0, [58, 62, 65]], [1, [58, 62, 67]], [1.75, [58, 62, 67]], [2, [60, 64, 67]], [3, [58, 64, 67]], [4, [57, 60, 65]]] as const).flatMap(([t, ns]) => ns.map(n => ({ t, d: t === 4 ? 2 : 0.3, n, v: 0.85 }))) },
    { id: 'pad', kind: 'pad', voice: 'padString', level: -25, send: 0.4, chords: pads(progression('Bb:1 Gm:1 C:1 C7:1 | Fadd9:2 F:2'), 4, 57, 79, 0.75) },
    { id: 'bells', kind: 'pitched', voice: 'bell', level: -24, send: 0.5, notes: melody('r:4 | F5:2 C6:2') },
    { id: 'bass', kind: 'pitched', voice: 'bassDrive', level: -21, send: 0, notes: melody('Bb1:1 G1:1 C2:2 | F1:2 r:2') },
    { id: 'kit', kind: 'kit', level: -21, send: 0.12, hits: hits(steps('kickPunch', 'x.......x.......', 0, 1), steps('snare', '..x.x...ooooxxXX', 0, 1), steps('kickPunch', 'X...............', 1, 1), steps('clap', 'X...............', 1, 1)) },
    { id: 'fx', kind: 'fx', level: -25, send: 0.35, fx: [{ t: 2, d: 2, k: 'swell', v: 0.45 }, { t: 4, d: 0.5, k: 'impact', v: 0.8 }, { t: 4, d: 3, k: 'crash', v: 0.7 }, { t: 4, d: 3, k: 'sparkle', v: 0.85, shape: 'decay', density: 80, notes: [84, 86, 89, 91, 93, 96] }] },
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

export const CASCADE_SCORES = {
  base: BASE_THEME, idle: IDLE_THEME, feature: FEATURE_THEME, fsIntro: FS_INTRO, fsOutro: FS_OUTRO,
  bigWin1: BIG_WIN_HEADS[0], bigWin2: BIG_WIN_HEADS[1], bigWin3: BIG_WIN_HEADS[2], bigWin4: BIG_WIN_HEADS[3],
  bed1: BIG_WIN_BEDS[0], bed2: BIG_WIN_BEDS[1], bed3: BIG_WIN_BEDS[2], bed4: BIG_WIN_BEDS[3], bedMax: MAX_WIN_BED,
  maxWin: MAX_WIN, totalWin: TOTAL_WIN, ambience: AMBIENCE,
} as const;
export type CascadeScoreId = keyof typeof CASCADE_SCORES;
