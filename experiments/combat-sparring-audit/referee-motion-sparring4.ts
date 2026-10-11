import type * as THREE from 'three';
import { SPARRING_HZ, type SparringState } from '@sollish/protocol';
import type { AuthoredAthleteRig } from '../../apps/web/components/boxing-scene-athletes';

// Frozen pre-change referee renderer (apps/web/components/boxing-referee-motion.ts SHA256 e96ea7fa…6b15; update()
// verbatim) for the REFEREE_BASELINE=1 "before" measurement in scripts/boxing-assets/referee-motion.test.ts. Only
// expand() (a no-op: the old renderers did not add the official to the camera bounds) and gaits (null) were added.
/**
 * Presentation-only referee motion shared by the Mixamo and CMU sparring renderers. It reads the
 * engine's official (state.referee) and never writes engine state, contact, damage or results.
 * Authored Quaternius Idle_Loop/Walk_Formal_Loop clips; not motion capture.
 */
export type RefereeMotion = { readonly rig: AuthoredAthleteRig; update: (state: Readonly<SparringState>, tick: number) => void; expand: (bounds: THREE.Box3) => void; gaits: null };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };

/** clips: extra in-place locomotion clips the caller may offer for the referee's mixer (optional). */
export function createRefereeMotion(rig: AuthoredAthleteRig, { floorY }: { floorY: number; smoothing?: boolean; footwork?: readonly THREE.AnimationClip[] }): RefereeMotion {
  // Moved verbatim from boxing-mixamo-athletes.ts / boxing-mocap-athletes.ts (identical in both).
  const update = (state: Readonly<SparringState>, tick: number) => {
    const r = state.referee, fraction = tick - Math.floor(tick);
    rig.root.position.set(r.x + r.vx * fraction / SPARRING_HZ, floorY, r.z + r.vz * fraction / SPARRING_HZ); rig.root.rotation.set(0, r.facing, 0);
    for (const action of rig.actions.values()) action.setEffectiveWeight(0);
    const speed = Math.hypot(r.vx, r.vz), walk = smooth(speed / .6), seconds = tick / SPARRING_HZ;
    const idle = rig.actions.get('Idle_Loop')!, gait = rig.actions.get('Walk_Formal_Loop')!;
    idle.time = seconds % idle.getClip().duration; idle.setEffectiveWeight(1 - walk);
    gait.time = (seconds * .9) % gait.getClip().duration; gait.setEffectiveWeight(walk);
    rig.mixer.update(0); rig.root.updateMatrixWorld(true);
  };
  return { rig, update, expand: () => {}, gaits: null };
}
