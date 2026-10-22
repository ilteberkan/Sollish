'use client';
import { multiplierLabel, type Side } from '@/lib/demo';
import { Icon } from './icons';
import { useProduct } from './providers';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import type { Translator } from '@/lib/i18n/translator';
import type { Locale } from '@/lib/i18n/config';
import { AsenaRules } from './asena/asena-rules';
import { CezeriRules } from './cezeri/cezeri-rules';
export type Mode = 'demo' | 'live';
/** `badge` replaces the DEMO label (for example "Sunucu doğrulamalı" when an RGS server resolves the rounds). */
/** "Name: subtitle" titles keep the subtitle in its own span, so narrow phone layouts can hide it visually while the
    heading's accessible name stays the full title. */
function HeadingTitle({ title }: { title: string }) {
  const cut = title.indexOf(': ');
  if (cut <= 0) return <>{title}</>;
  return <><span className="title-main">{title.slice(0, cut)}</span><span className="title-sub">{title.slice(cut)}</span></>;
}
export function GameHeading({ title, subtitle, mode, setMode, active, badge }: { title: string; subtitle: string; mode: Mode; setMode: (mode: Mode) => void; active: boolean; badge?: string }) {
  const t = useT('common');
  return <div className="game-heading"><div><div className="title-line"><h1><HeadingTitle title={title} /></h1><span className={`mode-badge ${mode === 'live' ? 'live-mode' : ''}`} data-testid="round-source">{mode === 'demo' ? (badge ?? t('game.sourceLocal')) : 'Devnet'}</span></div><p>{subtitle}</p></div><div className="mode-switch" aria-label={t('game.environment')}><button aria-pressed={mode === 'demo'} onClick={() => setMode('demo')} disabled={active}>{t('game.demo')}</button><button aria-pressed={mode === 'live'} onClick={() => setMode('live')} disabled={active}>{t('game.onchain')}<Icon name="lock" size={12}/></button></div></div>;
}
export function AmountControl({ amount, setAmount, disabled, error, unit = 'DEMO' }: { amount: string; setAmount: (value: string) => void; disabled: boolean; error?: string; unit?: string }) {
  const t = useT('common');
  return <div className="amount-control"><label htmlFor="bet-amount">{unit === 'DEMO' ? t('game.amountDemo') : t('game.amountBet')}</label><div className={`amount-input-wrap ${error ? 'invalid' : ''}`}><input id="bet-amount" inputMode="decimal" autoComplete="off" placeholder={t('game.amountPlaceholder')} value={amount} onChange={event => setAmount(event.target.value)} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'amount-error' : 'amount-hint'}/><span>{unit}</span></div><div className="amount-quick"><span id="amount-hint">{unit === 'DEMO' ? t('game.amountHint') : 'SOL'}</span>{(unit === 'DEMO' ? ['10', '25', '50'] : ['0.001', '0.005', '0.01']).map(value => <button key={value} disabled={disabled} onClick={() => setAmount(value)} aria-label={t('game.amountChoose', { value, unit })}>{value}</button>)}</div>{error && <p id="amount-error" className="form-error" role="alert">{error}</p>}</div>;
}
export function DemoBalance() { const { demoBalance } = useProduct(); const t = useT('common'); const format = useFormat(); return <span className="demo-balance"><span>{t('game.balance')}</span><strong>{format.number(demoBalance / 100)} <small>DEMO</small></strong></span>; }
export function DemoNotice({ remote = false }: { remote?: boolean } = {}) { const t = useT('common'); return <div className="demo-notice"><Icon name="info" size={16}/><p>{remote ? t.rich('game.noticeRemote', { link: chunk => <a key="verify" href="/verify">{chunk}</a> }) : t('game.noticeLocal')}</p></div>; }
/* The ledger stores Crash/Coinflip result lines in Turkish (`settleDemo` detail). The row is rebuilt from that stored
   line in the active language; an unknown line is shown as stored. */
function historyDetail(record: { game: string; detail: string }, t: Translator<'common'>, locale: Locale): string {
  if (record.game === 'Crash') {
    const round = /^(\d+,\d{2})× (çıkış|tur sonu)$/.exec(record.detail);
    if (round) return t(round[2] === 'çıkış' ? 'game.historyDetail.cashout' : 'game.historyDetail.roundEnd', { multiplier: multiplierLabel(Number(round[1]!.replace(',', '.')), locale) });
  }
  if (record.detail === 'Demo iptal edildi') return t('game.historyDetail.cancelled');
  if (record.game === 'Coinflip') {
    const flip = /^(Yazı|Tura) · (Kazandın|Kaybettin)$/.exec(record.detail);
    if (flip) return t(flip[2] === 'Kazandın' ? 'game.historyDetail.coinWon' : 'game.historyDetail.coinLost', { side: t(flip[1] === 'Yazı' ? 'game.heads' : 'game.tails') });
  }
  return record.detail;
}
const GAME_KEY = { Crash: 'games.crash', Coinflip: 'games.coinflip', Cascade: 'games.cascade', Tarhun: 'games.tarhun', Ebru: 'games.ebru', Cezeri: 'games.cezeri', Asena: 'games.asena' } as const;
export function GameHistory({ game }: { game: 'Crash' | 'Coinflip' | 'Cascade' | 'Tarhun' | 'Ebru' | 'Cezeri' | 'Asena' }) {
  const { records } = useProduct();
  const relevant = records.filter(record => record.game === game);
  const t = useT('common');
  const format = useFormat();
  const { locale } = useLocale();
  return <section className="history-section" aria-labelledby="history-heading"><div className="section-heading"><h2 id="history-heading">{t('game.historyTitle')}</h2><span className="small muted">{t('game.historyScope')}</span></div>{relevant.length ? <div className="table-scroll"><table className="history-table"><thead><tr><th>{t('game.historyRound')}</th><th>{t('game.historyAmount')}</th><th>{t('game.historyResult')}</th><th className="text-right">{t('game.historyGross')}</th></tr></thead><tbody>{relevant.map((record, index) => <tr key={record.id}><td><span className="history-game">{t(GAME_KEY[game])}</span><small>{format.clock(record.at)}</small></td><td>{format.number(record.stake / 100)} <span className="muted">DEMO</span></td><td className={record.payout > record.stake ? 'positive' : ''}>{record.kind === 'reset' ? t('game.balanceReset') : historyDetail(record, t, locale)}</td><td className="text-right">{format.number(record.payout / 100)} <span className="muted">DEMO</span>{index === 0 && <span className="sr-only">{t('game.historyLatest')}</span>}</td></tr>)}</tbody></table></div> : <div className="empty-history"><Icon name="history" size={24}/><div><strong>{t('game.historyEmptyTitle')}</strong><p>{t('game.historyEmptyText')}</p></div></div>}</section>;
}
export function Rules({ game }: { game: 'Crash' | 'Coinflip' | 'Cascade' | 'Tarhun' | 'Ebru' | 'Cezeri' | 'Asena' }) {
  const t = useT('common');
  const slotLocal = <p>{t('rules.slotLocal')}</p>;
  return <details className="rules"><summary><Icon name="shield" size={17}/><span>{t('game.rulesSummary')}</span><Icon name="chevron" size={16}/></summary><div>{game === 'Asena' ? <AsenaRules/> : game === 'Cezeri' ? <CezeriRules/> : game === 'Ebru' ? <><p>{t('rules.ebru.grid')}</p><p>{t('rules.ebru.comb')}</p>{slotLocal}</> : game === 'Tarhun' ? <><p>{t('rules.tarhun.grid')}</p><p>{t('rules.tarhun.stones')}</p>{slotLocal}</> : game === 'Cascade' ? <><p>{t('rules.cascade.grid')}</p><p>{t('rules.cascade.free')}</p>{slotLocal}</> : game === 'Crash' ? <><p>{t('rules.crash.play')}</p><p>{t('rules.crash.local')}</p></> : <><p>{t('rules.coinflip.play')}</p><p>{t('rules.coinflip.local')}</p></>}<p>{t('game.rulesAccess')}</p></div></details>;
}
export function SidePicker({ side, setSide, disabled }: { side: Side; setSide: (side: Side) => void; disabled: boolean }) { const t = useT('common'); return <fieldset className="side-picker"><legend>{t('game.sideLegend')}</legend><div>{([{ value: 'heads', text: t('game.heads'), symbol: 'S' }, { value: 'tails', text: t('game.tails'), symbol: 'Ⅱ' }] as const).map(item => <button key={item.value} type="button" aria-pressed={side === item.value} disabled={disabled} onClick={() => setSide(item.value)}><span className="mini-coin" aria-hidden="true">{item.symbol}</span>{item.text}{side === item.value && <Icon name="check" size={16}/>}</button>)}</div></fieldset>; }
