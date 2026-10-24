'use client';
import { memo, useState } from 'react';
import { playGoremeRound, type GoremeMode } from '@sollish/protocol';
import { useFormat, useT } from '@/lib/i18n/client';
import { goremeRoundId } from '@/lib/goreme-controls';
import { goremeHistorySummary, goremeTimes, type GoremeHistorySummary } from '@/lib/goreme-timeline';
import { Icon } from '../icons';
import { RoundBreakdownButton, RoundBreakdownDialog } from '../slot-kit/round-breakdown';
import { goremeBreakdown } from '@/lib/round-breakdown/goreme';
import type { RoundBreakdown } from '@/lib/round-breakdown/types';
import { useProduct, type DemoRecord } from '../providers';
import styles from './goreme-game.module.css';

export interface GoremeHistoryProps {
  onReplay: (record: DemoRecord) => void;
  /** True while a round, autoplay or replay is running (replays never overlap a real round). */
  replayDisabled: boolean;
  replayingId: string | null;
  /** Remote (server-verified) mode only: publish a signed replay of a server round and share its link. */
  onShare?: (record: DemoRecord) => void;
}

/** The stored `record.detail` is Turkish; the row is re-derived from the engine round (same seed, bet and mode) in the active language. */
const summaries = new Map<string, GoremeHistorySummary | null>();
function summaryOf(record: DemoRecord): GoremeHistorySummary | null {
  const meta = record.goreme;
  if (!meta) return null;
  const key = `${meta.seedHex}:${meta.betCents}:${meta.mode}`;
  let hit = summaries.get(key);
  if (hit === undefined) {
    try { hit = goremeHistorySummary(playGoremeRound(meta.seedHex, meta.betCents, meta.mode)); } catch { hit = null; }
    if (summaries.size > 400) summaries.clear();
    summaries.set(key, hit);
  }
  return hit;
}

/** Göreme session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const GoremeHistory = memo(function GoremeHistory({ onReplay, replayDisabled, replayingId, onShare }: GoremeHistoryProps) {
  const { records } = useProduct();
  const t = useT('goreme');
  const tc = useT('common');
  const format = useFormat();
  const loc = format.locale;
  const relevant = records.filter(record => record.game === 'Göreme');
  const tBreakdown = useT('slotKit');
  const [breakdown, setBreakdown] = useState<RoundBreakdown | null>(null);
  const openBreakdown = (meta: NonNullable<DemoRecord['goreme']>) => {
    try { setBreakdown(goremeBreakdown(playGoremeRound(meta.seedHex, meta.betCents, meta.mode as GoremeMode))); } catch { setBreakdown(null); }
  };
  const time = (at: number) => format.time(at);
  const detail = (record: DemoRecord) => {
    const s = summaryOf(record);
    if (!s) return record.detail;
    const times = goremeTimes(s.total, loc);
    switch (s.kind) {
      case 'capped': return t('history.detail.capped', { times });
      case 'free': return t('history.detail.free', { spins: s.spins, sky: s.sky, times });
      case 'none': return t('history.detail.none');
      case 'base': return t('history.detail.base', { wins: s.wins, lifts: s.lifts, times });
    }
  };
  return (
    <section className={`history-section ${styles.history}`} aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">{t('history.title')}</h2>
        <span className="small muted">{t('history.scope')}</span>
      </div>
      {relevant.length ? (
        <div className="table-scroll" role="region" aria-label={t('history.tableRegion')} tabIndex={0}>
          <table className={`history-table ${styles.historyTable}`}>
            <thead>
              <tr>
                <th scope="col">{t('history.time')}</th><th scope="col">{t('history.mode')}</th><th scope="col" className="text-right">{t('history.bet')}</th><th scope="col" className="text-right">{t('history.cost')}</th>
                <th scope="col" className="text-right">{t('history.win')}</th><th scope="col">{t('history.result')}</th><th scope="col">{t('history.roundId')}</th><th scope="col"><span className="sr-only">{t('history.replayColumn')}</span></th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((record, index) => record.kind === 'reset' ? (
                <tr key={record.id} className={styles.historyReset}>
                  <td>{time(record.at)}</td>
                  <td colSpan={7}><Icon name="history" size={14} /> {record.id.startsWith('remote-reset:') ? t('history.resetRemote') : t('history.reset')} · DEMO</td>
                </tr>
              ) : (
                <tr key={record.id} data-replaying={replayingId === record.id || undefined}>
                  <td>{time(record.at)}{index === 0 && <span className="sr-only"> {t('history.latest')}</span>}</td>
                  <td>{record.goreme ? <span className={`${styles.modeTag} ${styles[`mode_${record.goreme.mode}`] ?? ''}`}>{tc(`modes.${record.goreme.mode}`)}</span> : '—'}</td>
                  <td className="text-right">{record.goreme ? format.amount(record.goreme.betCents) : format.amount(record.stake)}</td>
                  <td className="text-right">{format.amount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{format.amount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{detail(record)}</td>
                  <td><code className={styles.roundId} title={record.goreme?.seedHex}>{record.goreme ? goremeRoundId(record.goreme.seedHex) : '—'}</code></td>
                  <td>
                    {record.goreme && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={t('history.replayAria', { id: goremeRoundId(record.goreme.seedHex) })}>
                        <Icon name="history" size={15} /><span>{t('history.replay')}</span>
                      </button>
                    )}
                    {record.goreme && (
                      <RoundBreakdownButton compact onClick={() => openBreakdown(record.goreme!)} className={styles.replayButton} testId="history-breakdown"
                        label={tBreakdown('breakdown.historyAria', { id: record.goreme.seedHex.slice(0, 8) })} />
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={t('history.shareAria', { id: goremeRoundId(record.remote.roundId) })}>
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
        modeLabel={breakdown ? tc(`modes.${breakdown.mode as GoremeMode}`) : undefined} />
    </section>
  );
});
