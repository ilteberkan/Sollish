'use client';
import { PLAN_TICKS, type PlanEntry, type V5Mind } from '@sollish/protocol';
import { useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import s from './ringside-corner-board.module.css';

/** Live corner view: the coach plan in force (Jev or fallback) and what each learner is weighing now. */
export function CornerBoard({ plans, minds, tick, pending }: { plans: readonly PlanEntry[]; minds: readonly V5Mind[]; tick: number; pending: boolean }) {
  const t = useT('ringside');
  const entry = plans[Math.min(plans.length - 1, Math.floor(tick / PLAN_TICKS))];
  if (!entry) return null;
  const move = (a: string) => t.has(`board.move.${a}`) ? t(`board.move.${a}` as MessageKey<'ringside'>) : a;
  return <div className={s.board} aria-label={t('board.aria')}>
    {(['kor', 'ayaz'] as const).map(side => {
      const plan = entry.plans[side], mind = minds.filter(m => m.side === side && m.tick <= tick).at(-1);
      return <section key={side} data-side={side}>
        <header><b>{side.toUpperCase()}</b><span data-source={entry.source}>{entry.source === 'jev' ? t('board.jev') : t('board.fallback')}</span></header>
        <p className={s.plan}>{t(`board.intent.${plan.intent}`)} · {t(`board.target.${plan.target}`)} · {t(`board.threat.${plan.threat}`)}</p>
        {mind && <ol className={s.mind} aria-label={t('board.thinking', { side: side.toUpperCase() })}>{mind.top.map(([a, p]) => <li key={a} data-chosen={a === mind.action}><span>{move(a)}</span><i style={{ width: `${p / 10}%` }}/><small>{t('board.percent', { n: Math.round(p / 10) })}</small></li>)}</ol>}
      </section>;
    })}
    {pending && <p className={s.wait} role="status">{t('board.wait')}</p>}
  </div>;
}
