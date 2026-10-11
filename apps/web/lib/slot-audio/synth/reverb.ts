/**
 * Generated convolution impulse responses (no recorded spaces): stereo-decorrelated noise with
 * pre-delay, a handful of early reflections, exponential decay and frequency-dependent damping
 * (the low-pass closes as the tail ages, like air and soft furnishings absorbing the highs).
 */
import { Biquad, createYielder, stereo, type Rng, type Stereo } from './dsp';

export interface ImpulseSpec {
  /** Time to −60 dB. */
  seconds: number;
  preDelay: number;
  /** 0 bright … 1 dark. */
  damping: number;
  /** Early-reflection level relative to the tail. */
  early: number;
  /** Low cut on the tail so the reverb never muddies the bass. */
  lowCut: number;
}

export const HALL: ImpulseSpec = { seconds: 2.3, preDelay: 0.022, damping: 0.55, early: 0.5, lowCut: 220 };
export const ROOM: ImpulseSpec = { seconds: 0.6, preDelay: 0.008, damping: 0.6, early: 0.7, lowCut: 260 };

export async function makeImpulse(sampleRate: number, spec: ImpulseSpec, rng: Rng): Promise<Stereo> {
  const tick = createYielder(8);
  const pre = Math.round(spec.preDelay * sampleRate);
  const len = pre + Math.ceil(spec.seconds * sampleRate);
  const out = stereo(len);
  const fStart = 11000 * (1 - spec.damping * 0.45), fEnd = 300 + 2600 * (1 - spec.damping);
  const decay = -6.9078 / (spec.seconds * sampleRate);
  for (const [ci, ch] of [out.l, out.r].entries()) {
    let lp = 0;
    const hp = new Biquad(sampleRate).highpass(spec.lowCut, 0.6);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      if (((i - pre) & 127) === 0) await tick();
      const x = Math.min(1, t / spec.seconds);
      const cutoff = fStart * (fEnd / fStart) ** x;
      const c = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      lp += c * ((rng() * 2 - 1) - lp);
      // soft onset over 12 ms so the tail blooms instead of clicking in
      const onset = Math.min(1, t / 0.012);
      ch[i] = hp.tick(lp) * Math.exp(decay * (i - pre)) * onset;
    }
    // early reflections: sparse taps 4–45 ms after the pre-delay, different per channel
    const taps = 9;
    for (let k = 0; k < taps; k++) {
      const at = pre + Math.round((0.004 + rng() * 0.041) * sampleRate);
      const g = spec.early * (0.4 + 0.6 * rng()) * (1 - k / taps) * (ci === 0 ? 1 : 0.9);
      if (at < len) ch[at]! += (rng() < 0.5 ? -1 : 1) * g * 0.25;
    }
  }
  // normalise energy so wet level is set by the send gain alone
  let energy = 0;
  for (let i = 0; i < len; i++) energy += out.l[i]! * out.l[i]! + out.r[i]! * out.r[i]!;
  const g = 1 / Math.sqrt(Math.max(1e-12, energy / 2));
  for (let i = 0; i < len; i++) { out.l[i]! *= g; out.r[i]! *= g; }
  return out;
}
