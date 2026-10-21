/**
 * The part of the slot audio renderer that is not game-specific and carries no synthesis: sample-rate constants, the
 * message-level types, track splitting, the OfflineAudioContext reverb and the cancel signal. render-service.ts (main
 * thread) imports ONLY this file statically; the pure-JS synthesis in render.ts (every instrument of every game) is loaded
 * with `import()` when the worker path fails, so a game route does not ship other games' synths
 * (docs/architecture/scale.md, 6.2). A worker must never import the module that spawns it: this file imports neither.
 */
import { createYielder, type Stereo } from './synth/dsp';
import type { Score, Track } from './scores/types';

export const RENDER_SAMPLE_RATE = 44100;
/** Sample-peak ceiling of every rendered asset; true peak is verified separately (< −1 dBTP). */
export const ASSET_CEILING_DB = -1.6;

export interface RenderedAsset {
  id: string;
  sampleRate: number;
  l: Float32Array;
  r: Float32Array;
  loop: boolean;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** Seconds from the start at which the next scene may enter (stingers). */
  musicalEnd: number;
  renderMs: number;
  master: { gainDb: number; limitDb: number; lufs: number };
}

export interface RenderEnv {
  sampleRate: number;
  tick: () => Promise<void>;
  impulses: Map<string, Promise<Stereo>>;
  /** Use OfflineAudioContext for the reverb when it exists (default true). */
  offline?: boolean;
  /** Abort flag: renders stop early when it returns true. */
  cancelled?: () => boolean;
}

export const createRenderEnv = (sampleRate = RENDER_SAMPLE_RATE, budgetMs = 8): RenderEnv => ({ sampleRate, tick: createYielder(budgetMs), impulses: new Map() });

export class Cancelled extends Error { constructor() { super('render cancelled'); } }
export const isCancelled = (e: unknown) => e instanceof Cancelled;

/** Partial mix from one worker: full-rate dry bus and a half-rate reverb send (the reverb runs at half rate). */
export interface StemSum { dry: Stereo; send: Stereo }

/** The reverb (send → convolution) runs at sampleRate / REVERB_DECIMATION: its tail is dark anyway. */
export const REVERB_DECIMATION = 2;

const EBRU_VOICE_COST = { kanun: 2.6, kanunSoft: 2.2, ud: 2.6, glassHarp: 2.6, waterGlass: 10 } as const;
/** Cezeri voices, weighted by their measured synthesis cost (filled in from the worker trace, see ops/evidence/cezeri-20261012). */
const CEZERI_VOICE_COST = { santur: 3, santurSoft: 1.8, pipe: 2.6, waterOrgan: 4, chimeRod: 2, drip: 2.5 } as const;
/** Asena voices, weighted by their measured synthesis cost (per note, see ops/evidence/asena-20261012/audio.json). */
const ASENA_VOICE_COST = { kopuz: 1.2, kopuzMute: 0.25, kilKopuz: 2.2, khoomei: 9, kargyraa: 12, starBell: 3 } as const;
const VOICE_COST: Partial<Record<string, number>> = { ...EBRU_VOICE_COST, ...CEZERI_VOICE_COST, ...ASENA_VOICE_COST };

/** Rough synthesis cost of a track, for spreading tracks over workers. */
export function trackCost(track: Track): number {
  switch (track.kind) {
    // Ebru voices are weighted by their measured synthesis cost (three-string Karplus-Strong, long glass tones)
    case 'pitched': return track.notes.length * (track.voice === 'pluck' ? 0.6 : VOICE_COST[track.voice] ?? 1);
    case 'pad': return track.chords.reduce((s, c) => s + c.ns.length * (c.d + 2), 0) * (track.voice === 'padSaw' ? 1.2 : track.voice === 'padChoir' || track.voice === 'padChoirMale' ? 1.6 : track.voice === 'padHorn' ? 1.3 : 0.6);
    case 'kit': return 4 + track.hits.length * 0.15;
    case 'fx': return track.fx.reduce((s, f) => s + (f.k === 'room' ? 40 : f.k === 'rain' ? 60 : f.k === 'wind' ? 30 : f.k === 'water' ? 45 : f.k === 'courtyard' ? 70 : f.k === 'steppe' ? 55 : f.k === 'dawn' ? 50 : f.k === 'burner' ? 0.8 * f.d : f.k === 'fire' ? 0.6 * f.d : f.k === 'whirr' ? 1.2 * f.d : f.k === 'riser' || f.k === 'rumble' ? 8 : 3) + f.d, 0);
  }
}

/** Greedy longest-first split of a score's tracks into `bins` groups of similar cost. */
export function splitTracks(score: Score, bins: number): string[][] {
  const groups = Array.from({ length: Math.max(1, bins) }, () => ({ cost: 0, ids: [] as string[] }));
  for (const t of [...score.tracks].sort((a, b) => trackCost(b) - trackCost(a))) {
    const g = groups.reduce((m, x) => (x.cost < m.cost ? x : m));
    g.cost += trackCost(t); g.ids.push(t.id);
  }
  return groups.filter(g => g.ids.length).map(g => g.ids);
}

const hasOffline = () => typeof (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext === 'function';

/**
 * Phase 2 (main thread: OfflineAudioContext is a window API): the summed half-rate sends through the
 * generated convolution reverb, rendered natively off the main thread. Null without OfflineAudioContext
 * (the mix is then dry).
 */
export async function reverbWet(sends: Stereo[], ir: Stereo, reverbRate: number): Promise<Stereo | null> {
  if (!hasOffline() || !sends.length) return null;
  try {
    const Offline = (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
    const n = sends[0]!.l.length;
    const ctx = new Offline({ numberOfChannels: 2, length: n, sampleRate: reverbRate });
    const mk = (st: Stereo) => { const b = ctx.createBuffer(2, st.l.length, reverbRate); b.copyToChannel(st.l as Float32Array<ArrayBuffer>, 0); b.copyToChannel(st.r as Float32Array<ArrayBuffer>, 1); return b; };
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = mk(ir);
    conv.connect(ctx.destination);
    // partial sends (one per worker) are summed natively by the graph
    for (const send of sends) { const s = ctx.createBufferSource(); s.buffer = mk(send); s.connect(conv); s.start(0); }
    const out = await ctx.startRendering();
    return { l: out.getChannelData(0).slice(), r: out.getChannelData(1).slice() };
  } catch { return null; }
}

export interface SfxClip { id: string; variation: number; l: Float32Array; r: Float32Array; sampleRate: number }

export interface SfxPart { id: string; variation: number; offset: number; length: number; reverb: boolean; level: number }
export interface SfxSynth { parts: SfxPart[]; sum: StemSum }

/** Full-rate tail length of the effects room. */
export const sfxTail = (ir: Stereo) => ir.l.length * REVERB_DECIMATION;
