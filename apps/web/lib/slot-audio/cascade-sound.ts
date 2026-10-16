/**
 * Candy Cascade sound for the game: a superset of the original `CascadeAudio` interface.
 *
 * All music and effects are original and rendered offline once (see render.ts); playback is plain
 * buffer playback on the engine's buses. Presentation only: driven by already-resolved round steps,
 * it never feeds back into a result, payout or timing of the game.
 *
 * Typical wiring:
 *   sound.load()                         – any time (renders in the background, ~core first)
 *   sound.resume() / setEnabled(true)    – from the sound button (user gesture)
 *   setScene('idle' | 'base')            – lobby / playing
 *   freeSpinsIntro(); setScene('feature') – the feature theme enters on the fanfare's musical end
 *   bigWin(tier); countUp(true) … bigWin(higher tier) … countUp(false)   – tiers climb with a whoosh + hit
 *   multiplierCallout(value)             – applied multipliers (optional voice lines: setVoiceBank)
 *   totalWinFanfare(); featureOutro(); setScene('base')
 */
import { createVoicePolicy, type VoiceLevel, type VoicePolicyOptions } from './voice-policy';
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render';
import { RenderService, type WorkerFactory } from './render-service';
import { CASCADE_SCORES, type CascadeScoreId } from './scores/cascade';
import { CASCADE_SFX } from './sfx/cascade';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import {
  CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DELAY, VOICE_DUCK_DB, loadVoiceBank, multiplierClass, multiplierRank, planTierUp, tierAction, toWinTier, voiceBankUrls,
  type MultiplierClass, type WinTier,
} from './win-tiers';

export type { MultiplierClass, WinTier } from './win-tiers';

/** The original interface, kept so existing callers work unchanged. */
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
  /** Tier 1 Büyük ≥10×, 2 Mega ≥25×, 3 Süper ≥50×, 4 Efsane ≥100× (older callers pass 1..3). */
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  dispose: () => void;
};

export interface LoadProgress { phase: 'core' | 'extended' | 'done'; done: number; total: number; label: string; ms: number }

export interface CascadeSound extends CascadeAudio {
  /** Render the bank. Resolves when the core (base, idle, ambience, core effects) is ready; the rest follows lazily. */
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  /** Resolves when everything (feature theme, stingers) is rendered. */
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;
  countUp: (start: boolean) => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  tumble: () => void;
  symbolLand: () => void;
  crystalArrive: (value: number) => void;
  multiplierApply: (total: number) => void;
  scatterTease: (on: boolean) => void;
  featureOutro: () => void;
  /** The ultimate celebration; during a running celebration it climbs into it with a tier-up transition. */
  maxWin: () => void;
  /** Applied-multiplier announcer callout, escalating by class (<10×, ≥10×, ≥25×, ≥50×, ≥100×, ≥250×). */
  multiplierCallout: (value: number) => void;
  /** End-of-feature total-win screen fanfare (~3 s); a following setScene() enters on its musical end. */
  totalWinFanfare: () => void;
  /**
   * Optional recorded voice line per callout class, layered over the callout with the music ducked.
   * A folder (`/audio/voice/cascade` → `/audio/voice/cascade/x100.mp3`) or a URL per class; missing or
   * undecodable files are skipped silently. Resolves with what loaded; never rejects.
   */
  setVoiceBank: (urls: string | Partial<Record<MultiplierClass, string | null>>) => Promise<{ loaded: MultiplierClass[]; missing: MultiplierClass[] }>;
  /** Decoded voice lines per class (null = none; the non-verbal callout plays alone). */
  readonly voiceLines: Map<MultiplierClass, AudioBuffer | null>;
  /** Voice level (Full / Key moments / Off) and "fast" (turbo or autoplay: callout lines are not spoken). */
  setVoicePolicy: (p: { level?: VoiceLevel; fast?: boolean }) => void;
  autoplay: (on: boolean) => void;
  /** Lab/diagnostics: play any rendered effect by id. */
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  /** Lab/diagnostics: play any stinger by score id. */
  playStinger: (id: CascadeScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => { core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null; celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null } };
}

const MIX_KEY = 'sollish.audio.mix.v1';
/** Read the saved mix (sliders + mute) from localStorage; safe everywhere. */
export function loadMixSettings(): Partial<MixSettings> | null {
  try { const raw = globalThis.localStorage?.getItem(MIX_KEY); return raw ? (JSON.parse(raw) as Partial<MixSettings>) : null; } catch { return null; }
}
export function saveMixSettings(mix: MixSettings): void {
  try { globalThis.localStorage?.setItem(MIX_KEY, JSON.stringify(mix)); } catch { /* storage blocked */ }
}

type Stinger = 'fsIntro' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: CascadeScoreId[] = ['base'];
const EXTENDED_SCORES: CascadeScoreId[] = ['ambience', 'idle', 'fsIntro', 'feature', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
/** Melodic material above A major sits an octave lower (see scores): same rule for the count-up ticks. */
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);
const SCENE_OF: Partial<Record<CascadeScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };

/** Minimum spacing (s) and simultaneous voice cap per effect, to keep rapid events from stacking up. */
const LIMITS: Record<string, [number, number]> = {
  land: [0.03, 6], tick: [0.025, 6], coin: [0.055, 3], 'pop-s': [0.04, 5], 'pop-m': [0.05, 4], 'pop-l': [0.06, 3], shimmer: [0.07, 3],
  click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2], crystal: [0.04, 4], tumble: [0.05, 3], spin: [0.08, 2], multiplier: [0.1, 2],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1], 'callout-x250': [0.3, 1],
};

function toAudioBuffer(l: Float32Array, r: Float32Array, sampleRate: number, ctx: BaseAudioContext | null): AudioBuffer | null {
  try {
    const Ctor = (globalThis as unknown as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
    const b = Ctor ? new Ctor({ length: l.length, numberOfChannels: 2, sampleRate }) : ctx ? ctx.createBuffer(2, l.length, sampleRate) : null;
    if (!b) return null;
    b.copyToChannel(l as Float32Array<ArrayBuffer>, 0); b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return b;
  } catch { return null; }
}

export function createCascadeSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; voicePolicy?: VoicePolicyOptions } = {}): CascadeSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<CascadeScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: RenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  // celebration: tier reached, max win, the playing head stinger and bed, and the 120 BPM grid they share
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: CascadeScoreId | null = null, bedTimer: ReturnType<typeof setTimeout> | null = null;
  const voiceLines = new Map<MultiplierClass, AudioBuffer | null>();
  const voicePolicy = createVoicePolicy(options.voicePolicy);
  let bankToken = 0;
  let voiceDecoder: BaseAudioContext | null = null;
  let counting = false, countTimer: ReturnType<typeof setInterval> | null = null, countNext = 0, countStart = 0;
  const progressListeners = new Set<(p: LoadProgress) => void>();
  engine.setMix({ muted: true }); // silent until setEnabled(true), like the original

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
  const musicBuffer = (id: CascadeScoreId): AudioBuffer | null => {
    const m = music.get(id); if (!m) return null;
    if (!m.buffer) m.buffer = toAudioBuffer(m.asset.l, m.asset.r, m.asset.sampleRate, engine.context);
    return m.buffer;
  };

  /** Play a rendered effect with variation and micro-variation; false when not rendered yet. */
  const play = (id: string, opts: { rate?: number; gain?: number; pan?: number; when?: number; offset?: number } = {}): boolean => {
    const ctx = live(); if (!ctx) return true; // silent on purpose (muted / no audio): nothing to fall back to
    const list = sfx.get(id); if (!list || !list.length) return false;
    const def = CASCADE_SFX.find(s => s.id === id);
    const [minGap, cap] = LIMITS[id] ?? [0.02, 4];
    const t = ctx.currentTime;
    if (t - (last.get(id) ?? -1) < minGap) return true;
    last.set(id, t);
    const v = pickVariation(list.length, lastVar.get(id) ?? -1, random); lastVar.set(id, v);
    const buffer = sfxBuffer(id, v); if (!buffer) return false;
    const jitter = def?.jitter ?? [20, 1];
    const mv = microVariation(random, jitter[0], jitter[1]);
    const voices = (active.get(id) ?? []).filter(h => h.startTime + buffer.duration > t);
    while (voices.length >= cap) voices.shift()?.stop(0.03);
    const handle = engine.playBuffer('sfx', buffer, { rate: (opts.rate ?? 1) * mv.rate, gain: (opts.gain ?? 1) * mv.gain, pan: opts.pan, when: opts.when, offset: opts.offset });
    if (handle) voices.push(handle);
    active.set(id, voices);
    return true;
  };

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

  const report = (p: LoadProgress) => { for (const l of progressListeners) { try { l(p); } catch { /* listener error */ } } };

  const install = (id: CascadeScoreId, asset: RenderedAsset) => {
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
    service = new RenderService({ sampleRate: options.sampleRate, workerFactory: options.workerFactory });
    const svc = service;
    svc.trace = options.trace ?? null;
    const coreSfx = CASCADE_SFX.filter(s => s.core).map(s => s.id), extSfx = CASCADE_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = CASCADE_SFX.filter(s => !s.core && s.late).map(s => s.id);
    const total = 3 + CORE_SCORES.length + EXTENDED_SCORES.length;
    let done = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ms = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const step = async (label: string, phase: LoadProgress['phase'], job: () => Promise<void>) => {
      const s = ms();
      await job();
      if (disposed) return;
      renderMs[label] = Math.round(ms() - s);
      done++;
      report({ phase, done, total, label, ms: ms() });
    };
    const scoreStep = (id: CascadeScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(CASCADE_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    // core: base theme, ambience and the base-game effects, rendered in parallel
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('cascade', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    // extended: feature theme, stingers and feature effects, two at a time so memory stays bounded
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('cascade', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      // celebration effects (tier-ups, landings, callouts) after the feature theme: until then the older
      // multiplier and ding effects (or the live fallback) answer
      const queue: (() => Promise<void>)[] = [sfxStep('sfx-extended', extSfx), ...scores.slice(0, 4), sfxStep('sfx-celebration', lateSfx), ...scores.slice(4)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds ---------------- */

  const bedFor = (): CascadeScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as CascadeScoreId));
  /** The tier's bed, or the nearest lower one already rendered. */
  const bedBuffer = (): { id: CascadeScoreId; buffer: AudioBuffer } | null => {
    const order: CascadeScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as CascadeScoreId[]).slice(4 - (tier || 1));
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
    if (bedTimer) { clearTimeout(bedTimer); bedTimer = null; }
    if (bed) { bed.stop(fade); bed = null; bedPlaying = null; engine.duckRelease(900); }
  };
  const scheduleBed = () => {
    const ctx = live(); if (!ctx || bed) return;
    startBed(Math.max(ctx.currentTime + 0.05, bigWinEndAt));
  };
  /** A celebration is running: counting, a bed playing, or a head stinger still sounding. */
  const celebrating = (): boolean => {
    if (!tier && !maxWinActive) return false;
    const ctx = engine.context;
    return counting || bed !== null || (!!ctx && ctx.currentTime < bigWinEndAt);
  };
  const registerBedScene = () => {
    const id = bedFor(), buffer = musicBuffer(id), asset = music.get(id)?.asset;
    if (buffer && asset) engine.registerScene('bigwin', { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
  };
  /** Fresh celebration: the head stinger on the scene's beat, then (while counting) the bed on its musical end. */
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number) => {
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 72); return; }
    head = s.handle; gridStart = s.at; bigWinEndAt = s.end;
    registerBedScene();
    if (counting) scheduleBed();
  };
  /**
   * Tier-up: whoosh + hit on the next beat of the celebration grid; the old head and bed end on the hit.
   * While counting, the new tier's bed starts on the hit; otherwise (and always for max win) the new head
   * stinger plays from the hit and a bed follows on its musical end if a count-up is running.
   */
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
  };
  const tickLoop = () => {
    const ctx = live(); if (!ctx || !counting) return;
    const horizon = ctx.currentTime + 0.12;
    while (countNext < horizon) {
      const elapsed = Math.max(0, countNext - countStart);
      // climbs about 7 semitones over 6 s, from the tonic of the current tier's key
      const rate = Math.min(1.5, 1 + elapsed * 0.07) * tickShift(maxWinActive ? TIER_KEY.max : TIER_KEY[tier || 1]);
      play('coin', { when: countNext, rate, gain: 0.9 });
      last.delete('coin'); // the scheduler spaces ticks itself
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

  /* ---------------- API ---------------- */

  const api: CascadeSound = {
    engine,
    load: onProgress => { if (onProgress) progressListeners.add(onProgress); return startLoad(); },
    loaded: async () => { await startLoad(); await extended; },
    voiceLines,
    status: () => ({
      core: coreReady, extended: extendedReady, rendered: [...music.keys(), ...sfx.keys()], renderMs: { ...renderMs }, workers: service?.parallelism ?? 0, workerJobs: service?.workerJobs ?? 0, workerFailure: service?.failure ?? null,
      celebration: { tier, max: maxWinActive, counting, bed: bedPlaying },
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
      if (!on) { counting = false; stopBed(0.1); head?.stop(0.1); endCelebration(); tease?.stop(0.1); tease = null; }
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
      // each column a step of F major pentatonic around the thud's own pitch: D E F G A C (then up an octave)
      const semis = [-3, -1, 0, 2, 4, 7, 9, 11, 12, 14, 16, 19][col]!;
      if (!play('land', { rate: 2 ** (semis / 12), pan: (col - 2.5) / 6 })) fb()?.land(col);
    },
    symbolLand: () => { play('tick'); },
    pop: (count, tier) => {
      const size = clamp(count, 1, 30), level = clamp(tier, 0, 2);
      const id = level >= 2 || size >= 12 ? 'pop-l' : level >= 1 || size >= 10 ? 'pop-m' : 'pop-s';
      if (!play(id, { gain: 0.85 + 0.15 * Math.min(1, size / 20) })) fb()?.pop(count, tier);
    },
    win: multiplier => {
      const level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8) / 8;
      if (!play('shimmer', { gain: 0.6 + 0.4 * level, rate: 1 + level * 0.06 })) fb()?.win(multiplier);
    },
    crystal: value => {
      const level = clamp(Math.log2(Math.max(2, value)), 1, 7);
      if (!play('crystal', { rate: 2 ** ((level - 1) * 0.5 / 12) })) fb()?.crystal(value);
    },
    crystalArrive: value => {
      const level = clamp(Math.log2(Math.max(2, value)), 1, 7);
      if (!play('crystal-arrive', { rate: 2 ** ((level - 1) / 12) })) fb()?.crystal(value);
    },
    collect: () => { if (!play('crystal-fly')) fb()?.collect(); },
    scatter: n => { const k = clamp(Math.round(n), 1, 6); if (!play(`scatter${k}`)) fb()?.scatter(n); },
    scatterTease: on => {
      const ctx = live();
      if (!on || !ctx) { tease?.stop(0.18); tease = null; return; }
      if (tease) return;
      const list = sfx.get('tease'); if (!list?.length) return;
      const buffer = sfxBuffer('tease', Math.floor(random() * list.length));
      if (buffer) { tease = engine.playBuffer('sfx', buffer, { fadeIn: 0.05 }); engine.duck(6, buffer.duration * 1000, 200, 400); }
    },
    freeSpinsIntro: () => {
      play('trigger');
      // short release: the feature theme enters on the fanfare's musical end at full level
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(6, 74);
    },
    featureOutro: () => {
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 77);
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const active = celebrating();
      if (maxWinActive && active) return; // max win is above every tier
      const action = tierAction(tier, t, active);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as CascadeScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2);
    },
    maxWin: () => {
      const active = celebrating();
      if (maxWinActive && active) return;
      if (active && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12);
    },
    multiplierCallout: value => {
      const cls = multiplierClass(value), rank = multiplierRank(cls);
      const ctx = live(); if (!ctx) return;
      if (!play(`callout-${cls}`)) {
        const level = clamp(Math.log2(Math.max(2, value)), 1, 9) / 9;
        if (!play('multiplier', { gain: 0.75 + 0.25 * level })) fb()?.win(value);
      }
      engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
      const voice = voiceLines.get(cls);
      if (voice) {
        voicePolicy.request(cls, ctx.currentTime, () => {
          const at = ctx.currentTime + VOICE_DELAY;
          engine.playBuffer('sfx', voice, { when: at });
          engine.duckMusicBus(VOICE_DUCK_DB, voice.duration, at - 0.04);
          return true;
        });
      }
    },
    totalWinFanfare: () => {
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 77);
    },
    setVoicePolicy: p => { if (p && p.level !== undefined) voicePolicy.setLevel(p.level); if (p && p.fast !== undefined) voicePolicy.setFast(p.fast); },
    setVoiceBank: async urls => {
      const myBank = ++bankToken; voiceLines.clear();
      const loaded = await loadVoiceBank(voiceBankUrls(urls), fetchVoice);
      const result = { loaded: [] as MultiplierClass[], missing: [] as MultiplierClass[] };
      if (disposed || myBank !== bankToken) return result;
      voiceLines.clear();
      for (const [cls, buffer] of loaded) { voiceLines.set(cls, buffer); (buffer ? result.loaded : result.missing).push(cls); }
      return result;
    },
    countUp: start => {
      const ctx = live();
      if (start) {
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
          // the landing: a tonic hit in the tier's key; the bed and any unfinished head clear out under it
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
    multiplierApply: total => {
      const level = clamp(Math.log2(Math.max(2, total)), 1, 9) / 9;
      if (!play('multiplier', { gain: 0.75 + 0.25 * level, rate: 1 - level * 0.05 })) fb()?.win(total);
      else if (total >= 10) play('shimmer', { gain: 0.6, rate: 1.05 });
      engine.duck(4 + level * 4, 500, 20, 500);
    },
    tumble: () => { play('tumble'); },
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
      if (bedTimer) clearTimeout(bedTimer);
      progressListeners.clear();
      engine.dispose();
      service?.dispose();
      sfx.clear(); music.clear(); active.clear(); voiceLines.clear();
    },
  };
  return api;
}
