/**
 * Göreme: Şafak Balonları sound effects — original designs built from the shared synth toolkit and the Göreme voices in
 * synth/goreme.ts. Frequent effects render 3–4 variations; rare celebration moments 1–2, and the runtime adds per-play
 * pitch/gain micro-variation on top (and moves pitch along the F major pentatonic ladder, goreme-tiers.ts).
 * Materials: dawn air (wind gusts, envelope fabric), the propane burner, balloon envelopes, hemp rope and a small brass
 * sky chime, the kanun and the F-tuned bağlama, the bendir-like frame drum and the darbuka, sun-glint sparkles.
 * Pitched material sits on F G A C D, consonant with the base theme (F Acemaşiran colour) and the celebration keys.
 */
import { addMono, addStereo, addStereoUpsampled, stereo, type Stereo } from '../synth/dsp';
import { choirChord, noiseHit, riser, sparkles, vox, whoosh, type VoiceCtx } from '../synth/instruments';
import { baglama, darbuka, frameDrum, ney, softKnee } from '../synth/anatolian';
import { kanun, zil } from '../synth/ebru';
import { balloonWhump, brassChime, burnerRoar, fabricFlutter, ropeCreak, windGust } from '../synth/goreme';
import { midiToHz } from '../timing';
import { TIER_KEY, TIER_UP_PRE, type WinTier } from '../win-tiers';
import { GOREME_CALLOUT_CLASSES, GOREME_TONIC, type GoremeCalloutClass, type GoremeVocal } from '../goreme-tiers';
import type { SfxDef, SfxLevel } from './cascade';

const hz = midiToHz;
const sized = (ctx: VoiceCtx, seconds: number) => stereo(Math.ceil(seconds * ctx.sr));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
function st(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1) { addStereo(dst, src, Math.round(at), gain, pan, width); }

/** Sun-glint sparkle notes (F6 G6 A6 C7 D7). */
const GLINT = [89, 91, 93, 96, 98];
const DRONES = { drones: [87.31, 130.81, 174.61], sympathy: 0.1 };
/** Lute notes [midi, start s, held s, velocity]. */
function saz(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, bright = 0.8, pan = 0) {
  notes.forEach(([n, t, d, v], i) => mono(out, baglama(ctx, hz(n), v, d, bright, DRONES), t * ctx.sr, gain, pan + (i % 2 ? 0.15 : -0.15)));
}
/** Kanun notes [midi, start s, held s, velocity]. */
function kan(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, bright = 1, spread = 0.4) {
  notes.forEach(([n, t, d, v], i) => mono(out, kanun(ctx, hz(n), v, d, bright), t * ctx.sr, gain, notes.length > 1 ? ((i / (notes.length - 1)) * 2 - 1) * spread : 0));
}
/** Brass sky chimes [midi, start s, velocity, length]. */
function chimes(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number?][], gain: number, spread = 0.4) {
  notes.forEach(([n, t, v, len], i) => mono(out, brassChime(ctx, hz(n), v, len ?? 1), t * ctx.sr, gain, notes.length > 1 ? ((i / (notes.length - 1)) * 2 - 1) * spread : 0));
}
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.8, vowel: 'ah' | 'oo' | 'oh' = 'ah') {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release, vowel, voices: 2 });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}
const glints = (ctx: VoiceCtx, dur: number, density: number, v: number, shape: 'decay' | 'swell' | 'flat' = 'decay') => sparkles(ctx, dur, density, GLINT, v, shape);

export const GOREME_SFX: SfxDef[] = [
  {
    // spin start: a short burner breath, a soft open lute F–C, a little glint
    id: 'spin', variations: 4, level: 'light', send: 0.16, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      st(out, burnerRoar(ctx, 0.22 + v * 0.02, 0.5, { heat: 0.3, panFrom: -0.3, panTo: 0.3 }), 0, 0.5);
      st(out, whoosh(ctx, 0.45, 200, 1400 + v * 80, 0.6, -0.5, 0.5, 0.5), 0, 0.5);
      saz(ctx, out, [[53 + (v % 2 ? 7 : 0), 0.05, 0.3, 0.55], [60 + (v === 2 ? 5 : 0), 0.07, 0.3, 0.5]], 0.45);
      st(out, glints(ctx, 0.35, 12, 0.35, 'swell'), 0.05 * ctx.sr, 0.35);
      return out;
    },
  },
  {
    // a reel stops: a woody frame tap and a soft lute pluck (runtime pitch per reel C D F G A C, pan left → right)
    id: 'stop', variations: 4, level: 'light', send: 0.16, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.7);
      mono(out, softKnee(frameDrum(ctx, 0.55, 150 + v * 6), 10, ctx.sr, 0.1), 0, 0.5);
      mono(out, baglama(ctx, hz(65), 0.55, 0.12, 0.7, DRONES), 0.003 * ctx.sr, 0.45);
      mono(out, noiseHit(ctx, 0.3, 2800 + v * 250, 1.5, 0.0003, 0.008, 1500, 8000), 0, 0.4);
      return out;
    },
  },
  {
    // a single symbol settles: a tiny kanun glint
    id: 'tick', variations: 4, level: 'ui', send: 0, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.3);
      mono(out, kanun(ctx, hz(89 - (v % 2) * 3), 0.55, 0.08, 1.1), 0, 0.8, (v - 1.5) * 0.15);
      return out;
    },
  },
  ...([1, 2, 3, 4] as const).map((c): SfxDef => ({
    // a balloon wild lands, by multiplier class: a soft envelope puff and a brass chime (×1); larger classes add a lute
    // dyad, a burner breath and, for ×10+, a short choir halo (the runtime pitches it by multiplier along the ladder)
    id: `balloon-${c}`, variations: 3, level: c >= 3 ? 'medium' : 'light', send: 0.3, jitter: [15, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.2 + c * 0.3);
      mono(out, balloonWhump(ctx, 0.45 + c * 0.08, 0.6 + c * 0.15), 0, 0.5);
      chimes(ctx, out, [[77, 0.01, 0.75, 0.6 + c * 0.2], ...(c >= 2 ? [[84, 0.04, 0.6, 0.6] as [number, number, number, number]] : [])], 0.45, 0.3);
      if (c >= 2) saz(ctx, out, [[65, 0.02, 0.4, 0.6], [72, 0.04, 0.4, 0.55]], 0.35);
      if (c >= 3) st(out, burnerRoar(ctx, 0.25 + c * 0.05, 0.45, { heat: 0.5, panFrom: (v - 1) * 0.3, panTo: (v - 1) * 0.3 }), 0.03 * ctx.sr, 0.35);
      if (c >= 4) choirInto(ctx, out, [65, 72, 77], 0.04 * ctx.sr, 0.7, 0.5, 0.4, 0.05, 0.6, 'oo');
      st(out, glints(ctx, 0.3 + c * 0.1, 14 + c * 8, 0.45), 0.02 * ctx.sr, 0.4);
      return out;
    },
  })),
  ...([0, 1, 2, 3] as const).map((g): SfxDef => ({
    // ways win highlight, graded by size: 0 a kanun dyad · 1 a lute strum on F · 2 + kanun run and frame stroke ·
    // 3 + choir breath, darbuka and a burst of glints (the runtime tilts the pitch by symbol)
    id: `ways-${g}`, variations: 3, level: g >= 3 ? 'major' : g >= 2 ? 'medium' : 'light', send: 0.3, jitter: [15, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.2 + g * 0.4);
      const chord = [[65, 69, 72, 77], [65, 70, 74, 77], [67, 72, 76, 79]][v]!;
      if (g === 0) kan(ctx, out, [[chord[1]! + 12, 0, 0.3, 0.7], [chord[3]! + 12, 0.04, 0.3, 0.65]], 0.5);
      else saz(ctx, out, chord.map((n, i) => [n, i * 0.03, 0.6, 0.75] as [number, number, number, number]), 0.5, 1.0);
      if (g >= 2) { kan(ctx, out, [77, 79, 81, 84, 86, 89].map((n, i) => [n, 0.05 + i * 0.04, 0.2, 0.6 + i * 0.05] as [number, number, number, number]), 0.4, 1.1); mono(out, frameDrum(ctx, 0.7), 0, 0.45); }
      if (g >= 3) { choirInto(ctx, out, [65, 72, 77, 81], 0.05 * ctx.sr, 0.8, 0.5, 0.4, 0.04); mono(out, darbuka(ctx, 0.8, 'dum'), 0.03 * ctx.sr, 0.35); mono(out, zil(ctx, 0.5), 0.07 * ctx.sr, 0.22, 0.3); }
      st(out, glints(ctx, 0.4 + g * 0.15, 20 + g * 12, 0.5), 0.03 * ctx.sr, 0.45);
      return out;
    },
  })),
  {
    // lift: the burner fires — click, ignition puff, the flame roar and hiss — and the envelopes rise (fabric, a rising tone)
    id: 'burner', variations: 3, level: 'medium', send: 0.22, jitter: [25, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      st(out, burnerRoar(ctx, 0.85 + v * 0.08, 0.95, { heat: 0.4 + v * 0.15, panFrom: -0.15, panTo: 0.15 }), 0, 0.75);
      mono(out, fabricFlutter(ctx, 0.5, 0.35, 5), 0.25 * ctx.sr, 0.35, (v - 1) * 0.3);
      st(out, riser(ctx, 0.7, 200, 1400, 0.3, 0.2), 0.2 * ctx.sr, 0.3);
      return out;
    },
  },
  ...([['gust-l', 0.85, -0.85], ['gust-r', -0.85, 0.85], ['breeze', -0.2, 0.2]] as const).map(([id, from, to]): SfxDef => ({
    // wind: a gust sweeping toward the left / right (the balloons drift one reel), or a calm breath when the wind holds
    id, variations: 3, level: id === 'breeze' ? 'ui' : 'light', send: 0.18, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.3);
      st(out, windGust(ctx, id === 'breeze' ? 0.9 : 1.1 + v * 0.05, id === 'breeze' ? 0.5 : 0.9, from, to, 200 + v * 20, id === 'breeze' ? 800 : 1300 + v * 120), 0, 0.8);
      if (id !== 'breeze') mono(out, fabricFlutter(ctx, 0.6, 0.3, 6), 0.2 * ctx.sr, 0.3, to * 0.6);
      return out;
    },
  })),
  {
    // two balloons merge: a deep air "whump", the fabric slap, a rising lute-and-chime tone (runtime pitch by the merged value)
    id: 'merge', variations: 3, level: 'medium', send: 0.3, jitter: [12, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      mono(out, balloonWhump(ctx, 0.95, 1.2 + v * 0.1), 0, 0.75);
      const rise = [65, 69, 72, 77];
      saz(ctx, out, rise.map((n, i) => [n, 0.08 + i * 0.06, 0.3, 0.6 + i * 0.08] as [number, number, number, number]), 0.35, 1);
      chimes(ctx, out, [[84, 0.3, 0.8, 1.2], [89, 0.32, 0.55, 1]], 0.4, 0.2);
      st(out, riser(ctx, 0.35, 300, 2400, 0.35, 0.3), 0, 0.3);
      st(out, glints(ctx, 0.6, 26, 0.5), 0.3 * ctx.sr, 0.45);
      return out;
    },
  },
  {
    // a big merge (×10+): the whump doubled with a frame-drum stroke, a choir swell under the rising tone
    id: 'merge-big', variations: 2, level: 'major', send: 0.32, jitter: [8, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2.6);
      mono(out, balloonWhump(ctx, 1, 1.9), 0, 0.8);
      mono(out, frameDrum(ctx, 0.95, 92), 0, 0.5);
      saz(ctx, out, [53, 60, 65, 69, 72, 77].map((n, i) => [n, 0.06 + i * 0.05, 0.4, 0.7 + i * 0.04] as [number, number, number, number]), 0.38, 1.1);
      choirInto(ctx, out, [65, 72, 77, 81], 0.15 * ctx.sr, 0.85, 0.8, 0.45, 0.2);
      chimes(ctx, out, [[84, 0.35, 0.85, 1.4], [89, 0.37, 0.6, 1.2], [96, 0.4, 0.45, 1]], 0.4, 0.4);
      st(out, glints(ctx, 0.9, 34, 0.55), 0.35 * ctx.sr, 0.5);
      if (v) mono(out, zil(ctx, 0.5), 0.35 * ctx.sr, 0.25, -0.3);
      return out;
    },
  },
  {
    // base game: a balloon leaves the top row and flies away — a fading burner breath, a rising whoosh up and away, a high glint
    id: 'flyaway', variations: 3, level: 'light', send: 0.34, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      const b = burnerRoar(ctx, 0.5, 0.5, { ignite: false, heat: 0.3, panFrom: (v - 1) * 0.3, panTo: (v - 1) * 0.6 });
      for (let i = 0; i < b.l.length; i++) { const g = 1 - i / b.l.length; b.l[i]! *= g; b.r[i]! *= g; }
      st(out, b, 0, 0.45);
      st(out, whoosh(ctx, 1.1, 300, 3200, 0.5, (v - 1) * 0.2, (v - 1) * 0.7, 0.7), 0, 0.5);
      chimes(ctx, out, [[89, 0.6, 0.45, 0.8], [96, 0.75, 0.3, 0.6]], 0.3, 0.3);
      return out;
    },
  },
  {
    // respin: the non-balloon cells are dealt again — a soft airy rustle and a quick descending kanun flick
    id: 'respin', variations: 3, level: 'light', send: 0.18, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.8);
      st(out, whoosh(ctx, 0.35, 180, 1100 + v * 100, 0.5, 0.3, -0.3, 0.35), 0, 0.6);
      [89, 86, 84, 81].forEach((n, i) => mono(out, kanun(ctx, hz(n - (v === 2 ? 2 : 0)), 0.4 - i * 0.05, 0.1, 1), (0.02 + i * 0.04) * ctx.sr, 0.35, 0.3 - i * 0.2));
      return out;
    },
  },
  {
    // count-up tick: a small kanun tick (the runtime raises its pitch as the count climbs)
    id: 'coin', variations: 4, level: 'ui', send: 0, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.3);
      mono(out, kanun(ctx, hz(84) * (1 + v * 0.004), 0.7, 0.06, 1.2), 0, 1, (v - 1.5) * 0.12);
      return out;
    },
  },
  {
    // button click: a dry frame-drum rim tap with a tiny glint
    id: 'click', variations: 4, level: 'ui', send: 0, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.14);
      mono(out, noiseHit(ctx, 0.8, 1600 + v * 120, 2.2, 0.0003, 0.012, 700, 7000), 0, 1);
      mono(out, brassChime(ctx, 1760 + v * 40, 0.2, 0.2), 0.002 * ctx.sr, 0.25);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      const pair = dir === 0 ? [84, 89] : [89, 84];
      pair.forEach((n, i) => mono(out, kanun(ctx, hz(n + (v === 2 ? -2 : 0)), 0.6, 0.1, 1), i * 0.06 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      return out;
    },
  })),
  {
    // count-up finish: chimes F–C–F with a lute strum, a frame stroke and glints
    id: 'ding', variations: 3, level: 'medium', send: 0.32, jitter: [6, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2);
      chimes(ctx, out, [[89, 0, 0.85], [v === 2 ? 96 : 84, 0.008, 0.6]], 0.45);
      saz(ctx, out, [[53, 0, 0.8, 0.7], [60, 0.03, 0.8, 0.65], [65, 0.06, 0.8, 0.65]], 0.4, 0.9);
      mono(out, frameDrum(ctx, 0.55, 92), 0, 0.4);
      st(out, glints(ctx, 0.5, 40, 0.5), 0.02 * ctx.sr, 0.5);
      return out;
    },
  },
  /* ---------------- feature and extended ---------------- */
  {
    // a balloon moors in the sky band: the rope takes the load (creak), a brass chime rings (runtime pitch by the sky value)
    id: 'moor', variations: 3, level: 'medium', send: 0.34, jitter: [10, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      mono(out, ropeCreak(ctx, 0.75, 0.38 + v * 0.05, 34 + v * 4, 90 + v * 10, 1 + (v - 1) * 0.06), 0, 0.6, (v - 1) * 0.3);
      mono(out, balloonWhump(ctx, 0.35, 0.7), 0.02 * ctx.sr, 0.3);
      chimes(ctx, out, [[77, 0.36, 0.85, 1.4], [84, 0.38, 0.55, 1.1]], 0.5, 0.2);
      st(out, glints(ctx, 0.5, 20, 0.45), 0.38 * ctx.sr, 0.4);
      return out;
    },
  },
  {
    // the sky multiplier counts up: a bright chime tick (runtime pitch rises with the value)
    id: 'sky-tick', variations: 4, level: 'light', send: 0.3, jitter: [6, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      chimes(ctx, out, [[89, 0, 0.75, 0.7], [96, 0.006, 0.35, 0.5]], 0.5, 0.15);
      mono(out, kanun(ctx, hz(77), 0.5, 0.15, 1.2), 0.002 * ctx.sr, 0.3, (v - 1.5) * 0.2);
      return out;
    },
  },
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    // the sun scatter lands 1..6: a warm chime pair climbing C–D–F–G–A–C, a ney breath, a frame stroke that grows; choir from 3
    id: `sun${n}`, variations: 3, level: n >= 3 ? 'major' : 'medium', send: 0.36, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8 + (n >= 3 ? 0.6 : 0));
      const note = [72, 74, 77, 79, 81, 84][n - 1]!;
      chimes(ctx, out, [[note, 0, 0.9, 1.3], [note + 12, 0.01, 0.6, 1], [note + 19 <= 100 ? note + 19 : note + 7, 0.02, 0.35, 0.7]], 0.45, 0.3);
      mono(out, ney(ctx, hz(note - 12), 0.55 + n * 0.05, 0.35), 0.01 * ctx.sr, 0.3, (v - 1) * 0.2);
      mono(out, frameDrum(ctx, 0.35 + n * 0.1, n >= 4 ? 92 : 118), 0, 0.45);
      if (n >= 3) choirInto(ctx, out, [note - 24, note - 17, note - 12], 0, 0.7, 0.6, 0.45, 0.05, 0.8, 'oo');
      st(out, glints(ctx, 0.3 + n * 0.06, 20 + n * 8, 0.5), 0.03 * ctx.sr, 0.5);
      return out;
    },
  })),
  {
    // tease after the 2nd sun: the light grows — a held ney swell, a string riser, a quickening frame-drum heartbeat
    id: 'tease', variations: 3, level: 'medium', send: 0.3, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.6);
      st(out, riser(ctx, 3.2, 160 + v * 15, 2400, 0.45, 0.25), 0, 0.45);
      const d = ney(ctx, hz(72 + (v === 1 ? 2 : 0)), 0.75, 3.0);
      for (let i = 0; i < d.length; i++) d[i]! *= Math.min(1, (i / d.length) * 1.6) ** 2;
      mono(out, d, 0, 0.5);
      choirInto(ctx, out, [60, 65, 69, 72], 0.2 * ctx.sr, 0.7, 2.8, 0.4, 1.6, 0.4, 'oo');
      let t = 0.05, gap = 0.55;
      while (t < 3.1) { mono(out, frameDrum(ctx, 0.3 + t * 0.15, 92), t * ctx.sr, 0.6); t += gap; gap = Math.max(0.2, gap * 0.87); }
      return out;
    },
  },
  {
    // feature trigger: dawn breaks — every burner fires, a kanun cascade climbs, a frame-drum and darbuka stroke, a choir chord
    id: 'trigger', variations: 3, level: 'major', send: 0.4, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 4);
      st(out, burnerRoar(ctx, 1.1, 0.8, { heat: 0.9, panFrom: -0.6, panTo: -0.4 }), 0, 0.45);
      st(out, burnerRoar(ctx, 1.0, 0.75, { heat: 0.8, panFrom: 0.5, panTo: 0.6 }), 0.12 * ctx.sr, 0.4);
      kan(ctx, out, [65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89].map((n, i) => [n + (v === 2 ? 2 : 0), 0.3 + i * 0.06, 0.4, 0.55 + i * 0.03] as [number, number, number, number]), 0.38, 1.1, 0.6);
      saz(ctx, out, [[43, 1.0, 1.5, 0.95], [55, 1.02, 1.5, 0.85], [62, 1.04, 1.5, 0.85], [67, 1.06, 1.5, 0.85], [71, 1.08, 1.5, 0.85]], 0.45, 1.1);
      choirInto(ctx, out, [55, 62, 67, 71], 0.9 * ctx.sr, 0.85, 1.6, 0.5, 0.15);
      mono(out, frameDrum(ctx, 1, 92), 1.0 * ctx.sr, 0.55);
      mono(out, darbuka(ctx, 0.9, 'dum'), 1.0 * ctx.sr, 0.4);
      mono(out, zil(ctx, 0.7), 1.0 * ctx.sr, 0.3, 0.3);
      st(out, glints(ctx, 1.6, 40, 0.55), 1.0 * ctx.sr, 0.5);
      return out;
    },
  },
  {
    // +5 spins in the feature: a quick kanun flourish F–G–A–C–D–F with chimes
    id: 'spins-plus', variations: 3, level: 'medium', send: 0.32, jitter: [10, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      [65, 67, 69, 72, 74, 77].forEach((n, i) => mono(out, kanun(ctx, hz(n), 0.7, 0.15, 1.1), i * (0.045 + v * 0.003) * ctx.sr, 0.5, (i - 2.5) * 0.15));
      chimes(ctx, out, [[89, 0.27, 0.85, 1.1], [84, 0.29, 0.6]], 0.45);
      mono(out, zil(ctx, 0.5), 0.27 * ctx.sr, 0.3);
      return out;
    },
  },
  {
    // denied: two muted low lute thumps falling a fourth
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      [0, 1].forEach(i => mono(out, softKnee(baglama(ctx, hz(i ? 36 : 41) * (1 + v * 0.02), 0.95, 0.06, 0.4, { sympathy: 0 }), 10, ctx.sr, 0.15), i * 0.13 * ctx.sr, 0.9));
      mono(out, darbuka(ctx, 0.5, 'ka'), 0.13 * ctx.sr, 0.35);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    // autoplay on/off: a quick kanun run up (on) or down (off) with a breeze
    id, variations: 3, level: 'light', send: 0.18, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      const notes = [65, 69, 72, 77];
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => mono(out, kanun(ctx, hz(n), 0.65, 0.12, 0.9), i * (0.05 + v * 0.005) * ctx.sr, 0.55, (i - 1.5) * 0.2));
      st(out, windGust(ctx, 0.5, 0.35, dir ? 0.4 : -0.4, dir ? -0.4 : 0.4), 0, 0.5);
      return out;
    },
  })),
  ...([['vo-hum', 'medium'], ['vo-rise', 'medium'], ['vo-joy', 'major']] as [GoremeVocal, SfxLevel][]).map(([id, level]): SfxDef => ({
    // wordless placeholders for the recorded lines of the dawn balloon pilot: a hummed voice over a chime and a breath of wind
    id, variations: 3, level, send: 0.42, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const k = 1 + (v - 1) * 0.03;
      const out = sized(ctx, 2);
      if (id === 'vo-hum') mono(out, vox(ctx, 220 * k, 196 * k, 0.8, 0.75, 'oo', 'oh'), 0, 1);
      else if (id === 'vo-rise') mono(out, vox(ctx, 196 * k, 262 * k, 0.75, 0.85, 'oh', 'ah'), 0, 1);
      else { mono(out, vox(ctx, 220 * k, 262 * k, 0.24, 0.85, 'ah', 'ah'), 0, 1); mono(out, vox(ctx, 294 * k, 349 * k, 0.8, 0.95, 'eh', 'ah'), 0.27 * ctx.sr, 1); }
      chimes(ctx, out, [[id === 'vo-joy' ? 89 : 84, 0.05, 0.4, 0.8]], 0.25);
      st(out, windGust(ctx, 0.8, 0.25, -0.3, 0.3, 150, 700), 0, 0.3);
      return out;
    },
  })),
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key: F3 + the shared key ladder (F → G → A → C → D). */
const tierTonic = (t: TierOrMax) => GOREME_TONIC + TIER_KEY[t];
const rankOf = (t: TierOrMax) => (t === 'max' ? 5 : t);
const triad = (root: number) => [root, root + 4, root + 7];

/**
 * Tier-up into tier `t`: a burner roar and riser for TIER_UP_PRE seconds, then the hit — a lute strum on the new tonic
 * triad, a deep frame-drum stroke with zil, a chime, glints; tier 4 and max add the choir, max a second burner.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.34, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(ctx, 2.8), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = rankOf(t);
    st(out, burnerRoar(ctx, TIER_UP_PRE + 0.05, 0.8, { heat: 0.7, panFrom: v ? 0.4 : -0.4, panTo: 0 }), 0, 0.6);
    st(out, riser(ctx, TIER_UP_PRE, 400, 3000, 0.5, 0.3), 0, 0.45);
    saz(ctx, out, [...triad(root), root + 12].map((n, i) => [n + 12, TIER_UP_PRE + i * 0.025, 0.7, 0.9] as [number, number, number, number]), 0.45, 1.2);
    mono(out, frameDrum(ctx, 1, 92), hit, 0.55);
    mono(out, zil(ctx, 0.7), hit, 0.3, 0.3);
    chimes(ctx, out, [[root + 24, TIER_UP_PRE + 0.003, 0.8]], 0.35);
    if (rank >= 4) choirInto(ctx, out, [root, root + 7, root + 12, root + 16], hit, 0.9, 0.6, 0.55, 0.05, 0.5);
    if (t === 'max') { chimes(ctx, out, [[root + 31, TIER_UP_PRE + 0.12, 0.6]], 0.3); st(out, burnerRoar(ctx, 0.8, 0.6, { ignite: false, heat: 0.9, panFrom: 0.5, panTo: 0.5 }), hit, 0.3); }
    st(out, glints(ctx, 0.8, 40 + rank * 12, 0.6), hit + 0.01 * ctx.sr, 0.55);
    return out;
  },
});

/** Count-up landing, sized by tier: 1 frame stroke + chimes on the tonic; 2 + lute strum and glints; 3 + darbuka; 4 + choir; max + zil, a high chime and a burner. */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: rankOf(t) >= 3 ? 'hero' : 'major', send: 0.34, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = rankOf(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized(ctx, 2.4 + rank * 0.4);
    mono(out, frameDrum(ctx, 0.9 + rank * 0.02, 92), 0, 0.6);
    mono(out, baglama(ctx, hz(root - 12), 0.9, 0.8, 0.8, DRONES), 0, 0.4);
    const bl = [root + 24, root + 31, root + 36].slice(0, 1 + Math.min(2, rank));
    chimes(ctx, out, bl.map((n, i) => [n, 0.003 + i * 0.015 + v * 0.004, 0.8] as [number, number, number]), 0.4, 0.3);
    if (rank >= 2) { saz(ctx, out, [...triad(root + 12), root + 24].map((n, i) => [n, i * 0.03, 1, 0.85] as [number, number, number, number]), 0.45, 1.1); st(out, glints(ctx, 0.8, 30, 0.55), 0, 0.5); }
    if (rank >= 3) mono(out, darbuka(ctx, 0.9, 'dum'), 0, 0.4);
    if (rank >= 4) choirInto(ctx, out, [root, root + 4, root + 7, root + 12], 0, 0.95, 0.6 + (rank - 4) * 0.4, 0.6, 0.06);
    if (rank >= 5) { mono(out, zil(ctx, 0.8), 0, 0.35, 0.3); chimes(ctx, out, [[Math.min(100, root + 43), 0.25, 0.6]], 0.3); st(out, burnerRoar(ctx, 1, 0.6, { heat: 0.8 }), 0.2 * sr, 0.3); }
    st(out, glints(ctx, 0.7 + rank * 0.2, 35 + rank * 15, 0.6), 0.01 * sr, 0.55);
    return out;
  },
});

/**
 * Multiplier announcement per class: each class has its own kanun-and-chime motif on F G A C D, so the classes are told
 * apart instantly; from ×10 a burner roar under the motif (the Göreme signature sound for big multipliers), from ×25 a
 * choir, from ×50 darbuka and zil, ×100 the full fanfare with a drum roll.
 */
const CALLOUT: Record<GoremeCalloutClass, { motif: number[]; step: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [72, 77], step: 0.08, seconds: 1.2, level: 'medium' },
  x10: { motif: [65, 72, 77], step: 0.1, seconds: 1.9, level: 'major' },
  x25: { motif: [65, 69, 72, 74, 77], step: 0.09, seconds: 2.3, level: 'major' },
  x50: { motif: [65, 67, 69, 72, 74, 77, 81], step: 0.09, seconds: 2.9, level: 'hero' },
  x100: { motif: [65, 67, 69, 72, 74, 77, 79, 81, 84, 89], step: 0.08, seconds: 3.5, level: 'hero' },
};
const callout = (c: GoremeCalloutClass): SfxDef => ({
  id: `callout-${c}`, variations: GOREME_CALLOUT_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.36, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = GOREME_CALLOUT_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(ctx, spec.seconds);
    const start = 0.03, last = start + (spec.motif.length - 1) * spec.step, top = spec.motif[spec.motif.length - 1]!;
    if (rank >= 1) st(out, burnerRoar(ctx, last + 0.25, 0.55 + rank * 0.08, { heat: 0.4 + rank * 0.12, panFrom: v ? 0.3 : -0.3, panTo: 0 }), 0, 0.45);
    spec.motif.forEach((n, i) => {
      const final = i === spec.motif.length - 1;
      mono(out, brassChime(ctx, hz(n + 12), 0.6 + 0.35 * (i / Math.max(1, spec.motif.length - 1)), final ? 1 + rank * 0.15 : 0.35), (start + i * spec.step) * sr, 0.5, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.5);
      mono(out, kanun(ctx, hz(n), 0.6, final ? 0.5 : spec.step, 1.2), (start + i * spec.step) * sr, 0.4);
    });
    const finalAt = last * sr;
    if (rank >= 1) mono(out, frameDrum(ctx, 0.6 + rank * 0.06, rank >= 2 ? 92 : 118), finalAt, 0.45);
    if (rank >= 2) choirInto(ctx, out, rank >= 4 ? [top - 24, top - 17, top - 12, top - 5] : [top - 24, top - 17, top - 12], rank >= 4 ? start * sr : finalAt, 0.85, rank >= 4 ? 0.9 : 0.45, 0.5, rank >= 4 ? 0.35 : 0.04);
    if (rank >= 3) { mono(out, zil(ctx, 0.7), finalAt, 0.3, 0.3); mono(out, darbuka(ctx, 0.85, 'dum'), finalAt, 0.4); for (const n of spec.motif.slice(-3)) mono(out, baglama(ctx, hz(n - 12), 0.7, 0.4 + rank * 0.15, 0.9, DRONES), finalAt, 0.3, -0.2); }
    if (rank >= 4) for (let k = 0; k < 8; k++) mono(out, darbuka(ctx, 0.35 + 0.07 * k, 'tek'), (0.2 + k * 0.08) * sr, 0.3);
    st(out, glints(ctx, 0.4 + rank * 0.15, 25 + rank * 12, 0.55), finalAt, 0.55);
    return out;
  },
});

GOREME_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...GOREME_CALLOUT_CLASSES.map(callout),
);

export const GOREME_SFX_IDS = GOREME_SFX.map(s => s.id);
