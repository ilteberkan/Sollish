'use client';
import type { ReactNode } from 'react';
import {
  STORM_BET_LEVELS_CENTS, STORM_FREE_SPINS_RETRIGGER, STORM_FREE_SPINS_TRIGGER, STORM_MAX_FREE_SPINS, STORM_MAX_WIN_MULTIPLIER,
  STORM_ORB_WEIGHTS, STORM_PAYTABLE, STORM_RTP, STORM_SCATTER_PAY, type StormMode, type StormPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Formatter } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translator';
import { percentOf, percentRange } from '@/lib/slot-kit/percent';
import { inlineName } from '@/lib/slot-kit/inline-name';
import { STORM_COST_MODES, stormCost } from '@/lib/storm-controls';
import { stormCents } from '@/lib/storm-timeline';
import { StormSymbolArt } from './symbols';
import styles from './storm-info.module.css';

/** Everything the info pages need to speak the current language (they are plain data, built outside React). */
export interface StormInfoContext {
  t: Translator<'tarhun'>;
  tc: Translator<'common'>;
  tk: Translator<'slotKit'>;
  format: Formatter;
  /** Translated symbol name. */
  symbol: (symbol: StormPaySymbol | 'scatter' | 'orb') => string;
}

const MODES: StormMode[] = ['standard', 'ante', 'buy'];
const ORDER: StormPaySymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
const HIGH = new Set<StormPaySymbol>(['h1', 'h2', 'h3', 'h4']);
const TIERS = ['12+', '10–11', '8–9'] as const;
const ORB_TOTAL = STORM_ORB_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
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

function Paytable({ betCents, cx }: { betCents: number; cx: StormInfoContext }) {
  const { t, format } = cx;
  const amount = (h: number) => format.amount(stormCents(betCents, h));
  const times = (h: number) => format.amount(h);
  return (
    <div className={styles.page}>
      <h3>{t('info.pay.title')}</h3>
      <p className={styles.lead}>{t.rich('info.pay.lead', { b: bold }, { bet: format.demo(betCents) })}</p>
      <ul className={styles.payGrid} aria-label={t('info.pay.symbolsAria')}>
        {ORDER.map(symbol => {
          const [t8, t10, t12] = STORM_PAYTABLE[symbol];
          return (
            <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><StormSymbolArt symbol={symbol} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{cx.symbol(symbol)}</h4>
                <dl className={styles.payRows}>
                  {[t12, t10, t8].map((h, i) => (
                    <div key={TIERS[i]}><dt>{TIERS[i]}</dt><dd><strong>{amount(h)}</strong><small>{times(h)}×</small></dd></div>
                  ))}
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><StormSymbolArt symbol="scatter" size="100%" /></span>
          <div>
            <h4>{t('info.pay.scatterTitle', { name: cx.symbol('scatter') })}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.seals6')}</dt><dd><strong>{amount(STORM_SCATTER_PAY[6])}</strong> <small>{times(STORM_SCATTER_PAY[6])}×</small></dd></div>
              <div><dt>{t('info.pay.seals5')}</dt><dd><strong>{amount(STORM_SCATTER_PAY[5])}</strong> <small>{times(STORM_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>{t('info.pay.seals4')}</dt><dd><strong>{amount(STORM_SCATTER_PAY[4])}</strong> <small>{times(STORM_SCATTER_PAY[4])}×</small></dd></div>
            </dl>
            <p>{t.rich('info.pay.scatterText', { b: bold }, { spins: STORM_FREE_SPINS_TRIGGER })}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><StormSymbolArt symbol="orb" multiplier={25} size="100%" /></span>
          <div>
            <h4>{t('info.pay.orbTitle', { name: cx.symbol('orb') })}</h4>
            <p>{t('info.pay.orbText', { features: t('info.features.title') })}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { n: format.number(STORM_MAX_WIN_MULTIPLIER, 0) })}</h4>
            <p>{t.rich('info.pay.maxText', { b: bold }, { amount: format.demo(betCents * STORM_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function stormInfoPages(betCents: number, cx: StormInfoContext): GameInfoPage[] {
  const { t, tc, tk, format } = cx;
  const minBet = STORM_BET_LEVELS_CENTS[0]!, maxBet = STORM_BET_LEVELS_CENTS[STORM_BET_LEVELS_CENTS.length - 1]!;
  const intl = format.intl;
  const pct = (ratio: number, digits = 1) => percentOf(intl, ratio, digits);
  const fixed1 = (n: number) => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  const anteFactor = STORM_COST_MODES.ante;
  const modeLabel = (mode: StormMode) => tc(`modes.${mode}`);
  return [
    {
      id: 'how', title: t('info.how.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.how.title')}</h3>
          <ol className={styles.steps}>
            <li>{t.rich('info.how.s1', { b: bold }, { max: tk('bet.max') })}</li>
            <li>{t.rich('info.how.s2', { b: bold }, { multiple: format.number(anteFactor.num / anteFactor.den, 2) })}</li>
            <li>{t.rich('info.how.s3', { b: bold })}</li>
            <li>{t.rich('info.how.s4', { b: bold })}</li>
            <li>{t.rich('info.how.s5', { b: bold })}</li>
            <li>{t.rich('info.how.s6', { b: bold }, { quick: tk('settings.speedQuick'), turbo: tk('settings.speedTurbo') })}</li>
          </ol>
          <p className={styles.note}>{t('info.how.note')}</p>
        </div>
      ),
    },
    { id: 'pay', title: t('info.pay.title'), content: <Paytable betCents={betCents} cx={cx} /> },
    {
      id: 'features', title: t('info.features.title'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.features.title')}</h3>
          <Feature title={t('info.features.tumbleTitle')} art={<StormSymbolArt symbol="l1" size="100%" />}>
            <p>{t('info.features.tumbleText')}</p>
          </Feature>
          <Feature title={t('info.features.orbTitle')} art={<StormSymbolArt symbol="orb" multiplier={100} size="100%" />}>
            <p>{t.rich('info.features.orbText', { b: bold })}</p>
            <ul className={styles.orbRow} aria-label={t('info.features.orbListAria')}>
              {STORM_ORB_WEIGHTS.map(([value, weight]) => (
                <li key={value}><span aria-hidden="true"><StormSymbolArt symbol="orb" multiplier={value} size="100%" /></span><strong>×{value}</strong><small>{pct(weight / ORB_TOTAL, weight / ORB_TOTAL < 0.001 ? 3 : 1)}</small></li>
              ))}
            </ul>
          </Feature>
          <Feature title={t('info.features.totalTitle')} art={<StormSymbolArt symbol="orb" multiplier={250} size="100%" />}>
            <p>{t.rich('info.features.totalText', { b: bold })}</p>
          </Feature>
          <Feature title={t('info.features.sealTitle')} art={<StormSymbolArt symbol="scatter" size="100%" />}>
            <p>{t('info.features.sealText', { trigger: STORM_FREE_SPINS_TRIGGER, retrigger: STORM_FREE_SPINS_RETRIGGER, max: STORM_MAX_FREE_SPINS })}</p>
          </Feature>
          <Feature title={t('info.features.freeTitle')}>
            <p>{t('info.features.freeText', { screen: `${t('total.titleA')} — ${t('total.titleB')}` })}</p>
          </Feature>
          <Feature title={t('info.features.tiersTitle')}>
            <p>{t.rich('info.features.tiersText', { b: bold }, { big: tk('winTier.big.title'), mega: tk('winTier.mega.title'), super: tk('winTier.super.title'), epic: tk('winTier.epic.title'), max: tk('winTier.max.title') })}</p>
          </Feature>
          <Feature title={t('info.features.anteTitle', { cost: format.demo(stormCost(betCents, 'ante')) })}>
            <p>{t.rich('info.features.anteText', { b: bold }, { multiple: format.number(anteFactor.num / anteFactor.den, 2), ante: pct(STORM_RTP.ante.featureRate, 2), standard: pct(STORM_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buyTitle', { price: format.demo(stormCost(betCents, 'buy')) })}>
            <p>{t.rich('info.features.buyText', { b: bold }, { spins: STORM_FREE_SPINS_TRIGGER, rtp: pct(STORM_RTP.buy.rtp) })}</p>
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
                  const r = STORM_RTP[mode];
                  const cost = STORM_COST_MODES[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{modeLabel(mode)}</th>
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
          <p>{t.rich('info.rtp.method', { code }, {
            millions: format.number(STORM_RTP.standard.rounds / 1_000_000, 0), hit: pct(STORM_RTP.standard.hitRate), hitAnte: pct(STORM_RTP.ante.hitRate),
            sdStandard: fixed1(STORM_RTP.standard.stdDev), sdBuy: fixed1(STORM_RTP.buy.stdDev),
          })}</p>
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
            <div><dt>{t('info.limits.levels')}</dt><dd>{STORM_BET_LEVELS_CENTS.map(cents => format.amount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(stormCost(betCents, 'ante')), buy: format.demo(stormCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { n: format.number(STORM_MAX_WIN_MULTIPLIER, 0), amount: format.demo(betCents * STORM_MAX_WIN_MULTIPLIER) })}</dd></div>
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
          <p className={styles.note}>{t('info.keys.note', { example: t('announce.cluster', { count: 8, name: inlineName(t.locale, cx.symbol('h1')), times: format.amount(960) }) })}</p>
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
