/**
 * Damla: Pamukkale sound design — original, synthesized (no samples, no voice). Built from the shared synth toolkit
 * (synth/dsp.ts, synth/instruments.ts, synth/master.ts). Material: water and travertine. A drop landing in a basin is a
 * resonant bubble "plink" (a sine whose pitch rises as the cavity closes) with a glassy stone tick; landings ring
 * celesta/glock chimes graded by the multiplier; the signature gold overflow is a shimmering riser into a bright bell
 * cascade. The beds: a gentle water ambience (flowing stream, distant drips) and a slow pentatonic celesta/harp music
 * loop, both 32 s and folded so they loop seamlessly.
 *
 * Pitched material sits on D major pentatonic (D E F# A B); the runtime moves plink pitch only along that ladder.
 * Pure functions of (sample rate, rng): the same inputs render the same buffers (tests check lengths, peaks and seams).
 */
import { Biquad, TAU, addMono, addStereo, createYielder, pinkNoise, stereo, type Rng, type Stereo } from '../synth/dsp';
import { celesta, glock, noiseHit, type VoiceCtx } from '../synth/instruments';
import { foldLoop, limitInPlace } from '../synth/master';
import { midiToHz } from '../timing';

/** D major pentatonic, MIDI. */
export const DAMLA_PENTA = [62, 64, 66, 69, 71] as const;
/** Playback-rate ladder for plinks (semitone steps along the pentatonic, relative to the rendered pitch). */
export const DAMLA_PLINK_STEPS = [0, 2, 4, 7, 9, 12, 14, 16] as const;
export const DAMLA_LOOP_SECONDS = 32;

const hz = midiToHz;
const mono = (dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0) => addMono(dst, src, Math.max(0, Math.round(at)), gain, pan);

/** One water plink: bubble resonance with an upward chirp, a tiny stone tick and a short air tail. */
export function renderPlink(ctx: VoiceCtx, freq: number, vel: number, variant = 0): Float32Array {
  const { sr, rng } = ctx;
  const len = Math.round(0.26 * sr);
  const out = new Float32Array(len);
  const chirp = 1.45 + variant * 0.12, tau = 0.018 + variant * 0.004, t60 = 0.09 + variant * 0.02;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = freq * (1 + (chirp - 1) * (1 - Math.exp(-t / tau)));
    phase += f / sr;
    const env = (t < 0.002 ? t / 0.002 : 1) * Math.exp((-6.9 * t) / t60);
    out[i] = Math.sin(TAU * phase) * env * vel;
  }
  // octave sheen
  let p2 = 0;
  for (let i = 0; i < Math.min(len, Math.round(0.06 * sr)); i++) { const t = i / sr; p2 += (freq * 2.01 * (1 + 0.3 * (1 - Math.exp(-t / tau)))) / sr; out[i]! += Math.sin(TAU * p2) * Math.exp(-t / 0.012) * 0.22 * vel; }
  // stone tick: band-passed noise, 3 ms
  const bp = new Biquad(sr).bandpass(3400 + variant * 500, 1.6);
  const tick = Math.round(0.004 * sr);
  for (let i = 0; i < tick; i++) out[i]! += bp.tick((rng() * 2 - 1) * (1 - i / tick)) * 0.5 * vel;
  return out;
}

/** Soft spray for a landing (filtered noise, longer for bigger landings). */
export function renderSplash(ctx: VoiceCtx, vel: number, seconds = 0.35): Float32Array {
  return noiseHit(ctx, vel, 2600, 0.6, 0.004, seconds, 700, 9000);
}

/** Landing chime per tier 0..5 (loss … ≥100×): stereo, bells and celesta on D pentatonic, brighter and longer up the tiers. */
export function renderChime(ctx: VoiceCtx, tier: number): Stereo {
  const { sr } = ctx;
  const plans: Array<Array<[number, number, number]>> = [
    [[62, 0, 0.35]],
    [[69, 0, 0.55], [74, 0.07, 0.5]],
    [[66, 0, 0.6], [69, 0.06, 0.6], [74, 0.12, 0.65]],
    [[69, 0, 0.65], [74, 0.07, 0.65], [78, 0.14, 0.7], [81, 0.21, 0.75]],
    [[62, 0, 0.6], [69, 0.05, 0.7], [74, 0.1, 0.75], [78, 0.15, 0.8], [81, 0.2, 0.85], [86, 0.28, 0.9]],
    [[50, 0, 0.7], [62, 0.02, 0.7], [69, 0.08, 0.8], [74, 0.14, 0.85], [78, 0.2, 0.9], [81, 0.26, 0.9], [86, 0.32, 0.95], [90, 0.4, 1]],
  ];
  const plan = plans[Math.max(0, Math.min(5, tier))]!;
  const seconds = 1.2 + tier * 0.45;
  const out = stereo(Math.ceil(seconds * sr));
  plan.forEach(([n, t, v], i) => {
    const pan = plan.length > 1 ? ((i / (plan.length - 1)) * 2 - 1) * 0.45 : 0;
    mono(out, celesta(ctx, hz(n), v * (tier === 0 ? 0.55 : 1), 0.4 + tier * 0.1, 0.8 + tier * 0.1), t * sr, 0.42, pan);
    if (tier >= 2) mono(out, glock(ctx, hz(n + 12), v * 0.5), t * sr + 0.01 * sr, 0.18, -pan);
  });
  if (tier >= 3) mono(out, renderSplash(ctx, 0.5, 0.25 + tier * 0.1), 0, 0.22, 0);
  return out;
}

/** Signature: the edge pool overflows and every terrace turns gold. A 3.4 s shimmer riser into a bright bell cascade. */
export function renderGoldStinger(ctx: VoiceCtx): Stereo {
  const { sr, rng } = ctx;
  const seconds = 3.6;
  const out = stereo(Math.ceil(seconds * sr));
  // riser: band-passed noise sweeping up, plus a rising sine glide
  const n = Math.round(0.9 * sr), noise = pinkNoise(n, rng), bp = new Biquad(sr);
  const rise = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if (i % 64 === 0) bp.bandpass(500 + 5200 * t * t, 2.2);
    ph += (hz(62) * (1 + 3 * t * t)) / sr;
    rise[i] = (bp.tick(noise[i]!) * 0.9 + Math.sin(TAU * ph) * 0.18) * t * t;
  }
  mono(out, rise, 0, 0.55, -0.2); mono(out, rise, 0.01 * sr, 0.55, 0.2);
  // bell cascade on D major pentatonic, two octaves down from the top, then a held chord
  const cascade = [98, 95, 93, 90, 86, 83, 81, 78, 74];
  cascade.forEach((m, i) => mono(out, glock(ctx, hz(m), 0.8 - i * 0.03), (0.86 + i * 0.07) * sr, 0.3, ((i % 2) * 2 - 1) * 0.5));
  for (const [m, pan] of [[62, -0.3], [66, 0.3], [69, -0.1], [74, 0.1], [78, 0.4]] as const) mono(out, celesta(ctx, hz(m), 0.85, 1.6, 1.1), 0.9 * sr, 0.34, pan);
  mono(out, renderSplash(ctx, 0.9, 0.7), 0.86 * sr, 0.4, 0);
  limitInPlace(out, -1.5, sr);
  return out;
}

/** Bet change / UI click: a tiny glassy tick. */
export function renderClick(ctx: VoiceCtx, up = true): Float32Array {
  return renderPlink(ctx, hz(up ? 86 : 81), 0.35, 3);
}
/** Denied: two low muted plinks. */
export function renderDenied(ctx: VoiceCtx): Float32Array {
  const a = renderPlink(ctx, hz(50), 0.5, 1), b = renderPlink(ctx, hz(47), 0.45, 1);
  const out = new Float32Array(a.length + Math.round(0.09 * ctx.sr));
  out.set(a, 0); for (let i = 0; i < b.length; i++) out[i + Math.round(0.09 * ctx.sr)]! += b[i]!;
  return out;
}

/** Gentle water ambience, `seconds` long and seamless: a stream (pink noise through slowly moving band filters), a
 * low pool murmur and sparse distant drips. */
export async function renderAmbience(ctx: VoiceCtx, seconds = DAMLA_LOOP_SECONDS, yieldNow: () => Promise<void> = createYielder()): Promise<Stereo> {
  const { sr, rng } = ctx;
  const loop = Math.round(seconds * sr), x = Math.round(2 * sr), len = loop + x;
  const bed = stereo(len);
  for (const [ch, seed] of [[bed.l, 0], [bed.r, 1]] as const) {
    const noise = pinkNoise(len, rng);
    const a = new Biquad(sr), b = new Biquad(sr).lowpass(240, 0.6);
    for (let i = 0; i < len; i++) {
      if (i % 256 === 0) {
        const t = (i % loop) / loop; // LFO periods divide the loop, so the motion is seamless
        a.bandpass(1300 + 500 * Math.sin(TAU * (t * 4 + seed * 0.25)) + 220 * Math.sin(TAU * (t * 9 + seed * 0.4)), 0.8);
        if (i % 65_536 === 0) await yieldNow();
      }
      const v = noise[i]!, t = (i % loop) / loop;
      const swell = 0.75 + 0.25 * Math.sin(TAU * (t * 2 + seed * 0.3));
      ch[i] = a.tick(v) * 0.5 * swell + b.tick(v) * 0.4;
    }
  }
  // seamless noise: the first `x` samples crossfade (equal power) from the render's overrun into its own start, so the
  // sample after the loop end is exactly the sample that followed it in the render
  const out = stereo(loop);
  for (const [dst, src] of [[out.l, bed.l], [out.r, bed.r]] as const) {
    dst.set(src.subarray(0, loop));
    for (let i = 0; i < x; i++) { const g = i / x; dst[i] = src[i]! * Math.sin(g * Math.PI / 2) + src[loop + i]! * Math.cos(g * Math.PI / 2); }
  }
  // distant drips: soft, high, sparse; their tails fold back onto the loop start
  const dripBuf = stereo(loop + Math.round(1 * sr));
  const drips = Math.round(seconds * 0.8);
  for (let k = 0; k < drips; k++) {
    const at = rng() * loop, m = DAMLA_PENTA[Math.floor(rng() * DAMLA_PENTA.length)]! + 12 * (1 + Math.floor(rng() * 2));
    mono(dripBuf, renderPlink(ctx, hz(m), 0.18 + rng() * 0.12, Math.floor(rng() * 4)), at, 0.5, rng() * 1.6 - 0.8);
    if (k % 6 === 0) await yieldNow();
  }
  addStereo(out, foldLoop(dripBuf, loop), 0, 1);
  limitInPlace(out, -6, sr, { circular: true });
  return out;
}

/** Slow pentatonic music bed (celesta arpeggios over soft low bells), 32 s, seamless. 75 BPM, 10 bars of 4/4. */
export async function renderMusic(ctx: VoiceCtx, seconds = DAMLA_LOOP_SECONDS, yieldNow: () => Promise<void> = createYielder()): Promise<Stereo> {
  const { sr, rng } = ctx;
  const loop = Math.round(seconds * sr), len = loop + Math.round(3 * sr);
  const out = stereo(len);
  const beat = seconds / 40; // 40 beats = 10 bars
  // chord roots per bar (D, Bm, G, A, D, F#m, G, A, Bm, A) voiced on the pentatonic where possible
  const bars: number[][] = [[50, 62, 66, 69], [47, 62, 66, 71], [43, 62, 67, 71], [45, 64, 69, 73], [50, 62, 66, 69], [42, 61, 66, 69], [43, 62, 67, 71], [45, 64, 69, 76], [47, 62, 66, 71], [45, 61, 64, 69]];
  for (let bar = 0; bar < bars.length; bar++) {
    const chord = bars[bar]!, t0 = bar * 4 * beat;
    mono(out, celesta(ctx, hz(chord[0]!), 0.45, beat * 3.6, 0.5), t0 * sr, 0.35, 0);
    const pattern = [1, 2, 3, 2, 3, 1, 2, 3];
    pattern.forEach((idx, s) => {
      const note = chord[idx]! + 12 + (s === 6 && rng() < 0.5 ? 12 : 0);
      const vel = 0.32 + (s % 2 === 0 ? 0.1 : 0) + rng() * 0.06;
      mono(out, celesta(ctx, hz(note), vel, beat * 0.4, 0.7), (t0 + s * beat * 0.5) * sr + rng() * 0.006 * sr, 0.22, s % 2 ? 0.35 : -0.35);
    });
    await yieldNow();
  }
  // a gentle echo (dotted eighth) for space
  const d = Math.round(beat * 0.75 * sr);
  for (let i = len - 1; i >= d; i--) { out.l[i]! += out.r[i - d]! * 0.28; out.r[i]! += out.l[i - d]! * 0.28; }
  const folded = foldLoop(out, loop);
  limitInPlace(folded, -4, sr, { circular: true });
  return folded;
}

/** Convenience for tests and the runtime: an rng from a 32-bit seed (mulberry32). */
export function damlaRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export { addStereo };
