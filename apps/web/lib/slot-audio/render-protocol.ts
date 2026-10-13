/**
 * Messages and catalogues shared by the render service and its worker. Kept separate so the worker
 * entry does not import the module that spawns it (that cycle hangs the production bundler).
 */
import type { SfxPart } from './render';
import type { Stereo } from './synth/dsp';
import type { Score } from './scores/types';
import { CASCADE_SFX, type SfxDef } from './sfx/cascade';
import { STORM_SFX } from './sfx/storm';
import { EBRU_SFX } from './sfx/ebru';

export const SFX_CATALOGS: Record<string, SfxDef[]> = { cascade: CASCADE_SFX, storm: STORM_SFX, ebru: EBRU_SFX };

export type WorkerRequest =
  | { id: number; type: 'tracks'; score: Score; trackIds: string[]; sampleRate: number }
  | { id: number; type: 'finish'; score: Score; dry: Stereo[]; wet: Stereo | null; sampleRate: number; renderMs: number }
  | { id: number; type: 'impulse'; name: 'hall' | 'room'; sampleRate: number }
  | { id: number; type: 'sfx'; catalog: string; ids: string[]; sampleRate: number; tail: number }
  | { id: number; type: 'sfx-finish'; parts: SfxPart[]; dry: Stereo; wet: Stereo | null; sampleRate: number; tail: number };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
export type { WithoutId };
