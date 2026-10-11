/**
 * Render worker: pure-JS synthesis and mastering for the slot audio renderer (see render-service.ts).
 * Receives plain score data or an effects catalog name; returns Float32Array buffers by transfer.
 */
import { createRenderEnv, finishScore, finishSfx, scoreImpulse, synthSfx, synthTracks, type RenderEnv, type RenderedAsset, type SfxClip } from './render';
import { SFX_CATALOGS, type WorkerRequest, type WorkerResponse } from './render-protocol';
import type { Stereo } from './synth/dsp';

type WorkerScope = { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage: (message: WorkerResponse, transfer: Transferable[]) => void };
const scope = globalThis as unknown as WorkerScope;
const envs = new Map<number, RenderEnv>();
const envFor = (sampleRate: number) => {
  let env = envs.get(sampleRate);
  if (!env) { env = createRenderEnv(sampleRate, 1e9); envs.set(sampleRate, env); }
  return env;
};
const buffers = (...list: Stereo[]) => list.flatMap(s => [s.l.buffer as ArrayBuffer, s.r.buffer as ArrayBuffer]);

async function handle(req: WorkerRequest): Promise<[unknown, Transferable[]]> {
  switch (req.type) {
    case 'tracks': {
      const sum = await synthTracks(req.score, req.trackIds, envFor(req.sampleRate));
      return [sum, buffers(sum.dry, sum.send)];
    }
    case 'finish': {
      const asset: RenderedAsset = finishScore(req.score, req.dry, req.wet, req.sampleRate, req.renderMs);
      return [asset, buffers(asset)];
    }
    case 'impulse': {
      const ir = await scoreImpulse(envFor(req.sampleRate), req.name);
      // keep the cached copy: send a clone
      const copy = { l: ir.l.slice(), r: ir.r.slice() };
      return [copy, buffers(copy)];
    }
    case 'sfx': {
      const defs = (SFX_CATALOGS[req.catalog] ?? []).filter(d => req.ids.includes(d.id));
      const s = await synthSfx(defs, envFor(req.sampleRate), req.tail);
      return [s, buffers(s.sum.dry, s.sum.send)];
    }
    case 'sfx-finish': {
      const clips: Map<string, SfxClip[]> = finishSfx(req.parts, req.dry, req.wet, req.sampleRate, req.tail);
      return [clips, [...clips.values()].flat().flatMap(c => [c.l.buffer as ArrayBuffer, c.r.buffer as ArrayBuffer])];
    }
  }
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  handle(req).then(
    ([result, transfer]) => scope.postMessage({ id: req.id, ok: true, result }, transfer),
    err => scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, []),
  );
};
