'use client';
import { memo, useMemo, useState } from 'react';
import { playEbruRound, type EbruMode } from '@sollish/protocol';
import { useFormat, useT } from '@/lib/i18n/client';
import { ebruRoundId } from '@/lib/ebru-controls';
import { ebruHistoryParts, type EbruHistoryParts } from '@/lib/ebru-timeline';
import { Icon } from '../icons';
import { RoundBreakdownButton, RoundBreakdownDialog } from '../slot-kit/round-breakdown';
import { ebruBreakdown } from '@/lib/round-breakdown/ebru';
import type { RoundBreakdown } from '@/lib/round-breakdown/types';
import { useProduct, type DemoRecord } from '../providers';
import styles from './ebru-game.module.css';

export interface EbruHistoryProps {
  onReplay: (record: DemoRecord) => void;
  /** True while a round, autoplay or replay is running (replays never overlap a real round). */
  replayDisabled: boolean;
  replayingId: string | null;
  /** Remote (server-verified) mode only: publish a signed replay of a server round and share its link. */
  onShare?: (record: DemoRecord) => void;
}

/* The ledger stores the result line in Turkish. The row text is rebuilt from the engine round (same seed, bet and
   mode as a replay) so it follows the language; one entry per round, computed once. */
const partsCache = new Map<string, EbruHistoryParts | null>();
function partsOf(seedHex: string, betCents: number, mode: EbruMode): EbruHistoryParts | null {
  const key = `${seedHex}|${betCents}|${mode}`;
  let parts = partsCache.get(key);
  if (parts === undefined) {
    try { parts = ebruHistoryParts(playEbruRound(seedHex, betCents, mode)); } catch { parts = null; }
    partsCache.set(key, parts);
  }
  return parts;
}

/** Session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const EbruHistory = memo(function EbruHistory({ onReplay, replayDisabled, replayingId, onShare }: EbruHistoryProps) {
  const { records } = useProduct();
  const t = useT('ebru');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const relevant = records.filter(record => record.game === 'Ebru');
  const tBreakdown = useT('slotKit');
  const [breakdown, setBreakdown] = useState<RoundBreakdown | null>(null);
  const openBreakdown = (meta: NonNullable<DemoRecord['ebru']>) => {
    try { setBreakdown(ebruBreakdown(playEbruRound(meta.seedHex, meta.betCents, meta.mode as EbruMode))); } catch { setBreakdown(null); }
  };
  const detail = useMemo(() => (record: DemoRecord): string => {
    const parts = record.ebru ? partsOf(record.ebru.seedHex, record.ebru.betCents, record.ebru.mode) : null;
    if (!parts) return record.detail;
    const times = format.amount(parts.kind === 'none' ? 0 : parts.totalHundredths);
    switch (parts.kind) {
      case 'capped': return t('history.capped', { times });
      case 'free': return parts.maxStain > 0 ? t('history.freeStain', { spins: String(parts.spins), stain: String(parts.maxStain), times }) : t('history.free', { spins: String(parts.spins), times });
      case 'none': return t('history.none');
      case 'clusters': {
        const base = t('history.clusters', { n: parts.clusters });
        const items = [base];
        if (parts.combWins > 0) items.push(t('history.combWins', { n: parts.combWins }));
        if (parts.combs > 0) items.push(t('history.combs', { n: parts.combs }));
        return t('history.clusterRow', { items: items.join(' · '), times });
      }
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
                  <td>{record.ebru ? <span className={`${styles.modeTag} ${styles[`mode_${record.ebru.mode}`] ?? ''}`}>{tc(`modes.${record.ebru.mode}`)}</span> : '—'}</td>
                  <td className="text-right">{record.ebru ? format.amount(record.ebru.betCents) : format.amount(record.stake)}</td>
                  <td className="text-right">{format.amount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{format.amount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{detail(record)}</td>
                  <td><code className={styles.roundId} title={record.ebru?.seedHex}>{record.ebru ? ebruRoundId(record.ebru.seedHex) : '—'}</code></td>
                  <td>
                    {record.ebru && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={t('history.replayAria', { id: ebruRoundId(record.ebru.seedHex) })}>
                        <Icon name="history" size={15} /><span>{t('history.replay')}</span>
                      </button>
                    )}
                    {record.ebru && (
                      <RoundBreakdownButton compact onClick={() => openBreakdown(record.ebru!)} className={styles.replayButton} testId="history-breakdown"
                        label={tBreakdown('breakdown.historyAria', { id: record.ebru.seedHex.slice(0, 8) })} />
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={t('history.shareAria', { id: ebruRoundId(record.remote.roundId) })}>
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
        modeLabel={breakdown ? tc(`modes.${breakdown.mode as EbruMode}`) : undefined} />
    </section>
  );
});
