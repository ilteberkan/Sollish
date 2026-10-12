/**
 * Candy Cascade sound effects: original designs built from the synth toolkit. Each entry renders
 * several variations; the runtime adds per-play pitch/gain micro-variation on top.
 * Pitched material sits in F major pentatonic (F G A C D) so overlapping effects stay consonant
 * with the base theme (F major) and the feature theme (D minor).
 */
import { addMono, addStereo, addStereoUpsampled, sinCycles, stereo, type Stereo } from '../synth/dsp';
import {
  bell, celesta, choirChord, glock, impact, kick, marimba, modal, musicBox, noiseHit, padChord, pluck, riser, sparkles, synthLead, timpani, vox, whoosh, wood, crash,
  type VoiceCtx,
} from '../synth/instruments';
import { midiToHz } from '../timing';
import { MULTIPLIER_CLASSES, TIER_KEY, TIER_UP_PRE, type MultiplierClass, type WinTier } from '../win-tiers';

/** Loudness classes (max momentary LUFS of the rendered effect). Music is mastered to −15 LUFS integrated.
 *  'hero' is reserved for the top celebration moments (≥50× callouts, tier-4/max landings). */
export const SFX_LEVELS = { hero: -10, major: -11, medium: -12.5, light: -16, ui: -19.5 } as const;
export type SfxLevel = keyof typeof SFX_LEVELS;

export interface SfxDef {
  id: string;
  variations: number;
  level: SfxLevel;
  /** Reverb send, linear. */
  send: number;
  /** Per-play randomisation: pitch in cents, gain in dB. */
  jitter: [number, number];
  /** Rendered in the first (core) batch. */
  core: boolean;
  /** Rendered in its own later batch (rare celebration moments), after the feature theme. */
  late?: boolean;
  build: (ctx: VoiceCtx, variation: number) => Stereo;
}

const PENTA = [65, 67, 69, 72, 74]; // F4 G4 A4 C5 D5
const penta = (degree: number, base = 0) => base + PENTA[((degree % 5) + 5) % 5]! + 12 * Math.floor(degree / 5);
const hz = midiToHz;

const sized = (n: number) => stereo(Math.ceil(n));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
const len = (ctx: VoiceCtx, seconds: number) => Math.ceil(seconds * ctx.sr);

/** Short crunchy sugar cracks scattered over `spread` seconds. */
function cracks(ctx: VoiceCtx, out: Stereo, count: number, spread: number, vel: number) {
  for (let i = 0; i < count; i++) {
    const at = (i === 0 ? 0 : ctx.rng() * spread) * ctx.sr;
    const c = noiseHit(ctx, vel * (0.6 + 0.4 * ctx.rng()), 2400 + ctx.rng() * 1900, 1.3, 0.0003, 0.018 + ctx.rng() * 0.02, 900, 7500);
    mono(out, c, at, 1, ctx.rng() * 1.2 - 0.6);
  }
}

function glide(ctx: VoiceCtx, f0: number, f1: number, seconds: number, vel: number, vibrato = 0): Float32Array {
  const n = len(ctx, seconds), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n, f = f0 * (f1 / f0) ** x * (1 + vibrato * sinCycles((i * 9) / ctx.sr));
    const env = Math.min(1, i / (0.01 * ctx.sr)) * (x < 0.75 ? 0.4 + 0.6 * (x / 0.75) : (1 - x) / 0.25);
    out[i] = sinCycles(ph) * env * vel; ph += f / ctx.sr;
  }
  return out;
}

function bellChord(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, strum = 0.025) {
  notes.forEach((n, i) => mono(out, celesta(ctx, hz(n), vel, 0.4), at + i * strum * ctx.sr, 0.55, (i / Math.max(1, notes.length - 1)) * 0.8 - 0.4));
}

export const CASCADE_SFX: SfxDef[] = [
  {
    id: 'spin', variations: 4, level: 'light', send: 0.12, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.6 * ctx.sr);
      addStereo(out, whoosh(ctx, 0.44 + v * 0.03, 380, 2300 + v * 180, 1, -0.5, 0.5, 0.55), 0, 0.9);
      mono(out, glide(ctx, 300 + v * 15, 720 + v * 20, 0.2, 0.25), 0.02 * ctx.sr, 1);
      for (let i = 0; i < 10; i++) mono(out, noiseHit(ctx, 0.25, 3800 + ctx.rng() * 1500, 2, 0.0003, 0.006, 2000, 8000), ctx.rng() * 0.25 * ctx.sr, 1, ctx.rng() - 0.5);
      return out;
    },
  },
  {
    id: 'land', variations: 4, level: 'light', send: 0.06, jitter: [25, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.4 * ctx.sr);
      mono(out, kick(ctx, 0.9, 205 + v * 10, 92, 0.018, 0.17, 0.12, 1.1), 0, 1);
      mono(out, noiseHit(ctx, 0.35, 650, 0.8, 0.001, 0.05), 0, 0.8);
      mono(out, marimba(ctx, hz(65), 0.45, 0.05), 0.002 * ctx.sr, 0.6);
      return out;
    },
  },
  {
    id: 'tick', variations: 4, level: 'ui', send: 0.04, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(0.12 * ctx.sr);
      mono(out, wood(ctx, 0.7, 1.45 + v * 0.07), 0, 1, (v - 1.5) * 0.15);
      return out;
    },
  },
  {
    id: 'shimmer', variations: 3, level: 'medium', send: 0.3, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(1.3 * ctx.sr);
      addStereo(out, sparkles(ctx, 0.6, 50, [89, 91, 93, 96, 98], 0.9, 'decay'), 0, 1);
      const arps = [[77, 81, 84], [77, 79, 84], [81, 84, 89]];
      bellChord(ctx, out, arps[v % arps.length]!, 0, 0.6, 0.032);
      return out;
    },
  },
  ...(['pop-s', 'pop-m', 'pop-l'] as const).map((id, size): SfxDef => ({
    id, variations: 3, level: size === 2 ? 'major' : size === 1 ? 'medium' : 'light', send: 0.14 + size * 0.04, jitter: [35, 1], core: true,
    build: (ctx, v) => {
      const out = sized((0.55 + size * 0.15) * ctx.sr);
      cracks(ctx, out, [3, 5, 8][size]!, [0.05, 0.08, 0.12][size]!, 0.9);
      mono(out, glide(ctx, 760 - size * 60 + v * 20, 260, 0.06, 0.35), 0.003 * ctx.sr, 1);
      if (size === 2) mono(out, kick(ctx, 0.6, 170, 70, 0.02, 0.2, 0.1, 1.2), 0, 0.9);
      addStereo(out, sparkles(ctx, 0.3 + size * 0.15, 25 + size * 25, [84, 86, 89, 91, 93], 0.7, 'decay'), Math.round(0.015 * ctx.sr), 0.8);
      return out;
    },
  })),
  {
    id: 'tumble', variations: 3, level: 'light', send: 0.1, jitter: [40, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(0.45 * ctx.sr);
      addStereo(out, whoosh(ctx, 0.32, 520, 2100 + v * 150, 0.7, 0.3, -0.3, 0.22), 0, 1);
      for (let i = 0; i < 5; i++) mono(out, wood(ctx, 0.2, 0.9 + ctx.rng() * 0.6), (0.06 + ctx.rng() * 0.2) * ctx.sr, 1, ctx.rng() - 0.5);
      return out;
    },
  },
  {
    id: 'coin', variations: 4, level: 'ui', send: 0.08, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.2 * ctx.sr);
      mono(out, modal(ctx, hz(89) * (1 + v * 0.004), [1, 2.76], [1, 0.3], [0.1, 0.045], 0.8, 10), 0, 1, (v - 1.5) * 0.12);
      mono(out, noiseHit(ctx, 0.15, 5000, 1.5, 0.0003, 0.004, 3000, 9000), 0, 1);
      return out;
    },
  },
  {
    id: 'crystal', variations: 3, level: 'medium', send: 0.28, jitter: [20, 1], core: false,
    build: (ctx, v) => {
      const out = sized(1.2 * ctx.sr);
      const f = hz([93, 96, 89][v]!);
      mono(out, modal(ctx, f, [1, 2.32, 4.25], [1, 0.32, 0.1], [0.95, 0.4, 0.14], 0.8, 10, { attack: 0.0005 }), 0, 0.9, 0.1);
      mono(out, celesta(ctx, f / 2, 0.4, 0.2), 0.012 * ctx.sr, 0.35, -0.1);
      mono(out, noiseHit(ctx, 0.2, 6500, 2, 0.0003, 0.008, 4000, 9500), 0, 1);
      return out;
    },
  },
  {
    id: 'crystal-fly', variations: 3, level: 'light', send: 0.22, jitter: [25, 1], core: false,
    build: (ctx, v) => {
      const out = sized(0.7 * ctx.sr);
      addStereo(out, whoosh(ctx, 0.48, 800, 3800, 0.7, -0.4, 0.4, 0.8), 0, 0.8);
      mono(out, glide(ctx, 880 + v * 40, 2600 + v * 80, 0.45, 0.32, 0.012), 0.02 * ctx.sr, 1);
      return out;
    },
  },
  {
    id: 'crystal-arrive', variations: 3, level: 'medium', send: 0.26, jitter: [20, 1], core: false,
    build: (ctx, v) => {
      const out = sized(1.1 * ctx.sr);
      mono(out, modal(ctx, hz([96, 93, 98][v]!), [1, 2, 3.01], [1, 0.3, 0.12], [0.7, 0.3, 0.1], 0.8, 10), 0, 0.9);
      mono(out, kick(ctx, 0.5, 180, 90, 0.015, 0.14, 0.05, 1.1), 0, 0.7);
      addStereo(out, sparkles(ctx, 0.25, 50, [91, 93, 96], 0.6, 'decay'), Math.round(0.01 * ctx.sr), 0.7);
      return out;
    },
  },
  {
    id: 'multiplier', variations: 3, level: 'major', send: 0.3, jitter: [15, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(1.7 * ctx.sr);
      mono(out, impact(ctx, 1, 0.6), 0, 1);
      const stab = [[65, 69, 72, 77], [69, 72, 77, 81], [65, 72, 77, 79]][v]!;
      bellChord(ctx, out, stab.map(n => n + 12), 0.004 * ctx.sr, 0.85, 0.006);
      mono(out, glock(ctx, hz(89), 0.6), 0.01 * ctx.sr, 0.35);
      addStereo(out, sparkles(ctx, 0.7, 70, [89, 91, 93, 96, 98], 0.8, 'decay'), Math.round(0.02 * ctx.sr), 0.8);
      return out;
    },
  },
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    id: `scatter${n}`, variations: 3, level: n >= 4 ? 'major' : 'medium', send: 0.3, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(1.3 * ctx.sr);
      const note = [81, 84, 86, 89, 91, 93][n - 1]!;
      mono(out, celesta(ctx, hz(note), 0.85, 0.4, 1.2), 0, 0.8, (v - 1) * 0.2);
      mono(out, glock(ctx, hz(note + 12), 0.45), 0.004 * ctx.sr, 0.3, (1 - v) * 0.2);
      if (n >= 3) mono(out, celesta(ctx, hz(note - 7), 0.5, 0.4), 0.02 * ctx.sr, 0.3);
      mono(out, kick(ctx, 0.25 + n * 0.08, 120, 44, 0.05, 0.6, 0.05, 1.2), 0, 0.8);
      addStereo(out, sparkles(ctx, 0.35 + n * 0.06, 25 + n * 10, [note, note + 3, note + 5, note + 7].filter(m => m <= 100), 0.6, 'decay'), Math.round(0.03 * ctx.sr), 0.6);
      return out;
    },
  })),
  {
    id: 'tease', variations: 3, level: 'medium', send: 0.25, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(3.4 * ctx.sr);
      addStereo(out, riser(ctx, 3.2, 240 + v * 20, 4200, 1, 0.3), 0, 0.9);
      addStereo(out, sparkles(ctx, 3.1, 30, [84, 86, 89, 91, 93, 96], 0.7, 'swell'), 0, 0.8);
      // heartbeat pulse that speeds up: tension without a melody
      let t = 0.05, gap = 0.5;
      while (t < 3.0) { mono(out, kick(ctx, 0.35 + t * 0.12, 110, 45, 0.04, 0.35, 0.05, 1.1), t * ctx.sr, 0.8); t += gap; gap = Math.max(0.22, gap * 0.88); }
      return out;
    },
  },
  {
    id: 'trigger', variations: 3, level: 'major', send: 0.35, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(2.6 * ctx.sr);
      mono(out, impact(ctx, 1, 0.8), 0, 1);
      addStereo(out, crash(ctx, 0.5, 2), 0, 0.6);
      const chord = [62, 65, 69, 76].map(n => n + 12);
      bellChord(ctx, out, chord, 0.004 * ctx.sr, 0.85, 0.012 + v * 0.004);
      addStereo(out, padChord(ctx, [62, 65, 69, 74].map(hz), 0.8, 0.35, 'saw', { attack: 0.01, release: 0.4 }), 0, 0.5);
      addStereo(out, sparkles(ctx, 1.6, 60, [86, 89, 91, 93, 98], 0.8, 'decay'), Math.round(0.03 * ctx.sr), 0.8);
      return out;
    },
  },
  {
    id: 'click', variations: 4, level: 'ui', send: 0.02, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.1 * ctx.sr);
      mono(out, modal(ctx, 1350 + v * 40, [1, 2.3], [0.8, 0.25], [0.03, 0.015], 0.8, 10, { attack: 0.0003 }), 0, 1);
      mono(out, modal(ctx, 320, [1], [0.5], [0.04], 0.8, 10), 0, 0.6);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0.08, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.35 * ctx.sr);
      const pair = dir === 0 ? [84, 89] : [89, 84];
      pair.forEach((n, i) => mono(out, musicBox(ctx, hz(n + (v === 2 ? 2 : 0)), 0.6), i * 0.05 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      return out;
    },
  })),
  {
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(0.5 * ctx.sr);
      [64 - v, 58 - v].forEach((n, i) => mono(out, marimba(ctx, hz(n), 0.8, 0.06), i * 0.11 * ctx.sr, 0.9));
      mono(out, kick(ctx, 0.3, 140, 80, 0.02, 0.12, 0, 1), 0, 0.5);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'light', send: 0.15, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(0.8 * ctx.sr);
      const notes = [penta(0, 12), penta(2, 12), penta(3, 12), penta(5, 12)].map(n => n + (v === 1 ? 0 : 0));
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => mono(out, pluck(ctx, hz(n), 0.75, 0.08, 0.6, 0.6, 0.4), (i * (0.045 + v * 0.005)) * ctx.sr, 0.7, (i - 1.5) * 0.2));
      addStereo(out, whoosh(ctx, 0.3, 600, 2400, 0.25, dir ? 0.4 : -0.4, dir ? -0.4 : 0.4), 0, 0.6);
      return out;
    },
  })),
  {
    id: 'ding', variations: 3, level: 'medium', send: 0.3, jitter: [6, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(1.8 * ctx.sr);
      mono(out, celesta(ctx, hz(89), 0.9, 0.8, 1.1), 0, 0.7);
      mono(out, glock(ctx, hz(89 + (v === 2 ? 3 : 0)), 0.55), 0.002 * ctx.sr, 0.35);
      mono(out, celesta(ctx, hz(84), 0.6, 0.8), 0.006 * ctx.sr, 0.35, -0.2);
      mono(out, celesta(ctx, hz(77), 0.5, 0.8), 0.009 * ctx.sr, 0.3, 0.2);
      addStereo(out, sparkles(ctx, 0.5, 40, [93, 96, 98], 0.5, 'decay'), Math.round(0.02 * ctx.sr), 0.6);
      return out;
    },
  },
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key around F5; keys above A are voiced an octave lower so the register stays sweet. */
const tierTonic = (t: TierOrMax) => { const k = TIER_KEY[t]; return 77 + (k > 4 ? k - 12 : k); };
const triad = (root: number) => [root, root + 4, root + 7];
const tierRank = (t: TierOrMax) => (t === 'max' ? 5 : t);

/** Choir chord synthesised at half rate (its formants sit below 3.5 kHz) and interpolated up into `out`. */
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.6) {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}

/** Brass-like stab chord (the synth lead with a slower, darker filter). */
function brassStab(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain = 0.5) {
  notes.forEach((n, i) => mono(out, synthLead(ctx, hz(n), vel, held, 900, 2200, 0.3), at, gain, (i / Math.max(1, notes.length - 1)) * 0.6 - 0.3));
}

/** Pitched "power" impact: a sub sweep that lands on the tonic F, a body thump and an optional crack. */
function powerImpact(ctx: VoiceCtx, out: Stereo, at: number, vel: number, landHz = 43.65, crack = 0.4) {
  mono(out, kick(ctx, vel, landHz * 4.2, landHz, 0.07, 1.1, 0.3, 1.7), at, 1);
  mono(out, noiseHit(ctx, vel * 0.5, 240, 0.6, 0.001, 0.16), at, 0.9);
  if (crack > 0) mono(out, noiseHit(ctx, vel * crack, 2500, 0.8, 0.0005, 0.05, 900, 8000), at, 1);
}

/**
 * Tier-up transition into tier `t`: a rising whoosh for TIER_UP_PRE seconds, then the hit — power impact,
 * cymbal, brass and bell stab on the new key's tonic triad, sparkle burst; tier 4 and max add a tower bell
 * and a short choir "ah"; max adds timpani. The runtime aligns the hit to the beat.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.32, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(2.6 * ctx.sr), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = tierRank(t);
    addStereo(out, whoosh(ctx, TIER_UP_PRE + 0.06, 300, 4200, 0.9, v ? 0.5 : -0.5, v ? -0.3 : 0.3, 0.88), 0, 1);
    addStereo(out, riser(ctx, TIER_UP_PRE, 500, 3800, 0.5, 0.35), 0, 0.6);
    powerImpact(ctx, out, hit, 1, hz(root - 36));
    addStereo(out, crash(ctx, 0.45 + rank * 0.05, 1.6), Math.round(hit), 0.55);
    brassStab(ctx, out, triad(root - 12), hit, 0.85, 0.32, 0.45);
    bellChord(ctx, out, [...triad(root), root + 12], hit + 0.002 * ctx.sr, 0.8, 0.008);
    if (rank >= 4) {
      mono(out, bell(ctx, hz(root), 0.8), hit, 0.45, -0.25);
      choirInto(ctx, out, triad(root - 12), hit, 0.9, 0.55, 0.7, 0.04, 0.5);
    }
    if (t === 'max') mono(out, timpani(ctx, 1, hz(root - 36)), hit, 0.8);
    addStereo(out, sparkles(ctx, 0.9, 50 + rank * 15, [root + 12, root + 16, root + 19, root + 24].filter(n => n <= 100), 0.8, 'decay'), Math.round(hit + 0.01 * ctx.sr), 0.8);
    return out;
  },
});

/**
 * Count-up landing ("the count stops here"): a tonic chord hit in the tier's key, sized by tier — 1 kick,
 * celesta/glock strum; 2 + cymbal; 3 + brass stab; 4 + tower bell and a choir swell; max + timpani and a
 * second bell an octave up.
 */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: tierRank(t) >= 3 ? 'hero' : 'major', send: 0.32, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = tierRank(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized((1.8 + rank * 0.35) * sr);
    mono(out, kick(ctx, 0.9, 170, 46, 0.045, 0.6, 0.6, 1.6), 0, 1);
    if (rank >= 2) { powerImpact(ctx, out, 0, 0.7 + rank * 0.06, hz(root - 36), 0.3); addStereo(out, crash(ctx, 0.4 + rank * 0.06, 1.4 + rank * 0.2), 0, 0.55); }
    const notes = [root - 12, root - 5, root, root + 4, root + 7, root + 12].slice(0, 3 + Math.min(3, rank));
    bellChord(ctx, out, notes, 0.002 * sr, 0.85, 0.012 + v * 0.004);
    mono(out, glock(ctx, hz(root + 12), 0.6), 0.004 * sr, 0.35);
    if (rank >= 3) brassStab(ctx, out, triad(root - 12), 0, 0.9, 0.45, 0.45);
    if (rank >= 4) {
      mono(out, bell(ctx, hz(root), 0.9), 0, 0.5, -0.2);
      choirInto(ctx, out, [root - 12, root - 8, root - 5, root], 0, 0.95, 0.5 + (rank - 4) * 0.4, 0.75, 0.06);
    }
    if (rank >= 5) { mono(out, timpani(ctx, 1, hz(root - 36)), 0, 0.85); mono(out, bell(ctx, hz(root + 12), 0.6), 0.25 * sr, 0.35, 0.3); }
    addStereo(out, sparkles(ctx, 0.8 + rank * 0.25, 40 + rank * 18, [root + 12, root + 14, root + 16, root + 19, root + 24].filter(n => n <= 100), 0.85, 'decay'), Math.round(0.01 * sr), 0.8);
    return out;
  },
});

/** Callout recipe per multiplier class: motif (F major pentatonic, consonant with base and feature themes), spacing and layers. */
const CALLOUT: Record<MultiplierClass, { motif: number[]; step: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [81, 84], step: 0.07, seconds: 1.0, level: 'medium' },
  x10: { motif: [77, 79, 84], step: 0.09, seconds: 1.5, level: 'major' },
  x25: { motif: [74, 77, 79, 81, 86], step: 0.085, seconds: 2.0, level: 'major' },
  x50: { motif: [72, 74, 77, 79, 81, 84, 89], step: 0.075, seconds: 2.5, level: 'hero' },
  x100: { motif: [65, 72, 74, 77, 79, 81], step: 0.12, seconds: 3.1, level: 'hero' },
  x250: { motif: [65, 72, 74, 77, 79, 81, 84, 86, 89], step: 0.11, seconds: 3.7, level: 'hero' },
};

/**
 * Applied-multiplier "announcer" callouts. Non-verbal: a pitched power impact, a sparkle swell and a short
 * motif that grows with the class. x2 a glassy two-note "ting-ting"; x10 a zip-up and a three-note rise;
 * x25 adds a cymbal, a brass stab and a wordless "oh-AH" vox; x50 a choir stab and timpani with a two-octave
 * climb; x100 a brass fanfare with bells, choir swell and a long vox glide; x250 (reserved) a two-phrase
 * fanfare with a second impact. A recorded voice line per class can be layered on top at runtime.
 */
const callout = (c: MultiplierClass): SfxDef => ({
  // frequent classes get two variations; the rare big ones one (per-play micro-variation still applies)
  id: `callout-${c}`, variations: MULTIPLIER_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.3, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = MULTIPLIER_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(spec.seconds * sr);
    const start = rank >= 4 ? 0.1 : 0.05;
    const last = start + (spec.motif.length - 1) * spec.step;
    // impact first: the callout answers the moment the multiplier hits
    if (rank === 0) mono(out, kick(ctx, 0.55, 320, 110, 0.03, 0.18, 0.3, 1.2), 0, 0.8);
    else powerImpact(ctx, out, 0, 0.75 + rank * 0.05, 43.65, 0.3 + rank * 0.05);
    if (rank >= 1) mono(out, glide(ctx, hz(53 + rank * 2), hz(77 + rank * 2), 0.16 + rank * 0.02, 0.3), 0.01 * sr, 0.8);
    if (rank >= 2) addStereo(out, crash(ctx, 0.35 + rank * 0.06, 1.2 + rank * 0.2), 0, 0.5);
    if (rank >= 3) mono(out, timpani(ctx, 1, hz(41)), 0, 0.8);
    if (rank >= 4) mono(out, timpani(ctx, 0.85, hz(48)), Math.round(0.24 * sr), 0.7);
    // motif: celesta lead doubled by glock; from x100 up a brass line carries it an octave lower
    spec.motif.forEach((n, i) => {
      const at = (start + i * spec.step) * sr, final = i === spec.motif.length - 1;
      const vel = 0.65 + 0.35 * (i / Math.max(1, spec.motif.length - 1));
      mono(out, celesta(ctx, hz(n), vel, final ? 0.6 : spec.step, 1.2), at, 0.6, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.5);
      if (final || rank <= 1) mono(out, glock(ctx, hz(n + (n < 84 ? 12 : 0)), 0.5 * vel), at, 0.3);
      if (rank >= 4) mono(out, synthLead(ctx, hz(n - 12), vel, final ? 0.7 : spec.step * 0.9, 900, 2000, 0.3), at, 0.4);
    });
    const finalAt = last * sr;
    // chord on the final note: bells for small classes, brass / choir / tower bells as the class grows
    if (rank >= 1) bellChord(ctx, out, [77, 81, 84, 89].slice(0, 2 + Math.min(2, rank)), finalAt, 0.7, 0.01);
    if (rank >= 2) brassStab(ctx, out, rank >= 4 ? [65, 69, 72, 77] : [62, 65, 69, 72], finalAt, 0.85, 0.3 + rank * 0.08, 0.4);
    if (rank >= 3) choirInto(ctx, out, [53, 60, 65, 69, 72].slice(rank >= 4 ? 0 : 1), rank >= 4 ? 0 : finalAt, 0.9, rank >= 4 ? 1.1 : 0.45, 0.7, rank >= 4 ? 0.25 : 0.03);
    if (rank >= 4) { mono(out, bell(ctx, hz(77), 0.85), finalAt, 0.45, -0.25); mono(out, bell(ctx, hz(84), 0.7), finalAt + 0.12 * sr, 0.35, 0.25); }
    // wordless "oh → AH" vox: the placeholder announcer character
    if (rank >= 2) {
      const [f0, f1, dur] = rank === 2 ? [69, 74, 0.5] : rank === 3 ? [72, 77, 0.6] : rank === 4 ? [65, 72, 0.9] : [65, 77, 1.2];
      mono(out, vox(ctx, hz(f0), hz(f1), dur, 0.8), 0.06 * sr, 0.55, 0);
    }
    if (rank >= 5) { powerImpact(ctx, out, finalAt + 0.08 * sr, 0.9, 43.65, 0.4); addStereo(out, crash(ctx, 0.7, 2), Math.round(finalAt + 0.08 * sr), 0.5); }
    // sparkle swell into the final note, then a burst
    addStereo(out, sparkles(ctx, Math.max(0.15, last), 20 + rank * 12, [84, 86, 89, 91, 93], 0.6, 'swell'), 0, 0.6);
    addStereo(out, sparkles(ctx, 0.5 + rank * 0.18, 40 + rank * 18, [86, 89, 91, 93, 96, 98], 0.8, 'decay'), Math.round(finalAt), 0.8);
    return out;
  },
});

CASCADE_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...MULTIPLIER_CLASSES.map(callout),
);

export const SFX_IDS = CASCADE_SFX.map(s => s.id);
