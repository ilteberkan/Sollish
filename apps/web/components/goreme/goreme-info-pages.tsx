'use client';
import type { ReactNode } from 'react';
import {
  GOREME_BET_LEVELS_CENTS, GOREME_BUY_MIN_SCATTERS, GOREME_FREE_SPINS_RETRIGGER, GOREME_LANDING_MULTIPLIERS, GOREME_MAX_BALLOON_MULTIPLIER, GOREME_MAX_FREE_SPINS,
  GOREME_MAX_LIFTS, GOREME_MAX_WIN_MULTIPLIER, GOREME_PAY_SYMBOLS, GOREME_PAYTABLE, GOREME_RTP, GOREME_SCATTER_AWARDS, GOREME_WAYS,
  type GoremeMode, type GoremePaySymbol, type GoremeSymbol as EngineSymbol,
} from '@sollish/protocol';
import { GOREME_LENGTHS } from '@/lib/paytable-labels';
import type { GameInfoPage } from '../slot-kit';
import type { Translator } from '@/lib/i18n/translator';
import type { Formatter } from '@/lib/i18n/format';
import { groupedInt, fixed1, percentPoints } from '@/lib/slot-format';
import { GOREME_COST_MODES, goremeCost, goremeRtp, goremeRtpRange } from '@/lib/goreme-controls';
import { goremeCents, goremeMoney, goremeTimes } from '@/lib/goreme-timeline';
import { richText } from '../game-rich';
import { GoremeSymbolArt } from './symbols';
import styles from './goreme-info.module.css';

/** Translators, formatter and symbol names the info pages are built with (plain data for the modal, not a component). */
export interface GoremeInfoContext { t: Translator<'goreme'>; tk: Translator<'slotKit'>; tc: Translator<'common'>; format: Formatter; labels: Readonly<Record<EngineSymbol, string>> }

const MODES: GoremeMode[] = ['standard', 'ante', 'buy'];
const HIGH = new Set<GoremePaySymbol>(['h1', 'h2', 'h3', 'h4']);
const LENGTHS = GOREME_LENGTHS;

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

/** Pay per way as a DEMO amount at the current bet: bet × ten-thousandths / 10 000, shown with up to 4 decimals. */
function perWay(betCents: number, tenThousandths: number, format: Formatter): string {
  const value = (betCents * tenThousandths) / 1_000_000; // DEMO units
  return new Intl.NumberFormat(format.intl, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

function Paytable({ betCents, ctx }: { betCents: number; ctx: GoremeInfoContext }) {
  const { t, format, labels } = ctx;
  const loc = format.locale;
  const scatter = (n: 3 | 4 | 5 | 6) => GOREME_SCATTER_AWARDS[n];
  return (
    <div className={styles.page}>
      <h3>{t('info.tab.pay')}</h3>
      <p className={styles.lead}>{richText(t, 'info.pay.lead', { bet: format.demo(betCents) })}</p>
      <ul className={styles.payGrid} aria-label={t('info.pay.gridAria')}>
        {GOREME_PAY_SYMBOLS.map(symbol => (
          <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
            <span className={styles.payArt} aria-hidden="true"><GoremeSymbolArt symbol={symbol} px="100%" /></span>
            <div className={styles.payBody}>
              <h4 className={styles.payName}>{labels[symbol]}</h4>
              <dl className={styles.payRows}>
                {[...LENGTHS].reverse().map(length => (
                  <div key={length}><dt>{t('info.pay.reels', { n: length })}</dt><dd><strong>{perWay(betCents, GOREME_PAYTABLE[symbol][length - 3]!, format)}</strong></dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.note}>{richText(t, 'info.pay.example', { name: labels.h1, amount: perWay(betCents, GOREME_PAYTABLE.h1[3]!, format), ways: groupedInt(GOREME_WAYS, loc), max: format.demo(betCents * GOREME_MAX_WIN_MULTIPLIER) })}</p>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><GoremeSymbolArt symbol="sun" px="100%" /></span>
          <div>
            <h4>{labels.sun}</h4>
            <dl className={styles.scatterRows} data-testid="goreme-sun-table">
              {([6, 5, 4, 3] as const).map(n => (
                <div key={n}><dt>{t('info.pay.suns', { n: n === 6 ? '6+' : String(n) })}</dt><dd><strong>{goremeMoney(goremeCents(betCents, scatter(n).payHundredths), loc)}</strong> <small>{t('info.pay.spins', { spins: scatter(n).spins })}</small></dd></div>
              ))}
            </dl>
            <p>{richText(t, 'info.pay.sunText')}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><GoremeSymbolArt symbol="balloon" tier={1} px="100%" /></span>
          <div>
            <h4>{labels.balloon}</h4>
            <p>{richText(t, 'info.pay.balloonText', { values: GOREME_LANDING_MULTIPLIERS.map(m => `×${m}`).join(', '), max: GOREME_MAX_BALLOON_MULTIPLIER })}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { max: groupedInt(GOREME_MAX_WIN_MULTIPLIER, loc) })}</h4>
            <p>{richText(t, 'info.pay.maxText', { amount: format.demo(betCents * GOREME_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet; text follows the active language. */
export function goremeInfoPages(betCents: number, ctx: GoremeInfoContext): GameInfoPage[] {
  const { t, tk, tc, format } = ctx;
  const loc = format.locale;
  const pct = (ratio: number, digits = 1) => percentPoints(ratio * 100, digits, loc);
  const minBet = GOREME_BET_LEVELS_CENTS[0]!, maxBet = GOREME_BET_LEVELS_CENTS[GOREME_BET_LEVELS_CENTS.length - 1]!;
  const anteFactor = format.number(GOREME_COST_MODES.ante.num / GOREME_COST_MODES.ante.den);
  const tier = (id: 'big' | 'mega' | 'super' | 'epic' | 'max') => tk(`winTier.${id}.title`);
  return [
    {
      id: 'how', title: t('info.tab.how'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.tab.how')}</h3>
          <ol className={styles.steps}>
            <li>{richText(t, 'info.how.steps.bet')}</li>
            <li>{richText(t, 'info.how.steps.spin', { factor: anteFactor })}</li>
            <li>{richText(t, 'info.how.steps.ways', { ways: groupedInt(GOREME_WAYS, loc) })}</li>
            <li>{richText(t, 'info.how.steps.lift')}</li>
            <li>{richText(t, 'info.how.steps.result')}</li>
          </ol>
          <p className={styles.note}>{t('info.how.note')}</p>
        </div>
      ),
    },
    { id: 'pay', title: t('info.tab.pay'), content: <Paytable betCents={betCents} ctx={ctx} /> },
    {
      id: 'features', title: t('info.tab.features'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.tab.features')}</h3>
          <Feature title={t('info.features.ways.title')}>
            <p>{richText(t, 'info.features.ways.text')}</p>
            <p className={styles.formula}>{richText(t, 'info.features.ways.formula')}</p>
            <p>{richText(t, 'info.features.ways.example')}</p>
          </Feature>
          <Feature title={t('info.features.lift.title')} art={<GoremeSymbolArt symbol="balloon" tier={2} px="100%" />}>
            <p>{richText(t, 'info.features.lift.text', { max: GOREME_MAX_BALLOON_MULTIPLIER, lifts: GOREME_MAX_LIFTS })}</p>
          </Feature>
          <Feature title={t('info.features.merge.title')} art={<GoremeSymbolArt symbol="balloon" tier={3} px="100%" />}>
            <p>{richText(t, 'info.features.merge.text', { max: GOREME_MAX_BALLOON_MULTIPLIER })}</p>
          </Feature>
          <Feature title={t('info.features.free.title')} art={<GoremeSymbolArt symbol="sun" px="100%" />}>
            <p>{richText(t, 'info.features.free.text', { s3: GOREME_SCATTER_AWARDS[3].spins, s4: GOREME_SCATTER_AWARDS[4].spins, s5: GOREME_SCATTER_AWARDS[5].spins, s6: GOREME_SCATTER_AWARDS[6].spins, retrigger: GOREME_FREE_SPINS_RETRIGGER, max: GOREME_MAX_FREE_SPINS })}</p>
            <p>{richText(t, 'info.features.free.sky')}</p>
          </Feature>
          <Feature title={t('info.features.cumulative.title')}>
            <p>{t('info.features.cumulative.text')}</p>
          </Feature>
          <Feature title={t('info.features.tiers.title')}>
            <p>{richText(t, 'info.features.tiers.text', { big: tier('big'), mega: tier('mega'), super: tier('super'), epic: tier('epic'), max: tier('max') })}</p>
          </Feature>
          <Feature title={t('info.features.ante.title', { cost: format.demo(goremeCost(betCents, 'ante')) })}>
            <p>{richText(t, 'info.features.ante.text', { factor: anteFactor, ante: pct(GOREME_RTP.ante.featureRate, 2), standard: pct(GOREME_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buy.title', { price: format.demo(goremeCost(betCents, 'buy')) })}>
            <p>{richText(t, 'info.features.buy.text', { suns: GOREME_BUY_MIN_SCATTERS, rtp: goremeRtp(GOREME_RTP.buy.rtp, loc) })}</p>
          </Feature>
        </div>
      ),
    },
    {
      id: 'rtp', title: t('info.tab.rtp'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.rtp.title')}</h3>
          <div className={styles.tableWrap}>
            <table data-testid="goreme-rtp-table">
              <caption className="sr-only">{t('info.rtp.caption')}</caption>
              <thead><tr><th scope="col">{t('info.rtp.colMode')}</th><th scope="col">{t('info.rtp.colCost')}</th><th scope="col">RTP</th><th scope="col">{t('info.rtp.colCi')}</th><th scope="col">{t('info.rtp.colFeature')}</th></tr></thead>
              <tbody>
                {MODES.map(mode => {
                  const r = GOREME_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{tc(`modes.${mode}`)}</th>
                      <td>{format.factor(GOREME_COST_MODES[mode].num, GOREME_COST_MODES[mode].den)}</td>
                      <td><strong>{goremeRtp(r.rtp, loc)}</strong></td>
                      <td>{goremeRtpRange(r.ciLow, r.ciHigh, loc)}</td>
                      <td>{r.featureRate >= 1 ? t('info.rtp.everyRound') : t('info.rtp.oneIn', { n: groupedInt(Math.round(1 / r.featureRate), loc) })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>{richText(t, 'info.rtp.text', {
            millions: groupedInt(GOREME_RTP.standard.rounds / 1_000_000, loc), buyMillions: groupedInt(GOREME_RTP.buy.rounds / 1_000_000, loc), hit: pct(GOREME_RTP.standard.hitRate),
            sdStandard: fixed1(GOREME_RTP.standard.stdDev, loc), sdBuy: fixed1(GOREME_RTP.buy.stdDev, loc),
          })}</p>
          <p className={styles.note}>{richText(t, 'info.rtp.note')}</p>
        </div>
      ),
    },
    {
      id: 'limits', title: t('info.tab.limits'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.limits.title')}</h3>
          <dl className={styles.facts}>
            <div><dt>{t('info.limits.range')}</dt><dd>{format.demo(minBet, { trimZeros: true })} – {format.demo(maxBet, { trimZeros: true })}</dd></div>
            <div><dt>{t('info.limits.steps')}</dt><dd>{GOREME_BET_LEVELS_CENTS.map(cents => format.amount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(goremeCost(betCents, 'ante')), buy: format.demo(goremeCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { multiplier: groupedInt(GOREME_MAX_WIN_MULTIPLIER, loc), amount: format.demo(betCents * GOREME_MAX_WIN_MULTIPLIER) })}</dd></div>
          </dl>
          <p>{t('info.limits.text1')}</p>
          <p>{t('info.limits.text2', { times: goremeTimes(GOREME_MAX_WIN_MULTIPLIER * 100, loc) })}</p>
        </div>
      ),
    },
    {
      id: 'keys', title: t('info.tab.keys'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.keys.heading')}</h3>
          <dl className={styles.facts}>
            <div><dt><kbd>{t('info.keys.space')}</kbd></dt><dd>{t('info.keys.spaceText', { option: tk('settings.spaceToSpin') })}</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>{t('info.keys.enterText')}</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>{t('info.keys.escText')}</dd></div>
            <div><dt><kbd>Tab</kbd></dt><dd>{t('info.keys.tabText')}</dd></div>
          </dl>
          <p className={styles.note}>{t('info.keys.note')}</p>
        </div>
      ),
    },
    {
      id: 'fault', title: t('info.tab.fault'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.fault.title')}</h3>
          <p>{richText(t, 'info.fault.p1')}</p>
          <p>{t('info.fault.p2')}</p>
          <p>{t('info.fault.p3')}</p>
        </div>
      ),
    },
  ];
}
