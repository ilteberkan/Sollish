/**
 * Small, allocation-light DSP toolkit used to synthesize instruments offline into Float32Arrays.
 * Everything is deterministic given the seeded random source.
 */

export interface Stereo { l: Float32Array; r: Float32Array }
export type Rng = () => number;

export const TAU = Math.PI * 2;
const SIN_SIZE = 4096;
const SIN = new Float32Array(SIN_SIZE + 1);
for (let i = 0; i <= SIN_SIZE; i++) SIN[i] = Math.sin((i / SIN_SIZE) * TAU);

/** Sine of a phase in cycles (any real number), linear-interpolated table lookup. */
export function sinCycles(phase: number): number {
  const p = phase - Math.floor(phase);
  const x = p * SIN_SIZE, i = x | 0, f = x - i;
  return SIN[i]! + (SIN[i + 1]! - SIN[i]!) * f;
}

export const stereo = (length: number): Stereo => ({ l: new Float32Array(length), r: new Float32Array(length) });

/** Equal-power pan gains for pan in −1..1. */
export function panGains(pan: number): [number, number] {
  const p = (Math.max(-1, Math.min(1, pan)) + 1) * 0.25 * Math.PI;
  return [Math.cos(p), Math.sin(p)];
}

/** Mix a mono buffer into a stereo bus at a sample offset (offset may be negative: the head is skipped). */
export function addMono(dst: Stereo, src: Float32Array, at: number, gain: number, pan = 0): void {
  const [gl, gr] = panGains(pan);
  const a = gain * gl, b = gain * gr;
  const start = Math.max(0, -at), end = Math.min(src.length, dst.l.length - at);
  const L = dst.l, R = dst.r;
  for (let i = start; i < end; i++) { const v = src[i]!; L[at + i]! += v * a; R[at + i]! += v * b; }
}

/** Mix a stereo buffer with a balance and a mid/side width (1 = unchanged, 0 = mono). */
export function addStereo(dst: Stereo, src: Stereo, at: number, gain: number, pan = 0, width = 1): void {
  const [gl, gr] = panGains(pan);
  const bl = gain * gl * Math.SQRT2, br = gain * gr * Math.SQRT2;
  const start = Math.max(0, -at), end = Math.min(src.l.length, dst.l.length - at);
  const w = width;
  for (let i = start; i < end; i++) {
    const l = src.l[i]!, r = src.r[i]!;
    const m = (l + r) * 0.5, s = (l - r) * 0.5 * w;
    dst.l[at + i]! += (m + s) * bl;
    dst.r[at + i]! += (m - s) * br;
  }
}

/** Linear-interpolation upsampler for material rendered at a reduced rate (pads, bass: little energy up top). */
export function upsample(x: Float32Array, factor: number): Float32Array {
  if (factor === 1) return x;
  const n = x.length, out = new Float32Array(n * factor);
  for (let i = 0; i < n; i++) {
    const a = x[i]!, d = (i + 1 < n ? x[i + 1]! : 0) - a, o = i * factor;
    for (let k = 0; k < factor; k++) out[o + k] = a + (d * k) / factor;
  }
  return out;
}

/**
 * Mix a stereo buffer rendered at 1/`factor` of the bus rate, linearly interpolating up on the fly
 * (no intermediate allocation), with balance and mid/side width like `addStereo`.
 */
export function addStereoUpsampled(dst: Stereo, src: Stereo, factor: number, at: number, gain: number, pan = 0, width = 1): number {
  const [gl, gr] = panGains(pan);
  const bl = gain * gl * Math.SQRT2, br = gain * gr * Math.SQRT2;
  const n = src.l.length, out = n * factor, L = dst.l, R = dst.r, inv = 1 / factor;
  for (let i = 0; i < n; i++) {
    const l0 = src.l[i]!, r0 = src.r[i]!, l1 = i + 1 < n ? src.l[i + 1]! : 0, r1 = i + 1 < n ? src.r[i + 1]! : 0;
    for (let k = 0; k < factor; k++) {
      const j = at + i * factor + k;
      if (j < 0) continue;
      if (j >= L.length) return out;
      const x = k * inv, l = l0 + (l1 - l0) * x, r = r0 + (r1 - r0) * x;
      const m = (l + r) * 0.5, s = (l - r) * 0.5 * width;
      L[j]! += (m + s) * bl; R[j]! += (m - s) * br;
    }
  }
  return out;
}

/** RBJ biquad, transposed direct form II. */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0; private dn = 1e-24;
  constructor(readonly sampleRate: number) {}
  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  private w(freq: number) { return (TAU * Math.min(freq, this.sampleRate * 0.49)) / this.sampleRate; }
  lowpass(freq: number, q = 0.707) { const w = this.w(freq), c = Math.cos(w), a = Math.sin(w) / (2 * q); return this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a); }
  highpass(freq: number, q = 0.707) { const w = this.w(freq), c = Math.cos(w), a = Math.sin(w) / (2 * q); return this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a); }
  bandpass(freq: number, q = 1) { const w = this.w(freq), c = Math.cos(w), a = Math.sin(w) / (2 * q); return this.set(a, 0, -a, 1 + a, -2 * c, 1 - a); }
  peaking(freq: number, q: number, db: number) {
    const w = this.w(freq), c = Math.cos(w), a = Math.sin(w) / (2 * q), A = 10 ** (db / 40);
    return this.set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A);
  }
  highShelf(freq: number, db: number, slope = 1) {
    const w = this.w(freq), c = Math.cos(w), s = Math.sin(w), A = 10 ** (db / 40);
    const alpha = (s / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2), k = 2 * Math.sqrt(A) * alpha;
    return this.set(A * (A + 1 + (A - 1) * c + k), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - k), A + 1 - (A - 1) * c + k, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - k);
  }
  lowShelf(freq: number, db: number, slope = 1) {
    const w = this.w(freq), c = Math.cos(w), s = Math.sin(w), A = 10 ** (db / 40);
    const alpha = (s / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2), k = 2 * Math.sqrt(A) * alpha;
    return this.set(A * (A + 1 - (A - 1) * c + k), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - k), A + 1 + (A - 1) * c + k, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - k);
  }
  reset() { this.z1 = 0; this.z2 = 0; return this; }
  tick(input: number): number {
    // alternating ±1e-24 keeps IIR state out of the (very slow) denormal range during silence
    const x = input + (this.dn = -this.dn);
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  process(buf: Float32Array, start = 0, end = buf.length): Float32Array {
    let z1 = this.z1, z2 = this.z2;
    const { b0, b1, b2, a1, a2 } = this;
    let dn = this.dn;
    for (let i = start; i < end; i++) {
      dn = -dn;
      const x = buf[i]! + dn, y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; buf[i] = y;
    }
    this.z1 = z1; this.z2 = z2; this.dn = dn;
    return buf;
  }
}

/** Zero-delay-feedback state-variable filter (Simper/TPT), cheap to modulate per block. */
export class Svf {
  private g = 0; private k = 1.4; private a1 = 0; private a2 = 0; private a3 = 0; private ic1 = 0; private ic2 = 0; private dn = 1e-24;
  constructor(readonly sampleRate: number) {}
  set(freq: number, q = 0.707) {
    this.g = Math.tan((Math.PI * Math.min(Math.max(freq, 10), this.sampleRate * 0.45)) / this.sampleRate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + this.g * (this.g + this.k)); this.a2 = this.g * this.a1; this.a3 = this.g * this.a2;
  }
  /** Returns the lowpass output; bandpass/highpass available through the mode argument. */
  tick(input: number, mode: 0 | 1 | 2 = 0): number {
    const v0 = input + (this.dn = -this.dn);
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return mode === 0 ? v2 : mode === 1 ? v1 : v0 - this.k * v1 - v2;
  }
}

/** One-pole lowpass coefficient for a cutoff frequency. */
export const onePoleCoef = (freq: number, sampleRate: number) => 1 - Math.exp((-TAU * freq) / sampleRate);

/** Soft saturator, tanh-shaped, unity slope at zero. */
export function softClip(x: number): number {
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function whiteNoise(length: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Paul Kellet's economy pink noise filter. */
export function pinkNoise(length: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  return out;
}

/** Linear attack then exponential decay to −60 dB at `t60` seconds; returns the gain at t. */
export const strikeEnv = (t: number, attack: number, t60: number) => (t < attack ? t / attack : Math.exp((-6.9078 * (t - attack)) / t60));

/** Apply a short fade-in and fade-out in place (avoids clicks at buffer edges). */
export function fadeEdges(buf: Float32Array, fadeIn: number, fadeOut: number): Float32Array {
  const n = buf.length, a = Math.min(fadeIn, n), b = Math.min(fadeOut, n);
  for (let i = 0; i < a; i++) buf[i]! *= i / a;
  for (let i = 0; i < b; i++) buf[n - 1 - i]! *= i / b;
  return buf;
}

/** DC blocker, in place. */
export function dcBlock(buf: Float32Array, r = 0.9995): Float32Array {
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) { const x = buf[i]!; const y = x - x1 + r * y1; x1 = x; y1 = y; buf[i] = y; }
  return buf;
}

/** Trim trailing near-silence (keeps at least `min` samples) and fade the new end. */
export function trimTail(buf: Float32Array, threshold = 1e-4, min = 64): Float32Array {
  let end = buf.length;
  while (end > min && Math.abs(buf[end - 1]!) < threshold) end--;
  const out = end === buf.length ? buf : buf.slice(0, Math.min(buf.length, end + 32));
  return fadeEdges(out, 0, Math.min(256, out.length >> 2));
}

export function peakAbs(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]!); if (v > p) p = v; }
  return p;
}

export function scaleInPlace(buf: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i]! *= gain;
  return buf;
}

/** Cooperative yielding for long synthesis jobs: call `await tick()` often; it only yields every `budgetMs`. */
export function createYielder(budgetMs = 8): () => Promise<void> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let last = now();
  let channel: MessageChannel | null = null;
  const queue: (() => void)[] = [];
  const yieldOnce = () => new Promise<void>(resolve => {
    if (typeof MessageChannel !== 'undefined') {
      if (!channel) {
        channel = new MessageChannel(); channel.port1.onmessage = () => queue.shift()?.();
        // Node keeps the process alive while a port listens; browsers ignore this.
        (channel.port1 as unknown as { unref?: () => void }).unref?.();
      }
      queue.push(resolve); channel.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });
  return async () => {
    if (now() - last < budgetMs) return;
    await yieldOnce();
    last = now();
  };
}
