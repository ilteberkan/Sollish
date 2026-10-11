// Tempo probe for Contact 5: strikes (punches, kicks, knees) per round, mean stamina at 10/20/40 s, mean fighter distance when a
// punch starts, and share of strikes thrown from beyond reach. Usage: tempo.ts --params <file|frozen> --n 60
import { readFileSync } from 'node:fs';
import { simulateContactCombatV5, V5_FIGHTERS } from '../../packages/protocol/src/combat-v5';
import { V5_STRIKES, type V5Strike } from '../../packages/protocol/src/combat-v5-strikes';
import { CONTACT_V5_PARAMS } from '../../packages/protocol/src/contact-v5-weights';
import type { LearnerParams } from '../../packages/protocol/src/contact-learner';
import { arg, seedOf } from './common';

const p = arg('params', 'frozen'), N = Number(arg('n', '60'));
const params: LearnerParams = p === 'frozen' ? CONTACT_V5_PARAMS : JSON.parse(readFileSync(p, 'utf8'));
let strikes = 0, out = 0, gap = 0; const st = { 200: 0, 400: 0, 800: 0 };
for (let i = 0; i < N; i++) {
  const r = simulateContactCombatV5(seedOf(`${arg('seeds', 'tempo')}:${i}`), undefined, undefined, { corners: [{ kind: 'learner', params }, { kind: 'learner', params }], minds: false });
  for (const e of r.events) if (e.type === 'strike') {
    const f = r.frames[e.tick]!, d = Math.hypot(f.kor.x - f.ayaz.x, f.kor.z - f.ayaz.z), reach = V5_STRIKES[e.technique as V5Strike].reach + V5_FIGHTERS[e.actor].reach;
    strikes++; gap += d; if (d > reach) out++;
  }
  for (const t of [200, 400, 800] as const) { const f = r.frames[Math.min(t, r.frames.length - 1)]!; st[t] += (f.kor.stamina + f.ayaz.stamina) / 2; }
}
console.log(JSON.stringify({ strikesPerRound: +(strikes / N).toFixed(1), meanDistanceMm: Math.round(gap / strikes), beyondReach: +(out / strikes).toFixed(3), stamina10s: Math.round(st[200] / N), stamina20s: Math.round(st[400] / N), stamina40s: Math.round(st[800] / N) }));
