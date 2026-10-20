'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { demoNumber, grossPayout, multiplierLabel, parseDemoAmount, randomUnit, type Side } from '@/lib/demo';
import { AmountControl, DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, SidePicker, type Mode } from './game-common';
import { BrandMark, Icon } from './icons';
import { useProduct } from './providers';
import { LiveCoinflip } from './live-coinflip';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
type ErrorKey = Extract<MessageKey<'common'>, `game.errors.${string}`>;
export function CoinflipGame() {
  const { reserveDemo, settleDemo, setActiveDemo } = useProduct();
  const t = useT('coinflip');
  const tc = useT('common');
  const { locale } = useLocale();
  const money = (cents: number) => demoNumber(cents, locale);
  const factor = multiplierLabel(1.96, locale);
  const [mode, setMode] = useState<Mode>('demo');
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<Side>('heads');
  const [error, setError] = useState<ErrorKey | ''>('');
  const [phase, setPhase] = useState<'ready' | 'flipping' | 'won' | 'lost'>('ready');
  const [outcome, setOutcome] = useState<Side | null>(null);
  const [payout, setPayout] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: string; stake: number; result: Side; selected: Side; endsAt: number } | null>(null);
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
    if (!leaving) { setOutcome(current.result); setPayout(gross); setPhase(won ? 'won' : 'lost'); }
  }, [settleDemo, setActiveDemo]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) complete(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); complete(true); };
  }, [complete]);
  function flip() {
    if (pending.current || live) return;
    const stake = parseDemoAmount(amount);
    if (stake === null) { setError('game.errors.amountRange'); return; }
    let result: Side;
    try { result = randomUnit() < 0.5 ? 'heads' : 'tails'; }
    catch { setError('game.errors.noRandomness'); return; }
    let id: string | null;
    try { id = reserveDemo(stake); }
    catch { setError('game.errors.noRandomness'); return; }
    if (!id) { setError('game.errors.noCredit'); return; }
    setError(''); setOutcome(null); setPhase('flipping'); setActiveDemo(true); pending.current = { id, stake, result, selected: side, endsAt: performance.now() + 1400 };
    timer.current = setTimeout(() => complete(), 1400);
  }
  const parsed = parseDemoAmount(amount);
  if (live) return <div className="game-page"><GameHeading title="Coinflip" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active}/><LiveCoinflip onDemo={() => setMode('demo')}/></div>;
  return <div className="game-page"><GameHeading title="Coinflip" subtitle={t('subtitle')} mode={mode} setMode={setMode} active={active}/><section className="game-table coinflip-table" aria-label={t('tableLabel')}><div className="table-topline"><span className="table-status"><span className="status-dot"/>{live ? t('status.live') : active ? t('status.flipping') : t('status.ready')}</span>{!live && <DemoBalance/>}</div><div className="coin-stage">
      {live ? <div className="stage-readout gated-readout"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>{t('gate.title')}</h2><p>{t('gate.text')}</p><button className="text-button" onClick={() => setMode('demo')}>{t('gate.tryDemo')}<Icon name="arrow" size={17}/></button></div> : <><div className="coin-orbits" aria-hidden="true"><span/><span/><span/></div><span className="coin-caption">{t(`caption.${phase}`)}</span><div className={`coin-object ${active ? 'flipping' : ''} ${outcome === 'tails' ? 'show-tails' : ''}`} aria-hidden="true"><div className="coin-face coin-heads"><div><BrandMark/></div><span>SOLLISH</span></div><div className="coin-face coin-tails"><div className="tails-emblem">Ⅱ</div><span>SOLLISH</span></div></div><div className="coin-result" role="status" aria-live="polite"><strong>{outcome ? outcome === 'heads' ? tc('game.heads') : tc('game.tails') : t('result.either')}</strong><span>{phase === 'won' ? t('result.won', { amount: money(payout) }) : phase === 'lost' ? t('result.lost') : active ? t('result.active') : t('result.idle', { factor })}</span></div></>}
      <div className="stage-bottom"><span><BrandMark/>{t('bottom.local')}</span><span>{t('bottom.odds')}</span></div></div><div className="coin-choices"><SidePicker side={side} setSide={setSide} disabled={active || live}/><div className="odds-note"><span>{t('odds.label')}</span><strong>{factor}</strong><small>{t('odds.note')}</small></div></div><div className="bet-controls"><AmountControl amount={amount} setAmount={setAmount} disabled={active || live} error={error ? tc(error) : ''}/><div className="payout-preview"><span>{t('preview.win')}</span><strong>{parsed ? money(grossPayout(parsed, 1.96)) : '—'}<small> DEMO</small></strong><span className="small muted">{t('preview.fee')}</span></div><div className="action-slot"><button className="button primary game-action" disabled={active || live} onClick={flip}>{live ? <><Icon name="lock" size={16}/>{t('action.liveClosed')}</> : active ? t('action.flipping') : <><span>{t('action.flip')}</span><Icon name="coin"/></>}</button><p>{t('hint')}</p></div></div></section><DemoNotice/><GameHistory game="Coinflip"/><Rules game="Coinflip"/></div>;
}
