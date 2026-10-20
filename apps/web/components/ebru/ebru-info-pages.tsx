'use client';
import type { CSSProperties, ReactNode } from 'react';
import {
  EBRU_BET_LEVELS_CENTS, EBRU_CLUSTER_TIER_STARTS, EBRU_COLOURS, EBRU_COMB_AMPLITUDE_WEIGHTS, EBRU_FREE_SPINS_RETRIGGER, EBRU_FREE_SPINS_TRIGGER,
  EBRU_MAX_COMB_PASSES, EBRU_MAX_FREE_SPINS, EBRU_MAX_WIN_MULTIPLIER, EBRU_PAYTABLE, EBRU_RTP, EBRU_SCATTER_PAY, EBRU_SIN_TABLE, EBRU_STAIN_MAX,
  type EbruColour, type EbruMode,
} from '@sollish/protocol';
import type { GameInfoPage } from '../slot-kit';
import type { Formatter } from '@/lib/i18n/format';
import type { Translator } from '@/lib/i18n/translator';
import { percentOf, percentRange } from '@/lib/slot-kit/percent';
import { inlineName } from '@/lib/slot-kit/inline-name';
import { EBRU_COST_MODES, ebruCost } from '@/lib/ebru-controls';
import { ebruCents } from '@/lib/ebru-timeline';
import { EBRU_STAIN_VALUES, EbruStainArt, EbruSymbolArt } from './symbols';
import { EBRU_INKS } from './water';
import styles from './ebru-info.module.css';

const MODES: EbruMode[] = ['standard', 'ante', 'buy'];
const HIGH = new Set<EbruColour>(['c1', 'c2', 'c3']);
/** Labels of EBRU_CLUSTER_TIER_STARTS: 5, 6, 7, 8, 9, 10–11, 12–13, …, 33+. */
const TIER_LABELS = EBRU_CLUSTER_TIER_STARTS.map((start, i) => {
  const next = EBRU_CLUSTER_TIER_STARTS[i + 1];
  if (next === undefined) return `${start}+`;
  return next - 1 === start ? `${start}` : `${start}–${next - 1}`;
});
/** Tiers shown on the cards (5, 8, 12–13, 17–20, 26–32, 33+); the full table lists all twelve. */
const CARD_TIERS = [11, 9, 6, 3, 0];
const bold = (chunk: string) => <strong key={chunk}>{chunk}</strong>;
const code = (chunk: string) => <code key={chunk}>{chunk}</code>;

/** Everything the info pages need to speak the current language (they are plain data, built outside React). */
export interface EbruInfoContext {
  t: Translator<'ebru'>;
  tc: Translator<'common'>;
  tk: Translator<'slotKit'>;
  format: Formatter;
  /** Translated symbol name. */
  symbol: (symbol: EbruColour | 'drop' | 'comb') => string;
}
const AMP_TOTAL = EBRU_COMB_AMPLITUDE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
/** The engine's comb formula for the worked example on the features page. */
const exampleShifts = (a: number, p: number, q: number) => Array.from({ length: 7 }, (_, r) => {
  const n = a * EBRU_SIN_TABLE[(p + r * q) % 64]!;
  const m = Math.floor((2 * Math.abs(n) + 1000) / 2000);
  return n < 0 ? -m : m;
});
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function Feature({ art, title, children }: { art?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles.feature}>
      {art && <span className={styles.featureArt} aria-hidden="true">{art}</span>}
      <div><h4>{title}</h4>{children}</div>
    </section>
  );
}

function Paytable({ betCents, cx }: { betCents: number; cx: EbruInfoContext }) {
  const { t, format } = cx;
  const amount = (h: number) => format.amount(ebruCents(betCents, h));
  const times = (h: number) => format.amount(h);
  return (
    <div className={styles.page}>
      <h3>{t('info.pay.title')}</h3>
      <p className={styles.lead}>{t.rich('info.pay.lead', { b: bold }, { bet: format.demo(betCents) })}</p>
      <ul className={styles.payGrid} aria-label={t('info.pay.clustersAria')}>
        {EBRU_COLOURS.map(colour => (
          <li key={colour} className={`${styles.payCard} ${HIGH.has(colour) ? styles.payHigh : ''}`}>
            <span className={styles.payArt} aria-hidden="true"><EbruSymbolArt symbol={colour} size="100%" /></span>
            <div className={styles.payBody}>
              <h4 className={styles.payName}>{cx.symbol(colour)}</h4>
              <dl className={styles.payRows}>
                {CARD_TIERS.map(tier => (
                  <div key={tier}><dt>{TIER_LABELS[tier]}</dt><dd><strong>{amount(EBRU_PAYTABLE[colour][tier]!)}</strong><small>{times(EBRU_PAYTABLE[colour][tier]!)}×</small></dd></div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      <details className={styles.fullTable}>
        <summary>{t('info.pay.fullSummary')}</summary>
        <table>
          <caption className="sr-only">{t('info.pay.fullCaption')}</caption>
          <thead><tr><th scope="col">{t('info.pay.colour')}</th>{TIER_LABELS.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {EBRU_COLOURS.map(colour => (
              <tr key={colour}>
                <th scope="row"><span aria-hidden="true"><EbruSymbolArt symbol={colour} size="100%" /></span>{cx.symbol(colour)}</th>
                {EBRU_PAYTABLE[colour].map((h, i) => <td key={i}>{times(h)}×</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className={styles.specials}>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><EbruSymbolArt symbol="comb" size="100%" /></span>
          <div>
            <h4>{t('info.pay.scatterTitle', { name: cx.symbol('comb') })}</h4>
            <dl className={styles.scatterRows}>
              <div><dt>{t('info.pay.combs5')}</dt><dd><strong>{amount(EBRU_SCATTER_PAY[5])}</strong> <small>{times(EBRU_SCATTER_PAY[5])}×</small></dd></div>
              <div><dt>{t('info.pay.combs4')}</dt><dd><strong>{amount(EBRU_SCATTER_PAY[4])}</strong> <small>{times(EBRU_SCATTER_PAY[4])}×</small></dd></div>
              <div><dt>{t('info.pay.combs3')}</dt><dd><strong>{amount(EBRU_SCATTER_PAY[3])}</strong> <small>{times(EBRU_SCATTER_PAY[3])}×</small></dd></div>
            </dl>
            <p>{t.rich('info.pay.scatterText', { b: bold }, { spins: EBRU_FREE_SPINS_TRIGGER })}</p>
          </div>
        </section>
        <section className={styles.special}>
          <span className={styles.specialArt} aria-hidden="true"><EbruSymbolArt symbol="drop" size="100%" /></span>
          <div>
            <h4>{cx.symbol('drop')}</h4>
            <p>{t('info.pay.dropText', { features: t('info.features.title') })}</p>
          </div>
        </section>
        <section className={`${styles.special} ${styles.specialMax}`}>
          <div>
            <h4>{t('info.pay.maxTitle', { n: format.number(EBRU_MAX_WIN_MULTIPLIER, 0) })}</h4>
            <p>{t.rich('info.pay.maxText', { b: bold }, { amount: format.demo(betCents * EBRU_MAX_WIN_MULTIPLIER) })}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function CombExample({ t }: { t: Translator<'ebru'> }) {
  const shifts = exampleShifts(2, 0, 8);
  const colours = EBRU_COLOURS.slice(0, 7);
  return (
    <>
      <p>{t('info.features.combExample', { shifts: shifts.map(signed).join(', ') })}</p>
      <dl className={styles.combDemo} aria-label={t('info.features.combExampleAria')}>
        {shifts.map((s, r) => (
          <div key={r} style={{ display: 'contents' }}>
            <dt>{t('info.features.combRow', { n: r + 1, shift: signed(s) })}</dt>
            <dd aria-hidden="true">{colours.map((_, c) => { const from = (((c - s) % 7) + 7) % 7; return <span key={c} data-c="" style={{ '--c': EBRU_INKS[colours[(from + r) % 7]!].base } as CSSProperties} />; })}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Multi-page game information (game-standards §3 "Bilgi"). Amounts follow the current bet. */
export function ebruInfoPages(betCents: number, cx: EbruInfoContext): GameInfoPage[] {
  const { t, tc, tk, format } = cx;
  const intl = format.intl;
  const pct = (ratio: number, digits = 1) => percentOf(intl, ratio, digits);
  const fixed1 = (n: number) => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  const anteFactor = EBRU_COST_MODES.ante;
  const multiple = format.number(anteFactor.num / anteFactor.den, 2);
  const minBet = EBRU_BET_LEVELS_CENTS[0]!, maxBet = EBRU_BET_LEVELS_CENTS[EBRU_BET_LEVELS_CENTS.length - 1]!;
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
            <li>{t.rich('info.how.s5', { b: bold }, { passes: EBRU_MAX_COMB_PASSES })}</li>
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
          <Feature title={t('info.features.combTitle')} art={<EbruSymbolArt symbol="comb" size="100%" />}>
            <p>{t.rich('info.features.combText', { b: bold }, { passes: EBRU_MAX_COMB_PASSES, weights: EBRU_COMB_AMPLITUDE_WEIGHTS.map(([a, w]) => `${a}: ${pct(w / AMP_TOTAL, 0)}`).join(', ') })}</p>
            <CombExample t={t} />
          </Feature>
          <Feature title={t('info.features.dropTitle', { name: cx.symbol('drop') })} art={<EbruSymbolArt symbol="drop" size="100%" />}>
            <p>{t('info.features.dropText')}</p>
          </Feature>
          <Feature title={t('info.features.freeTitle')} art={<EbruStainArt value={16} size="100%" />}>
            <p>{t.rich('info.features.freeText', { b: bold }, { trigger: EBRU_FREE_SPINS_TRIGGER, stainMax: EBRU_STAIN_MAX, retrigger: EBRU_FREE_SPINS_RETRIGGER, max: EBRU_MAX_FREE_SPINS })}</p>
            <ul className={styles.stainRow} aria-label={t('info.features.stainsAria')}>{EBRU_STAIN_VALUES.map(v => <li key={v}><EbruStainArt value={v} size="100%" /></li>)}</ul>
          </Feature>
          <Feature title={t('info.features.cumTitle')}>
            <p>{t('info.features.cumText', { screen: `${t('total.titleA')} — ${t('total.titleB')}` })}</p>
          </Feature>
          <Feature title={t('info.features.tiersTitle')}>
            <p>{t.rich('info.features.tiersText', { b: bold }, { big: tk('winTier.big.title'), mega: tk('winTier.mega.title'), super: tk('winTier.super.title'), epic: tk('winTier.epic.title'), max: tk('winTier.max.title') })}</p>
          </Feature>
          <Feature title={t('info.features.anteTitle', { cost: format.demo(ebruCost(betCents, 'ante')) })}>
            <p>{t.rich('info.features.anteText', { b: bold }, { multiple, ante: pct(EBRU_RTP.ante.featureRate, 2), standard: pct(EBRU_RTP.standard.featureRate, 2) })}</p>
          </Feature>
          <Feature title={t('info.features.buyTitle', { price: format.demo(ebruCost(betCents, 'buy')) })}>
            <p>{t.rich('info.features.buyText', { b: bold }, { spins: EBRU_FREE_SPINS_TRIGGER, rtp: pct(EBRU_RTP.buy.rtp) })}</p>
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
                  const r = EBRU_RTP[mode];
                  const cost = EBRU_COST_MODES[mode];
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
          <p>{t.rich('info.rtp.method', { code }, { millions: format.number(EBRU_RTP.standard.rounds / 1_000_000, 0), hit: pct(EBRU_RTP.standard.hitRate), hitAnte: pct(EBRU_RTP.ante.hitRate), sdStandard: fixed1(EBRU_RTP.standard.stdDev), sdBuy: fixed1(EBRU_RTP.buy.stdDev) })}</p>
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
            <div><dt>{t('info.limits.levels')}</dt><dd>{EBRU_BET_LEVELS_CENTS.map(cents => format.amount(cents, { trimZeros: true })).join(' · ')}</dd></div>
            <div><dt>{t('info.limits.current')}</dt><dd>{t('info.limits.currentValue', { bet: format.demo(betCents), ante: format.demo(ebruCost(betCents, 'ante')), buy: format.demo(ebruCost(betCents, 'buy')) })}</dd></div>
            <div><dt>{t('info.limits.max')}</dt><dd>{t('info.limits.maxValue', { n: format.number(EBRU_MAX_WIN_MULTIPLIER, 0), amount: format.demo(betCents * EBRU_MAX_WIN_MULTIPLIER) })}</dd></div>
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
          <p className={styles.note}>{t('info.keys.note', { example: t('announce.clusterStain', { size: 6, name: inlineName(t.locale, cx.symbol('c1')), stain: '4', times: format.amount(1200) }) })}</p>
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
