/**
 * Ebru: Mürekkep Bahçesi sound effects — original designs built from the shared synth toolkit and the Ebru voices
 * in synth/ebru.ts. Frequent effects render 3–4 variations; the rare celebration moments (tier-ups, landings,
 * callouts) 1–2, and the runtime adds per-play pitch/gain micro-variation on top. Materials: water (drops,
 * bubbles, the comb's wet bristles), glass (water glasses, glass harmonica), kanun and ud strings, wood (the
 * kanun's mandal tuning levers), kudüm, zil and a wordless "ah" voice.
 * Pitched material sits on the G major pentatonic (G A B D E), common to the base theme (G Rast, A Uşşak) and the
 * feature theme (D Rast), so overlapping effects stay consonant; the runtime moves pitch only along that ladder
 * (ebru-tiers.ts) and tier stingers use the tier's own key.
 *
 * The comb sweep is assembled at runtime (ebru-sound.ts) from four rendered layers: `comb-glide` (a sustained
 * glass-harmonica tone whose playback rate follows the row shifts), `comb-pluck` (one kanun pluck per row),
 * `comb-bristle` (the wet bristle-on-water texture) and `comb-win` / `comb-settle` (the ending).
 */
import { addMono, addStereo, addStereoUpsampled, stereo, type Stereo } from '../synth/dsp';
import { choirChord, noiseHit, riser, sparkles, vox, whoosh, type VoiceCtx } from '../synth/instruments';
import { frameDrum, softKnee } from '../synth/anatolian';
import { bristles, bubble, bubbles, glassHarpFast as glassHarp, kanun as kanun3, kudum, ud, waterBed, waterGlassFast as waterGlass, zil, type KanunOptions } from '../synth/ebru';
import { midiToHz } from '../timing';
import { MULTIPLIER_CLASSES, TIER_KEY, TIER_UP_PRE, type MultiplierClass, type WinTier } from '../win-tiers';
import { EBRU_TONIC, type EbruVocal } from '../ebru-tiers';
import type { SfxDef, SfxLevel } from './cascade';

const hz = midiToHz;
/** Effects use the two-string kanun course (the triple chorus is a music detail) at two thirds of the cost; comb plucks keep three. */
const kanun = (ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: KanunOptions = {}) => kanun3(ctx, freq, vel, held, bright, { courses: 2, ...opts });
const sized = (ctx: VoiceCtx, seconds: number) => stereo(Math.ceil(seconds * ctx.sr));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
function st(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1) { addStereo(dst, src, Math.round(at), gain, pan, width); }

/** G pentatonic sparkle notes (D6 E6 G6 A6 B6). */
const SPARKS = [86, 88, 91, 93, 95];
/** "ah" choir chord, synthesised at half rate (formants < 3.5 kHz) and interpolated up into `out`. */
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.8) {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release, vowel: 'ah', voices: 3 });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}
/** Kanun notes [midi, start s, held s, velocity], spread a little. */
function plucks(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, bright = 1, pan = 0) {
  notes.forEach(([n, t, d, v], i) => mono(out, kanun(ctx, hz(n), v, d, bright), t * ctx.sr, gain, pan + (i % 2 ? 0.15 : -0.15)));
}
/** A glass-harmonica chord swell. */
function glassChord(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, held: number, vel: number, gain: number, attack = 0.08) {
  notes.forEach((n, i) => mono(out, glassHarp(ctx, hz(n), vel, held, { attack, release: 0.6 }), at, gain / Math.sqrt(notes.length), notes.length > 1 ? (i / (notes.length - 1)) * 0.9 - 0.45 : 0));
}

export const EBRU_SFX: SfxDef[] = [
  {
    // spin start: a stick stirs the size water (swirling whoosh + bubbles) and a soft open kanun G–D
    id: 'spin', variations: 4, level: 'light', send: 0.16, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      st(out, whoosh(ctx, 0.5 + v * 0.03, 200, 1300 + v * 100, 0.8, -0.5, 0.5, 0.5), 0, 0.7);
      st(out, bubbles(ctx, 0.45, 7, 0.5, 450, 1300), 0.08 * ctx.sr, 0.6);
      plucks(ctx, out, [[55 + (v % 2 ? 0 : 7), 0.05, 0.3, 0.55], [62 + (v === 2 ? 5 : 0), 0.08, 0.3, 0.5]], 0.45, 0.7);
      return out;
    },
  },
  {
    // drop-in: an ink drop meets the water — a Minnaert "plip", a tiny water-glass tick, a soft kanun note (runtime pitch per column)
    id: 'drop', variations: 4, level: 'light', send: 0.18, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.6);
      mono(out, bubble(ctx, 900 + v * 70, 0.9, 1.2), 0, 0.9);
      mono(out, bubble(ctx, 1500 + v * 90, 0.4, 0.8), 0.018 * ctx.sr, 0.6, 0.2);
      mono(out, waterGlass(ctx, hz(79), 0.35, 1, 0.25), 0.002 * ctx.sr, 0.45, -0.15);
      mono(out, kanun(ctx, hz(67), 0.45, 0.15, 0.6, { ring: 0.15 }), 0.004 * ctx.sr, 0.4);
      return out;
    },
  },
  {
    // a single symbol settles: a tiny water tick
    id: 'tick', variations: 4, level: 'ui', send: 0, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.12);
      mono(out, bubble(ctx, 1700 + v * 180, 0.7, 0.7), 0, 1, (v - 1.5) * 0.15);
      return out;
    },
  },
  {
    // win highlight: a kanun strum on G pentatonic, a glass shimmer and sparkles
    id: 'win', variations: 3, level: 'medium', send: 0.32, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      const notes = [[67, 71, 74, 79], [67, 69, 74, 81], [71, 74, 79, 83]][v]!;
      plucks(ctx, out, notes.map((n, i) => [n, i * 0.03, 0.6, 0.75] as [number, number, number, number]), 0.5, 1.1);
      mono(out, waterGlass(ctx, hz(notes[3]! + 12), 0.5, 1, 0.6), 0.09 * ctx.sr, 0.3, 0.25);
      st(out, sparkles(ctx, 0.5, 30, SPARKS, 0.55, 'decay'), 0.03 * ctx.sr, 0.5);
      return out;
    },
  },
  ...(['bloom-s', 'bloom-m', 'bloom-l'] as const).map((id, size): SfxDef => ({
    // cluster dissolve = pigment bloom: a soft glass swell opening on G, watery shimmer and bubbles; larger blooms
    // add a low ud thump and more water (the runtime pitches it by colour along the ladder)
    id, variations: 3, level: size === 2 ? 'major' : size === 1 ? 'medium' : 'light', send: 0.3 + size * 0.04, jitter: [25, 1], core: size < 2,
    build: (ctx, v) => {
      const out = sized(ctx, 1.3 + size * 0.4);
      glassChord(ctx, out, [[67, 74], [67, 71, 74], [62, 67, 71, 74]][size]!.map(n => n + (v === 1 ? 12 : 0)), 0, 0.15 + size * 0.1, 0.8, 0.75, 0.015);
      mono(out, waterGlass(ctx, hz(79 + (v === 2 ? 7 : 0)), 0.6, 1.3, 0.5 + size * 0.2), 0, 0.4, (v - 1) * 0.3);
      st(out, bubbles(ctx, 0.35 + size * 0.15, 8 + size * 8, 0.65, 500, 1800 - size * 300), 0, 0.7);
      st(out, sparkles(ctx, 0.35 + size * 0.15, 22 + size * 15, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.45, 0, 1.3);
      if (size >= 1) mono(out, ud(ctx, hz(43), 0.6 + size * 0.15, 0.3), 0, 0.35 + size * 0.1);
      if (size === 2) mono(out, frameDrum(ctx, 0.6, 92), 0, 0.4);
      return out;
    },
  })),
  {
    // drop wild bleed: ink spreading — a deep bubble "bloop", a low ud pluck and a glass-harmonica chord that blooms open
    id: 'bleed', variations: 3, level: 'medium', send: 0.36, jitter: [15, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      mono(out, bubble(ctx, 260 + v * 30, 1, 0.9), 0, 0.9);
      mono(out, bubble(ctx, 420 + v * 40, 0.6, 0.7), 0.05 * ctx.sr, 0.6, -0.2);
      mono(out, ud(ctx, hz(43), 0.85, 0.5), 0, 0.55);
      const chord = [[55, 62, 67, 71], [57, 62, 66, 69], [55, 59, 64, 67]][v]!;
      chord.forEach((n, i) => mono(out, glassHarp(ctx, hz(n + 12), 0.8, 0.6, { attack: 0.14 + i * 0.04, release: 0.7 }), (0.02 + i * 0.05) * ctx.sr, 0.5, i * 0.3 - 0.45));
      st(out, bubbles(ctx, 0.9, 16, 0.5, 350, 1100, 'swell'), 0.05 * ctx.sr, 0.5);
      return out;
    },
  },
  {
    // fall / refill: water closing over the gaps — a soft lapping whoosh and a few drips
    id: 'fall', variations: 3, level: 'light', send: 0.16, jitter: [40, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.7);
      st(out, whoosh(ctx, 0.36, 160, 900 + v * 120, 0.6, 0.3, -0.3, 0.3), 0, 0.8);
      st(out, bubbles(ctx, 0.4, 9, 0.6, 600, 1900), 0.04 * ctx.sr, 0.8);
      return out;
    },
  },
  {
    // stain growth: a glassy ping (water glass + glass-harmonica halo) — the runtime raises it with the stain value
    id: 'stain', variations: 3, level: 'medium', send: 0.34, jitter: [8, 0.6], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      mono(out, waterGlass(ctx, hz(79), 0.9, 1.4, 0.8), 0, 0.7, (v - 1) * 0.25);
      mono(out, glassHarp(ctx, hz(91), 0.5, 0.25, { attack: 0.02, release: 0.5 }), 0.005 * ctx.sr, 0.35, (1 - v) * 0.25);
      mono(out, bubble(ctx, 1200 + v * 100, 0.35, 1), 0, 0.4);
      return out;
    },
  },
  {
    // count-up tick: a small glass tick (the runtime raises its pitch as the count climbs)
    id: 'coin', variations: 4, level: 'ui', send: 0, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.3);
      mono(out, waterGlass(ctx, hz(91) * (1 + v * 0.004), 0.7, 0.4, 0.12), 0, 1, (v - 1.5) * 0.12);
      return out;
    },
  },
  {
    // button click: a wooden mandal (kanun tuning lever) flick with a tiny glass ring
    id: 'click', variations: 4, level: 'ui', send: 0, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.14);
      mono(out, noiseHit(ctx, 0.8, 1900 + v * 120, 2.2, 0.0003, 0.012, 700, 7000), 0, 1);
      mono(out, kudum(ctx, 0.35, 'tek'), 0, 0.35);
      mono(out, waterGlass(ctx, 1480 + v * 40, 0.3, 0.3, 0.08), 0.002 * ctx.sr, 0.3);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      const pair = dir === 0 ? [79, 86] : [86, 79];
      pair.forEach((n, i) => mono(out, waterGlass(ctx, hz(n + (v === 2 ? -2 : 0)), 0.6, 0.6, 0.18), i * 0.06 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      return out;
    },
  })),
  {
    // denied: two muted low ud thumps falling a fourth
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      [0, 1].forEach(i => mono(out, softKnee(ud(ctx, hz(i ? 38 : 43) * (1 + v * 0.02), 0.9, 0.06, 0.3), 10, ctx.sr, 0.15), i * 0.13 * ctx.sr, 0.9));
      mono(out, kudum(ctx, 0.5, 'dum'), 0.13 * ctx.sr, 0.35);
      return out;
    },
  },
  {
    // count-up finish: water glasses G–D–G with a kanun strum, a frame-drum thump and sparkles
    id: 'ding', variations: 3, level: 'medium', send: 0.32, jitter: [6, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2);
      mono(out, waterGlass(ctx, hz(79), 0.85, 1, 1), 0, 0.5);
      mono(out, waterGlass(ctx, hz(v === 2 ? 86 : 74), 0.6, 1, 1), 0.008 * ctx.sr, 0.35, -0.2);
      plucks(ctx, out, [[55, 0, 0.8, 0.7], [62, 0.03, 0.8, 0.65], [67, 0.06, 0.8, 0.65]], 0.4, 0.9);
      mono(out, frameDrum(ctx, 0.5, 100), 0, 0.45);
      st(out, sparkles(ctx, 0.5, 40, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.5);
      return out;
    },
  },
  /* ---------------- the comb sweep layers (core: the comb passes on most spins) ---------------- */
  {
    // the singing glide: a sustained glass-harmonica G5 with its octave and a soft D/G halo; the runtime bends its playback rate along the row shifts
    id: 'comb-glide', variations: 3, level: 'medium', send: 0.4, jitter: [0, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 5.9);
      const tone = glassHarp(ctx, hz(79), 0.9, 5.2, { attack: 0.05, release: 0.25, beat: 1.1 + v * 0.35 });
      mono(out, tone, 0, 0.75);
      mono(out, glassHarp(ctx, hz(91), 0.4, 5.2, { attack: 0.08, release: 0.25, beat: 1.7 }), 0, 0.22, 0.2);
      if (v !== 0) mono(out, glassHarp(ctx, hz(v === 1 ? 74 : 67), 0.5, 5.2, { attack: 0.1, release: 0.25 }), 0, 0.2, -0.2);
      return out;
    },
  },
  {
    // one kanun pluck per comb row (G5; the runtime sets each row's pitch)
    id: 'comb-pluck', variations: 4, level: 'light', send: 0.3, jitter: [4, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      mono(out, kanun(ctx, hz(79), 0.6 + v * 0.05, 0.12, 1.1, { ring: 0.2, courses: 3 }), 0, 0.8, (v - 1.5) * 0.12);
      mono(out, bubble(ctx, 1300 + v * 120, 0.25, 0.8), 0.004 * ctx.sr, 0.35);
      return out;
    },
  },
  {
    // the wet bristle-on-water texture of the comb (flat level: the runtime shapes it along the sweep)
    id: 'comb-bristle', variations: 3, level: 'light', send: 0, jitter: [30, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 3.4);
      st(out, bristles(ctx, 3.3, 0.9, 0.9 + v * 0.1), 0, 1);
      return out;
    },
  },
  {
    // a comb pass that made a win: a golden resolve — kanun strum, glass chord, a water-glass ping and sparkles
    id: 'comb-win', variations: 3, level: 'medium', send: 0.36, jitter: [10, 0.6], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      plucks(ctx, out, [[67, 0, 0.8, 0.8], [71, 0.035, 0.8, 0.75], [74, 0.07, 0.8, 0.75], [79, 0.105, 0.9, 0.8]].map(([n, t, d, x]) => [n + (v === 1 ? 2 : 0), t, d, x] as [number, number, number, number]), 0.45, 1.2);
      glassChord(ctx, out, [67, 71, 74, 79].map(n => n + 12), 0.05 * ctx.sr, 0.4, 0.7, 0.55, 0.04);
      mono(out, waterGlass(ctx, hz(91), 0.7, 1, 0.8), 0.11 * ctx.sr, 0.35, 0.25);
      st(out, sparkles(ctx, 0.7, 40, SPARKS, 0.55, 'decay'), 0.05 * ctx.sr, 0.5);
      return out;
    },
  },
  {
    // a comb pass without a win: the water settles — two drips and a low glass breath
    id: 'comb-settle', variations: 3, level: 'light', send: 0.3, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.4);
      mono(out, bubble(ctx, 1400 + v * 150, 0.6, 0.9), 0, 0.6, -0.2);
      mono(out, bubble(ctx, 900 + v * 100, 0.4, 0.7), 0.16 * ctx.sr, 0.5, 0.25);
      mono(out, glassHarp(ctx, hz(v === 2 ? 62 : 67), 0.5, 0.35, { attack: 0.06, release: 0.5 }), 0.02 * ctx.sr, 0.4);
      return out;
    },
  },
  /* ---------------- feature and extended ---------------- */
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    // golden comb lands 1..6: an ascending golden chime (water glass + bright kanun) over a frame drum that grows; choir from 3
    id: `scatter${n}`, variations: 3, level: n >= 3 ? 'major' : 'medium', send: 0.34, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6 + (n >= 3 ? 0.6 : 0));
      const note = [74, 76, 79, 81, 83, 86][n - 1]!;
      mono(out, waterGlass(ctx, hz(note + 12), 0.9, 0.6, 1), 0, 0.5, (v - 1) * 0.2);
      plucks(ctx, out, [[note, 0, 0.5, 0.85], [note + 7, 0.04, 0.5, 0.6]], 0.55, 1.3);
      mono(out, zil(ctx, 0.35 + n * 0.06, 2300 + n * 60, 0.6), 0.002 * ctx.sr, 0.3, 0.3);
      mono(out, frameDrum(ctx, 0.35 + n * 0.1, 110 - n * 3), 0, 0.45);
      if (n >= 3) choirInto(ctx, out, [note - 24, note - 17, note - 12], 0, 0.7, 0.6, 0.45, 0.05);
      st(out, sparkles(ctx, 0.3 + n * 0.06, 20 + n * 8, SPARKS, 0.5, 'decay'), 0.03 * ctx.sr, 0.5);
      return out;
    },
  })),
  {
    // tease after the 2nd golden comb: water swelling, a rising glass cluster, a frame-drum heartbeat that quickens
    id: 'tease', variations: 3, level: 'medium', send: 0.3, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.6);
      st(out, riser(ctx, 3.2, 180 + v * 15, 2400, 0.5, 0.25), 0, 0.5);
      const w = waterBed(ctx, 3.3, 1, 2, false);
      for (let i = 0; i < w.l.length; i++) { const x = i / w.l.length; w.l[i]! *= x * x; w.r[i]! *= x * x; }
      st(out, w, 0, 1.4);
      [62, 67, 69, 74].forEach((n, i) => mono(out, glassHarp(ctx, hz(n + (v === 1 ? 2 : 0)), 0.5 + i * 0.1, 3 - i * 0.5, { attack: 1.4 - i * 0.2, release: 0.3 }), (0.2 + i * 0.5) * ctx.sr, 0.35, i * 0.3 - 0.45));
      let t = 0.05, gap = 0.55;
      while (t < 3.1) { mono(out, frameDrum(ctx, 0.3 + t * 0.15, 96), t * ctx.sr, 0.7); t += gap; gap = Math.max(0.2, gap * 0.87); }
      return out;
    },
  },
  {
    // feature trigger: the golden chime cascade — kanun and water glasses tumbling down G pentatonic and back up, "ah" swell, zil
    id: 'trigger', variations: 3, level: 'major', send: 0.38, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.4);
      const down = [98, 95, 93, 91, 88, 86, 83, 81, 79, 76, 74, 71], up = [74, 76, 79, 81, 83, 86, 88, 91];
      down.forEach((n, i) => { if (n <= 93) mono(out, kanun(ctx, hz(n), 0.65, 0.2, 1.3, { ring: 0.4 }), i * 0.055 * ctx.sr, 0.35, ((i % 4) - 1.5) * 0.25); else mono(out, waterGlass(ctx, hz(n - 12), 0.6, 1, 0.6), i * 0.055 * ctx.sr, 0.3, 0.3); });
      up.forEach((n, i) => mono(out, waterGlass(ctx, hz(n), 0.55 + i * 0.04, 1, 0.7), (0.72 + i * 0.07 + v * 0.005) * ctx.sr, 0.3, (i / 7) * 1.2 - 0.6));
      plucks(ctx, out, [[55, 1.3, 1.5, 0.9], [62, 1.33, 1.5, 0.85], [67, 1.36, 1.5, 0.85], [71, 1.39, 1.5, 0.85], [74, 1.42, 1.5, 0.85]], 0.45, 1.1);
      choirInto(ctx, out, [55, 62, 67, 71], 0.1 * ctx.sr, 0.85, 1.6, 0.55, 0.6);
      mono(out, zil(ctx, 0.8), 1.3 * ctx.sr, 0.35, 0.35);
      mono(out, frameDrum(ctx, 0.9, 90), 1.3 * ctx.sr, 0.5);
      st(out, bubbles(ctx, 1.2, 20, 0.6, 450, 1600), 1.3 * ctx.sr, 0.5);
      st(out, sparkles(ctx, 1.6, 40, SPARKS, 0.55, 'decay'), 0.05 * ctx.sr, 0.5);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    // autoplay on/off: a quick kanun run up (on) or down (off) with a water swish
    id, variations: 3, level: 'light', send: 0.18, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      const notes = [67, 71, 74, 79];
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => mono(out, kanun(ctx, hz(n), 0.65, 0.12, 0.9, { ring: 0.2 }), i * (0.05 + v * 0.005) * ctx.sr, 0.55, (i - 1.5) * 0.2));
      st(out, whoosh(ctx, 0.3, 300, 1600, 0.25, dir ? 0.4 : -0.4, dir ? -0.4 : 0.4), 0, 0.5);
      return out;
    },
  })),
  ...([['vo-sigh', 'medium'], ['vo-bloom', 'medium'], ['vo-joy', 'major']] as [EbruVocal, SfxLevel][]).map(([id, level]): SfxDef => ({
    // wordless "ah" placeholders for the recorded voice lines (a calm female voice), over a glass halo
    id, variations: 3, level, send: 0.4, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const k = 1 + (v - 1) * 0.03;
      const out = sized(ctx, 1.8);
      if (id === 'vo-sigh') mono(out, vox(ctx, 587 * k, 494 * k, 0.75, 0.8, 'oh', 'ah'), 0, 1);
      else if (id === 'vo-bloom') mono(out, vox(ctx, 440 * k, 659 * k, 0.7, 0.85, 'oo', 'ah'), 0, 1);
      else { mono(out, vox(ctx, 523 * k, 587 * k, 0.22, 0.85, 'ah', 'ah'), 0, 1); mono(out, vox(ctx, 659 * k, 784 * k, 0.75, 0.95, 'eh', 'ah'), 0.26 * ctx.sr, 1); }
      mono(out, glassHarp(ctx, hz(id === 'vo-joy' ? 91 : 86), 0.35, 0.7, { attack: 0.1, release: 0.5 }), 0.05 * ctx.sr, 0.25, 0.2);
      return out;
    },
  })),
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key: G3 + the shared key ladder (G → A → B → D → E). */
const tierTonic = (t: TierOrMax) => EBRU_TONIC + TIER_KEY[t];
const rankOf = (t: TierOrMax) => (t === 'max' ? 5 : t);
const triad = (root: number) => [root, root + 4, root + 7];

/**
 * Tier-up into tier `t`: a rising water whoosh and riser for TIER_UP_PRE seconds, then the hit — a kanun strum on the
 * new tonic triad, a low frame drum, a water-glass bell, bubbles; tier 4 and max add the "ah" choir, max a second
 * bell and zil. The runtime aligns the hit to the celebration beat.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.34, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(ctx, 2.8), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = rankOf(t);
    st(out, whoosh(ctx, TIER_UP_PRE + 0.06, 220, 3000, 0.8, v ? 0.5 : -0.5, v ? -0.3 : 0.3, 0.88), 0, 0.8);
    st(out, riser(ctx, TIER_UP_PRE, 400, 3000, 0.5, 0.3), 0, 0.5);
    plucks(ctx, out, [...triad(root), root + 12].map((n, i) => [n + 12, TIER_UP_PRE + i * 0.025, 0.7, 0.9] as [number, number, number, number]), 0.45, 1.25);
    mono(out, frameDrum(ctx, 1, 88), hit, 0.55);
    mono(out, ud(ctx, hz(root - 12), 0.9, 0.6), hit, 0.45);
    mono(out, waterGlass(ctx, hz(root + 24), 0.75, 1, 0.9), hit + 0.003 * ctx.sr, 0.35, 0.25);
    st(out, bubbles(ctx, 0.6, 16 + rank * 4, 0.7, 500, 1700), hit, 0.6);
    if (rank >= 4) choirInto(ctx, out, [root, root + 7, root + 12, root + 16], hit, 0.9, 0.6, 0.55, 0.05, 0.5);
    if (t === 'max') { mono(out, waterGlass(ctx, hz(root + 31), 0.6, 1, 1), hit + 0.12 * ctx.sr, 0.3, -0.3); mono(out, zil(ctx, 0.8), hit, 0.35, 0.3); }
    st(out, sparkles(ctx, 0.8, 40 + rank * 12, SPARKS, 0.6, 'decay'), hit + 0.01 * ctx.sr, 0.55);
    return out;
  },
});

/**
 * Count-up landing ("the count stops here"), sized by tier: 1 frame drum + water-glass bells on the tonic; 2 + kanun
 * strum and bubbles; 3 + glass chord; 4 + "ah" choir swell; max + zil and a high bell.
 */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: rankOf(t) >= 3 ? 'hero' : 'major', send: 0.34, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = rankOf(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized(ctx, 2.2 + rank * 0.4);
    mono(out, frameDrum(ctx, 0.9 + rank * 0.02, 86), 0, 0.6);
    mono(out, ud(ctx, hz(root - 12), 0.9, 0.8), 0, 0.4);
    const bells = [root + 24, root + 31, root + 36].slice(0, 1 + Math.min(2, rank));
    bells.forEach((n, i) => mono(out, waterGlass(ctx, hz(n), 0.8, 1, 1), (0.003 + i * 0.015 + v * 0.004) * sr, 0.4, i * 0.3 - 0.3));
    if (rank >= 2) { plucks(ctx, out, [...triad(root + 12), root + 24].map((n, i) => [n, i * 0.03, 1, 0.85] as [number, number, number, number]), 0.45, 1.2); st(out, bubbles(ctx, 0.8, 20, 0.7, 450, 1700), 0, 0.55); }
    if (rank >= 3) glassChord(ctx, out, triad(root + 12), 0, 0.7 + rank * 0.1, 0.8, 0.6, 0.03);
    if (rank >= 4) choirInto(ctx, out, [root, root + 4, root + 7, root + 12], 0, 0.95, 0.6 + (rank - 4) * 0.4, 0.6, 0.06);
    if (rank >= 5) { mono(out, zil(ctx, 0.9), 0, 0.35, 0.3); mono(out, waterGlass(ctx, hz(root + 43), 0.6, 1, 1), 0.25 * sr, 0.3, 0.3); }
    st(out, sparkles(ctx, 0.7 + rank * 0.2, 35 + rank * 15, SPARKS, 0.6, 'decay'), 0.01 * sr, 0.55);
    return out;
  },
});

/**
 * Callout recipe per class (stained-cluster multiplier, stain sum or total): each class has its own kanun motif (MIDI,
 * `step` s apart) on the G pentatonic so the classes are told apart instantly, plus water-glass bells, bubbles and the
 * layers it adds.
 *   x2   a rising fourth D–G with one glass ping
 *   x10  G–D–G open fifths, bubbles
 *   x25  + frame drum and the ripple turn B–A–B–D with a short "ah"
 *   x50  G major arpeggio to B with the turn, choir swell, zil
 *   x100 two-octave G pentatonic fanfare, full choir, bell pair, kudüm roll
 *   x250 two-phrase fanfare (D–E–G | A–B–D–E–G) with the highest bells, the longest choir and bloom
 */
const CALLOUT: Record<MultiplierClass, { motif: number[]; step: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [74, 79], step: 0.08, seconds: 1.1, level: 'medium' },
  x10: { motif: [67, 74, 79], step: 0.1, seconds: 1.6, level: 'major' },
  x25: { motif: [71, 69, 71, 74, 79], step: 0.09, seconds: 2.1, level: 'major' },
  x50: { motif: [67, 71, 74, 79, 81, 79, 83], step: 0.09, seconds: 2.7, level: 'hero' },
  x100: { motif: [67, 69, 71, 74, 76, 79, 81, 83, 86, 91], step: 0.08, seconds: 3.3, level: 'hero' },
  x250: { motif: [62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91], step: 0.085, seconds: 4, level: 'hero' },
};

/** Multiplier/stain callouts with glass-and-water character: a kanun motif rising into a held tone, bells, bubbles, choir. */
const callout = (c: MultiplierClass): SfxDef => ({
  id: `callout-${c}`, variations: MULTIPLIER_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.34, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = MULTIPLIER_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(ctx, spec.seconds);
    const start = 0.03, last = start + (spec.motif.length - 1) * spec.step, top = spec.motif[spec.motif.length - 1]!;
    spec.motif.forEach((n, i) => {
      const final = i === spec.motif.length - 1;
      mono(out, kanun(ctx, hz(n), 0.65 + 0.3 * (i / Math.max(1, spec.motif.length - 1)), final ? 0.5 + rank * 0.2 : spec.step, 1.25, { ring: final ? 0.5 : 0.25 }), (start + i * spec.step) * sr, 0.65, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.5);
    });
    const finalAt = last * sr;
    if (rank >= 3) for (const n of spec.motif.slice(-3)) mono(out, kanun(ctx, hz(n - 12), 0.7, 0.4 + rank * 0.15, 1), finalAt, 0.35, -0.2);
    mono(out, waterGlass(ctx, hz(Math.min(98, top + 12)), 0.8, 1.2, 0.6 + rank * 0.15), finalAt, 0.4, 0.25);
    mono(out, glassHarp(ctx, hz(top), 0.7, 0.3 + rank * 0.25, { attack: 0.03, release: 0.6 }), finalAt, 0.35);
    if (rank >= 1) st(out, bubbles(ctx, 0.5 + rank * 0.2, 10 + rank * 8, 0.65, 450, 1800), 0, 0.6);
    if (rank >= 2) { mono(out, frameDrum(ctx, 0.8, 92), finalAt, 0.5); choirInto(ctx, out, rank >= 4 ? [top - 24, top - 17, top - 12, top - 5] : [top - 24, top - 17, top - 12], rank >= 4 ? start * sr : finalAt, 0.85, rank >= 4 ? 0.9 + (rank - 4) * 0.5 : 0.45, 0.5, rank >= 4 ? 0.35 : 0.04); }
    if (rank >= 3) mono(out, zil(ctx, 0.7), finalAt, 0.3, 0.3);
    if (rank >= 4) {
      for (let k = 0; k < 6 + (rank - 4) * 4; k++) mono(out, kudum(ctx, 0.4 + 0.08 * k, 'tek'), (0.25 + k * 0.08) * sr, 0.35);
      mono(out, waterGlass(ctx, hz(Math.min(98, top + 7)), 0.6, 1, 1), finalAt + 0.12 * sr, 0.3, -0.3);
      mono(out, ud(ctx, hz(top - 36 < 31 ? top - 24 : top - 36), 0.9, 0.8), finalAt, 0.4);
    }
    st(out, sparkles(ctx, 0.4 + rank * 0.15, 25 + rank * 12, SPARKS, 0.55, 'decay'), finalAt, 0.55);
    return out;
  },
});

EBRU_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...MULTIPLIER_CLASSES.map(callout),
);

export const EBRU_SFX_IDS = EBRU_SFX.map(s => s.id);
