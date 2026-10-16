'use client';
import { memo } from 'react';
import { formatAmount } from '@/lib/slot-kit/bet';
import { ASENA_MODE_LABELS, asenaRoundId } from '@/lib/asena-controls';
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

const time = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Asena session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const AsenaHistory = memo(function AsenaHistory({ onReplay, replayDisabled, replayingId, onShare }: AsenaHistoryProps) {
  const { records } = useProduct();
  const relevant = records.filter(record => record.game === 'Asena');
  return (
    <section className={`history-section ${styles.history}`} aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">Oyun geçmişin</h2>
        <span className="small muted">Bu oturum · tekrar bakiyeyi değiştirmez</span>
      </div>
      {relevant.length ? (
        <div className="table-scroll" role="region" aria-label="Oyun geçmişi tablosu" tabIndex={0}>
          <table className={`history-table ${styles.historyTable}`}>
            <thead>
              <tr>
                <th scope="col">Zaman</th><th scope="col">Mod</th><th scope="col" className="text-right">Bahis</th><th scope="col" className="text-right">Maliyet</th>
                <th scope="col" className="text-right">Kazanç</th><th scope="col">Sonuç</th><th scope="col">Tur kimliği</th><th scope="col"><span className="sr-only">Tekrar oynat</span></th>
              </tr>
            </thead>
            <tbody>
              {relevant.map((record, index) => record.kind === 'reset' ? (
                <tr key={record.id} className={styles.historyReset}>
                  <td>{time(record.at)}</td>
                  <td colSpan={7}><Icon name="history" size={14} /> {record.detail} · DEMO</td>
                </tr>
              ) : (
                <tr key={record.id} data-replaying={replayingId === record.id || undefined}>
                  <td>{time(record.at)}{index === 0 && <span className="sr-only"> Son tur</span>}</td>
                  <td>{record.asena ? <span className={`${styles.modeTag} ${styles[`mode_${record.asena.mode}`] ?? ''}`}>{ASENA_MODE_LABELS[record.asena.mode]}</span> : '—'}</td>
                  <td className="text-right">{record.asena ? formatAmount(record.asena.betCents) : formatAmount(record.stake)}</td>
                  <td className="text-right">{formatAmount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{formatAmount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{record.detail}</td>
                  <td><code className={styles.roundId} title={record.asena?.seedHex}>{record.asena ? asenaRoundId(record.asena.seedHex) : '—'}</code></td>
                  <td>
                    {record.asena && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={`Tekrar oynat: tur ${asenaRoundId(record.asena.seedHex)}, bakiye değişmez`}>
                        <Icon name="history" size={15} /><span>Tekrar oynat</span>
                      </button>
                    )}
                    {onShare && record.remote && (
                      <button type="button" className={styles.replayButton} onClick={() => onShare(record)} data-testid="share-round"
                        aria-label={`Kazancını paylaş: tur ${asenaRoundId(record.remote.roundId)}`}>
                        <Icon name="arrow" size={15} /><span>Kazancını paylaş</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-history"><Icon name="history" size={24} /><div><strong>İlk turun burada görünecek.</strong><p>Her turun modu, bahsi, maliyeti, kazancı ve tur kimliği kaydedilir; istediğin turu tekrar izleyebilirsin.</p></div></div>
      )}
    </section>
  );
});
