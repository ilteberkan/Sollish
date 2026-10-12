'use client';
import { memo } from 'react';
import { formatAmount } from '@/lib/slot-kit/bet';
import { STORM_MODE_LABELS, stormRoundId } from '@/lib/storm-controls';
import { Icon } from '../icons';
import { useProduct, type DemoRecord } from '../providers';
import styles from './tarhun-game.module.css';

export interface StormHistoryProps {
  onReplay: (record: DemoRecord) => void;
  /** True while a round, autoplay or replay is running (replays never overlap a real round). */
  replayDisabled: boolean;
  replayingId: string | null;
}

const time = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Tarhun session round list (time, mode, bet, cost, win, round id) with an exact, ledger-free replay. */
export const StormHistory = memo(function StormHistory({ onReplay, replayDisabled, replayingId }: StormHistoryProps) {
  const { records } = useProduct();
  const relevant = records.filter(record => record.game === 'Tarhun');
  return (
    <section className={`history-section ${styles.history}`} aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">Oyun geçmişin</h2>
        <span className="small muted">Bu oturum · tekrar bakiyeyi değiştirmez</span>
      </div>
      {relevant.length ? (
        <div className="table-scroll">
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
                  <td>{record.storm ? <span className={`${styles.modeTag} ${styles[`mode_${record.storm.mode}`] ?? ''}`}>{STORM_MODE_LABELS[record.storm.mode]}</span> : '—'}</td>
                  <td className="text-right">{record.storm ? formatAmount(record.storm.betCents) : formatAmount(record.stake)}</td>
                  <td className="text-right">{formatAmount(record.stake)}</td>
                  <td className={`text-right ${record.payout > record.stake ? 'positive' : ''}`}>{formatAmount(record.payout)} <span className="muted">DEMO</span></td>
                  <td>{record.detail}</td>
                  <td><code className={styles.roundId} title={record.storm?.seedHex}>{record.storm ? stormRoundId(record.storm.seedHex) : '—'}</code></td>
                  <td>
                    {record.storm && (
                      <button type="button" className={styles.replayButton} disabled={replayDisabled} onClick={() => onReplay(record)}
                        aria-label={`Tekrar oynat: tur ${stormRoundId(record.storm.seedHex)}, bakiye değişmez`}>
                        <Icon name="history" size={15} /><span>Tekrar oynat</span>
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
