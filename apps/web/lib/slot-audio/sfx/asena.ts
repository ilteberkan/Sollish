/**
 * Asena: Yıldız Kurdu sound effects — original designs built from the shared synth toolkit and the Asena voices in
 * synth/asena.ts. Frequent effects render 3–4 variations; the rare celebration moments (tier-ups, landings, callouts)
 * 1–2, and the runtime adds per-play pitch/gain micro-variation on top. Materials: starlight (crystalline star bells,
 * star dust sparkles), the steppe (wind, frosty grass, hooves), the kopuz and kıl kopuz strings, the kam davulu and its
 * pendants, the throat-singing drone, iron (the Ergenekon mountain) and the guiding wolf's synthesized call.
 * Pitched material sits on the E minor pentatonic (E G A B D), common to the base theme (E Hüseyni), the feature theme
 * (B Kürdi / E Hüseyni) and the throat drone's harmonics, so overlapping effects stay consonant; the runtime moves pitch
 * only along that ladder (asena-tiers.ts) and tier stingers use the tier's own key.
 *
 * The signature constellation is assembled at runtime (asena-sound.ts) from rendered layers: one star note per lighting
 * event of the art plan (`node-lo` / `node` / `node-hi`, E4 / E5 / E6, pitched along the template's motif), then the
 * template's own ignition bloom (`ignite-<template>`) at the plan's end and the howl (`howl`, `howl-great` for Kurt Başı).
 */
import { addMono, addStereo, addStereoUpsampled, stereo, type Stereo } from '../synth/dsp';
import { choirChord, noiseHit, riser, sparkles, vox, whoosh, type VoiceCtx } from '../synth/instruments';
import { softKnee } from '../synth/anatolian';
import { KARGYRAA_HARMONICS, auroraChord, fireCrackle, hoof, ironCrack, kamDavul, khoomeiFast, kilKopuzFast, kopuz, paw, skyHowl, starBell } from '../synth/asena';
import { midiToHz } from '../timing';
import { MULTIPLIER_CLASSES, TIER_KEY, TIER_UP_PRE, type MultiplierClass, type WinTier } from '../win-tiers';
import { ASENA_TEMPLATE_ORDER, ASENA_TONIC, type AsenaTemplateId, type AsenaVocal } from '../asena-tiers';
import type { SfxDef, SfxLevel } from './cascade';

const hz = midiToHz;
const sized = (ctx: VoiceCtx, seconds: number) => stereo(Math.ceil(seconds * ctx.sr));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
function st(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1) { addStereo(dst, src, Math.round(at), gain, pan, width); }

/** E-pentatonic sparkle notes (E6 G6 A6 B6 D7). */
const SPARKS = [88, 91, 93, 95, 98];
/** Wordless choir chord, synthesised at half rate and interpolated up into `out`. */
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.8, vowel: 'ah' | 'oo' | 'oh' = 'ah') {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release, vowel, voices: 3 });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}
function auroraInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack = 0.2, release = 0.9) {
  addStereoUpsampled(out, auroraChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release }), 2, Math.round(at), gain);
}
/** Kopuz notes [midi, start s, held s, velocity]. */
function plucks(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, bright = 1, pan = 0, drone = false) {
  notes.forEach(([n, t, d, v], i) => mono(out, kopuz(ctx, hz(n), v, d, bright, drone ? { drone: -5 } : {}), t * ctx.sr, gain, pan + (i % 2 ? 0.15 : -0.15)));
}
/** Star bells [midi, start s, velocity, length]. */
function bells(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number?][], gain: number, spread = 0.5) {
  notes.forEach(([n, t, v, len], i) => mono(out, starBell(ctx, hz(n), v, len ?? 1), t * ctx.sr, gain, notes.length > 1 ? ((i / (notes.length - 1)) * 2 - 1) * spread : 0));
}
/** The steppe echo of a call: two later, darker, quieter copies to the sides. */
function withEcho(ctx: VoiceCtx, out: Stereo, src: Float32Array, at: number, gain: number, delays: [number, number] = [0.42, 0.95]) {
  mono(out, src, at, gain, 0);
  delays.forEach((d, i) => {
    const e = src.slice();
    let y = 0; const k = 0.18 + 0.1 * (1 - i);
    for (let j = 0; j < e.length; j++) { y += k * (e[j]! - y); e[j] = y; }
    mono(out, e, at + d * ctx.sr, gain * (0.42 - i * 0.16), i ? 0.6 : -0.6);
  });
}

/** The template ignitions: each its own bloom on E, voiced for its shape and multiplier (×2 … ×10). */
const IGNITE: Record<AsenaTemplateId, { chord: number[]; seconds: number; level: SfxLevel; build: (ctx: VoiceCtx, out: Stereo, v: number) => void }> = {
  // a quiet moonlit dyad: B–E bells, a breath of aurora
  hilal: { chord: [71, 76], seconds: 2, level: 'medium', build: (ctx, out, v) => {
    bells(ctx, out, [[83, 0, 0.8, 1.2], [88, 0.03, 0.7, 1.2]], 0.5);
    auroraInto(ctx, out, [64, 71, 76], 0, 0.7, 0.6, 0.6, 0.05, 0.8);
    st(out, sparkles(ctx, 0.5, 24, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.45, 0, 1.2);
    if (v) mono(out, kamDavul(ctx, 0.4, 'jingle'), 0, 0.35);
  } },
  // the bowstring snaps: a low kopuz twang, the arrow's whoosh up, bells E–B–E
  yay: { chord: [64, 71, 76], seconds: 2.2, level: 'medium', build: (ctx, out, v) => {
    mono(out, kopuz(ctx, hz(40), 0.95, 0.4, 1.3, { drone: 7 }), 0, 0.6);
    st(out, whoosh(ctx, 0.5, 600, 4200, 0.6, v ? 0.5 : -0.5, v ? -0.6 : 0.6, 0.3), 0, 0.5);
    bells(ctx, out, [[76, 0.04, 0.8], [83, 0.12, 0.75], [88, 0.2, 0.85, 1.3]], 0.5);
    st(out, sparkles(ctx, 0.6, 30, SPARKS, 0.55, 'decay'), 0.18 * ctx.sr, 0.5, 0, 1.3);
  } },
  // the horse: three hoofbeats, a kopuz gallop strum E–G–B, bells
  at: { chord: [64, 67, 71], seconds: 2.2, level: 'medium', build: (ctx, out, v) => {
    [0, 0.08, 0.16].forEach((t, i) => mono(out, hoof(ctx, 0.6 + i * 0.2), t * ctx.sr, 0.6, -0.2 + i * 0.2));
    plucks(ctx, out, [[52, 0.16, 0.6, 0.9], [59, 0.18, 0.6, 0.8], [64, 0.2, 0.6, 0.85], [67, 0.22, 0.6, 0.8]], 0.4, 1.1);
    bells(ctx, out, [[79, 0.17, 0.75], [83, 0.2, 0.75], [88, 0.24, 0.85, 1.2]], 0.48);
    st(out, sparkles(ctx, 0.6, 30, SPARKS, 0.55, 'decay'), 0.17 * ctx.sr, 0.5, 0, 1.3);
    if (v) mono(out, kamDavul(ctx, 0.6, 'tek'), 0.16 * ctx.sr, 0.4);
  } },
  // the eagle: a high bowed cry gliding up, wing whooshes, wide bells E–B–E–B
  kartal: { chord: [64, 71, 76, 83], seconds: 2.4, level: 'major', build: (ctx, out, v) => {
    const cry = kilKopuzFast(ctx, hz(83), 0.85, 0.5, 1.4);
    mono(out, cry, 0.02 * ctx.sr, 0.45, 0.3);
    st(out, whoosh(ctx, 0.7, 250, 2200, 0.7, -0.7, 0.7, 0.4), 0, 0.5);
    st(out, whoosh(ctx, 0.6, 300, 2600, 0.5, 0.7, -0.7, 0.5), 0.25 * ctx.sr, 0.35);
    bells(ctx, out, [[76, 0, 0.8], [83, 0.04, 0.75], [88, 0.08, 0.85], [95, 0.12, 0.8, 1.3]], 0.48, 0.8);
    mono(out, kamDavul(ctx, 0.75, 'dum'), 0, 0.45);
    st(out, sparkles(ctx, 0.8, 34, SPARKS, 0.55, 'decay'), 0.05 * ctx.sr, 0.5, 0, 1.5);
    if (v) choirInto(ctx, out, [64, 71, 76], 0, 0.6, 0.5, 0.35, 0.05, 0.7);
  } },
  // the tree of life: the deep drone rises from the root, a quartal choir crown E–A–D–G–B, bells
  'hayat-agaci': { chord: [52, 57, 62, 67, 71], seconds: 2.8, level: 'major', build: (ctx, out, v) => {
    mono(out, khoomeiFast(ctx, hz(40), 0.85, 1.6, { harmonics: [8, 12, 16], step: 0.45 }), 0, 0.5);
    choirInto(ctx, out, [64, 69, 74, 79, 83], 0.02 * ctx.sr, 0.8, 0.9, 0.5, 0.08, 0.9);
    bells(ctx, out, [[76, 0, 0.75], [81, 0.05, 0.7], [86, 0.1, 0.75], [91, 0.15, 0.8], [95, 0.2, 0.85, 1.4]], 0.45, 0.7);
    mono(out, kamDavul(ctx, 0.8, 'dum'), 0, 0.45);
    st(out, sparkles(ctx, 1, 36, SPARKS, 0.55, 'decay'), 0.05 * ctx.sr, 0.5, 0, 1.5);
    if (v) mono(out, kamDavul(ctx, 0.5, 'jingle'), 0.1 * ctx.sr, 0.4);
  } },
  // the wolf's head: the grandest — a deep drum stroke, a full choir E–G–B–D, the star cascade, the throat undertone
  'kurt-basi': { chord: [52, 55, 59, 62, 64], seconds: 3, level: 'hero', build: (ctx, out, v) => {
    mono(out, kamDavul(ctx, 1, 'dum'), 0, 0.55);
    mono(out, khoomeiFast(ctx, hz(40), 0.9, 1.8, { harmonics: KARGYRAA_HARMONICS, growl: 0.8 }), 0, 0.45);
    choirInto(ctx, out, [52, 59, 64, 67, 71, 74], 0.02 * ctx.sr, 0.95, 1.1, 0.55, 0.06, 1);
    auroraInto(ctx, out, [64, 71, 76, 79], 0, 0.8, 1.2, 0.45, 0.1, 1);
    bells(ctx, out, [[100, 0.02, 0.6], [98, 0.07, 0.65], [95, 0.12, 0.7], [91, 0.17, 0.7], [88, 0.22, 0.8], [83, 0.27, 0.8], [76, 0.32, 0.85, 1.5]], 0.45, 0.8);
    plucks(ctx, out, [[40, 0, 1.2, 0.95], [52, 0.02, 1.2, 0.85]], 0.45, 1, 0, true);
    st(out, sparkles(ctx, 1.4, 40, SPARKS, 0.6, 'decay'), 0.03 * ctx.sr, 0.55, 0, 1.6);
    if (v) mono(out, kamDavul(ctx, 0.6, 'jingle'), 0.2 * ctx.sr, 0.4);
  } },
};

export const ASENA_SFX: SfxDef[] = [
  {
    // spin start: a gust over the grass, a soft open kopuz E–B with its drone string, a breath of star shimmer
    id: 'spin', variations: 4, level: 'light', send: 0.16, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      st(out, whoosh(ctx, 0.5 + v * 0.03, 180, 1500 + v * 90, 0.8, -0.5, 0.5, 0.5), 0, 0.7);
      plucks(ctx, out, [[52 + (v % 2 ? 7 : 0), 0.04, 0.3, 0.55], [59 + (v === 2 ? 5 : 0), 0.06, 0.3, 0.5]], 0.45, 0.8);
      st(out, sparkles(ctx, 0.4, 14, SPARKS, 0.4, 'swell'), 0.05 * ctx.sr, 0.4);
      return out;
    },
  },
  {
    // a column lands: a short star tick and a soft kopuz note (runtime pitch per column, B D E G A B left → right)
    id: 'land', variations: 4, level: 'light', send: 0.18, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.7);
      mono(out, starBell(ctx, hz(76) * (1 + v * 0.002), 0.75, 0.22), 0, 0.55);
      mono(out, kopuz(ctx, hz(64), 0.5, 0.12, 0.7), 0.003 * ctx.sr, 0.4, -0.1);
      mono(out, noiseHit(ctx, 0.3, 3000 + v * 300, 1.5, 0.0003, 0.008, 1500, 8000), 0, 0.5);
      return out;
    },
  },
  {
    // a single cell settles: a tiny star glint
    id: 'tick', variations: 4, level: 'ui', send: 0, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.25);
      mono(out, starBell(ctx, hz(95 - (v % 2) * 3), 0.6, 0.12), 0, 0.8, (v - 1.5) * 0.15);
      return out;
    },
  },
  {
    // win highlight: a kopuz strum on the E pentatonic, a star bell, sparkles
    id: 'win', variations: 3, level: 'medium', send: 0.32, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      const notes = [[64, 67, 71, 76], [64, 69, 71, 76], [67, 71, 74, 79]][v]!;
      plucks(ctx, out, notes.map((n, i) => [n, i * 0.03, 0.6, 0.75] as [number, number, number, number]), 0.5, 1.1);
      bells(ctx, out, [[notes[3]! + 12, 0.09, 0.6]], 0.35);
      st(out, sparkles(ctx, 0.5, 30, SPARKS, 0.55, 'decay'), 0.03 * ctx.sr, 0.5);
      return out;
    },
  },
  ...(['burst-s', 'burst-m', 'burst-l'] as const).map((id, size): SfxDef => ({
    // a cluster bursts into stars: a star-bell chord bloom on E, a spray of star dust and a puff of air; larger bursts add
    // a drum stroke and a choir breath (the runtime pitches it by symbol along the ladder)
    id, variations: 3, level: size === 2 ? 'major' : size === 1 ? 'medium' : 'light', send: 0.3 + size * 0.04, jitter: [25, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.4 + size * 0.4);
      const chord = [[76, 83], [76, 79, 83], [71, 76, 79, 83, 86]][size]!.map(n => n + (v === 1 ? 12 : 0));
      bells(ctx, out, chord.map((n, i) => [n, i * 0.012, 0.8, 0.5 + size * 0.2] as [number, number, number, number]), 0.55, 0.6);
      st(out, sparkles(ctx, 0.4 + size * 0.2, 40 + size * 30, SPARKS, 0.6, 'decay'), 0, 0.6, 0, 1.4);
      st(out, whoosh(ctx, 0.25 + size * 0.08, 900, 5000, 0.4, -0.3, 0.3, 0.15), 0, 0.35);
      if (size >= 1) mono(out, kamDavul(ctx, 0.5 + size * 0.2, 'tek'), 0, 0.35);
      if (size === 2) { mono(out, kamDavul(ctx, 0.7, 'dum'), 0, 0.4); choirInto(ctx, out, [64, 71, 76], 0, 0.6, 0.35, 0.3, 0.02, 0.6, 'oo'); }
      return out;
    },
  })),
  {
    // fall / refill: star dust drifting down — a quick falling bell run and a soft whoosh
    id: 'fall', variations: 3, level: 'light', send: 0.18, jitter: [40, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      st(out, whoosh(ctx, 0.38, 160, 1000 + v * 120, 0.55, 0.3, -0.3, 0.3), 0, 0.7);
      [95, 91, 88, 86, 83].forEach((n, i) => mono(out, starBell(ctx, hz(n - (v === 2 ? 2 : 0)), 0.45 - i * 0.05, 0.2), (0.02 + i * 0.045) * ctx.sr, 0.35, 0.4 - i * 0.2));
      return out;
    },
  },
  ...([['node-lo', 64], ['node', 76], ['node-hi', 88]] as const).map(([id, n]): SfxDef => ({
    // one star of a constellation lights: a crystalline star bell, the kopuz harmonic on the same note, a glint and a
    // breath of star dust (rendered at E4 / E5 / E6; the runtime plays each node at its motif pitch)
    id, variations: 3, level: 'medium', send: 0.38, jitter: [4, 0.6], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2);
      mono(out, starBell(ctx, hz(n), 0.9, 1.1 + v * 0.1), 0, 0.7);
      mono(out, starBell(ctx, hz(n + 12), 0.45, 0.6), 0.004 * ctx.sr, 0.25, v - 1);
      mono(out, kopuz(ctx, hz(n), 0.55, 0.2, 1.3, { ring: 0.4 }), 0.002 * ctx.sr, 0.3, -0.15);
      st(out, sparkles(ctx, 0.3, 26, SPARKS, 0.45, 'decay'), 0.01 * ctx.sr, 0.4, 0, 1.2);
      return out;
    },
  })),
  ...ASENA_TEMPLATE_ORDER.map((t): SfxDef => ({
    // the constellation ignites: the template's own bloom (see IGNITE)
    id: `ignite-${t}`, variations: 2, level: IGNITE[t].level, send: 0.4, jitter: [5, 0.5], core: true,
    build: (ctx, v) => { const out = sized(ctx, IGNITE[t].seconds); IGNITE[t].build(ctx, out, v); return out; },
  })),
  {
    // the guiding wolf's call (synthesized vocal-formant howl on E5, scoop up, a fall), with its steppe echo
    id: 'howl', variations: 3, level: 'major', send: 0.42, jitter: [12, 0.6], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 4);
      const call = skyHowl(ctx, hz(76) * (1 + (v - 1) * 0.004), 2.1 + v * 0.15, 0.9, { from: 6 + v, fall: 9 + v, breakUp: v === 2 ? 3 : 0, growl: 0.45, breath: 0.5 });
      withEcho(ctx, out, call, 0, 0.8);
      st(out, whoosh(ctx, 1.4, 120, 700, 0.25, -0.4, 0.4, 0.4), 0, 0.3);
      return out;
    },
  },
  {
    // wolf walk: one padded step on frosty grass (the runtime plays a four-step trot over the walk)
    id: 'paw', variations: 4, level: 'light', send: 0.12, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.25);
      mono(out, paw(ctx, 0.9, 0.7 + v * 0.15), 0, 0.9, (v - 1.5) * 0.15);
      return out;
    },
  },
  {
    // a star-trail wild appears where the wolf stood: a rising shimmer of four star bells and dust
    id: 'trail', variations: 3, level: 'light', send: 0.34, jitter: [15, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      [76, 79, 83, 88].forEach((n, i) => mono(out, starBell(ctx, hz(n + (v === 1 ? 3 : 0)), 0.55 + i * 0.08, 0.5), i * 0.05 * ctx.sr, 0.4, -0.3 + i * 0.2));
      st(out, sparkles(ctx, 0.6, 30, SPARKS, 0.5, 'swell'), 0, 0.5, 0, 1.3);
      return out;
    },
  },
  {
    // count-up tick: a small star tick (the runtime raises its pitch as the count climbs)
    id: 'coin', variations: 4, level: 'ui', send: 0, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.3);
      mono(out, starBell(ctx, hz(91) * (1 + v * 0.004), 0.7, 0.15), 0, 1, (v - 1.5) * 0.12);
      return out;
    },
  },
  {
    // button click: a dry kopuz fret tap with a tiny star glint
    id: 'click', variations: 4, level: 'ui', send: 0, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.14);
      mono(out, noiseHit(ctx, 0.8, 1700 + v * 120, 2.2, 0.0003, 0.012, 700, 7000), 0, 1);
      mono(out, kopuz(ctx, hz(52 + v * 2), 0.4, 0.04, 0.6, { mute: true }), 0, 0.35);
      mono(out, starBell(ctx, 1980 + v * 40, 0.25, 0.08), 0.002 * ctx.sr, 0.25);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      const pair = dir === 0 ? [83, 88] : [88, 83];
      pair.forEach((n, i) => mono(out, starBell(ctx, hz(n + (v === 2 ? -2 : 0)), 0.6, 0.2), i * 0.06 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      return out;
    },
  })),
  {
    // count-up finish: star bells E–B–E with a kopuz strum, a drum stroke and star dust
    id: 'ding', variations: 3, level: 'medium', send: 0.32, jitter: [6, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2);
      bells(ctx, out, [[88, 0, 0.85], [v === 2 ? 95 : 83, 0.008, 0.6]], 0.45);
      plucks(ctx, out, [[52, 0, 0.8, 0.7], [59, 0.03, 0.8, 0.65], [64, 0.06, 0.8, 0.65]], 0.4, 0.9);
      mono(out, kamDavul(ctx, 0.55, 'dum'), 0, 0.4);
      st(out, sparkles(ctx, 0.5, 40, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.5);
      return out;
    },
  },
  /* ---------------- feature and extended ---------------- */
  {
    // the great howl (Kurt Başı, big wins): longer, breaking upward, two echoes, a choir and the throat undertone beneath
    id: 'howl-great', variations: 2, level: 'hero', send: 0.45, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 5.4);
      const call = skyHowl(ctx, hz(76), 3.2 + v * 0.2, 0.95, { from: 8, fall: 12, breakUp: 5, growl: 0.7, breath: 0.6 });
      withEcho(ctx, out, call, 0, 0.85, [0.5, 1.1]);
      mono(out, khoomeiFast(ctx, hz(40), 0.8, 2.6, { harmonics: [8, 12, 8], step: 0.9, growl: 0.5 }), 0, 0.35);
      choirInto(ctx, out, [64, 71, 76], 0.4 * ctx.sr, 0.6, 2.2, 0.3, 0.5, 1, 'oo');
      mono(out, kamDavul(ctx, 0.8, 'dum'), 0, 0.4);
      return out;
    },
  },
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    // Ay Ata (moon scatter) lands 1..6: a silver moon bell pair climbing B–D–E–G–A–B, a bowed swell, a drum stroke that grows; choir from 3
    id: `moon${n}`, variations: 3, level: n >= 3 ? 'major' : 'medium', send: 0.36, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.7 + (n >= 3 ? 0.6 : 0));
      const note = [71, 74, 76, 79, 81, 83][n - 1]!;
      bells(ctx, out, [[note, 0, 0.9, 1.2], [note + 12, 0.01, 0.6, 0.9], [note + 19 <= 100 ? note + 19 : note + 7, 0.02, 0.35, 0.6]], 0.45, 0.3);
      mono(out, kilKopuzFast(ctx, hz(note - 12), 0.6 + n * 0.05, 0.35, 0.8), 0.01 * ctx.sr, 0.3, (v - 1) * 0.2);
      mono(out, kamDavul(ctx, 0.35 + n * 0.1, n >= 4 ? 'dum' : 'tek'), 0, 0.45);
      if (n >= 3) choirInto(ctx, out, [note - 24, note - 17, note - 12], 0, 0.7, 0.6, 0.45, 0.05, 0.8, 'oo');
      st(out, sparkles(ctx, 0.3 + n * 0.06, 20 + n * 8, SPARKS, 0.5, 'decay'), 0.03 * ctx.sr, 0.5);
      return out;
    },
  })),
  {
    // tease after the 2nd moon: the throat drone swells, the aurora rises, the drum's heartbeat quickens
    id: 'tease', variations: 3, level: 'medium', send: 0.3, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.6);
      st(out, riser(ctx, 3.2, 160 + v * 15, 2200, 0.45, 0.25), 0, 0.45);
      const d = khoomeiFast(ctx, hz(40 + (v === 1 ? 7 : 0)), 0.8, 3.1, { harmonics: [6, 8, 9, 12, 16], step: 0.62 });
      for (let i = 0; i < d.length; i++) d[i]! *= Math.min(1, (i / d.length) * 1.6) ** 2;
      mono(out, d, 0, 0.55);
      auroraInto(ctx, out, [64, 71, 74, 79], 0.2 * ctx.sr, 0.7, 2.8, 0.45, 1.6, 0.4);
      let t = 0.05, gap = 0.55;
      while (t < 3.1) { mono(out, kamDavul(ctx, 0.3 + t * 0.15, 'dum'), t * ctx.sr, 0.6); t += gap; gap = Math.max(0.2, gap * 0.87); }
      return out;
    },
  },
  {
    // feature trigger: Ay Ata wakes — the star cascade falls and climbs back, a deep drum and choir swell, the wolf answers
    id: 'trigger', variations: 3, level: 'major', send: 0.4, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 4.2);
      const down = [100, 98, 95, 93, 91, 88, 86, 83, 81, 79, 76, 74], up = [76, 79, 81, 83, 86, 88, 91, 95];
      down.forEach((n, i) => mono(out, starBell(ctx, hz(n), 0.65, 0.5), i * 0.055 * ctx.sr, 0.35, ((i % 4) - 1.5) * 0.25));
      up.forEach((n, i) => mono(out, starBell(ctx, hz(n), 0.55 + i * 0.04, 0.7), (0.72 + i * 0.07 + v * 0.005) * ctx.sr, 0.3, (i / 7) * 1.2 - 0.6));
      plucks(ctx, out, [[40, 1.3, 1.5, 0.95], [52, 1.32, 1.5, 0.85], [59, 1.34, 1.5, 0.85], [64, 1.36, 1.5, 0.85], [71, 1.38, 1.5, 0.85]], 0.45, 1.1, 0, true);
      choirInto(ctx, out, [52, 59, 64, 71], 0.1 * ctx.sr, 0.85, 1.6, 0.55, 0.6);
      mono(out, kamDavul(ctx, 1, 'dum'), 1.3 * ctx.sr, 0.55);
      mono(out, kamDavul(ctx, 0.9, 'jingle'), 1.3 * ctx.sr, 0.4);
      withEcho(ctx, out, skyHowl(ctx, hz(71 + (v === 2 ? 5 : 0)), 1.9, 0.85, { from: 6, fall: 9, growl: 0.4 }), 1.75 * ctx.sr, 0.5);
      st(out, sparkles(ctx, 1.6, 40, SPARKS, 0.55, 'decay'), 0.05 * ctx.sr, 0.5);
      return out;
    },
  },
  {
    // a map piece unlocks: a star flies to the sky map (rising whoosh and dust) and lands as a bell dyad (runtime pitch per template)
    id: 'piece', variations: 3, level: 'medium', send: 0.36, jitter: [10, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      st(out, whoosh(ctx, 0.55, 500, 4000, 0.5, -0.5 + v * 0.3, 0.5 - v * 0.3, 0.8), 0, 0.45);
      st(out, sparkles(ctx, 0.55, 24, SPARKS, 0.45, 'swell'), 0, 0.4, 0, 1.2);
      bells(ctx, out, [[76, 0.55, 0.85, 1.1], [83, 0.57, 0.6, 0.9]], 0.5, 0.2);
      mono(out, kamDavul(ctx, 0.45, 'jingle'), 0.55 * ctx.sr, 0.35);
      return out;
    },
  },
  ...([1, 2, 3] as const).map((lvl): SfxDef => ({
    // the global multiplier rises (×2 / ×3 / ×5): the iron mountain of Ergenekon cracks, wider each time — crack, iron
    // ring, boom and molten hiss, the forge fire roaring up, deep drum; ×5 adds the choir and the melted mountain's roar
    id: `mount-${lvl}`, variations: 2, level: lvl === 3 ? 'hero' : 'major', send: 0.34, jitter: [6, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.4 + lvl * 0.6);
      st(out, ironCrack(ctx, 0.9 + lvl * 0.05, lvl), 0, 0.8);
      const fire = fireCrackle(ctx, 1.4 + lvl * 0.5, 0.7, 2 + lvl);
      for (let i = 0; i < fire.l.length; i++) { const x = i / fire.l.length, e = Math.min(1, x * 6) * (1 - x) ** 1.2; fire.l[i]! *= e; fire.r[i]! *= e; }
      st(out, fire, 0.05 * ctx.sr, 0.6, 0, 1.3);
      mono(out, kamDavul(ctx, 1, 'dum'), 0, 0.5);
      if (lvl >= 2) mono(out, kamDavul(ctx, 0.9, 'dum'), 0.32 * ctx.sr, 0.45);
      plucks(ctx, out, [[40, 0.02, 1, 0.9], [47, 0.04, 1, 0.8]], 0.35, 0.9, 0, true);
      if (lvl === 3) { choirInto(ctx, out, [52, 59, 64, 71], 0.3 * ctx.sr, 0.9, 1.4, 0.5, 0.25, 0.9); st(out, riser(ctx, 0.8, 200, 3000, 0.4, 0.3), 0, 0.3); }
      if (v) st(out, sparkles(ctx, 0.8, 20 + lvl * 10, SPARKS, 0.4, 'decay'), 0.4 * ctx.sr, 0.35);
      return out;
    },
  })),
  {
    // +5 spins from the map: a quick kopuz flourish up E–G–A–B–D–E with bells
    id: 'spins-plus', variations: 3, level: 'medium', send: 0.32, jitter: [10, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      [64, 67, 69, 71, 74, 76].forEach((n, i) => mono(out, kopuz(ctx, hz(n), 0.7, 0.15, 1.1, { ring: 0.3 }), i * (0.045 + v * 0.003) * ctx.sr, 0.5, (i - 2.5) * 0.15));
      bells(ctx, out, [[88, 0.27, 0.85, 1.1], [83, 0.29, 0.6]], 0.45);
      mono(out, kamDavul(ctx, 0.6, 'jingle'), 0.27 * ctx.sr, 0.35);
      return out;
    },
  },
  {
    // denied: two muted low kopuz thumps falling a fourth
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      [0, 1].forEach(i => mono(out, softKnee(kopuz(ctx, hz(i ? 35 : 40) * (1 + v * 0.02), 0.95, 0.06, 0.5, { mute: true }), 10, ctx.sr, 0.15), i * 0.13 * ctx.sr, 0.9));
      mono(out, kamDavul(ctx, 0.5, 'tek'), 0.13 * ctx.sr, 0.35);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    // autoplay on/off: a quick kopuz run up (on) or down (off) with a gust
    id, variations: 3, level: 'light', send: 0.18, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      const notes = [64, 67, 71, 76];
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => mono(out, kopuz(ctx, hz(n), 0.65, 0.12, 0.9, { ring: 0.2 }), i * (0.05 + v * 0.005) * ctx.sr, 0.55, (i - 1.5) * 0.2));
      st(out, whoosh(ctx, 0.3, 300, 1600, 0.25, dir ? 0.4 : -0.4, dir ? -0.4 : 0.4), 0, 0.5);
      return out;
    },
  })),
  ...([['vo-breath', 'medium'], ['vo-call', 'medium'], ['vo-joy', 'major']] as [AsenaVocal, SfxLevel][]).map(([id, level]): SfxDef => ({
    // wordless placeholders for the recorded lines of the wise female sky voice, over a star-bell halo and a breath of wind
    id, variations: 3, level, send: 0.42, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const k = 1 + (v - 1) * 0.03;
      const out = sized(ctx, 2);
      if (id === 'vo-breath') mono(out, vox(ctx, 494 * k, 440 * k, 0.8, 0.75, 'oo', 'oh'), 0, 1);
      else if (id === 'vo-call') mono(out, vox(ctx, 440 * k, 659 * k, 0.75, 0.85, 'oh', 'ah'), 0, 1);
      else { mono(out, vox(ctx, 494 * k, 587 * k, 0.24, 0.85, 'ah', 'ah'), 0, 1); mono(out, vox(ctx, 659 * k, 784 * k, 0.8, 0.95, 'eh', 'ah'), 0.27 * ctx.sr, 1); }
      bells(ctx, out, [[id === 'vo-joy' ? 91 : 88, 0.05, 0.4, 0.8]], 0.25);
      st(out, whoosh(ctx, 0.8, 150, 800, 0.2, -0.3, 0.3, 0.4), 0, 0.25);
      return out;
    },
  })),
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key: E3 + the shared key ladder (E → F# → G# → B → C#). */
const tierTonic = (t: TierOrMax) => ASENA_TONIC + TIER_KEY[t];
const rankOf = (t: TierOrMax) => (t === 'max' ? 5 : t);
const triad = (root: number) => [root, root + 4, root + 7];

/**
 * Tier-up into tier `t`: a rising gust and riser for TIER_UP_PRE seconds, then the hit — a kopuz strum on the new tonic
 * triad, a deep kam davulu stroke with its pendants, a star bell, star dust; tier 4 and max add the choir, max the howl's
 * opening and a second bell. The runtime aligns the hit to the celebration beat.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.34, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(ctx, 2.8), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = rankOf(t);
    st(out, whoosh(ctx, TIER_UP_PRE + 0.06, 200, 3000, 0.8, v ? 0.5 : -0.5, v ? -0.3 : 0.3, 0.88), 0, 0.8);
    st(out, riser(ctx, TIER_UP_PRE, 400, 3000, 0.5, 0.3), 0, 0.5);
    plucks(ctx, out, [...triad(root), root + 12].map((n, i) => [n + 12, TIER_UP_PRE + i * 0.025, 0.7, 0.9] as [number, number, number, number]), 0.45, 1.25);
    mono(out, kamDavul(ctx, 1, 'dum'), hit, 0.55);
    mono(out, kopuz(ctx, hz(root - 12), 0.9, 0.6, 0.9, { drone: 7 }), hit, 0.4);
    bells(ctx, out, [[root + 24, TIER_UP_PRE + 0.003, 0.8]], 0.35);
    if (rank >= 4) choirInto(ctx, out, [root, root + 7, root + 12, root + 16], hit, 0.9, 0.6, 0.55, 0.05, 0.5);
    if (t === 'max') { bells(ctx, out, [[root + 31, TIER_UP_PRE + 0.12, 0.6]], 0.3); mono(out, skyHowl(ctx, hz(root + 24), 1.2, 0.7, { fall: 6, growl: 0.3 }), hit + 0.1 * ctx.sr, 0.3, 0.2); }
    st(out, sparkles(ctx, 0.8, 40 + rank * 12, SPARKS, 0.6, 'decay'), hit + 0.01 * ctx.sr, 0.55);
    return out;
  },
});

/**
 * Count-up landing ("the count stops here"), sized by tier: 1 drum stroke + star bells on the tonic; 2 + kopuz strum and
 * star dust; 3 + aurora chord; 4 + choir swell; max + pendants, a high bell and a short howl.
 */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: rankOf(t) >= 3 ? 'hero' : 'major', send: 0.34, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = rankOf(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized(ctx, 2.4 + rank * 0.4);
    mono(out, kamDavul(ctx, 0.9 + rank * 0.02, 'dum'), 0, 0.6);
    mono(out, kopuz(ctx, hz(root - 12), 0.9, 0.8, 0.9, { drone: 7 }), 0, 0.4);
    const bl = [root + 24, root + 31, root + 36].slice(0, 1 + Math.min(2, rank));
    bells(ctx, out, bl.map((n, i) => [n, 0.003 + i * 0.015 + v * 0.004, 0.8] as [number, number, number]), 0.4, 0.3);
    if (rank >= 2) { plucks(ctx, out, [...triad(root + 12), root + 24].map((n, i) => [n, i * 0.03, 1, 0.85] as [number, number, number, number]), 0.45, 1.2); st(out, sparkles(ctx, 0.8, 30, SPARKS, 0.55, 'decay'), 0, 0.5); }
    if (rank >= 3) auroraInto(ctx, out, triad(root + 12), 0, 0.8, 0.7 + rank * 0.1, 0.6, 0.03);
    if (rank >= 4) choirInto(ctx, out, [root, root + 4, root + 7, root + 12], 0, 0.95, 0.6 + (rank - 4) * 0.4, 0.6, 0.06);
    if (rank >= 5) { mono(out, kamDavul(ctx, 0.9, 'jingle'), 0, 0.35, 0.3); bells(ctx, out, [[Math.min(100, root + 43), 0.25, 0.6]], 0.3); mono(out, skyHowl(ctx, hz(root + 24), 1.6, 0.7, { fall: 8, growl: 0.3 }), 0.3 * sr, 0.3, -0.2); }
    st(out, sparkles(ctx, 0.7 + rank * 0.2, 35 + rank * 15, SPARKS, 0.6, 'decay'), 0.01 * sr, 0.55);
    return out;
  },
});

/**
 * Callout recipe per class (applied multiplier or total): each class has its own star-bell motif on the E pentatonic so the
 * classes are told apart instantly, plus the layers it adds.
 *   x2   a rising fourth B–E, one kopuz pluck
 *   x10  E–B–E open fifths, a drum tap
 *   x25  + the call turn E–G–B–D with a short choir breath
 *   x50  E minor-pentatonic climb to G6, choir swell, pendants
 *   x100 two-octave pentatonic fanfare, full choir, a short howl, drum roll
 *   x250 two-phrase fanfare with the highest bells, the great choir and the longest howl
 */
const CALLOUT: Record<MultiplierClass, { motif: number[]; step: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [71, 76], step: 0.08, seconds: 1.2, level: 'medium' },
  x10: { motif: [64, 71, 76], step: 0.1, seconds: 1.7, level: 'major' },
  x25: { motif: [64, 67, 71, 74, 76], step: 0.09, seconds: 2.2, level: 'major' },
  x50: { motif: [64, 67, 69, 71, 74, 76, 79], step: 0.09, seconds: 2.8, level: 'hero' },
  x100: { motif: [64, 67, 69, 71, 74, 76, 79, 81, 83, 88], step: 0.08, seconds: 3.4, level: 'hero' },
  x250: { motif: [59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88], step: 0.085, seconds: 4.2, level: 'hero' },
};

const callout = (c: MultiplierClass): SfxDef => ({
  id: `callout-${c}`, variations: MULTIPLIER_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.36, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = MULTIPLIER_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(ctx, spec.seconds);
    const start = 0.03, last = start + (spec.motif.length - 1) * spec.step, top = spec.motif[spec.motif.length - 1]!;
    spec.motif.forEach((n, i) => {
      const final = i === spec.motif.length - 1;
      mono(out, starBell(ctx, hz(n + 12), 0.6 + 0.35 * (i / Math.max(1, spec.motif.length - 1)), final ? 1 + rank * 0.15 : 0.35), (start + i * spec.step) * sr, 0.55, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.5);
      mono(out, kopuz(ctx, hz(n), 0.6, final ? 0.5 : spec.step, 1.2, { ring: final ? 0.5 : 0.2 }), (start + i * spec.step) * sr, 0.4);
    });
    const finalAt = last * sr;
    if (rank >= 1) mono(out, kamDavul(ctx, 0.6 + rank * 0.06, rank >= 2 ? 'dum' : 'tek'), finalAt, 0.45);
    if (rank >= 2) choirInto(ctx, out, rank >= 4 ? [top - 24, top - 17, top - 12, top - 5] : [top - 24, top - 17, top - 12], rank >= 4 ? start * sr : finalAt, 0.85, rank >= 4 ? 0.9 + (rank - 4) * 0.5 : 0.45, 0.5, rank >= 4 ? 0.35 : 0.04);
    if (rank >= 3) { mono(out, kamDavul(ctx, 0.7, 'jingle'), finalAt, 0.35, 0.3); for (const n of spec.motif.slice(-3)) mono(out, kopuz(ctx, hz(n - 12), 0.7, 0.4 + rank * 0.15, 1), finalAt, 0.3, -0.2); }
    if (rank >= 4) {
      for (let k = 0; k < 6 + (rank - 4) * 4; k++) mono(out, kamDavul(ctx, 0.35 + 0.08 * k, 'tek'), (0.25 + k * 0.08) * sr, 0.3);
      mono(out, skyHowl(ctx, hz(Math.min(83, top)), 1.2 + (rank - 4) * 0.6, 0.75, { fall: 7, growl: 0.3 }), finalAt + 0.08 * sr, 0.35, 0.2);
    }
    st(out, sparkles(ctx, 0.4 + rank * 0.15, 25 + rank * 12, SPARKS, 0.55, 'decay'), finalAt, 0.55);
    return out;
  },
});

ASENA_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...MULTIPLIER_CLASSES.map(callout),
);

/** The ignition chord of each template (MIDI), for the lab and the tests. */
export const ASENA_IGNITE_CHORDS: Readonly<Record<AsenaTemplateId, readonly number[]>> = Object.freeze(Object.fromEntries(ASENA_TEMPLATE_ORDER.map(t => [t, IGNITE[t].chord])) as unknown as Record<AsenaTemplateId, readonly number[]>);
export const ASENA_SFX_IDS = ASENA_SFX.map(s => s.id);
