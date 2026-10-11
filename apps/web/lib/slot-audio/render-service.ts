/**
 * Render orchestration. Synthesis and mastering (pure JS) run in a small pool of Web Workers so the
 * main thread stays responsive and tracks render in parallel; the reverb/EQ mixdown runs in an
 * OfflineAudioContext (a window API, rendered natively off the main thread). Without Worker support
 * everything runs inline with cooperative yielding.
 */
import {
  REVERB_DECIMATION, RENDER_SAMPLE_RATE, createRenderEnv, finishScore, finishSfx, isCancelled, reverbWet, scoreImpulse, sfxTail, splitTracks, synthSfx, synthTracks,
  type RenderEnv, type RenderedAsset, type SfxClip, type SfxPart, type StemSum,
} from './render';
import type { Stereo } from './synth/dsp';
import type { Score } from './scores/types';
import { CASCADE_SFX, type SfxDef } from './sfx/cascade';

export const SFX_CATALOGS: Record<string, SfxDef[]> = { cascade: CASCADE_SFX };

export type WorkerRequest =
  | { id: number; type: 'tracks'; score: Score; trackIds: string[]; sampleRate: number }
  | { id: number; type: 'finish'; score: Score; dry: Stereo[]; wet: Stereo | null; sampleRate: number; renderMs: number }
  | { id: number; type: 'impulse'; name: 'hall' | 'room'; sampleRate: number }
  | { id: number; type: 'sfx'; catalog: string; ids: string[]; sampleRate: number; tail: number }
  | { id: number; type: 'sfx-finish'; parts: SfxPart[]; dry: Stereo; wet: Stereo | null; sampleRate: number; tail: number };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export type WorkerFactory = () => Worker | null;

/** Bundler-visible worker entry (Turbopack/webpack turn this into a separate chunk). */
export const defaultWorkerFactory: WorkerFactory = () => {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module', name: 'slot-audio-render' });
};

const stereoBuffers = (...list: Stereo[]) => list.flatMap(s => [s.l.buffer, s.r.buffer]) as ArrayBuffer[];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface PoolWorker { worker: Worker; busy: number }

export class RenderService {
  readonly sampleRate: number;
  private factory: WorkerFactory | null;
  private maxWorkers: number;
  private pool: PoolWorker[] | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; worker: PoolWorker }>();
  private seq = 0;
  private disposed = false;
  private env: RenderEnv;
  private impulses = new Map<string, Promise<Stereo>>();
  /** Optional phase timings (ms since construction) for diagnostics. */
  trace: ((label: string, ms: number) => void) | null = null;
  private readonly born = now();
  private mark(label: string) { this.trace?.(label, Math.round(now() - this.born)); }

  constructor(opts: { sampleRate?: number; workerFactory?: WorkerFactory | null; maxWorkers?: number } = {}) {
    this.sampleRate = opts.sampleRate ?? RENDER_SAMPLE_RATE;
    this.factory = opts.workerFactory === undefined ? defaultWorkerFactory : opts.workerFactory;
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    this.maxWorkers = Math.max(1, Math.min(opts.maxWorkers ?? 4, cores - 1));
    this.env = { ...createRenderEnv(this.sampleRate), cancelled: () => this.disposed };
  }

  /** Start generating both reverb impulses right away (they gate every render). */
  prefetch(): void { void this.impulse('room').catch(() => {}); void this.impulse('hall').catch(() => {}); }

  /** Number of parallel workers in use (0 = inline). */
  get parallelism(): number { return this.ensurePool()?.length ?? 0; }
  /** Why the pool fell back to inline rendering, if it did (diagnostics). */
  failure: string | null = null;
  /** Jobs completed by workers (diagnostics). */
  workerJobs = 0;

  private ensurePool(): PoolWorker[] | null {
    if (this.pool || !this.factory || this.disposed) return this.pool;
    const pool: PoolWorker[] = [];
    try {
      for (let i = 0; i < this.maxWorkers; i++) {
        const worker = this.factory();
        if (!worker) break;
        const entry: PoolWorker = { worker, busy: 0 };
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const p = this.pending.get(e.data.id); if (!p) return;
          this.pending.delete(e.data.id); entry.busy--;
          if (e.data.ok) { this.workerJobs++; p.resolve(e.data.result); } else p.reject(new Error(e.data.error));
        };
        worker.onerror = (e: ErrorEvent) => { e.preventDefault?.(); this.fail(entry, new Error(e.message || 'render worker failed')); };
        pool.push(entry);
      }
    } catch { /* workers unavailable (CSP, bundler) → inline */ }
    if (!pool.length) { this.factory = null; return null; }
    this.pool = pool;
    return pool;
  }

  /** A broken worker rejects its jobs; the service then stops using workers and renders inline. */
  private fail(entry: PoolWorker, error: Error) {
    this.failure = error.message;
    for (const [id, p] of this.pending) if (p.worker === entry) { this.pending.delete(id); p.reject(error); }
    for (const w of this.pool ?? []) w.worker.terminate();
    this.pool = null; this.factory = null;
  }

  private call<T>(req: WithoutId<WorkerRequest>, transfer: ArrayBuffer[] = []): Promise<T> {
    const pool = this.ensurePool();
    if (!pool) return Promise.reject(new Error('no worker pool'));
    const entry = pool.reduce((m, w) => (w.busy < m.busy ? w : m));
    const id = ++this.seq;
    entry.busy++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, worker: entry });
      entry.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  /** Run with workers; on any worker failure fall back to the inline path once. */
  private async withFallback<T>(viaWorkers: () => Promise<T>, inline: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('render service disposed');
    if (this.ensurePool()) {
      try { return await viaWorkers(); } catch (e) {
        if (this.disposed || isCancelled(e)) throw e;
        this.failure ??= e instanceof Error ? e.message : String(e);
      }
    }
    return inline();
  }

  private impulse(name: 'hall' | 'room'): Promise<Stereo> {
    let p = this.impulses.get(name);
    if (!p) {
      p = this.withFallback(
        () => this.call<Stereo>({ type: 'impulse', name, sampleRate: this.sampleRate }),
        () => scoreImpulse(this.env, name),
      );
      this.impulses.set(name, p);
      p.catch(() => this.impulses.delete(name));
    }
    return p;
  }

  async score(score: Score): Promise<RenderedAsset> {
    const t0 = now(), sr = this.sampleRate, rr = sr / REVERB_DECIMATION;
    return this.withFallback(async () => {
      const groups = splitTracks(score, this.parallelism);
      this.mark(`${score.id} start`);
      const [ir, ...sums] = await Promise.all([this.impulse(score.reverb), ...groups.map(ids => this.call<StemSum>({ type: 'tracks', score, trackIds: ids, sampleRate: sr }).then(r => { this.mark(`${score.id} tracks ${ids.join('+')}`); return r; }))]) as [Stereo, ...StemSum[]];
      const wet = await reverbWet(sums.map(x => x.send), ir, rr);
      this.mark(`${score.id} reverb`);
      const dry = sums.map(x => x.dry);
      const asset = await this.call<RenderedAsset>({ type: 'finish', score, dry, wet, sampleRate: sr, renderMs: 0 }, stereoBuffers(...dry, ...(wet ? [wet] : [])));
      this.mark(`${score.id} finish`);
      asset.renderMs = now() - t0;
      return asset;
    }, async () => {
      const sum = await synthTracks(score, null, this.env);
      const ir = await this.impulse(score.reverb);
      const wet = await reverbWet([sum.send], ir, rr);
      await this.env.tick();
      return finishScore(score, [sum.dry], wet, sr, now() - t0);
    });
  }

  async sfx(catalog: string, ids: string[]): Promise<Map<string, SfxClip[]>> {
    const sr = this.sampleRate, rr = sr / REVERB_DECIMATION, defs = (SFX_CATALOGS[catalog] ?? []).filter(d => ids.includes(d.id));
    return this.withFallback(async () => {
      const ir = await this.impulse('room'), tail = sfxTail(ir);
      // spread effects over the pool by their variation count
      const n = this.parallelism, groups: string[][] = Array.from({ length: n }, () => []), load = new Array(n).fill(0);
      for (const d of [...defs].sort((a, b) => b.variations - a.variations)) { const k = load.indexOf(Math.min(...load)); groups[k]!.push(d.id); load[k] += d.variations; }
      const parts = await Promise.all(groups.filter(g => g.length).map(async group => {
        const s = await this.call<{ parts: SfxPart[]; sum: StemSum }>({ type: 'sfx', catalog, ids: group, sampleRate: sr, tail });
        this.mark(`sfx synth ${group.length} (${(s.sum.dry.l.length / sr).toFixed(1)} s)`);
        const wet = await reverbWet([s.sum.send], ir, rr);
        this.mark('sfx reverb');
        return this.call<Map<string, SfxClip[]>>({ type: 'sfx-finish', parts: s.parts, dry: s.sum.dry, wet, sampleRate: sr, tail }, stereoBuffers(s.sum.dry, ...(wet ? [wet] : [])));
      }));
      const out = new Map<string, SfxClip[]>();
      for (const m of parts) for (const [k, v] of m) out.set(k, v);
      return out;
    }, async () => {
      const ir = await this.impulse('room'), tail = sfxTail(ir);
      const s = await synthSfx(defs, this.env, tail);
      const wet = await reverbWet([s.sum.send], ir, rr);
      return finishSfx(s.parts, s.sum.dry, wet, sr, tail);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) p.reject(new Error('render service disposed'));
    this.pending.clear();
    for (const w of this.pool ?? []) w.worker.terminate();
    this.pool = null;
  }
}
