/**
 * Göreme: Şafak Balonları sound for the game. Same public shape as asena-sound.ts (resume / load / setMix / setScene / duck /
 * bigWin / maxWin / countUp / multiplierCallout / click / betChange / denied / autoplay / setVoiceBank …) plus the Göreme
 * events, one per engine step (packages/protocol/src/goreme.ts):
 *   spin.grid                 → spinStart(), reelStop(reel) per reel 0..5 (symbolLand per cell is optional)
 *   spin/respin .balloons     → balloonLand(multiplier, reel) per landed balloon
 *   sun cells on the board    → sunLand(n) in landing order (the tease starts at 2), sunTease(false) when it ends
 *   ways.wins                 → waysWin(symbol, stepWin / bet) per board (graded 0..3), multiplierCallout(product) for ≥×10
 *   lift                      → lift({ wind, balloons, lift, merges, exits }) — burner, gust, merges, fly-aways/moorings —
 *                               or the atomic burner(heat) / wind(dir) / merge(multiplier) / flyAway() / moor(sky)
 *   respin                    → respin()
 *   sky                       → skyMultiplier(before, after) (ticks up, the "sky full" line at ≥×10)
 *   scatter (3+)              → featureTrigger(), freeSpinsIntro(), setScene('feature'); in free spins: retrigger()
 *   end of feature            → totalWinFanfare() / featureOutro(), setScene('base'); big wins → bigWin(t) / maxWin() / countUp()
 *
 * All music and effects are original and rendered offline once (render.ts, the shared worker pool); playback is plain
 * buffer playback on the shared engine's buses. Recorded voice lines are optional: a missing file leaves the moment to a
 * wordless placeholder or to the effect alone, silently. Presentation only: driven by already-resolved round steps, it
 * never feeds back into a result, payout or timing of the game.
 */
import { createVoicePolicy, type VoiceLevel, type VoicePolicyOptions } from './voice-policy';
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render-shared';
import { RenderService, type WorkerFactory } from './render-service';
import { GOREME_SCORES, type GoremeScoreId } from './scores/goreme';
import { GOREME_SFX } from './sfx/goreme';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import { CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DUCK_DB, VOICE_DELAY, planTierUp, tierAction, toWinTier, type WinTier } from './win-tiers';
import {
  GOREME_CLASS_VOICE, GOREME_PLACEHOLDER, GOREME_TIER_VOICE, GOREME_VOICE_LINES,
  balloonClass, balloonSemitones, burnerHeat, goremeCalloutClass, goremeCalloutRank, goremeSymbolSemitones, goremeVoiceBankUrls, goremeVoiceDecision,
  loadGoremeVoiceBank, mergeSemitones, reelPan, reelSemitones, skySemitones, sunIndex, waysGrade, windSweep, type GoremeVoiceLine,
} from './goreme-tiers';
import type { LoadProgress } from './cascade-sound';

export type { LoadProgress } from './cascade-sound';
export { loadMixSettings, saveMixSettings } from './mix-settings';
export type { GoremeVoiceLine } from './goreme-tiers';
export type { WinTier } from './win-tiers';

/** One lift step as the sound needs it (a subset of packages/protocol GoremeLiftStep). */
export interface GoremeLiftSound {
  wind?: string;
  /** Balloons on the board after the lift. */
  balloons?: number;
  /** 1-based lift number within the spin. */
  lift?: number;
  /** Merged multipliers, one per merge. */
  merges?: readonly number[];
  /** Balloons leaving the top: multiplier, and whether it moored in the sky band (free spins). */
  exits?: readonly { multiplier: number; moored: boolean }[];
  /** Start on the audio clock (default: now). */
  when?: number;
}

export interface GoremeSound {
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;

  spinStart: () => void;
  /** A reel stops (0..5): a frame tap and lute pluck stepped up C D F G A C left → right. */
  reelStop: (reel: number) => void;
  symbolLand: () => void;
  /** A balloon wild lands: sound class and pitch by its multiplier, panned by reel. */
  balloonLand: (multiplier: number, reel?: number) => void;
  /** Ways win of a board, graded by the step win in multiples of the bet (symbol tilts the pitch). */
  waysWin: (symbol: string | null, winMultiple: number) => void;
  winHighlight: (multiple: number) => void;
  /** A whole lift step: burner, gust (or a calm breath), merges, fly-aways / moorings. Returns its length in seconds. */
  lift: (step: GoremeLiftSound) => number;
  burner: (heat?: number, when?: number) => void;
  wind: (direction: string, when?: number) => void;
  merge: (multiplier: number, when?: number) => void;
  flyAway: (when?: number) => void;
  moor: (sky?: number, when?: number) => void;
  respin: () => void;
  /** The sky multiplier rose from `before` to `after`: rising chime ticks, the "sky full" line at ≥×10. */
  skyMultiplier: (before: number, after: number) => void;
  sunLand: (n: number) => void;
  sunTease: (on: boolean) => void;
  featureTrigger: () => void;
  freeSpinsIntro: () => void;
  retrigger: () => void;
  featureOutro: () => void;
  totalWinFanfare: () => void;
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  maxWin: () => void;
  countUp: (start: boolean) => void;
  multiplierCallout: (value: number) => void;
  nice: () => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
  setVoiceBank: (urls: string | Partial<Record<GoremeVoiceLine, string | null>>, opts?: { requireVersion?: boolean }) => Promise<{ loaded: GoremeVoiceLine[]; missing: GoremeVoiceLine[] }>;
  setVoicePolicy: (p: { level?: VoiceLevel; fast?: boolean }) => void;
  readonly voiceLines: Map<GoremeVoiceLine, AudioBuffer | null>;
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  playStinger: (id: GoremeScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => {
    core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null;
    celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null };
    voice: { speaking: GoremeVoiceLine | null; loaded: number; last: { line: GoremeVoiceLine; kind: 'line' | 'placeholder' } | null };
  };
  dispose: () => void;
}

type Stinger = 'fsIntro' | 'retrigger' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: GoremeScoreId[] = ['base'];
const EXTENDED_SCORES: GoremeScoreId[] = ['ambience', 'idle', 'fsIntro', 'feature', 'retrigger', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
const SCENE_OF: Partial<Record<GoremeScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);
const rate = (semi: number) => 2 ** (semi / 12);

const LIMITS: Record<string, [number, number]> = {
  stop: [0.03, 6], tick: [0.025, 6], coin: [0.055, 3], spin: [0.08, 2], click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2],
  'balloon-1': [0.03, 6], 'balloon-2': [0.03, 6], 'balloon-3': [0.04, 4], 'balloon-4': [0.05, 3],
  'ways-0': [0.07, 2], 'ways-1': [0.07, 2], 'ways-2': [0.08, 2], 'ways-3': [0.1, 2],
  burner: [0.15, 2], 'gust-l': [0.2, 2], 'gust-r': [0.2, 2], breeze: [0.2, 2], merge: [0, 4], 'merge-big': [0, 2], flyaway: [0, 4], moor: [0, 4], 'sky-tick': [0, 10], respin: [0.08, 2],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1],
  'vo-hum': [0.3, 1], 'vo-rise': [0.3, 1], 'vo-joy': [0.3, 1],
};
const NICE_COOLDOWN = 20;
const MOMENT_COOLDOWN = 30;
const FEATURE_END_WINDOW = 8;
const TRIGGER_WINDOW = 6;

function toAudioBuffer(l: Float32Array, r: Float32Array, sampleRate: number, ctx: BaseAudioContext | null): AudioBuffer | null {
  try {
    const Ctor = (globalThis as unknown as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
    const b = Ctor ? new Ctor({ length: l.length, numberOfChannels: 2, sampleRate }) : ctx ? ctx.createBuffer(2, l.length, sampleRate) : null;
    if (!b) return null;
    b.copyToChannel(l as Float32Array<ArrayBuffer>, 0); b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return b;
  } catch { return null; }
}

export type GoremeRenderService = Pick<RenderService, 'score' | 'sfx' | 'prefetch' | 'dispose' | 'parallelism' | 'workerJobs' | 'failure' | 'trace'>;

export function createGoremeSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; voicePolicy?: VoicePolicyOptions; service?: () => GoremeRenderService } = {}): GoremeSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<GoremeScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: GoremeRenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: GoremeScoreId | null = null;
  const voiceLines = new Map<GoremeVoiceLine, AudioBuffer | null>();
  let voiceDecoder: BaseAudioContext | null = null;
  let speaking: { line: GoremeVoiceLine; from: number; until: number } | null = null, speakingHandle: VoiceHandle | null = null;
  let lastSpoken: { line: GoremeVoiceLine; kind: 'line' | 'placeholder' } | null = null;
  let lastNiceAt = -Infinity, lastFeatureEndAt = -Infinity, lastTriggerAt = -Infinity, lastWindLineAt = -Infinity, lastLiftLineAt = -Infinity;
  let mooredThisFeature = false;
  let counting = false, countTimer: ReturnType<typeof setInterval> | null = null, countNext = 0, countStart = 0;
  const progressListeners = new Set<(p: LoadProgress) => void>();
  engine.setMix({ muted: true });

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
  const musicBuffer = (id: GoremeScoreId): AudioBuffer | null => {
    const m = music.get(id); if (!m) return null;
    if (!m.buffer) m.buffer = toAudioBuffer(m.asset.l, m.asset.r, m.asset.sampleRate, engine.context);
    return m.buffer;
  };

  type PlayOpts = { rate?: number; gain?: number; pan?: number; when?: number; offset?: number; force?: boolean };
  const start = (id: string, opts: PlayOpts = {}): { handle: VoiceHandle | null; duration: number } | 'silent' | null => {
    const ctx = live(); if (!ctx) return 'silent';
    const list = sfx.get(id); if (!list || !list.length) return null;
    const def = GOREME_SFX.find(s => s.id === id);
    const [minGap, cap] = LIMITS[id] ?? [0.02, 4];
    const t = ctx.currentTime;
    if (!opts.force && t - (last.get(id) ?? -1) < minGap) return 'silent';
    last.set(id, t);
    const v = pickVariation(list.length, lastVar.get(id) ?? -1, random); lastVar.set(id, v);
    const buffer = sfxBuffer(id, v); if (!buffer) return null;
    const jitter = def?.jitter ?? [20, 1];
    const mv = microVariation(random, jitter[0], jitter[1]);
    const voices = (active.get(id) ?? []).filter(h => h.startTime + buffer.duration > t);
    while (voices.length >= cap) voices.shift()?.stop(0.03);
    const r = (opts.rate ?? 1) * mv.rate;
    const handle = engine.playBuffer('sfx', buffer, { rate: r, gain: (opts.gain ?? 1) * mv.gain, pan: opts.pan, when: opts.when, offset: opts.offset });
    if (handle) voices.push(handle);
    active.set(id, voices);
    return { handle, duration: buffer.duration / r };
  };
  const play = (id: string, opts: PlayOpts = {}): boolean => start(id, opts) !== null;

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

  const voicePolicy = createVoicePolicy({ minorInKey: false, ...options.voicePolicy });
  let bankToken = 0;
  const speak = (line: GoremeVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    let result: 'line' | 'placeholder' | null = null;
    voicePolicy.request(line, ctx.currentTime, () => { result = speakNow(line, when); return result !== null; });
    return result;
  };
  const speakNow = (line: GoremeVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime + VOICE_DELAY);
    const buffer = voiceLines.get(line) ?? null, placeholder = GOREME_PLACEHOLDER[line];
    if (!buffer && !placeholder) return null;
    if (!buffer && placeholder && !sfx.has(placeholder)) return null;
    const decision = goremeVoiceDecision(speaking, line, at);
    if (decision === 'skip') return null;
    if (decision === 'replace') speakingHandle?.stop(0.08, at);
    if (buffer) {
      speakingHandle = engine.playBuffer('sfx', buffer, { when: at });
      engine.duckMusicBus(VOICE_DUCK_DB, buffer.duration, at - 0.04);
      speaking = { line, from: at, until: at + buffer.duration };
      lastSpoken = { line, kind: 'line' };
      return 'line';
    }
    last.delete(placeholder!);
    const s = start(placeholder!, { when: at });
    if (!s || s === 'silent') return null;
    speakingHandle = s.handle;
    engine.duckMusicBus(4, s.duration * 0.8, at - 0.03);
    speaking = { line, from: at, until: at + s.duration };
    lastSpoken = { line, kind: 'placeholder' };
    return 'placeholder';
  };

  const report = (p: LoadProgress) => { for (const l of progressListeners) { try { l(p); } catch { /* listener error */ } } };
  const install = (id: GoremeScoreId, asset: RenderedAsset) => {
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
    service = options.service ? options.service() : new RenderService({ sampleRate: options.sampleRate, workerFactory: options.workerFactory, catalogs: { goreme: GOREME_SFX } });
    const svc = service;
    svc.trace = options.trace ?? null;
    const coreSfx = GOREME_SFX.filter(s => s.core).map(s => s.id), extSfx = GOREME_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = GOREME_SFX.filter(s => !s.core && s.late).map(s => s.id);
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
    const scoreStep = (id: GoremeScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(GOREME_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('goreme', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('goreme', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      const queue: (() => Promise<void>)[] = [sfxStep('sfx-extended', extSfx), ...scores.slice(0, 5), sfxStep('sfx-celebration', lateSfx), ...scores.slice(5)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] goreme render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds (same behaviour as Asena) ---------------- */

  const bedFor = (): GoremeScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as GoremeScoreId));
  const bedBuffer = (): { id: GoremeScoreId; buffer: AudioBuffer } | null => {
    const order: GoremeScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as GoremeScoreId[]).slice(4 - (tier || 1));
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
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number, line: GoremeVoiceLine) => {
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 65); speak(line); return; }
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
    const prevLine = maxWinActive ? GOREME_TIER_VOICE.max : GOREME_TIER_VOICE[tier || 1];
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
    // the script has two tier lines: a climb inside the same line (Büyük → Mega → Süper) stays wordless
    const line = GOREME_TIER_VOICE[target];
    if (line !== prevLine) speak(line, plan.hitAt + 0.3);
  };
  const tickLoop = () => {
    const ctx = live(); if (!ctx || !counting) return;
    const horizon = ctx.currentTime + 0.12;
    while (countNext < horizon) {
      const elapsed = Math.max(0, countNext - countStart);
      const r = Math.min(1.5, 1 + elapsed * 0.07) * tickShift(maxWinActive ? TIER_KEY.max : TIER_KEY[tier || 1]);
      play('coin', { when: countNext, rate: r, gain: 0.9 });
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
    if (!play('trigger')) fb()?.chimeRun(8, 72);
    lastTriggerAt = ctxNow();
    speak('feature-trigger', ctxNow() + 1.0);
  };
  const at0 = (when?: number) => { const ctx = live(); return ctx ? Math.max(ctx.currentTime + 0.01, when ?? ctx.currentTime + 0.01) : 0; };

  /* ---------------- API ---------------- */

  const api: GoremeSound = {
    engine,
    voiceLines,
    load: onProgress => { if (onProgress) progressListeners.add(onProgress); return startLoad(); },
    loaded: async () => { await startLoad(); await extended; },
    status: () => ({
      core: coreReady, extended: extendedReady, rendered: [...music.keys(), ...sfx.keys()], renderMs: { ...renderMs }, workers: service?.parallelism ?? 0, workerJobs: service?.workerJobs ?? 0, workerFailure: service?.failure ?? null,
      celebration: { tier, max: maxWinActive, counting, bed: bedPlaying },
      voice: { speaking: speaking && speaking.from <= ctxNow() && speaking.until > ctxNow() ? speaking.line : null, loaded: [...voiceLines.values()].filter(Boolean).length, last: lastSpoken },
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
      if (!on) { counting = false; if (countTimer) { clearInterval(countTimer); countTimer = null; } stopBed(0.1); head?.stop(0.1); endCelebration(); tease?.stop(0.1); tease = null; speakingHandle?.stop(0.05); speaking = null; }
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
    reelStop: reel => {
      const r = clamp(Math.round(reel), 0, 5);
      if (!play('stop', { rate: rate(reelSemitones(r)), pan: reelPan(r), gain: r === 5 ? 1.1 : 1 })) fb()?.land(r);
    },
    symbolLand: () => { play('tick'); },
    balloonLand: (multiplier, reel) => {
      const c = balloonClass(multiplier);
      const pan = reel === undefined ? 0 : reelPan(reel);
      if (!play(`balloon-${c}`, { rate: rate(balloonSemitones(multiplier) / 2), pan })) fb()?.crystal(c + 1);
    },
    waysWin: (symbol, winMultiple) => {
      const g = waysGrade(winMultiple);
      if (!play(`ways-${g}`, { rate: rate(goremeSymbolSemitones(symbol) / 4) })) fb()?.win(winMultiple);
    },
    winHighlight: multiple => api.waysWin(null, multiple),
    burner: (heat = 0.5, when) => {
      const h = clamp(heat, 0, 1);
      if (!play('burner', { when: when ? at0(when) : undefined, gain: 0.75 + 0.35 * h, rate: 0.94 + 0.12 * h, force: when !== undefined })) fb()?.spin();
    },
    wind: (direction, when) => {
      const sweep = windSweep(direction);
      const id = sweep.calm ? 'breeze' : direction === 'left' ? 'gust-l' : 'gust-r';
      play(id, { when: when ? at0(when) : undefined, force: when !== undefined });
      const t = ctxNow();
      if (!sweep.calm && t - lastWindLineAt > MOMENT_COOLDOWN && speak('wind', (when ?? t) + 0.5)) lastWindLineAt = t;
    },
    merge: (multiplier, when) => {
      const big = multiplier >= 10 && sfx.has('merge-big');
      const t = when ? at0(when) : undefined;
      if (!play(big ? 'merge-big' : 'merge', { when: t, rate: rate(mergeSemitones(multiplier) / 3), force: true })) fb()?.pop(multiplier, 2);
      engine.duck(big ? 6 : 3, big ? 1200 : 600, 30, 500);
      speak('merge', (t ?? ctxNow()) + 0.45);
    },
    flyAway: when => { play('flyaway', { when: when ? at0(when) : undefined, force: true }); },
    moor: (sky = 1, when) => {
      const t = when ? at0(when) : undefined;
      if (!play('moor', { when: t, rate: rate(skySemitones(sky) / 2), force: true })) fb()?.crystal(3);
      if (!mooredThisFeature) { mooredThisFeature = true; speak('moor', (t ?? ctxNow()) + 0.6); }
    },
    lift: step => {
      const ctx = live(); if (!ctx) return 0;
      const t0 = at0(step.when);
      const balloons = Math.max(0, step.balloons ?? 1), liftNo = Math.max(1, step.lift ?? 1);
      api.burner(burnerHeat(balloons, liftNo), t0);
      api.wind(step.wind ?? 'calm', t0 + 0.18);
      let t = t0 + 0.45;
      for (const e of step.exits ?? []) { if (e.moored) api.moor(e.multiplier, t); else api.flyAway(t); t += 0.12; }
      let m = t0 + 0.55;
      for (const mult of step.merges ?? []) { api.merge(mult, m); m += 0.25; }
      if (liftNo === 1 && ctx.currentTime - lastLiftLineAt > MOMENT_COOLDOWN && speak('lift', t0 + 0.25)) lastLiftLineAt = ctx.currentTime;
      return Math.max(t, m) - ctx.currentTime + 0.4;
    },
    respin: () => { play('respin'); },
    skyMultiplier: (before, after) => {
      const ctx = live(); if (!ctx) return;
      const b = Math.max(1, before), a = Math.max(b, after);
      if (a <= b) return;
      const n = Math.max(1, Math.min(8, Math.round(a - b)));
      for (let k = 1; k <= n; k++) {
        const v = b + ((a - b) * k) / n;
        play('sky-tick', { when: ctx.currentTime + 0.02 + (k - 1) * 0.09, rate: rate(skySemitones(v)), gain: 0.8 + 0.2 * (k / n), force: true });
      }
      if (b < 10 && a >= 10) speak('sky-10', ctx.currentTime + 0.1 + n * 0.09);
    },
    sunLand: n => {
      const k = sunIndex(n);
      if (!play(`sun${k}`)) fb()?.scatter(n);
      if (k === 2) api.sunTease(true);
    },
    sunTease: on => {
      const ctx = live();
      if (!on || !ctx) { tease?.stop(0.18); tease = null; return; }
      if (tease) return;
      const list = sfx.get('tease'); if (!list?.length) return;
      const buffer = sfxBuffer('tease', Math.floor(random() * list.length));
      if (buffer) { tease = engine.playBuffer('sfx', buffer, { fadeIn: 0.05 }); engine.duck(6, buffer.duration * 1000, 200, 400); speak('sun-tease', ctx.currentTime + 0.4); }
    },
    featureTrigger: () => { if (live()) { tease?.stop(0.2); tease = null; triggerMoment(); } },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return;
      mooredThisFeature = false;
      if (ctx.currentTime - lastTriggerAt > TRIGGER_WINDOW) triggerMoment();
      tease?.stop(0.2); tease = null;
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) { pendingSceneAt = s.end; speak('feature-start', s.end - 0.1); } else fb()?.chimeRun(6, 72);
    },
    retrigger: () => {
      const s = stinger('retrigger', 'beat', 8, 300);
      if (!s && !play('spins-plus')) fb()?.chimeRun(4, 72);
      speak('retrigger', s ? s.at + 0.25 : undefined);
    },
    featureOutro: () => {
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 65);
      featureEndLine();
    },
    totalWinFanfare: () => {
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 65);
      featureEndLine();
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      const action = tierAction(tier, t, isActive);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as GoremeScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2, GOREME_TIER_VOICE[t]);
    },
    maxWin: () => {
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      if (isActive && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12, GOREME_TIER_VOICE.max);
    },
    multiplierCallout: value => {
      const cls = goremeCalloutClass(value), rank = goremeCalloutRank(cls);
      const ctx = live(); if (!ctx) return;
      if (!play(`callout-${cls}`)) { if (!play('ways-1', { rate: 1.12 })) fb()?.win(value); }
      engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
      speak(GOREME_CLASS_VOICE[cls]);
    },
    nice: () => {
      const t = ctxNow();
      if (t - lastNiceAt < NICE_COOLDOWN) return;
      if (speak('nice')) lastNiceAt = t;
    },
    setVoicePolicy: p => { if (p && p.level !== undefined) voicePolicy.setLevel(p.level); if (p && p.fast !== undefined) voicePolicy.setFast(p.fast); },
    setVoiceBank: async (urls, opts = {}) => {
      const myBank = ++bankToken; voiceLines.clear();
      const loaded = await loadGoremeVoiceBank(goremeVoiceBankUrls(urls, { requireVersion: opts.requireVersion }), fetchVoice);
      const result = { loaded: [] as GoremeVoiceLine[], missing: [] as GoremeVoiceLine[] };
      if (disposed || myBank !== bankToken) return result;
      voiceLines.clear();
      for (const line of GOREME_VOICE_LINES) { const buffer = loaded.get(line) ?? null; voiceLines.set(line, buffer); (buffer ? result.loaded : result.missing).push(line); }
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
      engine.dispose();
      service?.dispose();
      sfx.clear(); music.clear(); active.clear(); voiceLines.clear();
      speaking = null; speakingHandle = null;
    },
  };
  return api;
}
