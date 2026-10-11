'use client';
import dynamic from 'next/dynamic';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MATCH_MARKETS, MATCH_OPEN_MS, RINGSIDE_FEE_BPS, COMBAT_V5_DURATION_MS, CONTACT_TICK_MS, V5_FIGHTERS, V5_PLAN_LEAD_MS, replayContactV5, type V5Mind, type MatchMarket, type FighterId, type RingPool, type RingTicket } from '@sollish/protocol';
import { useRingside, bettingOpen, ledgerOf } from '@/lib/use-ringside';
import { CornerBoard } from './ringside-corner-board';
import { demoNumber, parseDemoAmount } from '@/lib/demo';
import s from './ringside-contact.module.css';
// 2D fighting-game broadcast from a fixed side camera (lib/ringside-2d) with a tactical overhead map, replays and arena sound.
const Broadcast = dynamic(() => import('./ringside-broadcast'), { ssr: false });
class Boundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } componentDidCatch() { this.props.onError(); } render() { return this.state.failed ? null : this.props.children; } }

const ACTION: Record<string, string> = { guard: 'Gard', advance: 'Baskı', retreat: 'Geri adım', circle: 'Açı değişimi', slip: 'Sıyrılma', roll: 'Eğilme', jab: 'Jab', cross: 'Düz', hook: 'Kroşe', leadHook: 'Ön kroşe', rearHook: 'Arka kroşe', uppercut: 'Aparkat', bodyHook: 'Gövde kroşesi', teep: 'Ön tekme (teep)', lowKick: 'Alçak tekme', bodyKick: 'Gövde tekmesi', headKick: 'Kafa tekmesi', knee: 'Diz', clinch: 'Klinç', stagger: 'Sarsıldı', down: 'Yerde', rise: 'Kalkıyor', neutral: 'Nötr köşe' };
const NAME: Record<string, string> = { kor: 'KOR', ayaz: 'AYAZ', draw: 'Berabere' };
const HINT: Record<MatchMarket, string> = {
  'match-winner': 'Maçı kim kazanır? Durdurma ya da üç raunt sonunda kazanılan rauntlar.',
  'match-method': 'Kazanan ve biçim birlikte. Daha zor; havuz beşe bölünür.',
  'match-knockdowns': 'Üç raunt boyunca kaç kez yere düşme olur?',
};
const STYLE = { kor: 'Kırmızı köşe · baskıcı', ayaz: 'Mavi köşe · mesafeci' } as const;
const market = (id: MatchMarket) => MATCH_MARKETS.find(m => m.id === id)!;
const outcomeLabel = (id: MatchMarket, o: string) => { const m = market(id); return m.labels[(m.outcomes as readonly string[]).indexOf(o)] ?? o; };
const sideOf = (o: string) => o.startsWith('kor') ? 'kor' : o.startsWith('ayaz') ? 'ayaz' : o === 'draw' ? 'draw' : 'neutral';
const clock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const times = (n: number) => `×${n.toFixed(2).replace('.', ',')}`;
const decimal = (n: number) => n.toFixed(2).replace('.', ',');
const traits = (id: FighterId) => { const t = V5_FIGHTERS[id]; return [['Erişim', t.reach < 0 ? 'kısa' : 'uzun'], ['Güç', decimal(t.power)], ['Çene', decimal(t.chin)], ['Gard', decimal(t.guard)]] as const; };
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
  const arena = useRingside(5), round = arena.state?.round, bout = round?.bout, match = round?.match, now = arena.now;
  const [sound, setSound] = useState(false), [camera, setCamera] = useState<'broadcast' | 'overhead'>('broadcast');
  const [reduced, setReduced] = useState(false), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [fullscreen, setFullscreen] = useState(false), [screenError, setScreenError] = useState('');
  const [marketId, setMarketId] = useState<MatchMarket>('match-winner'), [choice, setChoice] = useState<Record<MatchMarket, string>>({ 'match-winner': 'kor', 'match-method': 'kor-points', 'match-knockdowns': '2' }), [amount, setAmount] = useState('25');
  const [sheet, setSheet] = useState(false), [auditOpen, setAuditOpen] = useState(false), [flash, setFlash] = useState(0);
  const [closedKey, setClosedKey] = useState('');
  const stageRef = useRef<HTMLDivElement>(null), onReady = useCallback(() => setReady(true), []), onError = useCallback(() => setFailed(true), []);
  useEffect(() => { const q = matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReduced(q.matches); update(); q.addEventListener('change', update); const full = () => setFullscreen(document.fullscreenElement === stageRef.current); document.addEventListener('fullscreenchange', full); return () => { q.removeEventListener('change', update); document.removeEventListener('fullscreenchange', full); }; }, []);
  const toggleFull = async () => { try { setScreenError(''); if (document.fullscreenElement) await document.exitFullscreen(); else await stageRef.current?.requestFullscreen(); } catch { setScreenError('Tam ekran bu tarayıcıda açılamadı.'); } };

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
  const ledger = round ? ledgerOf(round) : null, mine = arena.tickets.filter(t => t.roundId === ledger);
  const pools = arena.state?.pools ?? [], pool = pools.find(p => p.market === marketId), spec = market(marketId);
  const placed = mine.find(t => t.market === marketId), chosen = placed?.outcome ?? choice[marketId], stake = parseDemoAmount(amount) ?? 0, probe = stake || 1000;
  const estimate = placed ? projected(pool, placed.outcome, placed.amount, true) : projected(pool, chosen, stake, false);
  const winnerPool = pools.find(p => p.market === 'match-winner');
  const price = (o: string) => { const r = projected(winnerPool, o, probe, false); return r === null ? null : r / probe; };
  const empty = winnerPool?.total ? '—' : 'ilk bilet', priceText = (o: string) => price(o) ? times(price(o)!) : empty;
  const pickWinner = useCallback((id: string) => { setMarketId('match-winner'); setChoice(c => ({ ...c, 'match-winner': id })); setFlash(Date.now()); setSheet(true); }, []);
  const choose = (o: string) => { setChoice(c => ({ ...c, [marketId]: o })); setFlash(Date.now()); };
  const submit = () => { const value = parseDemoAmount(amount); if (open && !placed && !arena.pending && value !== null) arena.bet(marketId, chosen, value); };
  const winnerTicket = mine.find(t => t.market === 'match-winner')?.outcome, winnerPick = winnerTicket ?? (marketId === 'match-winner' ? chosen : null);
  const selection = open ? { labels: { kor: `KOR ${priceText('kor')}`, ayaz: `AYAZ ${priceText('ayaz')}` }, selected: winnerPick === 'kor' || winnerPick === 'ayaz' ? winnerPick as FighterId : null } : undefined;

  // Live reading of the bout for the ticket tracker: an indicator only; the result comes from the replay.
  const done = arena.history, current = round?.phase === 'result' && round.results ? round.results : null;
  const livePoints = frame && bout ? { kor: bout.initial.health.ayaz - frame.ayaz.health + 120 * frame.ayaz.knockdowns, ayaz: bout.initial.health.kor - frame.kor.health + 120 * frame.kor.knockdowns } : null;
  const stopEvent = replay?.events.find(e => e.type === 'finish' && e.tick <= tick);
  const roundLeader = current ? current.winner : stopEvent ? stopEvent.actor : livePoints && stage === 'fighting' ? (livePoints.kor > livePoints.ayaz ? 'kor' : livePoints.ayaz > livePoints.kor ? 'ayaz' : 'draw') : null;
  const won = { kor: bout?.score.kor ?? 0, ayaz: bout?.score.ayaz ?? 0 }; if (roundLeader === 'kor' || roundLeader === 'ayaz') won[roundLeader]++;
  const leader = match?.results ? match.results['match-winner'] : stopEvent || current?.finish === 'stoppage' ? roundLeader : won.kor > won.ayaz ? 'kor' : won.ayaz > won.kor ? 'ayaz' : 'draw';
  const knockdowns = done.reduce((n, r) => n + r.knockdowns, 0) + (replay?.events.filter(e => e.type === 'knockdown' && e.tick <= tick).length ?? 0);
  const track = (t: RingTicket): Track => {
    if (t.status === 'paid') return t.payout > 0 ? { tone: 'won', text: `Kazandı · +${demoNumber(t.payout)}` } : { tone: 'lost', text: 'Kaybetti' };
    if (t.status === 'refunded') return { tone: 'even', text: `İade · ${demoNumber(t.payout)}` };
    if (stage === 'betting' || stage === 'starting') return { tone: 'wait', text: 'Maç başlamadı' };
    if (t.market === 'match-knockdowns') {
      const [lo, hi] = t.outcome === '0-1' ? [0, 1] : t.outcome === '2' ? [2, 2] : [3, Infinity];
      return knockdowns > hi ? { tone: 'lost', text: `Tutmadı · ${knockdowns} yere düşme` } : knockdowns >= lo ? { tone: 'up', text: `Şimdilik tutuyor · ${knockdowns}` } : { tone: 'even', text: `Şu an ${knockdowns} yere düşme` };
    }
    const side = sideOf(t.outcome);
    return leader === side ? { tone: 'up', text: 'Şu an önde' } : leader === 'draw' || !leader ? { tone: 'even', text: 'Başa baş' } : { tone: 'down', text: 'Şu an geride' };
  };

  const ended = final || current?.finish === 'stoppage';
  const flow = [
    { id: 'bet', label: 'Bahis', state: stage === 'betting' ? 'active' : stage === 'connecting' ? 'todo' : 'done', note: stage === 'betting' ? clock(remaining) : '', side: undefined as string | undefined },
    ...[1, 2, 3].map(n => {
      const past = done.find(r => r.round === n), res = past ?? (bout?.round === n && current ? current : null), active = bout?.round === n && (stage === 'fighting' || stage === 'starting');
      return { id: `r${n}`, label: `R${n}`, state: active ? 'active' : res ? 'done' : bout && ended && n > bout.round ? 'skip' : 'todo', note: active ? clock(remaining) : res ? `${NAME[res.winner]}${res.finish === 'stoppage' ? ' · KO' : ''}` : '', side: res?.winner };
    }),
    { id: 'end', label: 'Sonuç', state: final ? 'active' : 'todo', note: final ? NAME[match!.results!['match-winner']] ?? '' : '', side: match?.results?.['match-winner'] },
  ];
  const lastEvent = replay?.events.filter(e => e.tick <= tick && (e.type === 'hit' || e.type === 'knockdown')).at(-1);
  const payout = mine.reduce((n, t) => n + t.payout, 0), staked = mine.reduce((n, t) => n + t.amount, 0);
  const tape = arena.state?.tape ?? [], audit = arena.audit?.roundId === ledger ? arena.audit : null;
  const startedAt = round?.startsAt && arena.state ? arena.state.receivedAt + round.startsAt - arena.state.serverAt : null;
  const broadcastPhase = round?.phase === 'fighting' ? 'fighting' : round?.phase === 'result' ? 'finished' : 'idle';
  const resultWinner = round?.phase === 'result' && (round.results?.winner === 'kor' || round.results?.winner === 'ayaz') ? round.results.winner : null;
  const ctaText = placed ? 'Bu pazarda biletin var' : arena.pending ? 'Gönderiliyor…' : !open ? 'Bahisler kapalı' : stake ? `${outcomeLabel(marketId, chosen)} · ${demoNumber(stake)} DEMO` : 'Miktar gir';
  const handleText = open ? (mine.length ? `Kuponun · ${mine.length} bilet` : `${outcomeLabel(marketId, chosen)} · ${estimate ? `tahmini ${demoNumber(estimate)}` : 'seç ve onayla'}`) : mine.length ? `Kuponun · ${track(mine[0]!).text}` : 'Maç kuponu';

  return <div className={s.page} data-testid="ringside-contact" data-stage={stage}>
    <section className={s.top} aria-label="Maç akışı">
      <div className={s.title}>
        <h1><b data-side="kor">KOR</b> <span>vs</span> <b data-side="ayaz">AYAZ</b></h1>
        <p>{bout ? `Maç #${bout.id}` : 'Maç'} · 3 raunt · <span className={s.demoTag}>DEMO · gerçek para yok</span></p>
      </div>
      <ol className={s.flow} data-testid="ring-flow">{flow.map(f => <li key={f.id} data-state={f.state} data-side={f.side}><span>{f.label}</span>{f.note && <b>{f.note}</b>}</li>)}</ol>
    </section>

    <div className={s.layout}>
      <main className={s.main}>
        <div ref={stageRef} className={s.stage} data-testid="ring-stage" data-phase={round?.phase ?? 'connecting'}>
          {!failed && <Boundary onError={onError}><Broadcast phase={broadcastPhase} winner={resultWinner} fightId={Number(round?.id ?? 0)} startedAt={startedAt} durationMs={COMBAT_V5_DURATION_MS} reducedMotion={reduced} camera={camera} replay={replay} sound={sound} selection={selection} onSelectFighter={open ? pickWinner : undefined} onReady={onReady} onError={onError}/></Boundary>}
          {(!ready || failed) && <div className={s.loading}><strong>RINGSIDE</strong><p>{failed ? 'Görüntü açılamadı. Biletler ve canlı veriler çalışmaya devam ediyor.' : 'Yayın hazırlanıyor'}</p></div>}
          <div className={s.stageTop}>
            <span className={s.live} data-on={arena.connected}><i/>{arena.connected ? 'CANLI' : 'BAĞLANIYOR'}</span>
            <span className={s.verify} data-ok={arena.verified} title="Tarayıcın raundu seed ve koç kaydıyla yeniden oynatıp kontrol eder">{arena.verified ? 'Tekrar doğrulandı ✓' : 'Seed taahhüt edildi'}</span>
          </div>
          {stage !== 'betting' && stage !== 'connecting' && <div className={s.scorebug} data-testid="ring-clock">
            {(['kor', 'ayaz'] as const).map(id => <div key={id} className={s.bugSide} data-side={id}>
              <span><b>{NAME[id]}</b><small>{frame ? ACTION[frame[id].action] ?? '' : 'Hazır'}</small></span>
              <i className={s.health}><i style={{ width: `${(frame?.[id].health ?? bout?.initial.health[id] ?? 1000) / 10}%` }}/></i>
              <small>{frame?.[id].hits ?? 0} isabet · %{Math.round((frame?.[id].stamina ?? bout?.initial.stamina[id] ?? 1000) / 10)} kondisyon</small>
            </div>)}
            <div className={s.bugClock}><span>{stage === 'fighting' ? `RAUNT ${bout?.round}` : stage === 'starting' ? `R${bout?.round} BAŞLIYOR` : stage === 'break' ? 'ARA' : 'MAÇ BİTTİ'}</span><b>{clock(remaining)}</b><small>Raunt <em data-side="kor">{(bout?.score.kor ?? 0) + (current?.winner === 'kor' ? 1 : 0)}</em>–<em data-side="ayaz">{(bout?.score.ayaz ?? 0) + (current?.winner === 'ayaz' ? 1 : 0)}</em></small></div>
          </div>}
          {stage === 'betting' && <div className={s.prompt}><b>Kim kazanır? Dövüşçüye dokun.</b><span>Tek bilet bütün maç için · bahis {clock(remaining)} sonra kapanır</span></div>}
          {stage === 'connecting' && <div className={s.prompt}><b>Arenaya bağlanılıyor</b><span>{arena.error || 'Canlı maç sunucusu bekleniyor.'}</span></div>}
          {stage === 'fighting' && lastEvent && <div className={s.toast} key={lastEvent.tick} data-side={lastEvent.actor}><b>{lastEvent.type === 'knockdown' ? 'YERE GÖNDERDİ' : lastEvent.counter ? 'KONTRA' : 'İSABET'}</b>{NAME[lastEvent.actor]}{lastEvent.type === 'knockdown' ? ` → ${NAME[lastEvent.target]}` : ''} · {ACTION[lastEvent.technique] ?? lastEvent.technique}{lastEvent.type === 'hit' ? ` · ${lastEvent.damage} hasar` : ''}</div>}
          {showCard && stage === 'break' && current && <div className={s.card} role="status" key={cardKey}><button type="button" className={s.close} aria-label="Sonucu kapat" onClick={() => setClosedKey(cardKey)}>✕</button><span>RAUNT {bout?.round} BİTTİ</span><strong data-side={current.winner}>{current.winner === 'draw' ? 'Berabere' : `${NAME[current.winner]} aldı`}</strong><p>{run?.ok && run.replay ? `${run.replay.points.kor} – ${run.replay.points.ayaz} puan · ` : ''}{knockdowns ? `${knockdowns} yere düşme toplam · ` : ''}R{(bout?.round ?? 1) + 1} <b>{clock(remaining)}</b> sonra</p></div>}
          {showCard && stage === 'final' && match?.results && <div className={s.card} data-final="true" role="status" key={cardKey}><button type="button" className={s.close} aria-label="Sonucu kapat" onClick={() => setClosedKey(cardKey)}>✕</button><span>MAÇ #{bout?.id} SONUCU</span><strong data-side={match.results['match-winner']}>{match.results['match-winner'] === 'draw' ? 'BERABERE' : NAME[match.results['match-winner']]}</strong><p>{outcomeLabel('match-method', match.results['match-method'])} · {outcomeLabel('match-knockdowns', match.results['match-knockdowns'])}</p>{mine.length > 0 && <em data-good={payout > staked}>Kuponun: {payout ? `+${demoNumber(payout)}` : '0'} DEMO</em>}<small>Sonraki maç bahsi <b>{clock(remaining)}</b> sonra açılır</small></div>}
          {!showCard && (stage === 'break' || stage === 'final') && <button type="button" className={s.reopen} onClick={() => setClosedKey('')}>Sonucu göster</button>}
          <div className={s.controls}>
            <div role="group" aria-label="İzleme kamerası">{([['broadcast', 'Yayın'], ['overhead', 'Taktik']] as const).map(([id, text]) => <button type="button" aria-pressed={camera === id} key={id} onClick={() => setCamera(id)}><Ico n={id}/><span>{text}</span></button>)}</div>
            <button type="button" aria-pressed={sound} onClick={() => setSound(v => !v)}><Ico n={sound ? 'sound' : 'mute'}/><span>{sound ? 'Ses açık' : 'Ses'}</span></button>
            <button type="button" aria-label={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={() => void toggleFull()}><Ico n={fullscreen ? 'exit' : 'full'}/><span className={s.btnText}>{fullscreen ? 'Küçült' : 'Tam ekran'}</span></button>
          </div>
        </div>

        {stage === 'betting' || stage === 'connecting' ? <div className={s.cards}>
          {(['kor', 'draw', 'ayaz'] as const).map(id => id === 'draw'
            ? <button key={id} type="button" className={s.crowd} aria-pressed={winnerPick === 'draw'} disabled={!open || !!winnerTicket} onClick={() => pickWinner('draw')}>
                <span className={s.cardLabel}>KALABALIK NE DİYOR</span>
                <span className={s.split}>{(['kor', 'draw', 'ayaz'] as const).map(o => <i key={o} data-side={o} style={{ width: `${winnerPool?.total ? (winnerPool.sides[o] ?? 0) / winnerPool.total * 100 : 0}%` }}/>)}</span>
                <span className={s.splitText}>{(['kor', 'draw', 'ayaz'] as const).map(o => <small key={o}>{o === 'draw' ? 'Ber.' : NAME[o]} %{winnerPool?.total ? Math.round((winnerPool.sides[o] ?? 0) / winnerPool.total * 100) : 0}</small>)}</span>
                <span className={s.cardFoot}><b>Berabere</b><em>{priceText('draw')}</em></span>
              </button>
            : <button key={id} type="button" className={s.fighter} data-side={id} aria-pressed={winnerPick === id} disabled={!open || !!winnerTicket} onClick={() => pickWinner(id)} aria-label={`${NAME[id]} kazanır seçimi`}>
                <i className={s.portrait} data-side={id} aria-hidden="true"/><span className={s.cardHead}><b>{NAME[id]}</b><small>{STYLE[id]}</small></span>
                <span className={s.traits}>{traits(id).map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</span>
                <span className={s.cardFoot}><b>{NAME[id]} kazanır</b><em>{priceText(id)}</em></span>
              </button>)}
        </div> : <div className={s.liveGrid}>
          {plans && plans.length > 0 && <section className={s.panel} aria-label="Köşe telsizi"><h2>Köşe telsizi <small>Jev · her 9 sn · hash zinciri</small></h2><CornerBoard plans={plans} minds={minds} tick={tick} pending={!replay || replay.frames.length * CONTACT_TICK_MS <= elapsed}/></section>}
          <section className={s.panel} aria-label="Maç özeti"><h2>Maç özeti</h2><ol className={s.summary}>{[1, 2, 3].map(n => {
            const r = done.find(x => x.round === n), isNow = bout?.round === n, side = r?.winner ?? (isNow && current ? current.winner : undefined);
            const text = r ? `${r.winner === 'draw' ? 'Berabere' : `${NAME[r.winner]} aldı`} · ${r.points.kor}–${r.points.ayaz}${r.knockdowns ? ` · ${r.knockdowns} yere düşme` : ''}`
              : isNow ? (current ? `${current.winner === 'draw' ? 'Berabere' : `${NAME[current.winner]} aldı`}${current.finish === 'stoppage' ? ' · durdurma' : ''}` : livePoints && stage === 'fighting' ? `Sürüyor · ${livePoints.kor}–${livePoints.ayaz}` : 'Başlıyor')
              : bout && ended && n > bout.round ? 'Oynanmadı' : 'Bekliyor';
            return <li key={n} data-side={side}><span>R{n}</span><b>{text}</b></li>;
          })}</ol></section>
        </div>}
      </main>

      <aside className={s.slip} data-open={sheet} aria-label="Maç kuponu">
        <button type="button" className={s.handle} aria-expanded={sheet} onClick={() => setSheet(v => !v)}><i/><span>{handleText}</span></button>
        <div className={s.slipHead}><h2>{open ? 'Maç kuponu' : 'Kuponun'}</h2><span data-open={open}>{open ? `Açık · ${clock(remaining)}` : final ? 'Sonuçlandı' : 'Kapalı'}</span></div>
        <div className={s.balance}><span>Demo bakiyen</span><b data-testid="ring-balance">{arena.balance === null ? '—' : demoNumber(arena.balance)}</b></div>

        {open && <form className={s.slipBody} onSubmit={e => { e.preventDefault(); submit(); }}>
          <div className={s.tabs} role="group" aria-label="Pazar">{MATCH_MARKETS.map(m => <button key={m.id} type="button" aria-pressed={marketId === m.id} onClick={() => setMarketId(m.id)}>{m.label}{mine.some(t => t.market === m.id) && <i aria-label="Biletin var">✓</i>}</button>)}</div>
          <p className={s.hint}>{HINT[marketId]}</p>
          <fieldset className={s.outcomes} disabled={!!placed}><legend className={s.sr}>{spec.label}</legend>{spec.outcomes.map((o, i) => {
            const share = pool?.total ? (pool.sides[o] ?? 0) / pool.total * 100 : 0, ret = projected(pool, o, probe, false);
            return <button type="button" key={o} data-side={sideOf(o)} aria-pressed={chosen === o} onClick={() => choose(o)}><i style={{ width: `${share}%` }}/><span><em/>{spec.labels[i]}<small>%{Math.round(share)}</small></span><b>{ret ? times(ret / probe) : '—'}</b></button>;
          })}</fieldset>
          <label className={s.amount} htmlFor="ring-amount"><span>Miktar <small>1–500 DEMO</small></span><span className={s.amountBox}><input id="ring-amount" inputMode="decimal" value={placed ? String(placed.amount / 100) : amount} onChange={e => setAmount(e.target.value)} disabled={!!placed} aria-invalid={parseDemoAmount(amount) === null}/>DEMO</span></label>
          <div className={s.chips}>{['10', '25', '50', '100', '500'].map(n => <button type="button" key={n} aria-pressed={amount === n} disabled={!!placed} onClick={() => setAmount(n)}>{n === '500' ? 'Max' : n}</button>)}</div>
          <dl className={s.summaryBox} key={flash}><div><dt>Seçimin</dt><dd data-side={sideOf(chosen)}>{outcomeLabel(marketId, chosen)} · {placed ? demoNumber(placed.amount) : stake ? demoNumber(stake) : '—'} DEMO</dd></div><div className={s.est}><dt>Tahmini dönüş</dt><dd>{estimate === null ? (pool?.total ? 'İade olur' : 'Rakip bilet bekleniyor') : `${demoNumber(estimate)} DEMO`}</dd></div></dl>
          <button className={s.cta} type="submit" data-side={sideOf(chosen)} disabled={!open || !!placed || arena.pending || parseDemoAmount(amount) === null}>{ctaText}</button>
          <p className={s.fine}>Tahmin havuz dolarken değişir, bahis kapanınca kesinleşir. %2 kesinti dahil. Rakip bilet yoksa iade.</p>
          <details className={s.rules}><summary>Kurallar</summary><p>Bahis yalnız R1 başlamadan, {Math.round(MATCH_OPEN_MS / 1000)} saniye açıktır; raunt aralarında kapalıdır. Her pazar kendi havuzundan öder ve maç bitince bir kez sonuçlanır. Tek taraflı ya da kazananı olmayan havuz kesintisiz iade edilir. Doğru seçimde bile dönüş yatırdığından az olabilir. Her pazarda maç başına tek bilet. Bağlantı kesilmesi bileti iptal etmez. Yumruk ve tekme sonucu aynı kurallarla belirler.</p></details>
        </form>}

        <div className={s.tickets} data-testid="ring-tickets">
          {mine.length ? mine.map(t => { const tr = track(t), r = t.status === 'accepted' ? projected(pools.find(p => p.market === t.market), t.outcome, t.amount, true) : null; return <div key={t.id} className={s.ticket} data-tone={tr.tone}><span className={s.ticketMarket}>{market(t.market as MatchMarket).label}</span><b data-side={sideOf(t.outcome)}>{outcomeLabel(t.market as MatchMarket, t.outcome)}</b><span className={s.ticketMeta}>{demoNumber(t.amount)} DEMO{t.status === 'accepted' ? r ? ` · kazanırsa ${demoNumber(r)}` : ' · şimdilik iade koşulu' : ''}</span><em>{tr.text}</em></div>; })
            : <p className={s.empty}>{open ? 'Henüz bilet yok. Bir seçim yap ve onayla.' : `Bu maça bilet almadın. Bahis her maçta R1 başlamadan ${Math.round(MATCH_OPEN_MS / 1000)} sn açık.`}</p>}
          {mine.length > 0 && !open && !final && <p className={s.fine}>“Önde / geride” yalnız bir göstergedir. Sonuç maç bitince kesinleşir.</p>}
        </div>
      </aside>
    </div>

    <div className={s.lower}>
      {stage === 'betting' && <ol className={s.steps}><li><b>1</b><span><strong>Seç</strong>Kazananı, biçimi ya da yere düşme sayısını seç. {Math.round(MATCH_OPEN_MS / 1000)} saniyen var.</span></li><li><b>2</b><span><strong>İzle</strong>Üç raunt boyunca kuponun canlı izlenir: önde mi, geride mi.</span></li><li><b>3</b><span><strong>Sonuç</strong>Maç bitince her havuz kazananlara dağıtılır. Tarayıcın maçı yeniden oynatıp doğrular.</span></li></ol>}
      <section className={s.panel} aria-label="Havuzlar ve son biletler">
        <h2>Havuzlar <small data-testid="ring-total">{arena.state ? `${arena.state.count} bilet · ${demoNumber(arena.state.total)} DEMO · ${arena.state.online} çevrim içi` : ''}</small><button type="button" disabled={!arena.connected} onClick={() => { setAuditOpen(true); arena.requestAudit(); }}>Tüm kayıtlar ↗</button></h2>
        <div className={s.pools}>{MATCH_MARKETS.map(m => { const p = pools.find(x => x.market === m.id); return <div key={m.id}><span>{m.label} <small>{p ? `${demoNumber(p.total)} DEMO · ${p.status === 'open' ? 'açık' : p.status === 'locked' ? 'kilitli' : p.status === 'paid' ? 'ödendi' : 'iade'}` : ''}</small></span><span className={s.split}>{m.outcomes.map(o => <i key={o} data-side={sideOf(o)} style={{ width: `${p?.total ? (p.sides[o] ?? 0) / p.total * 100 : 0}%` }}/>)}</span></div>; })}</div>
        <ul className={s.tape}>{tape.slice(0, 8).map(t => <li key={t.seq}><span>{t.alias.slice(-6)} · {market(t.market as MatchMarket).label}</span><b data-side={sideOf(t.outcome)}>{outcomeLabel(t.market as MatchMarket, t.outcome)} · {demoNumber(t.amount)}</b></li>)}{!tape.length && <li className={s.empty}>Henüz bilet yok. İlk bilet burada görünür.</li>}</ul>
      </section>
      <details className={s.technical}><summary>Kurallar, model ve doğrulama</summary><div>
        <p>Maç en fazla üç rauntur: 30 saniye bahis, her raunt 45 saniye, aralarda kısa mola. Kafaya üst üste temiz yumruk ya da tekme alan dövüşçü yere düşer; hakem sayar. Sağlığı biten ya da aynı rauntta üçüncü kez düşen dövüşçü durdurulur ve maç biter. Durdurma yoksa raunt, uygulanan hasar ve her yere düşürme için 120 puanla kazanılır; maçı daha çok raunt kazanan alır, eşitlik beraberliktir. Sağlık +250, kondisyon +350 sonraki raunta taşınır. Teknikler: jab, düz, kroşe, aparkat, gövde kroşesi; ön tekme (teep), alçak, gövde ve kafa tekmesi; diz ve klinç.</p>
        <p>Üç raundun seed’i maç başlamadan çekilir; hash’leri bahis açılmadan yayımlanır, her seed rauntu başlayınca açıklanır. Tarayıcın önceki rauntları da yayımlanan kayıttan yeniden oynatır ve maç sonucunu kontrol eder. Bu bir VRF veya operatörden bağımsız sonuç kanıtı değildir.</p>
        <p>Her dövüşçünün kendi bağımsız beyni var. Her hamleyi kendisi seçer ve yalnız herkesin gördüğü maç verisine bakar: raunt, süre, iki tarafın sağlığı ve kondisyonu, rakibin şimdiye kadar yaptıkları. Dövüşçü raunttan raunta, maç boyunca öğrendiğini saklar; kural ve başlangıç ağırlıkları maç başında dondurulur, aynı seed ve kayıt aynı maçı yeniden üretir. Bunun fayda sağlayıp sağlamadığı ayrıca test edilir ve ölçülen sonuç sayfada gösterilir. Ölçülen etki (önceden kaydedilmiş test, 200 maç): bütün maç boyunca öğrenen dövüşçü, öğrenmeyen kopyasından öğrenen rakiplere karşı ortalama +38 puan önde (%95 aralık −2…+74), sabit tarzlı rakiplere karşı +20 (−5…+45). Aralıklar sıfırı içerdiği için fayda kanıtlanmış sayılmaz. Eğitimin etkisi ise net (+284). Sinek bağlantı yapısının karıştırılmış ağa üstünlüğü gösterilemedi.</p>
        <p>Her 9 saniyede köşe antrenörü Jev (süre aşımında deterministik yedek) niyet, hedef ve tehdit önerir; dövüşçü bunu yalnız girdi olarak okur. Planlar bahis kapandıktan sonra geldiği için bu oyun yalnız DEMO içindir. Görüntü kodla çizilir (iskelet, IK, adım planlayıcı); kamera, FPS ve ses sonucu etkilemez. MaleCNS v1.0 verisi CC BY 4.0: FlyEM / HHMI Janelia.</p>
        <dl><dt>Motor</dt><dd>{round?.engine ?? '—'}</dd><dt>Defter</dt><dd>{match?.ledger ?? '—'}</dd><dt>Raunt taahhüdü</dt><dd>{round?.commitment ?? '—'}</dd><dt>Seed hash’leri</dt><dd>{match?.seedHashes.join(' · ') ?? '—'}</dd><dt>Seed</dt><dd>{round?.seed ?? 'Raunt başlayınca açıklanır.'}</dd></dl>
      </div></details>
    </div>

    {(arena.error || screenError) && <p className={s.error} role="alert">{arena.error || screenError}</p>}
    {auditOpen && <div className={s.audit} role="dialog" aria-modal="false" aria-label="Maç kayıtları"><div><h2>Maç #{ledger} kayıtları</h2><button type="button" onClick={() => setAuditOpen(false)} aria-label="Kaydı kapat">✕</button></div>{audit ? <><p>{audit.entries.length} bilet · {demoNumber(audit.entries.reduce((n, t) => n + t.amount, 0))} DEMO</p><a download={`ringside-match-${audit.roundId}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ unit: 'valueless DEMO', round, ...audit }, null, 2))}`}>JSON indir ↓</a></> : <p>Kayıt isteniyor. Maç değiştiyse yeniden aç.</p>}</div>}
  </div>;
}
