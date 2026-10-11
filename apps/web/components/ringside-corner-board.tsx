'use client';
import { FIGHT_STYLE_LABELS, PLAN_TICKS, type PlanEntry, type V5Mind } from '@sollish/protocol';
import s from './ringside-corner-board.module.css';

const ACTION: Record<string, string> = { jab: 'jab', cross: 'düz', leadHook: 'ön kroşe', rearHook: 'arka kroşe', uppercut: 'aparkat', bodyHook: 'gövde kroşesi', teep: 'ön tekme', lowKick: 'alçak tekme', bodyKick: 'gövde tekmesi', headKick: 'kafa tekmesi', knee: 'diz', advance: 'ileri', retreat: 'geri', circleLeft: 'sola dön', circleRight: 'sağa dön', guard: 'gard', slip: 'sıyrıl', roll: 'eğil', clinch: 'klinç' };
const TARGET = { head: 'kafa', body: 'gövde' } as const;
const THREAT = { straight: 'düzlere dikkat', hook: 'kroşelere dikkat', upper: 'aparkata dikkat', body: 'gövdeye dikkat' } as const;

/** Live corner view: the coach plan in force (Jev or fallback) and what each learner is weighing now. */
export function CornerBoard({ plans, minds, tick, pending }: { plans: readonly PlanEntry[]; minds: readonly V5Mind[]; tick: number; pending: boolean }) {
  const entry = plans[Math.min(plans.length - 1, Math.floor(tick / PLAN_TICKS))];
  if (!entry) return null;
  return <div className={s.board} aria-label="Köşe planları ve dövüşçü kararları">
    {(['kor', 'ayaz'] as const).map(side => {
      const plan = entry.plans[side], mind = minds.filter(m => m.side === side && m.tick <= tick).at(-1);
      return <section key={side} data-side={side}>
        <header><b>{side.toUpperCase()}</b><span data-source={entry.source}>{entry.source === 'jev' ? 'Jev planı' : 'yedek plan'}</span></header>
        <p className={s.plan}>{FIGHT_STYLE_LABELS[plan.intent]} · {TARGET[plan.target]} · {THREAT[plan.threat]}</p>
        {mind && <ol className={s.mind} aria-label={`${side.toUpperCase()} şu an tartıyor`}>{mind.top.map(([a, p]) => <li key={a} data-chosen={a === mind.action}><span>{ACTION[a] ?? a}</span><i style={{ width: `${p / 10}%` }}/><small>{Math.round(p / 10)}%</small></li>)}</ol>}
      </section>;
    })}
    {pending && <p className={s.wait} role="status">Sıradaki koç planı bekleniyor…</p>}
  </div>;
}
