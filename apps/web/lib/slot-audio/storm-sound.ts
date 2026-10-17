/**
 * Tarhun: Fırtına Tahtı sound for the game. Same public shape as cascade-sound.ts (resume / load / setMix /
 * setScene / duck / bigWin / countUp / multiplierCallout / setVoiceBank …) plus the storm-specific events
 * (orbs, lightning, total multiplier, retrigger, character voice).
 *
 * All music and effects are original and rendered offline once (render.ts, the shared worker pool); playback
 * is plain buffer playback on the shared engine's buses. Presentation only: driven by already-resolved
 * round steps, it never feeds back into a result, payout or timing of the game.
 *
 * Typical wiring:
 *   sound.load()                          – any time (renders in the background, core first)
 *   sound.resume() / setEnabled(true)     – from the sound button (user gesture)
 *   setScene('idle' | 'base')             – lobby / playing
 *   orbLand(v); lightningStrike(col); orbCollect(); totalMultiplier(total); multiplierCallout(applied)
 *   scatterLand(n) (tease starts at 3); featureTrigger(); freeSpinsIntro(); setScene('feature')
 *   retrigger(); totalWinFanfare(); featureOutro(); setScene('base')
 *   bigWin(tier); countUp(true) … bigWin(higher tier) … maxWin() … countUp(false)
 *   setVoiceBank('/audio/voice/storm')    – recorded lines (optional; missing files are skipped silently)
 */
import { createVoicePolicy, type VoiceLevel, type VoicePolicyOptions } from './voice-policy';
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render-shared';
import { RenderService, type WorkerFactory } from './render-service';
import { STORM_SCORES, type StormScoreId } from './scores/storm';
import { STORM_SFX } from './sfx/storm';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import { CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DELAY, VOICE_DUCK_DB, planTierUp, tierAction, toWinTier, type WinTier } from './win-tiers';
import {
  STORM_CLASS_VOICE, STORM_PLACEHOLDER, STORM_TIER_VOICE, STORM_VOICE_LINES, loadStormVoiceBank, orbSemitones, stormMultiplierClass, stormMultiplierRank, stormVoiceBankUrls, voiceDecision,
  type StormMultiplierClass, type StormVoiceLine,
} from './storm-tiers';
import type { LoadProgress } from './cascade-sound';

export type { LoadProgress } from './cascade-sound';
export { loadMixSettings, saveMixSettings } from './mix-settings';
export type { StormMultiplierClass, StormVoiceLine } from './storm-tiers';
export type { WinTier } from './win-tiers';

export interface StormSound {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  /** Render the bank. Resolves when the core (base theme + core effects) is ready; the rest follows in the background. */
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  /** Resolves when everything (feature theme, stingers, celebration effects) is rendered. */
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;

  spinStart: () => void;
  /** Column (0..5) landing: a stone thud stepped along A Hicaz. */
  land: (column: number) => void;
  symbolLand: () => void;
  /** Win highlight (cluster value as a multiple of the bet). */
  winHighlight: (multiplier: number) => void;
  /** Alias of winHighlight (Candy Cascade name). */
  win: (multiplier: number) => void;
  /** Symbols shatter: size class by count (8–9 / 10–11 / 12+) or pay tier 0..2. */
  shatter: (count: number, tier: number) => void;
  /** Alias of shatter (Candy Cascade name). */
  pop: (count: number, tier: number) => void;
  tumble: () => void;
  /** Multiplier orb lands: electric crackle + glassy hum, pitched by the orb's class. */
  orbLand: (value: number) => void;
  /** Orb charges and flies to the multiplier meter. */
  orbCollect: () => void;
  /** Orb arrives at the meter. */
  orbArrive: (value: number) => void;
  /** The god strikes a cell (optional column 0..5 for the stereo position). */
  lightningStrike: (column?: number) => void;
  /** The total multiplier rises (feature): a punchy thunder hit, bigger for larger totals. */
  totalMultiplier: (total: number) => void;
  /** n-th scatter of the spin (1..6), ascending; the tease riser starts at 3. */
  scatterLand: (n: number) => void;
  /** Alias of scatterLand (Candy Cascade name). */
  scatter: (n: number) => void;
  scatterTease: (on: boolean) => void;
  /** Free spins triggered (scatter win moment): the sky splits + "Fırtına başlıyor!". */
  featureTrigger: () => void;
  /** Free-spins intro: thunder + horn call (~3 s); a following setScene('feature') enters on its musical end. */
  freeSpinsIntro: () => void;
  /** +5 spins during the feature: strike + zurna flourish over the feature theme. */
  retrigger: () => void;
  /** End of the feature: the storm subsides (~4 s); a following setScene() enters on its musical end. */
  featureOutro: () => void;
  /** End-of-feature total-win screen fanfare (4 s); a following setScene() enters on its musical end. */
  totalWinFanfare: () => void;
  /** Tier 1 Büyük ≥10×, 2 Mega ≥25×, 3 Süper ≥50×, 4 Efsane ≥100×; climbs while a celebration runs. */
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  /** The ultimate celebration; during a running celebration it climbs into it. */
  maxWin: () => void;
  countUp: (start: boolean) => void;
  /** Applied-multiplier callout by class (<10, ≥10, ≥25, ≥50, ≥100, ≥250, 500) with its voice line. */
  multiplierCallout: (value: number) => void;
  /** The god laughs (long tumble chain). */
  laugh: () => void;
  /** "Güzel!" for a medium win; at most once every 20 s. */
  nice: () => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
  /**
   * Recorded voice lines (docs/product/storm-throne-voice-script.md): a folder (`/audio/voice/storm` →
   * `/audio/voice/storm/x100.mp3` …) or a URL per line. Missing or undecodable files are skipped silently;
   * a line that exists replaces the non-verbal placeholder vocal for its event. Never rejects.
   */
  setVoiceBank: (urls: string | Partial<Record<StormVoiceLine, string | null>>) => Promise<{ loaded: StormVoiceLine[]; missing: StormVoiceLine[] }>;
  /** Voice level (Full / Key moments / Off) and \"fast\" (turbo or autoplay: only tier and feature lines). */
  setVoicePolicy: (p: { level?: VoiceLevel; fast?: boolean }) => void;
  readonly voiceLines: Map<StormVoiceLine, AudioBuffer | null>;
  /** Lab/diagnostics: play any rendered effect by id. */
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  /** Lab/diagnostics: play any score as a one-shot by id. */
  playStinger: (id: StormScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => {
    core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null;
    celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null };
    voice: { speaking: StormVoiceLine | null; loaded: number };
  };
  dispose: () => void;
}

type Stinger = 'fsIntro' | 'retrigger' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: StormScoreId[] = ['base'];
const EXTENDED_SCORES: StormScoreId[] = ['ambience', 'idle', 'fsIntro', 'feature', 'retrigger', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
const SCENE_OF: Partial<Record<StormScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };
/** Count-up tick pitch per tier key (melodic material above C# sits an octave lower, as in the scores). */
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);
/** Column landing pitch: A Hicaz degrees around the thud's own pitch (A Bb C# D E F …), in semitones. */
const LAND_STEPS = [-4, -3, 0, 1, 3, 4, 6, 8, 9, 12, 13, 15];

/** Minimum spacing (s) and simultaneous voice cap per effect, so rapid events never stack up. */
const LIMITS: Record<string, [number, number]> = {
  land: [0.03, 6], tick: [0.025, 6], coin: [0.055, 3], 'shatter-s': [0.04, 5], 'shatter-m': [0.05, 4], 'shatter-l': [0.06, 3], win: [0.07, 3],
  click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2], orb: [0.04, 4], 'orb-fly': [0.05, 4], 'orb-arrive': [0.05, 4], lightning: [0.06, 3],
  tumble: [0.05, 3], spin: [0.08, 2], 'total-mult': [0.1, 2],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1], 'callout-x250': [0.3, 1], 'callout-x500': [0.3, 1],
  'vo-hum': [0.3, 1], 'vo-grunt': [0.3, 1], 'vo-laugh': [0.3, 1],
};
const NICE_COOLDOWN = 20;
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

/** The part of RenderService the sound uses (tests and the measurement harness may inject their own). */
export type StormRenderService = Pick<RenderService, 'score' | 'sfx' | 'prefetch' | 'dispose' | 'parallelism' | 'workerJobs' | 'failure' | 'trace'>;

export function createStormSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; voicePolicy?: VoicePolicyOptions; service?: () => StormRenderService } = {}): StormSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<StormScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: StormRenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: StormScoreId | null = null;
  const voiceLines = new Map<StormVoiceLine, AudioBuffer | null>();
  let voiceDecoder: BaseAudioContext | null = null;
  let speaking: { line: StormVoiceLine; from: number; until: number } | null = null, speakingHandle: VoiceHandle | null = null;
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
  const musicBuffer = (id: StormScoreId): AudioBuffer | null => {
    const m = music.get(id); if (!m) return null;
    if (!m.buffer) m.buffer = toAudioBuffer(m.asset.l, m.asset.r, m.asset.sampleRate, engine.context);
    return m.buffer;
  };

  /** Start a rendered effect with variation and micro-variation. 'silent' = muted / no audio on purpose; null = not rendered yet. */
  const start = (id: string, opts: { rate?: number; gain?: number; pan?: number; when?: number; offset?: number } = {}): { handle: VoiceHandle | null; duration: number } | 'silent' | null => {
    const ctx = live(); if (!ctx) return 'silent';
    const list = sfx.get(id); if (!list || !list.length) return null;
    const def = STORM_SFX.find(s => s.id === id);
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
  /** Play a rendered effect; false only when it is not rendered yet (so the caller can fall back). */
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

  /* ---------------- the god's voice: recorded lines, or the non-verbal placeholder ---------------- */

  /**
   * Speak `line` at `when` (default: just after the event's impact). The recorded line plays when it exists
   * (music bus ducked under it); otherwise the placeholder vocal, if the event has one. One voice at a time.
   */
  /** Shared "never annoying" policy (voice-policy.ts): level, spacing, repeats, cooldowns, turbo/autoplay. */
  const voicePolicy = createVoicePolicy({ minorInKey: true, ...options.voicePolicy });
  let bankToken = 0;
  const speak = (line: StormVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    let result: 'line' | 'placeholder' | null = null;
    voicePolicy.request(line, ctx.currentTime, () => { result = speakNow(line, when); return result !== null; });
    return result;
  };
  const speakNow = (line: StormVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime + VOICE_DELAY);
    const buffer = voiceLines.get(line) ?? null, placeholder = STORM_PLACEHOLDER[line];
    if (!buffer && !placeholder) return null;
    if (!buffer && placeholder && !sfx.has(placeholder)) return null;
    const decision = voiceDecision(speaking, line, at);
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

  const install = (id: StormScoreId, asset: RenderedAsset) => {
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
    service = options.service ? options.service() : new RenderService({ sampleRate: options.sampleRate, workerFactory: options.workerFactory, catalogs: { storm: STORM_SFX } });
    const svc = service;
    svc.trace = options.trace ?? null;
    const coreSfx = STORM_SFX.filter(s => s.core).map(s => s.id), extSfx = STORM_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = STORM_SFX.filter(s => !s.core && s.late).map(s => s.id);
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
    const scoreStep = (id: StormScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(STORM_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    // core: base theme and the base-game effects, rendered in parallel
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('storm', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    // extended (lazy, in the background): feature effects, ambience/idle/intro/feature theme, then the
    // celebration group (callouts, tier-ups, landings, heads and beds), two jobs at a time
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('storm', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      const queue: (() => Promise<void>)[] = [sfxStep('sfx-extended', extSfx), ...scores.slice(0, 5), sfxStep('sfx-celebration', lateSfx), ...scores.slice(5)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] storm render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds (same behaviour as Candy Cascade) ---------------- */

  const bedFor = (): StormScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as StormScoreId));
  const bedBuffer = (): { id: StormScoreId; buffer: AudioBuffer } | null => {
    const order: StormScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as StormScoreId[]).slice(4 - (tier || 1));
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
  const stopBed = (fade = 0.6) => {
    if (bed) { bed.stop(fade); bed = null; bedPlaying = null; engine.duckRelease(900); }
  };
  const scheduleBed = () => {
    const ctx = live(); if (!ctx || bed) return;
    startBed(Math.max(ctx.currentTime + 0.05, bigWinEndAt));
  };
  const celebrating = (): boolean => {
    if (!tier && !maxWinActive) return false;
    const ctx = engine.context;
    return counting || bed !== null || (!!ctx && ctx.currentTime < bigWinEndAt);
  };
  const registerBedScene = () => {
    const id = bedFor(), buffer = musicBuffer(id), asset = music.get(id)?.asset;
    if (buffer && asset) engine.registerScene('bigwin', { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
  };
  const tierLine = (t: WinTier | 'max') => STORM_TIER_VOICE[t];
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number, line: StormVoiceLine) => {
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 69); speak(line); return; }
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
    speak(tierLine(target), plan.hitAt + 0.3);
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
    if (!play('trigger')) fb()?.chimeRun(6, 74);
    lastTriggerAt = ctxNow();
    speak('feature-trigger');
  };

  /* ---------------- API ---------------- */

  const api: StormSound = {
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
    land: column => {
      const col = clamp(Math.round(column), 0, 11);
      if (!play('land', { rate: 2 ** (LAND_STEPS[col]! / 12), pan: (col - 2.5) / 6 })) fb()?.land(col);
    },
    symbolLand: () => { play('tick'); },
    winHighlight: multiplier => {
      const level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8) / 8;
      if (!play('win', { gain: 0.6 + 0.4 * level, rate: 1 + level * 0.06 })) fb()?.win(multiplier);
    },
    win: multiplier => api.winHighlight(multiplier),
    shatter: (count, payTier) => {
      const size = clamp(count, 1, 36), level = clamp(payTier, 0, 2);
      const id = level >= 2 || size >= 12 ? 'shatter-l' : level >= 1 || size >= 10 ? 'shatter-m' : 'shatter-s';
      if (!play(id, { gain: 0.85 + 0.15 * Math.min(1, size / 20) })) fb()?.pop(count, payTier);
    },
    pop: (count, payTier) => api.shatter(count, payTier),
    tumble: () => { play('tumble'); },
    orbLand: value => {
      if (!play('orb', { rate: 2 ** (orbSemitones(value) / 12) })) fb()?.crystal(value);
    },
    orbCollect: () => { if (!play('orb-fly')) fb()?.collect(); },
    orbArrive: value => {
      const level = clamp(Math.log2(Math.max(2, value)), 1, 9);
      if (!play('orb-arrive', { rate: 2 ** ((level - 1) * 0.5 / 12) })) play('orb', { rate: 2 ** (orbSemitones(value) / 12) });
    },
    lightningStrike: column => {
      const pan = column === undefined ? 0 : (clamp(Math.round(column), 0, 5) - 2.5) / 4;
      if (!play('lightning', { pan })) play('shatter-l', { pan });
    },
    totalMultiplier: total => {
      const level = clamp(Math.log2(Math.max(2, total)), 1, 9) / 9;
      if (!play('total-mult', { gain: 0.75 + 0.25 * level, rate: 1 - level * 0.04 })) { if (!play('shatter-l')) fb()?.win(total); }
      engine.duck(4 + level * 4, 500, 20, 500);
    },
    scatterLand: n => {
      const k = clamp(Math.round(n), 1, 6);
      if (!play(`scatter${k}`)) fb()?.scatter(n);
      if (k === 3) api.scatterTease(true);
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
    featureTrigger: () => { if (live()) triggerMoment(); },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return;
      if (ctx.currentTime - lastTriggerAt > TRIGGER_WINDOW) triggerMoment();
      tease?.stop(0.2); tease = null;
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) { pendingSceneAt = s.end; speak('feature-start', s.end - 0.1); } else fb()?.chimeRun(6, 74);
    },
    retrigger: () => {
      const s = stinger('retrigger', 'beat', 8, 300);
      if (!s && !play('total-mult')) fb()?.chimeRun(4, 74);
      speak('retrigger', s ? s.at + 0.25 : undefined);
    },
    featureOutro: () => {
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 69);
      featureEndLine();
    },
    totalWinFanfare: () => {
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 69);
      featureEndLine();
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      const action = tierAction(tier, t, isActive);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as StormScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2, tierLine(t));
    },
    maxWin: () => {
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      if (isActive && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12, tierLine('max'));
    },
    multiplierCallout: value => {
      const cls = stormMultiplierClass(value), rank = stormMultiplierRank(cls);
      const ctx = live(); if (!ctx) return;
      if (!play(`callout-${cls}`)) {
        const level = clamp(Math.log2(Math.max(2, value)), 1, 9) / 9;
        if (!play('total-mult', { gain: 0.75 + 0.25 * level })) fb()?.win(value);
      }
      engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
      speak(STORM_CLASS_VOICE[cls]);
    },
    laugh: () => { speak('laugh'); },
    nice: () => {
      const t = ctxNow();
      if (t - lastNiceAt < NICE_COOLDOWN) return;
      if (speak('nice')) lastNiceAt = t;
    },
    setVoicePolicy: p => { if (p && p.level !== undefined) voicePolicy.setLevel(p.level); if (p && p.fast !== undefined) voicePolicy.setFast(p.fast); },
    setVoiceBank: async urls => {
      const myBank = ++bankToken; voiceLines.clear();
      const loaded = await loadStormVoiceBank(stormVoiceBankUrls(urls), fetchVoice);
      const result = { loaded: [] as StormVoiceLine[], missing: [] as StormVoiceLine[] };
      if (disposed || myBank !== bankToken) return result;
      voiceLines.clear();
      for (const line of STORM_VOICE_LINES) { const buffer = loaded.get(line) ?? null; voiceLines.set(line, buffer); (buffer ? result.loaded : result.missing).push(line); }
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

/** Representative applied multiplier per callout class (lab, tests). */
export const STORM_CALLOUT_VALUES: Readonly<Record<StormMultiplierClass, number>> = Object.freeze({ x2: 5, x10: 12, x25: 30, x50: 60, x100: 150, x250: 300, x500: 500 });
