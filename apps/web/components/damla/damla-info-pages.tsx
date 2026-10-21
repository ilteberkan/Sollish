'use client';
import { DAMLA_EXACT_RTP, DAMLA_MAX_WIN_MULTIPLIER, DAMLA_MODES, DAMLA_PAYTABLES, DAMLA_RTP, type DamlaMode } from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Translator } from '@/lib/i18n/translator';
import type { Formatter } from '@/lib/i18n/format';
import { DAMLA_BET_LADDER, damlaCap, damlaMultiplierText, damlaPayout, damlaPercent, parseDamlaMode } from '@/lib/damla-controls';
import { richText } from '../game-rich';
import { poolColor } from './colors';
import styles from './damla-info.module.css';

export interface DamlaInfoContext { betCents: number; mode: DamlaMode; t: Translator<'damla'>; tk: Translator<'slotKit'>; format: Formatter }

function binomial(n: number, k: number): number { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }

/** Multi-page game info (game-standards §3): how to play, the selected mode's paytable at the current bet, RTP of every
 * mode (exact binomial value and the simulation estimate), fairness, keys and the malfunction clause. */
export function damlaInfoPages({ betCents, mode, t, format }: DamlaInfoContext): GameInfoPage[] {
  const loc = format.locale;
  const parsed = parseDamlaMode(mode)!;
  const rows = parsed.rows, table = DAMLA_PAYTABLES[mode], total = 2 ** rows;
  const riskName = (r: string) => t(`risk.${r}` as 'risk.low');
  const how: GameInfoPage = {
    id: 'how', title: t('info.tab.how'),
    content: (
      <div className={styles.page}>
        <h3>{t('info.tab.how')}</h3>
        <p className={styles.lead}>{t('info.how.lead')}</p>
        <ol className={styles.steps}>
          <li>{richText(t, 'info.how.step1')}</li>
          <li>{richText(t, 'info.how.step2')}</li>
          <li>{richText(t, 'info.how.step3')}</li>
          <li>{richText(t, 'info.how.step4')}</li>
        </ol>
        <h4>{t('info.how.rainTitle')}</h4><p>{t('info.how.rain')}</p>
        <h4>{t('info.how.autoTitle')}</h4><p>{t('info.how.auto')}</p>
        <h4>{t('info.how.goldTitle')}</h4><p>{t('info.how.gold')}</p>
        <p className={styles.note}>{t('info.how.bets', { min: format.demo(DAMLA_BET_LADDER[0]!), max: format.demo(DAMLA_BET_LADDER[DAMLA_BET_LADDER.length - 1]!), maxWin: format.number(DAMLA_MAX_WIN_MULTIPLIER, 0) })}</p>
      </div>
    ),
  };
  const pay: GameInfoPage = {
    id: 'pay', title: t('info.tab.pay'),
    content: (
      <div className={styles.page}>
        <h3>{t('info.pay.title', { risk: riskName(parsed.risk), rows })}</h3>
        <p className={styles.lead}>{richText(t, 'info.pay.lead', { bet: format.demo(betCents) })}</p>
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="damla-paytable">
            <thead><tr><th scope="col">{t('info.pay.pool')}</th><th scope="col">{t('info.pay.multiplier')}</th><th scope="col" className={styles.num}>{t('info.pay.payout')}</th><th scope="col" className={styles.num}>{t('info.pay.chance')}</th></tr></thead>
            <tbody>
              {table.map((h, k) => (
                <tr key={k}>
                  <td><span className={styles.swatch} style={{ background: poolColor(Math.abs(k - rows / 2) / (rows / 2), parsed.risk === 'high') }} aria-hidden="true" />{k + 1}</td>
                  <td>×{damlaMultiplierText(h, loc)}</td>
                  <td className={styles.num}>{format.demo(damlaPayout(betCents, mode, k))}</td>
                  <td className={styles.num}>{t('info.pay.chanceValue', { ways: format.number(binomial(rows, k), 0), total: format.number(total, 0), percent: damlaPercent(binomial(rows, k) / total, loc, 4) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{t('info.pay.note', { max: damlaMultiplierText(damlaCap(mode), loc), rtp: damlaPercent(DAMLA_EXACT_RTP[mode], loc) })}</p>
      </div>
    ),
  };
  const rtp: GameInfoPage = {
    id: 'rtp', title: t('info.tab.rtp'),
    content: (
      <div className={styles.page}>
        <h3>{t('info.tab.rtp')}</h3>
        <p className={styles.lead}>{t('info.rtp.lead')}</p>
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="damla-rtp-table">
            <thead><tr><th scope="col">{t('info.rtp.mode')}</th><th scope="col" className={styles.num}>{t('info.rtp.exact')}</th><th scope="col" className={styles.num}>{t('info.rtp.edge')}</th><th scope="col" className={styles.num}>{t('info.rtp.simulated')}</th><th scope="col" className={styles.num}>{t('info.rtp.max')}</th></tr></thead>
            <tbody>
              {DAMLA_MODES.map(m => {
                const p = parseDamlaMode(m)!;
                return (
                  <tr key={m} data-current={m === mode || undefined}>
                    <td>{t('history.modeValue', { risk: riskName(p.risk), rows: p.rows })}</td>
                    <td className={styles.num}>{damlaPercent(DAMLA_EXACT_RTP[m], loc)}</td>
                    <td className={styles.num}>{damlaPercent(1 - DAMLA_EXACT_RTP[m], loc)}</td>
                    <td className={styles.num}>{damlaPercent(DAMLA_RTP[m].rtp, loc)}</td>
                    <td className={styles.num}>×{damlaMultiplierText(damlaCap(m), loc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{t('info.rtp.note')}</p>
      </div>
    ),
  };
  const fair: GameInfoPage = {
    id: 'fair', title: t('info.tab.fair'),
    content: (
      <div className={styles.page}>
        <h3>{t('info.tab.fair')}</h3>
        <p>{richText(t, 'info.fair.p1')}</p>
        <p>{richText(t, 'info.fair.p2')}</p>
        <p>{richText(t, 'info.fair.p3')}</p>
        <p className={styles.note}>{t('info.fair.note')}</p>
      </div>
    ),
  };
  const keys: GameInfoPage = {
    id: 'keys', title: t('info.tab.keys'),
    content: (
      <div className={styles.page}>
        <h3>{t('info.tab.keys')}</h3>
        <ul className={styles.steps}>
          <li>{richText(t, 'info.keys.space')}</li>
          <li>{richText(t, 'info.keys.lock')}</li>
          <li>{richText(t, 'info.keys.speed')}</li>
          <li>{richText(t, 'info.keys.motion')}</li>
        </ul>
        <h4>{t('info.keys.malfunctionTitle')}</h4>
        <p>{t('info.keys.malfunction')}</p>
      </div>
    ),
  };
  return [how, pay, rtp, fair, keys];
}
