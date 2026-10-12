/**
 * Original instrument voices, rendered offline into mono or stereo Float32Arrays.
 * Pitched voices take a frequency in Hz, a velocity 0..1 and a held duration in seconds (key down time);
 * each returns the whole natural decay so the renderer can mix it anywhere.
 */
import {
  Biquad, Svf, addMono, dcBlock, onePoleCoef, sinCycles, softClip, stereo, strikeEnv, trimTail,
  type Rng, type Stereo,
} from './dsp';

export interface VoiceCtx { sr: number; rng: Rng }

/** Partials above this are dropped: keeps bells sweet and nothing harsh up top. */
const PARTIAL_CEILING = 9000;
const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Sum of exponentially decaying sine partials with a held-key damper. */
export function modal(ctx: VoiceCtx, freq: number, ratios: number[], amps: number[], t60s: number[], vel: number, held: number, opts: { attack?: number; damperT60?: number; detuneCents?: number; maxLen?: number } = {}): Float32Array {
  const { sr } = ctx;
  const attack = opts.attack ?? 0.0012, damper = opts.damperT60 ?? 0, detune = 2 ** ((opts.detuneCents ?? 0) / 1200);
  const longest = Math.max(...t60s);
  const releaseAt = damper > 0 ? held + 0.06 : Infinity;
  const len = Math.ceil(Math.min(opts.maxLen ?? 6, Math.min(longest, releaseAt + damper)) * sr) + 64;
  const out = new Float32Array(len);
  const attackN = Math.max(1, Math.round(attack * sr));
  for (let p = 0; p < ratios.length; p++) {
    const f = freq * detune * ratios[p]!;
    if (f > PARTIAL_CEILING || f > sr * 0.45) continue;
    // damped two-pole resonator: y[n] = 2r·cos(w)·y[n−1] − r²·y[n−2] is an exponentially decaying sine
    const w = (2 * Math.PI * f) / sr, a = amps[p]! * vel, rr = t60Factor(t60s[p]!, sr);
    const c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
    let y1 = 0, y2 = -a * Math.sin(w) / rr; // so that y[0] = 0 and y[1] = a·r·sin(w)
    const stop = Math.min(len, Math.ceil(t60s[p]! * sr));
    for (let i = 0; i < stop; i++) {
      const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y;
      out[i]! += i < attackN ? y * (i / attackN) : y;
    }
  }
  if (damper > 0) {
    const start = Math.floor(releaseAt * sr), d = t60Factor(damper, sr);
    let g = 1;
    for (let i = start; i < len; i++) { g *= d; out[i]! *= g; }
  }
  return trimTail(out);
}

/** Celesta-like FM bell: 1:1 FM body with a decaying index, plus a high strike partial. */
export function celesta(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 1): Float32Array {
  const { sr } = ctx;
  const t60 = clampNum(2.6 * (523 / freq) ** 0.45, 0.7, 3.6);
  const releaseAt = held + 0.09;
  const len = Math.ceil(Math.min(t60, releaseAt + 0.45) * sr) + 64;
  const out = new Float32Array(len);
  const inc = freq / sr, decay = t60Factor(t60, sr), idxDecay = Math.exp(-1 / (0.11 * sr));
  let phase = 0, env = vel, idx = (0.9 + 1.1 * bright) * (0.5 + 0.5 * vel);
  const idxFloor = 0.18 * bright, attackN = Math.round(0.0015 * sr), k = 1 / (2 * Math.PI);
  for (let i = 0; i < len; i++) {
    const m = sinCycles(phase);
    const v = sinCycles(phase + (idx + idxFloor) * m * k) * env;
    out[i] = i < attackN ? (v * i) / attackN : v;
    phase += inc; env *= decay; idx *= idxDecay;
  }
  // octave partial and high strike partial as damped resonators (cheap, exact exponential decay)
  const partial = (f: number, amp: number, t: number) => {
    if (f > PARTIAL_CEILING) return;
    const w = (2 * Math.PI * f) / sr, r = t60Factor(t, sr), c1 = 2 * r * Math.cos(w), c2 = -r * r;
    let y1 = 0, y2 = (-amp * Math.sin(w)) / r;
    const stop = Math.min(len, Math.ceil(t * sr));
    for (let i = 0; i < stop; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; out[i]! += i < attackN ? (y * i) / attackN : y; }
  };
  partial(freq * 2, 0.14 * vel, t60 * 0.35);
  partial(freq * 5.04, 0.12 * bright * vel, 0.07);
  const start = Math.floor(releaseAt * sr), d = t60Factor(0.35, sr);
  let g = 1;
  for (let i = start; i < len; i++) { g *= d; out[i]! *= g; }
  return trimTail(out);
}

/** Music-box tine: nearly pure, slightly out-of-tune, with a quick plink partial and a tiny pluck tick. */
export function musicBox(ctx: VoiceCtx, freq: number, vel: number): Float32Array {
  const t60 = clampNum(2.4 * (880 / freq) ** 0.5, 0.8, 3.2);
  const detune = (ctx.rng() * 2 - 1) * 5;
  const out = modal(ctx, freq, [1, 2, 5.93], [0.9, 0.07, 0.13], [t60, t60 * 0.4, 0.09], vel, 10, { attack: 0.0006, detuneCents: detune });
  const tickLen = Math.round(0.002 * ctx.sr), hp = new Biquad(ctx.sr).highpass(3000);
  for (let i = 0; i < tickLen && i < out.length; i++) out[i]! += hp.tick((ctx.rng() * 2 - 1) * 0.12 * vel * (1 - i / tickLen));
  return out;
}

/** Glockenspiel bar: free-free bar modes, short mallet click. */
export function glock(ctx: VoiceCtx, freq: number, vel: number): Float32Array {
  const s = (1047 / freq) ** 0.3;
  const out = modal(ctx, freq, [1, 2.756, 5.404, 8.933], [1, 0.3, 0.1, 0.04], [2.2 * s, 0.55 * s, 0.18 * s, 0.07 * s], vel, 10, { attack: 0.0008 });
  const clickLen = Math.round(0.0012 * ctx.sr), lp = new Biquad(ctx.sr).lowpass(6000);
  for (let i = 0; i < clickLen && i < out.length; i++) out[i]! += lp.tick((ctx.rng() * 2 - 1) * 0.1 * vel);
  return out;
}

/** Marimba bar: tuned modes 1 : 3.93 : 9.2 with a soft yarn mallet. */
export function marimba(ctx: VoiceCtx, freq: number, vel: number, held: number): Float32Array {
  const t60 = clampNum(0.9 * (440 / freq) ** 0.6, 0.25, 1.8);
  const out = modal(ctx, freq, [1, 3.93, 9.2], [1, 0.22 * vel, 0.05 * vel], [t60, 0.14, 0.035], vel, held, { attack: 0.0015, damperT60: 0.25 });
  const n = Math.round(0.003 * ctx.sr), lp = new Biquad(ctx.sr).lowpass(1800);
  for (let i = 0; i < n && i < out.length; i++) out[i]! += lp.tick((ctx.rng() * 2 - 1) * 0.15 * vel);
  return out;
}

/**
 * Karplus-Strong plucked tine (kalimba/marimba colour): noise-excited delay loop with an averaging loss
 * filter and an allpass fractional delay for exact tuning, plus a sine "tine" body.
 */
export function pluck(ctx: VoiceCtx, freq: number, vel: number, held: number, bright = 0.5, t60 = 1.2, body = 0.35): Float32Array {
  const { sr, rng } = ctx;
  const period = sr / freq;
  const L = Math.max(2, Math.floor(period - 0.5 - 0.001)), frac = period - 0.5 - L;
  const C = (1 - frac) / (1 + frac);
  const loss = 10 ** (-3 / (freq * t60));
  const releaseAt = held + 0.05;
  const len = Math.ceil(Math.min(t60, releaseAt + 0.3) * sr) + 64;
  const out = new Float32Array(len), ring = new Float32Array(L);
  // excitation: one period of low-passed noise; brighter with velocity
  const excN = Math.round(period), c = onePoleCoef(500 + bright * 5200 * (0.4 + 0.6 * vel), sr);
  let lp = 0, prev = 0, apx = 0, apy = 0, w = 0;
  const bodyInc = freq / sr, bodyDecay = t60Factor(t60 * 0.7, sr);
  let bodyEnv = body * vel, bodyPhase = 0;
  for (let i = 0; i < len; i++) {
    let exc = 0;
    if (i < excN) { lp += c * ((rng() * 2 - 1) - lp); exc = lp * vel * 1.6; }
    const read = ring[w]!;
    const avg = 0.5 * (read + prev) * loss; prev = read;
    const ap = C * avg + apx - C * apy; apx = avg; apy = ap;
    const v = ap + exc;
    ring[w] = v; w = w + 1 === L ? 0 : w + 1;
    out[i] = v + sinCycles(bodyPhase) * bodyEnv * Math.min(1, i / 40);
    bodyPhase += bodyInc; bodyEnv *= bodyDecay;
  }
  const start = Math.floor(releaseAt * sr), d = t60Factor(0.12, sr);
  let g = 1;
  for (let i = start; i < len; i++) { g *= d; out[i]! *= g; }
  dcBlock(out);
  return trimTail(out);
}

const polyBlep = (t: number, dt: number) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};

/** Bright synth pluck lead: two detuned band-limited saws through a resonant low-pass with a snappy envelope. */
export function synthLead(ctx: VoiceCtx, freq: number, vel: number, held: number, cutoff = 1800, envAmt = 3200, decay = 0.22): Float32Array {
  const { sr } = ctx;
  const rel = 0.14, len = Math.ceil((held + rel * 4) * sr);
  const out = new Float32Array(len);
  const f1 = freq * 2 ** (-6 / 1200), f2 = freq * 2 ** (6 / 1200), dt1 = f1 / sr, dt2 = f2 / sr;
  let p1 = ctx.rng(), p2 = ctx.rng();
  const svf = new Svf(sr);
  const heldN = Math.floor(held * sr), aN = Math.round(0.003 * sr);
  const relD = t60Factor(rel * 3, sr), envD = Math.exp(-1 / (decay * sr)), susD = Math.exp(-1 / (0.35 * sr));
  let fenv = 1, amp = 1, relG = 1;
  for (let i = 0; i < len; i++) {
    if ((i & 31) === 0) svf.set(cutoff + envAmt * fenv * vel, 0.9);
    const s = (2 * p1 - 1 - polyBlep(p1, dt1)) + (2 * p2 - 1 - polyBlep(p2, dt2));
    p1 += dt1; if (p1 >= 1) p1 -= 1; p2 += dt2; if (p2 >= 1) p2 -= 1;
    const a = i < aN ? i / aN : 0.55 + 0.45 * amp;
    if (i >= heldN) relG *= relD;
    out[i] = svf.tick(s * 0.35) * a * relG * vel;
    fenv *= envD; amp *= susD;
  }
  return trimTail(out);
}

export type PadKind = 'warm' | 'saw' | 'string';

/** Detuned saw ensemble (supersaw / string pad) with a slow filter envelope; stereo by voice spread. */
export function padChord(ctx: VoiceCtx, freqs: number[], vel: number, held: number, kind: PadKind, opts: { attack?: number; release?: number; cutoff?: number; envAmt?: number; voices?: number; detune?: number } = {}): Stereo {
  const { sr, rng } = ctx;
  const attack = opts.attack ?? (kind === 'saw' ? 0.06 : kind === 'string' ? 0.35 : 0.25);
  const release = opts.release ?? (kind === 'saw' ? 0.25 : 0.6);
  const cutoff = opts.cutoff ?? (kind === 'saw' ? 2200 : kind === 'string' ? 1900 : 1100);
  const envAmt = opts.envAmt ?? (kind === 'saw' ? 1.2 : 0.6);
  const voices = opts.voices ?? (kind === 'saw' ? 4 : 2);
  const spread = opts.detune ?? (kind === 'saw' ? 16 : kind === 'string' ? 9 : 7);
  const len = Math.ceil((held + release * 2.2) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  for (const freq of freqs) {
    for (let v = 0; v < voices; v++) {
      const cents = voices === 1 ? 0 : (v / (voices - 1) * 2 - 1) * spread;
      const f = freq * 2 ** (cents / 1200), dt = f / sr;
      const side = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1; // −1..1
      const gl = Math.sqrt(0.5 * (1 - side * 0.8)), gr = Math.sqrt(0.5 * (1 + side * 0.8));
      let p = rng();
      const vib = kind === 'string' ? 0.0035 : 0, vibRate = (5 + rng() * 0.8) / sr;
      let vp = rng();
      for (let i = 0; i < len; i++) {
        let s: number;
        if (kind === 'warm') { // half saw, half triangle: rounder
          const saw = 2 * p - 1 - polyBlep(p, dt);
          s = 0.55 * saw + 0.45 * (1 - 4 * Math.abs(p - 0.5));
        } else s = 2 * p - 1 - polyBlep(p, dt);
        L[i]! += s * gl; R[i]! += s * gr;
        let inc = dt;
        if (vib) { inc *= 1 + vib * sinCycles(vp) * Math.min(1, i / (0.4 * sr)); vp += vibRate; }
        p += inc; if (p >= 1) p -= 1;
      }
    }
  }
  const norm = 0.5 / Math.sqrt(Math.max(1, freqs.length * voices));
  const heldN = Math.floor(held * sr);
  const relD = t60Factor(release * 2.2, sr), attN = Math.max(1, Math.round(attack * sr));
  for (const ch of [L, R]) {
    const svf = new Svf(sr);
    let relG = 1;
    for (let i = 0; i < len; i++) {
      if ((i & 31) === 0) {
        const t = i / sr;
        const shape = (1 - Math.exp(-t / Math.max(0.05, attack * 1.5))) * Math.exp(-t / 1.6);
        svf.set(cutoff * (1 + envAmt * shape * vel), kind === 'saw' ? 0.85 : 0.7);
      }
      const att = i < attN ? Math.sin((i / attN) * Math.PI * 0.5) : 1;
      if (i >= heldN) relG *= relD;
      ch[i] = svf.tick(ch[i]! * norm) * att * relG * vel;
    }
  }
  return { l: L, r: R };
}

/** Round bass: sine with a little 2nd/3rd harmonic, an onset pitch blip and soft saturation. Optional saw growl. */
export function bass(ctx: VoiceCtx, freq: number, vel: number, held: number, drive = 1.6, tone = 900, growl = 0): Float32Array {
  const { sr } = ctx;
  const rel = 0.07, len = Math.ceil((held + rel * 5) * sr);
  const out = new Float32Array(len);
  let phase = 0, sp = 0;
  const blipD = Math.exp(-1 / (0.012 * sr)), decD = Math.exp(-1 / (0.28 * sr)), relD = t60Factor(rel * 3, sr);
  let blip = 0.07, dec = 1, relG = 1;
  const heldN = Math.floor(held * sr), aN = Math.round(0.004 * sr), norm = 1 / softClip(drive);
  const growlSvf = new Svf(sr); growlSvf.set(tone * 0.9, 0.8);
  const dtS = freq / sr;
  for (let i = 0; i < len; i++) {
    const f = freq * (1 + blip);
    const s = sinCycles(phase) + 0.28 * sinCycles(phase * 2) + 0.08 * sinCycles(phase * 3);
    let v = softClip(s * drive) * norm;
    if (growl > 0) { v += growlSvf.tick(2 * sp - 1 - polyBlep(sp, dtS)) * growl; sp += dtS; if (sp >= 1) sp -= 1; }
    const a = i < aN ? i / aN : 0.72 + 0.28 * dec;
    if (i >= heldN) relG *= relD;
    out[i] = v * a * relG * vel;
    phase += f / sr; blip *= blipD; dec *= decD;
  }
  const lp1 = new Biquad(sr).lowpass(tone, 0.6), lp2 = new Biquad(sr).lowpass(tone * 1.6, 0.6);
  lp1.process(out); lp2.process(out);
  dcBlock(out, 0.9997);
  return trimTail(out);
}

/* ---------------- drums ---------------- */

/** Kick: pitched sine sweep plus a short filtered click. */
export function kick(ctx: VoiceCtx, vel: number, f0 = 140, f1 = 47, pitchTau = 0.04, t60 = 0.45, click = 0.5, drive = 1.3): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil(t60 * sr) + 32, out = new Float32Array(len);
  let phase = 0;
  const d = t60Factor(t60, sr), pd = Math.exp(-1 / (pitchTau * sr)), norm = 1 / softClip(drive);
  let env = 1, pe = 1;
  const hp = new Biquad(sr).highpass(1400), clickN = Math.round(0.004 * sr);
  for (let i = 0; i < len; i++) {
    const f = f1 + (f0 - f1) * pe;
    let v = softClip(sinCycles(phase) * drive) * norm * env;
    if (i < clickN) v += hp.tick((rng() * 2 - 1) * click * 0.5 * (1 - i / clickN));
    out[i] = v * vel * Math.min(1, i / 8);
    phase += f / sr; env *= d; pe *= pd;
  }
  return trimTail(out);
}

/** Shaped noise through a band-pass with an attack/decay envelope. */
export function noiseHit(ctx: VoiceCtx, vel: number, freq: number, q: number, attack: number, t60: number, highpass = 0, lowpass = 0): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil((attack + t60) * sr) + 16, out = new Float32Array(len);
  const bp = new Biquad(sr).bandpass(freq, q), hp = highpass ? new Biquad(sr).highpass(highpass) : null, lp = lowpass ? new Biquad(sr).lowpass(lowpass) : null;
  const aN = Math.max(1, Math.round(attack * sr)), d = t60Factor(t60, sr);
  let env = 1;
  for (let i = 0; i < len; i++) {
    let v = bp.tick(rng() * 2 - 1);
    if (hp) v = hp.tick(v); if (lp) v = lp.tick(v);
    const a = i < aN ? i / aN : (env *= d);
    out[i] = v * a * vel;
  }
  return out;
}

/** Brushed snare: soft swish with a little drum body. */
export function brush(ctx: VoiceCtx, vel: number, length = 0.16): Float32Array {
  const out = noiseHit(ctx, vel * 1.6, 3200, 0.6, 0.005, length, 900, 8500);
  const body = modal(ctx, 190, [1, 1.6], [0.22, 0.08], [0.09, 0.05], vel, 10);
  for (let i = 0; i < body.length && i < out.length; i++) out[i]! += body[i]!;
  return trimTail(out);
}

/** Tight snare for the feature groove. */
export function snare(ctx: VoiceCtx, vel: number): Float32Array {
  const out = noiseHit(ctx, vel * 1.4, 2300, 0.55, 0.001, 0.2, 500, 8000);
  const { sr } = ctx;
  let phase = 0, env = 0.6 * vel;
  const d = t60Factor(0.12, sr);
  for (let i = 0; i < out.length; i++) { const f = 185 * (1 + 0.4 * Math.exp(-i / (0.008 * sr))); out[i]! += sinCycles(phase) * env; phase += f / sr; env *= d; }
  return trimTail(out);
}

/** Hand clap: a few quick bursts and a short room tail. */
export function clap(ctx: VoiceCtx, vel: number): Float32Array {
  const { sr } = ctx;
  const len = Math.ceil(0.32 * sr), out = new Float32Array(len);
  for (const [ms, g, t60] of [[0, 0.8, 0.03], [9, 0.9, 0.03], [19, 1, 0.035], [29, 1, 0.22]] as const) {
    const hit = noiseHit(ctx, vel * g, 1300, 0.9, 0.0008, t60, 600, 7000);
    const at = Math.round((ms / 1000) * sr);
    for (let i = 0; i < hit.length && at + i < len; i++) out[at + i]! += hit[i]!;
  }
  return trimTail(out);
}

/** Hi-hat kept soft and band-limited (nothing fizzy above ~10 kHz). */
export const hat = (ctx: VoiceCtx, vel: number, open = false) => trimTail(noiseHit(ctx, vel * 0.9, 7200, 0.7, 0.0008, open ? 0.3 : 0.05, 5200, 10000));
export const shaker = (ctx: VoiceCtx, vel: number) => trimTail(noiseHit(ctx, vel * 1.1, 5200, 1.1, 0.009, 0.075, 2500, 9000));
export const snap = (ctx: VoiceCtx, vel: number) => trimTail(noiseHit(ctx, vel * 1.5, 2700, 1.8, 0.0006, 0.05, 900, 7000));

/** Wood block: two short modes, playful patisserie percussion. */
export function wood(ctx: VoiceCtx, vel: number, pitch = 1): Float32Array {
  return modal(ctx, 1050 * pitch, [1, 2.52], [0.7, 0.25], [0.07, 0.03], vel, 10, { attack: 0.0004 });
}

export function tom(ctx: VoiceCtx, vel: number, freq: number): Float32Array {
  const out = kick(ctx, vel, freq * 1.7, freq, 0.05, 0.5, 0.25, 1.1);
  const n = noiseHit(ctx, vel * 0.3, freq * 4, 1, 0.001, 0.06);
  for (let i = 0; i < n.length && i < out.length; i++) out[i]! += n[i]!;
  return out;
}

export function timpani(ctx: VoiceCtx, vel: number, freq: number): Float32Array {
  const out = modal(ctx, freq, [1, 1.5, 1.98, 2.44], [1, 0.45, 0.25, 0.12], [1.6, 0.9, 0.6, 0.4], vel, 10, { attack: 0.003 });
  const n = noiseHit(ctx, vel * 0.5, 180, 0.7, 0.001, 0.12);
  for (let i = 0; i < n.length && i < out.length; i++) out[i]! += n[i]!;
  return out;
}

/** Soft cymbal wash, stereo, band-limited. */
export function crash(ctx: VoiceCtx, vel: number, t60 = 1.8): Stereo {
  const l = noiseHit(ctx, vel, 5200, 0.45, 0.004, t60, 2500, 9500), r = noiseHit(ctx, vel, 5600, 0.45, 0.004, t60, 2500, 9500);
  return { l: trimTail(l), r: trimTail(r) };
}

/* ---------------- sweeps, impacts, sparkles ---------------- */

/** Noise riser: band-pass sweeps up exponentially, level grows, stereo-decorrelated, with a soft tonal sweep. */
export function riser(ctx: VoiceCtx, dur: number, f0 = 300, f1 = 5000, vel = 1, tone = 0.25): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = stereo(len);
  const svfL = new Svf(sr), svfR = new Svf(sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    if ((i & 31) === 0) { const f = f0 * (f1 / f0) ** x; svfL.set(f, 2.2); svfR.set(f * 1.04, 2.2); }
    const a = x * x * vel, end = i > len - 400 ? (len - i) / 400 : 1;
    const t = sinCycles(ph) * tone * a; ph += (f0 * 0.5 * (f1 / f0) ** (x * 0.5)) / sr;
    out.l[i] = (svfL.tick(rng() * 2 - 1, 1) * 0.9 * a + t) * end;
    out.r[i] = (svfR.tick(rng() * 2 - 1, 1) * 0.9 * a + t) * end;
  }
  return out;
}

/** Whoosh: band-pass rises to a peak then falls; the image moves across the stereo field. */
export function whoosh(ctx: VoiceCtx, dur: number, fLow = 450, fPeak = 2600, vel = 1, panFrom = -0.6, panTo = 0.6, peakAt = 0.45): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), mono = new Float32Array(len), out = stereo(len);
  const svf = new Svf(sr);
  for (let i = 0; i < len; i++) {
    const x = i / len, u = x < peakAt ? x / peakAt : 1 - (x - peakAt) / (1 - peakAt);
    if ((i & 31) === 0) svf.set(fLow * (fPeak / fLow) ** u, 1.4);
    mono[i] = svf.tick(rng() * 2 - 1, 1) * u ** 1.6 * vel;
  }
  // move the pan in 16 segments (smooth enough for a 0.3 s gesture)
  const seg = 16, step = Math.ceil(len / seg);
  for (let s = 0; s < seg; s++) {
    const a = s * step, b = Math.min(len, a + step), pan = panFrom + (panTo - panFrom) * ((s + 0.5) / seg);
    const part = mono.subarray(a, b);
    addMono(out, part, a, 1, pan);
  }
  return out;
}

/** Sub drop impact: low sine glide + noise thump + optional crack. */
export function impact(ctx: VoiceCtx, vel: number, crack = 0.5): Float32Array {
  const out = kick(ctx, vel, 95, 34, 0.09, 1.3, 0.2, 1.6);
  const t = noiseHit(ctx, vel * 0.6, 260, 0.6, 0.001, 0.18);
  for (let i = 0; i < t.length; i++) out[i]! += t[i]!;
  if (crack > 0) {
    const c = noiseHit(ctx, vel * crack, 2600, 0.8, 0.0005, 0.06, 900, 8000);
    for (let i = 0; i < c.length; i++) out[i]! += c[i]!;
  }
  return out;
}

/**
 * Granular sugar sparkles: many tiny bell grains on chosen pitches, random pan, with a level shape
 * over the duration ('swell' builds up, 'decay' falls away, 'flat').
 */
export function sparkles(ctx: VoiceCtx, dur: number, density: number, notes: number[], vel = 1, shape: 'swell' | 'decay' | 'flat' = 'flat'): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil((dur + 0.4) * sr), out = stereo(len);
  const count = Math.max(1, Math.round(density * dur));
  for (let g = 0; g < count; g++) {
    const x = rng();
    const t = x * dur;
    const level = shape === 'swell' ? x * x : shape === 'decay' ? (1 - x) ** 1.5 : 1;
    const midi = notes[Math.floor(rng() * notes.length)]!;
    const f = 440 * 2 ** ((midi - 69) / 12) * (1 + (rng() - 0.5) * 0.004);
    if (f * 2 > PARTIAL_CEILING * 1.2) continue;
    const gl = Math.ceil((0.05 + rng() * 0.16) * sr), grain = new Float32Array(gl);
    const aN = Math.round(0.0015 * sr), r = t60Factor(gl / sr, sr);
    // two damped resonators (fundamental + slightly sharp octave): a tiny struck sugar crystal
    for (const [ratio, amp] of [[1, 1], [2.01, 0.22]] as const) {
      const w = (2 * Math.PI * f * ratio) / sr;
      if (f * ratio > PARTIAL_CEILING) continue;
      const c1 = 2 * r * Math.cos(w), c2 = -r * r;
      let y1 = 0, y2 = (-amp * Math.sin(w)) / r;
      for (let i = 0; i < gl; i++) { const y = c1 * y1 + c2 * y2; y2 = y1; y1 = y; grain[i]! += i < aN ? (y * i) / aN : y; }
    }
    addMono(out, grain, Math.floor(t * sr), vel * level * (0.35 + 0.65 * rng()) * 0.5, rng() * 1.6 - 0.8);
  }
  return out;
}

/**
 * Room tone: pink noise, darkened, with slow random breathing; stereo-decorrelated. When `loopable`,
 * an extra second is rendered and cross-faded (equal power) into the head, so the result loops
 * without a seam.
 */
export function roomTone(ctx: VoiceCtx, dur: number, level = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr) : 0, len = body + xf;
  const out = stereo(len);
  for (const ch of [out.l, out.r]) {
    let b0 = 0, b1 = 0, b2 = 0;
    const lp = new Biquad(sr).lowpass(1800, 0.6), hp = new Biquad(sr).highpass(70);
    let lfo = rng();
    for (let i = -4096; i < len; i++) { // negative indices warm the filters up
      const w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      const breath = 0.8 + 0.2 * sinCycles(lfo); lfo += 0.0625 / sr;
      const v = hp.tick(lp.tick(pink)) * breath * level;
      if (i >= 0) ch[i] = v;
    }
  }
  if (!xf) return out;
  const res = { l: out.l.slice(0, body), r: out.r.slice(0, body) };
  for (let i = 0; i < xf; i++) {
    const x = i / xf, a = Math.sin(x * Math.PI * 0.5), b = Math.cos(x * Math.PI * 0.5);
    res.l[i] = out.l[i]! * a + out.l[body + i]! * b;
    res.r[i] = out.r[i]! * a + out.r[body + i]! * b;
  }
  return res;
}

/* ---------------- choir, bells, vox (win tiers and callouts) ---------------- */

/** Vowel formants (Hz) and relative gains for the synthetic choir and vox: an original source-filter design. */
export const VOWELS = {
  ah: { f: [780, 1180, 2650], g: [1, 0.55, 0.22] },
  oh: { f: [470, 820, 2600], g: [1, 0.45, 0.14] },
  oo: { f: [340, 720, 2450], g: [1, 0.3, 0.1] },
  eh: { f: [560, 1750, 2600], g: [1, 0.45, 0.2] },
} as const;
export type Vowel = keyof typeof VOWELS;

/**
 * Wordless choir pad: an ensemble of slightly detuned, gently vibrating band-limited saws per note, shaped
 * by a parallel formant filter bank (vowel "ah" blended toward "oh") with a slow swell. Stereo by voice spread.
 */
export function choirChord(ctx: VoiceCtx, freqs: number[], vel: number, held: number, opts: { attack?: number; release?: number; vowel?: Vowel; voices?: number; breath?: number } = {}): Stereo {
  const { sr, rng } = ctx;
  const attack = opts.attack ?? 0.32, release = opts.release ?? 0.7, voices = opts.voices ?? 3;
  const len = Math.ceil((held + release * 2.2) * sr);
  const L = new Float32Array(len), R = new Float32Array(len);
  for (const freq of freqs) {
    for (let v = 0; v < voices; v++) {
      const cents = voices === 1 ? 0 : (v / (voices - 1) * 2 - 1) * 11 + (rng() - 0.5) * 4;
      const f = freq * 2 ** (cents / 1200), dt = f / sr;
      const side = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const gl = Math.sqrt(0.5 * (1 - side * 0.7)), gr = Math.sqrt(0.5 * (1 + side * 0.7));
      let p = rng(), vp = rng(), dp = rng();
      const vibRate = (4.6 + rng() * 1.1) / sr, driftRate = (0.21 + rng() * 0.2) / sr, onset = 0.25 + rng() * 0.2;
      for (let i = 0; i < len; i++) {
        const s = 2 * p - 1 - polyBlep(p, dt);
        L[i]! += s * gl; R[i]! += s * gr;
        // vibrato fades in after the onset, like singers settling on a note; a slow drift adds ensemble life
        const vib = 0.0042 * Math.min(1, Math.max(0, i / sr - onset) / 0.5) * sinCycles(vp) + 0.0011 * sinCycles(dp);
        p += dt * (1 + vib); if (p >= 1) p -= 1;
        vp += vibRate; dp += driftRate;
      }
    }
  }
  const a = VOWELS[opts.vowel ?? 'ah'], o = VOWELS.oh;
  const norm = 0.9 / Math.sqrt(Math.max(1, freqs.length * voices));
  const heldN = Math.floor(held * sr), relD = t60Factor(release * 2.2, sr), attN = Math.max(1, Math.round(attack * sr));
  const breath = opts.breath ?? 0.05;
  for (const ch of [L, R]) {
    const bank = a.f.map((f, k) => ({ bp: new Biquad(sr).bandpass(0.72 * f + 0.28 * o.f[k]!, (0.72 * f + 0.28 * o.f[k]!) / (70 + 30 * k)), g: 0.72 * a.g[k]! + 0.28 * o.g[k]! }));
    const air = new Biquad(sr).bandpass(a.f[1]!, 1.2);
    const tilt = new Biquad(sr).lowpass(3400, 0.6);
    let relG = 1;
    for (let i = 0; i < len; i++) {
      const x = ch[i]! * norm;
      let y = 0;
      for (const b of bank) y += b.bp.tick(x) * b.g;
      y = tilt.tick(y * 3.2) + air.tick((rng() * 2 - 1) * breath);
      const att = i < attN ? Math.sin((i / attN) * Math.PI * 0.5) ** 2 : 1;
      if (i >= heldN) relG *= relD;
      ch[i] = y * att * relG * vel;
    }
  }
  return { l: L, r: R };
}

/**
 * Bright tower-style bell: strike tone `freq` with a hum an octave below, a soft major "tierce", quint and an
 * upper octave, each an exponentially decaying partial (exact modal synthesis); long, shimmering decay.
 */
export function bell(ctx: VoiceCtx, freq: number, vel: number): Float32Array {
  const s = clampNum((523 / freq) ** 0.35, 0.6, 1.6);
  return modal(ctx, freq, [0.5, 1, 1.26, 1.5, 2, 2.52, 3.01], [0.32, 1, 0.2, 0.16, 0.38, 0.12, 0.08], [4.2 * s, 3.4 * s, 2.2 * s, 1.8 * s, 1.5 * s, 0.7 * s, 0.4 * s], vel, 10, { attack: 0.0007, maxLen: 4.5 });
}

/**
 * Wordless "announcer" vox: one formant-filtered voice gliding from `f0` to `f1` while the vowel morphs
 * (e.g. "oh" → "ah"), with a short rising scoop at the onset and a little vibrato on the held part.
 * Non-verbal by design: a placeholder character until a recorded voice line exists.
 */
export function vox(ctx: VoiceCtx, f0: number, f1: number, dur: number, vel: number, from: Vowel = 'oh', to: Vowel = 'ah'): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil((dur + 0.25) * sr), src = new Float32Array(len);
  let p = rng(), q = rng(), vp = 0;
  const bodyN = Math.floor(dur * sr);
  for (let i = 0; i < len; i++) {
    const x = Math.min(1, i / bodyN);
    const glide = x < 0.35 ? 0 : (x - 0.35) / 0.65;
    const scoop = 1 - 0.06 * Math.exp(-i / (0.035 * sr));
    const vib = 1 + 0.006 * Math.min(1, Math.max(0, x - 0.4) / 0.3) * sinCycles(vp);
    const f = f0 * (f1 / f0) ** (glide * glide * (3 - 2 * glide)) * scoop * vib;
    const dt = f / sr, dt2 = (f * 1.004) / sr;
    src[i] = 2 * p - 1 - polyBlep(p, dt) + 0.6 * (2 * q - 1 - polyBlep(q, dt2));
    p += dt; if (p >= 1) p -= 1; q += dt2; if (q >= 1) q -= 1; vp += 5.4 / sr;
  }
  const out = new Float32Array(len);
  const A = VOWELS[from], B = VOWELS[to];
  const filters = [new Svf(sr), new Svf(sr), new Svf(sr)];
  const aN = Math.round(0.02 * sr), relStart = bodyN, relD = t60Factor(0.2, sr);
  let relG = 1;
  for (let i = 0; i < len; i++) {
    const m = Math.min(1, i / (0.45 * bodyN));
    if ((i & 15) === 0) for (let k = 0; k < 3; k++) { const f = A.f[k]! + (B.f[k]! - A.f[k]!) * m; filters[k]!.set(f, f / (75 + 35 * k)); }
    let y = 0;
    for (let k = 0; k < 3; k++) y += filters[k]!.tick(src[i]! * 0.3, 1) * (A.g[k]! + (B.g[k]! - A.g[k]!) * m);
    if (i >= relStart) relG *= relD;
    out[i] = y * (i < aN ? i / aN : 1) * relG * vel;
  }
  const lp = new Biquad(sr).lowpass(4200, 0.6);
  lp.process(out);
  return trimTail(out);
}
