'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MATCH_MARKETS, MATCH_OPEN_MS, RINGSIDE_FEE_BPS, COMBAT_V5_DURATION_MS, CONTACT_TICK_MS, V5_FIGHTERS, V5_PLAN_LEAD_MS, replayContactV5, type V5Mind, type MatchMarket, type FighterId, type RingPool, type RingTicket } from '@sollish/protocol';
import { useRingside, bettingOpen, ledgerOf } from '@/lib/use-ringside';
import { CornerBoard } from './ringside-corner-board';
import { demoNumber, parseDemoAmount } from '@/lib/demo';
import { useFormat, useLocale, useT } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/catalog';
import type { BroadcastLabels } from '@/lib/ringside-labels';
import s from './ringside-contact.module.css';
// 2D fighting-game broadcast from a fixed side camera (lib/ringside-2d) with a tactical overhead map, replays and arena sound.
const Broadcast = dynamic(() => import('./ringside-broadcast'), { ssr: false });
class Boundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } componentDidCatch() { this.props.onError(); } render() { return this.state.failed ? null : this.props.children; } }

type K = MessageKey<'ringside'>;
const FIGHTER: Record<string, string> = { kor: 'KOR', ayaz: 'AYAZ' };
const market = (id: MatchMarket) => MATCH_MARKETS.find(m => m.id === id)!;
const sideOf = (o: string) => o.startsWith('kor') ? 'kor' : o.startsWith('ayaz') ? 'ayaz' : o === 'draw' ? 'draw' : 'neutral';
const clock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** Gross return if the pool closed now with this stake in it (fee taken once per pool). Null: the pool would refund. */
function projected(pool: RingPool | undefined, outcome: string, stake: number, placed: boolean) {
  const total = (pool?.total ?? 0) + (placed ? 0 : stake), side = (pool?.sides[outcome] ?? 0) + (placed ? 0 : stake);
  if (!stake || !side || side === total) return null;
  return Math.floor((total - Math.floor(total * RINGSIDE_FEE_BPS / 10_000)) * stake / side);
}

const ICONS: Record<string, string> = {
  broadcast: 'M3 7h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM18 11l4-2v6l-4-2',
  overhead: 'M12 3v18M3 12h18M7 7l10 10M17 7L7 17',
  sound: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  exit: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
};
const Ico = ({ n }: { n: string }) => <svg className={s.ico} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]}/></svg>;

type Stage = 'connecting' | 'betting' | 'starting' | 'fighting' | 'break' | 'final';
type Track = { tone: 'up' | 'down' | 'even' | 'won' | 'lost' | 'wait'; text: string };

/** The one live Ringside game: a three-round Contact 5 match with one ticket per market for the whole bout. */
export function RingsideArena() {
  const t = useT('ringside'), { locale } = useLocale(), format = useFormat();
  const dn = (cents: number) => demoNumber(cents, locale);
  const two = useMemo(() => new Intl.NumberFormat(format.intl, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }), [format.intl]);
  const decimal = (n: number) => two.format(Number(n.toFixed(2))), times = (n: number) => `×${decimal(n)}`;
  const nm = (id: string) => FIGHTER[id] ?? t('draw');
  const act = (a: string, fallback = a) => t.has(`action.${a}`) ? t(`action.${a}` as K) : fallback;
  const marketLabel = (id: MatchMarket) => t(`market.${id}.label` as K);
  const outcomeLabel = (id: MatchMarket, o: string) => { const m = market(id); return t.has(`market.${id}.outcomes.${o}`) ? t(`market.${id}.outcomes.${o}` as K) : m.labels[(m.outcomes as readonly string[]).indexOf(o)] ?? o; };
  const traits = (id: FighterId) => { const f = V5_FIGHTERS[id]; return [[t('trait.reach'), f.reach < 0 ? t('trait.short') : t('trait.long')], [t('trait.power'), decimal(f.power)], [t('trait.chin'), decimal(f.chin)], [t('trait.guard'), decimal(f.guard)]] as const; };
  const scene = useMemo<BroadcastLabels>(() => ({
    parts: { head: t('scene.head'), body: t('scene.body'), guard: t('scene.guard'), leg: t('scene.leg') },
    kicks: { teep: t('scene.teep'), lowKick: t('scene.lowKick'), bodyKick: t('scene.bodyKick'), headKick: t('scene.headKick'), knee: t('scene.knee') },
    counter: t('scene.counter'), dodge: t('scene.dodge'), down: t('scene.down'), floor: t('scene.floor'), count: t('scene.count'), replay: t('scene.replay'), highlight: t('scene.highlight'),
    knockdown: t('scene.knockdown'), stoppage: t('scene.stoppage'), rise: t('scene.rise'), riseSub: t('scene.riseSub'),
    combo: n => t('scene.combo', { n }), knockdownSub: name => t('scene.knockdownSub', { name }), stoppageSub: name => t('scene.stoppageSub', { name }),
  }), [t]);
  const arena = useRingside(5), round = arena.state?.round, bout = round?.bout, match = round?.match, now = arena.now;
  const [sound, setSound] = useState(false), [camera, setCamera] = useState<'broadcast' | 'overhead'>('broadcast');
  const [reduced, setReduced] = useState(false), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [fullscreen, setFullscreen] = useState(false), [screenError, setScreenError] = useState<'fullscreenFailed' | ''>('');
  const [marketId, setMarketId] = useState<MatchMarket>('match-winner'), [choice, setChoice] = useState<Record<MatchMarket, string>>({ 'match-winner': 'kor', 'match-method': 'kor-points', 'match-knockdowns': '2' }), [amount, setAmount] = useState('25');
  const [sheet, setSheet] = useState(false), [auditOpen, setAuditOpen] = useState(false), [flash, setFlash] = useState(0);
  const [closedKey, setClosedKey] = useState('');
  const stageRef = useRef<HTMLDivElement>(null), onReady = useCallback(() => setReady(true), []), onError = useCallback(() => setFailed(true), []);
  useEffect(() => { const q = matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReduced(q.matches); update(); q.addEventListener('change', update); const full = () => setFullscreen(document.fullscreenElement === stageRef.current); document.addEventListener('fullscreenchange', full); return () => { q.removeEventListener('change', update); document.removeEventListener('fullscreenchange', full); }; }, []);
  const toggleFull = async () => { try { setScreenError(''); if (document.fullscreenElement) await document.exitFullscreen(); else await stageRef.current?.requestFullscreen(); } catch { setScreenError('fullscreenFailed'); } };

  // Replay of the current round from the revealed seed and the growing coach-plan log (every entry is checked).
  const initialKey = bout ? `${bout.initial.health.kor},${bout.initial.health.ayaz},${bout.initial.stamina.kor},${bout.initial.stamina.ayaz}` : '';
  const plans = round?.plans, planKey = plans ? `${plans.length}:${plans.at(-1)?.hash ?? ''}` : '', boutRound = bout?.round ?? 1;
  const run = useMemo(() => {
    if (!round?.seed || !arena.verified || !initialKey || !plans?.length) return null;
    const [kh, ah, ks, as] = initialKey.split(',').map(Number);
    return replayContactV5(round.seed, { health: { kor: kh!, ayaz: ah! }, stamina: { kor: ks!, ayaz: as! } }, boutRound, plans, true, arena.carry ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.seed, arena.verified, initialKey, planKey, boutRound, arena.carry]);
  const replay = useMemo(() => run?.ok ? { frames: run.frames, events: run.events } : undefined, [run]);
  const minds: V5Mind[] = run?.ok ? run.minds : [];
  const elapsed = round?.startsAt ? Math.max(0, now - round.startsAt) : 0, tick = Math.floor(Math.min(elapsed, COMBAT_V5_DURATION_MS) / CONTACT_TICK_MS);
  const frame = replay ? replay.frames[Math.min(replay.frames.length - 1, tick)] : undefined;

  // Where the match stands. Bets are taken only in the window before round 1.
  const open = !!round && arena.connected && bettingOpen(round, now), final = !!match?.results;
  const stage: Stage = !round ? 'connecting' : round.phase === 'fighting' ? (now < round.startsAt! ? 'starting' : 'fighting') : round.phase === 'result' ? (final ? 'final' : 'break') : bout?.round === 1 ? (open ? 'betting' : 'starting') : 'break';
  const target = stage === 'betting' ? match?.closesAt : stage === 'starting' ? round?.startsAt ?? (round ? round.closesAt + V5_PLAN_LEAD_MS : null) : stage === 'fighting' ? round?.endsAt : stage === 'break' ? (round?.phase === 'result' ? round.nextAt! + V5_PLAN_LEAD_MS : round ? round.closesAt + V5_PLAN_LEAD_MS : null) : round?.nextAt;
  const remaining = Math.max(0, (target ?? now) - now);
  const cardKey = `${bout?.id ?? ''}:${stage === 'final' ? 'final' : bout?.round ?? 0}`, showCard = closedKey !== cardKey;

  // Tickets, pools and live projections. The ledger is the bout.
  const ledger = round ? ledgerOf(round) : null, mine = arena.tickets.filter(tk => tk.roundId === ledger);
  const pools = arena.state?.pools ?? [], pool = pools.find(p => p.market === marketId), spec = market(marketId);
  const placed = mine.find(tk => tk.market === marketId), chosen = placed?.outcome ?? choice[marketId], stake = parseDemoAmount(amount) ?? 0, probe = stake || 1000;
  const estimate = placed ? projected(pool, placed.outcome, placed.amount, true) : projected(pool, chosen, stake, false);
  const winnerPool = pools.find(p => p.market === 'match-winner');
  const price = (o: string) => { const r = projected(winnerPool, o, probe, false); return r === null ? null : r / probe; };
  const empty = winnerPool?.total ? '—' : t('cards.firstTicket'), priceText = (o: string) => price(o) ? times(price(o)!) : empty;
  const pickWinner = useCallback((id: string) => { setMarketId('match-winner'); setChoice(c => ({ ...c, 'match-winner': id })); setFlash(Date.now()); setSheet(true); }, []);
  const choose = (o: string) => { setChoice(c => ({ ...c, [marketId]: o })); setFlash(Date.now()); };
  const submit = () => { const value = parseDemoAmount(amount); if (open && !placed && !arena.pending && value !== null) arena.bet(marketId, chosen, value); };
  const winnerTicket = mine.find(tk => tk.market === 'match-winner')?.outcome, winnerPick = winnerTicket ?? (marketId === 'match-winner' ? chosen : null);
  const selection = open ? { labels: { kor: `KOR ${priceText('kor')}`, ayaz: `AYAZ ${priceText('ayaz')}` }, selected: winnerPick === 'kor' || winnerPick === 'ayaz' ? winnerPick as FighterId : null } : undefined;

  // Live reading of the bout for the ticket tracker: an indicator only; the result comes from the replay.
  const done = arena.history, current = round?.phase === 'result' && round.results ? round.results : null;
  const livePoints = frame && bout ? { kor: bout.initial.health.ayaz - frame.ayaz.health + 120 * frame.ayaz.knockdowns, ayaz: bout.initial.health.kor - frame.kor.health + 120 * frame.kor.knockdowns } : null;
  const stopEvent = replay?.events.find(e => e.type === 'finish' && e.tick <= tick);
  const roundLeader = current ? current.winner : stopEvent ? stopEvent.actor : livePoints && stage === 'fighting' ? (livePoints.kor > livePoints.ayaz ? 'kor' : livePoints.ayaz > livePoints.kor ? 'ayaz' : 'draw') : null;
  const won = { kor: bout?.score.kor ?? 0, ayaz: bout?.score.ayaz ?? 0 }; if (roundLeader === 'kor' || roundLeader === 'ayaz') won[roundLeader]++;
  const leader = match?.results ? match.results['match-winner'] : stopEvent || current?.finish === 'stoppage' ? roundLeader : won.kor > won.ayaz ? 'kor' : won.ayaz > won.kor ? 'ayaz' : 'draw';
  const knockdowns = done.reduce((n, r) => n + r.knockdowns, 0) + (replay?.events.filter(e => e.type === 'knockdown' && e.tick <= tick).length ?? 0);
  const track = (tk: RingTicket): Track => {
    if (tk.status === 'paid') return tk.payout > 0 ? { tone: 'won', text: t('track.won', { amount: dn(tk.payout) }) } : { tone: 'lost', text: t('track.lost') };
    if (tk.status === 'refunded') return { tone: 'even', text: t('track.refunded', { amount: dn(tk.payout) }) };
    if (stage === 'betting' || stage === 'starting') return { tone: 'wait', text: t('track.notStarted') };
    if (tk.market === 'match-knockdowns') {
      const [lo, hi] = tk.outcome === '0-1' ? [0, 1] : tk.outcome === '2' ? [2, 2] : [3, Infinity];
      return knockdowns > hi ? { tone: 'lost', text: t('track.kdLost', { n: knockdowns }) } : knockdowns >= lo ? { tone: 'up', text: t('track.kdHolding', { n: knockdowns }) } : { tone: 'even', text: t('track.kdNow', { n: knockdowns }) };
    }
    const side = sideOf(tk.outcome);
    return leader === side ? { tone: 'up', text: t('track.ahead') } : leader === 'draw' || !leader ? { tone: 'even', text: t('track.even') } : { tone: 'down', text: t('track.behind') };
  };

  // Without NEXT_PUBLIC_API_URL there is no live server to wait for: say so instead of an endless "connecting".
  const offline = arena.error === 'NOT_CONFIGURED';
  const errorText = arena.error ? t(`error.${arena.error}`) : screenError ? t(`controls.${screenError}`) : '';
  const ended = final || current?.finish === 'stoppage';
  const flow = [
    { id: 'bet', label: t('flow.bet'), state: stage === 'betting' ? 'active' : stage === 'connecting' ? 'todo' : 'done', note: stage === 'betting' ? clock(remaining) : '', side: undefined as string | undefined },
    ...[1, 2, 3].map(n => {
      const past = done.find(r => r.round === n), res = past ?? (bout?.round === n && current ? current : null), active = bout?.round === n && (stage === 'fighting' || stage === 'starting');
      return { id: `r${n}`, label: t('flow.round', { n }), state: active ? 'active' : res ? 'done' : bout && ended && n > bout.round ? 'skip' : 'todo', note: active ? clock(remaining) : res ? (res.finish === 'stoppage' ? t('flow.winnerKo', { name: nm(res.winner) }) : nm(res.winner)) : '', side: res?.winner };
    }),
    { id: 'end', label: t('flow.result'), state: final ? 'active' : 'todo', note: final ? nm(match!.results!['match-winner']) : '', side: match?.results?.['match-winner'] },
  ];
  const lastEvent = replay?.events.filter(e => e.tick <= tick && (e.type === 'hit' || e.type === 'knockdown')).at(-1);
  const payout = mine.reduce((n, tk) => n + tk.payout, 0), staked = mine.reduce((n, tk) => n + tk.amount, 0);
  const tape = arena.state?.tape ?? [], audit = arena.audit?.roundId === ledger ? arena.audit : null;
  const startedAt = round?.startsAt && arena.state ? arena.state.receivedAt + round.startsAt - arena.state.serverAt : null;
  const broadcastPhase = round?.phase === 'fighting' ? 'fighting' : round?.phase === 'result' ? 'finished' : 'idle';
  const resultWinner = round?.phase === 'result' && (round.results?.winner === 'kor' || round.results?.winner === 'ayaz') ? round.results.winner : null;
  const ctaText = placed ? t('cta.hasTicket') : arena.pending ? t('cta.sending') : !open ? t('cta.closed') : stake ? t('cta.pick', { outcome: outcomeLabel(marketId, chosen), amount: dn(stake) }) : t('cta.enterAmount');
  const handleText = open ? (mine.length ? t('handle.coupon', { n: mine.length }) : estimate ? t('handle.estimate', { outcome: outcomeLabel(marketId, chosen), amount: dn(estimate) }) : t('handle.choose', { outcome: outcomeLabel(marketId, chosen) })) : mine.length ? t('handle.status', { status: track(mine[0]!).text }) : t('handle.title');

  return <div className={s.page} data-testid="ringside-contact" data-stage={stage}>
    <section className={s.top} aria-label={t('flow.aria')}>
      <div className={s.title}>
        <h1><b data-side="kor">KOR</b> <span>vs</span> <b data-side="ayaz">AYAZ</b></h1>
        <p>{bout ? t('top.matchNo', { id: bout.id }) : t('top.match')} · {t('top.rounds')} · <span className={s.demoTag}>{t('top.demo')}</span></p>
      </div>
      <ol className={s.flow} data-testid="ring-flow">{flow.map(f => <li key={f.id} data-state={f.state} data-side={f.side}><span>{f.label}</span>{f.note && <b>{f.note}</b>}</li>)}</ol>
    </section>

    <div className={s.layout}>
      <main className={s.main}>
        <div ref={stageRef} className={s.stage} data-testid="ring-stage" data-phase={round?.phase ?? 'connecting'}>
          {!failed && <Boundary onError={onError}><Broadcast labels={scene} phase={broadcastPhase} winner={resultWinner} fightId={Number(round?.id ?? 0)} startedAt={startedAt} durationMs={COMBAT_V5_DURATION_MS} reducedMotion={reduced} camera={camera} replay={replay} sound={sound} selection={selection} onSelectFighter={open ? pickWinner : undefined} onReady={onReady} onError={onError}/></Boundary>}
          {(!ready || failed) && <div className={s.loading}><strong>RINGSIDE</strong><p>{failed ? t('loading.failed') : t('loading.preparing')}</p></div>}
          <div className={s.stageTop}>
            <span className={s.live} data-on={arena.connected} data-offline={offline || undefined}><i/>{arena.connected ? t('status.live') : offline ? t('status.offline') : t('status.connecting')}</span>
            <span className={s.verify} data-ok={arena.verified} title={t('status.verifyHint')}>{arena.verified ? t('status.verified') : t('status.committed')}</span>
          </div>
          {stage !== 'betting' && stage !== 'connecting' && <div className={s.scorebug} data-testid="ring-clock">
            {(['kor', 'ayaz'] as const).map(id => <div key={id} className={s.bugSide} data-side={id}>
              <span><b>{FIGHTER[id]}</b><small>{frame ? act(frame[id].action, '') : t('bug.ready')}</small></span>
              <i className={s.health}><i style={{ width: `${(frame?.[id].health ?? bout?.initial.health[id] ?? 1000) / 10}%` }}/></i>
              <small>{t('bug.stats', { hits: frame?.[id].hits ?? 0, stamina: Math.round((frame?.[id].stamina ?? bout?.initial.stamina[id] ?? 1000) / 10) })}</small>
            </div>)}
            <div className={s.bugClock}><span>{stage === 'fighting' ? t('bug.round', { n: bout?.round ?? 1 }) : stage === 'starting' ? t('bug.starting', { n: bout?.round ?? 1 }) : stage === 'break' ? t('bug.break') : t('bug.over')}</span><b>{clock(remaining)}</b><small>{t('bug.score')} <em data-side="kor">{(bout?.score.kor ?? 0) + (current?.winner === 'kor' ? 1 : 0)}</em>–<em data-side="ayaz">{(bout?.score.ayaz ?? 0) + (current?.winner === 'ayaz' ? 1 : 0)}</em></small></div>
          </div>}
          {stage === 'betting' && <div className={s.prompt}><b>{t('prompt.pick')}</b><span>{t('prompt.pickSub', { time: clock(remaining) })}</span></div>}
          {stage === 'connecting' && (offline
            ? <div className={s.prompt} data-offline="" data-testid="ring-offline"><b>{t('prompt.offline')}</b><span>{t('prompt.offlineSub')}</span><Link href="/" className={s.promptLink}>{t('prompt.lobby')}</Link></div>
            : <div className={s.prompt}><b>{t('prompt.connecting')}</b><span>{errorText || t('prompt.waiting')}</span></div>)}
          {stage === 'fighting' && lastEvent && <div className={s.toast} key={lastEvent.tick} data-side={lastEvent.actor}><b>{lastEvent.type === 'knockdown' ? t('toast.knockdown') : lastEvent.counter ? t('toast.counter') : t('toast.hit')}</b>{nm(lastEvent.actor)}{lastEvent.type === 'knockdown' ? ` → ${nm(lastEvent.target)}` : ''} · {act(lastEvent.technique)}{lastEvent.type === 'hit' ? ` · ${t('toast.damage', { damage: lastEvent.damage })}` : ''}</div>}
          {showCard && stage === 'break' && current && <div className={s.card} role="status" key={cardKey}><button type="button" className={s.close} aria-label={t('card.close')} onClick={() => setClosedKey(cardKey)}>✕</button><span>{t('card.breakTitle', { n: bout?.round ?? 1 })}</span><strong data-side={current.winner}>{current.winner === 'draw' ? t('draw') : t('card.won', { name: nm(current.winner) })}</strong><p>{run?.ok && run.replay ? `${t('card.points', { kor: run.replay.points.kor, ayaz: run.replay.points.ayaz })} · ` : ''}{knockdowns ? `${t('card.knockdownsTotal', { n: knockdowns })} · ` : ''}{t.rich('card.next', { b: chunk => <b key="b">{chunk}</b> }, { n: (bout?.round ?? 1) + 1, time: clock(remaining) })}</p></div>}
          {showCard && stage === 'final' && match?.results && <div className={s.card} data-final="true" role="status" key={cardKey}><button type="button" className={s.close} aria-label={t('card.close')} onClick={() => setClosedKey(cardKey)}>✕</button><span>{t('card.finalTitle', { id: bout?.id ?? '' })}</span><strong data-side={match.results['match-winner']}>{match.results['match-winner'] === 'draw' ? t('card.finalDraw') : nm(match.results['match-winner'])}</strong><p>{outcomeLabel('match-method', match.results['match-method'])} · {outcomeLabel('match-knockdowns', match.results['match-knockdowns'])}</p>{mine.length > 0 && <em data-good={payout > staked}>{t('card.coupon', { amount: payout ? `+${dn(payout)}` : '0' })}</em>}<small>{t.rich('card.nextOpens', { b: chunk => <b key="b">{chunk}</b> }, { time: clock(remaining) })}</small></div>}
          {!showCard && (stage === 'break' || stage === 'final') && <button type="button" className={s.reopen} onClick={() => setClosedKey('')}>{t('card.reopen')}</button>}
          <div className={s.controls}>
            <div role="group" aria-label={t('controls.camera')}>{([['broadcast', t('controls.broadcast')], ['overhead', t('controls.overhead')]] as const).map(([id, text]) => <button type="button" aria-pressed={camera === id} key={id} onClick={() => setCamera(id)}><Ico n={id}/><span>{text}</span></button>)}</div>
            <button type="button" aria-pressed={sound} onClick={() => setSound(v => !v)}><Ico n={sound ? 'sound' : 'mute'}/><span>{sound ? t('controls.soundOn') : t('controls.sound')}</span></button>
            <button type="button" aria-label={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')} onClick={() => void toggleFull()}><Ico n={fullscreen ? 'exit' : 'full'}/><span className={s.btnText}>{fullscreen ? t('controls.shrink') : t('controls.fullscreen')}</span></button>
          </div>
        </div>

        {stage === 'betting' || stage === 'connecting' ? <div className={s.cards}>
          {(['kor', 'draw', 'ayaz'] as const).map(id => id === 'draw'
            ? <button key={id} type="button" className={s.crowd} aria-pressed={winnerPick === 'draw'} disabled={!open || !!winnerTicket} onClick={() => pickWinner('draw')}>
                <span className={s.cardLabel}>{t('cards.crowd')}</span>
                <span className={s.split}>{(['kor', 'draw', 'ayaz'] as const).map(o => <i key={o} data-side={o} style={{ width: `${winnerPool?.total ? (winnerPool.sides[o] ?? 0) / winnerPool.total * 100 : 0}%` }}/>)}</span>
                <span className={s.splitText}>{(['kor', 'draw', 'ayaz'] as const).map(o => <small key={o}>{o === 'draw' ? t('cards.drawShort') : FIGHTER[o]} {t('cards.pct', { n: winnerPool?.total ? Math.round((winnerPool.sides[o] ?? 0) / winnerPool.total * 100) : 0 })}</small>)}</span>
                <span className={s.cardFoot}><b>{t('draw')}</b><em>{priceText('draw')}</em></span>
              </button>
            : <button key={id} type="button" className={s.fighter} data-side={id} aria-pressed={winnerPick === id} disabled={!open || !!winnerTicket} onClick={() => pickWinner(id)} aria-label={t('cards.fighterAria', { name: FIGHTER[id]! })}>
                <i className={s.portrait} data-side={id} aria-hidden="true"/><span className={s.cardHead}><b>{FIGHTER[id]}</b><small>{t(`style.${id}`)}</small></span>
                <span className={s.traits}>{traits(id).map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</span>
                <span className={s.cardFoot}><b>{t('cards.fighterWins', { name: FIGHTER[id]! })}</b><em>{priceText(id)}</em></span>
              </button>)}
        </div> : <div className={s.liveGrid}>
          {plans && plans.length > 0 && <section className={s.panel} aria-label={t('corner.title')}><h2>{t('corner.title')} <small>{t('corner.sub')}</small></h2><CornerBoard plans={plans} minds={minds} tick={tick} pending={!replay || replay.frames.length * CONTACT_TICK_MS <= elapsed}/></section>}
          <section className={s.panel} aria-label={t('summary.title')}><h2>{t('summary.title')}</h2><ol className={s.summary}>{[1, 2, 3].map(n => {
            const r = done.find(x => x.round === n), isNow = bout?.round === n, side = r?.winner ?? (isNow && current ? current.winner : undefined);
            const text = r ? `${r.winner === 'draw' ? t('draw') : t('card.won', { name: nm(r.winner) })} · ${r.points.kor}–${r.points.ayaz}${r.knockdowns ? ` · ${t('summary.knockdowns', { n: r.knockdowns })}` : ''}`
              : isNow ? (current ? `${current.winner === 'draw' ? t('draw') : t('card.won', { name: nm(current.winner) })}${current.finish === 'stoppage' ? ` · ${t('summary.stoppage')}` : ''}` : livePoints && stage === 'fighting' ? `${t('summary.going')} · ${livePoints.kor}–${livePoints.ayaz}` : t('summary.starting'))
              : bout && ended && n > bout.round ? t('summary.notPlayed') : t('summary.waiting');
            return <li key={n} data-side={side}><span>R{n}</span><b>{text}</b></li>;
          })}</ol></section>
        </div>}
      </main>

      <aside className={s.slip} data-open={sheet} aria-label={t('slip.aria')}>
        <button type="button" className={s.handle} aria-expanded={sheet} onClick={() => setSheet(v => !v)}><i/><span>{handleText}</span></button>
        <div className={s.slipHead}><h2>{open ? t('slip.titleOpen') : t('slip.titleClosed')}</h2><span data-open={open}>{open ? t('slip.open', { time: clock(remaining) }) : final ? t('slip.settled') : t('slip.closed')}</span></div>
        <div className={s.balance}><span>{t('slip.balance')}</span><b data-testid="ring-balance">{arena.balance === null ? '—' : dn(arena.balance)}</b></div>

        {open && <form className={s.slipBody} onSubmit={e => { e.preventDefault(); submit(); }}>
          <div className={s.tabs} role="group" aria-label={t('slip.market')}>{MATCH_MARKETS.map(m => <button key={m.id} type="button" aria-pressed={marketId === m.id} onClick={() => setMarketId(m.id)}>{marketLabel(m.id)}{mine.some(tk => tk.market === m.id) && <i aria-label={t('slip.hasTicket')}>✓</i>}</button>)}</div>
          <p className={s.hint}>{t(`hint.${marketId}`)}</p>
          <fieldset className={s.outcomes} disabled={!!placed}><legend className={s.sr}>{marketLabel(marketId)}</legend>{spec.outcomes.map(o => {
            const share = pool?.total ? (pool.sides[o] ?? 0) / pool.total * 100 : 0, ret = projected(pool, o, probe, false);
            return <button type="button" key={o} data-side={sideOf(o)} aria-pressed={chosen === o} onClick={() => choose(o)}><i style={{ width: `${share}%` }}/><span><em/>{outcomeLabel(marketId, o)}<small>{t('cards.pct', { n: Math.round(share) })}</small></span><b>{ret ? times(ret / probe) : '—'}</b></button>;
          })}</fieldset>
          <label className={s.amount} htmlFor="ring-amount"><span>{t('slip.amount')} <small>{t('slip.amountRange')}</small></span><span className={s.amountBox}><input id="ring-amount" inputMode="decimal" value={placed ? String(placed.amount / 100) : amount} onChange={e => setAmount(e.target.value)} disabled={!!placed} aria-invalid={parseDemoAmount(amount) === null}/>DEMO</span></label>
          <div className={s.chips}>{['10', '25', '50', '100', '500'].map(n => <button type="button" key={n} aria-pressed={amount === n} disabled={!!placed} onClick={() => setAmount(n)}>{n === '500' ? t('slip.max') : n}</button>)}</div>
          <dl className={s.summaryBox} key={flash}><div><dt>{t('slip.yourPick')}</dt><dd data-side={sideOf(chosen)}>{outcomeLabel(marketId, chosen)} · {placed ? dn(placed.amount) : stake ? dn(stake) : '—'} DEMO</dd></div><div className={s.est}><dt>{t('slip.estReturn')}</dt><dd>{estimate === null ? (pool?.total ? t('slip.refund') : t('slip.waitingOpponent')) : `${dn(estimate)} DEMO`}</dd></div></dl>
          <button className={s.cta} type="submit" data-side={sideOf(chosen)} disabled={!open || !!placed || arena.pending || parseDemoAmount(amount) === null}>{ctaText}</button>
          <p className={s.fine}>{t('slip.fine')}</p>
          <details className={s.rules}><summary>{t('slip.rulesTitle')}</summary><p>{t('slip.rulesBody', { seconds: Math.round(MATCH_OPEN_MS / 1000) })}</p></details>
        </form>}

        <div className={s.tickets} data-testid="ring-tickets">
          {mine.length ? mine.map(tk => { const tr = track(tk), r = tk.status === 'accepted' ? projected(pools.find(p => p.market === tk.market), tk.outcome, tk.amount, true) : null; return <div key={tk.id} className={s.ticket} data-tone={tr.tone}><span className={s.ticketMarket}>{marketLabel(tk.market as MatchMarket)}</span><b data-side={sideOf(tk.outcome)}>{outcomeLabel(tk.market as MatchMarket, tk.outcome)}</b><span className={s.ticketMeta}>{dn(tk.amount)} DEMO{tk.status === 'accepted' ? ` · ${r ? t('slip.ifWins', { amount: dn(r) }) : t('slip.refundNow')}` : ''}</span><em>{tr.text}</em></div>; })
            : <p className={s.empty}>{open ? t('slip.emptyOpen') : t('slip.emptyClosed', { seconds: Math.round(MATCH_OPEN_MS / 1000) })}</p>}
          {mine.length > 0 && !open && !final && <p className={s.fine}>{t('slip.indicatorNote')}</p>}
        </div>
      </aside>
    </div>

    <div className={s.lower}>
      {stage === 'betting' && <ol className={s.steps}><li><b>1</b><span><strong>{t('steps.pick.title')}</strong>{t('steps.pick.body', { seconds: Math.round(MATCH_OPEN_MS / 1000) })}</span></li><li><b>2</b><span><strong>{t('steps.watch.title')}</strong>{t('steps.watch.body')}</span></li><li><b>3</b><span><strong>{t('steps.result.title')}</strong>{t('steps.result.body')}</span></li></ol>}
      <section className={s.panel} aria-label={t('pools.aria')}>
        <h2>{t('pools.title')} <small data-testid="ring-total">{arena.state ? t('pools.total', { count: arena.state.count, amount: dn(arena.state.total), online: arena.state.online }) : ''}</small><button type="button" disabled={!arena.connected} onClick={() => { setAuditOpen(true); arena.requestAudit(); }}>{t('pools.all')}</button></h2>
        <div className={s.pools}>{MATCH_MARKETS.map(m => { const p = pools.find(x => x.market === m.id); return <div key={m.id}><span>{marketLabel(m.id)} <small>{p ? t('pools.poolLine', { amount: dn(p.total), status: t(`pools.status.${p.status === 'open' || p.status === 'locked' || p.status === 'paid' ? p.status : 'refunded'}`) }) : ''}</small></span><span className={s.split}>{m.outcomes.map(o => <i key={o} data-side={sideOf(o)} style={{ width: `${p?.total ? (p.sides[o] ?? 0) / p.total * 100 : 0}%` }}/>)}</span></div>; })}</div>
        <ul className={s.tape}>{tape.slice(0, 8).map(tk => <li key={tk.seq}><span>{tk.alias.slice(-6)} · {marketLabel(tk.market as MatchMarket)}</span><b data-side={sideOf(tk.outcome)}>{outcomeLabel(tk.market as MatchMarket, tk.outcome)} · {dn(tk.amount)}</b></li>)}{!tape.length && <li className={s.empty}>{t('pools.tapeEmpty')}</li>}</ul>
      </section>
      <details className={s.technical}><summary>{t('technical.summary')}</summary><div>
        <p>{t('technical.p1')}</p>
        <p>{t('technical.p2')}</p>
        <p>{t('technical.p3')}</p>
        <p>{t('technical.p4')}</p>
        <dl><dt>{t('technical.engine')}</dt><dd>{round?.engine ?? '—'}</dd><dt>{t('technical.ledger')}</dt><dd>{match?.ledger ?? '—'}</dd><dt>{t('technical.commitment')}</dt><dd>{round?.commitment ?? '—'}</dd><dt>{t('technical.seedHashes')}</dt><dd>{match?.seedHashes.join(' · ') ?? '—'}</dd><dt>{t('technical.seed')}</dt><dd>{round?.seed ?? t('technical.seedHidden')}</dd></dl>
      </div></details>
    </div>

    {errorText && !offline && <p className={s.error} role="alert">{errorText}</p>}
    {auditOpen && <div className={s.audit} role="dialog" aria-modal="false" aria-label={t('audit.aria')}><div><h2>{t('audit.title', { id: ledger ?? '' })}</h2><button type="button" onClick={() => setAuditOpen(false)} aria-label={t('audit.close')}>✕</button></div>{audit ? <><p>{t('audit.summary', { count: audit.entries.length, amount: dn(audit.entries.reduce((n, tk) => n + tk.amount, 0)) })}</p><a download={`ringside-match-${audit.roundId}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ unit: 'valueless DEMO', round, ...audit }, null, 2))}`}>{t('audit.download')}</a></> : <p>{t('audit.requesting')}</p>}</div>}
  </div>;
}
