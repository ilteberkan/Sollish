/**
 * Asena: Yıldız Kurdu sound for the game. Same public shape as ebru-sound.ts / storm-sound.ts (resume / load / setMix /
 * setScene / duck / bigWin / maxWin / countUp / multiplierCallout / click / betChange / denied / autoplay / setVoiceBank …)
 * plus the Asena events, one per engine step (packages/protocol/src/asena.ts; the call order is the art layer's
 * ASENA_STEP_MAPPING in components/asena/art-lab.tsx):
 *   steps[0].grid drop-in      → dropIn(col) per landing column 0..5 (or symbolLand per cell)
 *   moons on the board         → moonLand(n) in landing order (the tease starts at 2), moonTease(false) when it ends
 *   steps[k].clusters          → clusterWin(symbol, size) per cluster (+ winHighlight(stepWin / bet))
 *   cluster.constellation      → constellation(templateId, { nodeAt: plan.nodeAt, durationMs: plan.duration, cols })
 *                                 (the trace, the ignition and the howl; returns when the howl starts)
 *   steps[k].map.unlocked[i]   → mapPiece(template, count)
 *   map.globalMultiplierAfter  → globalMultiplier(after) when it rose (×2 / ×3 / ×5: the iron mountain cracks)
 *   map.freeSpinsAwarded       → mapSpins(n)
 *   steps[k].burst             → starBurst(symbol, size) per cluster
 *   steps[k].fall              → fall()
 *   steps[k].wolfWalks[i]      → wolfWalk({ ms }) one after another
 *   3+ moons                   → featureTrigger(), freeSpinsIntro(), setScene('feature'); free spins: retrigger()
 *   end of feature             → totalWinFanfare() / featureOutro(), setScene('base'); big wins → bigWin(t) / maxWin() / countUp()
 *
 * All music and effects are original and rendered offline once (render.ts, the shared worker pool); playback is plain
 * buffer playback on the shared engine's buses. The constellation is assembled live from rendered layers: one star note
 * per lighting event of the art plan, pitched along the template's own motif (asena-tiers.ts constellationTrace), then
 * the template's ignition bloom and the synthesized howl. Presentation only: driven by already-resolved round steps, it
 * never feeds back into a result, payout or timing of the game.
 */
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render';
import { RenderService, type WorkerFactory } from './render-service';
import { ASENA_SCORES, type AsenaScoreId } from './scores/asena';
import { ASENA_SFX } from './sfx/asena';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import { CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DUCK_DB, VOICE_DELAY, planTierUp, tierAction, toWinTier, type MultiplierClass, type WinTier } from './win-tiers';
import {
  ASENA_CLASS_VOICE, ASENA_MOUNTAIN_VOICE, ASENA_PLACEHOLDER, ASENA_TEMPLATE_ORDER, ASENA_TEMPLATE_VOICE, ASENA_TIER_VOICE, ASENA_VOICE_LINES,
  asenaCalloutClass, asenaCalloutRank, asenaVoiceBankUrls, asenaVoiceDecision, burstSize, columnPan, columnSemitones, constellationTrace, loadAsenaVoiceBank,
  mountainLevel, pawTimes, pieceSemitones, symbolSemitones, type AsenaVoiceLine, type ConstellationTrace,
} from './asena-tiers';
import type { LoadProgress } from './cascade-sound';

export type { LoadProgress } from './cascade-sound';
export { loadMixSettings, saveMixSettings } from './cascade-sound';
export type { AsenaVoiceLine, ConstellationTrace } from './asena-tiers';
export type { WinTier } from './win-tiers';

export interface ConstellationOptions {
  /** Per-node lighting times (ms) of the art plan (components/asena/geometry.ts asenaConstellationPlan(...).nodeAt). */
  nodeAt?: readonly number[] | null;
  /** The plan's trace length (ms), default 1400. */
  durationMs?: number;
  /** Board columns of the plan's nodes (same order as nodeAt), for left/right placement. */
  cols?: readonly number[] | null;
  /** Start on the audio clock (default: now). */
  when?: number;
  /** Play the howl at the end (default true). */
  howl?: boolean;
  /** Say the template's name if a recorded line exists (default true). */
  voice?: boolean;
}
export interface ConstellationResult { seconds: number; howlAt: number; trace: ConstellationTrace }

export interface AsenaSound {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  /** Render the bank. Resolves when the core (base theme + base-game effects incl. the constellation layers) is ready; the rest follows in the background. */
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  /** Resolves when everything (feature theme, stingers, celebration effects) is rendered. */
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;

  spinStart: () => void;
  /** A column lands (0..5): a star tick stepped up the pentatonic B D E G A B left → right. */
  dropIn: (column: number) => void;
  land: (column: number) => void;
  /** One cell settles (very light tick). */
  symbolLand: () => void;
  /** A cluster is highlighted: a kopuz strum (symbol h1..l4 tilts the pitch). */
  clusterWin: (symbol: string, size: number) => void;
  winHighlight: (multiplier: number) => void;
  win: (multiplier: number) => void;
  /** A cluster bursts into stars: pitched by its symbol (h1 highest), sized by its cell count. */
  starBurst: (symbol: string, size: number) => void;
  /** Tarhun-style aliases: count = cells, tier 0..2 (symbol unknown). */
  shatter: (count: number, tier: number) => void;
  pop: (count: number, tier: number) => void;
  fall: () => void;
  tumble: () => void;
  /** The signature moment: the constellation traced star by star (template motif), its ignition and the wolf's howl. */
  constellation: (templateId: string, opts?: ConstellationOptions) => ConstellationResult | null;
  /** The howl alone (big win sky gate): power ≥ 1.2 uses the great howl. */
  howl: (power?: number) => void;
  /** One walking wolf: a four-step trot over `ms` (default 640) and the star trail it leaves. */
  wolfWalk: (opts?: { ms?: number; when?: number }) => void;
  /** n-th moon (Ay Ata scatter) of the spin (1..6), ascending; the tease starts at 2 (3 trigger). */
  moonLand: (n: number) => void;
  scatterLand: (n: number) => void;
  scatter: (n: number) => void;
  moonTease: (on: boolean) => void;
  scatterTease: (on: boolean) => void;
  /** An Ergenekon map piece (template index 0..5, count 1..2) unlocks: the star flies to the sky map. */
  mapPiece: (template: number, count?: number) => void;
  /** The global multiplier rose to `value` (2, 3 or 5): the iron mountain cracks, wider each time. */
  globalMultiplier: (value: number) => void;
  /** +n spins from the map. */
  mapSpins: (n: number) => void;
  featureTrigger: () => void;
  freeSpinsIntro: () => void;
  /** +3 spins during the feature. */
  retrigger: () => void;
  featureOutro: () => void;
  totalWinFanfare: () => void;
  bigWin: (tier: 1 | 2 | 3 | 4) => void;
  maxWin: () => void;
  countUp: (start: boolean) => void;
  /** Multiplier callout by class (<10, ≥10, ≥25, ≥50, ≥100, ≥250) with its voice line. */
  multiplierCallout: (value: number) => void;
  /** "Güzel!" for a medium win; at most once every 20 s. */
  nice: () => void;
  click: () => void;
  betChange: (direction?: 1 | -1) => void;
  denied: () => void;
  autoplay: (on: boolean) => void;
  /** Recorded voice lines: a folder (`/audio/voice/asena` → `/audio/voice/asena/x100.mp3` …) or a URL per line. Missing files are skipped silently. */
  setVoiceBank: (urls: string | Partial<Record<AsenaVoiceLine, string | null>>) => Promise<{ loaded: AsenaVoiceLine[]; missing: AsenaVoiceLine[] }>;
  readonly voiceLines: Map<AsenaVoiceLine, AudioBuffer | null>;
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  playStinger: (id: AsenaScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => {
    core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null;
    celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null };
    voice: { speaking: AsenaVoiceLine | null; loaded: number };
  };
  dispose: () => void;
}

type Stinger = 'fsIntro' | 'retrigger' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: AsenaScoreId[] = ['base'];
const EXTENDED_SCORES: AsenaScoreId[] = ['ambience', 'idle', 'fsIntro', 'feature', 'retrigger', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
const SCENE_OF: Partial<Record<AsenaScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };
/** Count-up tick pitch per tier key (melodic material above G# sits lower, as in the scores). */
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);

/** Minimum spacing (s) and simultaneous voice cap per effect, so rapid events never stack up. */
const LIMITS: Record<string, [number, number]> = {
  land: [0.03, 6], tick: [0.025, 6], coin: [0.055, 3], 'burst-s': [0.04, 5], 'burst-m': [0.05, 4], 'burst-l': [0.06, 3], win: [0.07, 3],
  fall: [0.05, 3], spin: [0.08, 2], click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2], paw: [0.04, 6], trail: [0.06, 4], piece: [0.08, 4],
  'node-lo': [0, 12], node: [0, 12], 'node-hi': [0, 12], howl: [0.3, 2], 'howl-great': [0.5, 1],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1], 'callout-x250': [0.3, 1],
  'vo-breath': [0.3, 1], 'vo-call': [0.3, 1], 'vo-joy': [0.3, 1],
};
const NICE_COOLDOWN = 20;
const WOLF_LINE_COOLDOWN = 30;
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
export type AsenaRenderService = Pick<RenderService, 'score' | 'sfx' | 'prefetch' | 'dispose' | 'parallelism' | 'workerJobs' | 'failure' | 'trace'>;

export function createAsenaSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; service?: () => AsenaRenderService } = {}): AsenaSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<AsenaScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: AsenaRenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: AsenaScoreId | null = null;
  const voiceLines = new Map<AsenaVoiceLine, AudioBuffer | null>();
  let voiceDecoder: BaseAudioContext | null = null;
  let speaking: { line: AsenaVoiceLine; from: number; until: number } | null = null, speakingHandle: VoiceHandle | null = null;
  let lastNiceAt = -Infinity, lastFeatureEndAt = -Infinity, lastTriggerAt = -Infinity, lastWolfLineAt = -Infinity;
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
  const musicBuffer = (id: AsenaScoreId): AudioBuffer | null => {
    const m = music.get(id); if (!m) return null;
    if (!m.buffer) m.buffer = toAudioBuffer(m.asset.l, m.asset.r, m.asset.sampleRate, engine.context);
    return m.buffer;
  };

  type PlayOpts = { rate?: number; gain?: number; pan?: number; when?: number; offset?: number; force?: boolean };
  /** Start a rendered effect with variation and micro-variation. 'silent' = muted / rate-limited; null = not rendered yet. `force` skips the spacing rule (scheduled sequences). */
  const start = (id: string, opts: PlayOpts = {}): { handle: VoiceHandle | null; duration: number } | 'silent' | null => {
    const ctx = live(); if (!ctx) return 'silent';
    const list = sfx.get(id); if (!list || !list.length) return null;
    const def = ASENA_SFX.find(s => s.id === id);
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
    const rate = (opts.rate ?? 1) * mv.rate;
    const handle = engine.playBuffer('sfx', buffer, { rate, gain: (opts.gain ?? 1) * mv.gain, pan: opts.pan, when: opts.when, offset: opts.offset });
    if (handle) voices.push(handle);
    active.set(id, voices);
    return { handle, duration: buffer.duration / rate };
  };
  const play = (id: string, opts: PlayOpts = {}): boolean => start(id, opts) !== null;

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

  const speak = (line: AsenaVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime + VOICE_DELAY);
    const buffer = voiceLines.get(line) ?? null, placeholder = ASENA_PLACEHOLDER[line];
    if (!buffer && !placeholder) return null;
    if (!buffer && placeholder && !sfx.has(placeholder)) return null;
    const decision = asenaVoiceDecision(speaking, line, at);
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

  const install = (id: AsenaScoreId, asset: RenderedAsset) => {
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
    const coreSfx = ASENA_SFX.filter(s => s.core).map(s => s.id), extSfx = ASENA_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = ASENA_SFX.filter(s => !s.core && s.late).map(s => s.id);
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
    const scoreStep = (id: AsenaScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(ASENA_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    // core: base theme and the base-game effects (the constellation layers and the howl included), rendered in parallel
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('asena', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    // extended (lazy, in the background): feature effects, ambience/idle/intro/feature theme, then the celebration
    // group (callouts, tier-ups, landings, heads and beds), two jobs at a time
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('asena', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      const queue: (() => Promise<void>)[] = [sfxStep('sfx-extended', extSfx), ...scores.slice(0, 5), sfxStep('sfx-celebration', lateSfx), ...scores.slice(5)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] asena render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds (same behaviour as Ebru / Tarhun) ---------------- */

  const bedFor = (): AsenaScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as AsenaScoreId));
  const bedBuffer = (): { id: AsenaScoreId; buffer: AudioBuffer } | null => {
    const order: AsenaScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as AsenaScoreId[]).slice(4 - (tier || 1));
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
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number, line: AsenaVoiceLine) => {
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 64); speak(line); return; }
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
    speak(ASENA_TIER_VOICE[target], plan.hitAt + 0.3);
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
    if (!play('trigger')) fb()?.chimeRun(8, 71);
    lastTriggerAt = ctxNow();
    speak('feature-trigger', ctxNow() + 0.9);
  };
  const burst = (symbol: string | undefined, size: number) => {
    const id = `burst-${burstSize(size)}`;
    const opts = { rate: 2 ** (symbolSemitones(symbol) / 12), gain: 0.85 + 0.15 * Math.min(1, size / 20) };
    if (!play(id, opts) && !(id === 'burst-l' && play('burst-m', opts))) fb()?.pop(size, size >= 12 ? 2 : size >= 8 ? 1 : 0);
  };

  /* ---------------- API ---------------- */

  const api: AsenaSound = {
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
    dropIn: column => {
      const col = clamp(Math.round(column), 0, 5);
      if (!play('land', { rate: 2 ** (columnSemitones(col) / 12), pan: columnPan(col) })) fb()?.land(col);
    },
    land: column => api.dropIn(column),
    symbolLand: () => { play('tick'); },
    clusterWin: (symbol, size) => {
      const level = clamp(Number(size) / 18, 0, 1);
      if (!play('win', { rate: 2 ** (symbolSemitones(symbol) / 24), gain: 0.65 + 0.35 * level })) fb()?.win(size);
    },
    winHighlight: multiplier => {
      const level = clamp(Math.log2(Math.max(1, multiplier)), 0, 8) / 8;
      if (!play('win', { gain: 0.6 + 0.4 * level, rate: 1 + level * 0.06 })) fb()?.win(multiplier);
    },
    win: multiplier => api.winHighlight(multiplier),
    starBurst: (symbol, size) => burst(symbol, clamp(Number(size), 1, 36)),
    shatter: (count, payTier) => { const lvl = clamp(payTier, 0, 2); burst(undefined, Math.max(clamp(count, 1, 36), lvl >= 2 ? 12 : lvl >= 1 ? 8 : 5)); },
    pop: (count, payTier) => api.shatter(count, payTier),
    fall: () => { play('fall'); },
    tumble: () => api.fall(),
    constellation: (templateId, opts = {}) => {
      const ctx = live();
      const trace = constellationTrace(templateId, opts.nodeAt, opts.durationMs, opts.cols);
      if (!ctx) return null;
      const t0 = Math.max(ctx.currentTime + 0.01, opts.when ?? ctx.currentTime + 0.01);
      if (!sfx.has('node')) { fb()?.chimeRun(trace.events.length + 2, 64); return { seconds: trace.seconds, howlAt: t0 - ctx.currentTime + trace.howlAt, trace }; }
      for (const ev of trace.events) for (const n of ev.notes) play(n.clip, { when: t0 + ev.at, rate: n.rate, gain: n.gain, pan: n.pan, force: true });
      play(`ignite-${trace.templateId}`, { when: t0 + trace.igniteAt - 0.02, force: true });
      if (opts.howl !== false) {
        const great = trace.templateId === 'kurt-basi' && sfx.has('howl-great');
        play(great ? 'howl-great' : 'howl', { when: t0 + trace.howlAt, rate: trace.howlRate, force: true });
      }
      engine.duck(3 + trace.multiplier * 0.3, (trace.howlAt + 1.6) * 1000, 120, 900);
      if (opts.voice !== false) speak(ASENA_TEMPLATE_VOICE[trace.templateId], t0 + trace.igniteAt + 0.05);
      return { seconds: trace.seconds, howlAt: t0 - ctx.currentTime + trace.howlAt, trace };
    },
    howl: (power = 1) => {
      const great = power >= 1.2 && sfx.has('howl-great');
      if (!play(great ? 'howl-great' : 'howl', { gain: clamp(0.7 + 0.3 * power, 0.5, 1.2) })) fb()?.chimeRun(4, 71);
    },
    wolfWalk: (opts = {}) => {
      const ctx = live(); if (!ctx) return;
      const t0 = Math.max(ctx.currentTime + 0.01, opts.when ?? ctx.currentTime + 0.01);
      const times = pawTimes(opts.ms ?? 640);
      times.forEach((t, i) => play('paw', { when: t0 + t, gain: 0.8 + 0.06 * i, pan: (i % 2 ? 0.12 : -0.12), force: true }));
      play('trail', { when: t0 + times[1]!, force: true });
      if (ctx.currentTime - lastWolfLineAt > WOLF_LINE_COOLDOWN && speak('wolf-guides', t0 + 0.3)) lastWolfLineAt = ctx.currentTime;
    },
    moonLand: n => {
      const k = clamp(Math.round(n), 1, 6);
      if (!play(`moon${k}`)) fb()?.scatter(n);
      if (k === 2) api.moonTease(true);
    },
    scatterLand: n => api.moonLand(n),
    scatter: n => api.moonLand(n),
    moonTease: on => {
      const ctx = live();
      if (!on || !ctx) { tease?.stop(0.18); tease = null; return; }
      if (tease) return;
      const list = sfx.get('tease'); if (!list?.length) return;
      const buffer = sfxBuffer('tease', Math.floor(random() * list.length));
      if (buffer) { tease = engine.playBuffer('sfx', buffer, { fadeIn: 0.05 }); engine.duck(6, buffer.duration * 1000, 200, 400); speak('moon-tease', ctx.currentTime + 0.4); }
    },
    scatterTease: on => api.moonTease(on),
    mapPiece: (template, count = 1) => {
      if (!play('piece', { rate: 2 ** (pieceSemitones(template, count) / 12) })) fb()?.crystal(template + 2);
    },
    globalMultiplier: value => {
      const level = mountainLevel(value);
      if (!level) return;
      if (!play(`mount-${level}`) && !play('callout-x10')) fb()?.win(value * 10);
      engine.duck(5 + level * 2, 900 + level * 500, 30, 700);
      speak(ASENA_MOUNTAIN_VOICE[level], (ctxNow() || 0) + 0.45);
    },
    mapSpins: n => {
      if (!(n > 0)) return;
      if (!play('spins-plus')) fb()?.chimeRun(4, 71);
      speak('map-spins', ctxNow() + 0.2);
    },
    featureTrigger: () => { if (live()) { tease?.stop(0.2); tease = null; triggerMoment(); } },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return;
      if (ctx.currentTime - lastTriggerAt > TRIGGER_WINDOW) triggerMoment();
      tease?.stop(0.2); tease = null;
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) { pendingSceneAt = s.end; speak('feature-start', s.end - 0.1); } else fb()?.chimeRun(6, 71);
    },
    retrigger: () => {
      const s = stinger('retrigger', 'beat', 8, 300);
      if (!s && !play('moon6')) fb()?.chimeRun(4, 71);
      speak('retrigger', s ? s.at + 0.25 : undefined);
    },
    featureOutro: () => {
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 64);
      featureEndLine();
    },
    totalWinFanfare: () => {
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 64);
      featureEndLine();
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      const action = tierAction(tier, t, isActive);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as AsenaScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2, ASENA_TIER_VOICE[t]);
    },
    maxWin: () => {
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      if (isActive && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12, ASENA_TIER_VOICE.max);
    },
    multiplierCallout: value => {
      const cls: MultiplierClass = asenaCalloutClass(value), rank = asenaCalloutRank(cls);
      const ctx = live(); if (!ctx) return;
      if (!play(`callout-${cls}`)) { if (!play('win', { rate: 1.12 })) fb()?.win(value); }
      engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
      speak(ASENA_CLASS_VOICE[cls]);
    },
    nice: () => {
      const t = ctxNow();
      if (t - lastNiceAt < NICE_COOLDOWN) return;
      if (speak('nice')) lastNiceAt = t;
    },
    setVoiceBank: async urls => {
      const loaded = await loadAsenaVoiceBank(asenaVoiceBankUrls(urls), fetchVoice);
      const result = { loaded: [] as AsenaVoiceLine[], missing: [] as AsenaVoiceLine[] };
      if (disposed) return result;
      voiceLines.clear();
      for (const line of ASENA_VOICE_LINES) { const buffer = loaded.get(line) ?? null; voiceLines.set(line, buffer); (buffer ? result.loaded : result.missing).push(line); }
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

/** Representative value per callout class (lab, tests). */
export const ASENA_CALLOUT_VALUES: Readonly<Record<MultiplierClass, number>> = Object.freeze({ x2: 4, x10: 12, x25: 30, x50: 64, x100: 128, x250: 256 });
/** Template order (index = engine template index), re-exported for the lab. */
export const ASENA_TEMPLATES_AUDIO = ASENA_TEMPLATE_ORDER;
