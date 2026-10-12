/**
 * Tarhun: Fırtına Tahtı sound effects — original designs built from the shared synth toolkit and the
 * Anatolian/storm voices in synth/anatolian.ts. Frequent effects render 3–4 variations; the rare
 * celebration moments (tier-ups, landings, callouts) 1–2, and the runtime adds per-play pitch/gain
 * micro-variation on top. Materials: stone (columns, symbols, shatter), bronze (UI, bells, gongs),
 * lightning and thunder (orbs, multipliers, callouts), bağlama/horn/choir for the musical stingers.
 * Pitched material sits on A, D, G and Bb — common to A Hicaz (base theme) and D Hicaz (feature theme)
 * — so overlapping effects stay consonant with both; tier stingers use the tier's own key.
 */
import { addMono, addStereo, addStereoUpsampled, sinCycles, stereo, type Stereo } from '../synth/dsp';
import { choirChord, crash, noiseHit, riser, sparkles, whoosh, type VoiceCtx } from '../synth/instruments';
import {
  baglama, bronze, davul, davulRim, glassHum, softKnee, godVocal, horn, sizzle, stoneShatter, stoneThud, taiko, thunderCrack, thunderRumble, wind, type GodVocal,
} from '../synth/anatolian';
import { midiToHz } from '../timing';
import { TIER_KEY, TIER_UP_PRE, type WinTier } from '../win-tiers';
import { STORM_MULTIPLIER_CLASSES, STORM_TONIC, type StormMultiplierClass } from '../storm-tiers';
import type { SfxDef, SfxLevel } from './cascade';

const hz = midiToHz;
const sized = (ctx: VoiceCtx, seconds: number) => stereo(Math.ceil(seconds * ctx.sr));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
function st(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1) { addStereo(dst, src, Math.round(at), gain, pan, width); }

/** Fast exponential sine sweep with a sharp decay: the "zap" of a spark or an orb. */
function zap(ctx: VoiceCtx, f0: number, f1: number, dur: number, vel: number): Float32Array {
  const n = Math.ceil(dur * ctx.sr), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n, f = f0 * (f1 / f0) ** Math.sqrt(x);
    out[i] = sinCycles(ph) * vel * Math.min(1, i / 30) * (1 - x) ** 2;
    ph += f / ctx.sr;
  }
  return out;
}

/** Rising glassy glide (orb charging / flying). */
function riseGlide(ctx: VoiceCtx, f0: number, f1: number, dur: number, vel: number): Float32Array {
  const n = Math.ceil(dur * ctx.sr), out = new Float32Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n, f = f0 * (f1 / f0) ** (x * x);
    const env = Math.min(1, i / (0.02 * ctx.sr)) * (x < 0.8 ? 0.3 + 0.7 * x / 0.8 : (1 - x) / 0.2);
    out[i] = (sinCycles(a) + 0.35 * sinCycles(b)) * env * vel;
    a += f / ctx.sr; b += (f * 2.004) / ctx.sr;
  }
  return out;
}

/** Male choir chord ("oh"), synthesised at half rate (formants < 3.5 kHz) and interpolated up into `out`. */
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.7) {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release, vowel: 'oh', voices: 3 });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}

/** A horn line: [midi, start s, length s, velocity] per note, spread slightly in the stereo field. */
function horns(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, opts: { attack?: number; bright?: number; pan?: number } = {}) {
  notes.forEach(([n, t, d, v], i) => mono(out, horn(ctx, hz(n), v, d, { attack: opts.attack ?? 0.03, bright: opts.bright ?? 1.1 }), t * ctx.sr, gain * 1.6, (opts.pan ?? 0) + (i % 2 ? 0.12 : -0.12)));
}

/** Horn chord stab: every note at once, slightly spread. */
function hornStab(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, held: number, vel: number, gain: number, attack = 0.02) {
  notes.forEach((n, i) => mono(out, horn(ctx, hz(n), vel, held, { attack, bright: 1.2 }), at, (1.6 * gain) / Math.sqrt(notes.length), notes.length > 1 ? (i / (notes.length - 1)) * 0.8 - 0.4 : 0));
}

const SPARKS = [93, 98, 100, 105];

export const STORM_SFX: SfxDef[] = [
  {
    // spin start: a stone wheel turning (low grind + whoosh) set off by a bronze lever tick
    id: 'spin', variations: 4, level: 'light', send: 0.12, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.75);
      st(out, whoosh(ctx, 0.55 + v * 0.03, 180, 1500 + v * 120, 1, -0.4, 0.4, 0.5), 0, 0.9);
      mono(out, noiseHit(ctx, 0.5, 240 + v * 20, 1.2, 0.08, 0.35, 60, 900), 0, 1);
      mono(out, davulRim(ctx, 0.5), 0, 0.5, 0.2);
      mono(out, bronze(ctx, hz(93 + (v % 2 ? 0 : -2)), 0.4, 0.15), 0.004 * ctx.sr, 0.35, -0.2);
      return out;
    },
  },
  {
    // column land: a stone block thud (the runtime steps the pitch per column)
    id: 'land', variations: 4, level: 'light', send: 0.06, jitter: [25, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.45);
      mono(out, softKnee(stoneThud(ctx, 0.95, 1 + v * 0.06), 9, ctx.sr, 0.15), 0, 1);
      mono(out, noiseHit(ctx, 0.35, 1150 + v * 60, 1, 0.0005, 0.02, 400, 5000), 0, 0.8);
      for (let k = 0; k < 6; k++) mono(out, noiseHit(ctx, 0.08, 3000 + ctx.rng() * 3000, 1.6, 0.0003, 0.005, 1800, 9000), (0.02 + ctx.rng() * 0.12) * ctx.sr, 1, ctx.rng() - 0.5);
      return out;
    },
  },
  {
    // symbol land tick: a small stone tap
    id: 'tick', variations: 4, level: 'ui', send: 0.04, jitter: [60, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.12);
      mono(out, softKnee(stoneThud(ctx, 0.5, 0.42 + v * 0.03), 8, ctx.sr, 0.06), 0, 1, (v - 1.5) * 0.15);
      return out;
    },
  },
  {
    // win highlight: a bağlama strum on A–D fourths, a bronze ring and a few sparks
    id: 'win', variations: 3, level: 'medium', send: 0.3, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      const strum = [[57, 62, 69, 74], [57, 62, 67, 74], [62, 69, 74, 81]][v]!;
      strum.forEach((n, i) => mono(out, baglama(ctx, hz(n), 0.8, 0.8, 0.8), i * 0.018 * ctx.sr, 0.45, i * 0.2 - 0.3));
      mono(out, bronze(ctx, hz(81), 0.6, 0.6), 0.01 * ctx.sr, 0.35, 0.25);
      st(out, sparkles(ctx, 0.5, 30, SPARKS, 0.6, 'decay'), 0.02 * ctx.sr, 0.6);
      return out;
    },
  },
  ...(['shatter-s', 'shatter-m', 'shatter-l'] as const).map((id, size): SfxDef => ({
    // symbol shatter: stone crack + bronze ring + sparks; larger clusters crack harder and ring lower
    id, variations: 3, level: size === 2 ? 'major' : size === 1 ? 'medium' : 'light', send: 0.14 + size * 0.04, jitter: [35, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.8 + size * 0.2);
      st(out, stoneShatter(ctx, 0.95, [8, 13, 20][size]!, [0.25, 0.35, 0.45][size]!), 0, 1);
      mono(out, bronze(ctx, hz([86, 81, 74][size]! + (v === 1 ? 5 : 0)), 0.6, 0.35), 0.004 * ctx.sr, 0.4, (v - 1) * 0.3);
      if (size >= 1) mono(out, zap(ctx, 3400, 900, 0.08, 0.3), 0.002 * ctx.sr, 1);
      if (size === 2) mono(out, taiko(ctx, 0.5, 62), 0, 0.5);
      st(out, sparkles(ctx, 0.25 + size * 0.12, 30 + size * 25, SPARKS, 0.7, 'decay'), 0.015 * ctx.sr, 0.7);
      return out;
    },
  })),
  {
    // tumble: stones falling into place — a low whoosh and a scatter of pebble knocks
    id: 'tumble', variations: 3, level: 'light', send: 0.1, jitter: [40, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.55);
      st(out, whoosh(ctx, 0.36, 220, 1300 + v * 120, 0.8, 0.3, -0.3, 0.25), 0, 1);
      for (let i = 0; i < 6; i++) mono(out, stoneThud(ctx, 0.35, 0.5 + ctx.rng() * 0.3), (0.08 + ctx.rng() * 0.25) * ctx.sr, 0.8, ctx.rng() - 0.5);
      return out;
    },
  },
  {
    // count-up tick: a small bronze tick (the runtime raises its pitch as the count climbs)
    id: 'coin', variations: 4, level: 'ui', send: 0.08, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.25);
      mono(out, bronze(ctx, hz(93) * (1 + v * 0.004), 0.7, 0.07), 0, 1, (v - 1.5) * 0.12);
      mono(out, noiseHit(ctx, 0.12, 5200, 1.5, 0.0003, 0.004, 3000, 9000), 0, 1);
      return out;
    },
  },
  {
    // button click: a dry bronze tick with a little body
    id: 'click', variations: 4, level: 'ui', send: 0.02, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.12);
      mono(out, bronze(ctx, 1240 + v * 45, 0.6, 0.03), 0, 1);
      mono(out, davulRim(ctx, 0.35), 0, 0.5);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0.08, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.4);
      const pair = dir === 0 ? [81, 86] : [86, 81];
      pair.forEach((n, i) => mono(out, bronze(ctx, hz(n + (v === 2 ? -2 : 0)), 0.6, 0.12), i * 0.055 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      return out;
    },
  })),
  {
    // denied: two dull stone knocks falling a fourth
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      [0, 1].forEach(i => mono(out, softKnee(stoneThud(ctx, 0.8, (1.1 + i * 0.35) * (1 + v * 0.05)), 9, ctx.sr, 0.15), i * 0.12 * ctx.sr, 0.9));
      mono(out, bronze(ctx, hz(57 - v), 0.4, 0.2), 0.12 * ctx.sr, 0.3);
      return out;
    },
  },
  {
    // count-up finish: bronze bells on A and D with a soft taiko and sparks
    id: 'ding', variations: 3, level: 'medium', send: 0.3, jitter: [6, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2);
      mono(out, bronze(ctx, hz(81), 0.85, 1), 0, 0.55);
      mono(out, bronze(ctx, hz(v === 2 ? 86 : 74), 0.6, 1), 0.006 * ctx.sr, 0.35, -0.2);
      mono(out, taiko(ctx, 0.45, 55), 0, 0.5);
      st(out, sparkles(ctx, 0.5, 40, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.6);
      return out;
    },
  },
  {
    // orb land: electric crackle + glassy hum (the runtime raises the pitch with the orb's class) + a soft stone set-down
    id: 'orb', variations: 3, level: 'medium', send: 0.26, jitter: [12, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.1);
      mono(out, sizzle(ctx, 0.4 + v * 0.05, 0.55, 380), 0, 0.7, (v - 1) * 0.2);
      mono(out, glassHum(ctx, hz(81), 0.95, 0.8), 0.005 * ctx.sr, 0.7);
      mono(out, zap(ctx, 2600 + v * 200, 700, 0.07, 0.35), 0, 1);
      mono(out, stoneThud(ctx, 0.35, 0.9), 0, 0.5);
      return out;
    },
  },
  {
    // orb charge / fly to the multiplier meter: a rising glassy glide with a crackling trail
    id: 'orb-fly', variations: 3, level: 'light', send: 0.22, jitter: [25, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.75);
      st(out, whoosh(ctx, 0.5, 600, 3200, 0.7, -0.4, 0.4, 0.8), 0, 0.7);
      mono(out, riseGlide(ctx, hz(69 + (v === 1 ? 5 : 0)), hz(93 + (v === 2 ? 2 : 0)), 0.5, 0.35), 0.02 * ctx.sr, 1);
      mono(out, sizzle(ctx, 0.55, 0.3, 300), 0, 0.6);
      return out;
    },
  },
  {
    // orb arrives at the meter: a small crack, a glass ping and a bronze answer
    id: 'orb-arrive', variations: 3, level: 'medium', send: 0.26, jitter: [20, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.2);
      st(out, thunderCrack(ctx, 0.45, 0.25, 0.7), 0, 0.6);
      mono(out, glassHum(ctx, hz([86, 81, 88][v]!), 0.8, 0.8), 0.004 * ctx.sr, 0.6);
      mono(out, bronze(ctx, hz(74), 0.6, 0.5), 0.006 * ctx.sr, 0.35, 0.2);
      return out;
    },
  },
  {
    // lightning strike from the god to a cell: crack + boom + a sizzling tail
    id: 'lightning', variations: 3, level: 'major', send: 0.28, jitter: [15, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      st(out, thunderCrack(ctx, 1, 0.4 + v * 0.08, 1.4), 0, 1);
      mono(out, sizzle(ctx, 0.9, 0.6, 520), 0.03 * ctx.sr, 0.7, (v - 1) * 0.3);
      mono(out, zap(ctx, 4200, 600, 0.12, 0.35), 0, 0.8);
      return out;
    },
  },
  {
    // total multiplier increase: a punchy thunder hit — taiko, close boom and a short D–A horn stab
    id: 'total-mult', variations: 3, level: 'major', send: 0.3, jitter: [15, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8);
      mono(out, taiko(ctx, 1, 52 + v * 2), 0, 0.6);
      st(out, thunderCrack(ctx, 0.9, 0.6, 1.3), 0, 0.8);
      hornStab(ctx, out, [[50, 57, 62], [50, 57, 62, 69], [45, 57, 62]][v]!, 0.01 * ctx.sr, 0.28, 0.95, 0.55);
      st(out, crash(ctx, 0.35, 1.2), 0, 0.35);
      return out;
    },
  },
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    // scatter land 1..6: an ascending bronze bell over a taiko that grows; thunder from 4, choir from 5
    id: `scatter${n}`, variations: 3, level: n >= 4 ? 'major' : 'medium', send: 0.3, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.4 + (n >= 4 ? 0.6 : 0));
      const note = [69, 70, 74, 79, 81, 86][n - 1]!;
      mono(out, bronze(ctx, hz(note), 0.9, 0.9), 0, 0.6, (v - 1) * 0.2);
      mono(out, bronze(ctx, hz(note + 12), 0.4, 0.5), 0.004 * ctx.sr, 0.25, (1 - v) * 0.2);
      mono(out, taiko(ctx, 0.35 + n * 0.1, 56 - n), 0, 0.45);
      if (n >= 3) mono(out, baglama(ctx, hz(note - 12), 0.7, 0.5, 0.8), 0.012 * ctx.sr, 0.35);
      if (n >= 4) st(out, thunderRumble(ctx, 1.6, 0.6 + (n - 4) * 0.15, 0.6), 0.02 * ctx.sr, 0.3);
      if (n >= 5) choirInto(ctx, out, [note - 24, note - 17, note - 12], 0, 0.75, 0.6, 0.5, 0.05);
      st(out, sparkles(ctx, 0.3 + n * 0.06, 20 + n * 8, SPARKS, 0.5, 'decay'), 0.03 * ctx.sr, 0.5);
      return out;
    },
  })),
  {
    // tease riser at 3 scatters: wind rising, a rumble building and a davul heartbeat that quickens
    id: 'tease', variations: 3, level: 'medium', send: 0.25, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.5);
      st(out, riser(ctx, 3.2, 160 + v * 15, 2600, 0.8, 0.25), 0, 0.8);
      const w = wind(ctx, 3.3, 1, false);
      for (let i = 0; i < w.l.length; i++) { const x = i / w.l.length; w.l[i]! *= x * x; w.r[i]! *= x * x; }
      st(out, w, 0, 0.7);
      st(out, thunderRumble(ctx, 3.3, 0.5, 0.8), 0.3 * ctx.sr, 0.6);
      let t = 0.05, gap = 0.55;
      while (t < 3.05) { mono(out, davul(ctx, 0.35 + t * 0.15, 54), t * ctx.sr, 0.8); t += gap; gap = Math.max(0.2, gap * 0.87); }
      return out;
    },
  },
  {
    // feature trigger: the sky splits — big crack, taiko, horn swell on D, male choir and a bronze gong
    id: 'trigger', variations: 3, level: 'major', send: 0.35, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3);
      st(out, thunderCrack(ctx, 1, 0.9, 2), 0, 1);
      mono(out, taiko(ctx, 1, 48), 0, 0.6);
      mono(out, bronze(ctx, hz(38), 0.9, 1.6), 0.01 * ctx.sr, 0.45, -0.2);
      hornStab(ctx, out, [50, 57, 62, 66], 0.02 * ctx.sr, 1.2, 0.9, 0.6, 0.18 + v * 0.03);
      choirInto(ctx, out, [50, 57, 62, 66], 0.05 * ctx.sr, 0.85, 1.1, 0.5, 0.25);
      st(out, sparkles(ctx, 1.2, 40, SPARKS, 0.6, 'decay'), 0.03 * ctx.sr, 0.6);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    // autoplay on/off: a quick bağlama run up (on) or down (off) with a whoosh
    id, variations: 3, level: 'light', send: 0.15, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      const notes = [69, 74, 79, 81];
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => mono(out, baglama(ctx, hz(n), 0.75, 0.15, 0.8, { sympathy: 0.06 }), i * (0.05 + v * 0.005) * ctx.sr, 0.6, (i - 1.5) * 0.2));
      st(out, whoosh(ctx, 0.3, 500, 2200, 0.25, dir ? 0.4 : -0.4, dir ? -0.4 : 0.4), 0, 0.6);
      return out;
    },
  })),
  ...(['hum', 'grunt', 'laugh'] as GodVocal[]).map((kind): SfxDef => ({
    // character vocalisation placeholders (non-verbal); replaced by recorded lines when they exist
    id: `vo-${kind}`, variations: 3, level: kind === 'hum' ? 'medium' : 'major', send: 0.3, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const voice = godVocal(ctx, kind, v, 1);
      const out = sized(ctx, voice.length / ctx.sr + 0.4);
      mono(out, voice, 0, 1);
      // the god's chest: a soft rumble under the laugh and the grunt
      if (kind !== 'hum') st(out, thunderRumble(ctx, Math.min(1.6, voice.length / ctx.sr + 0.3), 0.35, 0.85), 0, 0.25);
      return out;
    },
  })),
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key: A3 + the shared key ladder (A → B → C# → E → F#), voiced in horn register. */
const tierTonic = (t: TierOrMax) => STORM_TONIC + TIER_KEY[t];
const rankOf = (t: TierOrMax) => (t === 'max' ? 5 : t);
/** Hicaz-major colour: the tonic triad and the half-step-above appoggiatura (bII) that resolves into it. */
const triad = (root: number) => [root, root + 4, root + 7];

/**
 * Tier-up transition into tier `t`: a rising whoosh + wind for TIER_UP_PRE seconds, then the hit —
 * lightning crack and boom, taiko on the new tonic, horn stab on the tonic triad, bronze bell; tier 4 and
 * max add the male choir; max adds a gong. The runtime aligns the hit to the celebration beat.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.32, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(ctx, 2.8), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = rankOf(t);
    st(out, whoosh(ctx, TIER_UP_PRE + 0.06, 220, 3400, 0.9, v ? 0.5 : -0.5, v ? -0.3 : 0.3, 0.88), 0, 1);
    st(out, riser(ctx, TIER_UP_PRE, 400, 3200, 0.5, 0.3), 0, 0.6);
    st(out, thunderCrack(ctx, 0.9 + rank * 0.03, 0.8 + rank * 0.1, 1.8), hit, 0.9);
    mono(out, taiko(ctx, 1, hz(root - 24)), hit, 0.5);
    hornStab(ctx, out, triad(root - 12), hit, 0.4, 0.9, 0.6);
    mono(out, bronze(ctx, hz(root + 12), 0.7, 0.9), hit + 0.003 * ctx.sr, 0.35, 0.25);
    if (rank >= 4) choirInto(ctx, out, [root - 12, root - 5, root], hit, 0.9, 0.6, 0.6, 0.05, 0.5);
    if (t === 'max') mono(out, bronze(ctx, hz(root - 24), 0.9, 1.8), hit, 0.5, -0.25);
    st(out, sparkles(ctx, 0.8, 40 + rank * 12, SPARKS, 0.7, 'decay'), hit + 0.01 * ctx.sr, 0.6);
    return out;
  },
});

/**
 * Count-up landing ("the count stops here"), sized by tier: 1 taiko + bronze bells on the tonic;
 * 2 + lightning crack and cymbal; 3 + horn stab; 4 + male choir swell; max + gong and a second bell.
 */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: rankOf(t) >= 3 ? 'hero' : 'major', send: 0.32, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = rankOf(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized(ctx, 2 + rank * 0.4);
    mono(out, taiko(ctx, 0.9 + rank * 0.02, hz(root - 24)), 0, 0.6);
    if (rank >= 2) { st(out, thunderCrack(ctx, 0.7 + rank * 0.05, 0.8, 1.6), 0, 0.7); st(out, crash(ctx, 0.35 + rank * 0.05, 1.4 + rank * 0.2), 0, 0.4); }
    const bells = [root + 12, root + 19, root + 24].slice(0, 1 + Math.min(2, rank));
    bells.forEach((n, i) => mono(out, bronze(ctx, hz(n), 0.8, 1), (0.003 + i * 0.012 + v * 0.004) * sr, 0.4, i * 0.3 - 0.3));
    if (rank >= 3) hornStab(ctx, out, triad(root - 12), 0, 0.55, 0.95, 0.6);
    if (rank >= 4) choirInto(ctx, out, [root - 12, root - 8, root - 5, root], 0, 0.95, 0.55 + (rank - 4) * 0.4, 0.65, 0.06);
    if (rank >= 5) { mono(out, bronze(ctx, hz(root - 24), 1, 2), 0, 0.5, -0.2); mono(out, bronze(ctx, hz(root + 24), 0.6, 1), 0.25 * sr, 0.3, 0.3); }
    st(out, sparkles(ctx, 0.7 + rank * 0.2, 35 + rank * 15, SPARKS, 0.7, 'decay'), 0.01 * sr, 0.6);
    return out;
  },
});

/**
 * Callout recipe per class. Each has its own horn motif (MIDI, beats of `step` s) so the classes are told
 * apart instantly, plus the number of lightning strikes, the rumble length and the layers it adds.
 *   x2   a single spark-crack and a quick rising fourth A→D
 *   x10  crack + rumble, open fifths D–A–D
 *   x25  + taiko and the Hicaz turn A–E–A–Bb–A with a short choir "oh"
 *   x50  two strikes, D major arpeggio with the Eb→D turn, choir swell
 *   x100 big boom, A major fanfare up two octaves, full choir, gong, taiko roll
 *   x250 two-phrase fanfare (Bb–A | C#–D–E–A) after two strikes, long choir, gong
 *   x500 three strikes climbing, accelerating taiko roll, D fanfare from D2 to D4 with the Eb–D turn, gong + bell
 */
const CALLOUT: Record<StormMultiplierClass, { motif: number[]; step: number; strikes: number[]; rumble: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [57, 62], step: 0.08, strikes: [0], rumble: 0, seconds: 1.0, level: 'medium' },
  x10: { motif: [50, 57, 62], step: 0.11, strikes: [0], rumble: 1.3, seconds: 1.6, level: 'major' },
  x25: { motif: [45, 52, 57, 58, 57], step: 0.1, strikes: [0], rumble: 1.7, seconds: 2.1, level: 'major' },
  x50: { motif: [50, 54, 57, 62, 63, 62], step: 0.1, strikes: [0, 0.22], rumble: 2.1, seconds: 2.6, level: 'hero' },
  x100: { motif: [45, 49, 52, 57, 61, 64, 69], step: 0.11, strikes: [0], rumble: 2.6, seconds: 3.2, level: 'hero' },
  x250: { motif: [46, 45, 49, 50, 52, 57, 61, 64], step: 0.12, strikes: [0, 0.45], rumble: 3.1, seconds: 3.8, level: 'hero' },
  x500: { motif: [38, 45, 50, 54, 57, 62, 63, 62], step: 0.13, strikes: [0, 0.3, 0.6], rumble: 3.6, seconds: 4.5, level: 'hero' },
};

/** Applied-multiplier callouts with lightning-and-thunder character: crack + rumble + rising horns + choir. */
const callout = (c: StormMultiplierClass): SfxDef => ({
  id: `callout-${c}`, variations: STORM_MULTIPLIER_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.3, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = STORM_MULTIPLIER_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(ctx, spec.seconds);
    const start = rank >= 3 ? 0.12 : 0.05;
    const last = start + (spec.motif.length - 1) * spec.step;
    // the strikes: a crack (and from x10 a boom) on each, a little brighter each time
    spec.strikes.forEach((t, i) => st(out, thunderCrack(ctx, 0.6 + rank * 0.06 + i * 0.05, rank === 0 ? 0.2 : 0.6 + rank * 0.1, 1.2 + rank * 0.15), t * sr, 0.9, (i - (spec.strikes.length - 1) / 2) * 0.35));
    if (rank === 0) mono(out, sizzle(ctx, 0.35, 0.5, 450), 0.01 * sr, 0.6, v ? 0.2 : -0.2);
    if (spec.rumble > 0) st(out, thunderRumble(ctx, spec.rumble, 0.6 + rank * 0.05, 0.35), 0.04 * sr, 0.3);
    if (rank >= 2) mono(out, taiko(ctx, 0.9, 46), 0, 0.5);
    if (rank >= 4) for (let k = 0; k < 4 + (rank - 4) * 2; k++) mono(out, taiko(ctx, 0.5 + 0.1 * k, 58), (0.3 + k * (rank === 6 ? 0.16 - k * 0.01 : 0.15)) * sr, 0.35);
    // the horn motif rising into the final note, which is held
    spec.motif.forEach((n, i) => {
      const final = i === spec.motif.length - 1, at = start + i * spec.step;
      const vel = 0.7 + 0.3 * (i / Math.max(1, spec.motif.length - 1));
      mono(out, horn(ctx, hz(n), vel, final ? 0.45 + rank * 0.12 : spec.step * 0.95, { attack: 0.02, bright: 1.3 }), at * sr, 1.1, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.4);
      if (rank >= 3) mono(out, horn(ctx, hz(n + 12), vel * 0.8, final ? 0.45 + rank * 0.12 : spec.step * 0.95, { attack: 0.02, bright: 1.1 }), at * sr, 0.6, 0.2);
    });
    const finalAt = last * sr, top = spec.motif[spec.motif.length - 1]!;
    if (rank >= 1) mono(out, bronze(ctx, hz(top + 24), 0.6, 0.8), finalAt, 0.3, 0.25);
    if (rank >= 2) choirInto(ctx, out, rank >= 4 ? [top - 12, top - 8, top - 5, top] : [top - 12, top - 5, top], rank >= 4 ? start * sr : finalAt, 0.9, rank >= 4 ? 0.9 + (rank - 4) * 0.4 : 0.45, 0.55, rank >= 4 ? 0.35 : 0.04);
    if (rank >= 4) mono(out, bronze(ctx, hz(top - 24), 0.9, 1.6), finalAt, 0.45, -0.25);
    if (rank >= 6) mono(out, bronze(ctx, hz(top + 12), 0.8, 1.2), finalAt + 0.15 * sr, 0.35, 0.3);
    st(out, sparkles(ctx, 0.4 + rank * 0.15, 25 + rank * 12, SPARKS, 0.6, 'decay'), finalAt, 0.6);
    return out;
  },
});

STORM_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...STORM_MULTIPLIER_CLASSES.map(callout),
);

export const STORM_SFX_IDS = STORM_SFX.map(s => s.id);
