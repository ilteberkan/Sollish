/**
 * Pure timing and mix math for the slot audio engine. No Web Audio here, so it is unit tested in Node.
 * Musical time is in beats; audio time is in seconds; buffers are in samples.
 */

export type SceneId = 'idle' | 'base' | 'feature' | 'bigwin' | 'none';
export type BusId = 'music' | 'sfx' | 'ambience';
export type Quantize = 'none' | 'beat' | 'bar';

/** Slider values 0..1 as the player sees them, plus a global mute. */
export interface MixSettings { master: number; music: number; sfx: number; ambience: number; muted: boolean }

export const DEFAULT_MIX: Readonly<MixSettings> = Object.freeze({ master: 1, music: 0.85, sfx: 0.95, ambience: 0.6, muted: false });
/** Ramp used for every mix change, long enough to never click and short enough to feel immediate. */
export const MIX_RAMP_SECONDS = 0.06;

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const centsToRate = (cents: number) => 2 ** (cents / 1200);

export const beatSeconds = (bpm: number) => 60 / bpm;
export const barSeconds = (bpm: number, beatsPerBar = 4) => (60 / bpm) * beatsPerBar;
/** Loop length rounded once to whole samples: the buffer length and the loopEnd are both derived from it. */
export const loopLengthSamples = (bars: number, bpm: number, beatsPerBar: number, sampleRate: number) =>
  Math.round(((bars * beatsPerBar * 60) / bpm) * sampleRate);
export const beatToSeconds = (beat: number, bpm: number) => (beat * 60) / bpm;
export const beatToSample = (beat: number, bpm: number, sampleRate: number) => Math.round(((beat * 60) / bpm) * sampleRate);

/**
 * Swing warp. `ratio` is where the off-beat eighth lands inside the beat: 0.5 is straight, 2/3 is triplet swing.
 * Piecewise linear inside each beat, so on-beats stay put, 16ths scale with their half and order never flips.
 */
export function swingBeat(beat: number, ratio: number): number {
  const r = clamp(ratio, 0.5, 0.75);
  if (r === 0.5) return beat;
  const whole = Math.floor(beat), p = beat - whole;
  return whole + (p < 0.5 ? p * (r / 0.5) : r + (p - 0.5) * ((1 - r) / 0.5));
}

/** Where a looping scene is: it started at `startTime` (context seconds) from `offset` seconds into the loop. */
export interface LoopClock { startTime: number; offset: number; loopSeconds: number; bpm: number; beatsPerBar: number }

export function loopPosition(clock: LoopClock, now: number): number {
  const elapsed = now - clock.startTime + clock.offset;
  const pos = elapsed % clock.loopSeconds;
  return pos < 0 ? pos + clock.loopSeconds : pos;
}

/**
 * Next beat or bar line of a playing loop, as an absolute context time not earlier than `now + minLead`.
 * The loop length is a whole number of bars, so the grid continues across the seam.
 */
export function nextBoundary(clock: LoopClock, now: number, unit: Quantize, minLead = 0.025): number {
  const earliest = now + minLead;
  if (unit === 'none') return earliest;
  const step = unit === 'bar' ? barSeconds(clock.bpm, clock.beatsPerBar) : beatSeconds(clock.bpm);
  const elapsed = earliest - clock.startTime + clock.offset;
  const index = Math.ceil(elapsed / step - 1e-9);
  return clock.startTime - clock.offset + index * step;
}

/** Equal-power gain curve: fade-in sin(x·π/2), fade-out cos(x·π/2); squared gains sum to 1 at every point. */
export function equalPowerCurve(steps: number, fadeIn: boolean, from = 1): Float32Array {
  const n = Math.max(2, Math.floor(steps));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    curve[i] = from * (fadeIn ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2));
  }
  return curve;
}

/** Slider position to linear gain. Square law: 0.5 is about −12 dB, a perceptually even fader. */
export const sliderToGain = (value: number) => {
  const v = clamp(value, 0, 1);
  return v * v;
};

/** Target linear gain per node for a mix setting; master already folds in the mute. */
export function busGains(mix: MixSettings): Record<'master' | BusId, number> {
  return {
    master: mix.muted ? 0 : sliderToGain(mix.master),
    music: sliderToGain(mix.music),
    sfx: sliderToGain(mix.sfx),
    ambience: sliderToGain(mix.ambience),
  };
}

export function normalizeMix(partial: Partial<MixSettings>, base: MixSettings = DEFAULT_MIX): MixSettings {
  return {
    master: clamp(partial.master ?? base.master, 0, 1),
    music: clamp(partial.music ?? base.music, 0, 1),
    sfx: clamp(partial.sfx ?? base.sfx, 0, 1),
    ambience: clamp(partial.ambience ?? base.ambience, 0, 1),
    muted: typeof partial.muted === 'boolean' ? partial.muted : base.muted,
  };
}

/** Value of a linear ramp from `from` (at t0) to `to` (at t0 + duration) at time t; what AudioParam does. */
export function linearRampValue(from: number, to: number, t0: number, duration: number, t: number): number {
  if (duration <= 0 || t >= t0 + duration) return to;
  if (t <= t0) return from;
  return from + ((to - from) * (t - t0)) / duration;
}

/** Duck shape: fall to `amountDb` in `attack`, hold, recover in `release` (seconds). */
export interface DuckPlan { floor: number; attack: number; holdUntil: number; releaseEnd: number }
export function duckPlan(now: number, amountDb: number, holdMs: number, attackMs = 40, releaseMs = 450): DuckPlan {
  const attack = Math.max(0.005, attackMs / 1000);
  const floor = dbToGain(-Math.abs(amountDb));
  const holdUntil = now + attack + Math.max(0, holdMs) / 1000;
  return { floor, attack, holdUntil, releaseEnd: holdUntil + Math.max(0.02, releaseMs / 1000) };
}

/** Random micro-variation for one-shots, from a 0..1 random source: ±cents of pitch and ±dB of gain. */
export function microVariation(random: () => number, cents: number, db: number): { rate: number; gain: number } {
  const c = (random() * 2 - 1) * cents, g = (random() * 2 - 1) * db;
  return { rate: centsToRate(c), gain: dbToGain(g) };
}

/** Pick the next variation index without repeating the previous one (when there are at least two). */
export function pickVariation(count: number, previous: number, random: () => number): number {
  if (count <= 1) return 0;
  let index = Math.floor(random() * (count - 1));
  if (index >= previous && previous >= 0) index += 1;
  return Math.min(count - 1, index);
}

/** Deterministic PRNG (mulberry32) so renders are reproducible. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small FNV-1a hash to derive stable seeds from ids. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
