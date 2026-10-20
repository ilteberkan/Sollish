'use client';
import type { ReactNode } from 'react';
import {
  ASENA_BET_LEVELS_CENTS, ASENA_FREE_SPINS_RETRIGGER, ASENA_FREE_SPINS_TRIGGER, ASENA_MAP_MULTIPLIERS, ASENA_MAP_SPINS_AT_3, ASENA_MAP_SPINS_AT_6,
  ASENA_MAX_FREE_SPINS, ASENA_MAX_WIN_MULTIPLIER, ASENA_PAY_SYMBOLS, ASENA_PAYTABLE, ASENA_RTP, ASENA_SCATTER_PAY, ASENA_TEMPLATES,
  type AsenaMode, type AsenaPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Translator } from '@/lib/i18n/translator';
import type { Formatter } from '@/lib/i18n/format';
import { groupedInt, fixed1, percentPoints } from '@/lib/slot-format';
import { ASENA_COST_MODES, asenaCost, asenaRtp, asenaRtpRange } from '@/lib/asena-controls';
import { asenaCents, asenaMoney, asenaTimes } from '@/lib/asena-timeline';
import { richText } from '../game-rich';
import { AsenaSymbolArt, useAsenaSymbolLabels } from './symbols';
import { AsenaTemplateGlyph } from './template-glyph';
import styles from './asena-info.module.css';

/** Translators and formatter the info pages are built with (they are plain data for the modal, not a component). */
export interface AsenaInfoContext { t: Translator<'asena'>; tk: Translator<'slotKit'>; tc: Translator<'common'>; format: Formatter }

const MODES: AsenaMode[] = ['standard', 'ante', 'buy'];
const HIGH = new Set<AsenaPaySymbol>(['h1', 'h2', 'h3', 'h4']);
/** Cluster-size tiers of the engine (asenaTier): 5, 6, 7, 8–9, 10–12, 13–17, 18+. */
const TIER_LABELS = ['5', '6', '7', '8–9', '10–12', '13–17', '18+'] as const;
/** Tiers shown on the cards (18+, 13–17, 10–12, 8–9, 5); the full table lists all seven. */
const CARD_TIERS = [6, 5, 4, 3, 0];
const BY_MULTIPLIER = [...ASENA_TEMPLATES].sort((a, b) => b.multiplier - a.multiplier);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

function Paytable({ betCents, ctx }: { betCents: number; ctx: AsenaInfoContext }) {
  const { t, format } = ctx;
  const loc = format.locale;
  const labels = useAsenaSymbolLabels();
  const amount = (h: number) => asenaMoney(asenaCents(betCents, h), loc);
  const times = (h: number) => asenaTimes(h, loc);
  return (
    <div className={styles.page}>
      <h3>{t('info.tab.pay')}</h3>
      <p className={styles.lead}>{richText(t, 'info.pay.lead', { bet: format.demo(betCents) })}</p>
      <ul className={styles.payGrid} aria-label={t('info.pay.gridAria')}>
        {ASENA_PAY_SYMBOLS.map(symbol => (
          <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
            <span className={styles.payArt} aria-hidden="true"><AsenaSymbolArt symbol={symbol} size="100%" /></span>
            <div className={styles.payBody}>
              <h4 className={styles.payName}>{labels[symbol]}</h4>
              <dl className={styles.payRows}>
                {CARD_TIERS.map(tier => (
                  <div key={tier}><dt>{TIER_LABELS[tier]}</dt><dd><strong>{amount(ASENA_PAYTABLE[symbol][tier]!)}</strong><small>{times(ASENA_PAYTABLE[symbol][tier]!)}×</small></dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      <details className={styles.fullTable}>
        <summary>{t('info.pay.fullTable')}</summary>
        <table>
          <caption className="sr-only">{t('info.pay.fullCaption')}</caption>
          <thead><tr><th scope="col">{t('info.pay.colSymbol')}</th>{TIER_LABELS.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {ASENA_PAY_SYMBOLS.map(symbol => (
              <tr key={symbol}>
                <th scope="row"><span aria-hidden="true"><AsenaSymbolArt symbol={symbol} size="100%" /></span>{labels[symbol]}</th>
                {ASENA_PAYTABLE[symbol].map((h, i) => <td key={i}>{times(h)}×</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="moon" size="100%" /></span>
          <div>
            <h4>{labels.moon}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.moon5')}</dt><dd><strong>{amount(ASENA_SCATTER_PAY[5])}</strong> <small>{times(ASENA_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>{t('info.pay.moon4')}</dt><dd><strong>{amount(ASENA_SCATTER_PAY[4])}</strong> <small>{times(ASENA_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>{t('info.pay.moon3')}</dt><dd><strong>{amount(ASENA_SCATTER_PAY[3])}</strong> <small>{times(ASENA_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>{richText(t, 'info.pay.moonText', { spins: ASENA_FREE_SPINS_TRIGGER })}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="wolf" size="100%" /></span>
          <div>
            <h4>{labels.wolf}</h4>
            <p>{richText(t, 'info.pay.wolfText')}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><AsenaSymbolArt symbol="trail" size="100%" /></span>
          <div>
            <h4>{labels.trail}</h4>
            <p>{t('info.pay.trailText')}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { max: groupedInt(ASENA_MAX_WIN_MULTIPLIER, loc) })}</h4>
            <p>{richText(t, 'info.pay.maxText', { amount: format.demo(betCents * ASENA_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet; text follows the active language. */
export function asenaInfoPages(betCents: number, ctx: AsenaInfoContext): GameInfoPage[] {
  const { t, tk, tc, format } = ctx;
  const loc = format.locale;
  const pct = (ratio: number, digits = 1) => percentPoints(ratio * 100, digits, loc);
  const minBet = ASENA_BET_LEVELS_CENTS[0]!, maxBet = ASENA_BET_LEVELS_CENTS[ASENA_BET_LEVELS_CENTS.length - 1]!;
  const anteFactor = format.number(ASENA_COST_MODES.ante.num / ASENA_COST_MODES.ante.den);
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
            <li>{richText(t, 'info.how.steps.cluster')}</li>
            <li>{richText(t, 'info.how.steps.constellation')}</li>
            <li>{richText(t, 'info.how.steps.chain')}</li>
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
          <Feature title={t('info.features.templates.title')}>
            <p>{richText(t, 'info.features.templates.text')}</p>
            <ul className={styles.templates} aria-label={t('info.features.templates.aria')}>
              {BY_MULTIPLIER.map(tpl => (
                <li key={tpl.id}>
                  <AsenaTemplateGlyph id={tpl.id} className={styles.templateArt} />
                  <span><strong>{t(`templates.${tpl.id}`)}</strong><small>{t('info.features.templates.stars', { n: tpl.cells.length })}</small></span>
                  <b>×{tpl.multiplier}</b>
                </li>
              ))}
            </ul>
          </Feature>
          <Feature title={t('info.features.wolf.title')} art={<AsenaSymbolArt symbol="wolf" size="100%" />}>
            <p>{richText(t, 'info.features.wolf.text')}</p>
          </Feature>
          <Feature title={t('info.features.ergenekon.title')} art={<AsenaSymbolArt symbol="moon" size="100%" />}>
            <p>{richText(t, 'info.features.ergenekon.text', { spins: ASENA_FREE_SPINS_TRIGGER, retrigger: ASENA_FREE_SPINS_RETRIGGER, max: ASENA_MAX_FREE_SPINS })}</p>
            <ol className={styles.mapSteps}>
              <li>{richText(t, 'info.features.ergenekon.map3', { spins: ASENA_MAP_SPINS_AT_3, multiplier: ASENA_MAP_MULTIPLIERS[3] })}</li>
              <li>{richText(t, 'info.features.ergenekon.map6', { spins: ASENA_MAP_SPINS_AT_6, multiplier: ASENA_MAP_MULTIPLIERS[6] })}</li>
              <li>{richText(t, 'info.features.ergenekon.mapTwice', { multiplier: ASENA_MAP_MULTIPLIERS.twice })}</li>
            </ol>
            <p>{richText(t, 'info.features.ergenekon.after')}</p>
          </Feature>
          <Feature title={t('info.features.cumulative.title')}>
            <p>{t('info.features.cumulative.text')}</p>
          </Feature>
          <Feature title={t('info.features.tiers.title')}>
            <p>{richText(t, 'info.features.tiers.text', { big: tier('big'), mega: tier('mega'), super: tier('super'), epic: tier('epic'), max: tier('max') })}</p>
          </Feature>
          <Feature title={t('info.features.ante.title', { cost: format.demo(asenaCost(betCents, 'ante')) })}>
            <p>{richText(t, 'info.features.ante.text', { factor: anteFactor, ante: pct(ASENA_RTP.ante.featureRate, 2), standard: pct(ASENA_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buy.title', { price: format.demo(asenaCost(betCents, 'buy')) })}>
            <p>{richText(t, 'info.features.buy.text', { spins: ASENA_FREE_SPINS_TRIGGER, rtp: asenaRtp(ASENA_RTP.buy.rtp, loc) })}</p>
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
            <table>
              <caption className="sr-only">{t('info.rtp.caption')}</caption>
              <thead><tr><th scope="col">{t('info.rtp.colMode')}</th><th scope="col">{t('info.rtp.colCost')}</th><th scope="col">RTP</th><th scope="col">{t('info.rtp.colCi')}</th><th scope="col">{t('info.rtp.colFeature')}</th></tr></thead>
              <tbody>
                {MODES.map(mode => {
                  const r = ASENA_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{tc(`modes.${mode}`)}</th>
                      <td>{format.factor(ASENA_COST_MODES[mode].num, ASENA_COST_MODES[mode].den)}</td>
                      <td><strong>{asenaRtp(r.rtp, loc)}</strong></td>
                      <td>{asenaRtpRange(r.ciLow, r.ciHigh, loc)}</td>
                      <td>{r.featureRate >= 1 ? t('info.rtp.everyRound') : t('info.rtp.oneIn', { n: groupedInt(Math.round(1 / r.featureRate), loc) })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>{richText(t, 'info.rtp.text', {
            millions: groupedInt(ASENA_RTP.standard.rounds / 1_000_000, loc), hitStandard: pct(ASENA_RTP.standard.hitRate), hitAnte: pct(ASENA_RTP.ante.hitRate),
            sdStandard: fixed1(ASENA_RTP.standard.stdDev, loc), sdBuy: fixed1(ASENA_RTP.buy.stdDev, loc),
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
            <div><dt>{t('info.limits.steps')}</dt><dd>{ASENA_BET_LEVELS_CENTS.map(cents => format.amount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(asenaCost(betCents, 'ante')), buy: format.demo(asenaCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { multiplier: groupedInt(ASENA_MAX_WIN_MULTIPLIER, loc), amount: format.demo(betCents * ASENA_MAX_WIN_MULTIPLIER) })}</dd></div>
          </dl>
          <p>{t('info.limits.text1')}</p>
          <p>{t('info.limits.text2')}</p>
        </div>
      ),
    },
    {
      id: 'keys', title: t('info.tab.keys'),
      content: (
        <div className={styles.page}>
          <h3>{t('info.keys.heading')}</h3>
          <dl className={styles.keys}>
            <div><dt><kbd>{t('info.keys.space')}</kbd></dt><dd>{t('info.keys.spaceText', { option: tk('settings.spaceToSpin') })}</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>{t('info.keys.enterText')}</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>{t('info.keys.escText')}</dd></div>
            <div><dt><kbd>Tab</kbd></dt><dd>{t('info.keys.tabText')}</dd></div>
            <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>{t('info.keys.arrowsText')}</dd></div>
            <div><dt><kbd>PageUp</kbd> <kbd>PageDown</kbd></dt><dd>{t('info.keys.pageText')}</dd></div>
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
