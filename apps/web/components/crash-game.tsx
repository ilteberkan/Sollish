'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { crashAt, demoNumber, grossPayout, multiplierLabel, parseDemoAmount, randomUnit, sampleCrash } from '@/lib/demo';
import { useProduct } from './providers';
import { AmountControl, DemoBalance, DemoNotice, GameHeading, GameHistory, Rules, type Mode } from './game-common';
import { Icon, BrandMark } from './icons';
type Round = { id: string; stake: number; startAt: number; point: number };
type Phase = 'ready' | 'countdown' | 'running' | 'won' | 'lost';
export function CrashGame() {
  const { reserveDemo, settleDemo, setActiveDemo } = useProduct();
  const [mode, setMode] = useState<Mode>('demo');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('ready');
  const [multiplier, setMultiplier] = useState(1);
  const [countdown, setCountdown] = useState(3);
  const [payout, setPayout] = useState(0);
  const [stake, setStake] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const round = useRef<Round | null>(null);
  const frame = useRef(0);
  const active = phase === 'running' || phase === 'countdown';
  const finish = useCallback((current: Round, cashout: boolean, value: number) => {
    if (round.current?.id !== current.id) return;
    round.current = null;
    cancelAnimationFrame(frame.current);
    const gross = cashout ? grossPayout(current.stake, value) : 0;
    setMultiplier(value); setPayout(gross); setPhase(cashout ? 'won' : 'lost'); setActiveDemo(false);
    settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: gross, detail: cashout ? `${multiplierLabel(value)} çıkış` : `${multiplierLabel(value)} tur sonu`, at: Date.now() });
  }, [setActiveDemo, settleDemo]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    const current = round.current;
    if (current) {
      const now = performance.now();
      const expired = now >= current.startAt && crashAt(now - current.startAt, current.point).crashed;
      round.current = null;
      settleDemo({ id: current.id, game: 'Crash', stake: current.stake, payout: expired ? 0 : current.stake, detail: expired ? `${multiplierLabel(current.point)} tur sonu` : 'Demo iptal edildi', at: Date.now() });
      setActiveDemo(false);
    }
  }, [settleDemo, setActiveDemo]);
  function start() {
    if (round.current || mode !== 'demo') return;
    const parsed = parseDemoAmount(amount);
    if (parsed === null) { setError('1–500 DEMO arasında, en çok iki ondalıklı miktar gir.'); return; }
    let point: number;
    try { point = sampleCrash(randomUnit()); }
    catch { setError('Güvenli yerel rastgelelik kullanılamıyor. Demo başlatılmadı.'); return; }
    let id: string | null;
    try { id = reserveDemo(parsed); }
    catch { setError('Güvenli yerel rastgelelik kullanılamıyor. Demo başlatılmadı.'); return; }
    if (!id) { setError('Yeterli demo kredin yok veya devam eden bir demo var.'); return; }
    setError(''); setPhase('countdown'); setActiveDemo(true); setStake(parsed); setPayout(0); setMultiplier(1); setElapsed(0); setCountdown(3);
    const current = { id, stake: parsed, startAt: performance.now() + 2400, point };
    round.current = current;
    let lastPaint = 0;
    const tick = (now: number) => {
      if (round.current?.id !== id) return;
      const time = now - current.startAt;
      if (time < 0) { setCountdown(Math.ceil(-time / 800)); }
      else {
        const value = crashAt(time, current.point);
        if (value.crashed) { finish(current, false, current.point); return; }
        if (now - lastPaint > 40) { setPhase('running'); setMultiplier(value.multiplier); setElapsed(time); lastPaint = now; }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function cashout() {
    const current = round.current;
    if (!current || performance.now() < current.startAt) return;
    const value = crashAt(performance.now() - current.startAt, current.point);
    finish(current, !value.crashed, value.multiplier);
  }
  const caption = phase === 'ready' ? 'Karar anı senin.' : phase === 'countdown' ? 'Birazdan başlıyor' : phase === 'running' ? 'Çıkış zamanını sen seç' : phase === 'won' ? 'Demodan çıkış yaptın' : 'Tur sona erdi';
  const live = mode === 'live';
  return <div className="game-page"><GameHeading title="Crash" subtitle="Yükselişi izle. Kendi anında çık." mode={mode} setMode={setMode} active={active}/>
    <section className={`game-table crash-table phase-${phase}`} aria-label="Crash oyun masası">
      <div className="table-topline"><span className="table-status"><span className={`status-dot ${phase === 'running' ? 'running' : ''}`}/>{live ? 'Canlı erişim kapalı' : active ? 'Yerel tur sürüyor' : 'Masa hazır'}</span>{!live && <DemoBalance/>}</div>
      <div className="crash-stage">
        <CrashChart multiplier={multiplier} elapsed={elapsed} phase={live ? 'ready' : phase}/>
        {live ? <div className="stage-readout gated-readout"><span className="stage-lock"><Icon name="lock" size={27}/></span><h2>Canlı Crash henüz açık değil.</h2><p>Manuel çıkış ve gizli tur sonucu doğrulanmadan gerçek bahis kabul edilmez.</p><button className="text-button" onClick={() => setMode('demo')}>Yerel demoyu dene<Icon name="arrow" size={17}/></button></div> : <div className="stage-readout"><span className="stage-caption">{caption}</span>{phase === 'countdown' ? <strong className="crash-value countdown">{countdown}</strong> : <strong className={`crash-value ${phase === 'lost' ? 'lost-value' : ''}`}>{multiplierLabel(multiplier)}</strong>}<span className="stage-subtext">{phase === 'ready' ? 'Miktarını seç, ilk turunu başlat.' : phase === 'running' ? `${(elapsed / 1000).toFixed(1).replace('.', ',')} sn` : phase === 'won' ? `${demoNumber(payout)} DEMO brüt dönüş` : phase === 'lost' ? `${demoNumber(stake)} DEMO kayıp` : 'Manuel çıkışa hazır ol'}</span></div>}
        <div className="stage-bottom"><span><BrandMark/>Yerel simülasyon</span><span>Manuel çıkış<Icon name="exit" size={14}/></span></div>
      </div>
      <div className="bet-controls"><AmountControl amount={amount} setAmount={setAmount} disabled={active || live} error={error}/><div className="payout-preview"><span>{phase === 'won' ? 'Brüt demo dönüşü' : 'Çıkışta brüt dönüş'}</span><strong>{phase === 'won' ? demoNumber(payout) : phase === 'running' ? demoNumber(grossPayout(stake, multiplier)) : '—'}<small> DEMO</small></strong><span className="small muted">{phase === 'won' ? `Net sonuç: +${demoNumber(payout - stake)} DEMO` : 'Demo işlem ücreti: 0'}</span></div><div className={`action-slot ${active ? 'mobile-sticky-action' : ''}`}><button className={`button primary game-action ${phase === 'running' ? 'cashout-button' : ''}`} disabled={live || phase === 'countdown'} onClick={phase === 'running' ? cashout : start}>{phase === 'running' ? <><span>Çıkış yap</span><strong>{demoNumber(grossPayout(stake, multiplier))} <small>DEMO</small></strong></> : phase === 'countdown' ? 'Tur başlıyor…' : live ? <><Icon name="lock" size={16}/>Canlı bahis kapalı</> : <><span>Demoyu başlat</span><Icon name="arrow"/></>}</button><p>{phase === 'running' ? 'Çıkış, tıkladığın anda hesaplanır.' : live ? 'Canlı Crash doğrulaması bekleniyor.' : 'Cüzdan veya gerçek para gerekmez.'}</p></div></div>
      <div className="sr-only" role="status" aria-live="polite">{phase === 'running' ? 'Tur başladı. Çıkış yapabilirsiniz.' : phase === 'won' ? `Demo çıkışı tamamlandı. ${demoNumber(payout)} DEMO brüt dönüş.` : phase === 'lost' ? `Tur ${multiplierLabel(multiplier)} çarpanında sona erdi. Demo miktarı kaybedildi.` : phase === 'countdown' ? 'Tur başlamak üzere.' : ''}</div>
    </section><DemoNotice/><GameHistory game="Crash"/><Rules game="Crash"/>
  </div>;
}
function CrashChart({ multiplier, elapsed, phase }: { multiplier: number; elapsed: number; phase: Phase }) {
  const points = Array.from({ length: 35 }, (_, i) => { const t = i / 34; return `${50 + t * Math.min(760, 120 + elapsed / 45)},${306 - (Math.pow(multiplier, t) - 1) / Math.max(4, multiplier - 1) * 240}`; }).join(' ');
  const visible = phase !== 'ready' && phase !== 'countdown';
  return <svg className="crash-chart" viewBox="0 0 880 350" preserveAspectRatio="none" aria-hidden="true"><g className="chart-grid"><path d="M50 65H838M50 145H838M50 225H838M50 305H838"/><path d="M50 42V305M247 42V305M444 42V305M641 42V305M838 42V305"/></g><path className="chart-baseline" d="M50 305H838"/>{visible && <><polyline points={points} className={`chart-trail ${phase === 'lost' ? 'trail-lost' : ''}`}/><circle cx={50 + Math.min(760, 120 + elapsed / 45)} cy={306 - (multiplier - 1) / Math.max(4, multiplier - 1) * 240} r="5" className={phase === 'lost' ? 'chart-dot lost-dot' : 'chart-dot'}/></>}<g className="chart-axis-labels"><text x="50" y="330">0 s</text><text x="838" y="330" textAnchor="end">süre</text><text x="30" y="310" textAnchor="end">1×</text></g></svg>;
}
