/** Saved mix (sliders + mute) in localStorage. Its own module so every game's sound can re-export it without importing
 * cascade-sound.ts (which would pull Candy Cascade's scores and effects into the other games' routes). */
import type { MixSettings } from './timing';

const MIX_KEY = 'sollish.audio.mix.v1';
/** Read the saved mix (sliders + mute) from localStorage; safe everywhere. */
export function loadMixSettings(): Partial<MixSettings> | null {
  try { const raw = globalThis.localStorage?.getItem(MIX_KEY); return raw ? (JSON.parse(raw) as Partial<MixSettings>) : null; } catch { return null; }
}
export function saveMixSettings(mix: MixSettings): void {
  try { globalThis.localStorage?.setItem(MIX_KEY, JSON.stringify(mix)); } catch { /* storage blocked */ }
}
