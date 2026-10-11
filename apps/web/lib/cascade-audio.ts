/**
 * Presentation-only Candy Cascade sound, fully synthesized with Web Audio (no sample files).
 * It is driven by already-resolved round steps and never feeds back into the result.
 */
export type CascadeAudio = {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  spinStart: () => void;
  land: (column: number) => void;
  pop: (count: number, tier: number) => void;
  win: (multiplier: number) => void;
  crystal: (value: number) => void;
  collect: () => void;
  scatter: (n: number) => void;
  freeSpinsIntro: () => void;
  bigWin: (tier: 1 | 2 | 3) => void;
  dispose: () => void;
};

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;
const MASTER_LEVEL = .8;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
// C major pentatonic: any pitch stays consonant when sounds overlap.
const PENTATONIC = [0, 2, 4, 7, 9];
const scaleNote = (root: number, degree: number) => root + 12 * Math.floor(degree / 5) + PENTATONIC[((degree % 5) + 5) % 5]!;

function contextConstructor(): AudioContextCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

const NOOP_AUDIO: CascadeAudio = {
  resume: async () => {}, setEnabled: () => {}, spinStart: () => {}, land: () => {}, pop: () => {}, win: () => {}, crystal: () => {},
  collect: () => {}, scatter: () => {}, freeSpinsIntro: () => {}, bigWin: () => {}, dispose: () => {},
};

export function createCascadeAudio(): CascadeAudio {
  if (!contextConstructor()) return { ...NOOP_AUDIO };
  let context: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null;
  let enabled = false, disposed = false;
  const ensure = (): AudioContext | null => {
    if (disposed) return null;
    if (context) return context;
    const Ctor = contextConstructor();
    if (!Ctor) return null;
    try {
      context = new Ctor({ latencyHint: 'interactive' });
      master = context.createGain(); master.gain.value = enabled ? MASTER_LEVEL : 0;
      const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 5; compressor.attack.value = .004; compressor.release.value = .2;
      master.connect(compressor); compressor.connect(context.destination);
      const length = Math.floor(context.sampleRate * .5); noise = context.createBuffer(1, length, context.sampleRate);
      const data = noise.getChannelData(0); for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch { context = null; master = null; noise = null; return null; }
    return context;
  };
  /** Returns the context only when sound may be produced right now. */
  const live = (): AudioContext | null => {
    if (!enabled || disposed) return null;
    const ctx = ensure();
    return ctx && master && ctx.state === 'running' ? ctx : null;
  };
  const release = (source: AudioScheduledSourceNode, ...nodes: AudioNode[]) => { source.onended = () => { source.disconnect(); for (const node of nodes) node.disconnect(); }; };
  /** Pitched partial with an exponential decay. */
  const tone = (ctx: AudioContext, type: OscillatorType, freq: number, at: number, duration: number, gain: number, { slideTo = 0, pan = 0, attack = .004 } = {}) => {
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, at);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    const amp = ctx.createGain(); amp.gain.setValueAtTime(.0001, at);
    amp.gain.linearRampToValueAtTime(gain, at + attack); amp.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    osc.connect(amp); amp.connect(panner); panner.connect(master!);
    osc.start(at); osc.stop(at + duration + .03); release(osc, amp, panner);
  };
  /** Band-passed noise burst, the crunch of a candy shell. */
  const burst = (ctx: AudioContext, at: number, duration: number, gain: number, freqFrom: number, freqTo: number, { q = 1.2, type = 'bandpass' as BiquadFilterType, pan = 0 } = {}) => {
    const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(freqFrom, at); filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqTo), at + duration);
    const amp = ctx.createGain(); amp.gain.setValueAtTime(.0001, at); amp.gain.linearRampToValueAtTime(gain, at + .004); amp.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const panner = ctx.createStereoPanner(); panner.pan.value = clamp(pan, -1, 1);
    source.connect(filter); filter.connect(amp); amp.connect(panner); panner.connect(master!);
    source.start(at, Math.random() * .2); source.stop(at + duration + .03); release(source, filter, amp, panner);
  };
  /** Bright chime: sine fundamental plus an inharmonic triangle partial. */
  const chime = (ctx: AudioContext, freq: number, at: number, gain: number, duration = .55, pan = 0) => {
    tone(ctx, 'sine', freq, at, duration, gain, { pan });
    tone(ctx, 'triangle', freq * 2.76, at, duration * .45, gain * .28, { pan });
  };

  return {
    resume: async () => {
      const ctx = ensure();
      if (ctx && ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* blocked until a gesture */ } }
    },
    setEnabled: on => {
      enabled = on;
      if (!on && !context) return;
      const ctx = ensure();
      if (ctx && master) master.gain.setTargetAtTime(on ? MASTER_LEVEL : 0, ctx.currentTime, .06);
    },
    spinStart: () => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005;
      burst(ctx, t, .22, .09, 500, 2600, { q: .9 });
      tone(ctx, 'triangle', 330, t, .16, .05, { slideTo: 660 });
    },
    land: column => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005; const col = clamp(Math.round(column), 0, 11);
      const freq = midi(scaleNote(48, col)); // each column a step higher, soft and bouncy
      tone(ctx, 'sine', freq * 1.6, t, .14, .16, { slideTo: freq, pan: (col - 2.5) / 5 });
      burst(ctx, t, .05, .035, 900, 300, { q: .8, type: 'lowpass', pan: (col - 2.5) / 5 });
    },
    pop: (count, tier) => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005;
      const size = clamp(count, 1, 30), level = clamp(tier, 0, 8);
      const crunches = Math.min(7, 2 + Math.floor(size / 3));
      for (let i = 0; i < crunches; i++) {
        const at = t + i * (.018 + Math.random() * .014), pan = Math.random() * 1.2 - .6;
        burst(ctx, at, .07, .09 + .02 * level / 8, 2800 + Math.random() * 2200, 900, { q: 1.6, pan });
        tone(ctx, 'sine', midi(scaleNote(76, i + Math.floor(level))) * (1 + Math.random() * .01), at, .09, .05 + .02 * Math.min(1, size / 20), { pan });
      }
      tone(ctx, 'triangle', 180 + 18 * level, t, .12, .08 + .04 * Math.min(1, size / 20), { slideTo: 90 });
    },
    win: multiplier => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .01;
      const level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8); // 1x quiet and short, 256x full
      const notes = 3 + Math.min(4, Math.floor(level / 2));
      for (let i = 0; i < notes; i++) chime(ctx, midi(scaleNote(72, i)), t + i * .075, .09 + .012 * level, .35 + .06 * level, (i - notes / 2) * .12);
    },
    crystal: value => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005;
      const level = clamp(Math.log2(Math.max(2, value)), 1, 7);
      const freq = midi(84 + Math.round(level * 1.5));
      tone(ctx, 'sine', freq, t, .7, .13);
      tone(ctx, 'sine', freq * 1.5, t + .035, .6, .07);
      tone(ctx, 'triangle', freq * 3.01, t, .25, .035);
      burst(ctx, t, .03, .03, 7000, 5000, { q: 2.5, type: 'highpass' });
    },
    collect: () => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005;
      burst(ctx, t, .5, .1, 350, 3200, { q: 1.1 });
      tone(ctx, 'sine', 520, t, .45, .07, { slideTo: 1560 });
      chime(ctx, midi(88), t + .42, .1, .5);
    },
    scatter: n => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .005;
      const freq = midi(scaleNote(79, clamp(Math.round(n), 1, 10) - 1));
      chime(ctx, freq, t, .13, .8);
      tone(ctx, 'sine', freq * 2, t + .06, .5, .06);
      burst(ctx, t, .08, .025, 8000, 6000, { q: 3, type: 'highpass' });
    },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .02;
      const run = 6; // quick rising pentatonic run, then a held chord
      for (let i = 0; i < run; i++) chime(ctx, midi(scaleNote(67, i)), t + i * .09, .11, .5, (i - 2.5) * .14);
      const hold = t + run * .09;
      for (const note of [72, 76, 79, 84]) { tone(ctx, 'triangle', midi(note), hold, 1.1, .08); tone(ctx, 'sine', midi(note + 12), hold, .9, .035); }
      burst(ctx, hold, .5, .04, 3000, 9000, { q: 1.2, type: 'highpass' });
    },
    bigWin: tier => {
      const ctx = live(); if (!ctx) return; const t = ctx.currentTime + .02;
      const level = clamp(Math.round(tier), 1, 3);
      const steps = 4 + level * 2;
      for (let i = 0; i < steps; i++) chime(ctx, midi(scaleNote(64 + 2 * level, i)), t + i * .07, .1 + .02 * level, .5, Math.sin(i) * .4);
      const hold = t + steps * .07;
      for (const note of [60, 64, 67, 72, 76].slice(0, 2 + level)) { tone(ctx, 'triangle', midi(note + 2 * level), hold, .9 + .35 * level, .08); tone(ctx, 'sine', midi(note + 2 * level + 12), hold, .9 + .35 * level, .04); }
      tone(ctx, 'sine', 110, t, .5 + .15 * level, .12 + .02 * level, { slideTo: 55 });
      burst(ctx, hold, .4 + .2 * level, .05, 2500, 10000, { q: 1.1, type: 'highpass' });
    },
    dispose: () => {
      if (disposed) return; disposed = true; enabled = false;
      const ctx = context; context = null; master = null; noise = null;
      if (ctx) void ctx.close().catch(() => {});
    },
  };
}
