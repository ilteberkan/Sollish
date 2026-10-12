/**
 * Original synthesized voices for "Tarhun: Fırtına Tahtı" (Bronze Age storm-god world). Everything is
 * built from first principles in code (no samples, no recordings): Anatolian-flavoured instruments
 * (davul, darbuka, zurna-like reed, ney-like flute, bağlama-like plucked courses with sympathetic
 * strings, low horns), storm sounds (lightning crack, thunder boom and rumble, rain, wind, electric
 * sizzle), stone and bronze material hits, and a wordless deep "god" voice used as a placeholder until
 * the recorded voice bank exists. Deterministic given the seeded random source in `ctx`.
 */
import { Biquad, Svf, addMono, dcBlock, onePoleCoef, sinCycles, softClip, stereo, trimTail, type Stereo } from './dsp';
import { kick, modal, noiseHit, type VoiceCtx } from './instruments';

const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const blep = (t: number, dt: number) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
const mix = (dst: Float32Array, src: Float32Array, at = 0, gain = 1) => {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i]! += src[i]! * gain;
  return dst;
};
const grow = (a: Float32Array, length: number) => { if (a.length >= length) return a; const b = new Float32Array(length); b.set(a); return b; };

/**
 * Soft crest-factor control for a one-shot (in place): linear up to half a ceiling `crestDb` above the
 * buffer's RMS over its first `window` seconds, then a smooth knee saturating at that ceiling. Makes very
 * short, peaky hits (stone knocks) reach their loudness class without hitting the sample-peak ceiling.
 */
export function softKnee(buf: Float32Array, crestDb: number, sr: number, window = 0.25): Float32Array {
  const n = Math.min(buf.length, Math.max(1, Math.round(window * sr)));
  let s = 0;
  for (let i = 0; i < n; i++) s += buf[i]! * buf[i]!;
  const ceiling = Math.sqrt(s / n) * 10 ** (crestDb / 20);
  if (!(ceiling > 0)) return buf;
  const k = 0.5 * ceiling, span = ceiling - k;
  for (let i = 0; i < buf.length; i++) { const x = buf[i]!, a = x < 0 ? -x : x; if (a > k) buf[i] = (x < 0 ? -1 : 1) * (k + span * softClip((a - k) / span)); }
  return buf;
}

/* ---------------- drums ---------------- */

/** Davul (big double-headed bass drum), mallet side: pitched boom, inharmonic membrane modes, skin slap. */
export function davul(ctx: VoiceCtx, vel: number, freq = 58, length = 0.9): Float32Array {
  let out = kick(ctx, vel, freq * 2.3, freq, 0.028, length, 0.25, 1.5);
  const membrane = modal(ctx, freq * 1.05, [1, 1.59, 2.14, 2.3, 2.65, 2.92], [0.5, 0.32, 0.22, 0.14, 0.1, 0.06], [length * 0.9, 0.36, 0.26, 0.2, 0.15, 0.12], vel, 10, { attack: 0.0015 });
  out = grow(out, membrane.length);
  mix(out, membrane, 0, 0.8);
  mix(out, noiseHit(ctx, vel * 0.55, 820, 0.7, 0.0008, 0.045, 200, 4000), 0, 1);
  return trimTail(out);
}

/** Davul switch (çubuk) on the thin head: a crisp, dry "tak". */
export function davulRim(ctx: VoiceCtx, vel: number): Float32Array {
  const out = noiseHit(ctx, vel * 0.9, 3100, 1.1, 0.0004, 0.034, 900, 8000);
  mix(out, modal(ctx, 410, [1, 2.31, 3.72], [0.45, 0.2, 0.08], [0.06, 0.035, 0.02], vel, 10, { attack: 0.0004 }), 0, 1);
  return trimTail(out);
}

export type DarbukaStroke = 'dum' | 'tek' | 'ka';
/** Darbuka-like goblet drum: "dum" (deep centre), "tek" (ringing rim), "ka" (softer rim, other hand). */
export function darbuka(ctx: VoiceCtx, vel: number, stroke: DarbukaStroke): Float32Array {
  if (stroke === 'dum') {
    const out = kick(ctx, vel, 175, 94, 0.012, 0.34, 0.08, 1.15);
    mix(out, modal(ctx, 96, [1, 1.59, 2.14, 2.65], [0.4, 0.22, 0.12, 0.06], [0.3, 0.16, 0.1, 0.07], vel, 10), 0, 0.8);
    mix(out, noiseHit(ctx, vel * 0.3, 600, 0.8, 0.0008, 0.03, 150, 3000), 0, 1);
    return trimTail(out);
  }
  const f = stroke === 'tek' ? 690 : 600, v = stroke === 'tek' ? vel : vel * 0.75;
  const out = modal(ctx, f, [1, 1.72, 2.41, 3.08, 4.3], [0.8, 0.45, 0.3, 0.16, 0.08], [0.11, 0.08, 0.055, 0.04, 0.025], v, 10, { attack: 0.0003 });
  return trimTail(mix(grow(out, Math.ceil(0.05 * ctx.sr)), noiseHit(ctx, v * 0.55, 4300, 1.2, 0.0003, 0.018, 1800, 9000), 0, 1));
}

/** Bendir-like frame drum: a soft, dark, low-mid thump with a long-ish skin ring. */
export function frameDrum(ctx: VoiceCtx, vel: number, freq = 118): Float32Array {
  const out = kick(ctx, vel, freq * 1.5, freq, 0.02, 0.42, 0.05, 1.05);
  mix(out, modal(ctx, freq, [1, 1.59, 2.14], [0.35, 0.2, 0.1], [0.4, 0.2, 0.12], vel, 10), 0, 0.7);
  mix(out, noiseHit(ctx, vel * 0.25, 420, 0.7, 0.002, 0.05, 100, 2500), 0, 1);
  return trimTail(out);
}

/** Taiko-style thunder drum: huge low boom, membrane ring, stick crack. */
export function taiko(ctx: VoiceCtx, vel: number, freq = 46): Float32Array {
  let out = kick(ctx, vel, freq * 2.7, freq, 0.06, 1.7, 0.3, 1.8);
  const membrane = modal(ctx, freq, [1, 1.5, 1.98, 2.44, 2.92], [0.55, 0.35, 0.22, 0.12, 0.08], [1.6, 0.9, 0.6, 0.42, 0.3], vel, 10, { attack: 0.003 });
  out = grow(out, membrane.length);
  mix(out, membrane, 0, 0.8);
  mix(out, noiseHit(ctx, vel * 0.6, 300, 0.6, 0.001, 0.13), 0, 1);
  mix(out, noiseHit(ctx, vel * 0.35, 1900, 0.9, 0.0004, 0.03, 600, 7000), 0, 1);
  return trimTail(out);
}

/* ---------------- melodic voices ---------------- */

/**
 * Zurna/mey-like double-reed lead: a band-limited pulse + saw source through fixed nasal "bore and bell"
 * resonances, a pitch scoop into every note, a delayed vibrato, a little breath, gentle saturation and a
 * soft top (nothing harsh above ~6 kHz). `bright` 0..1.5 moves the resonances and the top.
 */
export function zurna(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: { scoop?: number; vibrato?: number; mellow?: boolean } = {}): Float32Array {
  const { sr, rng } = ctx;
  const rel = 0.07, len = Math.ceil((held + rel * 4) * sr), out = new Float32Array(len);
  const scoop = opts.scoop ?? 0.035, vibDepth = (opts.vibrato ?? 1) * 0.0065;
  const mellow = !!opts.mellow;
  const width = mellow ? 0.5 : 0.3;
  const bpA = new Biquad(sr).bandpass(1150 * (0.85 + 0.15 * bright), 2.2), bpB = new Biquad(sr).bandpass(2450 * (0.9 + 0.1 * bright), 3), bpC = new Biquad(sr).bandpass(3500, 4);
  const lpBody = new Biquad(sr).lowpass(900, 0.7), top = new Biquad(sr).lowpass((mellow ? 3400 : 5200) * clampNum(bright, 0.6, 1.3), 0.6);
  const breathBp = new Biquad(sr).bandpass(2600, 0.8);
  let p = rng(), vp = rng(), q = (p + width) % 1;
  const aN = Math.max(1, Math.round(0.022 * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 3, sr);
  const vibOnset = Math.min(0.16, held * 0.4);
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const sc = 1 - scoop * Math.exp(-t / 0.028);
    const vib = held > 0.22 ? 1 + vibDepth * Math.min(1, Math.max(0, t - vibOnset) / 0.18) * sinCycles(vp) : 1;
    const f = freq * sc * vib, dt = f / sr;
    const sawP = 2 * p - 1 - blep(p, dt), sawQ = 2 * q - 1 - blep(q, dt);
    const src = 0.6 * (sawP - sawQ) + 0.4 * sawP;
    p += dt; if (p >= 1) p -= 1; q += dt; if (q >= 1) q -= 1; vp += 5.6 / sr;
    let y = bpA.tick(src) * 1.0 + bpB.tick(src) * 0.6 + bpC.tick(src) * 0.22 + lpBody.tick(src) * 0.45;
    y += breathBp.tick(rng() * 2 - 1) * 0.04;
    y = top.tick(softClip(y * 1.6) * 0.62);
    const a = i < aN ? (i / aN) ** 1.5 : 1;
    if (i >= heldN) relG *= relD;
    out[i] = y * a * relG * vel;
  }
  dcBlock(out);
  return trimTail(out);
}

/** Ney-like breathy end-blown flute: soft fundamental, faint harmonics, band-limited breath, slow onset and vibrato. */
export function ney(ctx: VoiceCtx, freq: number, vel: number, held: number): Float32Array {
  const { sr, rng } = ctx;
  const rel = 0.16, len = Math.ceil((held + rel * 3) * sr), out = new Float32Array(len);
  const breath = new Biquad(sr).bandpass(freq * 1.01, 7), air = new Biquad(sr).bandpass(freq * 3.2, 1.2), airHp = new Biquad(sr).highpass(1500);
  let p = rng(), vp = rng(), fl = rng();
  const aN = Math.max(1, Math.round(clampNum(held * 0.25, 0.04, 0.12) * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 2.5, sr);
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const sc = 1 - 0.022 * Math.exp(-t / 0.05);
    const vib = held > 0.3 ? 1 + 0.0045 * Math.min(1, Math.max(0, t - 0.2) / 0.3) * sinCycles(vp) : 1;
    const f = freq * sc * vib;
    const tone = sinCycles(p) + 0.16 * sinCycles(2 * p + 0.1) + 0.05 * sinCycles(3 * p + 0.3);
    p += f / sr; vp += 4.7 / sr; fl += 2.3 / sr;
    const n = rng() * 2 - 1;
    const flutter = 1 + 0.04 * sinCycles(fl);
    // the breath is strongest in the onset ("chiff"), then settles under the tone
    const b = breath.tick(n);
    const y = tone * 0.55 * flutter + b * (1.6 + 0.6 * Math.exp(-t / 0.08)) + airHp.tick(air.tick(n)) * 0.12;
    const a = i < aN ? Math.sin((i / aN) * Math.PI * 0.5) : 1;
    if (i >= heldN) relG *= relD;
    out[i] = y * a * relG * vel * 0.8;
  }
  const lp = new Biquad(sr).lowpass(6500, 0.6); lp.process(out);
  return trimTail(out);
}

/**
 * Bağlama-like plucked lute: Karplus-Strong courses (a unison pair a few cents apart plus an octave
 * string), plectrum excitation with a pick-position comb, and sympathetic drone strings (comb
 * resonators tuned to A2, D3, A3 by default) that ring along with matching partials.
 */
export function baglama(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 0.7, opts: { drones?: number[]; sympathy?: number; t60?: number } = {}): Float32Array {
  const { sr, rng } = ctx;
  const t60 = opts.t60 ?? clampNum(1.9 * (220 / freq) ** 0.45, 0.6, 2.4);
  const releaseAt = held + 0.04;
  const ring = 0.55;
  const len = Math.ceil((Math.min(t60, releaseAt + 0.28) + ring) * sr) + 64;
  const out = new Float32Array(len);
  const course = (f: number, gain: number, cents: number) => {
    const fr = f * 2 ** (cents / 1200), period = sr / fr;
    const L = Math.max(2, Math.floor(period - 0.5 - 0.001)), frac = period - 0.5 - L, C = (1 - frac) / (1 + frac);
    const loss = 10 ** (-3 / (fr * t60)), buf = new Float32Array(L);
    const excN = Math.round(period), c = onePoleCoef(1400 + bright * 5200 * (0.5 + 0.5 * vel), sr);
    const pick = Math.max(1, Math.round(period * 0.17));
    const exc = new Float32Array(excN + pick);
    let lp = 0;
    for (let i = 0; i < excN; i++) { lp += c * ((rng() * 2 - 1) - lp); exc[i] = lp; }
    for (let i = exc.length - 1; i >= pick; i--) exc[i] = exc[i]! - 0.7 * exc[i - pick]!;
    let prev = 0, apx = 0, apy = 0, w = 0;
    const stopAt = Math.floor(releaseAt * sr), damp = t60Factor(0.1, sr);
    let g = 1;
    for (let i = 0; i < len; i++) {
      const read = buf[w]!;
      const avg = (0.58 * read + 0.42 * prev) * loss; prev = read;
      const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
      const v = ap + (i < exc.length ? exc[i]! * vel * 1.4 : 0);
      buf[w] = v; w = w + 1 === L ? 0 : w + 1;
      if (i >= stopAt) g *= damp;
      out[i]! += v * gain * g;
    }
  };
  course(freq, 0.6, -2.5);
  course(freq, 0.55, 2.5);
  if (freq * 2 < 2400) course(freq * 2, 0.22, 1);
  // sympathetic strings: feedback combs with a damping low-pass in the loop, fed a little of the strings
  const drones = opts.drones ?? [110, 146.83, 220], sympathy = opts.sympathy ?? 0.1;
  if (sympathy > 0) {
    const dry = out.slice();
    for (const d of drones) {
      const L = Math.max(2, Math.round(sr / d)), buf = new Float32Array(L), fb = 10 ** (-3 * L / (sr * 1.3));
      let w = 0, lp = 0;
      const k = onePoleCoef(2600, sr);
      for (let i = 0; i < len; i++) {
        const y = buf[w]!;
        lp += k * (y - lp);
        buf[w] = dry[i]! * 0.06 + lp * fb;
        w = w + 1 === L ? 0 : w + 1;
        out[i]! += y * sympathy;
      }
    }
  }
  dcBlock(out);
  return trimTail(out);
}

/**
 * Low brass / horn: two detuned band-limited saws, a lip scoop, and a filter that opens with the level
 * (brass gets brighter as it gets louder). `attack` makes swells; `bright` 0..1.5.
 */
export function horn(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: { attack?: number; bright?: number; release?: number } = {}): Float32Array {
  const { sr, rng } = ctx;
  const attack = opts.attack ?? 0.05, bright = opts.bright ?? 1, rel = opts.release ?? 0.2;
  const len = Math.ceil((held + rel * 3) * sr), out = new Float32Array(len);
  const svf = new Svf(sr);
  let p1 = rng(), p2 = rng(), vp = rng();
  const aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 2.5, sr);
  let relG = 1, env = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const a = i < aN ? (attack > 0.15 ? (i / aN) ** 2 : Math.sin((i / aN) * Math.PI * 0.5)) : 1;
    if (i >= heldN) relG *= relD;
    env = a * relG;
    if ((i & 31) === 0) svf.set(Math.min(5200, 260 + freq * (1.2 + 4.2 * bright * env ** 1.4 * (0.55 + 0.45 * vel))), 0.75);
    const sc = 1 - 0.018 * Math.exp(-t / 0.03);
    const vib = 1 + 0.0025 * Math.min(1, Math.max(0, t - 0.3) / 0.4) * sinCycles(vp);
    const f1 = freq * sc * vib * 2 ** (-4 / 1200), f2 = freq * sc * vib * 2 ** (4 / 1200);
    const s = (2 * p1 - 1 - blep(p1, f1 / sr)) + (2 * p2 - 1 - blep(p2, f2 / sr));
    p1 += f1 / sr; if (p1 >= 1) p1 -= 1; p2 += f2 / sr; if (p2 >= 1) p2 -= 1; vp += 4.4 / sr;
    out[i] = softClip(svf.tick(s * 0.4) * 1.5) * env * vel * 0.7;
  }
  dcBlock(out);
  return trimTail(out);
}

/** A swelling horn chord (stereo, voices spread), for pads and stingers. */
export function hornChord(ctx: VoiceCtx, freqs: number[], vel: number, held: number, opts: { attack?: number; bright?: number } = {}): Stereo {
  const attack = opts.attack ?? clampNum(held * 0.45, 0.06, 0.9);
  const parts = freqs.map(f => horn(ctx, f, vel, held, { attack, bright: opts.bright ?? 0.8, release: 0.3 }));
  const out = stereo(Math.max(...parts.map(p => p.length)));
  parts.forEach((p, i) => addMono(out, p, 0, 0.6 / Math.sqrt(freqs.length), freqs.length > 1 ? (i / (freqs.length - 1)) * 1.1 - 0.55 : 0));
  return out;
}

/** Bronze ring: inharmonic bell-metal partials with slight beating (bowls, cymbal bells, gongs at low pitch). */
export function bronze(ctx: VoiceCtx, freq: number, vel: number, length = 1): Float32Array {
  const s = clampNum((440 / freq) ** 0.3, 0.6, 1.8) * length;
  return modal(ctx, freq, [1, 1.006, 1.47, 2.09, 2.56, 3.21, 4.15, 5.43], [0.8, 0.5, 0.55, 0.42, 0.28, 0.2, 0.12, 0.07], [2.4 * s, 2.2 * s, 1.6 * s, 1.2 * s, 0.9 * s, 0.7 * s, 0.5 * s, 0.32 * s], vel, 10, { attack: 0.0006, maxLen: 5 });
}

/** Glassy electric hum: two sines a breath apart (slow beating) plus a soft fifth and octave, swelling then fading. */
export function glassHum(ctx: VoiceCtx, freq: number, dur: number, vel: number): Float32Array {
  const { sr } = ctx;
  const len = Math.ceil(dur * sr), out = new Float32Array(len);
  let a = ctx.rng(), b = ctx.rng(), c = ctx.rng(), d = ctx.rng();
  for (let i = 0; i < len; i++) {
    const x = i / len, env = Math.min(1, i / (0.008 * sr)) * (1 - x) ** 1.6;
    out[i] = (sinCycles(a) + 0.8 * sinCycles(b) + 0.22 * sinCycles(c) + 0.12 * sinCycles(d)) * env * vel * 0.4;
    a += freq / sr; b += (freq + 2.2) / sr; c += (freq * 1.5) / sr; d += (freq * 2.005) / sr;
  }
  return out;
}

/* ---------------- storm ---------------- */

/** Electric crackle: a Poisson stream of tiny high-passed clicks with flickering hiss, thinning out over `dur`. */
export function sizzle(ctx: VoiceCtx, dur: number, vel: number, rate = 420): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = new Float32Array(len);
  const hp = new Biquad(sr).highpass(2200, 0.7), hiss = new Biquad(sr).bandpass(5200, 1.4);
  let flick = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len, density = (1 - x) ** 1.4;
    let v = 0;
    if (rng() < (rate * density) / sr) v = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * rng() * 1.6);
    if ((i & 63) === 0) flick = rng() < 0.35 ? rng() : flick * 0.6;
    out[i] = hp.tick(v) * vel + hiss.tick(rng() * 2 - 1) * flick * density * vel * 0.35;
  }
  const lp = new Biquad(sr).lowpass(8500, 0.6); lp.process(out);
  return out;
}

/**
 * Lightning crack (stereo): a rip of microsecond cracks, a tearing band-pass sweep falling from bright to
 * dark, then the close boom (dark noise + sub drop). `boom` scales the low end.
 */
export function thunderCrack(ctx: VoiceCtx, vel: number, boom = 1, dur = 1.6): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len);
  for (const [ci, ch] of [out.l, out.r].entries()) {
    // the rip: 6–9 cracks inside 45 ms
    const n = 6 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      const at = Math.round((k === 0 ? 0 : rng() * 0.045) * sr) + (ci ? Math.round(rng() * 0.0015 * sr) : 0);
      mix(ch, noiseHit(ctx, vel * (0.5 + 0.5 * rng()) * (k === 0 ? 1.3 : 1), 3000 + rng() * 2500, 0.5, 0.0002, 0.006 + rng() * 0.012, 700, 9500), at, 1);
    }
    // the tear: band-pass sweeping 2.6 kHz → 260 Hz over ~0.35 s
    const svf = new Svf(sr), tearN = Math.round(0.4 * sr);
    for (let i = 0; i < tearN && i < len; i++) {
      const x = i / tearN;
      if ((i & 31) === 0) svf.set(2600 * (0.1) ** x, 1.1);
      ch[i]! += svf.tick(rng() * 2 - 1, 1) * vel * 0.9 * (1 - x) ** 1.3 * Math.min(1, i / (0.004 * sr));
    }
    // the boom: dark leaky-integrated noise
    let brown = 0;
    const lp = new Biquad(sr).lowpass(180, 0.7), lp2 = new Biquad(sr).lowpass(320, 0.6);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      brown = brown * 0.985 + (rng() * 2 - 1) * 0.15;
      const env = Math.min(1, t / 0.025) * Math.exp(-t / (0.32 + 0.18 * boom));
      ch[i]! += lp2.tick(lp.tick(brown)) * env * vel * boom * 1.2;
    }
  }
  const sub = kick(ctx, vel * boom, 70, 30, 0.08, Math.min(dur, 1.3), 0, 1.4);
  addMono(out, sub, 0, 0.45);
  return out;
}

/**
 * Thunder rumble (stereo): long rolling low noise — several overlapping bursts of dark leaky-integrated
 * noise at random times, the first one strongest. `distance` 0 near … 1 far (darker, softer onset).
 */
export function thunderRumble(ctx: VoiceCtx, dur: number, vel: number, distance = 0.5): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len);
  const bursts: { at: number; tau: number; amp: number; rise: number }[] = [];
  const count = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < count; k++) bursts.push({ at: k === 0 ? 0.05 * dur : (0.08 + rng() * 0.6) * dur, tau: 0.35 + rng() * 0.9, amp: k === 0 ? 1 : 0.35 + rng() * 0.5, rise: 0.06 + distance * 0.35 + rng() * 0.1 });
  const env = new Float32Array(len);
  for (const b of bursts) {
    const s = Math.floor(b.at * sr);
    for (let i = s; i < len; i++) { const t = (i - s) / sr; env[i]! += b.amp * Math.min(1, t / b.rise) * Math.exp(-t / b.tau); }
  }
  const fade = Math.min(len, Math.round(0.4 * sr));
  for (let i = 0; i < fade; i++) env[len - 1 - i]! *= i / fade;
  for (const ch of [out.l, out.r]) {
    let brown = 0, wob = rng();
    const lp = new Biquad(sr).lowpass(420 - distance * 260, 0.6), lp2 = new Biquad(sr).lowpass(600 - distance * 320, 0.6), hp = new Biquad(sr).highpass(28, 0.7);
    for (let i = 0; i < len; i++) {
      brown = brown * 0.99 + (rng() * 2 - 1) * 0.12;
      const flutter = 0.75 + 0.25 * sinCycles(wob); wob += (3 + 2 * rng()) / sr;
      ch[i] = hp.tick(lp2.tick(lp.tick(brown))) * env[i]! * flutter * vel * 2.4;
    }
  }
  return out;
}

/** Equal-power cross-fade of a rendered tail into the head, so a noise bed of `body` samples loops seamlessly. */
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

/**
 * Rain bed (stereo): soft high hiss, a dark patter band, and a Poisson stream of tiny resonant droplets
 * (random pitch, pan and size), with slow intensity breathing. Loopable like the room tone.
 */
export function rain(ctx: VoiceCtx, dur: number, level = 1, intensity = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr) : 0, len = body + xf;
  const out = stereo(len);
  for (const ch of [out.l, out.r]) {
    const hp = new Biquad(sr).highpass(1300, 0.6), lp = new Biquad(sr).lowpass(6800, 0.6), patter = new Biquad(sr).bandpass(520, 0.9);
    let lfo = rng();
    for (let i = -2048; i < len; i++) {
      const w = rng() * 2 - 1;
      const breath = 0.82 + 0.18 * sinCycles(lfo); lfo += 0.07 / sr;
      const v = (lp.tick(hp.tick(w)) * 0.22 + patter.tick(rng() * 2 - 1) * 0.16) * breath * level;
      if (i >= 0) ch[i] = v;
    }
  }
  // droplets: ~70 per second at intensity 1
  const drops = Math.round(70 * intensity * len / sr);
  const dropLen = Math.ceil(0.03 * sr);
  for (let k = 0; k < drops; k++) {
    const at = Math.floor(rng() * (len - dropLen)), big = rng() < 0.08;
    const f = big ? 900 + rng() * 700 : 1900 + rng() * 3600, t60 = big ? 0.03 : 0.006 + rng() * 0.012;
    const drop = modal(ctx, f, [1, 1.9], [1, 0.25], [t60, t60 * 0.5], (big ? 0.5 : 0.18 + rng() * 0.22) * level, 10, { attack: 0.0004, maxLen: 0.05 });
    addMono(out, drop, at, 1, rng() * 1.8 - 0.9);
  }
  return xf ? loopify(out, body) : out;
}

/** Wind bed (stereo): noise through a slowly wandering band-pass with gusts; loopable. */
export function wind(ctx: VoiceCtx, dur: number, level = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr) : 0, len = body + xf;
  const out = stereo(len);
  for (const ch of [out.l, out.r]) {
    const svf = new Svf(sr), lp = new Biquad(sr).lowpass(2400, 0.6);
    let centre = 0.5, target = 0.5, gust = 0.6, gustTarget = 0.6;
    for (let i = 0; i < len; i++) {
      if (i % Math.round(0.5 * sr) === 0) { target = rng(); gustTarget = 0.35 + 0.65 * rng() ** 1.5; }
      centre += (target - centre) * (1 / (1.4 * sr)) * 3; gust += (gustTarget - gust) * (1 / (1.1 * sr)) * 3;
      if ((i & 63) === 0) svf.set(260 * (900 / 260) ** centre, 1.6 + centre);
      ch[i] = lp.tick(svf.tick(rng() * 2 - 1, 1)) * gust * level * 0.7;
    }
  }
  return xf ? loopify(out, body) : out;
}

/* ---------------- stone ---------------- */

/** Stone block landing: a dull low thud, short inharmonic stone modes and a little grit. `size` > 1 is heavier. */
export function stoneThud(ctx: VoiceCtx, vel: number, size = 1): Float32Array {
  const out = kick(ctx, vel * 0.55, 190 / size, 68 / size, 0.014, 0.2 * size, 0.1, 1.3);
  mix(out, noiseHit(ctx, vel * 0.9, 520 / size, 0.8, 0.0008, 0.05, 120, 2600), 0, 1);
  mix(out, modal(ctx, 255 / size, [1, 2.31, 3.86, 5.21, 7.1], [0.5, 0.4, 0.28, 0.16, 0.08], [0.08, 0.05, 0.034, 0.024, 0.015], vel, 10, { attack: 0.0006 }), 0, 1.3);
  for (let k = 0; k < 4; k++) mix(out, noiseHit(ctx, vel * 0.12, 2600 + ctx.rng() * 2400, 1.5, 0.0003, 0.006, 1500, 8000), Math.round((0.004 + ctx.rng() * 0.05) * ctx.sr), 1);
  return trimTail(out);
}

/** Stone shatter: sharp crack impulses, a crunch, and debris ticks thinning out over `spread` seconds (stereo). */
export function stoneShatter(ctx: VoiceCtx, vel: number, pieces = 10, spread = 0.35): Stereo {
  const { sr, rng } = ctx;
  const out = stereo(Math.ceil((spread + 0.25) * sr));
  addMono(out, noiseHit(ctx, vel, 2600, 0.6, 0.0003, 0.03, 700, 9000), 0, 1, 0);
  addMono(out, noiseHit(ctx, vel * 0.7, 900, 0.7, 0.0005, 0.06, 200, 5000), Math.round(0.003 * sr), 1, 0);
  for (let k = 0; k < pieces; k++) {
    const x = rng() ** 1.6;
    const tick = modal(ctx, 1500 + rng() * 3500, [1, 2.37], [1, 0.3], [0.012 + rng() * 0.02, 0.008], vel * (0.7 - 0.5 * x) * (0.4 + 0.6 * rng()), 10, { attack: 0.0003, maxLen: 0.06 });
    addMono(out, tick, Math.round((0.01 + x * spread) * sr), 0.8, rng() * 1.6 - 0.8);
  }
  return out;
}

/* ---------------- the god's wordless voice (placeholder until the recorded bank) ---------------- */

/** Male vowel formants (Hz) and gains for the deep wordless voice. */
const MALE = {
  ah: { f: [690, 1120, 2450], g: [1, 0.55, 0.16] },
  oh: { f: [450, 780, 2420], g: [1, 0.45, 0.1] },
  uh: { f: [560, 980, 2380], g: [1, 0.45, 0.12] },
  mm: { f: [240, 1050, 2300], g: [1, 0.05, 0.02] },
} as const;
export type MaleVowel = keyof typeof MALE;

export interface Syllable { t: number; dur: number; f0: number; f1: number; from: MaleVowel; to: MaleVowel; breath?: number; vel?: number }

/**
 * Deep wordless voice: per syllable a glottal-like band-limited saw with a sub-octave growl, jitter, an
 * aspiration "h" at the onset and three moving formants; a soft chest double an octave below. Non-verbal
 * by design (hum / grunt / laugh shapes), meant to be replaced by recorded lines.
 */
export function deepVoice(ctx: VoiceCtx, syllables: Syllable[], vel: number): Float32Array {
  const { sr, rng } = ctx;
  const end = Math.max(...syllables.map(s => s.t + s.dur)) + 0.3;
  const out = new Float32Array(Math.ceil(end * sr));
  for (const s of syllables) {
    const n = Math.ceil((s.dur + 0.12) * sr), at = Math.round(s.t * sr), bodyN = Math.floor(s.dur * sr);
    const A = MALE[s.from], B = MALE[s.to];
    const filters = [new Svf(sr), new Svf(sr), new Svf(sr)], asp = new Biquad(sr).bandpass(1500, 0.8);
    let p = rng(), sub = rng(), jit = 0;
    const relD = t60Factor(0.09, sr), aN = Math.round(0.03 * sr), hN = Math.round((s.breath ?? 0.05) * sr);
    let relG = 1;
    const v0 = (s.vel ?? 1) * vel;
    for (let i = 0; i < n; i++) {
      const x = Math.min(1, i / Math.max(1, bodyN));
      if ((i & 255) === 0) jit = (rng() * 2 - 1) * 0.004;
      const f = s.f0 * (s.f1 / s.f0) ** (x * x * (3 - 2 * x)) * (1 + jit);
      const dt = f / sr;
      const src = (2 * p - 1 - blep(p, dt)) + 0.5 * sinCycles(sub);
      p += dt; if (p >= 1) p -= 1; sub += dt * 0.5;
      const m = Math.min(1, i / Math.max(1, 0.6 * bodyN));
      if ((i & 15) === 0) for (let k = 0; k < 3; k++) { const fk = A.f[k]! + (B.f[k]! - A.f[k]!) * m; filters[k]!.set(fk, fk / (60 + 30 * k)); }
      let y = 0;
      for (let k = 0; k < 3; k++) y += filters[k]!.tick(src * 0.32, 1) * (A.g[k]! + (B.g[k]! - A.g[k]!) * m);
      // aspiration: breathy "h" before the voice settles
      if (i < hN * 2) y += asp.tick(rng() * 2 - 1) * 0.35 * Math.max(0, 1 - i / (hN * 2));
      const voicedIn = i < hN ? 0.15 + 0.85 * (i / hN) : 1;
      if (i >= bodyN) relG *= relD;
      const a = i < aN ? i / aN : 1;
      out[at + i]! += softClip(y * 1.4) * a * voicedIn * relG * v0;
    }
  }
  const lp = new Biquad(sr).lowpass(3800, 0.6); lp.process(out);
  const hp = new Biquad(sr).highpass(45, 0.7); hp.process(out);
  return trimTail(out);
}

export type GodVocal = 'hum' | 'grunt' | 'laugh';
/** Placeholder vocal shapes: a satisfied "mm-HMM", a power "HAH!", a rolling "ho-ho-HAAA". */
export function godVocal(ctx: VoiceCtx, kind: GodVocal, variation = 0, vel = 1): Float32Array {
  const k = 1 + (variation - 1) * 0.045; // small pitch offset per variation
  switch (kind) {
    case 'hum': return deepVoice(ctx, [
      { t: 0, dur: 0.32, f0: 84 * k, f1: 96 * k, from: 'mm', to: 'mm', breath: 0.01 },
      { t: 0.38, dur: 0.62, f0: 104 * k, f1: 80 * k, from: 'mm', to: 'oh', breath: 0.02, vel: 1.1 },
    ], vel);
    case 'grunt': return deepVoice(ctx, [{ t: 0, dur: 0.36 + variation * 0.03, f0: 122 * k, f1: 92 * k, from: 'ah', to: 'uh', breath: 0.05 }], vel);
    case 'laugh': {
      const syl: Syllable[] = [];
      const pitches = [128, 118, 110, 104];
      pitches.forEach((f, i) => syl.push({ t: i * 0.2, dur: 0.13, f0: f * k, f1: f * 0.93 * k, from: 'oh', to: 'oh', breath: 0.04, vel: 0.85 + i * 0.05 }));
      syl.push({ t: pitches.length * 0.2 + 0.04, dur: 0.75, f0: 124 * k, f1: 78 * k, from: 'ah', to: 'oh', breath: 0.05, vel: 1.15 });
      return deepVoice(ctx, syl, vel);
    }
  }
}
