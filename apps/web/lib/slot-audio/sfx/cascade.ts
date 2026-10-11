/**
 * Candy Cascade sound effects: original designs built from the synth toolkit. Each entry renders
 * several variations; the runtime adds per-play pitch/gain micro-variation on top.
 * Pitched material sits in F major pentatonic (F G A C D) so overlapping effects stay consonant
 * with the base theme (F major) and the feature theme (D minor).
 */
import { addMono, addStereo, sinCycles, stereo, type Stereo } from '../synth/dsp';
import {
  celesta, glock, impact, kick, marimba, modal, musicBox, noiseHit, padChord, pluck, riser, sparkles, whoosh, wood, crash,
  type VoiceCtx,
} from '../synth/instruments';
import { midiToHz } from '../timing';

/** Loudness classes (max momentary LUFS of the rendered effect). Music is mastered to −15 LUFS integrated. */
export const SFX_LEVELS = { major: -11, medium: -12.5, light: -16, ui: -19.5 } as const;
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

export const SFX_IDS = CASCADE_SFX.map(s => s.id);
