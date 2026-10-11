/**
 * Mastering and measurement: BS.1770 K-weighted loudness (integrated, momentary, short-term),
 * 4× oversampled true peak, a look-ahead peak limiter (circular for loops), loop folding and
 * spectral/seam metrics. Pure functions over Float32Arrays, shared by the renderer, tests and the
 * measurement harness.
 */
import type { Stereo } from './dsp';

type Coefs = [number, number, number, number, number];

/** K-weighting for any sample rate (pre-filter shelf + RLB high-pass), as in libebur128. */
export function kWeighting(sampleRate: number): [Coefs, Coefs] {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Coefs = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: Coefs = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}

/** K-weighted power summed over channels, per sample (optionally on every `stride`-th sample). */
function kPower(channels: Float32Array[], sampleRate: number, stride: number): Float64Array {
  const n = Math.floor(channels[0]!.length / stride);
  const pow = new Float64Array(n);
  const [s, h] = kWeighting(sampleRate / stride);
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, w1 = 0, w2 = 0, dn = 1e-24;
    for (let i = 0, j = 0; i < n; i++, j += stride) {
      dn = -dn; // keeps the filter state out of the denormal range in long silences
      const xi = x[j]! + dn;
      const y = s[0] * xi + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y;
      const w = h[0] * y + h[1] * u1 + h[2] * u2 - h[3] * w1 - h[4] * w2;
      u2 = u1; u1 = y; w2 = w1; w1 = w;
      pow[i]! += w * w;
    }
  }
  return pow;
}

export interface LoudnessReport { integrated: number; momentaryMax: number; shortTermMax: number }

const toLufs = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);

/**
 * Loudness of a stereo signal. Signals shorter than a block are zero-padded to 400 ms.
 * `stride` > 1 measures a decimated copy (fast estimate, used to balance stems; masters use 1).
 */
export function loudness(channels: Float32Array[], sampleRate: number, stride = 1): LoudnessReport {
  const pow = kPower(channels, sampleRate, stride);
  const rate = sampleRate / stride, n = pow.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + pow[i]!;
  const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate), st = Math.round(3 * rate);
  const power = (a: number, len: number) => (prefix[Math.min(n, a + len)]! - prefix[Math.max(0, Math.min(n, a))]!) / len;
  const blocks: number[] = [];
  let momentaryMax = -Infinity, shortTermMax = -Infinity;
  const last = Math.max(0, n - block);
  for (let a = 0; a <= last; a += hop) { const z = power(a, block); blocks.push(z); momentaryMax = Math.max(momentaryMax, toLufs(z)); }
  if (n < block) { const z = power(0, block); blocks.length = 0; blocks.push(z); momentaryMax = toLufs(z); }
  for (let a = 0; a <= Math.max(0, n - st); a += hop) shortTermMax = Math.max(shortTermMax, toLufs(power(a, Math.min(st, Math.max(n, block)))));
  const abs = blocks.filter(z => toLufs(z) > -70);
  if (!abs.length) return { integrated: -Infinity, momentaryMax, shortTermMax };
  const rel = toLufs(abs.reduce((s, z) => s + z, 0) / abs.length) - 10;
  const gated = abs.filter(z => toLufs(z) > rel);
  return { integrated: toLufs(gated.reduce((s, z) => s + z, 0) / gated.length), momentaryMax, shortTermMax };
}

/** Windowed-sinc 4× interpolation taps (12 zero crossings each side). */
const OVERSAMPLE = 4, HALF_TAPS = 12;
const PHASES: Float64Array[] = (() => {
  const phases: Float64Array[] = [];
  for (let p = 1; p < OVERSAMPLE; p++) {
    const taps = new Float64Array(HALF_TAPS * 2);
    const frac = p / OVERSAMPLE;
    for (let k = 0; k < HALF_TAPS * 2; k++) {
      const x = k - HALF_TAPS + 1 - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / HALF_TAPS) + 0.08 * Math.cos((2 * Math.PI * x) / HALF_TAPS);
      taps[k] = sinc * (Math.abs(x) < HALF_TAPS ? w : 0);
    }
    phases.push(taps);
  }
  return phases;
})();

/** True peak (dBTP) by 4× oversampling. */
export function truePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(ch[i]!); if (v > peak) peak = v;
      // only interpolate around loud samples: cheap and exact enough for a peak search
      if (v < peak * 0.5) continue;
      for (const taps of PHASES) {
        let s = 0;
        for (let k = 0; k < taps.length; k++) {
          const j = i + k - HALF_TAPS + 1;
          if (j >= 0 && j < n) s += ch[j]! * taps[k]!;
        }
        const a = Math.abs(s); if (a > peak) peak = a;
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function samplePeakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]!); if (v > p) p = v; }
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

export function rmsDb(channels: Float32Array[], start = 0, end = channels[0]!.length): number {
  let s = 0, n = 0;
  for (const ch of channels) for (let i = Math.max(0, start); i < Math.min(ch.length, end); i++) { s += ch[i]! * ch[i]!; n++; }
  return n && s > 0 ? 10 * Math.log10(s / n) : -Infinity;
}

export function gainInPlace(st: Stereo, gain: number): void {
  for (const ch of [st.l, st.r]) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
}

/**
 * Look-ahead brickwall limiter. Required gain per sample → minimum over the look-ahead window →
 * release smoothing → moving average of the window length; the average of window minima can never
 * exceed the required gain, so the output never passes the ceiling. `circular` treats the buffer as
 * a loop (state wraps across the seam), so a looped buffer stays seamless.
 */
export function limitInPlace(st: Stereo, ceilingDb: number, sampleRate: number, opts: { circular?: boolean; lookaheadMs?: number; releaseMs?: number } = {}): number {
  const n = st.l.length; if (!n) return 0;
  const ceiling = 10 ** (ceilingDb / 20);
  const L = Math.max(2, Math.round(((opts.lookaheadMs ?? 3) / 1000) * sampleRate));
  const rel = Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate));
  const circ = !!opts.circular;
  // circular: lap 0 warms the envelope, lap 1 is kept, lap 2's head provides look-ahead across the seam
  const laps = circ ? 3 : 1, total = circ ? 2 * n + L : n;
  const { l, r } = st;
  let hold: Float32Array | null = null;
  for (let j = 0; j < n; j++) {
    let a = l[j]!; if (a < 0) a = -a;
    let b = r[j]!; if (b < 0) b = -b;
    if (b > a) a = b;
    if (a <= ceiling) continue;
    if (!hold) hold = new Float32Array(total).fill(1);
    const g = ceiling / a;
    for (let lap = 0; lap < laps; lap++) {
      const i = j + lap * n;
      for (let k = Math.max(0, i - L); k <= i && k < total; k++) if (hold[k]! > g) hold[k] = g;
    }
  }
  if (!hold) return 0;
  let env = 1;
  for (let i = 0; i < total; i++) { const v = env * rel + (1 - rel); env = hold[i]! < v ? hold[i]! : v; hold[i] = env; }
  // moving average over L samples; each value is the minimum over a window containing i, so g ≤ required
  let acc = 0, minGain = 1;
  const offset = circ ? n : 0;
  for (let i = 0; i < offset + n; i++) {
    acc += hold[i]!; if (i >= L) acc -= hold[i - L]!;
    if (i < offset) continue;
    const g = acc / Math.min(i + 1, L);
    if (g < 1) { const j = i - offset; l[j]! *= g; r[j]! *= g; if (g < minGain) minGain = g; }
  }
  return 20 * Math.log10(minGain);
}

/** Fold the render tail (reverb and releases past the loop end) back onto the loop start. */
export function foldLoop(st: Stereo, loopLength: number): Stereo {
  const l = st.l.slice(0, loopLength), r = st.r.slice(0, loopLength);
  for (let i = loopLength; i < st.l.length; i++) { const j = (i - loopLength) % loopLength; l[j]! += st.l[i]!; r[j]! += st.r[i]!; }
  return { l, r };
}

/** Normalise to a loudness target then limit; repeats once so limiting does not leave it short. */
export function master(st: Stereo, sampleRate: number, target: { lufs: number; measure: 'integrated' | 'momentary' }, ceilingDb: number, circular: boolean): { gainDb: number; limitDb: number; lufs: number } {
  // long buffers are measured at half rate (K-weighting is defined for any rate; the error is < 0.2 dB here)
  const stride = st.l.length > sampleRate * 4 ? 2 : 1;
  const read = () => { const m = loudness([st.l, st.r], sampleRate, stride); return target.measure === 'integrated' ? m.integrated : m.momentaryMax; };
  let lufs = read();
  if (!Number.isFinite(lufs)) return { gainDb: 0, limitDb: 0, lufs };
  let totalGain = 0, limitDb = 0;
  for (let pass = 0; pass < 3; pass++) {
    const delta = Math.max(-40, Math.min(30, target.lufs - lufs));
    if (pass > 0 && Math.abs(delta) < 0.12) break;
    gainInPlace(st, 10 ** (delta / 20)); totalGain += delta;
    const reduced = limitInPlace(st, ceilingDb, sampleRate, { circular });
    limitDb = Math.min(limitDb, reduced);
    // gain is exact; only limiting moves the loudness, so re-measure only when it did real work
    if (reduced > -0.5) { lufs += delta; break; }
    lufs = read();
  }
  return { gainDb: totalGain, limitDb, lufs };
}

/* ---------------- spectrum and seam ---------------- */

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a]! += tr; im[a]! += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export interface SpectrumReport { centroidHz: number; above8kPct: number; above12kPct: number; bandsDb: Record<string, number> }

/** Average power spectrum over up to `maxFrames` Hann frames of the mid signal. */
export function spectrum(channels: Float32Array[], sampleRate: number, size = 4096, maxFrames = 160): SpectrumReport {
  const n = channels[0]!.length;
  const power = new Float64Array(size / 2);
  const frames = Math.max(1, Math.min(maxFrames, Math.floor(n / size)));
  const hop = n > size ? Math.floor((n - size) / Math.max(1, frames - 1)) : 0;
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const a = f * hop;
    for (let i = 0; i < size; i++) {
      const j = a + i;
      let v = 0;
      if (j < n) for (const ch of channels) v += ch[j]!;
      re[i] = (v / channels.length) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))); im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  let total = 0, weighted = 0, above8 = 0, above12 = 0;
  const edges = [0, 125, 500, 2000, 5000, 8000, 12000, Infinity], bands = new Array(edges.length - 1).fill(0);
  for (let k = 1; k < size / 2; k++) {
    const hz = (k * sampleRate) / size, p = power[k]!;
    total += p; weighted += p * hz;
    if (hz >= 8000) above8 += p;
    if (hz >= 12000) above12 += p;
    for (let b = 0; b < bands.length; b++) if (hz >= edges[b]! && hz < edges[b + 1]!) { bands[b] += p; break; }
  }
  // band energy relative to the total, in dB (an octave-ish tonal-balance fingerprint)
  const bandsDb: Record<string, number> = {};
  bands.forEach((p, b) => { bandsDb[`${edges[b]}-${edges[b + 1] === Infinity ? 'top' : edges[b + 1]}`] = total > 0 && p > 0 ? Math.round(100 * 10 * Math.log10(p / total)) / 100 : -99; });
  return total > 0 ? { centroidHz: weighted / total, above8kPct: (100 * above8) / total, above12kPct: (100 * above12) / total, bandsDb } : { centroidHz: 0, above8kPct: 0, above12kPct: 0, bandsDb };
}

export interface SeamReport { seamDelta: number; medianDelta: number; p999Delta: number; maxDelta: number; seamRatio: number; seamPercentile: number; rmsEndDb: number; rmsStartDb: number; rmsJumpDb: number }

/**
 * Loop seam: the step from the last sample to the first, compared with every other sample-to-sample
 * step in the loop (median, 99.9th percentile, maximum and the seam's percentile rank), plus the RMS
 * of the 50 ms before and after the seam. A seam is clean when its step is an ordinary step of the
 * music (a drum transient landing on the downbeat is allowed); a cut waveform shows as an outlier.
 */
export function seam(channels: Float32Array[], sampleRate: number): SeamReport {
  const n = channels[0]!.length;
  let seamDelta = 0;
  const deltas: number[] = [];
  for (const ch of channels) {
    seamDelta = Math.max(seamDelta, Math.abs(ch[0]! - ch[n - 1]!));
    for (let i = 1; i < n; i++) deltas.push(Math.abs(ch[i]! - ch[i - 1]!));
  }
  deltas.sort((a, b) => a - b);
  const q = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] ?? 0;
  let below = 0, lo = 0, hi = deltas.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (deltas[mid]! < seamDelta) lo = mid + 1; else hi = mid; }
  below = lo;
  const medianDelta = q(0.5);
  const w = Math.round(0.05 * sampleRate);
  const rmsEndDb = rmsDb(channels, n - w, n), rmsStartDb = rmsDb(channels, 0, w);
  return {
    seamDelta, medianDelta, p999Delta: q(0.999), maxDelta: deltas[deltas.length - 1] ?? 0, seamRatio: medianDelta > 0 ? seamDelta / medianDelta : 0,
    seamPercentile: deltas.length ? (100 * below) / deltas.length : 0, rmsEndDb, rmsStartDb, rmsJumpDb: rmsStartDb - rmsEndDb,
  };
}

/** 16-bit PCM WAV (interleaved), with TPDF dither. */
export function encodeWav16(channels: Float32Array[], sampleRate: number, rng: () => number = Math.random): Uint8Array {
  const n = channels[0]!.length, c = channels.length;
  const bytes = new Uint8Array(44 + n * c * 2), view = new DataView(bytes.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + n * c * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, c, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * c * 2, true); view.setUint16(32, c * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * c * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    const d = (rng() - rng()) / 32768;
    const v = Math.max(-1, Math.min(1, channels[k]![i]! + d));
    view.setInt16(o, Math.round(v * 32767), true); o += 2;
  }
  return bytes;
}
