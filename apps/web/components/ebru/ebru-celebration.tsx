'use client';
/**
 * Ebru end-of-round and feature screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami for a
 * capped round), the free-spin intro ("Lale Ebrusu Başlıyor") and the free-spin total ("Lale Ebrusu — Toplam").
 * Original lockups: a gilded şemse cartouche with tulip finials and a lapis field, a marbled hatip rosette behind it
 * and tier colours from the ink palette (saffron, firuze, gül, lacivert, gold leaf). Presentation only.
 *
 * The screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that moves the
 * player forward also moves the counter, a hidden tab pauses both together, and the last frame always shows the engine
 * total exactly (`countUpValueAt` returns the total from `countUp` on). Counters write their own text nodes.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from 'react';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { ebruCents, ebruMoney, ebruTimes } from '@/lib/ebru-timeline';
import { EbruStainUse, EbruSymbolUse } from './symbols';
import c from './ebru-celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;
const f1 = (n: number) => Math.round(n * 10) / 10;

/** Hatip rosette: rings of ink teardrops (each a drop pulled to a point by the awl) around a centre. */
function Rosette({ petals = 12, className }: { petals?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const drop = (r0: number, r1: number, w: number) => `M100 ${100 - r0}C${f1(100 + w)} ${f1(100 - r0 - (r1 - r0) * 0.35)} ${f1(100 + w * 0.55)} ${f1(100 - r1 + 6)} 100 ${100 - r1}C${f1(100 - w * 0.55)} ${f1(100 - r1 + 6)} ${f1(100 - w)} ${f1(100 - r0 - (r1 - r0) * 0.35)} 100 ${100 - r0}Z`;
  const outer = drop(40, 98, 15), mid = drop(44, 86, 9), inner = drop(48, 74, 4.5);
  return (
    <svg className={`${c.rosette} ${className ?? ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`er${uid}p`} cx="100" cy="100" r="100" gradientUnits="userSpaceOnUse">
          <stop offset=".35" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.05 }} />
          <stop offset=".7" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      {Array.from({ length: petals }, (_, i) => (
        <g key={i} transform={`rotate(${f1((i / petals) * 360)} 100 100)`}>
          <path d={outer} fill={`url(#er${uid}p)`} />
          <path d={mid} fill="none" style={{ stroke: 'var(--c-hi)' }} strokeOpacity=".55" strokeWidth=".9" />
          <path d={inner} style={{ fill: 'var(--c-hi)' }} fillOpacity=".35" />
        </g>
      ))}
      <circle cx="100" cy="100" r="38" fill="none" style={{ stroke: 'var(--c-hi)' }} strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 5" />
    </svg>
  );
}

/** Gilded şemse cartouche: an almond medallion with scalloped rumi edge, tulip finials and a lapis field. */
function Cartouche() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `ec${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  // scalloped almond outline (local 520 × 190)
  const scallops = (rx: number, ry: number, n: number, depth: number) => {
    let d = '';
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = 260 + Math.cos(a) * rx, y = 95 + Math.sin(a) * ry;
      const am = ((i - 0.5) / n) * Math.PI * 2;
      const cx = 260 + Math.cos(am) * (rx + depth), cy = 95 + Math.sin(am) * (ry + depth * 0.55);
      d += i === 0 ? `M${f1(x)} ${f1(y)}` : `Q${f1(cx)} ${f1(cy)} ${f1(x)} ${f1(y)}`;
    }
    return `${d}Z`;
  };
  const tulip = 'M0 -30C6 -22 8 -14 8 -8C11 -12 15 -15 20 -16C21 -6 18 2 13 7C9 11 4 13 0 14C-4 13 -9 11 -13 7C-18 2 -21 -6 -20 -16C-15 -15 -11 -12 -8 -8C-8 -14 -6 -22 0 -30Z';
  return (
    <svg className={c.cartouche} viewBox="0 0 520 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('gold')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffbe2" /><stop offset=".28" stopColor="#ffd968" /><stop offset=".6" stopColor="#c27c14" /><stop offset=".82" stopColor="#f2c650" /><stop offset="1" stopColor="#5a3204" /></linearGradient>
        <radialGradient id={k('field')} cx=".5" cy=".42" r=".7"><stop offset="0" style={{ stopColor: 'var(--c-field-hi)' }} /><stop offset=".7" style={{ stopColor: 'var(--c-field)' }} /><stop offset="1" stopColor="#05041a" /></radialGradient>
        <radialGradient id={k('glow')} cx=".5" cy=".5" r=".6"><stop offset="0" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.45 }} /><stop offset="1" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0 }} /></radialGradient>
      </defs>
      <path d={scallops(232, 80, 28, 9)} fill={u('gold')} stroke="#3a1e02" strokeWidth="2.4" />
      <path d={scallops(218, 70, 28, 5)} fill={u('field')} stroke="#3a1e02" strokeWidth="2" />
      <ellipse cx="260" cy="95" rx="206" ry="62" fill={u('glow')} />
      <ellipse cx="260" cy="95" rx="200" ry="58" fill="none" stroke={u('gold')} strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
      <path d="M90 52Q260 18 430 52" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="3" strokeLinecap="round" />
      {[[22, 95, -90], [498, 95, 90]].map(([x, y, r]) => (
        <g key={x} transform={`translate(${x} ${y}) rotate(${r}) scale(1.05)`}>
          <path d={tulip} fill={u('gold')} stroke="#3a1e02" strokeWidth="2" strokeLinejoin="round" />
          <path d="M0 -22C2 -12 2 -2 0 8C-2 -2 -2 -12 0 -22Z" fill="#c42a34" />
        </g>
      ))}
    </svg>
  );
}

/** Layered display word: dark outline + drop (data-text), gradient fill. */
function DisplayWord({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`${c.word} ${className ?? ''}`} data-text={text} aria-hidden="true">
      <span className={c.wordFill}>{text}</span>
    </span>
  );
}
function Amount({ ref, text, testId }: { ref: Ref<HTMLSpanElement>; text: string; testId: string }) {
  return <span ref={ref} className={c.amount} data-text={text} data-testid={testId}><span className={c.amountFill}>{text}</span></span>;
}
function writeAmount(el: HTMLSpanElement | null, text: string) {
  if (!el) return;
  el.setAttribute('data-text', text);
  const fill = el.firstElementChild;
  if (fill) fill.textContent = text;
}

export interface EbruCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  onCountDone: () => void;
  /** Tap / click / Space: the first finishes the count-up, the next closes. */
  onTap: () => void;
}

export function EbruCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: EbruCelebrationProps) {
  const [level, setLevel] = useState<CelebrationLevel>(() => levelAt(schedule, Math.max(0, elapsed())));
  const [done, setDone] = useState(false);
  const [flash, setFlash] = useState(0);
  const amountRef = useRef<HTMLSpanElement>(null);
  const multRef = useRef<HTMLSpanElement>(null);
  const plaqueRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onLevel, onCountDone });
  callbacks.current = { onLevel, onCountDone };

  useEffect(() => {
    let frame = 0, shownLevel: CelebrationLevel | 0 = 0, finished = false, lastText = '';
    const total = schedule.countUp + schedule.hold;
    const step = () => {
      const e = Math.max(0, elapsed());
      const value = countUpValueAt(schedule, e);
      const text = ebruMoney(ebruCents(betCents, value));
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = `${ebruTimes(value)}× bahis`;
      }
      const now = levelAt(schedule, e);
      if (now !== shownLevel) {
        const first = shownLevel === 0;
        shownLevel = now;
        setLevel(now);
        if (!first) setFlash(f => f + 1);
        if (!first && !reducedMotion) plaqueRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.22 }, { transform: 'scale(.97)', offset: 0.55 }, { transform: 'scale(1)' }],
          { duration: 620, easing: 'cubic-bezier(.2,.9,.3,1)' },
        );
        callbacks.current.onLevel(now, first, Number.isFinite(e) ? Math.max(0, total - e) : 0);
      }
      if (!finished && e >= schedule.countUp) {
        finished = true;
        setDone(true);
        if (!reducedMotion) plaqueRef.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
        callbacks.current.onCountDone();
      }
      if (!finished) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [schedule, betCents, elapsed, reducedMotion]);

  const info = WIN_TIER_INFO[level];
  const initial = countUpValueAt(schedule, Math.max(0, elapsed()));
  const style = { '--spin': `${[0, 40, 32, 26, 20, 14][level]}s` } as CSSProperties;
  return (
    <>
      <div className={c.back} data-level={level} data-reduced={reducedMotion || undefined} style={style} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <Rosette className={c.rosetteBack} />
        {level >= 3 && <Rosette petals={8} className={c.rosetteCounter} />}
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div className={c.front} data-level={level} data-done={done || undefined} data-reduced={reducedMotion || undefined}
        data-testid="ebru-celebration" role="dialog" aria-modal="false"
        aria-label={`${info.title}: ${ebruMoney(ebruCents(betCents, schedule.totalHundredths))} DEMO`} onClick={onTap}>
        <div className={c.column}>
          <ol className={c.pips} aria-hidden="true">
            {PIPS.map(pip => <li key={pip.level} data-on={level >= pip.level || undefined}><span>{pip.x}</span></li>)}
          </ol>
          <div key={level} className={c.lockup} data-shake>
            <Cartouche />
            <DisplayWord text={info.word} className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">KAZANÇ</span>
          </div>
          <div ref={plaqueRef} className={c.plaque}>
            <Amount ref={amountRef} text={ebruMoney(ebruCents(betCents, initial))} testId="ebru-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{ebruTimes(initial)}× bahis</span>
          {level === 5 && <p className={c.capNote}>Tur tavana ulaştı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? 'Devam' : 'Hızlandırmak için dokun'}
          </button>
        </div>
      </div>
    </>
  );
}

export function EbruFreeIntro({ awarded, dur, reducedMotion, onTap }: { awarded: number; dur: number; reducedMotion: boolean; onTap: () => void }) {
  return (
    <>
      <div className={c.back} data-level="intro" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <Rosette className={c.rosetteBack} />
      </div>
      <div className={c.front} data-level="intro" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="eb-intro-title" data-testid="ebru-intro" onClick={onTap}>
        <div className={`${c.column} ${c.introColumn}`}>
          <div className={c.seals} aria-hidden="true">
            {[0, 1, 2].map(i => <span key={i} className={c.seal} style={{ '--i': i } as CSSProperties}><EbruSymbolUse symbol="comb" /></span>)}
          </div>
          <h2 id="eb-intro-title" className={c.introTitle}><DisplayWord text="LALE EBRUSU" className={c.introWord} /><span className="sr-only">Lale Ebrusu Başlıyor</span></h2>
          <div className={c.introCount}>
            <strong>{awarded}</strong>
            <span>bedava<br />dönüş</span>
          </div>
          <div className={c.introStains} aria-hidden="true">
            {[2, 4, 8, 16, 32].map((v, i) => <span key={v} style={{ '--i': i } as CSSProperties}><EbruStainUse value={v} /></span>)}
          </div>
          <p className={c.introText}>Patlayan her hücreye <strong>boya lekesi</strong> düşer: önce ×2, aynı hücrede her seferinde iki katı, ×256’ya kadar. Lekeler özellik boyunca kalır ve <strong>tarakla birlikte kayar</strong>; üstünden geçen kümenin ödemesi lekelerin toplamıyla çarpılır. 3 Altın Tarak +4 dönüş.</p>
          <button type="button" className={c.go} onClick={event => { event.stopPropagation(); onTap(); }}>Başla</button>
          <span className={c.timer} style={{ '--hold': `${dur}ms` } as CSSProperties} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

export interface EbruFeatureTotalProps {
  spins: number; totalHundredths: number; maxStain: number; stainedClusters: number; combWins: number; betCents: number;
  celebration: boolean; capped: boolean; dur: number; elapsed: () => number; reducedMotion: boolean; onTap: () => void;
}
/** "Lale Ebrusu — Toplam": always ends a free-spin round, whatever the total. */
export function EbruFeatureTotal({ spins, totalHundredths, maxStain, stainedClusters, combWins, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: EbruFeatureTotalProps) {
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1500, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, ebruMoney(ebruCents(betCents, value)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [elapsed, countMs, totalHundredths, betCents, reducedMotion]);
  return (
    <>
      <div className={c.back} data-level="feature" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <Rosette petals={10} className={c.rosetteBack} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="eb-ft-title" data-testid="ebru-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="eb-ft-title" className={c.ftTitle}>Lale Ebrusu <span aria-hidden="true">—</span> Toplam</h2>
          <div className={c.lockup}>
            <Cartouche />
            <DisplayWord text="TOPLAM" className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">BEDAVA DÖNÜŞ</span>
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={ebruMoney(0)} testId="ebru-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>Dönüş</dt><dd>{spins} dönüş</dd></div>
            <div><dt>En büyük leke</dt><dd>{maxStain > 0 ? `×${maxStain}` : 'Yok'}<small>{stainedClusters > 0 ? `${stainedClusters} lekeli küme` : 'lekeli küme yok'}</small></dd></div>
            <div><dt>Bahsin</dt><dd>{ebruTimes(totalHundredths)}×<small>{combWins > 0 ? `${combWins} tarak kazancı` : 'tarak kazancı yok'}</small></dd></div>
          </dl>
          {capped && <p className={c.capNote}>Azami kazanca ulaşıldı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? 'Kutlamaya geç' : 'Devam'}</button>
        </div>
      </div>
    </>
  );
}
