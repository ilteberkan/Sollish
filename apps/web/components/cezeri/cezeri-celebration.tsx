'use client';
/**
 * Cezeri end-of-round and feature screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami for a
 * capped round), the free-spin intro ("Fil Saati Başlıyor") and the free-spin total ("Fil Saati — Toplam"). Original
 * lockups: a brass clock cartouche with turquoise enamel and gear ends, a turning crown of gear teeth and the tier
 * colours of the Cezeri palette (brass, turquoise, lapis, vermilion). Presentation only.
 *
 * The screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that moves the
 * player forward also moves the counter, a hidden tab pauses both together, and the last frame always shows the engine
 * total exactly (`countUpValueAt` returns the total from `countUp` on). Counters write their own text nodes.
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { cezeriCents, cezeriMoney, cezeriTimes } from '@/lib/cezeri-timeline';
import { CezeriSymbolUse } from './symbols';
import c from './cezeri-celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;

/** Crown of gear teeth and spokes radiating from the centre (rotated slowly by CSS). */
function BoltCrown({ count = 36, className }: { count?: number; className?: string }) {
  const teeth: string[] = [];
  for (let i = 0; i < count; i++) teeth.push(`rotate(${((i / count) * 360).toFixed(1)} 100 100)`);
  return (
    <svg className={`${c.crown} ${className ?? ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="czCrownTooth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0 }} />
          <stop offset=".55" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0.85 }} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="62" fill="none" stroke="var(--c-mid)" strokeOpacity=".35" strokeWidth="2" strokeDasharray="1.5 6" />
      <circle cx="100" cy="100" r="70" fill="none" stroke="var(--c-hi)" strokeOpacity=".18" strokeWidth="1" />
      {teeth.map((t, i) => (
        <path key={i} transform={t} d={i % 2 ? 'M99.7 0h0.6l1.1 44h-2.8Z' : 'M99.8 14h0.4l0.7 26h-1.8Z'} fill="url(#czCrownTooth)" />
      ))}
    </svg>
  );
}

/** Brass clock cartouche with turquoise enamel, a beaded bezel and gear ends (the tier word sits on top). */
function Tablet() {
  const gear = (cx: number) => {
    let d = '';
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, r = i % 4 < 2 ? 34 : 27; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(95 + Math.sin(a) * r).toFixed(1)}`; }
    return `${d}Z`;
  };
  return (
    <svg className={c.tablet} viewBox="0 0 520 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="czTabEnamel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f8f92" /><stop offset=".5" stopColor="#0c4f56" /><stop offset="1" stopColor="#042428" />
        </linearGradient>
        <linearGradient id="czTabBrass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c8" /><stop offset=".25" stopColor="#e8b84e" /><stop offset=".55" stopColor="#8f5a17" /><stop offset=".8" stopColor="#f0c862" /><stop offset="1" stopColor="#5a3408" />
        </linearGradient>
        <radialGradient id="czTabGlow" cx=".5" cy=".5" r=".6">
          <stop offset="0" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.5 }} /><stop offset="1" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <path d={gear(46)} fill="url(#czTabBrass)" stroke="#1a0d05" strokeWidth="2.4" />
      <path d={gear(474)} fill="url(#czTabBrass)" stroke="#1a0d05" strokeWidth="2.4" />
      <circle cx="46" cy="95" r="12" fill="#c8302c" stroke="#1a0d05" strokeWidth="2.4" />
      <circle cx="474" cy="95" r="12" fill="#c8302c" stroke="#1a0d05" strokeWidth="2.4" />
      <path d="M70 26 H450 Q478 26 478 54 V136 Q478 164 450 164 H70 Q42 164 42 136 V54 Q42 26 70 26 Z" fill="url(#czTabBrass)" stroke="#1a0d05" strokeWidth="3" />
      <path d="M80 40 H440 Q464 40 464 62 V128 Q464 150 440 150 H80 Q56 150 56 128 V62 Q56 40 80 40 Z" fill="url(#czTabEnamel)" stroke="#1a0d05" strokeWidth="3" />
      <path d="M80 40 H440 Q464 40 464 62 V128 Q464 150 440 150 H80 Q56 150 56 128 V62 Q56 40 80 40 Z" fill="url(#czTabGlow)" />
      <path d="M70 33 H450" stroke="#fff6d8" strokeOpacity=".55" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      <path d="M70 157 H450" stroke="#1a0d05" strokeOpacity=".5" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
      <path d="M86 50 H434" stroke="#bffff6" strokeOpacity=".25" strokeWidth="2" />
    </svg>
  );
}

/** Layered display word: dark outline + extrusion (data-text), gradient fill, sheen. */
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

export interface CezeriCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  onCountDone: () => void;
  /** Tap / click / Space: the first finishes the count-up, the next closes. */
  onTap: () => void;
}

export function CezeriCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: CezeriCelebrationProps) {
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
      const text = cezeriMoney(cezeriCents(betCents, value));
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = `${cezeriTimes(value)}× bahis`;
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
  const style = { '--spin': `${[0, 26, 20, 15, 11, 8][level]}s` } as CSSProperties;
  return (
    <>
      <div className={c.back} data-level={level} data-reduced={reducedMotion || undefined} style={style} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <BoltCrown className={c.crownBack} />
        {level >= 3 && <BoltCrown count={16} className={c.crownCounter} />}
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div className={c.front} data-level={level} data-done={done || undefined} data-reduced={reducedMotion || undefined}
        data-testid="cezeri-celebration" role="dialog" aria-modal="false"
        aria-label={`${info.title}: ${cezeriMoney(cezeriCents(betCents, schedule.totalHundredths))} DEMO`} onClick={onTap}>
        <div className={c.column}>
          <ol className={c.pips} aria-hidden="true">
            {PIPS.map(pip => <li key={pip.level} data-on={level >= pip.level || undefined}><span>{pip.x}</span></li>)}
          </ol>
          <div key={level} className={c.lockup} data-shake>
            <Tablet />
            <DisplayWord text={info.word} className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">KAZANÇ</span>
          </div>
          <div ref={plaqueRef} className={c.plaque}>
            <Amount ref={amountRef} text={cezeriMoney(cezeriCents(betCents, initial))} testId="cezeri-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{cezeriTimes(initial)}× bahis</span>
          {level === 5 && <p className={c.capNote}>Tur tavana ulaştı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? 'Devam' : 'Hızlandırmak için dokun'}
          </button>
        </div>
      </div>
    </>
  );
}

export function CezeriFreeIntro({ awarded, dur, reducedMotion, onTap }: { awarded: number; dur: number; reducedMotion: boolean; onTap: () => void }) {
  return (
    <>
      <div className={c.back} data-level="intro" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <BoltCrown className={c.crownBack} />
      </div>
      <div className={c.front} data-level="intro" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="cz-intro-title" data-testid="cezeri-intro" onClick={onTap}>
        <div className={`${c.column} ${c.introColumn}`}>
          <div className={c.seals} aria-hidden="true">
            {[0, 1, 2].map(i => <span key={i} className={c.seal} style={{ '--i': i } as CSSProperties}><CezeriSymbolUse symbol="vessel" /></span>)}
          </div>
          <h2 id="cz-intro-title" className={c.introTitle}><DisplayWord text="FİL SAATİ" className={c.introWord} /><span className="sr-only">Fil Saati Başlıyor</span></h2>
          <div className={c.introCount}>
            <strong>{awarded}</strong>
            <span>bedava<br />dönüş</span>
          </div>
          <p className={c.introText}>Göbek çarpanı <strong>sıfırlanmaz</strong>, dönüşten dönüşe yalnız artar. Su haznesi her 3 dönüşte dolar ve otomat şahin kalıcı <strong>Altın Dişli</strong> jokerleri bırakır. 2 Su Kabı +4 dönüş verir.</p>
          <button type="button" className={c.go} onClick={event => { event.stopPropagation(); onTap(); }}>Başla</button>
          <span className={c.timer} style={{ '--hold': `${dur}ms` } as CSSProperties} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

export interface CezeriFeatureTotalProps {
  spins: number; totalHundredths: number; topHub: number; falconVisits: number; wilds: number; betCents: number;
  celebration: boolean; capped: boolean; dur: number; elapsed: () => number; reducedMotion: boolean; onTap: () => void;
}
/** "Fil Saati — Toplam": always ends a free-spin round, whatever the total. */
export function CezeriFeatureTotal({ spins, totalHundredths, topHub, falconVisits, wilds, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: CezeriFeatureTotalProps) {
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1500, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, cezeriMoney(cezeriCents(betCents, value)));
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
        <BoltCrown count={16} className={c.crownBack} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="cz-ft-title" data-testid="cezeri-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="cz-ft-title" className={c.ftTitle}>Fil Saati <span aria-hidden="true">—</span> Toplam</h2>
          <div className={c.lockup}>
            <Tablet />
            <DisplayWord text="TOPLAM" className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">BEDAVA DÖNÜŞ</span>
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={cezeriMoney(0)} testId="cezeri-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>Dönüş</dt><dd>{spins} dönüş</dd></div>
            <div><dt>En yüksek göbek</dt><dd>×{topHub}</dd></div>
            <div><dt>Şahin</dt><dd>{falconVisits > 0 ? `${falconVisits} ziyaret` : 'Gelmedi'}<small>{wilds > 0 ? `${wilds} Altın Dişli` : 'joker yok'}</small></dd></div>
            <div><dt>Bahsin</dt><dd>{cezeriTimes(totalHundredths)}×</dd></div>
          </dl>
          {capped && <p className={c.capNote}>Azami kazanca ulaşıldı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? 'Kutlamaya geç' : 'Devam'}</button>
        </div>
      </div>
    </>
  );
}
