/**
 * Cezeri: Zamanın Çarkları sound effects — original designs built from the shared synth toolkit and the Cezeri voices in
 * synth/cezeri.ts. Frequent effects render 3–4 variations; the hub-step ladder renders 2 per step (each step is its own
 * pitch, so the ladder itself is the variation); rare celebration moments (tier-ups, landings, callouts, the full chain)
 * 1–2. The runtime adds per-play pitch/gain micro-variation on top. Materials: brass gears (clanks, pawl-and-ratchet
 * clicks, the escapement, the whirr of a gear train), clock-gong chime rods, the santur, the water organ, naqqara and kös
 * kettledrums, hand cymbals, water (drips into brass bowls, a vessel filling, the reservoir float), the falcon's wings and
 * water whistle, and a wordless male voice.
 * Pitched material sits on the C "suspended" ladder (C D G A, cezeri-tiers.ts) which is consonant with the base theme
 * (C Nikriz), the feature theme (C Çargah) and the Dişli Kilidi tension bed (C–G–D); the hub steps climb the Nikriz scale
 * (the runtime bends them onto Çargah in the feature) and tier stingers use the tier's own key.
 *
 * Assembled at runtime (cezeri-sound.ts): a turning ring = `ring-whirr` (rate and level follow the ring's speed) +
 * one `ratchet` click per slice that passes (cezeri-tiers.ts ratchetPlan) + `ring-stop`; a spoke win = `beam-sweep` +
 * one `beam-1/2/3` chime per slice (beamPlan); the respin chain = `lock` + `pin` per held slice, `hub-step-k`, `respin`
 * and the two tension-bed loops (scores/cezeri.ts chainBed / chainBedHi), ending on `chain-end` / `chain-end-big` / `chain-full`.
 */
import { addMono, addStereo, addStereoUpsampled, stereo, type Stereo } from '../synth/dsp';
import { bell, choirChord, kick, noiseHit, riser, sparkles, vox, whoosh, type VoiceCtx } from '../synth/instruments';
import { bubble, bubbles } from '../synth/ebru';
import { birdWhistle, chimeRod, drip, escapement, gearClank, gearWhirr, handCymbal, kos, naqqara, pipeFast, pour, ratchet, santur as santur4, wings, type SanturOptions } from '../synth/cezeri';
import { softKnee } from '../synth/anatolian';
import { midiToHz } from '../timing';
import { MULTIPLIER_CLASSES, TIER_KEY, TIER_UP_PRE, type MultiplierClass, type WinTier } from '../win-tiers';
import { CEZERI_MAX_RESPINS, CEZERI_TONIC, HUB_STEPS_NIKRIZ, reservoirSemitones, vesselSemitones, type CezeriVocal } from '../cezeri-tiers';
import type { SfxDef, SfxLevel } from './cascade';

const hz = midiToHz;
/** Effects use a two-wire santur course (the four-wire chorus is a music detail) at half the cost. */
const santur = (ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: SanturOptions = {}) => santur4(ctx, freq, vel, held, bright, { courses: 2, ...opts });
const sized = (ctx: VoiceCtx, seconds: number) => stereo(Math.ceil(seconds * ctx.sr));
function mono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) { addMono(dst, src, Math.round(at), gain, pan); }
function st(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1) { addStereo(dst, src, Math.round(at), gain, pan, width); }

/** C-ladder sparkle notes (C6 D6 G6 A6 C7). */
const SPARKS = [84, 86, 91, 93, 96];
/** Wordless male "ah" choir chord, synthesised at half rate (formants < 3.5 kHz) and interpolated up into `out`. */
function choirInto(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, vel: number, held: number, gain: number, attack: number, release = 0.8) {
  const low = choirChord({ sr: ctx.sr / 2, rng: ctx.rng }, notes.map(hz), vel, held, { attack, release, vowel: 'ah', voices: 3 });
  addStereoUpsampled(out, low, 2, Math.round(at), gain);
}
/** Santur strikes [midi, start s, held s, velocity], spread a little. */
function strikes(ctx: VoiceCtx, out: Stereo, notes: [number, number, number, number][], gain: number, bright = 1, pan = 0) {
  notes.forEach(([n, t, d, v], i) => mono(out, santur(ctx, hz(n), v, d, bright, { ring: 0.35 }), t * ctx.sr, gain, pan + (i % 2 ? 0.15 : -0.15)));
}
/** Chime rods [midi, start s, velocity]. */
function chimes(ctx: VoiceCtx, out: Stereo, notes: [number, number, number][], gain: number, length = 1, spread = 0.5) {
  notes.forEach(([n, t, v], i) => mono(out, chimeRod(ctx, hz(n), v, length), t * ctx.sr, gain, notes.length > 1 ? (i / (notes.length - 1)) * spread * 2 - spread : 0));
}
/** A water-organ chord (half-rate flue pipes). */
function organ(ctx: VoiceCtx, out: Stereo, notes: number[], at: number, held: number, vel: number, gain: number, attack = 0.07) {
  notes.forEach((n, i) => mono(out, pipeFast(ctx, hz(n), vel, held, { rank: 'organ', attack, release: 0.35 }), at, gain / Math.sqrt(notes.length), notes.length > 1 ? (i / (notes.length - 1)) * 0.8 - 0.4 : 0));
}
const fifth = (root: number) => [root, root + 7, root + 12];
const major = (root: number) => [root, root + 4, root + 7];

const hubLevel = (k: number): SfxLevel => (k >= CEZERI_MAX_RESPINS ? 'hero' : k >= 7 ? 'major' : k >= 4 ? 'medium' : 'light');

export const CEZERI_SFX: SfxDef[] = [
  {
    // spin start: the crank winds the mechanism (an accelerating run of pawl clicks), a gush of water and a soft santur C–G
    id: 'spin', variations: 4, level: 'light', send: 0.16, jitter: [30, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      let t = 0, gap = 0.07;
      for (let k = 0; k < 7; k++) { mono(out, ratchet(ctx, 0.55 + k * 0.05, 1.1), t * ctx.sr, 0.6, -0.3 + k * 0.1); t += gap; gap *= 0.8; }
      st(out, whoosh(ctx, 0.5 + v * 0.03, 220, 1500 + v * 120, 0.7, -0.5, 0.5, 0.55), 0.05 * ctx.sr, 0.6);
      st(out, bubbles(ctx, 0.35, 6, 0.45, 500, 1500), 0.12 * ctx.sr, 0.45);
      strikes(ctx, out, [[60 + (v % 2 ? 7 : 0), 0.08, 0.3, 0.5], [67 + (v === 2 ? 5 : 0), 0.11, 0.3, 0.45]], 0.4, 0.8);
      return out;
    },
  },
  {
    // one pawl click per slice that passes (scheduled by the runtime along the ring's easing; the rate sets the wheel size)
    id: 'ratchet', variations: 4, level: 'ui', send: 0, jitter: [45, 1.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.08);
      mono(out, softKnee(ratchet(ctx, 0.9, 0.95 + v * 0.04), 9, ctx.sr, 0.02), 0, 1, (v - 1.5) * 0.1);
      return out;
    },
  },
  {
    // a ring locks onto its stop: the brass wheel thuds into the detent, the pawl falls in
    id: 'ring-stop', variations: 4, level: 'light', send: 0.14, jitter: [25, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.7);
      mono(out, softKnee(gearClank(ctx, 0.75, 1.3 + v * 0.06, false), 10, ctx.sr, 0.1), 0, 0.7);
      mono(out, kick(ctx, 0.6, 170, 62, 0.012, 0.16, 0.2, 1.2), 0, 0.5);
      mono(out, escapement(ctx, 0.8, 'tock'), 0.018 * ctx.sr, 0.45, 0.15);
      return out;
    },
  },
  {
    // the meshing gear train (flat level; the runtime loops it and bends its rate and level along the ring's speed)
    id: 'ring-whirr', variations: 3, level: 'light', send: 0, jitter: [0, 0.5], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 2.5);
      st(out, gearWhirr(ctx, 2.4, 0.9, 64 + v * 6), 0, 1);
      return out;
    },
  },
  /* ---------------- the hub ---------------- */
  ...(['hub-x1', 'hub-x2', 'hub-x3', 'hub-x5', 'hub-x10'] as const).map((id, rank): SfxDef => ({
    // the hub dial settles on its value: the escapement catch, the counter drum flip and a chime on C that grows with the value
    id, variations: 3, level: rank >= 4 ? 'major' : rank >= 2 ? 'medium' : 'light', send: 0.24 + rank * 0.03, jitter: [10, 0.8], core: rank <= 2,
    build: (ctx, v) => {
      const out = sized(ctx, 1.2 + rank * 0.35), sr = ctx.sr;
      mono(out, escapement(ctx, 0.9, 'tick'), 0, 0.55);
      mono(out, ratchet(ctx, 0.8, 0.7), 0.012 * sr, 0.45, 0.2);
      mono(out, gearClank(ctx, 0.4 + rank * 0.1, 2.2 - rank * 0.2, false), 0.01 * sr, 0.3 + rank * 0.05);
      chimes(ctx, out, [[72, 0.006, 0.8], ...(rank >= 1 ? [[79, 0.03, 0.6] as [number, number, number]] : []), ...(rank >= 2 ? [[84, 0.06, 0.6] as [number, number, number]] : []), ...(rank >= 3 ? [[91, 0.1, 0.55] as [number, number, number]] : [])], 0.5, 0.6 + rank * 0.15);
      if (rank >= 2) strikes(ctx, out, [[60, 0.02, 0.4, 0.7], [67, 0.05, 0.4, 0.65], ...(rank >= 3 ? [[72, 0.08, 0.5, 0.65], [74, 0.11, 0.5, 0.6]] as [number, number, number, number][] : [])], 0.35, 1.1);
      if (rank >= 3) mono(out, kos(ctx, 0.5 + rank * 0.1), 0, 0.45);
      if (rank >= 4) {
        mono(out, handCymbal(ctx, 0.75, 0.8), 0.01 * sr, 0.3, 0.3);
        organ(ctx, out, [48, 55, 60, 67], 0.02 * sr, 0.8, 0.7, 0.45);
        choirInto(ctx, out, [48, 55, 60], 0.02 * sr, 0.8, 0.7, 0.4, 0.06);
        st(out, sparkles(ctx, 0.7, 40, SPARKS, 0.55, 'decay'), 0.05 * sr, 0.5);
      }
      if (v === 2) mono(out, drip(ctx, hz(84), 0.3), 0.15 * sr, 0.25, -0.3);
      return out;
    },
  })),
  ...Array.from({ length: CEZERI_MAX_RESPINS }, (_, i): SfxDef => {
    const k = i + 1;
    return {
      // hub +1 on respin k: the escapement catch, the counter flip and a chime on the k-th Nikriz degree above C5; every step
      // adds a layer (santur 2, naqqara 3, the fifth 4, kös 5, cymbal 6, water organ 7, choir 8, bell 9, the full mechanism 10)
      id: `hub-step-${k}`, variations: 2, level: hubLevel(k), send: 0.26 + k * 0.012, jitter: [5, 0.5], core: k <= 2,
      build: (ctx, v) => {
        const sr = ctx.sr, p = 72 + HUB_STEPS_NIKRIZ[k]!, pc = HUB_STEPS_NIKRIZ[k]! % 12;
        const out = sized(ctx, 1 + k * 0.13);
        mono(out, escapement(ctx, 0.9, 'tick'), 0, 0.55);
        mono(out, ratchet(ctx, 0.85, 0.7), 0.012 * sr, 0.45, 0.2);
        mono(out, gearClank(ctx, 0.35 + k * 0.03, 2.4 - k * 0.08, false), 0.008 * sr, 0.3);
        mono(out, chimeRod(ctx, hz(p), 0.85, 0.55 + k * 0.05), 0.005 * sr, 0.55, v ? 0.12 : -0.12);
        if (k >= 2) mono(out, santur(ctx, hz(p - 12), 0.7, 0.2, 1.1, { ring: 0.4 }), 0.004 * sr, 0.35, v ? -0.2 : 0.2);
        if (k >= 3) mono(out, naqqara(ctx, 0.5 + 0.03 * k, 'tek', hz(48 + pc)), 0, 0.4, -0.25);
        if (k >= 4) mono(out, chimeRod(ctx, hz(p + 7), 0.6, 0.5), 0.03 * sr, 0.3, 0.3);
        if (k >= 5) mono(out, kos(ctx, 0.55 + 0.04 * k, hz(36 + pc)), 0, 0.45);
        if (k >= 6) mono(out, handCymbal(ctx, 0.5, 0.35, 540), 0.006 * sr, 0.25, 0.35);
        if (k >= 7) organ(ctx, out, [p - 24, p - 17, p - 12], 0.01 * sr, 0.3 + (k - 7) * 0.12, 0.75, 0.4, 0.03);
        if (k >= 8) choirInto(ctx, out, [p - 36 < 40 ? p - 24 : p - 36, p - 29 < 45 ? p - 17 : p - 29, p - 24], 0.01 * sr, 0.8, 0.35 + (k - 8) * 0.15, 0.4, 0.04, 0.5);
        if (k >= 9) { mono(out, bell(ctx, hz(p), 0.6), 0.02 * sr, 0.25, -0.3); st(out, sparkles(ctx, 0.5, 30, SPARKS, 0.5, 'decay'), 0.03 * sr, 0.4); }
        if (k >= CEZERI_MAX_RESPINS) {
          mono(out, handCymbal(ctx, 0.9, 1.1), 0.01 * sr, 0.35, -0.3);
          mono(out, kos(ctx, 0.9, hz(31 + pc)), 0.15 * sr, 0.4);
          mono(out, birdWhistle(ctx, hz(p + 12), hz(p + 19), 0.45, 0.6), 0.12 * sr, 0.25, 0.35);
        }
        return out;
      },
    };
  }),
  /* ---------------- the Dişli Kilidi ---------------- */
  {
    // the winning slices lock: a heavy brass wheel drops into mesh with its latch, a low kös on C and a short pawl run
    id: 'lock', variations: 3, level: 'medium', send: 0.22, jitter: [15, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.2), sr = ctx.sr;
      mono(out, softKnee(gearClank(ctx, 1, 1.2 + v * 0.08, true), 10, ctx.sr), 0, 0.85);
      mono(out, kos(ctx, 0.55, hz(36)), 0, 0.35);
      for (let k = 0; k < 3; k++) mono(out, ratchet(ctx, 0.6 - k * 0.1, 1.2), (0.07 + k * 0.035) * sr, 0.4, 0.2);
      mono(out, noiseHit(ctx, 0.5, 1800, 0.9, 0.0005, 0.06, 500, 7000), 0, 0.35);
      return out;
    },
  },
  {
    // one held slice pins in place: a small steel pin clicks home with a tiny high chime (the runtime staggers them)
    id: 'pin', variations: 4, level: 'light', send: 0.12, jitter: [40, 1.2], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.45);
      mono(out, ratchet(ctx, 0.85, 0.6 + v * 0.04), 0, 0.8, (v - 1.5) * 0.15);
      mono(out, chimeRod(ctx, hz([96, 91, 98, 93][v]!), 0.3, 0.2), 0.004 * ctx.sr, 0.3);
      return out;
    },
  },
  {
    // the rings re-wind under the held slices: a rising rush and a quickening pawl run (the runtime raises it per respin)
    id: 'respin', variations: 3, level: 'light', send: 0.14, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9), sr = ctx.sr;
      st(out, riser(ctx, 0.45, 300 + v * 30, 2600, 0.5, 0.3), 0, 0.5);
      st(out, whoosh(ctx, 0.5, 260, 1900, 0.6, v ? 0.4 : -0.4, v ? -0.4 : 0.4, 0.7), 0, 0.5);
      let t = 0.05, gap = 0.08;
      for (let k = 0; k < 6; k++) { mono(out, ratchet(ctx, 0.5 + k * 0.07, 1), t * sr, 0.55, 0.3 - k * 0.1); t += gap; gap *= 0.78; }
      return out;
    },
  },
  {
    // a short chain ends: the latch releases and an open fifth on C rings out (consonant with Nikriz and Çargah alike)
    id: 'chain-end', variations: 3, level: 'medium', send: 0.3, jitter: [10, 0.6], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1.8), sr = ctx.sr;
      mono(out, escapement(ctx, 0.8, 'tock'), 0, 0.5);
      mono(out, ratchet(ctx, 0.7, 1.4), 0.02 * sr, 0.45);
      strikes(ctx, out, fifth(48 + (v === 1 ? 12 : 0)).map((n, i) => [n, 0.04 + i * 0.035, 0.8, 0.75] as [number, number, number, number]), 0.45, 1);
      chimes(ctx, out, [[84, 0.06, 0.7], ...(v === 2 ? [[91, 0.1, 0.5] as [number, number, number]] : [])], 0.35, 0.8);
      return out;
    },
  },
  {
    // a chain of 3+ respins resolves: the latch, a rolled open fifth over two octaves, the water organ, chimes, kös and a soft cymbal
    id: 'chain-end-big', variations: 3, level: 'major', send: 0.34, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2.6), sr = ctx.sr;
      mono(out, gearClank(ctx, 0.7, 1.6, true), 0, 0.5);
      strikes(ctx, out, [36, 43, 48, 55, 60, 67, 72].map((n, i) => [n, 0.03 + i * 0.03, 1.2, 0.8] as [number, number, number, number]), 0.4, 1.1);
      organ(ctx, out, [48, 55, 60, 67], 0.05 * sr, 1, 0.75, 0.45, 0.05);
      chimes(ctx, out, [[84, 0.08, 0.8], [91, 0.11, 0.6], ...(v === 1 ? [[96, 0.14, 0.5] as [number, number, number]] : [])], 0.4, 1);
      mono(out, kos(ctx, 0.85), 0.03 * sr, 0.5);
      mono(out, handCymbal(ctx, 0.6, 0.7), 0.04 * sr, 0.25, 0.3);
      st(out, sparkles(ctx, 0.8, 35, SPARKS, 0.5, 'decay'), 0.08 * sr, 0.45);
      return out;
    },
  },
  {
    // the full chain (10 respins, or every slice held): the elephant clock strikes — three chime strikes, the kös twice, the cymbal, organ and choir swell, the water whistle
    id: 'chain-full', variations: 1, level: 'hero', send: 0.38, jitter: [5, 0.4], core: false, late: true,
    build: (ctx) => {
      const out = sized(ctx, 4.2), sr = ctx.sr;
      chimes(ctx, out, [[84, 0, 0.95], [91, 0.42, 0.9], [96, 0.84, 1]], 0.5, 1.4);
      mono(out, kos(ctx, 1), 0, 0.55); mono(out, kos(ctx, 1, hz(31)), 0.84 * sr, 0.55);
      mono(out, handCymbal(ctx, 1, 1.3), 0.84 * sr, 0.35, 0.3);
      mono(out, gearClank(ctx, 1, 1.8, true), 0.84 * sr, 0.45);
      organ(ctx, out, [36, 48, 55, 60, 67, 72], 0.84 * sr, 1.6, 0.8, 0.55, 0.12);
      choirInto(ctx, out, [48, 55, 60, 64], 0.84 * sr, 0.95, 1.4, 0.5, 0.15);
      strikes(ctx, out, [48, 55, 60, 64, 67, 72, 76, 79, 84].map((n, i) => [n, 0.84 + i * 0.035, 1.4, 0.85] as [number, number, number, number]), 0.4, 1.2);
      mono(out, birdWhistle(ctx, hz(91), hz(98), 0.5, 0.7), 1.1 * sr, 0.3, 0.35);
      mono(out, birdWhistle(ctx, hz(93), hz(100), 0.35, 0.6), 1.7 * sr, 0.25, -0.35);
      st(out, sparkles(ctx, 1.4, 50, SPARKS, 0.55, 'decay'), 0.85 * sr, 0.5);
      return out;
    },
  },
  /* ---------------- spoke wins ---------------- */
  ...([['beam-1', 72], ['beam-2', 84], ['beam-3', 96]] as const).map(([id, note]): SfxDef => ({
    // one beam chime (a chime rod and a santur strike on the same note); the runtime pitches it per ring along the ladder
    id, variations: 3, level: 'light', send: 0.22, jitter: [6, 0.8], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      mono(out, chimeRod(ctx, hz(note), 0.8, 0.7), 0, 0.6, (v - 1) * 0.15);
      mono(out, santur(ctx, hz(note - (note > 90 ? 12 : 0)), 0.55, 0.1, 1.2, { ring: 0.3 }), 0.002 * ctx.sr, 0.4);
      return out;
    },
  })),
  {
    // the light running out along the spoke: a quick airy rush and a shimmer on the C ladder
    id: 'beam-sweep', variations: 3, level: 'light', send: 0.3, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.9);
      st(out, whoosh(ctx, 0.32, 900 + v * 100, 4800, 0.5, -0.2, 0.2, 0.4), 0, 0.5);
      st(out, sparkles(ctx, 0.35, 40, SPARKS, 0.5, 'swell'), 0, 0.5);
      return out;
    },
  },
  {
    // the Altın Dişli (gear wild) in a win: a burst of meshing gears and a golden chime arpeggio C–G–C–G
    id: 'gear-wild', variations: 3, level: 'medium', send: 0.3, jitter: [12, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6), sr = ctx.sr;
      const w = gearWhirr(ctx, 0.45, 0.8, 110 + v * 10);
      for (let i = 0; i < w.l.length; i++) { const x = 1 - i / w.l.length; w.l[i]! *= x; w.r[i]! *= x; }
      st(out, w, 0, 0.8);
      mono(out, gearClank(ctx, 0.6, 0.9, false), 0, 0.35);
      chimes(ctx, out, [72, 79, 84, 91].map((n, i) => [n + (v === 1 ? 2 : 0), 0.04 + i * 0.05, 0.75] as [number, number, number]), 0.45, 0.8);
      st(out, sparkles(ctx, 0.6, 40, SPARKS, 0.55, 'decay'), 0.1 * sr, 0.45);
      return out;
    },
  },
  {
    // generic win highlight: a santur roll on the open C chord and a chime
    id: 'win', variations: 3, level: 'medium', send: 0.3, jitter: [20, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.6);
      const notes = [[60, 67, 72, 79], [60, 67, 74, 79], [67, 72, 79, 84]][v]!;
      strikes(ctx, out, notes.map((n, i) => [n, i * 0.03, 0.6, 0.75] as [number, number, number, number]), 0.45, 1.1);
      chimes(ctx, out, [[notes[3]! + 12, 0.09, 0.6]], 0.35, 0.7);
      st(out, sparkles(ctx, 0.45, 30, SPARKS, 0.5, 'decay'), 0.03 * ctx.sr, 0.45);
      return out;
    },
  },
  {
    // count-up tick: the escapement and a tiny chime (the runtime raises its pitch as the count climbs)
    id: 'coin', variations: 4, level: 'ui', send: 0, jitter: [15, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.3);
      mono(out, escapement(ctx, 0.7, 'tick'), 0, 0.5, (v - 1.5) * 0.12);
      mono(out, chimeRod(ctx, hz(96) * (1 + v * 0.004), 0.5, 0.12), 0, 0.7, (v - 1.5) * 0.12);
      return out;
    },
  },
  {
    // button click: a small lever and pawl
    id: 'click', variations: 4, level: 'ui', send: 0, jitter: [40, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.12);
      mono(out, ratchet(ctx, 0.85, 0.85 + v * 0.05), 0, 0.8);
      mono(out, escapement(ctx, 0.4, 'tock'), 0.006 * ctx.sr, 0.35);
      return out;
    },
  },
  ...(['bet-up', 'bet-down'] as const).map((id, dir): SfxDef => ({
    id, variations: 3, level: 'ui', send: 0, jitter: [20, 1], core: true,
    build: (ctx, v) => {
      const out = sized(ctx, 0.5);
      const pair = dir === 0 ? [84, 91] : [91, 84];
      pair.forEach((n, i) => mono(out, chimeRod(ctx, hz(n + (v === 2 ? 2 : 0)), 0.6, 0.18), i * 0.06 * ctx.sr, 0.6, i ? 0.15 : -0.15));
      mono(out, ratchet(ctx, 0.5, 1), 0, 0.3);
      return out;
    },
  })),
  {
    // denied: two muted gear clanks falling a fourth
    id: 'denied', variations: 3, level: 'light', send: 0.06, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 0.6);
      [0, 1].forEach(i => mono(out, gearClank(ctx, 0.7, (i ? 2 : 1.5) * (1 + v * 0.03), false), i * 0.14 * ctx.sr, 0.7));
      mono(out, naqqara(ctx, 0.5, 'dum', 98), 0.14 * ctx.sr, 0.35);
      return out;
    },
  },
  {
    // count-up finish: chime rods C–G, a santur roll on the open fifth, a kös and sparkles
    id: 'ding', variations: 3, level: 'medium', send: 0.32, jitter: [6, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2);
      chimes(ctx, out, [[84, 0, 0.85], [v === 2 ? 93 : 91, 0.01, 0.6]], 0.45, 1);
      strikes(ctx, out, [[48, 0, 0.8, 0.7], [55, 0.03, 0.8, 0.65], [60, 0.06, 0.8, 0.65]], 0.4, 0.9);
      mono(out, kos(ctx, 0.5), 0, 0.4);
      st(out, sparkles(ctx, 0.5, 40, SPARKS, 0.5, 'decay'), 0.02 * ctx.sr, 0.5);
      return out;
    },
  },
  /* ---------------- feature and extended ---------------- */
  ...[1, 2, 3, 4, 5, 6].map((n): SfxDef => ({
    // vessel (scatter) n lands: a drop falls into the brass vessel — splash, the vessel rings on the ladder (rising), a
    // chime, a naqqara that grows; choir from 3
    id: `vessel${n}`, variations: 3, level: n >= 3 ? 'major' : 'medium', send: 0.34, jitter: [8, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1.7 + (n >= 3 ? 0.6 : 0)), sr = ctx.sr;
      const note = 72 + vesselSemitones(n);
      mono(out, drip(ctx, hz(note + 12), 0.9, 1.2), 0, 0.5, (v - 1) * 0.2);
      mono(out, bubble(ctx, 700 + n * 60, 0.8, 0.8), 0, 0.5);
      st(out, bubbles(ctx, 0.3, 8 + n * 2, 0.5, 500, 1800), 0.01 * sr, 0.45);
      chimes(ctx, out, [[note, 0.005, 0.85], [note + 7, 0.04, 0.55]], 0.45, 0.8);
      mono(out, santur(ctx, hz(note - 12), 0.75, 0.4, 1.1), 0.003 * sr, 0.35);
      mono(out, naqqara(ctx, 0.35 + n * 0.1, 'dum'), 0, 0.45);
      if (n >= 3) choirInto(ctx, out, [note - 36 + 12, note - 29 + 12, note - 24 + 12], 0, 0.7, 0.6, 0.45, 0.05);
      st(out, sparkles(ctx, 0.3 + n * 0.06, 20 + n * 8, SPARKS, 0.5, 'decay'), 0.03 * sr, 0.45);
      return out;
    },
  })),
  {
    // tease after the 2nd vessel: the water rises in a vessel, the escapement ticks faster and faster, a water-organ cluster swells
    id: 'tease', variations: 3, level: 'medium', send: 0.3, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.6), sr = ctx.sr;
      const w = pour(ctx, 3.3, 0.9, 240 + v * 20, 1900);
      for (let i = 0; i < w.l.length; i++) { const x = i / w.l.length; w.l[i]! *= 0.3 + 0.7 * x; w.r[i]! *= 0.3 + 0.7 * x; }
      st(out, w, 0, 1);
      st(out, riser(ctx, 3.2, 180 + v * 15, 2400, 0.4, 0.25), 0, 0.4);
      [60, 67, 72, 74].forEach((n, i) => mono(out, pipeFast(ctx, hz(n + (v === 1 ? 2 : 0)), 0.5 + i * 0.1, 3 - i * 0.5, { rank: 'organ', attack: 1.4 - i * 0.2, release: 0.3 }), (0.2 + i * 0.5) * sr, 0.3, i * 0.3 - 0.45));
      let t = 0.05, gap = 0.5, k = 0;
      while (t < 3.1) { mono(out, escapement(ctx, 0.5 + t * 0.12, k++ % 2 ? 'tock' : 'tick'), t * sr, 0.6); t += gap; gap = Math.max(0.12, gap * 0.86); }
      return out;
    },
  },
  {
    // feature trigger: the elephant clock strikes — chime rods tumbling down the C ladder, a santur run back up, the kös and the cymbal, choir, the water whistle, water pouring
    id: 'trigger', variations: 3, level: 'major', send: 0.38, jitter: [8, 0.5], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 3.6), sr = ctx.sr;
      [98, 96, 93, 91, 86, 84, 81, 79, 74, 72].forEach((n, i) => mono(out, chimeRod(ctx, hz(n), 0.7, 0.6), i * 0.06 * sr, 0.35, ((i % 4) - 1.5) * 0.25));
      [60, 62, 67, 69, 72, 74, 79, 81, 84].forEach((n, i) => mono(out, santur(ctx, hz(n), 0.6 + i * 0.03, 0.2, 1.2, { ring: 0.4 }), (0.65 + i * 0.06 + v * 0.005) * sr, 0.35, (i / 8) * 1.2 - 0.6));
      strikes(ctx, out, [[48, 1.25, 1.5, 0.9], [55, 1.28, 1.5, 0.85], [60, 1.31, 1.5, 0.85], [64, 1.34, 1.5, 0.85], [67, 1.37, 1.5, 0.85]], 0.45, 1.1);
      choirInto(ctx, out, [48, 55, 60, 64], 0.1 * sr, 0.85, 1.6, 0.5, 0.6);
      mono(out, kos(ctx, 1), 1.25 * sr, 0.55); mono(out, handCymbal(ctx, 0.9, 1.1), 1.25 * sr, 0.35, 0.3);
      mono(out, birdWhistle(ctx, hz(88), hz(96), 0.45, 0.7), 1.5 * sr, 0.25, -0.35);
      st(out, pour(ctx, 1.2, 0.6, 400, 1600), 1.3 * sr, 0.4);
      st(out, sparkles(ctx, 1.6, 40, SPARKS, 0.55, 'decay'), 0.05 * sr, 0.45);
      return out;
    },
  },
  ...[1, 2, 3].map((level): SfxDef => ({
    // the Fil Saati reservoir gains a level: water pours in, the float rises (a fifth higher per level) and a notch clicks;
    // level 3 trips the lever — a clank, a chime chord and the kös: the falcon is about to fly
    id: `reservoir-${level}`, variations: 3, level: level === 3 ? 'major' : 'medium', send: 0.3, jitter: [8, 0.6], core: false,
    build: (ctx, v) => {
      const semi = reservoirSemitones(level), sr = ctx.sr;
      const out = sized(ctx, 1.6 + (level === 3 ? 0.8 : 0));
      st(out, pour(ctx, 0.9, 0.8, 300 * 2 ** (semi / 12), 650 * 2 ** (semi / 12)), 0, 0.7);
      mono(out, birdWhistle(ctx, hz(60 + semi), hz(67 + semi), 0.8, 0.5, 3 + v), 0.1 * sr, 0.3, -0.2);
      mono(out, ratchet(ctx, 0.8, 1.2), 0.9 * sr, 0.5, 0.2);
      mono(out, drip(ctx, hz(84 + semi), 0.7), 0.92 * sr, 0.4, 0.3);
      if (level === 3) {
        mono(out, gearClank(ctx, 0.9, 1.1, true), 1 * sr, 0.55);
        chimes(ctx, out, fifth(84).map((n, i) => [n, 1.02 + i * 0.04, 0.8] as [number, number, number]), 0.4, 1);
        mono(out, kos(ctx, 0.8), 1 * sr, 0.45);
      }
      return out;
    },
  })),
  {
    // the mechanical falcon takes off: wing beats sweeping across, the creak of its hinges and its water-whistle cry
    id: 'falcon-flight', variations: 3, level: 'medium', send: 0.32, jitter: [12, 0.8], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2), sr = ctx.sr;
      st(out, wings(ctx, 6, 0.15 - v * 0.01, 0.9, -0.7, 0.7), 0, 0.8);
      st(out, whoosh(ctx, 1, 300, 2400, 0.7, -0.8, 0.8, 0.5), 0.05 * sr, 0.5);
      mono(out, birdWhistle(ctx, hz(91 + v), hz(98 + v), 0.4, 0.8, 32), 0.3 * sr, 0.35, 0.2);
      mono(out, birdWhistle(ctx, hz(96 + v), hz(91 + v), 0.3, 0.7, 32), 0.85 * sr, 0.3, 0.5);
      return out;
    },
  },
  {
    // the falcon dives and pins its wild slices: a falling rush, the metal claws strike (clank), a golden chime chord and the kös
    id: 'falcon-drop', variations: 3, level: 'major', send: 0.34, jitter: [10, 0.6], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 2.2), sr = ctx.sr;
      st(out, whoosh(ctx, 0.5, 1800, 300, 0.8, 0.5, -0.2, 0.3), 0, 0.6);
      const hit = 0.42 * sr;
      mono(out, gearClank(ctx, 1, 0.85, true), hit, 0.6);
      mono(out, kos(ctx, 0.8), hit, 0.45);
      chimes(ctx, out, [84, 91, 96].map((n, i) => [n + (v === 1 ? 2 : 0), 0.43 + i * 0.03, 0.85] as [number, number, number]), 0.45, 1);
      st(out, sparkles(ctx, 0.8, 45, SPARKS, 0.55, 'decay'), hit, 0.5);
      return out;
    },
  },
  ...(['auto-on', 'auto-off'] as const).map((id, dir): SfxDef => ({
    // autoplay on/off: chime rods up (on) or down (off) over a short escapement run
    id, variations: 3, level: 'light', send: 0.18, jitter: [15, 1], core: false,
    build: (ctx, v) => {
      const out = sized(ctx, 1);
      const notes = [72, 79, 84, 91];
      const seq = dir === 0 ? notes : [...notes].reverse();
      seq.forEach((n, i) => { mono(out, chimeRod(ctx, hz(n), 0.6, 0.3), i * (0.06 + v * 0.005) * ctx.sr, 0.5, (i - 1.5) * 0.2); mono(out, escapement(ctx, 0.5, i % 2 ? 'tock' : 'tick'), i * 0.06 * ctx.sr, 0.35); });
      return out;
    },
  })),
  ...([['vo-hum', 'medium'], ['vo-hey', 'medium'], ['vo-joy', 'major']] as [CezeriVocal, SfxLevel][]).map(([id, level]): SfxDef => ({
    // wordless male placeholders for the recorded voice lines (the engineer's warm voice), over a chime halo
    id, variations: 3, level, send: 0.36, jitter: [10, 0.5], core: false,
    build: (ctx, v) => {
      const k = 1 + (v - 1) * 0.03;
      const out = sized(ctx, 1.8);
      if (id === 'vo-hum') mono(out, vox(ctx, 147 * k, 131 * k, 0.75, 0.85, 'oo', 'oh'), 0, 1);
      else if (id === 'vo-hey') mono(out, vox(ctx, 165 * k, 220 * k, 0.55, 0.9, 'eh', 'ah'), 0, 1);
      else { mono(out, vox(ctx, 196 * k, 220 * k, 0.22, 0.9, 'ah', 'ah'), 0, 1); mono(out, vox(ctx, 247 * k, 294 * k, 0.7, 0.95, 'eh', 'ah'), 0.26 * ctx.sr, 1); }
      mono(out, chimeRod(ctx, hz(id === 'vo-joy' ? 91 : 84), 0.35, 0.6), 0.05 * ctx.sr, 0.25, 0.2);
      return out;
    },
  })),
];

/* ---------------- win tiers and multiplier callouts ---------------- */

type TierOrMax = WinTier | 'max';
/** Tonic (MIDI) of a tier's key: C3 + the shared key ladder (C → D → E → G → A). */
const tierTonic = (t: TierOrMax) => CEZERI_TONIC + TIER_KEY[t];
const rankOf = (t: TierOrMax) => (t === 'max' ? 5 : t);

/**
 * Tier-up into tier `t`: a rising rush and riser for TIER_UP_PRE seconds, then the hit — the mechanism shifts gear (a
 * heavy clank), a santur roll on the new tonic triad, the kös, a chime pair, the cymbal; tier 4 and max add the male
 * choir, max the water whistle. The runtime aligns the hit to the celebration beat.
 */
const tierUp = (t: Exclude<TierOrMax, 1>): SfxDef => ({
  id: `tier-up-${t}`, variations: 1, level: 'major', send: 0.34, jitter: [6, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const out = sized(ctx, 2.8), hit = TIER_UP_PRE * ctx.sr, root = tierTonic(t), rank = rankOf(t);
    st(out, whoosh(ctx, TIER_UP_PRE + 0.06, 220, 3000, 0.8, v ? 0.5 : -0.5, v ? -0.3 : 0.3, 0.88), 0, 0.8);
    st(out, riser(ctx, TIER_UP_PRE, 400, 3000, 0.5, 0.3), 0, 0.5);
    mono(out, gearClank(ctx, 1, 1.1, true), hit, 0.5);
    strikes(ctx, out, [...major(root + 12), root + 24].map((n, i) => [n, TIER_UP_PRE + i * 0.025, 0.7, 0.9] as [number, number, number, number]), 0.45, 1.25);
    mono(out, kos(ctx, 1, hz(root - 12 < 31 ? root : root - 12)), hit, 0.5);
    chimes(ctx, out, [[root + 36, TIER_UP_PRE + 0.004, 0.8], [root + 43, TIER_UP_PRE + 0.02, 0.6]], 0.35, 0.9);
    mono(out, handCymbal(ctx, 0.85, 0.9), hit, 0.3, 0.3);
    if (rank >= 4) choirInto(ctx, out, [root, root + 7, root + 12, root + 16], hit, 0.9, 0.6, 0.5, 0.05, 0.5);
    if (t === 'max') mono(out, birdWhistle(ctx, hz(root + 43), hz(root + 48), 0.4, 0.7), hit + 0.1 * ctx.sr, 0.3, -0.3);
    st(out, sparkles(ctx, 0.8, 40 + rank * 12, SPARKS, 0.6, 'decay'), hit + 0.01 * ctx.sr, 0.5);
    return out;
  },
});

/**
 * Count-up landing ("the count stops here"), sized by tier: 1 kös + chime rods on the tonic; 2 + santur roll; 3 + the
 * water organ; 4 + male choir swell; max + cymbal and the water whistle.
 */
const countLand = (t: TierOrMax): SfxDef => ({
  id: `count-land-${t}`, variations: 1, level: rankOf(t) >= 3 ? 'hero' : 'major', send: 0.34, jitter: [5, 0.5], core: false, late: true,
  build: (ctx, v) => {
    const rank = rankOf(t), root = tierTonic(t), sr = ctx.sr;
    const out = sized(ctx, 2.2 + rank * 0.4);
    mono(out, kos(ctx, 0.95, hz(root - 12 < 31 ? root : root - 12)), 0, 0.55);
    mono(out, gearClank(ctx, 0.7, 1.3, false), 0, 0.35);
    const bells = [root + 36, root + 43, root + 48].slice(0, 1 + Math.min(2, rank));
    chimes(ctx, out, bells.map((n, i) => [n, 0.003 + i * 0.015 + v * 0.004, 0.85] as [number, number, number]), 0.45, 1.1);
    if (rank >= 2) strikes(ctx, out, [...major(root + 12), root + 24].map((n, i) => [n, i * 0.03, 1, 0.85] as [number, number, number, number]), 0.45, 1.2);
    if (rank >= 3) organ(ctx, out, major(root + 12), 0, 0.7 + rank * 0.1, 0.8, 0.5, 0.03);
    if (rank >= 4) choirInto(ctx, out, [root, root + 4, root + 7, root + 12], 0, 0.95, 0.6 + (rank - 4) * 0.4, 0.55, 0.06);
    if (rank >= 5) { mono(out, handCymbal(ctx, 1, 1.2), 0, 0.35, 0.3); mono(out, birdWhistle(ctx, hz(root + 43), hz(root + 48), 0.45, 0.6), 0.25 * sr, 0.25, 0.3); }
    st(out, sparkles(ctx, 0.7 + rank * 0.2, 35 + rank * 15, SPARKS, 0.6, 'decay'), 0.01 * sr, 0.55);
    return out;
  },
});

/**
 * Callout recipe per class (hub value or chain total): each class has its own santur motif (MIDI, `step` s apart) on
 * the C ladder so the classes are told apart instantly, ending on an open fifth with chime rods and the layers it adds.
 *   x2   a rising fifth C–G with one chime
 *   x10  C–G–C, kös
 *   x25  + the escapement turn G–F#–G and a leap to G6, a short choir
 *   x50  C–D–G–C–D–C–G arpeggio, choir swell, cymbal
 *   x100 two-octave ladder fanfare, full choir, the water organ, a naqqara roll
 *   x250 the longest fanfare up to D7 with the highest chimes, the longest choir and the water whistle
 */
const CALLOUT: Record<MultiplierClass, { motif: number[]; step: number; seconds: number; level: SfxLevel }> = {
  x2: { motif: [72, 79], step: 0.08, seconds: 1.1, level: 'medium' },
  x10: { motif: [72, 79, 84], step: 0.1, seconds: 1.6, level: 'major' },
  x25: { motif: [79, 78, 79, 84, 91], step: 0.09, seconds: 2.1, level: 'major' },
  x50: { motif: [72, 74, 79, 84, 86, 84, 91], step: 0.09, seconds: 2.7, level: 'hero' },
  x100: { motif: [72, 74, 79, 81, 84, 86, 91, 93, 96], step: 0.08, seconds: 3.3, level: 'hero' },
  x250: { motif: [67, 69, 72, 74, 79, 81, 84, 86, 91, 93, 96, 98], step: 0.085, seconds: 4, level: 'hero' },
};

const callout = (c: MultiplierClass): SfxDef => ({
  id: `callout-${c}`, variations: MULTIPLIER_CLASSES.indexOf(c) <= 2 ? 2 : 1, level: CALLOUT[c].level, send: 0.34, jitter: [5, 0.4], core: false, late: true,
  build: (ctx, v) => {
    const spec = CALLOUT[c], rank = MULTIPLIER_CLASSES.indexOf(c), sr = ctx.sr;
    const out = sized(ctx, spec.seconds);
    const start = 0.03, last = start + (spec.motif.length - 1) * spec.step, top = spec.motif[spec.motif.length - 1]!;
    spec.motif.forEach((n, i) => {
      const final = i === spec.motif.length - 1;
      mono(out, santur(ctx, hz(n), 0.65 + 0.3 * (i / Math.max(1, spec.motif.length - 1)), final ? 0.5 + rank * 0.2 : spec.step, 1.25, { ring: final ? 0.6 : 0.3 }), (start + i * spec.step) * sr, 0.6, (v ? -1 : 1) * (i / spec.motif.length - 0.5) * 0.5);
    });
    const finalAt = last * sr, root = top - (top % 12) + 0;
    if (rank >= 3) strikes(ctx, out, fifth(root - 24).map((n, i) => [n, last + i * 0.03, 0.4 + rank * 0.15, 0.75] as [number, number, number, number]), 0.35, 1);
    mono(out, chimeRod(ctx, hz(Math.min(98, top + 12)), 0.8, 0.6 + rank * 0.15), finalAt, 0.4, 0.25);
    mono(out, chimeRod(ctx, hz(top), 0.7, 0.5 + rank * 0.1), finalAt, 0.35, -0.2);
    if (rank >= 1) mono(out, kos(ctx, 0.6 + rank * 0.07), finalAt, 0.45);
    if (rank >= 2) choirInto(ctx, out, rank >= 4 ? [48, 55, 60, 67] : [48, 55, 60], rank >= 4 ? start * sr : finalAt, 0.85, rank >= 4 ? 0.9 + (rank - 4) * 0.5 : 0.45, 0.45, rank >= 4 ? 0.35 : 0.04);
    if (rank >= 3) mono(out, handCymbal(ctx, 0.8, 0.8 + rank * 0.1), finalAt, 0.3, 0.3);
    if (rank >= 4) {
      for (let k = 0; k < 6 + (rank - 4) * 4; k++) mono(out, naqqara(ctx, 0.4 + 0.08 * k, 'tek'), (0.25 + k * 0.08) * sr, 0.35);
      organ(ctx, out, [48, 55, 60, 67], finalAt, 0.6 + (rank - 4) * 0.4, 0.75, 0.45, 0.04);
    }
    if (rank >= 5) mono(out, birdWhistle(ctx, hz(91), hz(98), 0.45, 0.7), finalAt + 0.12 * sr, 0.3, -0.3);
    st(out, sparkles(ctx, 0.4 + rank * 0.15, 25 + rank * 12, SPARKS, 0.55, 'decay'), finalAt, 0.5);
    return out;
  },
});

CEZERI_SFX.push(
  ...([2, 3, 4, 'max'] as const).map(tierUp),
  ...([1, 2, 3, 4, 'max'] as const).map(countLand),
  ...MULTIPLIER_CLASSES.map(callout),
);

export const CEZERI_SFX_IDS = CEZERI_SFX.map(s => s.id);
