/**
 * Original synthesized voices for "Asena: Yıldız Kurdu" (Turkic sky mythology: Gök Tengri, Ay Ata, Kün Ana, the
 * guiding sky wolf Asena, the Ergenekon escape; steppe night, aurora, star dust). Everything is built from first
 * principles in code (no samples, no recordings, no imitation of any other game's sound):
 *   kopuz       — a dombra/kopuz-like two-string plucked lute (Karplus-Strong, gut-string loss, finger strum, skin-and-
 *                 wood body, optional fourth-below drone string; a palm-muted "gallop" stroke),
 *   kilKopuz    — a kıl-kopuz-like bowed horsehair fiddle (band-limited saw with stick-slip bow noise, a subharmonic
 *                 horsehair roughness, a scoop into every note, delayed vibrato and a skin-bowl body),
 *   khoomei     — a throat-singing-inspired overtone drone (a buzzy glottal source through a vocal-tract formant pair
 *                 and a very narrow "whistle" resonance that walks over the natural harmonics 6–16 of the drone);
 *                 `kargyraa` is the deep variant with a strong undertone an octave below,
 *   kamDavul    — a shaman frame drum (big single skin, felt beater, the iron pendants that jingle inside the frame),
 *   hoof / anvil / paw — gallop hoofbeats, the Ergenekon forge, the wolf's padded steps,
 *   starBell    — crystalline star bells (a beating twin fundamental, sweet upper modes, an icy glint),
 *   auroraChord — the aurora pad (slow rippling curtains of soft partials with a fading shimmer layer),
 *   skyHowl     — the guiding wolf's call: a vocal-formant synth voice (pitch scoop, held peak, optional upward break,
 *                 long falling glissando, "oo"→"oh"→"oo" vowels, breath and a throat-singing undertone at the onset);
 *                 not a recorded or sampled wolf,
 *   ironCrack   — the iron mountain cracking (crack, iron plate ring, clang, boom, molten hiss),
 *   steppeNight / fireCrackle — wind over steppe grass with distant gusts, night crickets, a far camp fire.
 * Deterministic given the seeded random source in `ctx`. Colour approximations, not models of any recording.
 */
import { Biquad, Svf, addMono, dcBlock, onePoleCoef, sinCycles, softClip, stereo, trimTail, upsample, type Stereo } from './dsp';
import { kick, modal, noiseHit, type VoiceCtx } from './instruments';

const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (dst: Float32Array, src: Float32Array, at = 0, gain = 1) => {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i]! += src[i]! * gain;
  return dst;
};
const grow = (a: Float32Array, length: number) => { if (a.length >= length) return a; const b = new Float32Array(length); b.set(a); return b; };
const blep = (t: number, dt: number) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
const smooth = (x: number) => { const c = clampNum(x, 0, 1); return c * c * (3 - 2 * c); };

/* ---------------- kopuz (plucked) ---------------- */

interface KsSpec { cents: number; gain: number; ratio?: number }
/** One Karplus-Strong string per spec: two-tap loss (tilt = newest-sample weight), allpass tuning, low-passed finger noise
 *  with a pluck-position comb, and a damper after `releaseAt`. */
function ksStrings(ctx: VoiceCtx, out: Float32Array, freq: number, vel: number, specs: KsSpec[], o: { t60: number; cutoff: number; pick: number; tilt: number; releaseAt: number; damp: number; exc: number }) {
  const { sr, rng } = ctx, len = out.length;
  for (const c of specs) {
    const fr = freq * (c.ratio ?? 1) * 2 ** (c.cents / 1200);
    if (fr > sr * 0.4 || fr < 20) continue;
    const period = sr / fr, L = Math.max(2, Math.floor(period - 0.5 - 0.001)), frac = period - 0.5 - L, C = (1 - frac) / (1 + frac);
    const loss = 10 ** (-3 / (fr * o.t60)), buf = new Float32Array(L);
    const excN = Math.max(2, Math.round(period * 1.2)), k = onePoleCoef(o.cutoff, sr), pick = Math.max(1, Math.round(period * o.pick));
    const exc = new Float32Array(excN + pick);
    let lp = 0;
    for (let i = 0; i < excN; i++) { lp += k * ((rng() * 2 - 1) - lp); exc[i] = lp * (1 - i / excN * 0.5); }
    for (let i = exc.length - 1; i >= pick; i--) exc[i] = exc[i]! - 0.8 * exc[i - pick]!;
    let prev = 0, apx = 0, apy = 0, w = 0, g = 1;
    const stopAt = Math.floor(o.releaseAt * sr), damp = t60Factor(o.damp, sr), a = o.tilt, b = 1 - o.tilt, eg = vel * o.exc;
    for (let i = 0; i < len; i++) {
      const read = buf[w]!;
      const avg = (a * read + b * prev) * loss; prev = read;
      const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
      const v = ap + (i < exc.length ? exc[i]! * eg : 0);
      buf[w] = v; w = w + 1 === L ? 0 : w + 1;
      if (i >= stopAt) { g *= damp; if (g < 1e-4) break; }
      out[i]! += v * c.gain * g;
    }
  }
}

export interface KopuzOptions {
  /** Drone string (semitones relative to the note, e.g. −5 = a fourth below) sounding softly with the stroke; null = none. */
  drone?: number | null;
  /** Palm-muted gallop stroke: short, thumpy. */
  mute?: boolean;
  /** Ring past the written length (s). */
  ring?: number;
}
/**
 * Dombra/kopuz-like two-string lute: gut strings (warm loss filter, quick decay of the highs), a finger/nail stroke
 * close to the soundhole, a small wooden body with a skin-like nasal mid, a nail "tsk" on the attack and, optionally,
 * the second string ringing a fourth below as a drone. `bright` 0..1.5.
 */
export function kopuz(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: KopuzOptions = {}): Float32Array {
  const { sr } = ctx;
  const mute = !!opts.mute;
  const t60 = mute ? clampNum(0.22 * (196 / freq) ** 0.3, 0.1, 0.35) : clampNum(1.7 * (196 / freq) ** 0.45, 0.55, 2.6);
  const releaseAt = mute ? Math.min(held, 0.09) : held + (opts.ring ?? 0.18);
  const len = Math.ceil((Math.min(t60, releaseAt + 0.4) + 0.05) * sr) + 64;
  const out = new Float32Array(len);
  const b = clampNum(bright, 0, 1.5);
  const common = { t60, cutoff: clampNum((mute ? 1400 : 1900) + b * 3600 * (0.5 + 0.5 * vel), 600, 8000), pick: 0.16, tilt: 0.54 + 0.05 * b, releaseAt, damp: mute ? 0.04 : 0.14, exc: 1.5 };
  ksStrings(ctx, out, freq, vel, [{ cents: -1.5, gain: 0.62 }, { cents: 2, gain: 0.5 }], common);
  if (opts.drone != null) {
    const d = new Float32Array(len);
    ksStrings(ctx, d, freq * 2 ** (opts.drone / 12), vel * 0.8, [{ cents: 0, gain: 0.5 }], { ...common, t60: common.t60 * 1.15 });
    mix(out, d, Math.round(0.009 * sr), 0.55);
  }
  for (const f of [new Biquad(sr).highpass(70, 0.7), new Biquad(sr).peaking(190, 1.2, 4), new Biquad(sr).peaking(430, 1.3, 2.5), new Biquad(sr).peaking(1250, 1.6, 2 + b), new Biquad(sr).lowpass(4800 + 1800 * b, 0.65)]) f.process(out);
  mix(out, noiseHit(ctx, vel * (mute ? 0.35 : 0.18) * clampNum(b, 0.4, 1.4), 2600, 1.3, 0.0003, mute ? 0.02 : 0.008, 1200, 8000), 0, 1);
  if (mute) mix(out, noiseHit(ctx, vel * 0.25, 260, 0.9, 0.0006, 0.035, 80, 900), 0, 1);
  dcBlock(out);
  return trimTail(out);
}

/* ---------------- kıl kopuz (bowed horsehair fiddle) ---------------- */

/**
 * Kıl-kopuz-like bowed fiddle: a band-limited saw with stick-slip bow noise (strongest at the slip), a subharmonic
 * roughness of the horsehair strings, a scoop into every note, delayed vibrato and a slow drift, and a skin-covered
 * bowl body (peaks near 320 Hz, 1.05 kHz and 2.6 kHz). Synthesised at the rate given (render at half rate: < 6 kHz).
 */
export function kilKopuz(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: { scoop?: number; vibrato?: number; rasp?: number } = {}): Float32Array {
  const { sr, rng } = ctx;
  const attack = clampNum(held * 0.28, 0.05, 0.18), rel = 0.24;
  const len = Math.ceil((held + rel * 3) * sr), src = new Float32Array(len);
  const scoop = opts.scoop ?? 0.035, vibD = 0.0068 * (opts.vibrato ?? 1), rasp = opts.rasp ?? 1;
  let p = rng(), q = rng(), vp = rng(), dp = rng();
  const aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 2.4, sr);
  const vibRate = 5.1 + rng() * 0.5;
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const sc = 1 - scoop * Math.exp(-t / 0.055);
    const vib = 1 + vibD * Math.min(1, Math.max(0, t - 0.2) / 0.35) * sinCycles(vp) + 0.0018 * sinCycles(dp);
    const f = freq * sc * vib, dt = f / sr;
    const saw = 2 * p - 1 - blep(p, dt);
    const n = (rng() * 2 - 1) * (p < 0.16 ? 1 : 0.28);
    const rough = 1 + 0.06 * rasp * sinCycles(q);
    const pressure = 0.82 + 0.18 * Math.min(1, t / Math.max(0.1, held)); // the bow digs in over the stroke
    const env = (i < aN ? Math.sin((i / aN) * Math.PI * 0.5) ** 2 : 1) * pressure;
    if (i >= heldN) relG *= relD;
    src[i] = (saw * 0.75 * rough + n * 0.32 * rasp) * env * relG * vel;
    p += dt; if (p >= 1) p -= 1;
    q += dt * 0.5; if (q >= 1) q -= 1;
    vp += vibRate / sr; dp += 0.55 / sr;
  }
  const b = clampNum(bright, 0, 1.5);
  for (const f of [new Biquad(sr).highpass(150, 0.7), new Biquad(sr).peaking(320, 1.2, 5), new Biquad(sr).peaking(1050, 1.5, 4), new Biquad(sr).peaking(2600, 2, 2 + 2 * b), new Biquad(sr).lowpass(3600 + 1600 * b, 0.6), new Biquad(sr).lowpass(5600, 0.5)]) f.process(src);
  for (let i = 0; i < len; i++) src[i] = softClip(src[i]! * 1.4) * 0.7;
  dcBlock(src);
  return trimTail(src);
}
/** The bowed fiddle at half rate, interpolated up (its spectrum is filtered below ~6 kHz). */
export function kilKopuzFast(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1): Float32Array {
  return upsample(kilKopuz({ sr: ctx.sr / 2, rng: ctx.rng }, freq, vel, held, bright), 2);
}

/* ---------------- throat-singing drone ---------------- */

/** Harmonic paths of the overtone "whistle": khoomei (sygyt-like, over an E or B drone) and kargyraa (deep, no 9th). */
export const KHOOMEI_HARMONICS = [6, 8, 9, 8, 12, 9, 8, 7, 6, 8, 12, 16, 12, 9] as const;
export const KARGYRAA_HARMONICS = [6, 8, 7, 6, 8, 12, 8, 7] as const;

export interface KhoomeiOptions {
  /** Harmonic numbers the whistle walks over (one per `step` seconds); a seeded rotation of the path is used. */
  harmonics?: readonly number[];
  step?: number;
  /** Whistle level 0..1.5. */
  whistle?: number;
  /** Undertone (an octave below, kargyraa-like) 0..1. */
  growl?: number;
}
/**
 * Throat-singing-inspired overtone drone: a buzzy glottal source (saw + narrow pulse with tiny jitter) through a
 * vocal-tract formant pair that breathes slowly, plus a very narrow resonance ("the whistle") gliding from harmonic to
 * harmonic of the drone so an overtone melody floats over it; an optional undertone an octave below. Inspired by the
 * technique only (synthesised, no recording).
 */
export function khoomei(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: KhoomeiOptions = {}): Float32Array {
  const { sr, rng } = ctx;
  const attack = clampNum(held * 0.2, 0.08, 0.5), rel = 0.5;
  const len = Math.ceil((held + rel * 2.5) * sr), out = new Float32Array(len);
  const path = opts.harmonics ?? KHOOMEI_HARMONICS, step = opts.step ?? 1.15, whistle = opts.whistle ?? 1, growl = opts.growl ?? 0;
  const rot = Math.floor(rng() * path.length);
  const f1 = new Svf(sr), f2 = new Svf(sr), wh = new Svf(sr), nasal = new Biquad(sr).peaking(2400, 2, 3), top = new Biquad(sr).lowpass(4800, 0.6);
  let p = rng(), u = rng(), jit = 0, jitT = 0, br = rng(), whF = freq * path[rot % path.length]!, vow = rng();
  const aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 2.5, sr);
  const glide = 1 - Math.exp(-1 / (0.09 * sr));
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if ((i & 255) === 0) jitT = (rng() * 2 - 1) * 0.0025;
    jit += (jitT - jit) * 0.002;
    const f = freq * (1 + jit), dt = f / sr;
    const saw = 2 * p - 1 - blep(p, dt);
    const pulse = (p < 0.12 ? 1 : -0.14) - blep(p, dt) + blep((p + 0.88) % 1, dt);
    const sub = growl ? sinCycles(u) * 0.9 + (u < 0.5 ? 0.35 : -0.35) : 0;
    const s = saw * 0.55 + pulse * 0.4 + sub * growl;
    p += dt; if (p >= 1) p -= 1;
    u += dt * 0.5; if (u >= 1) u -= 1;
    if ((i & 31) === 0) {
      const v = 0.5 + 0.5 * sinCycles(vow); vow += 32 * 0.07 / sr;
      f1.set(380 + 170 * v, 5); f2.set(900 + 500 * v, 7);
      const h = path[(rot + Math.floor(t / step)) % path.length]!;
      whF += (freq * h - whF) * Math.min(1, glide * 32);
      wh.set(Math.min(sr * 0.4, whF), 42);
    }
    const breath = 0.88 + 0.12 * sinCycles(br); br += 0.19 / sr;
    const body = f1.tick(s, 1) * 1.1 + f2.tick(s, 1) * 0.55 + s * 0.08;
    const y = body + wh.tick(s, 1) * 3.2 * whistle;
    const env = i < aN ? Math.sin((i / aN) * Math.PI * 0.5) ** 2 : 1;
    if (i >= heldN) relG *= relD;
    out[i] = y * env * relG * breath * vel * 0.5;
  }
  nasal.process(out); top.process(out);
  dcBlock(out);
  return trimTail(out);
}
/** The drone at half rate, interpolated up (filtered below 5 kHz). */
export function khoomeiFast(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: KhoomeiOptions = {}): Float32Array {
  return upsample(khoomei({ sr: ctx.sr / 2, rng: ctx.rng }, freq, vel, held, opts), 2);
}

/* ---------------- percussion ---------------- */

/** The iron pendants inside a shaman drum: a quick spray of tiny inharmonic metal rings and clicks. */
export function jingles(ctx: VoiceCtx, vel: number, count = 9, spread = 0.12): Float32Array {
  const { sr, rng } = ctx;
  const out = new Float32Array(Math.ceil((spread + 0.45) * sr));
  for (let k = 0; k < count; k++) {
    const at = Math.floor(rng() ** 1.6 * spread * sr), f = 2600 + rng() * 3800;
    const ring = modal(ctx, f, [1, 1.41, 2.03], [0.6, 0.3, 0.12], [0.12 + rng() * 0.22, 0.09, 0.05], vel * (0.35 + 0.65 * rng()) * (1 - (k / count) * 0.5), 10, { attack: 0.0002 });
    mix(out, ring, at, 0.5);
    mix(out, noiseHit(ctx, vel * 0.25, 5200, 1.5, 0.0002, 0.006, 3000, 9500), at, 1);
  }
  return trimTail(out);
}

export type KamStroke = 'dum' | 'tek' | 'jingle';
/** Shaman frame drum (kam davulu): a deep felt-beater boom with a long skin ring, a higher edge stroke, both with the pendants. */
export function kamDavul(ctx: VoiceCtx, vel: number, stroke: KamStroke): Float32Array {
  if (stroke === 'jingle') return jingles(ctx, vel, 12, 0.18);
  if (stroke === 'dum') {
    let out = kick(ctx, vel * 0.9, 118, 63, 0.03, 0.85, 0.05, 1.12);
    const skin = modal(ctx, 64, [1, 1.59, 2.14, 2.3, 2.65], [0.55, 0.32, 0.2, 0.12, 0.08], [0.8, 0.45, 0.3, 0.22, 0.16], vel, 10, { attack: 0.002 });
    out = grow(out, skin.length);
    mix(out, skin, 0, 0.75);
    mix(out, noiseHit(ctx, vel * 0.3, 520, 0.8, 0.0015, 0.04, 90, 1800), 0, 1);
    return trimTail(mix(grow(out, Math.ceil(0.6 * ctx.sr)), jingles(ctx, vel * 0.32, 6, 0.08), Math.round(0.004 * ctx.sr), 1));
  }
  let out = modal(ctx, 168, [1, 1.59, 2.14, 2.65, 3.2], [0.6, 0.36, 0.22, 0.12, 0.06], [0.28, 0.16, 0.1, 0.07, 0.05], vel, 10, { attack: 0.0006 });
  out = grow(out, Math.ceil(0.5 * ctx.sr));
  mix(out, noiseHit(ctx, vel * 0.55, 1700, 1, 0.0004, 0.025, 500, 7000), 0, 1);
  return trimTail(mix(out, jingles(ctx, vel * 0.55, 8, 0.1), Math.round(0.003 * ctx.sr), 1));
}

/** A hoofbeat on the steppe: dull earthy knock, a little grit. */
export function hoof(ctx: VoiceCtx, vel: number): Float32Array {
  const out = grow(kick(ctx, vel * 0.7, 170, 92, 0.008, 0.11, 0.1, 1.1), Math.ceil(0.12 * ctx.sr));
  mix(out, noiseHit(ctx, vel * 0.55, 650, 0.8, 0.0005, 0.035, 140, 2400), 0, 1);
  mix(out, noiseHit(ctx, vel * 0.18, 3200, 1.2, 0.0004, 0.012, 1500, 7000), Math.round(0.002 * ctx.sr), 1);
  return trimTail(out);
}

/** The Ergenekon forge: a small iron block struck by a hammer (bright inharmonic ring, a hard click). */
export function anvil(ctx: VoiceCtx, vel: number, freq = 820): Float32Array {
  const out = grow(modal(ctx, freq, [1, 2.76, 5.4, 1.53, 3.9], [0.8, 0.38, 0.14, 0.3, 0.12], [1.1, 0.7, 0.35, 0.8, 0.4], vel, 10, { attack: 0.0002 }), Math.ceil(0.3 * ctx.sr));
  mix(out, noiseHit(ctx, vel * 0.7, 4200, 1.4, 0.0002, 0.006, 2000, 9500), 0, 1);
  return trimTail(out);
}

/** The wolf's padded step on frosty grass: a soft low thud and a short crunch of tiny ticks. */
export function paw(ctx: VoiceCtx, vel: number, crunch = 1): Float32Array {
  const { sr, rng } = ctx;
  const out = grow(kick(ctx, vel * 0.55, 120, 70, 0.012, 0.12, 0.02, 1.05), Math.ceil(0.14 * sr));
  mix(out, noiseHit(ctx, vel * 0.35, 900, 0.7, 0.003, 0.04, 200, 2500), 0, 1);
  for (let k = 0; k < Math.round(7 * crunch); k++) mix(out, noiseHit(ctx, vel * (0.12 + rng() * 0.12) * crunch, 2400 + rng() * 2400, 2.5, 0.0002, 0.004, 1400, 8000), Math.floor(rng() * 0.05 * sr), 1);
  return trimTail(out);
}

/* ---------------- star bells, aurora ---------------- */

/** Crystalline star bell: a beating twin fundamental, sweet upper modes, an icy glint on the strike. `length` scales the ring. */
export function starBell(ctx: VoiceCtx, freq: number, vel: number, length = 1): Float32Array {
  const s = clampNum((880 / freq) ** 0.3, 0.6, 1.5) * clampNum(length, 0.15, 2.5);
  const beat = 1 + (0.6 + ctx.rng() * 0.6) / freq;
  const out = modal(ctx, freq, [1, beat, 2, 3.01, 4.07, 5.43], [0.75, 0.45, 0.3, 0.1, 0.07, 0.04], [3.2 * s, 2.9 * s, 1.6 * s, 0.85 * s, 0.5 * s, 0.32 * s], vel, 10, { attack: 0.0004, maxLen: 5 });
  const glintF = freq * 6.8;
  if (glintF < 9500) mix(out, modal(ctx, glintF, [1], [0.18], [0.05], vel, 10, { attack: 0.0002 }), 0, 1);
  return trimTail(out);
}

/**
 * Aurora pad (stereo): per note three soft voices (sine with faint 2nd/3rd partials) a few cents apart, each with its
 * own very slow level ripple and position, so the chord moves like a light curtain; a shimmer layer (octave and twelfth)
 * fades in and out on its own slow cycle. Render at half rate (content < 4 kHz).
 */
export function auroraChord(ctx: VoiceCtx, freqs: number[], vel: number, held: number, opts: { attack?: number; release?: number; shimmer?: number } = {}): Stereo {
  const { sr, rng } = ctx;
  const attack = opts.attack ?? Math.min(1.6, Math.max(0.2, held * 0.4)), release = opts.release ?? 1.4, shimmer = opts.shimmer ?? 1;
  const len = Math.ceil((held + release * 2.2) * sr), out = stereo(len);
  const norm = 0.42 / Math.sqrt(Math.max(1, freqs.length * 3));
  const aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(release * 2.2, sr);
  for (const freq of freqs) {
    for (let v = 0; v < 3; v++) {
      const f = freq * 2 ** (((v - 1) * 7 + (rng() - 0.5) * 3) / 1200);
      const side = (v - 1) * 0.7 + (rng() - 0.5) * 0.3, gl = Math.sqrt(0.5 * (1 - side)), gr = Math.sqrt(0.5 * (1 + side));
      let p = rng(), lfo = rng(), sh = rng(), ripple = 1, glow = 0;
      const lRate = (0.07 + rng() * 0.12) / sr, sRate = (0.05 + rng() * 0.07) / sr, inc = f / sr;
      const h2 = f * 2 < sr * 0.45 ? 0.22 : 0, h3 = f * 3 < sr * 0.45 ? 0.1 : 0, s2 = f * 2 < sr * 0.45 ? 0.16 * shimmer : 0, s3 = f * 3 < sr * 0.45 ? 0.08 * shimmer : 0;
      let relG = 1;
      for (let i = 0; i < len; i++) {
        // the slow ripples run at control rate; the 2nd and 3rd partials come from sin/cos of the fundamental (Chebyshev)
        if ((i & 63) === 0) { ripple = 0.65 + 0.35 * sinCycles(lfo); const g = Math.max(0, sinCycles(sh)); glow = g * g; lfo += 64 * lRate; sh += 64 * sRate; }
        const sn = sinCycles(p), cs = sinCycles(p + 0.25), sin2 = 2 * sn * cs, sin3 = sn * (3 - 4 * sn * sn);
        const y = sn + (h2 + glow * s2) * sin2 + (h3 + glow * s3) * sin3;
        const env = i < aN ? Math.sin((i / aN) * Math.PI * 0.5) ** 2 : 1;
        if (i >= heldN) relG *= relD;
        const g = y * ripple * env * relG * vel * norm;
        out.l[i]! += g * gl; out.r[i]! += g * gr;
        p += inc; if (p >= 1) p -= 1;
      }
    }
  }
  for (const ch of [out.l, out.r]) new Biquad(sr).lowpass(3800, 0.6).process(ch);
  return out;
}

/* ---------------- the howl ---------------- */

export interface HowlOptions {
  /** Semitones of the opening scoop (below the peak). */
  from?: number;
  /** Semitones of the final fall. */
  fall?: number;
  /** Upward break (semitones) in the middle of the held part, 0 = none. */
  breakUp?: number;
  /** Throat-singing undertone at the onset 0..1. */
  growl?: number;
  breath?: number;
}
/**
 * The guiding wolf's call as a vocal-formant synth voice (no sampled wolf): a near-pure tone with a soft vocal edge
 * scoops up into its peak, holds with a slight waver (optionally breaking upward), then falls in a long glissando
 * while fading; the vowel opens from "oo" to "oh" at the peak and closes again; breath on the onset and a deep
 * throat-singing undertone (an octave below) that fades in the first half second.
 */
export function skyHowl(ctx: VoiceCtx, f0: number, dur: number, vel: number, opts: HowlOptions = {}): Float32Array {
  const { sr, rng } = ctx;
  const from = opts.from ?? 7, fall = opts.fall ?? 10, brk = opts.breakUp ?? 0, growl = opts.growl ?? 0.5, breath = opts.breath ?? 0.5;
  const len = Math.ceil((dur + 0.3) * sr), src = new Float32Array(len), air = new Float32Array(len);
  const riseT = dur * 0.2, fallStart = dur * 0.66, brkAt = dur * 0.42;
  let p = rng(), q = rng(), vp = rng(), dp = rng();
  const bn = new Biquad(sr).bandpass(f0, 5);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let semi = -from * (1 - smooth(t / riseT));
    if (brk) semi += brk * smooth((t - brkAt) / 0.09) * (1 - smooth((t - fallStart + 0.12) / 0.2));
    if (t > fallStart) { const x = (t - fallStart) / (dur - fallStart); semi -= fall * x * x; }
    const vibAmt = 0.009 * Math.min(1, Math.max(0, t - 0.35) / 0.4) * (t > fallStart ? 0.5 : 1);
    const f = f0 * 2 ** (semi / 12) * (1 + vibAmt * sinCycles(vp) + 0.003 * sinCycles(dp)), dt = f / sr;
    const saw = 2 * p - 1 - blep(p, dt);
    const tone = sinCycles(p) + 0.2 * sinCycles(2 * p + 0.1) + 0.07 * sinCycles(3 * p + 0.2) + saw * 0.1;
    const under = growl ? sinCycles(q) * growl * 0.55 * Math.exp(-t / 0.45) * (1 + 0.4 * sinCycles(p * 3)) : 0;
    // amplitude: soft onset, swell to the peak, long fade along the fall
    const a = smooth(t / 0.14) * (0.75 + 0.25 * smooth(t / (dur * 0.4))) * (t > fallStart ? 1 - smooth((t - fallStart) / (dur - fallStart)) * 0.92 : 1) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.25) : 1);
    src[i] = (tone + under) * a;
    air[i] = bn.tick(rng() * 2 - 1) * a * breath * (0.5 + 1.2 * Math.exp(-t / 0.2));
    p += dt; if (p >= 1) p -= 1;
    q += dt * 0.5; if (q >= 1) q -= 1;
    vp += (4.8 + 0.8 * Math.min(1, t / dur)) / sr; dp += 0.7 / sr;
  }
  // vowel: oo → oh at the peak → oo on the fall
  const out = new Float32Array(len), fa = new Svf(sr), fb = new Svf(sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if ((i & 15) === 0) {
      const open = smooth(t / (dur * 0.35)) * (1 - smooth((t - fallStart) / (dur - fallStart)) * 0.8);
      fa.set(330 + 160 * open, 4); fb.set(760 + 140 * open, 6);
    }
    const x = src[i]!;
    out[i] = (x * 0.55 + fa.tick(x, 1) * 0.9 + fb.tick(x, 1) * 0.45 + air[i]! * 0.8) * vel * 0.55;
  }
  new Biquad(sr).lowpass(5200, 0.6).process(out);
  dcBlock(out);
  return trimTail(out);
}

/* ---------------- Ergenekon: the iron mountain cracking ---------------- */

/** The iron mountain cracks (stereo): a hard crack, an iron plate ringing, a high clang, a deep boom and molten hiss. `size` 1..3. */
export function ironCrack(ctx: VoiceCtx, vel: number, size = 1): Stereo {
  const { sr, rng } = ctx;
  const z = clampNum(size, 1, 3);
  const out = stereo(Math.ceil((2.6 + z * 0.6) * sr));
  addMono(out, noiseHit(ctx, vel, 2400, 0.6, 0.0003, 0.06 + z * 0.02, 400, 9000), 0, 0.9);
  addMono(out, kick(ctx, vel, 92, 36, 0.06, 1.2 + z * 0.3, 0.25, 1.6), 0, 0.85);
  const plateF = 108 / 2 ** ((z - 1) / 6);
  addMono(out, modal(ctx, plateF, [1, 1.47, 2.09, 2.56, 3.39, 4.17, 5.23], [0.5, 0.42, 0.35, 0.25, 0.18, 0.12, 0.08], [2.4, 1.9, 1.5, 1.1, 0.8, 0.6, 0.4].map(x => x * (0.8 + 0.2 * z)), vel, 10, { attack: 0.0006 }), 0, 0.7, -0.25);
  addMono(out, modal(ctx, 620 + z * 40, [1, 1.53, 2.31, 3.07], [0.5, 0.3, 0.16, 0.08], [1.1, 0.7, 0.4, 0.25], vel, 10, { attack: 0.0003 }), Math.round(0.01 * sr), 0.45, 0.3);
  // molten hiss: a band of noise that swells after the crack and dies away
  const hissN = Math.ceil((0.9 + 0.4 * z) * sr);
  for (const [ch, ph] of [[out.l, 0], [out.r, 0.37]] as const) {
    const hp = new Biquad(sr).highpass(1300, 0.7), lp = new Biquad(sr).lowpass(5200, 0.6);
    let fl = ph;
    for (let i = 0; i < hissN; i++) {
      const x = i / hissN, env = Math.sin(Math.min(1, x * 3) * Math.PI * 0.5) * (1 - x) ** 1.5;
      ch[Math.round(0.03 * sr) + i]! += lp.tick(hp.tick(rng() * 2 - 1)) * env * vel * 0.18 * (0.8 + 0.2 * sinCycles(fl)) * z;
      fl += 11 / sr;
    }
  }
  // falling iron shards
  for (let k = 0; k < 6 + z * 5; k++) {
    const at = Math.round((0.05 + rng() ** 1.3 * (0.8 + 0.3 * z)) * sr);
    addMono(out, modal(ctx, 1500 + rng() * 3500, [1, 1.62, 2.4], [0.5, 0.25, 0.1], [0.12, 0.08, 0.05], vel * (0.25 + 0.35 * rng()), 10, { attack: 0.0002 }), at, 0.3, rng() * 1.6 - 0.8);
  }
  return out;
}

/* ---------------- steppe night ---------------- */

function loopify(st: Stereo, body: number): Stereo {
  const xf = st.l.length - body;
  if (xf <= 0) return st;
  const res = { l: st.l.slice(0, body), r: st.r.slice(0, body) };
  for (let i = 0; i < xf; i++) {
    const x = i / xf, a = Math.sin(x * Math.PI * 0.5), b = Math.cos(x * Math.PI * 0.5);
    res.l[i] = st.l[i]! * a + st.l[body + i]! * b;
    res.r[i] = st.r[i]! * a + st.r[body + i]! * b;
  }
  return res;
}

/** A distant camp fire (stereo): a low flame roar that flickers and sparse crackles/pops. Not loop-folded. */
export function fireCrackle(ctx: VoiceCtx, dur: number, vel: number, density = 1): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len);
  for (const ch of [out.l, out.r]) {
    const lp = new Biquad(sr).lowpass(260, 0.7), hp = new Biquad(sr).highpass(50, 0.7);
    let brown = 0, flick = 0.7, target = 0.7;
    for (let i = 0; i < len; i++) {
      if (i % 2205 === 0) target = 0.45 + 0.55 * rng();
      flick += (target - flick) * 0.0006;
      brown = brown * 0.99 + (rng() * 2 - 1) * 0.12;
      ch[i] = hp.tick(lp.tick(brown)) * flick * vel * 1.4;
    }
  }
  const pops = Math.round(dur * 6 * density);
  for (let k = 0; k < pops; k++) {
    const at = Math.floor(rng() * (len - 0.05 * sr)), big = rng() < 0.12;
    const hit = noiseHit(ctx, vel * (big ? 0.9 : 0.25 + rng() * 0.35), big ? 420 + rng() * 300 : 1000 + rng() * 2600, big ? 4 : 2.5, 0.0002, big ? 0.03 : 0.006 + rng() * 0.01, 200, 4200);
    addMono(out, hit, at, 0.8, rng() * 1.2 - 0.6);
  }
  return out;
}

/**
 * Steppe night bed (stereo, loopable): wind over open grass — a low gusting body, a faint whistle that wanders between
 * 400 Hz and 1.1 kHz (wind in the grass and the yurt ropes), a high rustle of grass — far night crickets and,
 * optionally, a distant camp fire. Gusts come from three incommensurate slow cycles per channel.
 */
export function steppeNight(ctx: VoiceCtx, dur: number, level = 1, opts: { fire?: number; crickets?: number } = {}, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr * 2) : 0, len = body + xf;
  const out = stereo(len);
  let side = 0;
  for (const ch of [out.l, out.r]) {
    const lp = new Biquad(sr).lowpass(380, 0.7), hp = new Biquad(sr).highpass(45, 0.7), w1 = new Svf(sr), w2 = new Svf(sr);
    const gHp = new Biquad(sr).highpass(2600, 0.7), gLp = new Biquad(sr).lowpass(7200, 0.6);
    let brown = 0, g1 = rng(), g2 = rng(), g3 = rng(), c1 = rng(), c2 = rng(), grain = 1;
    for (let i = -2048; i < len; i++) {
      const gust = 0.25 + 0.75 * clampNum(0.5 + 0.28 * sinCycles(g1) + 0.16 * sinCycles(g2) + 0.08 * sinCycles(g3), 0, 1);
      g1 += 0.031 / sr; g2 += (0.077 + side * 0.006) / sr; g3 += 0.13 / sr;
      if ((i & 63) === 0) { w1.set(420 + 520 * (0.5 + 0.5 * sinCycles(c1)), 18); w2.set(700 + 400 * (0.5 + 0.5 * sinCycles(c2)), 22); c1 += 64 * 0.021 / sr; c2 += 64 * 0.033 / sr; }
      if (i % 331 === 0) grain = 0.55 + 0.45 * rng();
      brown = brown * 0.985 + (rng() * 2 - 1) * 0.15;
      const n = rng() * 2 - 1;
      const v = (hp.tick(lp.tick(brown)) * 1.5 * gust + (w1.tick(n, 1) + w2.tick(n, 1) * 0.7) * 0.22 * gust * gust + gLp.tick(gHp.tick(n)) * 0.05 * (0.3 + 0.7 * gust) * grain) * level;
      if (i >= 0) ch[i] = v;
    }
    side++;
  }
  const crickets = opts.crickets ?? 1;
  if (crickets > 0) {
    for (const [pan, f, gap] of [[-0.55, 4400, 1.1], [0.6, 4750, 1.45]] as const) {
      for (let t = rng() * gap; t < len / sr - 0.2; t += gap * (0.75 + 0.5 * rng())) {
        for (let k = 0; k < 3; k++) {
          const pulse = modal(ctx, f * (1 + (rng() - 0.5) * 0.01), [1], [1], [0.018], 0.05 * level * crickets, 10, { attack: 0.002 });
          addMono(out, pulse, Math.round((t + k * 0.032) * sr), 1, pan);
        }
      }
    }
  }
  if (opts.fire) { const f = fireCrackle(ctx, len / sr, 0.16 * level * opts.fire); for (let i = 0; i < len; i++) { out.l[i]! += f.l[i]! * 0.8 + f.r[i]! * 0.2; out.r[i]! += f.r[i]! * 0.5; } }
  return xf ? loopify(out, body) : out;
}
