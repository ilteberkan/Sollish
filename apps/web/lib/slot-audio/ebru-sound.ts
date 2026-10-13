/**
 * Ebru: Mürekkep Bahçesi sound for the game. Same public shape as storm-sound.ts (resume / load / setMix / setScene /
 * duck / bigWin / maxWin / countUp / multiplierCallout / click / betChange / denied / autoplay / setVoiceBank …) plus
 * the Ebru events, one per engine step (packages/protocol/src/ebru.ts):
 *   drop-in  → dropIn(col) per landing column (or symbolLand per cell)    bleed    → bleed(colour, spread)
 *   clusters → clusterDissolve(colour, size) per cluster (+ multiplierCallout(multiplier) when stained ≥ ×10)
 *   burst    → (covered by clusterDissolve)                                stains   → stainGrow(highest new value)
 *   fall     → fall()                                                      comb     → combSweep(shifts, ms, { pass, createsWin })
 *   final grid combs → scatterLand(n) (tease from the 2nd), featureTrigger(), freeSpinsIntro(), setScene('feature') …
 *
 * All music and effects are original and rendered offline once (render.ts, the shared worker pool); playback is plain
 * buffer playback on the shared engine's buses. The comb sweep is assembled live from rendered layers whose pitch,
 * pan and level follow the pass's row shifts (ebru-tiers.ts combPlan). Presentation only: driven by already-resolved
 * round steps, it never feeds back into a result, payout or timing of the game.
 */
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render';
import { RenderService, type WorkerFactory } from './render-service';
import { EBRU_SCORES, type EbruScoreId } from './scores/ebru';
import { EBRU_SFX } from './sfx/ebru';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import { CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DUCK_DB, VOICE_DELAY, planTierUp, tierAction, toWinTier, type MultiplierClass, type WinTier } from './win-tiers';
import {
  EBRU_CLASS_VOICE, EBRU_PLACEHOLDER, EBRU_TIER_VOICE, EBRU_VOICE_LINES, bloomSize, colourSemitones, combPlan, dropSemitones, ebruCalloutClass, ebruCalloutRank, ebruVoiceBankUrls,
  ebruVoiceDecision, loadEbruVoiceBank, stainLevel, stainSemitones, type CombPlan, type EbruVoiceLine,
} from './ebru-tiers';
import type { LoadProgress } from './cascade-sound';

export type { LoadProgress } from './cascade-sound';
export { loadMixSettings, saveMixSettings } from './cascade-sound';
export type { EbruVoiceLine, CombPlan } from './ebru-tiers';
export type { WinTier } from './win-tiers';

export interface CombSweepOptions {
  /** Comb pass of the spin, 1..3 (later passes sit one and two ladder steps higher). */
  pass?: number;
  /** The pass leaves a cluster: end on the golden resolve instead of the settling drips. */
  createsWin?: boolean;
  /** Start time on the audio clock (default: now). */
  when?: number;
}

export interface EbruSound {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  /** Render the bank. Resolves when the core (base theme + base-game effects incl. the comb) is ready; the rest follows in the background. */
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  /** Resolves when everything (feature theme, stingers, celebration effects) is rendered. */
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;

  spinStart: () => void;
  /** An ink drop lands in column 0..6: a water "plip" stepped up the G pentatonic left → right. */
  dropIn: (column: number) => void;
  /** Alias of dropIn (Tarhun / Candy Cascade name). */
  land: (column: number) => void;
  /** One cell settles (very light tick). */
  symbolLand: () => void;
  /** The wild `drop` bleeds: a spreading ink bloom chord (colour c1..c8 tilts the pitch, spread = recoloured cells). */
  bleed: (colour?: string, spread?: number) => void;
  /** One cluster dissolves: a pigment bloom pitched by its colour (c1 highest), sized by its cell count. */
  clusterDissolve: (colour: string, size: number) => void;
  /** Tarhun-style alias: count = cells, tier 0..2 (colour unknown). */
  shatter: (count: number, tier: number) => void;
  pop: (count: number, tier: number) => void;
  /** Win highlight (cluster value as a multiple of the bet). */
  winHighlight: (multiplier: number) => void;
  win: (multiplier: number) => void;
  /** Survivors fall and fresh cells drop in. */
  fall: () => void;
  tumble: () => void;
  /**
   * The signature comb pass: a gliding glass tone whose pitch contour follows the seven row shifts (−3..3, row 0 on
   * top) over `ms`, one kanun pluck per row, the wet bristle texture and a golden resolve when the pass creates a win.
   * Returns the sweep length in seconds (0 when silent).
   */
  combSweep: (shifts: readonly number[], ms: number, opts?: CombSweepOptions) => number;
  /** A stain grows to `value` (2..256): a glassy ping that rises one pentatonic step per doubling. */
  stainGrow: (value: number) => void;
  /** n-th golden comb (scatter) of the spin (1..6), ascending; the tease starts at 2 (3 trigger). */
  scatterLand: (n: number) => void;
  scatter: (n: number) => void;
  scatterTease: (on: boolean) => void;
  /** Free spins triggered: the golden chime cascade. */
  featureTrigger: () => void;
  /** Free-spins intro (~3 s); a following setScene('feature') enters on its musical end. */
  freeSpinsIntro: () => void;
  /** +4 spins during the feature: a kanun flourish over the feature theme. */
  retrigger: () => void;
  /** End of the feature: the garden settles (~4 s); a following setScene() enters on its musical end. */
  featureOutro: () => void;
  /** End-of-feature total-win fanfare (4 s); a following setScene() enters on its musical end. */
  totalWinFanfare: () => void;
  /** Tier 1 Büyük ≥10×, 2 Mega ≥25×, 3 Süper ≥50×, 4 Efsane ≥100×; climbs while a celebration runs. */
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  maxWin: () => void;
  countUp: (start: boolean) => void;
  /** Multiplier / stain callout by class (<10, ≥10, ≥25, ≥50, ≥100, ≥250) with its voice line. */
  multiplierCallout: (value: number) => void;
  /** "Güzel!" for a medium win; at most once every 20 s. */
  nice: () => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
  /** Recorded voice lines: a folder (`/audio/voice/ebru` → `/audio/voice/ebru/x100.mp3` …) or a URL per line. Missing files are skipped silently. */
  setVoiceBank: (urls: string | Partial<Record<EbruVoiceLine, string | null>>) => Promise<{ loaded: EbruVoiceLine[]; missing: EbruVoiceLine[] }>;
  readonly voiceLines: Map<EbruVoiceLine, AudioBuffer | null>;
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  playStinger: (id: EbruScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => {
    core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null;
    celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null };
    voice: { speaking: EbruVoiceLine | null; loaded: number };
  };
  dispose: () => void;
}

/* ---------------- the comb sweep graph (shared with the measurement harness) ---------------- */

export interface CombClips { glide: AudioBuffer | null; plucks: AudioBuffer[]; bristle: AudioBuffer | null; end: AudioBuffer | null }
export interface CombVoices { at: number; end: number; sources: AudioBufferSourceNode[]; stop: (fade?: number) => void }

function curveOn(param: AudioParam | undefined, curve: Float32Array, at: number, seconds: number, fallback: number) {
  if (!param) return;
  try { param.setValueCurveAtTime(curve, at, Math.max(0.01, seconds)); } catch { try { param.value = fallback; } catch { /* fake param */ } }
}
/** A level curve with a quick fade-in and a fade-out over the last `out` seconds, scaled by `level`. */
function envelope(plan: CombPlan, gain: number, fadeIn: number, fadeOut: number, follow: boolean): Float32Array {
  const n = plan.level.length, c = new Float32Array(n), s = plan.seconds;
  for (let i = 0; i < n; i++) { const t = (i / (n - 1)) * s; c[i] = gain * Math.max(0, Math.min(1, t / fadeIn, (s - t) / fadeOut)) * (follow ? plan.level[i]! : 1); }
  return c;
}

/**
 * Schedule one comb sweep on any BaseAudioContext (live or offline) into `dest`: the glide (rate and pan curves from
 * the plan, plus an octave-lower shadow), one pluck per row at its own pitch and position, the bristle texture shaped
 * by the plan's level, and the ending clip just before the sweep ends. Missing clips are skipped.
 */
export function scheduleCombSweep(ctx: BaseAudioContext, dest: AudioNode, clips: CombClips, plan: CombPlan, when: number, gain = 1): CombVoices {
  const sources: AudioBufferSourceNode[] = [], gains: GainNode[] = [];
  const s = plan.seconds;
  const voice = (buffer: AudioBuffer, at: number, level: number | Float32Array, pan: number | Float32Array, rate: number | Float32Array, stopAt: number) => {
    try {
      const src = ctx.createBufferSource(); src.buffer = buffer;
      const g = ctx.createGain();
      if (typeof rate === 'number') { try { src.playbackRate.value = rate; } catch { /* fake */ } } else curveOn(src.playbackRate, rate, at, s, rate[rate.length - 1]!);
      if (typeof level === 'number') { try { g.gain.value = level; } catch { /* fake */ } } else { try { g.gain.value = 0; } catch { /* fake */ } curveOn(g.gain, level, at, s, 0); }
      src.connect(g);
      let tail: AudioNode = g;
      if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        if (typeof pan === 'number') { try { p.pan.value = pan; } catch { /* fake */ } } else curveOn(p.pan, pan, at, s, 0);
        g.connect(p); tail = p;
      }
      tail.connect(dest);
      src.onended = () => { try { src.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch { /* gone */ } };
      src.start(at);
      src.stop(stopAt);
      sources.push(src); gains.push(g);
    } catch { /* partial context */ }
  };
  if (clips.glide) {
    const env = envelope(plan, 0.62 * gain, 0.06, Math.min(0.35, s * 0.3), false);
    voice(clips.glide, when, env, plan.pan.map(p => p * 0.8), plan.rate, when + s + 0.05);
    voice(clips.glide, when, env.map(v => v * 0.38), plan.pan.map(p => -p * 0.5), plan.rate.map(r => r * 0.5), when + s + 0.05);
  }
  if (clips.plucks.length) plan.rows.forEach((row, i) => voice(clips.plucks[i % clips.plucks.length]!, when + row.at, (0.42 + 0.06 * Math.abs(row.shift)) * gain, row.pan, row.rate, when + row.at + 0.9));
  if (clips.bristle) voice(clips.bristle, when, envelope(plan, 0.8 * gain, 0.08, Math.min(0.4, s * 0.35), true), plan.pan.map(p => p * 0.6), 1 + 0.03 * plan.amplitude, when + s + 0.05);
  const endAt = when + Math.max(0, s - 0.06);
  if (clips.end) voice(clips.end, endAt, 0.8 * gain, 0, 1, endAt + clips.end.duration + 0.05);
  return {
    at: when, end: when + s, sources,
    stop: (fade = 0.08) => {
      const t = ctx.currentTime;
      for (const g of gains) { try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); } catch { /* fake */ } }
      for (const src of sources) { try { src.stop(t + fade + 0.01); } catch { /* stopped */ } }
    },
  };
}

type Stinger = 'fsIntro' | 'retrigger' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: EbruScoreId[] = ['base'];
const EXTENDED_SCORES: EbruScoreId[] = ['ambience', 'idle', 'fsIntro', 'feature', 'retrigger', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
const SCENE_OF: Partial<Record<EbruScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };
/** Count-up tick pitch per tier key (melodic material above B sits lower, as in the scores). */
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);

/** Minimum spacing (s) and simultaneous voice cap per effect, so rapid events never stack up. */
const LIMITS: Record<string, [number, number]> = {
  drop: [0.03, 7], tick: [0.025, 6], coin: [0.055, 3], 'bloom-s': [0.04, 5], 'bloom-m': [0.05, 4], 'bloom-l': [0.06, 3], win: [0.07, 3], bleed: [0.08, 3],
  stain: [0.05, 4], fall: [0.05, 3], spin: [0.08, 2], click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1], 'callout-x250': [0.3, 1],
  'vo-sigh': [0.3, 1], 'vo-bloom': [0.3, 1], 'vo-joy': [0.3, 1],
};
const NICE_COOLDOWN = 20;
const FEATURE_END_WINDOW = 8;
const TRIGGER_WINDOW = 6;
const COMB_GAP = 0.25;

function toAudioBuffer(l: Float32Array, r: Float32Array, sampleRate: number, ctx: BaseAudioContext | null): AudioBuffer | null {
  try {
    const Ctor = (globalThis as unknown as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
    const b = Ctor ? new Ctor({ length: l.length, numberOfChannels: 2, sampleRate }) : ctx ? ctx.createBuffer(2, l.length, sampleRate) : null;
    if (!b) return null;
    b.copyToChannel(l as Float32Array<ArrayBuffer>, 0); b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return b;
  } catch { return null; }
}

/** The part of RenderService the sound uses (tests and the measurement harness may inject their own). */
export type EbruRenderService = Pick<RenderService, 'score' | 'sfx' | 'prefetch' | 'dispose' | 'parallelism' | 'workerJobs' | 'failure' | 'trace'>;

export function createEbruSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; service?: () => EbruRenderService } = {}): EbruSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<EbruScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: EbruRenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  let comb: CombVoices | null = null, lastCombAt = -Infinity;
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: EbruScoreId | null = null;
  const voiceLines = new Map<EbruVoiceLine, AudioBuffer | null>();
  let voiceDecoder: BaseAudioContext | null = null;
  let speaking: { line: EbruVoiceLine; from: number; until: number } | null = null, speakingHandle: VoiceHandle | null = null;
  let lastNiceAt = -Infinity, lastFeatureEndAt = -Infinity, lastTriggerAt = -Infinity;
  let counting = false, countTimer: ReturnType<typeof setInterval> | null = null, countNext = 0, countStart = 0;
  const progressListeners = new Set<(p: LoadProgress) => void>();
  engine.setMix({ muted: true }); // silent until setEnabled(true)

  const live = () => (enabled && !disposed ? engine.live() : null);
  const fb = (): FallbackVoice | null => {
    const ctx = live(), out = engine.busInput('sfx');
    if (!ctx || !out) return null;
    return (fallback ??= createFallbackVoice(ctx, out));
  };

  const sfxBuffer = (id: string, index: number): AudioBuffer | null => {
    const list = sfx.get(id); if (!list) return null;
    const item = list[index]; if (!item) return null;
    if (item instanceof Object && 'l' in item) {
      const b = toAudioBuffer(item.l, item.r, item.sampleRate, engine.context);
      if (b) list[index] = b;
      return b;
    }
    return item as AudioBuffer;
  };
  const musicBuffer = (id: EbruScoreId): AudioBuffer | null => {
    const m = music.get(id); if (!m) return null;
    if (!m.buffer) m.buffer = toAudioBuffer(m.asset.l, m.asset.r, m.asset.sampleRate, engine.context);
    return m.buffer;
  };
  const anyVariation = (id: string): AudioBuffer | null => {
    const list = sfx.get(id); if (!list?.length) return null;
    const v = pickVariation(list.length, lastVar.get(id) ?? -1, random); lastVar.set(id, v);
    return sfxBuffer(id, v);
  };

  /** Start a rendered effect with variation and micro-variation. 'silent' = muted / rate-limited; null = not rendered yet. */
  const start = (id: string, opts: { rate?: number; gain?: number; pan?: number; when?: number; offset?: number } = {}): { handle: VoiceHandle | null; duration: number } | 'silent' | null => {
    const ctx = live(); if (!ctx) return 'silent';
    const list = sfx.get(id); if (!list || !list.length) return null;
    const def = EBRU_SFX.find(s => s.id === id);
    const [minGap, cap] = LIMITS[id] ?? [0.02, 4];
    const t = ctx.currentTime;
    if (t - (last.get(id) ?? -1) < minGap) return 'silent';
    last.set(id, t);
    const v = pickVariation(list.length, lastVar.get(id) ?? -1, random); lastVar.set(id, v);
    const buffer = sfxBuffer(id, v); if (!buffer) return null;
    const jitter = def?.jitter ?? [20, 1];
    const mv = microVariation(random, jitter[0], jitter[1]);
    const voices = (active.get(id) ?? []).filter(h => h.startTime + buffer.duration > t);
    while (voices.length >= cap) voices.shift()?.stop(0.03);
    const rate = (opts.rate ?? 1) * mv.rate;
    const handle = engine.playBuffer('sfx', buffer, { rate, gain: (opts.gain ?? 1) * mv.gain, pan: opts.pan, when: opts.when, offset: opts.offset });
    if (handle) voices.push(handle);
    active.set(id, voices);
    return { handle, duration: buffer.duration / rate };
  };
  const play = (id: string, opts: { rate?: number; gain?: number; pan?: number; when?: number; offset?: number } = {}): boolean => start(id, opts) !== null;

  /** Stinger on the music bus (the scene is ducked under it), quantised to the playing scene or at an exact time. */
  const stinger = (id: Stinger, when: Quantize | number, duckDb: number, releaseMs = 700): { at: number; end: number; length: number; handle: VoiceHandle | null } | null => {
    const ctx = live(); if (!ctx) return null;
    const buffer = musicBuffer(id), asset = music.get(id)?.asset;
    if (!buffer || !asset) return null;
    const at = typeof when === 'number' ? Math.max(ctx.currentTime, when) : engine.quantizedTime(when, when === 'bar' ? 1.2 : 0.62);
    const handle = engine.playBuffer('music', buffer, { when: at });
    engine.duck(duckDb, (at - ctx.currentTime + asset.musicalEnd) * 1000, 60, releaseMs);
    return { at, end: at + asset.musicalEnd, length: buffer.duration, handle };
  };

  /* ---------------- voice: recorded lines, or the wordless placeholder ---------------- */

  const speak = (line: EbruVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime + VOICE_DELAY);
    const buffer = voiceLines.get(line) ?? null, placeholder = EBRU_PLACEHOLDER[line];
    if (!buffer && !placeholder) return null;
    if (!buffer && placeholder && !sfx.has(placeholder)) return null;
    const decision = ebruVoiceDecision(speaking, line, at);
    if (decision === 'skip') return null;
    if (decision === 'replace') speakingHandle?.stop(0.08, at);
    if (buffer) {
      speakingHandle = engine.playBuffer('sfx', buffer, { when: at });
      engine.duckMusicBus(VOICE_DUCK_DB, buffer.duration, at - 0.04);
      speaking = { line, from: at, until: at + buffer.duration };
      return 'line';
    }
    last.delete(placeholder!);
    const s = start(placeholder!, { when: at });
    if (!s || s === 'silent') return null;
    speakingHandle = s.handle;
    engine.duckMusicBus(4, s.duration * 0.8, at - 0.03);
    speaking = { line, from: at, until: at + s.duration };
    return 'placeholder';
  };

  const report = (p: LoadProgress) => { for (const l of progressListeners) { try { l(p); } catch { /* listener error */ } } };

  const install = (id: EbruScoreId, asset: RenderedAsset) => {
    music.set(id, { asset, buffer: null });
    renderMs[id] = Math.round(asset.renderMs);
    const scene = SCENE_OF[id];
    const buffer = musicBuffer(id);
    if (scene && buffer) engine.registerScene(scene, { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
    if (id === 'bed1' && buffer && !engine.hasScene('bigwin')) engine.registerScene('bigwin', { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
    if (id === 'ambience' && buffer && engine.context) engine.startAmbience(buffer);
  };
  const installSfx = (clips: Map<string, SfxClip[]>) => {
    for (const [id, list] of clips) sfx.set(id, list.map(c => toAudioBuffer(c.l, c.r, c.sampleRate, engine.context) ?? c));
  };

  const startLoad = (): Promise<void> => {
    if (loading) return loading;
    const Offline = (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;
    if (!Offline || !SlotAudioEngine.supported()) { loading = Promise.resolve(); extended = loading; return loading; }
    service = options.service ? options.service() : new RenderService({ sampleRate: options.sampleRate, workerFactory: options.workerFactory });
    const svc = service;
    svc.trace = options.trace ?? null;
    const coreSfx = EBRU_SFX.filter(s => s.core).map(s => s.id), extSfx = EBRU_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = EBRU_SFX.filter(s => !s.core && s.late).map(s => s.id);
    const total = 3 + CORE_SCORES.length + EXTENDED_SCORES.length;
    let done = 0;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now(), ms = () => now() - t0;
    const step = async (label: string, phase: LoadProgress['phase'], job: () => Promise<void>) => {
      const s = ms();
      await job();
      if (disposed) return;
      renderMs[label] = Math.round(ms() - s);
      done++;
      report({ phase, done, total, label, ms: ms() });
    };
    const scoreStep = (id: EbruScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(EBRU_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    // core: base theme and the base-game effects (the comb layers included), rendered in parallel
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('ebru', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    // extended (lazy, in the background): feature effects, ambience/idle/intro/feature theme, then the celebration
    // group (callouts, tier-ups, landings, heads and beds), two jobs at a time
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('ebru', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      const queue: (() => Promise<void>)[] = [sfxStep('sfx-extended', extSfx), ...scores.slice(0, 5), sfxStep('sfx-celebration', lateSfx), ...scores.slice(5)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] ebru render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds (same behaviour as Tarhun) ---------------- */

  const bedFor = (): EbruScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as EbruScoreId));
  const bedBuffer = (): { id: EbruScoreId; buffer: AudioBuffer } | null => {
    const order: EbruScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as EbruScoreId[]).slice(4 - (tier || 1));
    for (const id of order) { const b = musicBuffer(id); if (b) return { id, buffer: b }; }
    return null;
  };
  const startBed = (when: number) => {
    const found = bedBuffer();
    if (!found || bed) return;
    bed = engine.playBuffer('music', found.buffer, { when, loop: true, fadeIn: 0.03 });
    bedPlaying = bed ? found.id : null;
    engine.duckHold(20);
  };
  const stopBed = (fade = 0.6) => { if (bed) { bed.stop(fade); bed = null; bedPlaying = null; engine.duckRelease(900); } };
  const scheduleBed = () => { const ctx = live(); if (!ctx || bed) return; startBed(Math.max(ctx.currentTime + 0.05, bigWinEndAt)); };
  const celebrating = (): boolean => {
    if (!tier && !maxWinActive) return false;
    const ctx = engine.context;
    return counting || bed !== null || (!!ctx && ctx.currentTime < bigWinEndAt);
  };
  const registerBedScene = () => {
    const id = bedFor(), buffer = musicBuffer(id), asset = music.get(id)?.asset;
    if (buffer && asset) engine.registerScene('bigwin', { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
  };
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number, line: EbruVoiceLine) => {
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 67); speak(line); return; }
    head = s.handle; gridStart = s.at; bigWinEndAt = s.end;
    registerBedScene();
    speak(line, s.at + 0.35);
    if (counting) scheduleBed();
  };
  const climb = (target: WinTier | 'max') => {
    const ctx = live(); if (!ctx) return;
    const plan = planTierUp(ctx.currentTime, gridStart ? { start: gridStart, bpm: CELEBRATION_BPM } : null, TIER_UP_PRE, 0.12);
    play(`tier-up-${target}`, { when: plan.clipAt, offset: plan.clipOffset });
    last.delete(`tier-up-${target}`);
    const cut = Math.max(ctx.currentTime, plan.hitAt - 0.06);
    if (bed) { bed.stop(0.08, cut); bed = null; bedPlaying = null; }
    if (head) { head.stop(0.1, cut); head = null; }
    if (target === 'max') maxWinActive = true; else tier = target;
    registerBedScene();
    if (target === 'max' || !counting) {
      const s = stinger(target === 'max' ? 'maxWin' : (`bigWin${target}` as Stinger), plan.hitAt, target === 'max' ? 18 : 14);
      if (s) { head = s.handle; gridStart = s.at; bigWinEndAt = s.end; } else { gridStart = plan.hitAt; bigWinEndAt = plan.hitAt; }
      if (counting) startBed(Math.max(ctx.currentTime + 0.05, bigWinEndAt));
    } else {
      gridStart = plan.hitAt; bigWinEndAt = plan.hitAt;
      startBed(plan.hitAt);
    }
    speak(EBRU_TIER_VOICE[target], plan.hitAt + 0.3);
  };
  const tickLoop = () => {
    const ctx = live(); if (!ctx || !counting) return;
    const horizon = ctx.currentTime + 0.12;
    while (countNext < horizon) {
      const elapsed = Math.max(0, countNext - countStart);
      const rate = Math.min(1.5, 1 + elapsed * 0.07) * tickShift(maxWinActive ? TIER_KEY.max : TIER_KEY[tier || 1]);
      play('coin', { when: countNext, rate, gain: 0.9 });
      last.delete('coin');
      countNext += Math.max(0.06, 0.09 - elapsed * 0.005);
    }
  };
  const endCelebration = () => { tier = 0; maxWinActive = false; head = null; bigWinEndAt = 0; gridStart = 0; };

  /* ---------------- voice bank ---------------- */

  const decoder = (): BaseAudioContext | null => {
    if (engine.context) return engine.context;
    if (voiceDecoder) return voiceDecoder;
    const Offline = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    try { voiceDecoder = Offline ? new Offline({ numberOfChannels: 2, length: 1, sampleRate: 44100 }) : null; } catch { voiceDecoder = null; }
    return voiceDecoder;
  };
  const fetchVoice = async (url: string): Promise<AudioBuffer | null> => {
    const f = (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    if (typeof f !== 'function') return null;
    const res = await f(url);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const ctx = decoder();
    if (!ctx || disposed) return null;
    return ctx.decodeAudioData(data);
  };

  const ctxNow = () => engine.context?.currentTime ?? 0;
  const featureEndLine = () => { const t = ctxNow(); if (t - lastFeatureEndAt > FEATURE_END_WINDOW) { lastFeatureEndAt = t; speak('feature-end', t + 0.6); } };
  const triggerMoment = () => {
    if (!play('trigger')) fb()?.chimeRun(8, 74);
    lastTriggerAt = ctxNow();
    speak('feature-trigger');
  };
  const bloom = (colour: string | undefined, size: number) => {
    const id = `bloom-${bloomSize(size)}`;
    const semis = colourSemitones(colour);
    const opts = { rate: 2 ** (semis / 12), gain: 0.85 + 0.15 * Math.min(1, size / 20) };
    // the large bloom renders in the first background batch; until then the medium one stands in
    if (!play(id, opts) && !(id === 'bloom-l' && play('bloom-m', opts))) fb()?.pop(size, size >= 12 ? 2 : size >= 8 ? 1 : 0);
  };

  /* ---------------- API ---------------- */

  const api: EbruSound = {
    engine,
    voiceLines,
    load: onProgress => { if (onProgress) progressListeners.add(onProgress); return startLoad(); },
    loaded: async () => { await startLoad(); await extended; },
    status: () => ({
      core: coreReady, extended: extendedReady, rendered: [...music.keys(), ...sfx.keys()], renderMs: { ...renderMs }, workers: service?.parallelism ?? 0, workerJobs: service?.workerJobs ?? 0, workerFailure: service?.failure ?? null,
      celebration: { tier, max: maxWinActive, counting, bed: bedPlaying },
      voice: { speaking: speaking && speaking.from <= ctxNow() && speaking.until > ctxNow() ? speaking.line : null, loaded: [...voiceLines.values()].filter(Boolean).length },
    }),

    resume: async () => {
      if (disposed) return;
      engine.ensure();
      await engine.resume();
      const amb = musicBuffer('ambience'); if (amb) engine.startAmbience(amb);
      if (enabled) void startLoad();
    },
    setEnabled: on => {
      enabled = on;
      if (disposed) return;
      engine.setMix({ muted: !on });
      if (on) { engine.ensure(); void engine.resume(); void startLoad(); const amb = musicBuffer('ambience'); if (amb) engine.startAmbience(amb); }
      if (!on) { counting = false; if (countTimer) { clearInterval(countTimer); countTimer = null; } stopBed(0.1); head?.stop(0.1); endCelebration(); tease?.stop(0.1); tease = null; comb?.stop(0.05); comb = null; speakingHandle?.stop(0.05); speaking = null; }
    },
    setMix: mix => { if ('muted' in mix && typeof mix.muted === 'boolean') enabled = !mix.muted; engine.setMix(mix); },
    getMix: () => engine.mixSettings,
    setScene: scene => {
      const ctx = engine.context;
      if (ctx && pendingSceneAt > ctx.currentTime + 0.02) { engine.setScene(scene, { at: pendingSceneAt, fade: 0.3 }); pendingSceneAt = 0; }
      else engine.setScene(scene);
    },
    duck: (amountDb, ms) => engine.duck(amountDb, ms),

    spinStart: () => { if (!play('spin')) fb()?.spin(); },
    dropIn: column => {
      const col = clamp(Math.round(column), 0, 6);
      if (!play('drop', { rate: 2 ** (dropSemitones(col) / 12), pan: (col - 3) / 4.5 })) fb()?.land(col);
    },
    land: column => api.dropIn(column),
    symbolLand: () => { play('tick'); },
    bleed: (colour, spread) => {
      const n = clamp(Number(spread ?? 2), 0, 4);
      if (!play('bleed', { rate: 2 ** (colourSemitones(colour) / 24), gain: 0.8 + 0.05 * n }) && !play('bloom-m', { rate: 0.75 })) fb()?.crystal(4);
    },
    clusterDissolve: (colour, size) => bloom(colour, clamp(Number(size), 1, 49)),
    shatter: (count, payTier) => { const lvl = clamp(payTier, 0, 2); bloom(undefined, Math.max(clamp(count, 1, 49), lvl >= 2 ? 12 : lvl >= 1 ? 8 : 5)); },
    pop: (count, payTier) => api.shatter(count, payTier),
    winHighlight: multiplier => {
      const level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8) / 8;
      if (!play('win', { gain: 0.6 + 0.4 * level, rate: 1 + level * 0.06 })) fb()?.win(multiplier);
    },
    win: multiplier => api.winHighlight(multiplier),
    fall: () => { play('fall'); },
    tumble: () => api.fall(),
    combSweep: (shifts, ms, opts = {}) => {
      const ctx = live(), out = engine.busInput('sfx');
      if (!ctx || !out) return 0;
      const plan = combPlan(shifts, ms, opts.pass ?? 1);
      const when = Math.max(ctx.currentTime + 0.01, opts.when ?? ctx.currentTime + 0.01);
      if (when - lastCombAt < COMB_GAP) return 0;
      const glide = anyVariation('comb-glide');
      if (!glide) { fb()?.collect(); return plan.seconds; }
      lastCombAt = when;
      comb?.stop(0.06);
      const plucks = (sfx.get('comb-pluck') ?? []).map((_, i) => sfxBuffer('comb-pluck', i)).filter((b): b is AudioBuffer => !!b);
      comb = scheduleCombSweep(ctx, out, { glide, plucks, bristle: anyVariation('comb-bristle'), end: anyVariation(opts.createsWin ? 'comb-win' : 'comb-settle') }, plan, when);
      engine.duck(3, plan.seconds * 1000, 80, 500);
      return plan.seconds;
    },
    stainGrow: value => {
      const lvl = stainLevel(value);
      if (!play('stain', { rate: 2 ** (stainSemitones(value) / 12), gain: 0.7 + 0.3 * lvl })) fb()?.crystal(value);
    },
    scatterLand: n => {
      const k = clamp(Math.round(n), 1, 6);
      if (!play(`scatter${k}`)) fb()?.scatter(n);
      if (k === 2) api.scatterTease(true);
    },
    scatter: n => api.scatterLand(n),
    scatterTease: on => {
      const ctx = live();
      if (!on || !ctx) { tease?.stop(0.18); tease = null; return; }
      if (tease) return;
      const list = sfx.get('tease'); if (!list?.length) return;
      const buffer = sfxBuffer('tease', Math.floor(random() * list.length));
      if (buffer) { tease = engine.playBuffer('sfx', buffer, { fadeIn: 0.05 }); engine.duck(6, buffer.duration * 1000, 200, 400); speak('scatter-tease', ctx.currentTime + 0.4); }
    },
    featureTrigger: () => { if (live()) { tease?.stop(0.2); tease = null; triggerMoment(); } },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return;
      if (ctx.currentTime - lastTriggerAt > TRIGGER_WINDOW) triggerMoment();
      tease?.stop(0.2); tease = null;
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) { pendingSceneAt = s.end; speak('feature-start', s.end - 0.1); } else fb()?.chimeRun(6, 74);
    },
    retrigger: () => {
      const s = stinger('retrigger', 'beat', 8, 300);
      if (!s && !play('scatter6')) fb()?.chimeRun(4, 74);
      speak('retrigger', s ? s.at + 0.25 : undefined);
    },
    featureOutro: () => {
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 67);
      featureEndLine();
    },
    totalWinFanfare: () => {
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 67);
      featureEndLine();
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      const action = tierAction(tier, t, isActive);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as EbruScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2, EBRU_TIER_VOICE[t]);
    },
    maxWin: () => {
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      if (isActive && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12, EBRU_TIER_VOICE.max);
    },
    multiplierCallout: value => {
      const cls: MultiplierClass = ebruCalloutClass(value), rank = ebruCalloutRank(cls);
      const ctx = live(); if (!ctx) return;
      if (!play(`callout-${cls}`)) { if (!play('stain', { rate: 2 ** (stainSemitones(value) / 12) })) fb()?.win(value); }
      engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
      speak(EBRU_CLASS_VOICE[cls]);
    },
    nice: () => {
      const t = ctxNow();
      if (t - lastNiceAt < NICE_COOLDOWN) return;
      if (speak('nice')) lastNiceAt = t;
    },
    setVoiceBank: async urls => {
      const loaded = await loadEbruVoiceBank(ebruVoiceBankUrls(urls), fetchVoice);
      const result = { loaded: [] as EbruVoiceLine[], missing: [] as EbruVoiceLine[] };
      if (disposed) return result;
      voiceLines.clear();
      for (const line of EBRU_VOICE_LINES) { const buffer = loaded.get(line) ?? null; voiceLines.set(line, buffer); (buffer ? result.loaded : result.missing).push(line); }
      return result;
    },
    countUp: on => {
      const ctx = live();
      if (on) {
        if (counting || !ctx) return;
        counting = true; countStart = ctx.currentTime + 0.03; countNext = countStart;
        if ((tier || maxWinActive) && bigWinEndAt > ctx.currentTime - 0.5) scheduleBed();
        tickLoop();
        countTimer = setInterval(tickLoop, 40);
      } else {
        if (!counting) return;
        const wasCelebrating = (tier || maxWinActive) && (bed !== null || (!!ctx && ctx.currentTime < bigWinEndAt + 2));
        counting = false;
        if (countTimer) { clearInterval(countTimer); countTimer = null; }
        if (wasCelebrating) {
          const landed = play(`count-land-${maxWinActive ? 'max' : tier}`);
          stopBed(landed ? 0.35 : 0.6);
          if (ctx && ctx.currentTime < bigWinEndAt) head?.stop(0.3);
          if (!landed) play('ding');
          endCelebration();
        } else {
          stopBed(0.6);
          play('ding');
        }
      }
    },
    click: () => { if (!play('click')) fb()?.click(); },
    betChange: (direction = 1) => { play(direction < 0 ? 'bet-down' : 'bet-up'); },
    denied: () => { play('denied'); },
    autoplay: on => { play(on ? 'auto-on' : 'auto-off'); },
    playSfx: (id, opts) => { play(id, opts); },
    playStinger: id => {
      const ctx = live(); const buffer = musicBuffer(id);
      if (ctx && buffer) engine.playBuffer('music', buffer, { when: engine.quantizedTime('beat', 0.62) });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true; enabled = false; counting = false;
      if (countTimer) clearInterval(countTimer);
      progressListeners.clear();
      comb = null;
      engine.dispose();
      service?.dispose();
      sfx.clear(); music.clear(); active.clear(); voiceLines.clear();
      speaking = null; speakingHandle = null;
    },
  };
  return api;
}

/** Representative value per callout class (lab, tests). */
export const EBRU_CALLOUT_VALUES: Readonly<Record<MultiplierClass, number>> = Object.freeze({ x2: 4, x10: 12, x25: 30, x50: 64, x100: 128, x250: 256 });
