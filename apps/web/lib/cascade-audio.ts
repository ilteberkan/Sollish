/**
 * Candy Cascade sound (compatibility entry point). The implementation lives in `lib/slot-audio/`:
 * original music and effects rendered offline into buffers, a bus/mix engine and the game API.
 * This file keeps the original `createCascadeAudio()` / `CascadeAudio` API working; the returned
 * object is the full `CascadeSound` (scenes, mix, ducking, count-up, UI sounds …).
 */
import { createCascadeSound, type CascadeSound } from './slot-audio/cascade-sound';

export type { CascadeAudio, CascadeSound, LoadProgress } from './slot-audio/cascade-sound';
export { loadMixSettings, saveMixSettings } from './slot-audio/cascade-sound';

export function createCascadeAudio(): CascadeSound {
  return createCascadeSound();
}
