/** Contact 5 striking table (10 Oct 2026): Contact 4's six punches plus four kicks and a close-range knee,
 * as in kickboxing and MMA stand-up. Part of the Contact 5 engine id. Contact 4 (V4_STRIKES) is untouched.
 *
 * wind = ticks before the contact check, active = ticks the limb stays out, end = total ticks (50 ms each).
 * reach is mm from body centre to body centre at which the blow lands. limb says what the broadcast moves.
 * target 'leg' (low kick) scores lightly and drains stamina; it never stuns. push moves the target back (mm).
 * kind is the defence family the blow belongs to (slip beats straight, roll beats hook, guard beats upper).
 */
import { V4_STRIKES, type V4Action, type V4Fighter, type V4Referee } from './combat-v4';
import type { FighterId } from './combat';

export type V5Limb = 'leadHand' | 'rearHand' | 'leadLeg' | 'rearLeg';
export type V5StrikeSpec = Readonly<{ wind: number; active: number; end: number; reach: number; target: 'head' | 'body' | 'leg'; kind: 'straight' | 'hook' | 'upper'; limb: V5Limb; damage: number; stun: number; cost: number; drain: number; push: number }>;

const punch = (s: typeof V4_STRIKES[keyof typeof V4_STRIKES]): V5StrikeSpec => ({ wind: s.wind, active: s.active, end: s.end, reach: s.reach, target: s.target, kind: s.kind, limb: s.hand === 'lead' ? 'leadHand' : 'rearHand', damage: s.damage, stun: s.stun, cost: s.cost, drain: s.drain, push: 0 });
export const V5_KICKS = Object.freeze({
  /** Front push kick with the lead leg to the stomach: long, cheap, pushes the opponent back. */
  teep: { wind: 4, active: 2, end: 12, reach: 1320, target: 'body', kind: 'straight', limb: 'leadLeg', damage: 24, stun: 0, cost: 70, drain: 120, push: 260 },
  /** Rear-leg roundhouse to the lead thigh: scores lightly, drains stamina. */
  lowKick: { wind: 4, active: 2, end: 12, reach: 1060, target: 'leg', kind: 'hook', limb: 'rearLeg', damage: 22, stun: 0, cost: 70, drain: 160, push: 0 },
  /** Rear-leg roundhouse to the ribs (10 Oct 2026: damage 44 -> 36, it out-hit the body hook from 290 mm further away). */
  bodyKick: { wind: 5, active: 2, end: 14, reach: 1180, target: 'body', kind: 'hook', limb: 'rearLeg', damage: 36, stun: 0, cost: 100, drain: 140, push: 0 },
  /** Rear-leg roundhouse to the head: slow and expensive (cost 130 -> 150), can knock down. */
  headKick: { wind: 7, active: 2, end: 16, reach: 1200, target: 'head', kind: 'hook', limb: 'rearLeg', damage: 60, stun: 56, cost: 150, drain: 0, push: 0 },
  /** Rear knee to the body from close range or out of a clinch. */
  knee: { wind: 3, active: 2, end: 9, reach: 640, target: 'body', kind: 'upper', limb: 'rearLeg', damage: 34, stun: 0, cost: 70, drain: 130, push: 0 },
} satisfies Record<string, V5StrikeSpec>);
export const V5_STRIKES: Readonly<Record<keyof typeof V4_STRIKES | keyof typeof V5_KICKS, V5StrikeSpec>> = Object.freeze({
  ...Object.fromEntries(Object.entries(V4_STRIKES).map(([k, s]) => [k, punch(s)])) as Record<keyof typeof V4_STRIKES, V5StrikeSpec>,
  ...V5_KICKS,
});
export type V5Kick = keyof typeof V5_KICKS;
export type V5Strike = keyof typeof V5_STRIKES;
export type V5Action = V4Action | V5Kick;
export const isV5Strike = (a: string): a is V5Strike => Object.hasOwn(V5_STRIKES, a);
export const isV5Kick = (a: string): a is V5Kick => Object.hasOwn(V5_KICKS, a);

/** Contact 5 frames and events: Contact 4's shapes with the wider action set and a 'leg' hit location. */
export type V5Fighter = Omit<V4Fighter, 'action'> & { action: V5Action };
export type V5Frame = { tick: number; kor: V5Fighter; ayaz: V5Fighter; referee: V4Referee };
export type V5Event = { tick: number; type: 'strike' | 'hit' | 'block' | 'dodge' | 'miss' | 'knockdown' | 'count' | 'rise' | 'clinch' | 'break' | 'finish'; actor: FighterId; target: FighterId; technique: V5Action; damage: number; bodyPart?: 'head' | 'body' | 'leg' | 'guard'; counter?: boolean; combo?: number; count?: number };
