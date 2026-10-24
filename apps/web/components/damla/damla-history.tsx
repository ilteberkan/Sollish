'use client';
import { memo, useState } from 'react';
import { playDamlaRound, type DamlaMode } from '@sollish/protocol';
import { useFormat, useT } from '@/lib/i18n/client';
import { damlaMultiplierText, damlaRoundId, parseDamlaMode } from '@/lib/damla-controls';
import { damlaHistorySummary, type DamlaHistorySummary } from '@/lib/damla-timeline';
import { Icon } from '../icons';
import { RoundBreakdownButton, RoundBreakdownDialog } from '../slot-kit/round-breakdown';
import { damlaBreakdown } from '@/lib/round-breakdown/damla';
import type { RoundBreakdown } from '@/lib/round-breakdown/types';
import { useProduct, type DemoRecord } from '../providers';
import styles from './damla-game.module.css';

export interface DamlaHistoryProps {
  /** Ledger ids of drops still falling: their rows stay hidden until the drop has landed on screen. */
  hiddenIds: ReadonlySet<string>;
  onReplay: (record: DemoRecord) => void;
  replayDisabled: boolean;
  replayingId: string | null;
  onShare?: (record: DemoRecord) => void;
}

const summaries = new Map<string, DamlaHistorySummary | null>();
function summaryOf(record: DemoRecord): DamlaHistorySummary | null {
  const meta = record.damla;
  if (!meta) return null;
  const key = `${meta.seedHex}:${meta.betCents}:${meta.mode}`;
  let hit = summaries.get(key);
  if (hit === undefined) {
    try { hit = damlaHistorySummary(playDamlaRound(meta.seedHex, meta.betCents, meta.mode as DamlaMode)); } catch { hit = null; }
    if (summaries.size > 400) summaries.clear();
    summaries.set(key, hit);
  }
  return hit;
}

/** Damla session drop list (time, mode, bet, win, pool, round id) with an exact, ledger-free replay. */
export const DamlaHistory = memo(function DamlaHistory({ hiddenIds, onReplay, replayDisabled, replayingId, onShare }: DamlaHistoryProps) {
  const { records } = useProduct();
  const t = useT('damla');
  const format = useFormat();
  const loc = format.locale;
  const relevant = records.filter(record => record.game === 'Damla' && !hiddenIds.has(record.id));
  const tBreakdown = useT('slotKit');
  const [breakdown, setBreakdown] = useState<RoundBreakdown | null>(null);
  const openBreakdown = (meta: NonNullable<DemoRecord['damla']>) => {
    try { setBreakdown(damlaBreakdown(playDamlaRound(meta.seedHex, meta.betCents, meta.mode as DamlaMode))); } catch { setBreakdown(null); }
  };
  const modeText = (mode: string) => {
    const p = parseDamlaMode(mode);
    return p ? t('history.modeValue', { risk: t(`risk.${p.risk}`), rows: p.rows }) : mode;
  };
  const detail = (record: DemoRecord) => {
    const s = summaryOf(record);
    if (!s) return record.detail;
    const vars = { pool: s.slot + 1, pools: s.rows + 1, multiplier: damlaMultiplierText(s.multiplierHundredths, loc) };
    return s.capped ? t('history.detailMax', vars) : t('history.detail', vars);
  };
  return (
    <section className={`history-section ${styles.history}`} aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">{t('history.title')}</h2>
        <span className="small muted">{t('history.scope')}</span>
      </div>
      {relevant.length ? (
        <div className="table-scroll" role="region" aria-label={t('history.tableRegion')} tabIndex={0}>
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">{t('history.time')}</th><th scope="col">{t('history.mode')}</th><th scope="col" className="text-right">{t('history.bet')}</th>
                <th scope="col" className="text-right">{t('history.win')}</th><th scope="col">{t('history.result')}</th><th scope="col">{t('history.roundId')}</th><th scope="col"><span className="sr-only">{t('history.replayColumn')}</span></th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((record, index) => record.kind === 'reset' ? (
                <tr key={record.id} className={styles.historyReset}>
                  <td>{format.time(record.at)}</td>
                  <td colSpan={6}><Icon name="history" size={14} /> {record.id.startsWith('remote-reset:') ? t('history.resetRemote') : t('history.reset')} · DEMO</td>
                </tr>
              ) : (
                <tr key={record.id} data-replaying={replayingId === record.id || undefined}>
                  <td>{format.time(record.at)}{index === 0 && <span className="sr-only"> {t('history.latest')}</span>}</td>
                  <td>{record.damla ? modeText(record.damla.mode) : '—'}</td>
                  <td className="text-right">{format.amount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{format.amount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{detail(record)}</td>
                  <td><code className={styles.roundId} title={record.damla?.seedHex}>{record.damla ? damlaRoundId(record.damla.seedHex) : '—'}</code></td>
                  <td>
                    {record.damla && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={t('history.replayAria', { id: damlaRoundId(record.damla.seedHex) })}>
                        <Icon name="history" size={15} /><span>{t('history.replay')}</span>
                      </button>
                    )}
                    {record.damla && (
                      <RoundBreakdownButton compact onClick={() => openBreakdown(record.damla!)} className={styles.replayButton} testId="history-breakdown"
                        label={tBreakdown('breakdown.historyAria', { id: record.damla.seedHex.slice(0, 8) })} />
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={t('history.shareAria', { id: damlaRoundId(record.remote.roundId) })}>
                        <Icon name="arrow" size={15} /><span>{t('history.share')}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-history"><Icon name="history" size={24} /><div><strong>{t('history.emptyTitle')}</strong><p>{t('history.emptyText')}</p></div></div>
      )}
      <RoundBreakdownDialog open={breakdown !== null} onClose={() => setBreakdown(null)} breakdown={breakdown ?? undefined}
        modeLabel={breakdown ? modeText(breakdown.mode) : undefined} />
    </section>
  );
});
