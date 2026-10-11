// Scripted opponents for training and held-out evaluation of the Contact 5 learner. They see the same
// observable state as the learner (V5ScriptView). TRAIN and HELD_OUT are disjoint by design: the held-out
// styles never appear during training or hyperparameter selection.
// Rule v5k (10 Oct 2026): every style now also kicks or knees in its own way (the kick set is part of the engine).
// Scripts written for rules v1-v4b are replaced by these; old evidence was produced with the old scripts and the old engine.
import type { V5ScriptView } from '../../packages/protocol/src/combat-v5';
import type { LearnerAction } from '../../packages/protocol/src/contact-learner';

type Script = (v: V5ScriptView) => LearnerAction;
const inReach = (v: V5ScriptView, r: number) => v.distance <= r;
const pick = (v: V5ScriptView, options: LearnerAction[]): LearnerAction => {
  const ok = options.filter(v.legal);
  return ok.length ? ok[v.random() % ok.length]! : 'guard';
};
const windup = (v: V5ScriptView) => v.opponent.phase === 'windup' ? v.opponent.action : null;
/** Clinched fighters can only hold or knee. */
const clinched = (v: V5ScriptView) => v.me.action === 'clinch';
const bodyBlow = (w: string | null) => w === 'bodyHook' || w === 'bodyKick' || w === 'lowKick' || w === 'teep' || w === 'knee';

export const TRAIN: Record<string, Script> = {
  // Walks forward, punches in close, knees and body-kicks at the edge of the clinch.
  pressure: v => clinched(v) ? pick(v, ['knee', 'clinch']) : !inReach(v, 870) ? 'advance' : pick(v, ['leadHook', 'rearHook', 'bodyHook', 'uppercut', 'cross', 'knee', 'bodyKick']),
  // Jab from range, teep to keep the distance.
  jabber: v => clinched(v) ? 'clinch' : v.distance < 950 ? (v.random() < 50 ? 'retreat' : pick(v, ['jab', 'circleLeft'])) : inReach(v, 1180) ? pick(v, ['jab', 'jab', 'cross', 'teep']) : 'advance',
  counter: v => {
    if (clinched(v)) return 'clinch';
    const w = windup(v);
    if (w === 'jab' || w === 'cross') return 'slip';
    if (w === 'leadHook' || w === 'rearHook' || w === 'headKick') return 'roll';
    if (bodyBlow(w)) return 'guard';
    if (v.opponent.phase === 'recovery' && inReach(v, 1050)) return pick(v, ['cross', 'leadHook', 'lowKick']);
    return v.distance > 1250 ? 'advance' : 'guard';
  },
  highGuard: v => clinched(v) ? 'clinch' : !inReach(v, 1100) ? 'advance' : v.random() < 60 ? 'guard' : pick(v, ['jab', 'cross', 'lowKick']),
  random: v => pick(v, ['jab', 'cross', 'leadHook', 'rearHook', 'uppercut', 'bodyHook', 'teep', 'lowKick', 'bodyKick', 'headKick', 'knee', 'advance', 'retreat', 'circleLeft', 'circleRight', 'guard', 'slip', 'roll', 'clinch']),
};

// Validation-only styles for choosing in-match hyperparameters; disjoint from TRAIN and HELD_OUT.
export const VALIDATION: Record<string, Script> = {
  // High guard for 22 s, then a pressure puncher.
  guardThenPress: v => v.tick < 440 ? TRAIN.highGuard!(v) : TRAIN.pressure!(v),
  // Rolls under every hook and answers with uppercuts.
  roller: v => {
    const w = windup(v);
    if (w === 'leadHook' || w === 'rearHook') return 'roll';
    if (clinched(v)) return 'clinch';
    return !inReach(v, 800) ? 'advance' : pick(v, ['uppercut', 'jab', 'guard', 'knee']);
  },
  // Lives on the jab from range, never commits.
  longJab: v => clinched(v) ? 'clinch' : v.distance < 1050 ? 'retreat' : inReach(v, 1200) ? pick(v, ['jab', 'jab', 'teep']) : pick(v, ['advance', 'circleRight']),
};

export const HELD_OUT: Record<string, Script> = {
  // Changes style at 20 s: rewards fighters that adapt inside the round.
  switcher: v => v.tick < 400 ? TRAIN.jabber!(v) : (clinched(v) ? 'knee' : !inReach(v, 870) ? 'advance' : pick(v, ['rearHook', 'uppercut', 'bodyHook', 'bodyKick'])),
  // Body puncher who covers up between attacks; low kicks and knees when close.
  bodySnatcher: v => clinched(v) ? pick(v, ['knee', 'clinch']) : !inReach(v, 870) ? 'advance' : v.random() < 35 ? 'guard' : pick(v, ['bodyHook', 'bodyHook', 'uppercut', 'lowKick', 'knee']),
  // Slips every straight punch (and teep): the jab stops working, hooks, kicks and body shots still do.
  slipper: v => {
    if (clinched(v)) return 'clinch';
    const w = windup(v);
    if (w === 'jab' || w === 'cross' || w === 'teep') return 'slip';
    return !inReach(v, 1100) ? 'advance' : pick(v, ['jab', 'cross', 'guard', 'circleRight', 'headKick', 'lowKick']);
  },
  // Mobile counter-puncher: circles, then fires after the opponent's blow, kicking low from range.
  mover: v => clinched(v) ? 'clinch' : v.opponent.phase === 'recovery' && inReach(v, 1150) ? pick(v, ['jab', 'cross', 'lowKick']) : v.distance < 900 ? 'retreat' : pick(v, ['circleLeft', 'circleRight', 'jab', 'teep']),
};
