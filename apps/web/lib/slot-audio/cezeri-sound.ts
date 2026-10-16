/**
 * Cezeri: Zamanın Çarkları sound for the game. Same public shape as ebru-sound.ts / storm-sound.ts (resume / load / setMix /
 * setScene / duck / bigWin / maxWin / countUp / multiplierCallout / click / betChange / denied / autoplay / setVoiceBank …)
 * plus the Cezeri events, one per engine step (packages/protocol/src/cezeri.ts):
 *   hub (round 0)      → hubReveal(value)                      rotate        → rotate(4 × { ring, distance, ms, held: held.length }) or ringRotate ×4
 *   win                → spokeWin(spoke, length, symbol, …)    lock          → gearLock(newHeld.length, { respin })
 *   hub (respin k)     → hubTick(value, k)                     rotate (k>0)  → respin(k) + rotate(rings)
 *   end                → chainEnd({ respins, capped: chainCapped, heldSlices })   scatter → vesselLand(n) per vessel, featureTrigger()
 *   falcon             → falconDrop(ring, slices.length)       per free spin → reservoirFill(level); falconFlight() before the drop
 *
 * All music and effects are original and rendered offline once (render.ts, the shared worker pool); playback is plain
 * buffer playback on the shared engine's buses. A turning ring and a spoke beam are assembled live from rendered layers
 * (cezeri-tiers.ts ratchetPlan / beamPlan); the Dişli Kilidi chain layers two looped tension beds behind a low-pass that
 * opens with every respin while the hub ticks climb the makam. Presentation only: driven by already-resolved round
 * steps, it never feeds back into a result, payout or timing of the game.
 */
import { createVoicePolicy, type VoiceLevel, type VoicePolicyOptions } from './voice-policy';
import { SlotAudioEngine, type VoiceHandle } from './engine';
import { createFallbackVoice, type FallbackVoice } from './fallback';
import { isCancelled, type RenderedAsset, type SfxClip } from './render';
import { RenderService, type WorkerFactory } from './render-service';
import { CEZERI_SCORES, type CezeriScoreId } from './scores/cezeri';
import { CEZERI_SFX } from './sfx/cezeri';
import { clamp, microVariation, pickVariation, type MixSettings, type Quantize, type SceneId } from './timing';
import { CELEBRATION_BPM, TIER_KEY, TIER_UP_PRE, VOICE_DUCK_DB, VOICE_DELAY, planTierUp, tierAction, toWinTier, type MultiplierClass, type WinTier } from './win-tiers';
import {
  CEZERI_CLASS_VOICE, CEZERI_MAX_RESPINS, CEZERI_PLACEHOLDER, CEZERI_TIER_VOICE, CEZERI_VOICE_LINES, HUB_STEPS_NIKRIZ, RING_VOICE, beamPlan, cezeriCalloutClass, cezeriCalloutRank,
  cezeriVoiceBankUrls, cezeriVoiceDecision, chainDuckDb, chainTension, chainVoice, crossedClass, hubRevealId, hubRound, hubStepRate, loadCezeriVoiceBank, ratchetPlan,
  tensionCutoff, tensionUpper, type BeamClip, type BeamPlan, type CezeriVoiceLine, type HubMode, type RatchetPlan, type RingEase,
} from './cezeri-tiers';
import type { LoadProgress } from './cascade-sound';

export type { LoadProgress } from './cascade-sound';
export { loadMixSettings, saveMixSettings } from './cascade-sound';
export type { CezeriVoiceLine, RatchetPlan, BeamPlan, RingEase } from './cezeri-tiers';
export type { WinTier } from './win-tiers';

export interface RingRotateOptions {
  /** The easing the board uses for the ring's angle (default 'outCubic'); a function x → y on 0..1 also works. */
  ease?: RingEase | ((x: number) => number);
  /** Start time on the audio clock (default: now). */
  when?: number;
  /** Play the stop thunk at the end (default true). */
  stop?: boolean;
  /** Slices of this ring held by the Dişli Kilidi (rotate step `held.length`, 0..12): the ring turns beneath them, a little quieter. */
  held?: number;
}
export interface RingSpec { ring: number; distance: number; ms: number; delayMs?: number; ease?: RingEase | ((x: number) => number); held?: number }
export interface SpokeWinOptions { startRing?: number; when?: number; step?: number }
export interface ChainEndInfo { respins: number; capped?: boolean; heldSlices?: number }

export interface CezeriSound {
  /** Call from a user gesture; browsers keep audio suspended until then. */
  resume: () => Promise<void>;
  setEnabled: (on: boolean) => void;
  /** Render the bank. Resolves when the core (base theme, first-spin effects incl. the ring and beam layers) is ready; the rest follows in the background. */
  load: (onProgress?: (p: LoadProgress) => void) => Promise<void>;
  /** Resolves when everything (feature theme, stingers, celebration effects) is rendered. */
  loaded: () => Promise<void>;
  setMix: (mix: Partial<MixSettings>) => void;
  getMix: () => MixSettings;
  setScene: (scene: SceneId) => void;
  duck: (amountDb: number, ms: number) => void;

  /** The spin starts: the crank winds the mechanism. Also ends a chain left open by the previous spin. */
  spinStart: () => void;
  /** `hub` step, round 0: the hub settles on its value (×1 quiet … ×10+ big, with the class callout from ×10). */
  hubReveal: (value: number) => void;
  /**
   * One ring of a `rotate` step turns: the gear-train whirr follows its speed, the pawl clicks once per slice passed
   * (`distance`) along the board's easing over `ms`, and the ring thuds onto its stop. Returns the seconds scheduled (0 when silent).
   */
  ringRotate: (ring: number, distance: number, ms: number, opts?: RingRotateOptions) => number;
  /** All rings of a `rotate` step at once (each may start `delayMs` later). Returns the seconds until the last stop. */
  rotate: (rings: readonly RingSpec[]) => number;
  /** The stop thunk alone (when the board stops a ring itself; ringRotate already includes it). */
  ringStop: (ring: number) => void;
  /** `win` step: a beam runs out along the spoke, one chime per slice from `startRing`, pitched by symbol; gear wilds add their shimmer. Several calls queue up. Returns seconds. */
  spokeWin: (spoke: number, length: number, symbol: string, opts?: SpokeWinOptions) => number;
  /** Generic win highlight (multiple of the bet). */
  winHighlight: (multiple: number) => void;
  win: (multiple: number) => void;
  /** `lock` step: the winning slices lock (a heavy clank and one pin per newly held slice); `respin` starts the tension bed. */
  gearLock: (newHeld: number, opts?: { respin?: boolean }) => void;
  /** `hub` step on respin `round` (1..10): hub +1 — a tick on the round-th degree of the scene's makam, layers growing with the round; opens the tension bed; a class callout when `value` crosses ≥10, ≥25 … */
  hubTick: (value: number, round: number) => void;
  /** The rings re-wind for respin `round` (play at that rotate step's start, before rotate()). */
  respin: (round: number) => void;
  /** `end` step: the chain is released; resolves the tension (short / big / full chain). */
  chainEnd: (info: ChainEndInfo) => void;
  /** n-th vessel (scatter) of the spin, 1..6, ascending; the tease starts at 2 (3 trigger). */
  vesselLand: (n: number) => void;
  scatterLand: (n: number) => void;
  scatter: (n: number) => void;
  scatterTease: (on: boolean) => void;
  /** Free spins triggered: the elephant clock strikes. */
  featureTrigger: () => void;
  /** Free-spins intro (~3.2 s); a following setScene('feature') enters on its musical end. */
  freeSpinsIntro: () => void;
  /** +4 spins during the feature. */
  retrigger: () => void;
  /** Fil Saati: the reservoir rises to `level` (1..3) after a free spin; level 3 trips the lever. */
  reservoirFill: (level: number) => void;
  /** The mechanical falcon takes off (before its drop). */
  falconFlight: () => void;
  /** `falcon` step: the falcon pins `count` gear wilds on `ring` (a dive, the claws, one pin per slice). */
  falconDrop: (ring: number, count: number) => void;
  /** End of the feature: the clock winds down (~3.6 s); a following setScene() enters on its musical end. */
  featureOutro: () => void;
  /** End-of-feature total-win fanfare (4 s); a following setScene() enters on its musical end. */
  totalWinFanfare: () => void;
  /** Tier 1 Büyük ≥10×, 2 Mega ≥25×, 3 Süper ≥50×, 4 Efsane ≥100×; climbs while a celebration runs. */
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
  /** Recorded voice lines: a folder (`/audio/voice/cezeri` → `/audio/voice/cezeri/x10.mp3` …) or a URL per line. Missing files are skipped silently. */
  setVoiceBank: (urls: string | Partial<Record<CezeriVoiceLine, string | null>>) => Promise<{ loaded: CezeriVoiceLine[]; missing: CezeriVoiceLine[] }>;
  /** Voice level (Full / Key moments / Off) and \"fast\" (turbo or autoplay: only tier and feature lines). */
  setVoicePolicy: (p: { level?: VoiceLevel; fast?: boolean }) => void;
  readonly voiceLines: Map<CezeriVoiceLine, AudioBuffer | null>;
  playSfx: (id: string, opts?: { rate?: number; gain?: number; pan?: number }) => void;
  playStinger: (id: CezeriScoreId) => void;
  readonly engine: SlotAudioEngine;
  readonly status: () => {
    core: boolean; extended: boolean; rendered: string[]; renderMs: Record<string, number>; workers: number; workerJobs: number; workerFailure: string | null;
    celebration: { tier: 0 | WinTier; max: boolean; counting: boolean; bed: string | null };
    chain: { active: boolean; round: number; cutoff: number };
    voice: { speaking: CezeriVoiceLine | null; loaded: number };
  };
  dispose: () => void;
}

/* ---------------- live-assembled layers (shared with the measurement harness) ---------------- */

function curveOn(param: AudioParam | undefined, curve: Float32Array, at: number, seconds: number, fallback: number) {
  if (!param) return;
  try { param.setValueCurveAtTime(curve, at, Math.max(0.01, seconds)); } catch { try { param.value = fallback; } catch { /* fake param */ } }
}
export interface ScheduledVoices { at: number; end: number; sources: AudioBufferSourceNode[]; stop: (fade?: number) => void }

/** One buffer voice into `dest` with a number or curve for rate and level, a fixed pan; returns null on a partial context. */
function voiceInto(ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, at: number, seconds: number, level: number | Float32Array, rate: number | Float32Array, pan: number, stopAt: number, list: { sources: AudioBufferSourceNode[]; gains: GainNode[] }, loop = false) {
  try {
    const src = ctx.createBufferSource(); src.buffer = buffer;
    if (loop) src.loop = true;
    const g = ctx.createGain();
    if (typeof rate === 'number') { try { src.playbackRate.value = rate; } catch { /* fake */ } } else curveOn(src.playbackRate, rate, at, seconds, rate[rate.length - 1]!);
    if (typeof level === 'number') { try { g.gain.value = level; } catch { /* fake */ } } else { try { g.gain.value = 0; } catch { /* fake */ } curveOn(g.gain, level, at, seconds, 0); }
    src.connect(g);
    let tail: AudioNode = g;
    if (pan && typeof ctx.createStereoPanner === 'function') { const p = ctx.createStereoPanner(); try { p.pan.value = Math.max(-1, Math.min(1, pan)); } catch { /* fake */ } g.connect(p); tail = p; }
    tail.connect(dest);
    src.onended = () => { try { src.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch { /* gone */ } };
    src.start(at);
    src.stop(stopAt);
    list.sources.push(src); list.gains.push(g);
  } catch { /* partial context */ }
}
function handleOf(ctx: BaseAudioContext, at: number, end: number, list: { sources: AudioBufferSourceNode[]; gains: GainNode[] }): ScheduledVoices {
  return {
    at, end, sources: list.sources,
    stop: (fade = 0.06) => {
      const t = ctx.currentTime;
      for (const g of list.gains) { try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); } catch { /* fake */ } }
      for (const s of list.sources) { try { s.stop(t + fade + 0.01); } catch { /* stopped */ } }
    },
  };
}

export interface RingClips { clicks: AudioBuffer[]; whirr: AudioBuffer | null; stop: AudioBuffer | null }
/**
 * Schedule one turning ring on any BaseAudioContext (live or offline) into `dest`: the whirr (looped, so any turn length
 * is covered) with rate and level curves from the plan, one click per planned slice (at its own level, the ring's rate, variations cycling) and the stop thunk at
 * the end. Missing clips are skipped.
 */
export function scheduleRingRotate(ctx: BaseAudioContext, dest: AudioNode, clips: RingClips, plan: RatchetPlan, when: number, opts: { gain?: number; stop?: boolean } = {}): ScheduledVoices {
  const list = { sources: [] as AudioBufferSourceNode[], gains: [] as GainNode[] };
  const v = RING_VOICE[plan.ring]!, gain = (opts.gain ?? 1) * v.gain, s = plan.seconds;
  if (clips.whirr) voiceInto(ctx, dest, clips.whirr, when, s, plan.whirrLevel.map(x => x * 0.32 * gain), plan.whirrRate.map(r => r * Math.sqrt(v.rate)), v.pan * 0.6, when + s + 0.05, list, true);
  if (clips.clicks.length) plan.clicks.forEach((c, i) => voiceInto(ctx, dest, clips.clicks[i % clips.clicks.length]!, when + c.at, 0, 0.5 * c.gain * gain, v.rate * (1 + ((i * 7) % 5 - 2) * 0.006), v.pan, when + c.at + 0.12, list));
  if (clips.stop && opts.stop !== false) voiceInto(ctx, dest, clips.stop, when + Math.max(0, s - 0.004), 0, 0.7 * gain, v.rate, v.pan, when + s + clips.stop.duration + 0.05, list);
  return handleOf(ctx, when, when + s, list);
}

export interface BeamClips { notes: Partial<Record<BeamClip, AudioBuffer | null>>; sweep: AudioBuffer | null; wild: AudioBuffer | null }
/** Schedule one spoke beam: the sweep, one chime per slice at its pitch (rate from the nearest rendered register) and the gear shimmer when the run holds a wild. */
export function scheduleSpokeBeam(ctx: BaseAudioContext, dest: AudioNode, clips: BeamClips, plan: BeamPlan, when: number, opts: { gain?: number; wild?: boolean } = {}): ScheduledVoices {
  const list = { sources: [] as AudioBufferSourceNode[], gains: [] as GainNode[] };
  const gain = opts.gain ?? 1;
  if (clips.sweep) voiceInto(ctx, dest, clips.sweep, when, 0, 0.6 * gain, 1 + plan.notes.length * 0.02, plan.pan, when + clips.sweep.duration + 0.05, list);
  for (const n of plan.notes) { const b = clips.notes[n.clip]; if (b) voiceInto(ctx, dest, b, when + n.at, 0, n.gain * gain, n.rate, n.pan, when + n.at + b.duration / n.rate + 0.05, list); }
  if (clips.wild && (opts.wild || plan.gear)) voiceInto(ctx, dest, clips.wild, when + plan.seconds * 0.5, 0, 0.6 * gain, 1, plan.pan, when + plan.seconds + clips.wild.duration + 0.05, list);
  return handleOf(ctx, when, when + plan.seconds, list);
}

export interface TensionBed { at: number; filter: BiquadFilterNode | null; lower: GainNode; upper: GainNode; out: GainNode; sources: AudioBufferSourceNode[]; stop: (fade?: number) => void }
/**
 * The Dişli Kilidi tension bed on any context: both loops start together (lock-step), the upper layer silent, through a
 * shared low-pass into `dest`. `setTension` moves the filter, the upper layer and the level for respin `round`.
 */
export function startTensionBed(ctx: BaseAudioContext, dest: AudioNode, lower: AudioBuffer, upper: AudioBuffer | null, when: number, fadeIn = 0.35): TensionBed | null {
  try {
    const out = ctx.createGain(), lowG = ctx.createGain(), upG = ctx.createGain();
    let filter: BiquadFilterNode | null = null;
    try { filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = tensionCutoff(1); filter.Q.value = 0.9; } catch { filter = null; }
    try { out.gain.value = 0; out.gain.setValueAtTime(0, when); out.gain.linearRampToValueAtTime(0.65, when + fadeIn); } catch { /* fake */ }
    try { lowG.gain.value = 1; upG.gain.value = 0; } catch { /* fake */ }
    if (filter) { lowG.connect(filter); upG.connect(filter); filter.connect(out); } else { lowG.connect(out); upG.connect(out); }
    out.connect(dest);
    const sources: AudioBufferSourceNode[] = [];
    for (const [buffer, g] of [[lower, lowG], [upper, upG]] as const) {
      if (!buffer) continue;
      const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
      try { s.loopStart = 0; s.loopEnd = buffer.duration; } catch { /* fake */ }
      s.connect(g); s.start(when); sources.push(s);
    }
    return {
      at: when, filter, lower: lowG, upper: upG, out, sources,
      stop: (fade = 0.5) => {
        const t = ctx.currentTime;
        try { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + fade); } catch { /* fake */ }
        for (const s of sources) { try { s.stop(t + fade + 0.02); } catch { /* stopped */ } }
        setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, (fade + 0.2) * 1000);
      },
    };
  } catch { return null; }
}
export function setTension(bed: TensionBed, round: number, at: number) {
  const target = (p: AudioParam | undefined, v: number, tc: number) => { if (!p) return; try { p.setTargetAtTime(v, at, tc); } catch { try { p.value = v; } catch { /* fake */ } } };
  target(bed.filter?.frequency, tensionCutoff(round), 0.12);
  target(bed.upper.gain, tensionUpper(round) * 0.9, 0.15);
  target(bed.out.gain, 0.65 + 0.25 * chainTension(round), 0.15);
}

/* ---------------- the controller ---------------- */

type Stinger = 'fsIntro' | 'retrigger' | 'fsOutro' | 'bigWin1' | 'bigWin2' | 'bigWin3' | 'bigWin4' | 'maxWin' | 'totalWin';
const CORE_SCORES: CezeriScoreId[] = ['base'];
/** The tension beds lead the lazy batch (a chain before they land plays its ticks and clanks without the bed). */
const EXTENDED_SCORES: CezeriScoreId[] = ['chainBed', 'chainBedHi', 'ambience', 'idle', 'fsIntro', 'feature', 'retrigger', 'bigWin1', 'bed1', 'bigWin2', 'bed2', 'bigWin3', 'bed3', 'bigWin4', 'bed4', 'fsOutro', 'totalWin', 'maxWin', 'bedMax'];
const SCENE_OF: Partial<Record<CezeriScoreId, SceneId>> = { base: 'base', idle: 'idle', feature: 'feature' };
/** Count-up tick pitch per tier key (melodic material above E sits lower, as in the scores). */
const tickShift = (key: number) => 2 ** ((key > 4 ? key - 12 : key) / 12);

/** Minimum spacing (s) and simultaneous voice cap per effect, so rapid events never stack up. */
const LIMITS: Record<string, [number, number]> = {
  spin: [0.08, 2], 'ring-stop': [0.02, 4], lock: [0.08, 2], pin: [0.02, 8], respin: [0.1, 2], win: [0.07, 3], coin: [0.055, 3], click: [0.03, 3], 'bet-up': [0.04, 2], 'bet-down': [0.04, 2],
  'hub-x1': [0.1, 1], 'hub-x2': [0.1, 1], 'hub-x3': [0.1, 1], 'hub-x5': [0.1, 1], 'hub-x10': [0.1, 1],
  'callout-x2': [0.1, 2], 'callout-x10': [0.15, 2], 'callout-x25': [0.2, 2], 'callout-x50': [0.25, 1], 'callout-x100': [0.3, 1], 'callout-x250': [0.3, 1],
  'vo-hum': [0.3, 1], 'vo-hey': [0.3, 1], 'vo-joy': [0.3, 1],
};
const NICE_COOLDOWN = 20;
const LOCK_LINE_COOLDOWN = 15;
const FEATURE_END_WINDOW = 8;
const TRIGGER_WINDOW = 6;
const BEAM_GAP = 0.09;
const BEAM_QUEUE = 1.2;
const CHAIN_WATCHDOG_MS = 15000;
const PIN_GAP = 0.03;
/** Pins sit under the lock clank (measured: full-level pins on the clank pushed the live master to −1.0 dBTP). */
const PIN_GAIN = 0.5;

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
export type CezeriRenderService = Pick<RenderService, 'score' | 'sfx' | 'prefetch' | 'dispose' | 'parallelism' | 'workerJobs' | 'failure' | 'trace'>;

export function createCezeriSound(options: { sampleRate?: number; workerFactory?: WorkerFactory | null; trace?: (label: string, ms: number) => void; voicePolicy?: VoicePolicyOptions; service?: () => CezeriRenderService } = {}): CezeriSound {
  const engine = new SlotAudioEngine();
  const random = Math.random;
  const sfx = new Map<string, (AudioBuffer | SfxClip)[]>();
  const music = new Map<CezeriScoreId, { asset: RenderedAsset; buffer: AudioBuffer | null }>();
  const last = new Map<string, number>(), lastVar = new Map<string, number>(), active = new Map<string, VoiceHandle[]>();
  const renderMs: Record<string, number> = {};
  let service: CezeriRenderService | null = null;
  let loading: Promise<void> | null = null, extended: Promise<void> | null = null;
  let coreReady = false, extendedReady = false, disposed = false;
  let enabled = false;
  let fallback: FallbackVoice | null = null;
  let pendingSceneAt = 0;
  let tease: VoiceHandle | null = null;
  const rings: (ScheduledVoices | null)[] = [null, null, null, null];
  let nextBeamAt = 0;
  let chain: { bed: TensionBed | null; round: number; watchdog: ReturnType<typeof setTimeout> | null } | null = null;
  let tier: 0 | WinTier = 0, maxWinActive = false, bigWinEndAt = 0, gridStart = 0;
  let head: VoiceHandle | null = null;
  let bed: VoiceHandle | null = null, bedPlaying: CezeriScoreId | null = null;
  const voiceLines = new Map<CezeriVoiceLine, AudioBuffer | null>();
  let voiceDecoder: BaseAudioContext | null = null;
  let speaking: { line: CezeriVoiceLine; from: number; until: number } | null = null, speakingHandle: VoiceHandle | null = null;
  let lastNiceAt = -Infinity, lastFeatureEndAt = -Infinity, lastTriggerAt = -Infinity, lastLockLineAt = -Infinity;
  let counting = false, countTimer: ReturnType<typeof setInterval> | null = null, countNext = 0, countStart = 0;
  const progressListeners = new Set<(p: LoadProgress) => void>();
  engine.setMix({ muted: true }); // silent until setEnabled(true)

  const live = () => (enabled && !disposed ? engine.live() : null);
  const fb = (): FallbackVoice | null => {
    const ctx = live(), out = engine.busInput('sfx');
    if (!ctx || !out) return null;
    return (fallback ??= createFallbackVoice(ctx, out));
  };
  const hubMode = (): HubMode => (engine.desiredScene === 'feature' ? 'cargah' : 'nikriz');

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
  const allVariations = (id: string): AudioBuffer[] => (sfx.get(id) ?? []).map((_, i) => sfxBuffer(id, i)).filter((b): b is AudioBuffer => !!b);
  const musicBuffer = (id: CezeriScoreId): AudioBuffer | null => {
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
    const def = CEZERI_SFX.find(s => s.id === id);
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

  /** Shared "never annoying" policy (voice-policy.ts): level, spacing, repeats, cooldowns, turbo/autoplay. */
  const voicePolicy = createVoicePolicy({ minorInKey: false, ...options.voicePolicy });
  let bankToken = 0;
  const speak = (line: CezeriVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    let result: 'line' | 'placeholder' | null = null;
    voicePolicy.request(line, ctx.currentTime, () => { result = speakNow(line, when); return result !== null; });
    return result;
  };
  const speakNow = (line: CezeriVoiceLine, when?: number): 'line' | 'placeholder' | null => {
    const ctx = live(); if (!ctx) return null;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime + VOICE_DELAY);
    const buffer = voiceLines.get(line) ?? null, placeholder = CEZERI_PLACEHOLDER[line];
    if (!buffer && !placeholder) return null;
    if (!buffer && placeholder && !sfx.has(placeholder)) return null;
    const decision = cezeriVoiceDecision(speaking, line, at);
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

  const install = (id: CezeriScoreId, asset: RenderedAsset) => {
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
    const coreSfx = CEZERI_SFX.filter(s => s.core).map(s => s.id), extSfx = CEZERI_SFX.filter(s => !s.core && !s.late).map(s => s.id);
    const lateSfx = CEZERI_SFX.filter(s => !s.core && s.late).map(s => s.id);
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
    const scoreStep = (id: CezeriScoreId, phase: LoadProgress['phase']) => step(id, phase, async () => { const a = await svc.score(CEZERI_SCORES[id]); if (!disposed) install(id, a); });
    report({ phase: 'core', done, total, label: 'start', ms: 0 });
    svc.prefetch();
    // core: the base theme and the first-spin effects (ring, beam, first hub and lock layers), in parallel
    loading = Promise.all([
      step('sfx-core', 'core', async () => { const c = await svc.sfx('cezeri', coreSfx); if (!disposed) installSfx(c); }),
      ...CORE_SCORES.map(id => scoreStep(id, 'core')),
    ]).then(() => { coreReady = true; renderMs.core = Math.round(ms()); });
    // extended (lazy, in the background): the two tension beds, the rest of the hub ladder and the feature effects,
    // ambience/idle/intro/feature theme, then the celebration group (callouts, tier-ups, landings, heads and beds), two jobs at a time
    extended = loading.then(async () => {
      const sfxStep = (label: string, ids: string[]) => () => step(label, 'extended', async () => { const c = await svc.sfx('cezeri', ids); if (!disposed) installSfx(c); });
      const scores = EXTENDED_SCORES.map(id => () => scoreStep(id, 'extended'));
      const queue: (() => Promise<void>)[] = [scores[0]!, scores[1]!, sfxStep('sfx-extended', extSfx), ...scores.slice(2, 7), sfxStep('sfx-celebration', lateSfx), ...scores.slice(7)];
      const lane = async () => { for (let job = queue.shift(); job && !disposed; job = queue.shift()) await job(); };
      await Promise.all([lane(), lane()]);
      if (disposed) return;
      extendedReady = true; renderMs.all = Math.round(ms());
      report({ phase: 'done', done, total, label: 'all ready', ms: ms() });
    });
    const quiet = (err: unknown) => { if (!disposed && !isCancelled(err)) console.warn('[slot-audio] cezeri render failed', err); };
    loading = loading.catch(quiet);
    extended = extended.catch(quiet);
    return loading;
  };

  /* ---------------- the Dişli Kilidi chain ---------------- */

  const celebrating = (): boolean => {
    if (!tier && !maxWinActive) return false;
    const ctx = engine.context;
    return counting || bed !== null || (!!ctx && ctx.currentTime < bigWinEndAt);
  };
  const armWatchdog = () => {
    if (!chain) return;
    if (chain.watchdog) clearTimeout(chain.watchdog);
    chain.watchdog = setTimeout(() => stopChain(0.8), CHAIN_WATCHDOG_MS);
  };
  const startChain = () => {
    const ctx = live(), dest = engine.busInput('music');
    if (chain || !ctx || !dest) return;
    const lower = musicBuffer('chainBed');
    chain = { bed: lower ? startTensionBed(ctx, dest, lower, musicBuffer('chainBedHi'), ctx.currentTime + 0.03) : null, round: 0, watchdog: null };
    engine.duckHold(chainDuckDb(1));
    armWatchdog();
  };
  const stopChain = (fade = 0.5) => {
    if (!chain) return;
    if (chain.watchdog) clearTimeout(chain.watchdog);
    chain.bed?.stop(fade);
    chain = null;
    if (!celebrating()) engine.duckRelease(700);
  };
  /** Hub-step clip for `round`, or the highest rendered lower step bent up to it (rate), or null. */
  const hubStepClip = (round: number): { id: string; rate: number } | null => {
    const mode = hubMode();
    for (let k = round; k >= 1; k--) {
      const id = `hub-step-${k}`;
      if (sfx.has(id)) return { id, rate: hubStepRate(round, mode) * 2 ** ((HUB_STEPS_NIKRIZ[round]! - HUB_STEPS_NIKRIZ[k]!) / 12) };
    }
    return null;
  };

  /* ---------------- celebration: heads, tier-ups, count-up beds (same behaviour as Ebru / Tarhun) ---------------- */

  const bedFor = (): CezeriScoreId => (maxWinActive ? 'bedMax' : (`bed${tier || 1}` as CezeriScoreId));
  const bedBuffer = (): { id: CezeriScoreId; buffer: AudioBuffer } | null => {
    const order: CezeriScoreId[] = maxWinActive ? ['bedMax', 'bed4', 'bed3', 'bed2', 'bed1'] : (['bed4', 'bed3', 'bed2', 'bed1'] as CezeriScoreId[]).slice(4 - (tier || 1));
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
  const registerBedScene = () => {
    const id = bedFor(), buffer = musicBuffer(id), asset = music.get(id)?.asset;
    if (buffer && asset) engine.registerScene('bigwin', { buffer, bpm: asset.bpm, beatsPerBar: asset.beatsPerBar });
  };
  const startCelebration = (id: Stinger, duckDb: number, fallbackSteps: number, line: CezeriVoiceLine) => {
    stopChain(0.2);
    stopBed(0.2); head?.stop(0.15); head = null;
    const s = stinger(id, 'beat', duckDb);
    if (!s) { bigWinEndAt = 0; fb()?.chimeRun(fallbackSteps, 72); speak(line); return; }
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
    speak(CEZERI_TIER_VOICE[target], plan.hitAt + 0.3);
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
    if (!play('trigger')) fb()?.chimeRun(8, 72);
    lastTriggerAt = ctxNow();
    speak('feature-trigger');
  };
  const classCallout = (value: number, cls: MultiplierClass) => {
    const rank = cezeriCalloutRank(cls);
    if (!play(`callout-${cls}`) && !play('hub-x10')) fb()?.win(value);
    engine.duck(3 + rank * 1.5, 250 + rank * 250, 20, 500);
    const line = CEZERI_CLASS_VOICE[cls];
    if (line) speak(line);
  };
  const pins = (count: number, when: number) => {
    const n = clamp(Math.round(count), 0, 12);
    for (let i = 0; i < n; i++) { last.delete('pin'); play('pin', { when: when + i * PIN_GAP, rate: 1 + i * 0.015, pan: ((i % 5) - 2) * 0.2, gain: PIN_GAIN }); }
  };

  /* ---------------- API ---------------- */

  const api: CezeriSound = {
    engine,
    voiceLines,
    load: onProgress => { if (onProgress) progressListeners.add(onProgress); return startLoad(); },
    loaded: async () => { await startLoad(); await extended; },
    status: () => ({
      core: coreReady, extended: extendedReady, rendered: [...music.keys(), ...sfx.keys()], renderMs: { ...renderMs }, workers: service?.parallelism ?? 0, workerJobs: service?.workerJobs ?? 0, workerFailure: service?.failure ?? null,
      celebration: { tier, max: maxWinActive, counting, bed: bedPlaying },
      chain: { active: chain !== null, round: chain?.round ?? 0, cutoff: chain ? tensionCutoff(Math.max(1, chain.round)) : 0 },
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
      if (!on) {
        counting = false; if (countTimer) { clearInterval(countTimer); countTimer = null; }
        stopBed(0.1); head?.stop(0.1); endCelebration(); tease?.stop(0.1); tease = null; stopChain(0.05);
        for (let r = 0; r < 4; r++) { rings[r]?.stop(0.03); rings[r] = null; }
        speakingHandle?.stop(0.05); speaking = null;
      }
    },
    setMix: mix => { if ('muted' in mix && typeof mix.muted === 'boolean') enabled = !mix.muted; engine.setMix(mix); },
    getMix: () => engine.mixSettings,
    setScene: scene => {
      const ctx = engine.context;
      if (ctx && pendingSceneAt > ctx.currentTime + 0.02) { engine.setScene(scene, { at: pendingSceneAt, fade: 0.3 }); pendingSceneAt = 0; }
      else engine.setScene(scene);
    },
    duck: (amountDb, ms) => engine.duck(amountDb, ms),

    spinStart: () => { stopChain(0.3); if (!play('spin')) fb()?.spin(); },
    hubReveal: value => {
      const v = Number.isFinite(value) ? value : 1;
      const order: string[] = ['hub-x10', 'hub-x5', 'hub-x3', 'hub-x2', 'hub-x1'];
      if (!order.slice(order.indexOf(hubRevealId(v))).some(id => play(id))) fb()?.crystal(v);
      if (v >= 10) classCallout(v, cezeriCalloutClass(v));
    },
    ringRotate: (ring, distance, ms, opts = {}) => {
      const ctx = live(), out = engine.busInput('sfx');
      if (!ctx || !out) return 0;
      const plan = ratchetPlan(ring, distance, ms, opts.ease ?? 'outCubic');
      const when = Math.max(ctx.currentTime + 0.005, opts.when ?? ctx.currentTime + 0.005);
      const clicks = allVariations('ratchet');
      if (!clicks.length) { fb()?.spin(); return plan.seconds; }
      rings[plan.ring]?.stop(0.03);
      const heldScale = 1 - 0.4 * clamp(Number(opts.held ?? 0), 0, 12) / 12;
      rings[plan.ring] = scheduleRingRotate(ctx, out, { clicks, whirr: anyVariation('ring-whirr'), stop: anyVariation('ring-stop') }, plan, when, { stop: opts.stop, gain: heldScale });
      return plan.seconds;
    },
    rotate: list => {
      const ctx = live(); if (!ctx) return 0;
      let end = 0;
      for (const r of list) {
        const delay = Math.max(0, (Number(r.delayMs) || 0) / 1000);
        const s = api.ringRotate(r.ring, r.distance, r.ms, { ease: r.ease, held: r.held, when: ctx.currentTime + 0.005 + delay });
        end = Math.max(end, delay + s);
      }
      return end;
    },
    ringStop: ring => { const v = RING_VOICE[clamp(Math.round(ring), 0, 3)]!; play('ring-stop', { rate: v.rate, pan: v.pan, gain: v.gain }); },
    spokeWin: (spoke, length, symbol, opts = {}) => {
      const ctx = live(), out = engine.busInput('sfx');
      if (!ctx || !out) return 0;
      const plan = beamPlan(spoke, length, opts.startRing ?? 0, symbol, opts.step);
      const when = Math.max(ctx.currentTime + 0.005, opts.when ?? 0, nextBeamAt);
      if (when - ctx.currentTime > BEAM_QUEUE) return 0;
      const notes = { 'beam-1': anyVariation('beam-1'), 'beam-2': anyVariation('beam-2'), 'beam-3': anyVariation('beam-3') };
      if (!notes['beam-1'] && !notes['beam-2']) { fb()?.win(plan.notes.length); return plan.seconds; }
      nextBeamAt = when + BEAM_GAP;
      scheduleSpokeBeam(ctx, out, { notes, sweep: anyVariation('beam-sweep'), wild: anyVariation('gear-wild') }, plan, when);
      return plan.seconds;
    },
    winHighlight: multiple => {
      const level = clamp(Math.log2(Math.max(1, multiple)), 0, 8) / 8;
      if (!play('win', { gain: 0.6 + 0.4 * level, rate: 1 + level * 0.06 })) fb()?.win(multiple);
    },
    win: multiple => api.winHighlight(multiple),
    gearLock: (newHeld, opts = {}) => {
      const ctx = live(); if (!ctx) return;
      const round = chain?.round ?? 0;
      if (!play('lock', { rate: 1 - Math.min(0.12, round * 0.012), gain: 0.85 + Math.min(0.1, round * 0.01) })) fb()?.collect();
      pins(newHeld, ctx.currentTime + 0.06);
      if (ctx.currentTime - lastLockLineAt > LOCK_LINE_COOLDOWN && !chain) { lastLockLineAt = ctx.currentTime; speak('lock', ctx.currentTime + 0.3); }
      if (opts.respin) startChain();
      armWatchdog();
    },
    hubTick: (value, round) => {
      const ctx = live(); if (!ctx) return;
      const k = Math.max(1, hubRound(round));
      if (!chain) startChain();
      if (chain) {
        chain.round = k;
        if (chain.bed) setTension(chain.bed, k, ctx.currentTime);
        engine.duckHold(chainDuckDb(k));
        armWatchdog();
      }
      const clip = hubStepClip(k);
      if (!clip || !play(clip.id, { rate: clip.rate })) fb()?.crystal(k);
      const cls = crossedClass(Number(value) - 1, Number(value));
      if (cls) classCallout(value, cls);
      const line = chainVoice(k);
      if (line && !cls) speak(line, ctx.currentTime + 0.25);
    },
    respin: round => { play('respin', { rate: 2 ** (Math.min(CEZERI_MAX_RESPINS, Math.max(1, hubRound(round))) / 24) }); },
    chainEnd: info => {
      const ctx = live();
      const respins = Math.max(0, Math.round(Number(info?.respins) || 0));
      const full = !!info?.capped || respins >= CEZERI_MAX_RESPINS || (Number(info?.heldSlices) || 0) >= 48;
      stopChain(full ? 1.2 : 0.6);
      if (!ctx) return;
      if (full) { if (!play('chain-full') && !play('chain-end-big')) play('chain-end'); speak('chain-max', ctx.currentTime + 0.9); }
      else if (respins >= 3) { if (!play('chain-end-big')) play('chain-end'); }
      else if (respins >= 1) play('chain-end');
    },
    vesselLand: n => {
      const k = clamp(Math.round(n), 1, 6);
      if (!play(`vessel${k}`)) fb()?.scatter(n);
      if (k === 2) api.scatterTease(true);
    },
    scatterLand: n => api.vesselLand(n),
    scatter: n => api.vesselLand(n),
    scatterTease: on => {
      const ctx = live();
      if (!on || !ctx) { tease?.stop(0.18); tease = null; return; }
      if (tease) return;
      const list = sfx.get('tease'); if (!list?.length) return;
      const buffer = sfxBuffer('tease', Math.floor(random() * list.length));
      if (buffer) { tease = engine.playBuffer('sfx', buffer, { fadeIn: 0.05 }); engine.duck(6, buffer.duration * 1000, 200, 400); speak('scatter-tease', ctx.currentTime + 0.4); }
    },
    featureTrigger: () => { if (live()) { tease?.stop(0.2); tease = null; stopChain(0.3); triggerMoment(); } },
    freeSpinsIntro: () => {
      const ctx = live(); if (!ctx) return;
      if (ctx.currentTime - lastTriggerAt > TRIGGER_WINDOW) triggerMoment();
      tease?.stop(0.2); tease = null;
      const s = stinger('fsIntro', 'beat', 18, 120);
      if (s) { pendingSceneAt = s.end; speak('feature-start', s.end - 0.1); } else fb()?.chimeRun(6, 72);
    },
    retrigger: () => {
      const s = stinger('retrigger', 'beat', 8, 300);
      if (!s && !play('vessel6')) fb()?.chimeRun(4, 72);
      speak('retrigger', s ? s.at + 0.25 : undefined);
    },
    reservoirFill: level => {
      const l = clamp(Math.round(level), 1, 3);
      if (!play(`reservoir-${l}`)) fb()?.crystal(l * 2);
      if (l === 3) speak('reservoir', ctxNow() + 0.9);
    },
    falconFlight: () => { if (!play('falcon-flight')) fb()?.collect(); speak('falcon', ctxNow() + 0.5); },
    falconDrop: (ring, count) => {
      const ctx = live(); if (!ctx) return;
      const v = RING_VOICE[clamp(Math.round(ring), 0, 3)]!;
      if (!play('falcon-drop', { pan: v.pan })) fb()?.scatter(3);
      pins(count, ctx.currentTime + 0.45);
    },
    featureOutro: () => {
      stopChain(0.3);
      const s = stinger('fsOutro', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(5, 72);
      featureEndLine();
    },
    totalWinFanfare: () => {
      stopChain(0.3);
      if (bed) stopBed(0.3);
      const s = stinger('totalWin', 'beat', 16, 150);
      if (s) pendingSceneAt = s.end; else fb()?.chimeRun(7, 72);
      featureEndLine();
    },
    bigWin: requested => {
      const t = toWinTier(requested);
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      const action = tierAction(tier, t, isActive);
      if (action === 'ignore') return;
      if (action === 'up' && live() && (musicBuffer(`bigWin${t}` as CezeriScoreId) || sfx.has(`tier-up-${t}`))) { climb(t); return; }
      tier = t; maxWinActive = false;
      startCelebration(`bigWin${t}` as Stinger, 14, 4 + t * 2, CEZERI_TIER_VOICE[t]);
    },
    maxWin: () => {
      const isActive = celebrating();
      if (maxWinActive && isActive) return;
      if (isActive && live() && musicBuffer('maxWin')) { climb('max'); return; }
      maxWinActive = true; tier = tier || 4;
      startCelebration('maxWin', 18, 12, CEZERI_TIER_VOICE.max);
    },
    multiplierCallout: value => {
      if (!live()) return;
      classCallout(value, cezeriCalloutClass(value));
    },
    nice: () => {
      const t = ctxNow();
      if (t - lastNiceAt < NICE_COOLDOWN) return;
      if (speak('nice')) lastNiceAt = t;
    },
    setVoicePolicy: p => { if (p && p.level !== undefined) voicePolicy.setLevel(p.level); if (p && p.fast !== undefined) voicePolicy.setFast(p.fast); },
    setVoiceBank: async urls => {
      const myBank = ++bankToken; voiceLines.clear();
      const loaded = await loadCezeriVoiceBank(cezeriVoiceBankUrls(urls), fetchVoice);
      const result = { loaded: [] as CezeriVoiceLine[], missing: [] as CezeriVoiceLine[] };
      if (disposed || myBank !== bankToken) return result;
      voiceLines.clear();
      for (const line of CEZERI_VOICE_LINES) { const buffer = loaded.get(line) ?? null; voiceLines.set(line, buffer); (buffer ? result.loaded : result.missing).push(line); }
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
          if (!play('ding')) play('chain-end');
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
      if (chain?.watchdog) clearTimeout(chain.watchdog);
      chain = null;
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
export const CEZERI_CALLOUT_VALUES: Readonly<Record<MultiplierClass, number>> = Object.freeze({ x2: 5, x10: 12, x25: 30, x50: 60, x100: 120, x250: 260 });
