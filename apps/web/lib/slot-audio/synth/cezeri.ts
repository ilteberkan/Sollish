/**
 * Original synthesized voices for "Cezeri: Zamanın Çarkları" (the 12th-century Artuqid engineer al-Jazari's automata:
 * the elephant clock, water clocks, automaton musicians, brass gear trains, escapements, a mechanical falcon).
 * Everything is built from first principles in code (no samples, no recordings): a santur-like hammered dulcimer
 * (Karplus-Strong courses with a felt-hammer excitation), an automaton flute and a water organ (additive flue pipes
 * with chiff and a water-pressure wobble), a clock-gong chime rod, naqqara-like kettledrums and a big kös, Turkish hand
 * cymbals, the clock mechanism itself (escapement tick/tock, pawl-and-ratchet clicks, brass gear clanks and the whirr of
 * a meshing gear train), water-clock drips into brass bowls, a filling vessel, the courtyard fountain bed, the
 * water-whistle "bird" of the automata and wing beats. Deterministic given the seeded random source in `ctx`.
 * Approximations of the instruments' colour, not models of any recording.
 */
import { Biquad, Svf, addMono, dcBlock, onePoleCoef, sinCycles, stereo, trimTail, upsample, type Stereo } from './dsp';
import { kick, modal, noiseHit, type VoiceCtx } from './instruments';
import { bubble } from './ebru';

const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (dst: Float32Array, src: Float32Array, at = 0, gain = 1) => {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i]! += src[i]! * gain;
  return dst;
};
const grow = (a: Float32Array, length: number) => { if (a.length >= length) return a; const b = new Float32Array(length); b.set(a); return b; };
/** A raised-cosine onset of `ms` (the mallet's contact): keeps a big drum's first samples from stepping hard. */
const onset = (a: Float32Array, sr: number, ms = 0.7) => { const n = Math.min(a.length, Math.round(ms * 0.001 * sr)); for (let i = 0; i < n; i++) a[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n); return a; };

/* ---------------- hammered strings ---------------- */

/**
 * Karplus-Strong string courses struck by a hammer, into `out`: per string a delay loop with a two-tap loss filter
 * (`tilt` = weight of the newest sample: brighter wire), an allpass fractional delay for exact tuning, a raised-cosine
 * hammer pulse of `hammerMs` contact time (longer = softer felt; it low-passes high notes naturally), a strike-position
 * comb and a little wire noise, and a hand damper after `releaseAt`.
 */
function hammered(ctx: VoiceCtx, out: Float32Array, freq: number, vel: number, cents: number[], o: { t60: number; hammerMs: number; pos: number; tilt: number; releaseAt: number; damp: number; noise: number }) {
  const { sr, rng } = ctx;
  const len = out.length, gain = 1 / Math.sqrt(cents.length);
  for (const c of cents) {
    const fr = freq * 2 ** (c / 1200);
    if (fr > sr * 0.4) continue;
    const period = sr / fr;
    const L = Math.max(2, Math.floor(period - 0.5 - 0.001)), frac = period - 0.5 - L, C = (1 - frac) / (1 + frac);
    const loss = 10 ** (-3 / (fr * o.t60)), buf = new Float32Array(L);
    const hN = Math.max(2, Math.round(o.hammerMs * 0.001 * sr)), pos = Math.max(1, Math.round(period * o.pos));
    const exc = new Float32Array(hN + pos);
    const scale = Math.min(1, period / hN) * 1.6;
    for (let i = 0; i < hN; i++) exc[i] = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / hN)) * scale + (rng() * 2 - 1) * o.noise;
    for (let i = exc.length - 1; i >= pos; i--) exc[i] = exc[i]! - 0.85 * exc[i - pos]!;
    let prev = 0, apx = 0, apy = 0, w = 0, g = 1;
    const stopAt = Math.floor(o.releaseAt * sr), damp = t60Factor(o.damp, sr), a = o.tilt, b = 1 - o.tilt;
    for (let i = 0; i < len; i++) {
      const read = buf[w]!;
      const avg = (a * read + b * prev) * loss; prev = read;
      const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
      const v = ap + (i < exc.length ? exc[i]! * vel : 0);
      buf[w] = v; w = w + 1 === L ? 0 : w + 1;
      if (i >= stopAt) { g *= damp; if (g < 1e-4) break; }
      out[i]! += v * gain * g;
    }
  }
}

export interface SanturOptions { courses?: 2 | 3 | 4; ring?: number }
/**
 * Santur-like hammered dulcimer: four unison wires per course a few cents apart (the shimmering beat of a struck
 * course), a light felt-and-wood hammer (harder and brighter with velocity), a long free ring with a soft hand damper,
 * a trapezoid box body (resonances near 340 Hz and 2.1 kHz) and the faint "ting" of the hammer on the wire.
 */
export function santur(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1, opts: SanturOptions = {}): Float32Array {
  const { sr } = ctx;
  const t60 = clampNum(4.2 * (220 / freq) ** 0.55, 0.9, 5);
  const releaseAt = held + (opts.ring ?? 0.85);
  const len = Math.ceil((Math.min(t60, releaseAt + 0.6) + 0.05) * sr) + 64;
  const out = new Float32Array(len);
  const n = opts.courses ?? 4;
  const cents = n === 4 ? [-2.6, -0.9, 0.8, 2.7] : n === 3 ? [-2, 0.2, 2.2] : [-1.8, 1.8];
  const b = clampNum(bright, 0.2, 1.6);
  hammered(ctx, out, freq, vel, cents, { t60, hammerMs: clampNum(1.15 - 0.55 * vel * b, 0.35, 1.3), pos: 0.13, tilt: 0.66 + 0.06 * b, releaseAt, damp: 0.35, noise: 0.08 * b });
  for (const f of [new Biquad(sr).peaking(340, 1, 3), new Biquad(sr).peaking(2100, 1.2, 2.5 * b), new Biquad(sr).lowpass(10500, 0.6)]) f.process(out);
  mix(out, noiseHit(ctx, vel * 0.08 * b, 6200, 2, 0.0001, 0.004, 3500, 11000), 0, 1);
  dcBlock(out);
  return trimTail(out);
}

/* ---------------- pipes ---------------- */

export interface PipeOptions { rank?: 'flute' | 'organ'; chiff?: number; attack?: number; release?: number }
/**
 * Flue pipe, additive: the automaton flute ('flute': a soft fundamental, faint upper harmonics, wind noise and a steady
 * mechanical tremulant from the bellows) or the water organ ('organ': a principal rank plus a slightly sharp celeste
 * rank and a quiet octave, with the slow pitch/level wobble of water-regulated wind pressure). Both speak with a short
 * noisy chiff. No human vibrato: these are machines playing.
 */
export function pipe(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: PipeOptions = {}): Float32Array {
  const { sr, rng } = ctx;
  const organ = opts.rank === 'organ';
  const rel = opts.release ?? (organ ? 0.18 : 0.08);
  const len = Math.ceil((held + rel * 4) * sr), out = new Float32Array(len);
  const amps = organ ? [1, 0.55, 0.34, 0.22, 0.13, 0.08, 0.05] : [1, 0.3, 0.12, 0.05, 0.025];
  const parts: { inc: number; amp: number; ph: number }[] = [];
  amps.forEach((a, k) => { const f = freq * (k + 1); if (f < 9000 && f < sr * 0.45) parts.push({ inc: f / sr, amp: a, ph: rng() }); });
  if (organ) { if (freq * 1.0035 < sr * 0.45) parts.push({ inc: (freq * 1.0035) / sr, amp: 0.55, ph: rng() }); if (freq * 2 < sr * 0.45) parts.push({ inc: (freq * 2.002) / sr, amp: 0.3, ph: rng() }); }
  const norm = 0.5 / Math.sqrt(parts.reduce((s, p) => s + p.amp * p.amp, 0));
  const wind = new Biquad(sr).bandpass(freq, organ ? 12 : 6), chiffBp = new Biquad(sr).bandpass(Math.min(sr * 0.4, freq * 3.2), 2.5);
  const attack = opts.attack ?? (organ ? 0.07 : 0.035), aN = Math.max(1, Math.round(attack * sr)), heldN = Math.floor(held * sr), relD = t60Factor(rel * 2.5, sr);
  const chiff = (opts.chiff ?? 1) * (organ ? 0.18 : 0.3), chiffD = t60Factor(0.05, sr);
  let lfo = rng(), relG = 1, cg = 1;
  const lfoRate = organ ? 0.8 : 5.4, pitchDepth = organ ? 0.0013 : 0, ampDepth = organ ? 0.025 : 0.03;
  for (let i = 0; i < len; i++) {
    const m = sinCycles(lfo); lfo += lfoRate / sr;
    const pm = 1 + pitchDepth * m;
    let y = 0;
    for (const p of parts) { y += sinCycles(p.ph) * p.amp; p.ph += p.inc * pm; }
    const n = rng() * 2 - 1;
    y = y * norm * (1 + ampDepth * m) + wind.tick(n) * (organ ? 0.05 : 0.12) + chiffBp.tick(n) * chiff * cg;
    cg *= chiffD;
    const a = i < aN ? Math.sin((i / aN) * Math.PI * 0.5) : 1;
    if (i >= heldN) relG *= relD;
    out[i] = y * a * relG * vel;
  }
  return trimTail(out);
}

/** The flue pipe at half rate and interpolated up when its partials allow it (half the cost; full rate for high notes). */
export function pipeFast(ctx: VoiceCtx, freq: number, vel: number, held: number, opts: PipeOptions = {}): Float32Array {
  const top = freq * (opts.rank === 'organ' ? 7 : 5);
  if (top > ctx.sr * 0.2) return pipe(ctx, freq, vel, held, opts);
  return upsample(pipe({ sr: ctx.sr / 2, rng: ctx.rng }, freq, vel, held, opts), 2);
}

/* ---------------- metal ---------------- */

/** Clock-gong chime rod (free-free bar modes 1 : 2.756 : 5.404 : 8.933, a beating twin of the fundamental), struck with a small brass hammer. */
export function chimeRod(ctx: VoiceCtx, freq: number, vel: number, length = 1): Float32Array {
  const s = clampNum((523 / freq) ** 0.4, 0.5, 1.7) * length;
  const out = modal(ctx, freq, [1, 1.0016, 2.756, 5.404, 8.933], [0.85, 0.35, 0.42, 0.17, 0.07], [3 * s, 2.6 * s, 1.2 * s, 0.55 * s, 0.28 * s], vel, 10, { attack: 0.0004, maxLen: 4 });
  return onset(mix(out, noiseHit(ctx, vel * 0.12, 5200, 2, 0.0002, 0.005, 3000, 10000), 0, 1), ctx.sr, 0.6);
}

/** Turkish hand cymbals clashed: two slightly detuned bronze plates (inharmonic modes with beating) and the bright clash noise. `length` scales the ring. */
export function handCymbal(ctx: VoiceCtx, vel: number, length = 1, freq = 470): Float32Array {
  const ratios = [1, 1.18, 1.47, 1.83, 2.21, 2.69, 3.16, 3.74, 4.41, 5.2, 6.1, 7.2, 8.4];
  const amps = ratios.map((_, i) => 0.5 * 0.9 ** i), t60s = ratios.map((_, i) => (1.9 - i * 0.1) * length);
  const out = modal(ctx, freq, ratios, amps, t60s, vel * 0.5, 10, { attack: 0.0004, maxLen: 3 });
  mix(out, modal(ctx, freq * 1.013, ratios, amps, t60s.map(t => t * 0.9), vel * 0.4, 10, { attack: 0.0006, maxLen: 3 }), 0, 1);
  const clash = noiseHit(ctx, vel * 0.9, 5600, 0.8, 0.0006, 0.32 * length, 2500, 11000);
  return onset(mix(grow(out, clash.length), clash, 0, 1), ctx.sr, 1.5);
}

/** Escapement: the brass pallet catching the escape wheel. 'tick' is the bright entry pallet, 'tock' the duller exit pallet, both with the wooden case knock. */
export function escapement(ctx: VoiceCtx, vel: number, kind: 'tick' | 'tock'): Float32Array {
  const f = kind === 'tick' ? 3150 : 2250, body = kind === 'tick' ? 820 : 610;
  const out = noiseHit(ctx, vel * 0.7, f * 1.4, 2.2, 0.0002, 0.006, 1500, 10000);
  mix(out, modal(ctx, f, [1, 1.47, 2.31], [0.5, 0.3, 0.15], [0.035, 0.02, 0.012], vel, 10, { attack: 0.0002 }), 0, 1);
  return trimTail(mix(grow(out, Math.ceil(0.06 * ctx.sr)), modal(ctx, body, [1, 2.4], [0.35, 0.12], [0.045, 0.02], vel, 10), 0, 1));
}

/** Pawl-and-ratchet click: the steel pawl dropping onto a brass tooth (`size` > 1 = a bigger wheel, lower and fuller). */
export function ratchet(ctx: VoiceCtx, vel: number, size = 1): Float32Array {
  const out = noiseHit(ctx, vel * 0.8, 6200 / Math.sqrt(size), 1.6, 0.0001, 0.0035, 2500, 11000);
  mix(out, modal(ctx, 2600 / size, [1, 1.73, 2.88], [0.45, 0.25, 0.12], [0.018, 0.012, 0.008], vel, 10, { attack: 0.0002 }), 0, 1);
  return trimTail(mix(grow(out, Math.ceil(0.04 * ctx.sr)), modal(ctx, 420 / size, [1, 2.3], [0.25, 0.08], [0.03, 0.015], vel, 10), 0, 1));
}

/**
 * Brass gear clank: a heavy toothed wheel dropping into mesh — a low thud, the thick-disc ring of the brass (eight
 * inharmonic modes), the metallic scrape of the teeth and, with `latch`, the pawl falling in and a smaller second clank.
 */
export function gearClank(ctx: VoiceCtx, vel: number, size = 1, latch = true): Float32Array {
  const { sr } = ctx, f = 300 / size, k = size ** 0.3;
  let out = kick(ctx, vel * 0.55, 190 / size, 72 / size, 0.012, 0.2, 0.15, 1.2);
  const metal = modal(ctx, f, [1, 1.62, 2.34, 2.97, 3.61, 4.43, 5.37, 6.6], [0.55, 0.42, 0.36, 0.25, 0.18, 0.12, 0.08, 0.05], [0.75, 0.55, 0.42, 0.32, 0.24, 0.17, 0.12, 0.08].map(x => x * k), vel, 10, { attack: 0.0005 });
  out = grow(out, metal.length);
  mix(out, metal, 0, 0.9);
  mix(out, noiseHit(ctx, vel * 0.6, 2600 / k, 1.1, 0.0003, 0.04, 700, 9000), 0, 1);
  if (latch) {
    out = grow(out, Math.ceil(0.5 * sr));
    mix(out, ratchet(ctx, vel * 0.8, size), Math.round(0.032 * sr), 0.8);
    mix(out, modal(ctx, f * 1.5, [1, 1.62, 2.34, 2.97], [0.4, 0.3, 0.2, 0.1], [0.25, 0.18, 0.12, 0.08], vel * 0.5, 10), Math.round(0.06 * sr), 1);
  }
  dcBlock(out);
  return trimTail(out);
}

/* ---------------- drums ---------------- */

/** Naqqara-like pair of small copper kettledrums with sticks: tuned, quasi-harmonic kettle modes (1 : 1.5 : 2 : 2.5), 'dum' the larger, 'tek' the smaller. */
export function naqqara(ctx: VoiceCtx, vel: number, stroke: 'dum' | 'tek', freq?: number): Float32Array {
  if (stroke === 'dum') {
    const f = freq ?? 130.81;
    const out = kick(ctx, vel * 0.7, f * 1.9, f, 0.01, 0.32, 0.1, 1.1);
    const m = modal(ctx, f, [1, 1.5, 1.99, 2.47, 2.96], [0.6, 0.35, 0.2, 0.1, 0.05], [0.42, 0.25, 0.15, 0.1, 0.07], vel, 10, { attack: 0.0005 });
    const o = grow(out, m.length);
    mix(o, m, 0, 0.8);
    return onset(trimTail(mix(o, noiseHit(ctx, vel * 0.5, 2200, 1.2, 0.0003, 0.015, 700, 8000), 0, 1)), ctx.sr, 0.5);
  }
  const f = freq ?? 196;
  const out = modal(ctx, f, [1, 1.5, 1.99, 2.47, 2.96, 3.5], [0.65, 0.4, 0.25, 0.13, 0.07, 0.04], [0.26, 0.16, 0.1, 0.07, 0.05, 0.03], vel, 10, { attack: 0.0004 });
  return trimTail(mix(grow(out, Math.ceil(0.05 * ctx.sr)), noiseHit(ctx, vel * 0.7, 3800, 1.4, 0.0003, 0.01, 1600, 9000), 0, 1));
}

/** Kös-like great kettledrum (the elephant clock's big drum): a long pitched boom, kettle modes and the leather slap of the mallet. */
export function kos(ctx: VoiceCtx, vel: number, freq = 65.41): Float32Array {
  let out = kick(ctx, vel, freq * 2.4, freq, 0.035, 1.3, 0.2, 1.6);
  const m = modal(ctx, freq, [1, 1.5, 1.98, 2.44, 2.92], [0.55, 0.4, 0.22, 0.12, 0.07], [1.2, 0.8, 0.5, 0.35, 0.25], vel, 10, { attack: 0.002 });
  out = grow(out, m.length);
  mix(out, m, 0, 0.8);
  mix(out, noiseHit(ctx, vel * 0.45, 520, 0.7, 0.001, 0.06, 120, 3500), 0, 1);
  return onset(trimTail(out), ctx.sr, 1);
}

/* ---------------- water ---------------- */

/** Water-clock drip into a tuned brass bowl: a small Minnaert "plip" and the bowl ringing at `freq` (modes 1 : 2.71 : 5.06 : 8). */
export function drip(ctx: VoiceCtx, freq: number, vel: number, length = 1): Float32Array {
  const s = clampNum((880 / freq) ** 0.3, 0.6, 1.5) * length;
  const out = modal(ctx, freq, [1, 2.71, 5.06, 8], [0.7, 0.25, 0.1, 0.04], [1.6 * s, 0.8 * s, 0.35 * s, 0.18 * s], vel, 10, { attack: 0.0006, maxLen: 3 });
  return mix(out, bubble(ctx, 1500 + ctx.rng() * 900, vel * 0.5, 0.9), 0, 1);
}

/** Water poured into a vessel: noise through a resonance that rises as the air column shortens (f0 → f1), with a gurgle and the first splash. */
export function pour(ctx: VoiceCtx, dur: number, vel: number, f0 = 320, f1 = 1500): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len), mono = new Float32Array(len);
  const svf = new Svf(sr), lo = new Biquad(sr).lowpass(500, 0.7), fadeN = Math.round(0.04 * sr);
  let brown = 0, grain = 1;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    if ((i & 31) === 0) svf.set(f0 * (f1 / f0) ** (x ** 0.8), 7);
    if (i % Math.max(1, Math.round((0.004 + rng() * 0.01) * sr)) === 0) grain = 0.5 + 0.5 * rng();
    brown = brown * 0.985 + (rng() * 2 - 1) * 0.15;
    const edge = Math.min(1, i / fadeN, (len - 1 - i) / fadeN);
    mono[i] = (svf.tick(rng() * 2 - 1, 1) * 0.6 * grain + lo.tick(brown) * 0.7) * vel * edge;
  }
  addMono(out, mono, 0, 1, 0);
  const n = Math.round(18 * dur);
  for (let k = 0; k < n; k++) addMono(out, bubble(ctx, 450 + rng() * 1300 * (0.5 + k / n), vel * (0.12 + rng() * 0.15), 0.5 + rng() * 0.5), Math.floor(rng() * (len - 0.1 * sr)), 1, rng() * 1.4 - 0.7);
  return out;
}

/** Water-whistle "bird" of the automata: a pipe-whistle tone gliding f0 → f1 with the fast bubbling warble of water in the whistle. */
export function birdWhistle(ctx: VoiceCtx, f0: number, f1: number, dur: number, vel: number, trill = 26): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil((dur + 0.08) * sr), out = new Float32Array(len);
  const breath = new Biquad(sr).bandpass(f1, 4);
  let p = rng(), tp = rng(), depth = 0.5;
  const aN = Math.round(0.015 * sr), bodyN = Math.floor(dur * sr), relD = t60Factor(0.06, sr);
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const x = Math.min(1, i / bodyN);
    if ((i & 255) === 0) depth = clampNum(depth + (rng() - 0.5) * 0.3, 0.2, 1);
    const f = f0 * (f1 / f0) ** (x * x * (3 - 2 * x)) * (1 + 0.035 * depth * sinCycles(tp));
    p += f / sr; tp += trill / sr;
    if (i >= bodyN) relG *= relD;
    out[i] = (sinCycles(p) + 0.08 * sinCycles(2 * p) + breath.tick(rng() * 2 - 1) * 0.6) * vel * (i < aN ? i / aN : 1) * relG * 0.6;
  }
  return out;
}

/** Wing beats of the mechanical falcon: `flaps` soft air thrusts `gap` s apart (stereo, sweeping across), each with a tiny brass creak of the hinge. */
export function wings(ctx: VoiceCtx, flaps: number, gap: number, vel: number, panFrom = -0.6, panTo = 0.6): Stereo {
  const { sr, rng } = ctx;
  const out = stereo(Math.ceil((flaps * gap + 0.4) * sr));
  for (let k = 0; k < flaps; k++) {
    const at = Math.round(k * gap * sr), pan = panFrom + ((panTo - panFrom) * k) / Math.max(1, flaps - 1);
    const air = noiseHit(ctx, vel * (0.7 + 0.3 * rng()), 650 + rng() * 500, 0.8, 0.035, 0.13, 180, 4000);
    addMono(out, air, at, 1, pan);
    addMono(out, ratchet(ctx, vel * 0.25, 1.6), at + Math.round(0.02 * sr), 0.5, pan);
  }
  return out;
}

/** Equal-power cross-fade of a rendered tail into the head, so a bed of `body` samples loops seamlessly. */
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
 * The courtyard bed (stereo, loopable): the fountain (dark body of falling water, a granular splash band and fine
 * bubbles), the water clock dripping into its two tuned bowls every 2.4 s (C6 / G5, so a 24 s loop holds exactly ten),
 * the far-off tick-tock of the great clock once a second and a few distant water-whistle birds.
 */
export function courtyard(ctx: VoiceCtx, dur: number, level = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr) : 0, len = body + xf;
  const out = stereo(len);
  for (const ch of [out.l, out.r]) {
    const lp = new Biquad(sr).lowpass(600, 0.7), hp = new Biquad(sr).highpass(70, 0.7), splash = new Biquad(sr).bandpass(2600, 0.6), top = new Biquad(sr).lowpass(7000, 0.6);
    let brown = 0, grain = 1, l1 = rng(), l2 = rng();
    const k = onePoleCoef(30, sr);
    let g = 1;
    for (let i = -2048; i < len; i++) {
      brown = brown * 0.985 + (rng() * 2 - 1) * 0.16;
      if (i % Math.max(1, Math.round((0.006 + rng() * 0.012) * sr)) === 0) grain = 0.3 + 0.7 * rng();
      g += k * (grain - g);
      const swell = 0.8 + 0.12 * sinCycles(l1) + 0.08 * sinCycles(l2);
      l1 += 0.17 / sr; l2 += 0.53 / sr;
      const v = (hp.tick(lp.tick(brown)) * 1.3 * swell + top.tick(splash.tick(rng() * 2 - 1)) * 0.22 * g) * level;
      if (i >= 0) ch[i] = v;
    }
  }
  const nb = Math.round(9 * len / sr);
  for (let i = 0; i < nb; i++) addMono(out, bubble(ctx, 600 + rng() * 1600, 0.12 * level, 0.3 + rng() * 0.5), Math.floor(rng() * (len - 0.1 * sr)), 1, rng() * 1.6 - 0.8);
  for (let t = 0.6, n = 0; t < len / sr - 1.6; t += 2.4, n++) addMono(out, drip(ctx, n % 2 ? 783.99 : 1046.5, 0.32 * level), Math.round(t * sr), 1, n % 2 ? 0.35 : 0.2);
  const far = new Biquad(sr).lowpass(2400, 0.7);
  for (let t = 0.3, n = 0; t < len / sr - 0.1; t += 1, n++) { const e = escapement(ctx, 0.5, n % 2 ? 'tock' : 'tick'); far.reset().process(e); addMono(out, e, Math.round(t * sr), 0.09 * level, -0.45); }
  for (let t = 3 + rng() * 2; t < len / sr - 1; t += 5 + rng() * 4) {
    const f = 2600 + rng() * 1400, calls = 2 + Math.floor(rng() * 3), pan = rng() * 1.4 - 0.7;
    for (let c = 0; c < calls; c++) addMono(out, birdWhistle(ctx, f * (1 + rng() * 0.1), f * (1.15 + rng() * 0.2), 0.07 + rng() * 0.06, 0.06 * level, 30), Math.round((t + c * 0.14) * sr), 1, pan);
  }
  return xf ? loopify(out, body) : out;
}

/**
 * The whirr of a meshing gear train (stereo, flat level so the runtime can shape it): a jittered tooth-impact train at
 * `toothHz` ringing two small brass resonances, over the low rumble of the turning axle. Changing the playback rate
 * changes the tooth rate, so the runtime makes it follow a ring's speed.
 */
export function gearWhirr(ctx: VoiceCtx, dur: number, vel: number, toothHz = 70): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len), fadeN = Math.round(0.03 * sr);
  for (const ch of [out.l, out.r]) {
    const bp1 = new Biquad(sr).bandpass(1750, 5), bp2 = new Biquad(sr).bandpass(3450, 7), axle = new Biquad(sr).lowpass(240, 0.7), top = new Biquad(sr).lowpass(6500, 0.6);
    let ph = rng(), brown = 0;
    for (let i = 0; i < len; i++) {
      ph += (toothHz * (1 + (rng() - 0.5) * 0.08)) / sr;
      let imp = 0;
      if (ph >= 1) { ph -= 1; imp = 0.6 + 0.4 * rng(); }
      const n = rng() * 2 - 1;
      brown = brown * 0.99 + n * 0.1;
      const edge = Math.min(1, i / fadeN, (len - 1 - i) / fadeN);
      ch[i] = (top.tick(bp1.tick(imp + n * 0.04) * 0.9 + bp2.tick(imp) * 0.45) + axle.tick(brown) * 0.6) * vel * edge;
    }
  }
  return out;
}
