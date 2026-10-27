'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_MAX_BET_CENTS, demoNumber, grossPayout, multiplierLabel, parseDemoAmount, randomUnit, type Side } from '@/lib/demo';
import { DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, type Mode } from './game-common';
import { BrandMark, Icon } from './icons';
import { useProduct } from './providers';
import { LiveCoinflip } from './live-coinflip';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import { GameInfoStrip } from '@/components/game-info-strip';
import { AutoplayPanel, AutoplayStopButton } from './slot-kit';
import { BetAmountField, BetPanel, ChoiceToggle, OriginalsInfo, OriginalsPage, OriginalsRow, OriginalsTable, ProfitReadout, originalsStyles as o, type BetTab } from './originals';
import { useInstantAutoplay, autoplayNet } from './originals/use-instant-autoplay';
import { centsToInput, doubleCents, halveCents, profitCents } from '@/lib/originals';
type ErrorKey = Extract<MessageKey<'common'>, `game.errors.${string}`>;
const MIN_CENTS = 100;
const FACTOR_HUNDREDTHS = 196;
/* Sollish Originals page (components/originals): bet panel left, coin stage right. The round lifecycle below is the
   original local practice unchanged (reserve → 1,4 s → settle once; Back/unmount refunds an unfinished flip; a hidden
   tab completes on return). Otomatik plays the same normal round repeatedly under the mandatory loss limit. */
export function CoinflipGame() {
  const { reserveDemo, settleDemo, setActiveDemo, demoBalance } = useProduct();
  const t = useT('coinflip');
  const tc = useT('common');
  const tk = useT('slotKit');
  const format = useFormat();
  const { locale } = useLocale();
  const money = (cents: number) => demoNumber(cents, locale);
  const factor = multiplierLabel(1.96, locale);
  const [mode, setMode] = useState<Mode>('demo');
  const [tab, setTab] = useState<BetTab>('manual');
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<Side>('heads');
  const [error, setError] = useState<ErrorKey | ''>('');
  const [phase, setPhase] = useState<'ready' | 'flipping' | 'won' | 'lost'>('ready');
  const [outcome, setOutcome] = useState<Side | null>(null);
  const [payout, setPayout] = useState(0);
  const [autoNote, setAutoNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: string; stake: number; result: Side; selected: Side; endsAt: number; balanceBefore: number } | null>(null);
  const recordAuto = useRef<(round: { costCents: number; payoutCents: number; balanceAfterCents: number }) => void>(() => undefined);
  const active = phase === 'flipping';
  const live = mode === 'live';
  const complete = useCallback(function complete(leaving = false) {
    const current = pending.current;
    if (!current) return;
    if (timer.current) clearTimeout(timer.current);
    const finished = performance.now() >= current.endsAt;
    if (!finished && !leaving) { timer.current = setTimeout(() => complete(), Math.max(1, Math.ceil(current.endsAt - performance.now()))); return; }
    pending.current = null; timer.current = null; setActiveDemo(false);
    const won = current.result === current.selected, gross = finished ? (won ? grossPayout(current.stake, 1.96) : 0) : current.stake;
    settleDemo({ id: current.id, game: 'Coinflip', stake: current.stake, payout: gross, detail: finished ? `${current.result === 'heads' ? 'Yazı' : 'Tura'} · ${won ? 'Kazandın' : 'Kaybettin'}` : 'Demo iptal edildi', at: Date.now() });
    if (!leaving) {
      setOutcome(current.result); setPayout(gross); setPhase(won ? 'won' : 'lost');
      recordAuto.current({ costCents: current.stake, payoutCents: gross, balanceAfterCents: current.balanceBefore - current.stake + gross });
    }
  }, [settleDemo, setActiveDemo]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) complete(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); complete(true); };
  }, [complete]);
  /** One normal local round on `chosen` (default: the selected side). True when it started. */
  function flip(chosen: Side = side): boolean {
    if (pending.current || live) return false;
    const stake = parseDemoAmount(amount);
    if (stake === null) { setError('game.errors.amountRange'); return false; }
    let result: Side;
    try { result = randomUnit() < 0.5 ? 'heads' : 'tails'; }
    catch { setError('game.errors.noRandomness'); return false; }
    const balanceBefore = demoBalance;
    let id: string | null;
    try { id = reserveDemo(stake); }
    catch { setError('game.errors.noRandomness'); return false; }
    if (!id) { setError('game.errors.noCredit'); return false; }
    setError(''); setOutcome(null); setPhase('flipping'); setActiveDemo(true); pending.current = { id, stake, result, selected: chosen, endsAt: performance.now() + 1400, balanceBefore };
    timer.current = setTimeout(() => complete(), 1400);
    return true;
  }
  /** "Şansımı dene": a random side (player's pick only; the result is drawn independently), then a normal flip. */
  function tryLuck() {
    if (pending.current || live) return;
    let pick: Side;
    try { pick = randomUnit() < 0.5 ? 'heads' : 'tails'; } catch { setError('game.errors.noRandomness'); return; }
    setSide(pick);
    flip(pick);
  }
  const parsed = parseDemoAmount(amount);
  const auto = useInstantAutoplay({
    ready: !active && !live, play: () => flip(), balanceCents: demoBalance, costCents: parsed,
    onStopped: (code, state) => setAutoNote(tk('originals.autoStopped', { reason: tk(`autoplay.reasons.${code}`), rounds: state.spinsDone, net: format.signedDemo(autoplayNet(state)) })),
  });
  recordAuto.current = auto.record;
  const running = auto.state !== null;
  const locked = active || live || running;
  const maxCents = Math.max(MIN_CENTS, Math.min(DEMO_MAX_BET_CENTS, demoBalance));
  const setCents = (cents: number) => { setAmount(centsToInput(cents, format.decimal)); setError(''); };

  if (live) return <OriginalsPage><GameHeading title="Coinflip" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active}/><LiveCoinflip onDemo={() => setMode('demo')}/><OriginalsRow current="coinflip"/></OriginalsPage>;

  const shared = <>
    <BetAmountField id="bet-amount" value={amount} onChange={setAmount} disabled={locked} error={error ? tc(error) : ''} hint={tk('originals.amountHint')}
      onHalf={() => setCents(halveCents(parsed, MIN_CENTS))} onDouble={() => setCents(doubleCents(parsed, MIN_CENTS, maxCents))} />
    <ChoiceToggle legend={tk('originals.side')} value={side} onChange={setSide} disabled={locked}
      options={[{ value: 'heads', label: tc('game.heads'), icon: <span className="mini-coin" aria-hidden="true">S</span> }, { value: 'tails', label: tc('game.tails'), icon: <span className="mini-coin" aria-hidden="true">Ⅱ</span> }]} />
    <ProfitReadout value={parsed ? format.signedDemo(profitCents(parsed, FACTOR_HUNDREDTHS)) : '—'} note={tk('originals.profitOnWin', { factor })} up={!!parsed} />
  </>;
  const manual = <div className={o.actionSlot}>
    <button className={o.action} disabled={locked} onClick={() => flip()}>{active ? t('action.flipping') : <><span>{t('action.flip')}</span><Icon name="coin"/></>}</button>
    <p>{t('hint')}</p>
  </div>;
  const autoTab = running && auto.state
    ? <div className={o.actionSlot}><AutoplayStopButton remaining={auto.state.spinsRemaining} onStop={() => auto.stop('cancelled')} /><p role="status">{tk('originals.autoNote', { cost: parsed ? format.demo(parsed) : '—' })}</p></div>
    : <><AutoplayPanel instant onStart={config => { setAutoNote(''); auto.start(config); }} spinCostCents={parsed ?? undefined} balanceCents={demoBalance} disabled={active || !parsed} countLabel={tk('originals.autoCount')} />
      <p className={o.hint}>{tk('originals.autoNote', { cost: parsed ? format.demo(parsed) : '—' })}</p>
      {autoNote && <p className={o.hint} role="status">{autoNote}</p>}</>;

  return <OriginalsPage><GameHeading title="Coinflip" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active || running}/>
    <OriginalsTable label={t('tableLabel')} className="coinflip-table"
      panel={<BetPanel tab={tab} onTabChange={setTab} shared={shared} manual={manual} auto={autoTab} />}
      stage={<>
        <div className="table-topline"><span className="table-status"><span className="status-dot"/>{active ? t('status.flipping') : t('status.ready')}</span><DemoBalance/></div>
        <div className="coin-stage">
          <div className="coin-orbits" aria-hidden="true"><span/><span/><span/></div><span className="coin-caption">{t(`caption.${phase}`)}</span><div className={`coin-object ${active ? 'flipping' : ''} ${outcome === 'tails' ? 'show-tails' : ''}`} aria-hidden="true"><div className="coin-face coin-heads"><div><BrandMark/></div><span>SOLLISH</span></div><div className="coin-face coin-tails"><div className="tails-emblem">Ⅱ</div><span>SOLLISH</span></div></div><div className="coin-result" role="status" aria-live="polite"><strong>{outcome ? outcome === 'heads' ? tc('game.heads') : tc('game.tails') : t('result.either')}</strong><span>{phase === 'won' ? t('result.won', { amount: money(payout) }) : phase === 'lost' ? t('result.lost') : active ? t('result.active') : t('result.idle', { factor })}</span></div>
          <div className="stage-bottom"><span><BrandMark/>{t('bottom.local')}</span><span>{t('bottom.odds')}</span></div>
        </div>
      </>} />
    <OriginalsInfo gameId="coinflip" onTry={tryLuck} tryDisabled={locked} tryHint={tk('originals.strip.tryCoinflip')} />
    <OriginalsRow current="coinflip"/>
    <GameInfoStrip id="coinflip"/><DemoNotice/><GameHistory game="Coinflip"/><Rules game="Coinflip"/>
  </OriginalsPage>;
}
