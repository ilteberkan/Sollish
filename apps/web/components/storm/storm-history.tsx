'use client';
import { memo, useMemo } from 'react';
import { playStormRound, type StormMode } from '@sollish/protocol';
import { useFormat, useT } from '@/lib/i18n/client';
import { stormRoundId } from '@/lib/storm-controls';
import { stormHistoryParts, type StormHistoryParts } from '@/lib/storm-timeline';
import { Icon } from '../icons';
import { useProduct, type DemoRecord } from '../providers';
import styles from './tarhun-game.module.css';

export interface StormHistoryProps {
  onReplay: (record: DemoRecord) => void;
  /** True while a round, autoplay or replay is running (replays never overlap a real round). */
  replayDisabled: boolean;
  replayingId: string | null;
  /** Remote (server-verified) mode only: publish a signed replay of a server round and share its link. */
  onShare?: (record: DemoRecord) => void;
}

/* The ledger stores the result line in Turkish. The row text is rebuilt from the engine round (same seed, bet and
   mode as a replay) so it follows the language; one entry per round, computed once. */
const partsCache = new Map<string, StormHistoryParts | null>();
function partsOf(seedHex: string, betCents: number, mode: StormMode): StormHistoryParts | null {
  const key = `${seedHex}|${betCents}|${mode}`;
  let parts = partsCache.get(key);
  if (parts === undefined) {
    try { parts = stormHistoryParts(playStormRound(seedHex, betCents, mode)); } catch { parts = null; }
    partsCache.set(key, parts);
  }
  return parts;
}

/** Tarhun session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const StormHistory = memo(function StormHistory({ onReplay, replayDisabled, replayingId, onShare }: StormHistoryProps) {
  const { records } = useProduct();
  const t = useT('tarhun');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const relevant = records.filter(record => record.game === 'Tarhun');
  const detail = useMemo(() => (record: DemoRecord): string => {
    const parts = record.storm ? partsOf(record.storm.seedHex, record.storm.betCents, record.storm.mode) : null;
    if (!parts) return record.detail;
    const times = format.amount(parts.kind === 'none' ? 0 : parts.totalHundredths);
    switch (parts.kind) {
      case 'capped': return t('history.capped', { times });
      case 'free': return parts.totalMultiplier > 0 ? t('history.freeTotal', { spins: String(parts.spins), multiplier: String(parts.totalMultiplier), times }) : t('history.free', { spins: String(parts.spins), times });
      case 'none': return t('history.none');
      case 'tumbles': return parts.multiplier > 0 ? t('history.tumblesMultiplied', { n: parts.tumbles, multiplier: String(parts.multiplier), times }) : t('history.tumbles', { n: parts.tumbles, times });
    }
  }, [t, format]);
  return (
    <section className={`history-section ${styles.history}`} aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">{tc('game.historyTitle')}</h2>
        <span className="small muted">{t('history.scope')}</span>
      </div>
      {relevant.length ? (
        <div className="table-scroll">
          <table className={`history-table ${styles.historyTable}`}>
            <thead>
              <tr>
                <th scope="col">{t('history.time')}</th><th scope="col">{t('history.mode')}</th><th scope="col" className="text-right">{tk('bet.label')}</th><th scope="col" className="text-right">{tk('bet.cost')}</th>
                <th scope="col" className="text-right">{t('history.win')}</th><th scope="col">{t('history.result')}</th><th scope="col">{t('history.roundId')}</th><th scope="col"><span className="sr-only">{t('history.replay')}</span></th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((record, index) => record.kind === 'reset' ? (
                <tr key={record.id} className={styles.historyReset}>
                  <td>{format.time(record.at)}</td>
                  <td colSpan={7}><Icon name="history" size={14} /> {record.id.startsWith('remote-reset:') ? t('history.refilledRemote') : t('history.refilled')} · DEMO</td>
                </tr>
              ) : (
                <tr key={record.id} data-replaying={replayingId === record.id || undefined}>
                  <td>{format.time(record.at)}{index === 0 && <span className="sr-only"> {t('history.latest')}</span>}</td>
                  <td>{record.storm ? <span className={`${styles.modeTag} ${styles[`mode_${record.storm.mode}`] ?? ''}`}>{tc(`modes.${record.storm.mode}`)}</span> : '—'}</td>
                  <td className="text-right">{record.storm ? format.amount(record.storm.betCents) : format.amount(record.stake)}</td>
                  <td className="text-right">{format.amount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{format.amount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{detail(record)}</td>
                  <td><code className={styles.roundId} title={record.storm?.seedHex}>{record.storm ? stormRoundId(record.storm.seedHex) : '—'}</code></td>
                  <td>
                    {record.storm && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={t('history.replayAria', { id: stormRoundId(record.storm.seedHex) })}>
                        <Icon name="history" size={15} /><span>{t('history.replay')}</span>
                      </button>
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={t('history.shareAria', { id: stormRoundId(record.remote.roundId) })}>
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
