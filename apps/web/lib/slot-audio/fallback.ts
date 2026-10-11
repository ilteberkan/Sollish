/**
 * Live-synthesised fallback voice: tiny oscillator/noise sketches of the main effects. Used only while
 * the rendered bank is not ready yet (the first second after sound is enabled) or where
 * OfflineAudioContext is missing, so a tap is never silent.
 */
import { clamp, midiToHz } from './timing';

const PENTA = [0, 2, 4, 7, 9];
const scale = (root: number, degree: number) => root + 12 * Math.floor(degree / 5) + PENTA[((degree % 5) + 5) % 5]!;

export interface FallbackVoice {
  spin(): void; land(column: number): void; pop(count: number, tier: number): void; win(multiplier: number): void;
  crystal(value: number): void; collect(): void; scatter(n: number): void; chimeRun(steps: number, root: number): void; click(): void;
}

export function createFallbackVoice(ctx: BaseAudioContext, out: AudioNode): FallbackVoice {
  let noise: AudioBuffer | null = null;
  const noiseBuffer = () => {
    if (noise) return noise;
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  };
  const cleanup = (source: AudioScheduledSourceNode, ...nodes: AudioNode[]) => { source.onended = () => { source.disconnect(); for (const n of nodes) n.disconnect(); }; };
  const tone = (type: OscillatorType, freq: number, at: number, dur: number, gain: number, slideTo = 0) => {
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, at);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    const amp = ctx.createGain(); amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + 0.004); amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(amp); amp.connect(out); osc.start(at); osc.stop(at + dur + 0.03); cleanup(osc, amp);
  };
  const burst = (at: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType = 'bandpass') => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
    const amp = ctx.createGain(); amp.gain.setValueAtTime(0.0001, at); amp.gain.linearRampToValueAtTime(gain, at + 0.004); amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter); filter.connect(amp); amp.connect(out); src.start(at, Math.random() * 0.2); src.stop(at + dur + 0.03); cleanup(src, filter, amp);
  };
  const chime = (freq: number, at: number, gain: number, dur = 0.5) => { tone('sine', freq, at, dur, gain); tone('triangle', freq * 2.76, at, dur * 0.4, gain * 0.25); };
  const t0 = () => ctx.currentTime + 0.005;
  return {
    spin: () => { const t = t0(); burst(t, 0.22, 0.08, 500, 2600); tone('triangle', 330, t, 0.16, 0.04, 660); },
    land: column => { const t = t0(), f = midiToHz(scale(53, clamp(Math.round(column), 0, 11))); tone('sine', f * 1.6, t, 0.14, 0.14, f); burst(t, 0.05, 0.03, 900, 300, 'lowpass'); },
    pop: (count, tier) => {
      const t = t0(), n = Math.min(6, 2 + Math.floor(clamp(count, 1, 30) / 4));
      for (let i = 0; i < n; i++) { const at = t + i * 0.02; burst(at, 0.06, 0.07, 2800 + Math.random() * 1800, 900); tone('sine', midiToHz(scale(77, i + tier)), at, 0.08, 0.04); }
    },
    win: multiplier => { const t = t0(), level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8); for (let i = 0; i < 3 + Math.min(3, level >> 1); i++) chime(midiToHz(scale(77, i)), t + i * 0.07, 0.07); },
    crystal: value => { const t = t0(), f = midiToHz(89 + Math.round(clamp(Math.log2(Math.max(2, value)), 1, 7))); tone('sine', f, t, 0.6, 0.1); tone('sine', f * 1.5, t + 0.03, 0.5, 0.05); },
    collect: () => { const t = t0(); burst(t, 0.45, 0.07, 350, 3200); tone('sine', 520, t, 0.42, 0.05, 1560); },
    scatter: n => { const t = t0(); chime(midiToHz(scale(81, clamp(Math.round(n), 1, 10) - 1)), t, 0.1, 0.7); },
    chimeRun: (steps, root) => { const t = t0(); for (let i = 0; i < steps; i++) chime(midiToHz(scale(root, i)), t + i * 0.08, 0.08); },
    click: () => { const t = t0(); tone('sine', 1350, t, 0.04, 0.05); },
  };
}
