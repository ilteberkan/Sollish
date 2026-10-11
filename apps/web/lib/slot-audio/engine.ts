/**
 * Slot audio runtime engine. One lazily created AudioContext (only from a user gesture), a bus graph
 *
 *   scene loops ─► duck ─┐
 *   stingers ────────────┴► music ─┐
 *   one-shots ─────────────► sfx ──┼► master (mix × mute) ─► trim ─► glue comp ─► limiter ─► out
 *   beds ──────────────────► ambience ┘
 *
 * smooth mix ramps, ducking, equal-power scene cross-fades with sample-accurate loops, beat/bar
 * quantised stingers, pause on hidden tabs and complete no-op safety without Web Audio (SSR, tests).
 * Presentation only: nothing here can read or change a game result.
 */
import {
  DEFAULT_MIX, MIX_RAMP_SECONDS, busGains, duckPlan, equalPowerCurve, loopPosition, nextBoundary, normalizeMix,
  type BusId, type LoopClock, type MixSettings, type Quantize, type SceneId,
} from './timing';

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

export function audioContextConstructor(): AudioContextCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const scope = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** A looping scene: the buffer length is a whole number of bars. */
export interface LoopAsset { buffer: AudioBuffer; bpm: number; beatsPerBar: number }

export interface PlayOptions {
  when?: number;
  rate?: number;
  gain?: number;
  pan?: number;
  loop?: boolean;
  offset?: number;
  fadeIn?: number;
}

export interface VoiceHandle {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startTime: number;
  /** Fade out and stop. */
  stop: (fade?: number, at?: number) => void;
}

/** Master chain tuning. The trim compensates the compressors' automatic make-up gain (measured, see audio.json). */
export const MASTER_CHAIN = {
  trimDb: -4.8,
  glue: { threshold: -12, knee: 8, ratio: 1.6, attack: 0.02, release: 0.3 },
  limiter: { threshold: -4.5, knee: 0, ratio: 20, attack: 0.001, release: 0.12 },
} as const;

export interface BusGraph {
  master: GainNode; trim: GainNode; glue: DynamicsCompressorNode; limiter: DynamicsCompressorNode;
  music: GainNode; duck: GainNode; sfx: GainNode; ambience: GainNode;
}

const setValue = (param: AudioParam | undefined, value: number) => { if (param) try { param.value = value; } catch { /* fake or locked param */ } };

/** Build the bus graph on any BaseAudioContext (the live context, or an OfflineAudioContext for measurement). */
export function buildBusGraph(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): BusGraph {
  const gain = (value: number) => { const g = ctx.createGain(); setValue(g.gain, value); return g; };
  const master = gain(1), trim = gain(10 ** (MASTER_CHAIN.trimDb / 20));
  const glue = ctx.createDynamicsCompressor(), limiter = ctx.createDynamicsCompressor();
  for (const [node, spec] of [[glue, MASTER_CHAIN.glue], [limiter, MASTER_CHAIN.limiter]] as const) {
    setValue(node.threshold, spec.threshold); setValue(node.knee, spec.knee); setValue(node.ratio, spec.ratio);
    setValue(node.attack, spec.attack); setValue(node.release, spec.release);
  }
  const music = gain(1), duck = gain(1), sfx = gain(1), ambience = gain(1);
  duck.connect(music);
  music.connect(master); sfx.connect(master); ambience.connect(master);
  master.connect(trim); trim.connect(glue); glue.connect(limiter); limiter.connect(destination);
  return { master, trim, glue, limiter, music, duck, sfx, ambience };
}

/** Linear ramp from the current value, tolerant of partial AudioParam implementations. */
function rampTo(param: AudioParam, value: number, now: number, seconds: number) {
  try {
    const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
    else if (typeof p.cancelScheduledValues === 'function') { p.cancelScheduledValues(now); p.setValueAtTime?.(p.value, now); }
    if (typeof p.linearRampToValueAtTime === 'function') p.linearRampToValueAtTime(value, now + Math.max(0.001, seconds));
    else if (typeof p.setTargetAtTime === 'function') p.setTargetAtTime(value, now, Math.max(0.001, seconds) / 3);
    else p.value = value;
  } catch { setValue(param, value); }
}

function curveAt(param: AudioParam, curve: Float32Array, at: number, seconds: number) {
  try {
    param.cancelScheduledValues?.(at);
    param.setValueCurveAtTime(curve, at, Math.max(0.01, seconds));
  } catch {
    try { param.setValueAtTime(curve[0]!, at); param.linearRampToValueAtTime(curve[curve.length - 1]!, at + seconds); } catch { setValue(param, curve[curve.length - 1]!); }
  }
}

interface PlayingScene { id: SceneId; asset: LoopAsset; handle: VoiceHandle; clock: LoopClock }

export class SlotAudioEngine {
  private ctx: AudioContext | null = null;
  private graph: BusGraph | null = null;
  private mix: MixSettings = { ...DEFAULT_MIX };
  private disposed = false;
  private scenes = new Map<SceneId, LoopAsset>();
  private current: PlayingScene | null = null;
  private wanted: SceneId = 'none';
  private ambienceBuffer: AudioBuffer | null = null;
  private ambienceVoice: VoiceHandle | null = null;
  private voices = new Set<VoiceHandle>();
  private duckUntil = 0;
  private duckFloor = 1;
  private duckHeld = false;
  private hiddenSuspended = false;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private visibility: (() => void) | null = null;
  /** Global one-shot voice cap; the oldest voice is faded out when exceeded. */
  maxVoices = 40;

  static supported(): boolean { return audioContextConstructor() !== null; }

  get context(): AudioContext | null { return this.ctx; }
  get mixSettings(): MixSettings { return { ...this.mix }; }
  get scene(): SceneId { return this.current?.id ?? 'none'; }
  get desiredScene(): SceneId { return this.wanted; }
  get isDisposed(): boolean { return this.disposed; }

  /** Create (once) the context. Call from a user gesture. Returns null where Web Audio is missing. */
  ensure(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    const Ctor = audioContextConstructor();
    if (!Ctor) return null;
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.graph = buildBusGraph(ctx);
      this.ctx = ctx;
      this.applyMix(0);
      this.listenVisibility();
      if (this.ambienceBuffer) this.startAmbience(this.ambienceBuffer);
      if (this.wanted !== 'none') this.setScene(this.wanted, { quantize: 'none', fade: 0.4 });
    } catch { this.ctx = null; this.graph = null; }
    return this.ctx;
  }

  /** Resume after a gesture (browsers start contexts suspended). */
  async resume(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx || this.disposed) return;
    if (ctx.state === 'suspended' && !this.isHidden()) { try { await ctx.resume(); } catch { /* still blocked */ } }
  }

  /** The context when sound may be produced right now. */
  live(): AudioContext | null {
    const ctx = this.ctx;
    return ctx && this.graph && !this.disposed && ctx.state === 'running' && !this.mix.muted ? ctx : null;
  }

  now(): number { return this.ctx?.currentTime ?? 0; }

  /** Input node of a bus, for voices synthesised live (the fallback voice). */
  busInput(bus: BusId): AudioNode | null {
    const g = this.graph;
    return g ? (bus === 'music' ? g.music : bus === 'sfx' ? g.sfx : g.ambience) : null;
  }

  /* ---------------- mix ---------------- */

  setMix(partial: Partial<MixSettings>): void {
    const wasMuted = this.mix.muted;
    this.mix = normalizeMix(partial, this.mix);
    this.applyMix(MIX_RAMP_SECONDS);
    if (!this.ctx) return;
    if (this.mix.muted && !wasMuted) {
      // save battery: suspend shortly after the mute ramp finishes
      if (this.muteTimer) clearTimeout(this.muteTimer);
      this.muteTimer = setTimeout(() => { this.muteTimer = null; if (this.mix.muted && this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {}); }, 250);
    } else if (!this.mix.muted && wasMuted) {
      if (this.muteTimer) { clearTimeout(this.muteTimer); this.muteTimer = null; }
      if (this.ctx.state === 'suspended' && !this.isHidden()) void this.ctx.resume().catch(() => {});
    }
  }

  private applyMix(seconds: number) {
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g) return;
    const gains = busGains(this.mix), t = ctx.currentTime;
    rampTo(g.master.gain, gains.master, t, seconds);
    rampTo(g.music.gain, gains.music, t, seconds);
    rampTo(g.sfx.gain, gains.sfx, t, seconds);
    rampTo(g.ambience.gain, gains.ambience, t, seconds);
  }

  /* ---------------- ducking ---------------- */

  /** Lower the scene music by `amountDb` for `ms` (plus attack/release). Overlapping ducks merge (deepest, longest). */
  duck(amountDb: number, ms: number, attackMs = 40, releaseMs = 450): void {
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g) return;
    const now = ctx.currentTime, plan = duckPlan(now, amountDb, ms, attackMs, releaseMs);
    const floor = now < this.duckUntil || this.duckHeld ? Math.min(this.duckFloor, plan.floor) : plan.floor;
    const holdUntil = Math.max(plan.holdUntil, this.duckUntil);
    this.duckFloor = floor; this.duckUntil = holdUntil;
    const p = g.duck.gain;
    rampTo(p, floor, now, plan.attack);
    if (!this.duckHeld) {
      try { p.setValueAtTime(floor, holdUntil); p.linearRampToValueAtTime(1, holdUntil + (plan.releaseEnd - plan.holdUntil)); } catch { /* partial param */ }
    }
  }

  /** Hold a duck until `duckRelease` (e.g. while a count-up bed plays over the scene). */
  duckHold(amountDb: number, attackMs = 60): void {
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g) return;
    this.duckHeld = true;
    this.duckFloor = Math.min(this.duckFloor, 10 ** (-Math.abs(amountDb) / 20));
    rampTo(g.duck.gain, this.duckFloor, ctx.currentTime, attackMs / 1000);
  }

  duckRelease(releaseMs = 600): void {
    const ctx = this.ctx, g = this.graph;
    this.duckHeld = false;
    if (!ctx || !g) return;
    const now = ctx.currentTime, start = Math.max(now, this.duckUntil);
    try {
      rampTo(g.duck.gain, this.duckFloor, now, 0.01);
      g.duck.gain.setValueAtTime(this.duckFloor, start);
      g.duck.gain.linearRampToValueAtTime(1, start + releaseMs / 1000);
    } catch { setValue(g.duck.gain, 1); }
    this.duckFloor = 1;
  }

  /* ---------------- scenes ---------------- */

  registerScene(id: SceneId, asset: LoopAsset): void {
    this.scenes.set(id, asset);
    if (this.wanted === id && this.current?.id !== id && this.ctx) this.setScene(id, { quantize: 'bar' });
  }

  hasScene(id: SceneId): boolean { return id === 'none' || this.scenes.has(id); }

  sceneClock(): LoopClock | null { return this.current?.clock ?? null; }

  /** Next beat/bar of the playing scene (or "as soon as possible" with no scene), capped at `maxWait` seconds. */
  quantizedTime(unit: Quantize, maxWait = Infinity): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const now = ctx.currentTime, clock = this.current?.clock;
    if (!clock || unit === 'none') return now + 0.02;
    const t = nextBoundary(clock, now, unit);
    if (t - now <= maxWait) return t;
    return unit === 'bar' ? this.quantizedTime('beat', maxWait) : now + 0.02;
  }

  /**
   * Switch scene with an equal-power cross-fade. By default the change waits for the next bar of the
   * playing loop (at most one bar). Scenes with the same tempo keep their phase (idle ↔ base).
   */
  setScene(id: SceneId, opts: { at?: number; fade?: number; quantize?: Quantize } = {}): number | null {
    this.wanted = id;
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g || this.disposed) return null;
    if (this.current?.id === id) return null;
    const asset = id === 'none' ? null : this.scenes.get(id) ?? null;
    if (id !== 'none' && !asset) return null; // starts when registered
    const fade = Math.max(0.02, opts.fade ?? 1.2);
    const old = this.current;
    const at = Math.max(ctx.currentTime + 0.02, opts.at ?? (old ? this.quantizedTime(opts.quantize ?? 'bar', 60 / old.clock.bpm * old.clock.beatsPerBar + 0.01) : ctx.currentTime + 0.02));
    if (old) {
      const from = old.handle.gain.gain.value || 1;
      curveAt(old.handle.gain.gain, equalPowerCurve(64, false, from), at, fade);
      old.handle.stop(0, at + fade + 0.05);
      this.current = null;
    }
    if (!asset) return at;
    const seconds = asset.buffer.duration;
    let offset = 0;
    if (old && old.asset.bpm === asset.bpm && old.asset.beatsPerBar === asset.beatsPerBar) offset = loopPosition(old.clock, at) % seconds;
    const handle = this.playBuffer('music-scene', asset.buffer, { when: at, loop: true, offset, gain: 0 });
    if (!handle) return null;
    curveAt(handle.gain.gain, equalPowerCurve(64, true, 1), at, fade);
    this.current = { id, asset, handle, clock: { startTime: at, offset, loopSeconds: seconds, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar } };
    return at;
  }

  /* ---------------- playback ---------------- */

  /** Play a buffer on a bus. 'music-scene' routes through the duck node; 'music' (stingers) does not. */
  playBuffer(bus: BusId | 'music-scene', buffer: AudioBuffer, opts: PlayOptions = {}): VoiceHandle | null {
    const ctx = this.ctx, g = this.graph;
    if (!ctx || !g || this.disposed) return null;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (opts.rate && opts.rate !== 1) setValue(source.playbackRate, opts.rate);
      if (opts.loop) { source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration; }
      const gain = ctx.createGain();
      const when = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
      const level = opts.gain ?? 1;
      if (opts.fadeIn && opts.fadeIn > 0) { setValue(gain.gain, 0); try { gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(level, when + opts.fadeIn); } catch { setValue(gain.gain, level); } }
      else setValue(gain.gain, level);
      let tail: AudioNode = gain;
      source.connect(gain);
      if (opts.pan && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner(); setValue(panner.pan, Math.max(-1, Math.min(1, opts.pan)));
        gain.connect(panner); tail = panner;
      }
      const dest = bus === 'music-scene' ? g.duck : bus === 'music' ? g.music : bus === 'sfx' ? g.sfx : g.ambience;
      tail.connect(dest);
      let stopped = false;
      const handle: VoiceHandle = {
        source, gain, startTime: when,
        stop: (fade = 0.06, at?: number) => {
          if (stopped) return; stopped = true;
          const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
          try {
            if (fade > 0) { gain.gain.cancelScheduledValues?.(t); gain.gain.setValueAtTime?.(gain.gain.value, t); gain.gain.linearRampToValueAtTime?.(0, t + fade); }
            source.stop(t + fade + 0.01);
          } catch { /* already stopped */ }
        },
      };
      source.onended = () => { this.voices.delete(handle); try { source.disconnect(); gain.disconnect(); if (tail !== gain) tail.disconnect(); } catch { /* gone */ } };
      source.start(when, Math.max(0, opts.offset ?? 0));
      if (bus === 'sfx') {
        this.voices.add(handle);
        if (this.voices.size > this.maxVoices) { const oldest = this.voices.values().next().value; if (oldest) { this.voices.delete(oldest); oldest.stop(0.03); } }
      }
      return handle;
    } catch { return null; }
  }

  startAmbience(buffer: AudioBuffer): void {
    this.ambienceBuffer = buffer;
    if (!this.ctx || this.ambienceVoice) return;
    this.ambienceVoice = this.playBuffer('ambience', buffer, { loop: true, fadeIn: 2 });
  }

  stopAmbience(fade = 1): void {
    this.ambienceBuffer = null;
    this.ambienceVoice?.stop(fade); this.ambienceVoice = null;
  }

  stopAllSfx(fade = 0.05): void { for (const v of this.voices) v.stop(fade); this.voices.clear(); }

  /* ---------------- lifecycle ---------------- */

  private isHidden(): boolean { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }

  private listenVisibility() {
    if (typeof document === 'undefined' || this.visibility) return;
    this.visibility = () => {
      const ctx = this.ctx; if (!ctx) return;
      if (document.visibilityState === 'hidden') {
        if (ctx.state === 'running') { this.hiddenSuspended = true; void ctx.suspend().catch(() => {}); }
      } else if (this.hiddenSuspended) {
        this.hiddenSuspended = false;
        if (!this.mix.muted) void ctx.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this.visibility);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.visibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    this.visibility = null;
    if (this.muteTimer) clearTimeout(this.muteTimer);
    for (const v of this.voices) v.stop(0);
    this.voices.clear(); this.scenes.clear();
    this.current = null; this.ambienceVoice = null; this.ambienceBuffer = null;
    const ctx = this.ctx; this.ctx = null; this.graph = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}
