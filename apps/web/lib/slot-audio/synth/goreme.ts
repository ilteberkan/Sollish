/**
 * Original synthesized voices for "Göreme: Şafak Balonları" (Cappadocia at dawn: fairy chimneys, hot-air balloons, the
 * valley wind). Everything is built from first principles in code (no samples, no recordings, no imitation of any other
 * game's sound):
 *   burnerRoar   — a balloon's propane burner: valve click, an ignition "pfff", a low flickering flame roar and the
 *                  bright hiss of the jet, with a soft shut-off,
 *   windGust     — one gust of valley wind sweeping across the stereo field (band-passed noise with a moving centre),
 *   balloonWhump — two balloon envelopes bumping/merging: a deep air-filled "whump" (a falling sub sine and a dark
 *                  noise puff) plus the fabric slap,
 *   ropeCreak    — a mooring rope taking the load: stick-slip pulses gliding through a hemp/wood resonance,
 *   brassChime   — a small brass sky chime (inharmonic bell modes, a soft strike),
 *   fabricFlutter— envelope fabric rippling in the wind (filtered noise bursts),
 *   dawnValley   — the ambience bed: a soft breeze over the valley, original synthesized bird chirps (FM sweeps) and
 *                  distant balloon burners, loopable.
 * Deterministic given the seeded random source in `ctx`.
 */
import { Biquad, Svf, addMono, dcBlock, sinCycles, stereo, trimTail, type Stereo } from './dsp';
import { kick, modal, noiseHit, type VoiceCtx } from './instruments';

const t60Factor = (t60: number, sr: number) => Math.exp(-6.9078 / Math.max(1e-4, t60 * sr));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

export interface BurnerOptions {
  /** Include the valve click and ignition puff (default true). */
  ignite?: boolean;
  /** 0..1: more hiss and higher flame body (a hotter, bigger burn). */
  heat?: number;
  /** Start / end pan of the burner. */
  panFrom?: number; panTo?: number;
}

/** A balloon burner burst of `dur` seconds (stereo). */
export function burnerRoar(ctx: VoiceCtx, dur: number, vel: number, opts: BurnerOptions = {}): Stereo {
  const { sr, rng } = ctx;
  const heat = clampNum(opts.heat ?? 0.5, 0, 1), ignite = opts.ignite !== false;
  const rel = 0.22, len = Math.ceil((dur + rel + 0.05) * sr), out = stereo(len);
  const mono = new Float32Array(len);
  const body = new Biquad(sr).lowpass(380 + 260 * heat, 0.8), bodyHp = new Biquad(sr).highpass(38, 0.7);
  const jet = new Svf(sr), jetHp = new Biquad(sr).highpass(1400, 0.7);
  const aN = Math.round((ignite ? 0.07 : 0.03) * sr), endN = Math.round(dur * sr), relD = t60Factor(rel, sr);
  let brown = 0, flick = 1, flickT = 1, g = 1;
  for (let i = 0; i < len; i++) {
    if (i % 441 === 0) flickT = 0.6 + 0.4 * rng();
    flick += (flickT - flick) * 0.004;
    if ((i & 63) === 0) jet.set(2300 + 900 * heat + 400 * Math.sin(i / sr * 7.3), 1.1);
    const n = rng() * 2 - 1;
    brown = brown * 0.992 + n * 0.09;
    const a = i < aN ? (i / aN) ** 1.5 : 1;
    if (i >= endN) g *= relD;
    const roar = bodyHp.tick(body.tick(brown)) * 2.4 * flick;
    const hiss = jetHp.tick(jet.tick(n, 1)) * (0.18 + 0.25 * heat);
    mono[i] = (roar + hiss) * a * g * vel;
  }
  if (ignite) {
    // valve click, then the ignition puff
    const click = noiseHit(ctx, 0.7 * vel, 3200, 2.5, 0.0002, 0.006, 1500, 9000);
    for (let i = 0; i < click.length && i < len; i++) mono[i]! += click[i]!;
    const puff = noiseHit(ctx, 0.9 * vel, 900, 0.7, 0.004, 0.09, 150, 5000);
    const at = Math.round(0.018 * sr);
    for (let i = 0; i < puff.length && at + i < len; i++) mono[at + i]! += puff[i]!;
  }
  dcBlock(mono);
  // move the burner in 12 segments (a slow drift)
  const from = opts.panFrom ?? -0.1, to = opts.panTo ?? 0.1, seg = 12, step = Math.ceil(len / seg);
  for (let s = 0; s < seg; s++) {
    const a = s * step, b = Math.min(len, a + step);
    addMono(out, mono.subarray(a, b), a, 1, from + (to - from) * ((s + 0.5) / seg));
  }
  // a little decorrelation: the flame is wide
  for (let i = 1; i < len; i++) { const d = (out.l[i]! - out.r[i]!) * 0.08; out.l[i]! += d; out.r[i]! -= d; }
  return out;
}

/** A gust of valley wind sweeping from `panFrom` to `panTo` over `dur` seconds (stereo). */
export function windGust(ctx: VoiceCtx, dur: number, vel: number, panFrom = -0.8, panTo = 0.8, fLow = 220, fHigh = 1300): Stereo {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), mono = new Float32Array(len), out = stereo(len);
  const svf = new Svf(sr), whistle = new Svf(sr), lp = new Biquad(sr).lowpass(3200, 0.6);
  let brown = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len, u = Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 1.4;
    if ((i & 31) === 0) { svf.set(fLow * (fHigh / fLow) ** u, 1.3); whistle.set(fHigh * (0.9 + 0.5 * u), 14); }
    const n = rng() * 2 - 1;
    brown = brown * 0.97 + n * 0.25;
    mono[i] = lp.tick(svf.tick(n, 1) * 0.8 + brown * 0.35 * u + whistle.tick(n, 1) * 0.12 * u) * u * vel;
  }
  const seg = 16, step = Math.ceil(len / seg);
  for (let s = 0; s < seg; s++) {
    const a = s * step, b = Math.min(len, a + step), pan = panFrom + (panTo - panFrom) * ((s + 0.5) / seg);
    addMono(out, mono.subarray(a, b), a, 1, pan);
  }
  return out;
}

/** Envelope fabric rippling: `count` soft flaps over `dur` seconds (mono). */
export function fabricFlutter(ctx: VoiceCtx, dur: number, vel: number, count = 6): Float32Array {
  const { sr, rng } = ctx;
  const out = new Float32Array(Math.ceil((dur + 0.15) * sr));
  for (let k = 0; k < count; k++) {
    const at = Math.round((k / Math.max(1, count)) * dur * sr + rng() * 0.03 * sr);
    const f = noiseHit(ctx, vel * (0.5 + 0.5 * rng()), 700 + rng() * 600, 0.9, 0.006, 0.05 + rng() * 0.04, 200, 4500);
    for (let i = 0; i < f.length && at + i < out.length; i++) out[at + i]! += f[i]!;
  }
  return trimTail(out);
}

/** Two envelopes meet and become one: a deep air "whump" (size 1 normal, up to 2 for the biggest merges), mono. */
export function balloonWhump(ctx: VoiceCtx, vel: number, size = 1): Float32Array {
  const { sr } = ctx;
  const s = clampNum(size, 0.5, 2);
  const out = kick(ctx, vel * 0.9, 120 / s, 42 / Math.sqrt(s), 0.05 * s, 0.35 + 0.2 * s, 0.02, 1.1);
  const puff = noiseHit(ctx, vel * 0.8, 260 / Math.sqrt(s), 0.6, 0.012, 0.16 * s, 60, 1400);
  const slap = noiseHit(ctx, vel * 0.45, 1100, 1.1, 0.002, 0.04, 400, 5000);
  const len = Math.max(out.length, puff.length + Math.round(0.01 * sr), slap.length), res = new Float32Array(len);
  for (let i = 0; i < out.length; i++) res[i]! += out[i]!;
  for (let i = 0; i < puff.length; i++) res[i + Math.round(0.006 * sr)]! += puff[i]! * 0.9;
  for (let i = 0; i < slap.length; i++) res[i]! += slap[i]!;
  // a little body resonance of the inflated envelope
  const res2 = modal(ctx, 74 / s, [1, 1.47, 2.09], [0.4, 0.2, 0.08], [0.35 * s, 0.2, 0.1], vel, 10);
  for (let i = 0; i < res2.length && i < len; i++) res[i]! += res2[i]! * 0.6;
  dcBlock(res);
  return trimTail(res);
}

/** A mooring rope taking the load: stick-slip pulses gliding `rate0` → `rate1` Hz over `dur` s through a hemp/wood resonance. */
export function ropeCreak(ctx: VoiceCtx, vel: number, dur = 0.45, rate0 = 38, rate1 = 95, tone = 1): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil((dur + 0.12) * sr), exc = new Float32Array(len);
  let ph = 0;
  const n = Math.floor(dur * sr);
  for (let i = 0; i < n; i++) {
    const x = i / n, rate = rate0 * (rate1 / rate0) ** x * (1 + 0.08 * (rng() - 0.5));
    ph += rate / sr;
    if (ph >= 1) { ph -= 1; exc[i] = (0.6 + 0.4 * rng()) * Math.sin(Math.PI * Math.min(1, x * 1.4)) ** 0.7; }
  }
  const out = new Float32Array(len);
  const bands: [number, number, number][] = [[620 * tone, 9, 1], [1180 * tone, 7, 0.55], [2350 * tone, 5, 0.25]];
  for (const [f, q, g] of bands) {
    const bp = new Biquad(sr).bandpass(f, q);
    for (let i = 0; i < len; i++) out[i]! += bp.tick(exc[i]!) * g;
  }
  const lp = new Biquad(sr).lowpass(5200, 0.6); lp.process(out);
  for (let i = 0; i < len; i++) out[i]! *= vel * 1.8;
  return trimTail(out);
}

/** A small brass sky chime: inharmonic bell modes with a soft strike (mono). */
export function brassChime(ctx: VoiceCtx, freq: number, vel: number, length = 1): Float32Array {
  const L = clampNum(length, 0.2, 3);
  const out = modal(ctx, freq, [1, 2.0, 2.76, 4.07, 5.43], [1, 0.42, 0.3, 0.14, 0.07], [1.6 * L, 1.1 * L, 0.7 * L, 0.4 * L, 0.25 * L], vel * 0.5, 10, { attack: 0.0008, detuneCents: 0 });
  const twin = modal(ctx, freq * 1.0025, [1], [0.35], [1.4 * L], vel * 0.5, 10);
  for (let i = 0; i < twin.length && i < out.length; i++) out[i]! += twin[i]!;
  const strike = noiseHit(ctx, vel * 0.18, 4200, 1.5, 0.0002, 0.006, 2000, 9000);
  for (let i = 0; i < strike.length && i < out.length; i++) out[i]! += strike[i]!;
  return out;
}

/** A short original bird chirp: an FM-swept sine with a quick amplitude shape (mono). */
export function birdChirp(ctx: VoiceCtx, f0: number, f1: number, dur: number, vel: number): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.ceil(dur * sr), out = new Float32Array(len);
  let p = rng();
  const wob = 30 + 40 * rng();
  for (let i = 0; i < len; i++) {
    const x = i / len, f = f0 * (f1 / f0) ** x * (1 + 0.03 * sinCycles((i * wob) / sr));
    p += f / sr;
    out[i] = sinCycles(p) * Math.sin(Math.PI * x) ** 1.5 * vel;
  }
  return out;
}

/**
 * Dawn over the valley (stereo, loopable): a soft breeze with slow gusts from three incommensurate cycles per channel,
 * sparse original bird phrases in the distance (two "birds" with their own registers and pans), and two far balloon
 * burners per loop, left and right.
 */
export function dawnValley(ctx: VoiceCtx, dur: number, level = 1, loopable = true): Stereo {
  const { sr, rng } = ctx;
  const body = Math.ceil(dur * sr), xf = loopable ? Math.min(body >> 1, sr * 2) : 0, len = body + xf;
  const out = stereo(len);
  let side = 0;
  for (const ch of [out.l, out.r]) {
    const lp = new Biquad(sr).lowpass(520, 0.7), hp = new Biquad(sr).highpass(50, 0.7), hiss = new Biquad(sr).bandpass(3400, 0.6);
    let brown = 0, g1 = rng(), g2 = rng(), g3 = rng();
    for (let i = 0; i < len; i++) {
      const gust = 0.3 + 0.7 * clampNum(0.5 + 0.3 * sinCycles(g1) + 0.14 * sinCycles(g2) + 0.07 * sinCycles(g3), 0, 1);
      g1 += 0.027 / sr; g2 += (0.071 + side * 0.005) / sr; g3 += 0.119 / sr;
      const n = rng() * 2 - 1;
      brown = brown * 0.985 + n * 0.15;
      ch[i] = (hp.tick(lp.tick(brown)) * 1.2 * gust + hiss.tick(n) * 0.02 * gust) * level;
    }
    side++;
  }
  // distant birds: short phrases of 2–4 chirps
  for (const [pan, base, gap] of [[-0.6, 2600, 3.1], [0.55, 3300, 4.3]] as const) {
    for (let t = rng() * gap; t < len / sr - 1; t += gap * (0.7 + 0.6 * rng())) {
      const k = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < k; j++) {
        const f0 = base * (0.9 + 0.3 * rng()), up = rng() < 0.5;
        const c = birdChirp(ctx, f0, f0 * (up ? 1.35 : 0.72), 0.06 + 0.05 * rng(), 0.05 * level);
        addMono(out, c, Math.round((t + j * (0.11 + 0.04 * rng())) * sr), 1, pan);
      }
    }
  }
  // two far burners per loop
  for (const [at, pan] of [[0.22, -0.7], [0.68, 0.65]] as const) {
    const b = burnerRoar(ctx, 1.6 + rng() * 0.8, 0.12 * level, { ignite: false, heat: 0.2, panFrom: pan, panTo: pan });
    const lpb = [new Biquad(sr).lowpass(900, 0.7), new Biquad(sr).lowpass(900, 0.7)];
    lpb[0]!.process(b.l); lpb[1]!.process(b.r);
    const s = Math.round(at * body);
    for (let i = 0; i < b.l.length && s + i < len; i++) { out.l[s + i]! += b.l[i]!; out.r[s + i]! += b.r[i]!; }
  }
  return xf ? loopify(out, body) : out;
}
