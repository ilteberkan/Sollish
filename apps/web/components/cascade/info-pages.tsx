'use client';
import type { ReactNode } from 'react';
import {
  CASCADE2_BET_LEVELS_CENTS, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_RTP, CASCADE_FREE_SPINS_RETRIGGER, CASCADE_FREE_SPINS_TRIGGER,
  CASCADE_MAX_FREE_SPINS, type CascadeMode,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Formatter } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translator';
import { percentOf, percentRange } from '@/lib/slot-kit/percent';
import { inlineName } from '@/lib/slot-kit/inline-name';
import { CASCADE_COST_MODES, cascadeCost } from '@/lib/cascade-controls';
import { PaytableContent } from './paytable';
import { SymbolArt, type CascadeArtSymbol } from './symbols';
import styles from './info.module.css';

/** Everything the info pages need to speak the current language (they are plain data, built outside React). */
export interface CascadeInfoContext {
  t: Translator<'cascade'>;
  tc: Translator<'common'>;
  tk: Translator<'slotKit'>;
  format: Formatter;
  /** Translated symbol name. */
  symbol: (symbol: CascadeArtSymbol) => string;
}

const MODES: CascadeMode[] = ['standard', 'ante', 'buy'];
const bold = (chunk: string) => <strong key={chunk}>{chunk}</strong>;
const code = (chunk: string) => <code key={chunk}>{chunk}</code>;

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function cascadeInfoPages(betCents: number, cx: CascadeInfoContext): GameInfoPage[] {
  const { t, tc, tk, format } = cx;
  const minBet = CASCADE2_BET_LEVELS_CENTS[0]!, maxBet = CASCADE2_BET_LEVELS_CENTS[CASCADE2_BET_LEVELS_CENTS.length - 1]!;
  const intl = format.intl;
  const pct = (ratio: number, digits = 1) => percentOf(intl, ratio, digits);
  const anteFactor = CASCADE_COST_MODES.ante;
  const multiple = format.number(anteFactor.num / anteFactor.den, 2);
  return [
    {
      id: 'how', title: t('info.how.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.how.title')}</h3>
          <ol className={styles.steps}>
            <li>{t.rich('info.how.s1', { b: bold }, { max: tk('bet.max') })}</li>
            <li>{t.rich('info.how.s2', { b: bold }, { multiple })}</li>
            <li>{t.rich('info.how.s3', { b: bold })}</li>
            <li>{t.rich('info.how.s4', { b: bold })}</li>
            <li>{t.rich('info.how.s5', { b: bold }, { quick: tk('settings.speedQuick'), turbo: tk('settings.speedTurbo') })}</li>
          </ol>
          <p className={styles.note}>{t('info.how.note')}</p>
        </div>
      ),
    },
    { id: 'pay', title: t('info.pay.title'), content: <><h3 className={styles.pageTitle}>{t('info.pay.title')}</h3><PaytableContent betCents={betCents} t={t} format={format} symbol={cx.symbol} /></> },
    {
      id: 'features', title: t('info.features.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.features.title')}</h3>
          <Feature title={t('info.features.tumbleTitle')} art={<SymbolArt symbol="strawberry" size="100%" />}>
            <p>{t('info.features.tumbleText')}</p>
          </Feature>
          <Feature title={t('info.features.starTitle')} art={<SymbolArt symbol="star" size="100%" />}>
            <p>{t('info.features.starText', { trigger: CASCADE_FREE_SPINS_TRIGGER, retrigger: CASCADE_FREE_SPINS_RETRIGGER, max: CASCADE_MAX_FREE_SPINS })}</p>
          </Feature>
          <Feature title={t('info.features.crystalTitle')} art={<SymbolArt symbol="crystal" multiplier={25} size="100%" />}>
            <p>{t('info.features.crystalText')}</p>
          </Feature>
          <Feature title={t('info.features.freeTitle')}>
            <p>{t('info.features.freeText', { screen: t('total.title') })}</p>
          </Feature>
          <Feature title={t('info.features.tiersTitle')}>
            <p>{t.rich('info.features.tiersText', { b: bold }, { big: tk('winTier.big.title'), mega: tk('winTier.mega.title'), super: tk('winTier.super.title'), epic: tk('winTier.epic.title'), max: tk('winTier.max.title') })}</p>
          </Feature>
          <Feature title={t('info.features.anteTitle', { cost: format.demo(cascadeCost(betCents, 'ante')) })}>
            <p>{t.rich('info.features.anteText', { b: bold }, { multiple, ante: pct(CASCADE2_RTP.ante.featureRate, 2), standard: pct(CASCADE2_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buyTitle', { price: format.demo(cascadeCost(betCents, 'buy')) })}>
            <p>{t.rich('info.features.buyText', { b: bold }, { spins: CASCADE_FREE_SPINS_TRIGGER, rtp: pct(CASCADE2_RTP.buy.rtp) })}</p>
          </Feature>
        </div>
      ),
    },
    {
      id: 'rtp', title: t('info.rtp.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.rtp.heading')}</h3>
          <div className={styles.tableWrap}>
            <table>
              <caption className="sr-only">{t('info.rtp.caption')}</caption>
              <thead><tr><th scope="col">{t('info.rtp.mode')}</th><th scope="col">{t('info.rtp.cost')}</th><th scope="col">{t('info.rtp.title')}</th><th scope="col">{t('info.rtp.ci')}</th><th scope="col">{t('info.rtp.feature')}</th></tr></thead>
              <tbody>
                {MODES.map(mode => {
                  const r = CASCADE2_RTP[mode];
                  const cost = CASCADE_COST_MODES[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{tc(`modes.${mode}`)}</th>
                      <td>{format.factor(cost.num, cost.den)}</td>
                      <td><strong>{pct(r.rtp)}</strong></td>
                      <td>{percentRange(intl, r.ciLow, r.ciHigh)}</td>
                      <td>{r.featureRate >= 1 ? t('info.rtp.everyRound') : `1 / ${format.number(Math.round(1 / r.featureRate), 0)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>{t.rich('info.rtp.method', { code }, { millions: format.number(CASCADE2_RTP.standard.rounds / 1_000_000, 0), hit: pct(CASCADE2_RTP.standard.hitRate), hitAnte: pct(CASCADE2_RTP.ante.hitRate) })}</p>
          <p className={styles.note}>{t.rich('info.rtp.note', { b: bold })}</p>
        </div>
      ),
    },
    {
      id: 'limits', title: t('info.limits.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.limits.title')}</h3>
          <dl className={styles.facts}>
            <div><dt>{t('info.limits.range')}</dt><dd>{format.demo(minBet, { trimZeros: true })} – {format.demo(maxBet, { trimZeros: true })}</dd></div>
            <div><dt>{t('info.limits.levels')}</dt><dd>{CASCADE2_BET_LEVELS_CENTS.map(c => format.amount(c, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(cascadeCost(betCents, 'ante')), buy: format.demo(cascadeCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { n: format.number(CASCADE2_MAX_WIN_MULTIPLIER, 0), amount: format.demo(betCents * CASCADE2_MAX_WIN_MULTIPLIER) })}</dd></div>
          </dl>
          <p>{t('info.limits.p1')}</p>
          <p>{t('info.limits.p2')}</p>
        </div>
      ),
    },
    {
      id: 'keys', title: t('info.keys.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.keys.heading')}</h3>
          <dl className={styles.keys}>
            <div><dt><kbd>{t('info.keys.space')}</kbd></dt><dd>{t('info.keys.spaceText', { settings: tk('settings.title'), option: tk('settings.spaceToSpin') })}</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>{t('info.keys.enterText')}</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>{t('info.keys.escText')}</dd></div>
            <div><dt><kbd>Tab</kbd></dt><dd>{t('info.keys.tabText')}</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>{t('info.keys.arrowsText')}</dd></div>
            <div><dt><kbd>PageUp</kbd> <kbd>PageDown</kbd></dt><dd>{t('info.keys.pageText')}</dd></div>
          </dl>
          <p className={styles.note}>{t('info.keys.note', { example: t('announce.cluster', { count: 8, name: inlineName(t.locale, cx.symbol('strawberry')), times: format.amount(202) }) })}</p>
        </div>
      ),
    },
    {
      id: 'fault', title: t('info.fault.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.fault.title')}</h3>
          <p>{t.rich('info.fault.p1', { b: bold })}</p>
          <p>{t('info.fault.p2')}</p>
          <p>{t('info.fault.p3')}</p>
        </div>
      ),
    },
  ];
}
