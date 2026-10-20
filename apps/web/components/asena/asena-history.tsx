'use client';
import { memo } from 'react';
import { playAsenaRound } from '@sollish/protocol';
import { useFormat, useT } from '@/lib/i18n/client';
import { asenaRoundId } from '@/lib/asena-controls';
import { asenaHistorySummary, asenaTimes, type AsenaHistorySummary } from '@/lib/asena-timeline';
import { Icon } from '../icons';
import { useProduct, type DemoRecord } from '../providers';
import styles from './asena-game.module.css';

export interface AsenaHistoryProps {
  onReplay: (record: DemoRecord) => void;
  /** True while a round, autoplay or replay is running (replays never overlap a real round). */
  replayDisabled: boolean;
  replayingId: string | null;
  /** Remote (server-verified) mode only: publish a signed replay of a server round and share its link. */
  onShare?: (record: DemoRecord) => void;
}

/** The stored `record.detail` is Turkish; the row is re-derived from the engine round (same seed, bet and mode) in the active language. */
const summaries = new Map<string, AsenaHistorySummary | null>();
function summaryOf(record: DemoRecord): AsenaHistorySummary | null {
  const meta = record.asena;
  if (!meta) return null;
  const key = `${meta.seedHex}:${meta.betCents}:${meta.mode}`;
  let hit = summaries.get(key);
  if (hit === undefined) {
    try { hit = asenaHistorySummary(playAsenaRound(meta.seedHex, meta.betCents, meta.mode)); } catch { hit = null; }
    if (summaries.size > 400) summaries.clear();
    summaries.set(key, hit);
  }
  return hit;
}

/** Asena session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const AsenaHistory = memo(function AsenaHistory({ onReplay, replayDisabled, replayingId, onShare }: AsenaHistoryProps) {
  const { records } = useProduct();
  const t = useT('asena');
  const tc = useT('common');
  const format = useFormat();
  const loc = format.locale;
  const relevant = records.filter(record => record.game === 'Asena');
  const time = (at: number) => format.time(at);
  const detail = (record: DemoRecord) => {
    const s = summaryOf(record);
    if (!s) return record.detail;
    const times = asenaTimes(s.total, loc);
    switch (s.kind) {
      case 'capped': return t('history.detail.capped', { times });
      case 'free': return t('history.detail.free', { spins: s.spins, multiplier: s.globalMultiplier, times });
      case 'none': return t('history.detail.none');
      case 'base': return t('history.detail.base', { clusters: s.clusters, stars: s.stars, moons: s.moons, times });
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
                  <td>{record.asena ? <span className={`${styles.modeTag} ${styles[`mode_${record.asena.mode}`] ?? ''}`}>{tc(`modes.${record.asena.mode}`)}</span> : '—'}</td>
                  <td className="text-right">{record.asena ? format.amount(record.asena.betCents) : format.amount(record.stake)}</td>
                  <td className="text-right">{format.amount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{format.amount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{detail(record)}</td>
                  <td><code className={styles.roundId} title={record.asena?.seedHex}>{record.asena ? asenaRoundId(record.asena.seedHex) : '—'}</code></td>
                  <td>
                    {record.asena && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={t('history.replayAria', { id: asenaRoundId(record.asena.seedHex) })}>
                        <Icon name="history" size={15} /><span>{t('history.replay')}</span>
                      </button>
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={t('history.shareAria', { id: asenaRoundId(record.remote.roundId) })}>
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
    </section>
  );
});
