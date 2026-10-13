/**
 * Original synthesized voices for "Ebru: Mürekkep Bahçesi" (Turkish paper marbling: pigments floating on
 * size water, golden combs, flower ebru). Everything is built from first principles in code (no samples,
 * no recordings): a kanun-like plucked zither (Karplus-Strong courses with a bright plectrum attack and a
 * skin-bridge body), ud-like low plucks, a rubbed glass-harmonica tone, struck water glasses with a water
 * wobble, kudüm-like small kettle drums, finger cymbals (zil), and water textures (Minnaert bubbles,
 * granular water beds, the wet bristle-on-water texture of the comb). Deterministic given the seeded
 * random source in `ctx`. Approximations of the instruments' colour, not models of any recording.
 */
import { Biquad, Svf, addMono, dcBlock, onePoleCoef, sinCycles, stereo, trimTail, type Stereo } from './dsp';
import { kick, modal, noiseHit, type VoiceCtx } from './instruments';

const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (dst: Float32Array, src: Float32Array, at = 0, gain = 1) => {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i]! += src[i]! * gain;
  return dst;
};
const grow = (a: Float32Array, length: number) => { if (a.length >= length) return a; const b = new Float32Array(length); b.set(a); return b; };

/* ---------------- plucked strings ---------------- */

interface CourseSpec { cents: number; gain: number; ratio?: number }

/**
 * Karplus-Strong string courses into `out`: per course a delay loop with a two-tap loss filter (`tilt` =
 * weight of the newest sample: higher is brighter and keeps the highs ringing), an allpass fractional delay
 * for exact tuning, a low-passed noise excitation with a pick-position comb, and a damper after `releaseAt`.
 */
function strings(ctx: VoiceCtx, out: Float32Array, freq: number, vel: number, courses: CourseSpec[], o: { t60: number; cutoff: number; pick: number; tilt: number; releaseAt: number; damp: number; excGain?: number }) {
  const { sr, rng } = ctx;
  const len = out.length;
  for (const c of courses) {
    const fr = freq * (c.ratio ?? 1) * 2 ** (c.cents / 1200);
    if (fr > sr * 0.4) continue;
    const period = sr / fr;
    const L = Math.max(2, Math.floor(period - 0.5 - 0.001)), frac = period - 0.5 - L, C = (1 - frac) / (1 + frac);
    const loss = 10 ** (-3 / (fr * o.t60)), buf = new Float32Array(L);
    const excN = Math.max(2, Math.round(period)), k = onePoleCoef(o.cutoff, sr);
    const pick = Math.max(1, Math.round(period * o.pick));
    const exc = new Float32Array(excN + pick);
    let lp = 0;
    for (let i = 0; i < excN; i++) { lp += k * ((rng() * 2 - 1) - lp); exc[i] = lp; }
    for (let i = exc.length - 1; i >= pick; i--) exc[i] = exc[i]! - 0.75 * exc[i - pick]!;
    let prev = 0, apx = 0, apy = 0, w = 0, g = 1;
    const stopAt = Math.floor(o.releaseAt * sr), damp = t60Factor(o.damp, sr), a = o.tilt, b = 1 - o.tilt;
    const eg = vel * (o.excGain ?? 1.4);
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

/**
 * Kanun-like plucked zither: three unison strings per course a few cents apart (the shimmering chorus of a
 * triple course), a bright plectrum (mızrap) excitation close to the bridge, a short metallic "tik" on the
 * attack, and a skin-bridge body (a nasal mid resonance over a small box). Notes ring past their written
 * length like an undamped zither; `bright` 0..1.5.
 */
export function kanun(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: { t60?: number; ring?: number } = {}): Float32Array {
  const { sr } = ctx;
  const t60 = opts.t60 ?? clampNum(3.2 * (196 / freq) ** 0.5, 0.9, 4.2);
  const releaseAt = held + (opts.ring ?? 0.32);
  const len = Math.ceil((Math.min(t60, releaseAt + 0.5) + 0.05) * sr) + 64;
  const out = new Float32Array(len);
  strings(ctx, out, freq, vel, [{ cents: -3.5, gain: 0.42 }, { cents: 0, gain: 0.46 }, { cents: 3.2, gain: 0.4 }], {
    t60, cutoff: clampNum(2600 + bright * 6200 * (0.5 + 0.5 * vel), 800, 11000), pick: 0.11, tilt: 0.62 + 0.06 * clampNum(bright, 0, 1.5), releaseAt, damp: 0.18,
  });
  // skin bridge: a nasal resonance around 1.1 kHz and the box around 260 Hz
  const skin = new Biquad(sr).peaking(1150, 1.1, 3.5 * clampNum(bright, 0.4, 1.4)), box = new Biquad(sr).peaking(260, 0.9, 2.5), top = new Biquad(sr).lowpass(9500, 0.6);
  skin.process(out); box.process(out); top.process(out);
  // the plectrum "tik": a tiny bright transient on the attack
  mix(out, noiseHit(ctx, vel * 0.22 * clampNum(bright, 0.3, 1.5), 4200, 1.6, 0.0002, 0.006, 2200, 9500), 0, 1);
  dcBlock(out);
  return trimTail(out);
}

/**
 * Ud-like fretless lute, low plucks: a double course, a darker plectrum (risha) excitation further from the
 * bridge, a warmer loss filter and a round wooden body (peaks near 110, 230 and 480 Hz).
 */
export function ud(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 0.7): Float32Array {
  const { sr } = ctx;
  const t60 = clampNum(1.9 * (110 / freq) ** 0.3, 0.6, 2.4);
  const releaseAt = held + 0.08;
  const len = Math.ceil((Math.min(t60, releaseAt + 0.35) + 0.05) * sr) + 64;
  const out = new Float32Array(len);
  strings(ctx, out, freq, vel, [{ cents: -2, gain: 0.55 }, { cents: 2, gain: 0.52 }], {
    t60, cutoff: clampNum(900 + bright * 2800 * (0.5 + 0.5 * vel), 500, 6000), pick: 0.2, tilt: 0.52, releaseAt, damp: 0.12, excGain: 1.6,
  });
  for (const f of [new Biquad(sr).peaking(110, 1.2, 4), new Biquad(sr).peaking(230, 1.1, 3), new Biquad(sr).peaking(480, 1.4, 1.5), new Biquad(sr).lowpass(3800, 0.65)]) f.process(out);
  mix(out, noiseHit(ctx, vel * 0.12, 1600, 1.2, 0.0004, 0.01, 600, 5000), 0, 1);
  dcBlock(out);
  return trimTail(out);
}

/* ---------------- glass ---------------- */

/**
 * Rubbed glass-harmonica tone: an almost pure sine with a slowly beating twin, faint 2nd/3rd partials,
 * a gentle swell, a tiny amplitude flutter and the faint "rub" of a wet finger (narrow noise on the
 * fundamental). Long release, so phrases blur like ink on water.
 */
export function glassHarp(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: { attack?: number; release?: number; beat?: number } = {}): Float32Array {
  const { sr, rng } = ctx;
  const attack = opts.attack ?? clampNum(held * 0.3, 0.05, 0.25), release = opts.release ?? 0.7;
  const len = Math.ceil((held + release * 2.5) * sr), out = new Float32Array(len);
  const rub = new Biquad(sr).bandpass(freq, 40);
  let a = rng(), b = rng(), c = rng(), d = rng(), fl = rng();
  const beat = opts.beat ?? 0.9 + rng() * 0.6;
  const aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(release * 2.5, sr);
  const h2 = freq * 2 < 9000 ? 0.1 : 0, h3 = freq * 3 < 9000 ? 0.035 : 0;
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const env = i < aN ? Math.sin((i / aN) * Math.PI * 0.5) ** 2 : 1;
    if (i >= heldN) relG *= relD;
    const flutter = 1 + 0.025 * sinCycles(fl);
    const y = sinCycles(a) + 0.32 * sinCycles(b) + h2 * sinCycles(c) + h3 * sinCycles(d) + rub.tick(rng() * 2 - 1) * 0.9;
    a += freq / sr; b += (freq + beat) / sr; c += (freq * 2.003) / sr; d += (freq * 3.01) / sr; fl += 5.1 / sr;
    out[i] = y * env * relG * flutter * vel * 0.5;
  }
  return trimTail(out);
}

/**
 * Struck water glass: wine-glass mode ratios (1, 2.32, 4.25, 6.63) with long decays and a water wobble —
 * the fundamental drifts a few cents as the water inside sways, so each ping "swims" a little.
 */
export function waterGlass(ctx: VoiceCtx, freq: number, vel: number, wobble = 1, length = 1): Float32Array {
  const { sr, rng } = ctx;
  const s = clampNum((880 / freq) ** 0.35, 0.6, 1.6) * length;
  const parts: [number, number, number][] = [[1, 1, 2.6 * s], [2.32, 0.38, 1.3 * s], [4.25, 0.16, 0.6 * s], [6.63, 0.07, 0.3 * s]];
  const len = Math.ceil(Math.min(4, 2.6 * s) * sr) + 64, out = new Float32Array(len);
  const wobRate = 2.4 + rng() * 1.6, wobDepth = 0.0045 * wobble;
  let wp = rng();
  for (const [ratio, amp, t60] of parts) {
    const f = freq * ratio;
    if (f > 9000 || f > sr * 0.45) continue;
    const r = t60Factor(t60, sr), stop = Math.min(len, Math.ceil(t60 * sr));
    let ph = rng(), g = amp * vel;
    wp = rng();
    const aN = Math.round(0.0008 * sr);
    for (let i = 0; i < stop; i++) {
      const wob = 1 + wobDepth * Math.min(1, i / (0.12 * sr)) * sinCycles(wp);
      out[i]! += sinCycles(ph) * g * (i < aN ? i / aN : 1);
      ph += (f * wob) / sr; wp += wobRate / sr; g *= r;
    }
  }
  // the tap of the stick on the rim
  mix(out, noiseHit(ctx, vel * 0.1, 5200, 2, 0.0002, 0.004, 3000, 9500), 0, 1);
  return trimTail(out);
}

/* ---------------- percussion ---------------- */

export type KudumStroke = 'dum' | 'tek';
/** Kudüm-like pair of small kettle drums struck with sticks: "düm" (larger, left) and "tek" (smaller, right); dry and knocky. */
export function kudum(ctx: VoiceCtx, vel: number, stroke: KudumStroke): Float32Array {
  if (stroke === 'dum') {
    const out = kick(ctx, vel * 0.8, 240, 158, 0.012, 0.26, 0.12, 1.1);
    mix(out, modal(ctx, 158, [1, 1.58, 2.18, 2.76], [0.55, 0.3, 0.16, 0.08], [0.24, 0.12, 0.08, 0.05], vel, 10, { attack: 0.0006 }), 0, 0.9);
    mix(out, noiseHit(ctx, vel * 0.45, 1400, 1, 0.0004, 0.018, 500, 6000), 0, 1);
    return trimTail(out);
  }
  const out = modal(ctx, 312, [1, 1.6, 2.28, 3.05, 3.9], [0.7, 0.4, 0.24, 0.12, 0.06], [0.12, 0.08, 0.05, 0.035, 0.022], vel, 10, { attack: 0.0004 });
  return trimTail(mix(grow(out, Math.ceil(0.05 * ctx.sr)), noiseHit(ctx, vel * 0.6, 3600, 1.3, 0.0003, 0.012, 1600, 9000), 0, 1));
}

/** Zil-like finger cymbals: a bright, inharmonic ring with a slow shimmer. */
export function zil(ctx: VoiceCtx, vel: number, freq = 2350, length = 1): Float32Array {
  return modal(ctx, freq, [1, 1.006, 1.47, 2.09, 2.71, 3.36], [0.7, 0.45, 0.4, 0.26, 0.14, 0.07], [1.4 * length, 1.3 * length, 0.8 * length, 0.5 * length, 0.3 * length, 0.18 * length], vel, 10, { attack: 0.0003, maxLen: 2 });
}

/* ---------------- water ---------------- */

/** One Minnaert-style bubble: a sine whose pitch rises as it decays (the "blip" of a bubble leaving the surface). */
export function bubble(ctx: VoiceCtx, freq: number, vel: number, rise = 0.6): Float32Array {
  const { sr } = ctx;
  const tau = clampNum(0.012 * (1000 / freq) ** 0.6, 0.004, 0.05);
  const len = Math.ceil(tau * 7 * sr), out = new Float32Array(len);
  let ph = 0;
  const aN = Math.max(1, Math.round(0.0006 * sr));
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = sinCycles(ph) * vel * Math.exp(-t / tau) * (i < aN ? i / aN : 1);
    ph += (freq * (1 + rise * (t / (tau * 4)))) / sr;
  }
  return out;
}

/** A burst of bubbles over `dur` seconds (random pitch in fLo..fHi, pan and size), shaped 'decay' or 'flat'. */
export function bubbles(ctx: VoiceCtx, dur: number, count: number, vel: number, fLo = 400, fHi = 1600, shape: 'decay' | 'flat' | 'swell' = 'decay'): Stereo {
  const { sr, rng } = ctx;
  const out = stereo(Math.ceil((dur + 0.15) * sr));
  for (let k = 0; k < count; k++) {
    const x = shape === 'decay' ? rng() ** 1.7 : shape === 'swell' ? 1 - rng() ** 1.7 : rng();
    const level = shape === 'decay' ? 1 - 0.6 * x : shape === 'swell' ? 0.4 + 0.6 * x : 1;
    const f = fLo * (fHi / fLo) ** rng();
    addMono(out, bubble(ctx, f, vel * level * (0.45 + 0.55 * rng()), 0.3 + rng() * 0.6), Math.floor(x * dur * sr), 0.8, rng() * 1.6 - 0.8);
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
 * Still-water bed (stereo, loopable): slow lapping (dark noise with a breathing level), a faint surface
 * hiss, a sparse stream of small bubbles and an occasional drip. `intensity` scales the bubbles and drips.
 */
export function waterBed(ctx: VoiceCtx, dur: number, level = 1, intensity = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr) : 0, len = body + xf;
  const out = stereo(len);
  for (const ch of [out.l, out.r]) {
    const lp = new Biquad(sr).lowpass(520, 0.7), lp2 = new Biquad(sr).lowpass(900, 0.6), hp = new Biquad(sr).highpass(60, 0.7), hiss = new Biquad(sr).bandpass(2900, 0.7);
    let brown = 0, l1 = rng(), l2 = rng(), l3 = rng();
    for (let i = -2048; i < len; i++) {
      brown = brown * 0.985 + (rng() * 2 - 1) * 0.16;
      // lapping: three slow, incommensurate swells
      const lap = 0.55 + 0.25 * sinCycles(l1) + 0.14 * sinCycles(l2) + 0.06 * sinCycles(l3);
      l1 += 0.23 / sr; l2 += 0.61 / sr; l3 += 1.37 / sr;
      const v = (hp.tick(lp2.tick(lp.tick(brown))) * 1.6 * lap + hiss.tick(rng() * 2 - 1) * 0.02) * level;
      if (i >= 0) ch[i] = v;
    }
  }
  const n = Math.round(5 * intensity * len / sr);
  for (let k = 0; k < n; k++) addMono(out, bubble(ctx, 350 + rng() * 900, 0.22 * level, 0.3 + rng() * 0.5), Math.floor(rng() * (len - 0.2 * sr)), 1, rng() * 1.6 - 0.8);
  const drips = Math.round(0.7 * intensity * len / sr);
  for (let k = 0; k < drips; k++) {
    const at = Math.floor(rng() * (len - 0.3 * sr)), f = 1300 + rng() * 1500;
    addMono(out, bubble(ctx, f, 0.32 * level, 0.9), at, 1, rng() * 1.4 - 0.7);
    addMono(out, bubble(ctx, f * 0.62, 0.12 * level, 0.5), at + Math.round(0.06 * sr), 1, rng() * 1.4 - 0.7);
  }
  return xf ? loopify(out, body) : out;
}

/**
 * The comb's wet bristle-on-water texture (stereo, flat level so the runtime can shape it): a soft swish of
 * water parting (noise through a slowly wandering band with fast granular amplitude — the bristles), a
 * stream of tiny surface-tension ticks, a gurgle of small bubbles and the low wake behind the comb.
 */
export function bristles(ctx: VoiceCtx, dur: number, vel: number, brightness = 1): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len);
  const fadeN = Math.round(0.03 * sr);
  for (const ch of [out.l, out.r]) {
    const svf = new Svf(sr), wake = new Biquad(sr).lowpass(320, 0.7), top = new Biquad(sr).lowpass(7500, 0.6);
    let centre = rng(), target = rng(), grain = 1, brown = 0;
    for (let i = 0; i < len; i++) {
      if (i % Math.round(0.18 * sr) === 0) target = rng();
      centre += (target - centre) * (2.5 / sr);
      if ((i & 31) === 0) svf.set((900 + 1700 * centre) * brightness, 0.9);
      if (i % Math.max(1, Math.round((0.003 + rng() * 0.005) * sr)) === 0) grain = 0.35 + 0.65 * rng();
      brown = brown * 0.99 + (rng() * 2 - 1) * 0.1;
      const edge = Math.min(1, i / fadeN, (len - 1 - i) / fadeN);
      ch[i] = (top.tick(svf.tick(rng() * 2 - 1, 1)) * 0.5 * grain + wake.tick(brown) * 0.9) * vel * edge;
    }
  }
  // the tines: tiny resonant ticks (pins breaking the surface)
  const ticks = Math.round(160 * dur);
  for (let k = 0; k < ticks; k++) {
    const at = Math.floor(rng() * (len - 0.02 * sr));
    const tick = modal(ctx, (2100 + rng() * 3200) * brightness, [1, 1.9], [1, 0.3], [0.005 + rng() * 0.008, 0.004], vel * (0.08 + rng() * 0.12), 10, { attack: 0.0003, maxLen: 0.03 });
    addMono(out, tick, at, 1, rng() * 1.6 - 0.8);
  }
  // the gurgle
  const n = Math.round(14 * dur);
  for (let k = 0; k < n; k++) addMono(out, bubble(ctx, 500 + rng() * 1000, vel * (0.12 + rng() * 0.14), 0.4 + rng() * 0.6), Math.floor(rng() * (len - 0.1 * sr)), 1, rng() * 1.4 - 0.7);
  return out;
}
