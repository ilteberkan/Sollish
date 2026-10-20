'use client';
import type { ReactNode } from 'react';
import {
  CEZERI_BET_LEVELS_CENTS, CEZERI_FREE_SPINS_RETRIGGER, CEZERI_FREE_SPINS_TRIGGER, CEZERI_GEAR_PAY, CEZERI_MAX_FREE_SPINS, CEZERI_MAX_RESPINS,
  CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODE_TABLES, CEZERI_PAYTABLE, CEZERI_RESERVOIR_LEVELS, CEZERI_RETRIGGER_VESSELS, CEZERI_RTP, CEZERI_SCATTER_PAY,
  CEZERI_TRIGGER_VESSELS, CEZERI_FALCON_COUNT, type CezeriMode, type CezeriPaySymbol,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Translator } from '@/lib/i18n/translator';
import type { Formatter } from '@/lib/i18n/format';
import { groupedInt, fixed1, percentPoints } from '@/lib/slot-format';
import { CEZERI_COST_MODES, cezeriCost, cezeriRtp, cezeriRtpRange } from '@/lib/cezeri-controls';
import { cezeriCents, cezeriMoney, cezeriTimes } from '@/lib/cezeri-timeline';
import { richText } from '../game-rich';
import { CezeriSymbolArt, useCezeriSymbolLabels } from './symbols';
import styles from './cezeri-info.module.css';

/** Translators and formatter the info pages are built with (they are plain data for the modal, not a component). */
export interface CezeriInfoContext { t: Translator<'cezeri'>; tk: Translator<'slotKit'>; tc: Translator<'common'>; format: Formatter }

const MODES: CezeriMode[] = ['standard', 'ante', 'buy'];
const ORDER: CezeriPaySymbol[] = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4'];
const HIGH = new Set<CezeriPaySymbol>(['h1', 'h2', 'h3', 'h4']);
const HUB_BASE = CEZERI_MODE_TABLES.standard.hubBase;
const HUB_TOTAL = HUB_BASE.reduce((sum, [, w]) => sum + w, 0);
const FALCON_TOTAL = CEZERI_FALCON_COUNT.reduce((sum, [, w]) => sum + w, 0);

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

/** A tiny spoke diagram: hub on the left, rings 1..4 to the right, the paying run lit. */
function SpokeDiagram({ start, length }: { start: 0 | 1; length: 3 | 4 }) {
  return (
    <span className={styles.spoke} aria-hidden="true">
      <i className={styles.spokeHub}>×</i>
      {[0, 1, 2, 3].map(r => <i key={r} data-on={r >= start && r < start + length || undefined} />)}
    </span>
  );
}

function Paytable({ betCents, ctx }: { betCents: number; ctx: CezeriInfoContext }) {
  const { t, format } = ctx;
  const loc = format.locale;
  const labels = useCezeriSymbolLabels();
  const amount = (h: number) => cezeriMoney(cezeriCents(betCents, h), loc);
  const times = (h: number) => cezeriTimes(h, loc);
  return (
    <div className={styles.page}>
      <h3>{t('info.tab.pay')}</h3>
      <p className={styles.lead}>{richText(t, 'info.pay.lead', { bet: format.demo(betCents) })}</p>
      <div className={styles.runs} aria-label={t('info.pay.runsAria')}>
        <span><SpokeDiagram start={0} length={4} /> {t('info.pay.run14')}</span>
        <span><SpokeDiagram start={0} length={3} /> {t('info.pay.run13')}</span>
        <span><SpokeDiagram start={1} length={3} /> {t('info.pay.run24')}</span>
      </div>
      <ul className={styles.payGrid} aria-label={t('info.pay.gridAria')}>
        {ORDER.map(symbol => {
          const [t3, t4] = CEZERI_PAYTABLE[symbol];
          return (
            <li key={symbol} className={`${styles.payCard} ${HIGH.has(symbol) ? styles.payHigh : ''}`}>
              <span className={styles.payArt} aria-hidden="true"><CezeriSymbolArt symbol={symbol} size="100%" /></span>
              <div className={styles.payBody}>
                <h4 className={styles.payName}>{labels[symbol]}</h4>
                <dl className={styles.payRows}>
                  <div><dt>{t('info.pay.slices4')}</dt><dd><strong>{amount(t4)}</strong><small>{times(t4)}×</small></dd></div>
                  <div><dt>{t('info.pay.slices3')}</dt><dd><strong>{amount(t3)}</strong><small>{times(t3)}×</small></dd></div>
                </dl>
              </div>
            </li>
          );
        })}
      </ul>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><CezeriSymbolArt symbol="gear" size="100%" /></span>
          <div>
            <h4>{labels.gear}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.gears4')}</dt><dd><strong>{amount(CEZERI_GEAR_PAY[1])}</strong> <small>{times(CEZERI_GEAR_PAY[1])}×</small></dd></div>
              <div><dt>{t('info.pay.gears3')}</dt><dd><strong>{amount(CEZERI_GEAR_PAY[0])}</strong> <small>{times(CEZERI_GEAR_PAY[0])}×</small></dd></div>
            </dl>
            <p>{t('info.pay.gearText')}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><CezeriSymbolArt symbol="vessel" size="100%" /></span>
          <div>
            <h4>{t('info.pay.scatterTitle', { name: labels.vessel })}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.vessels5')}</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[5])}</strong> <small>{times(CEZERI_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>{t('info.pay.vessels4')}</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[4])}</strong> <small>{times(CEZERI_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>{t('info.pay.vessels3')}</dt><dd><strong>{amount(CEZERI_SCATTER_PAY[3])}</strong> <small>{times(CEZERI_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>{richText(t, 'info.pay.scatterText', { vessels: CEZERI_TRIGGER_VESSELS, spins: CEZERI_FREE_SPINS_TRIGGER })}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { max: groupedInt(CEZERI_MAX_WIN_MULTIPLIER, loc) })}</h4>
            <p>{richText(t, 'info.pay.maxText', { amount: format.demo(betCents * CEZERI_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet; text follows the active language. */
export function cezeriInfoPages(betCents: number, ctx: CezeriInfoContext): GameInfoPage[] {
  const { t, tk, tc, format } = ctx;
  const loc = format.locale;
  const pct = (ratio: number, digits = 1) => percentPoints(ratio * 100, digits, loc);
  const minBet = CEZERI_BET_LEVELS_CENTS[0]!, maxBet = CEZERI_BET_LEVELS_CENTS[CEZERI_BET_LEVELS_CENTS.length - 1]!;
  const anteFactor = format.number(CEZERI_COST_MODES.ante.num / CEZERI_COST_MODES.ante.den);
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
            <li>{richText(t, 'info.how.steps.wheels')}</li>
            <li>{richText(t, 'info.how.steps.spokes')}</li>
            <li>{richText(t, 'info.how.steps.lock', { max: CEZERI_MAX_RESPINS })}</li>
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
          <Feature title={t('info.features.hub.title')} art={<span className={styles.hubBadge}>×5</span>}>
            <p>{t('info.features.hub.text')}</p>
            <ul className={styles.hubRow} aria-label={t('info.features.hub.aria')}>
              {HUB_BASE.map(([value, weight]) => <li key={value}><strong>×{value}</strong><small>{pct(weight / HUB_TOTAL)}</small></li>)}
            </ul>
          </Feature>
          <Feature title={t('info.features.lock.title')} art={<CezeriSymbolArt symbol="h1" size="100%" />}>
            <p>{richText(t, 'info.features.lock.text', { max: CEZERI_MAX_RESPINS })}</p>
          </Feature>
          <Feature title={t('info.features.elephant.title', { spins: CEZERI_FREE_SPINS_TRIGGER })} art={<CezeriSymbolArt symbol="vessel" size="100%" />}>
            <p>{richText(t, 'info.features.elephant.text', { trigger: CEZERI_TRIGGER_VESSELS, spins: CEZERI_FREE_SPINS_TRIGGER, retriggerVessels: CEZERI_RETRIGGER_VESSELS, retrigger: CEZERI_FREE_SPINS_RETRIGGER, max: CEZERI_MAX_FREE_SPINS })}</p>
          </Feature>
          <Feature title={t('info.features.falcon.title')} art={<CezeriSymbolArt symbol="gear" size="100%" />}>
            <p>{t('info.features.falcon.text', { levels: CEZERI_RESERVOIR_LEVELS, counts: CEZERI_FALCON_COUNT.map(([n, w]) => `${n} (${pct(w / FALCON_TOTAL, 0)})`).join(', ') })}</p>
          </Feature>
          <Feature title={t('info.features.tiers.title')}>
            <p>{richText(t, 'info.features.tiers.text', { big: tier('big'), mega: tier('mega'), super: tier('super'), epic: tier('epic'), max: tier('max') })}</p>
          </Feature>
          <Feature title={t('info.features.ante.title', { cost: format.demo(cezeriCost(betCents, 'ante')) })}>
            <p>{richText(t, 'info.features.ante.text', { factor: anteFactor, ante: pct(CEZERI_RTP.ante.featureRate, 2), standard: pct(CEZERI_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buy.title', { price: format.demo(cezeriCost(betCents, 'buy')) })}>
            <p>{richText(t, 'info.features.buy.text', { vessels: CEZERI_TRIGGER_VESSELS, spins: CEZERI_FREE_SPINS_TRIGGER, rtp: cezeriRtp(CEZERI_RTP.buy.rtp, loc) })}</p>
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
                  const r = CEZERI_RTP[mode];
                  return (
                    <tr key={mode}>
                      <th scope="row">{tc(`modes.${mode}`)}</th>
                      <td>{format.factor(CEZERI_COST_MODES[mode].num, CEZERI_COST_MODES[mode].den)}</td>
                      <td><strong>{cezeriRtp(r.rtp, loc)}</strong></td>
                      <td>{cezeriRtpRange(r.ciLow, r.ciHigh, loc)}</td>
                      <td>{r.featureRate >= 1 ? t('info.rtp.everyRound') : t('info.rtp.oneIn', { n: groupedInt(Math.round(1 / r.featureRate), loc) })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>{richText(t, 'info.rtp.text', {
            millions: groupedInt(CEZERI_RTP.standard.rounds / 1_000_000, loc), hitStandard: pct(CEZERI_RTP.standard.hitRate), hitAnte: pct(CEZERI_RTP.ante.hitRate),
            sdStandard: fixed1(CEZERI_RTP.standard.stdDev, loc), sdBuy: fixed1(CEZERI_RTP.buy.stdDev, loc),
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
            <div><dt>{t('info.limits.steps')}</dt><dd>{CEZERI_BET_LEVELS_CENTS.map(cents => format.amount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(cezeriCost(betCents, 'ante')), buy: format.demo(cezeriCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { multiplier: groupedInt(CEZERI_MAX_WIN_MULTIPLIER, loc), amount: format.demo(betCents * CEZERI_MAX_WIN_MULTIPLIER) })}</dd></div>
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
