'use client';
/**
 * Tarhun end-of-round and feature screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami
 * for a capped round), the free-spin intro ("Fırtına Başlıyor") and the free-spin total ("Fırtına Dindi —
 * Toplam"). Original lockups: a carved storm-stone tablet with bronze horn ends, a crown of lightning bolts and
 * tier colours of the Tarhun palette. Presentation only.
 *
 * The screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that
 * moves the player forward also moves the counter, a hidden tab pauses both together, and the last frame always
 * shows the engine total exactly (`countUpValueAt` returns the total from `countUp` on). Counters write their own
 * text nodes; React only re-renders on a level change.
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { stormCents, stormMoney, stormTimes } from '@/lib/storm-timeline';
import { StormSymbolUse } from './symbols';
import c from './storm-celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;

/** Crown of jagged lightning bolts radiating from the centre (rotated slowly by CSS). */
function BoltCrown({ count = 14, className }: { count?: number; className?: string }) {
  const bolts: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 360;
    bolts.push(`rotate(${a.toFixed(1)} 100 100)`);
  }
  return (
    <svg className={`${c.crown} ${className ?? ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tzCrownBolt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0 }} />
          <stop offset=".55" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0.85 }} />
          <stop offset="1" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      {bolts.map((t, i) => (
        <path key={i} transform={t} d={i % 2 ? 'M100 8 94 34h6l-5 22 10-27h-6l5-21Z' : 'M100 2 92 30h7l-7 30 14-36h-7l6-22Z'} fill="url(#tzCrownBolt)" />
      ))}
    </svg>
  );
}

/** Carved storm-stone tablet with bronze rim and bull-horn ends (the tier word sits on top). */
function Tablet() {
  return (
    <svg className={c.tablet} viewBox="0 0 520 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="tzTabStone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d5a62" /><stop offset=".5" stopColor="#3a3842" /><stop offset="1" stopColor="#1c1b22" />
        </linearGradient>
        <linearGradient id="tzTabBronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0c0" /><stop offset=".25" stopColor="#e2a650" /><stop offset=".55" stopColor="#8a5419" /><stop offset=".8" stopColor="#e6b05e" /><stop offset="1" stopColor="#5a3008" />
        </linearGradient>
        <radialGradient id="tzTabGlow" cx=".5" cy=".5" r=".6">
          <stop offset="0" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.55 }} /><stop offset="1" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <path d="M40 34 Q14 10 2 22 Q20 34 26 60 L26 150 Q20 170 2 178 Q22 186 44 164 H476 Q498 186 518 178 Q500 170 494 150 V60 Q500 34 518 22 Q506 10 480 34 Z" fill="url(#tzTabBronze)" />
      <path d="M48 42 H472 Q486 42 486 56 V146 Q486 158 472 158 H48 Q34 158 34 146 V56 Q34 42 48 42 Z" fill="url(#tzTabStone)" stroke="#170f06" strokeWidth="3" />
      <path d="M48 42 H472 Q486 42 486 56 V146 Q486 158 472 158 H48 Q34 158 34 146 V56 Q34 42 48 42 Z" fill="url(#tzTabGlow)" />
      <path d="M56 52 H464" stroke="#fff3d0" strokeOpacity=".22" strokeWidth="2" />
      <path d="M60 148 L100 140 L140 150 L190 141 L240 149 L300 140 L350 150 L410 141 L460 148" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="2" />
      {[70, 450].map(x => <g key={x}><circle cx={x} cy="100" r="9" fill="url(#tzTabBronze)" stroke="#170f06" strokeWidth="2" /><path d={`M${x + 2} 93 l-5 8 h4 l-3 7 7-9 h-4 l3-6z`} fill="#170f06" /></g>)}
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

export interface StormCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  onCountDone: () => void;
  /** Tap / click / Space: the first finishes the count-up, the next closes. */
  onTap: () => void;
}

export function StormCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: StormCelebrationProps) {
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
      const text = stormMoney(stormCents(betCents, value));
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = `${stormTimes(value)}× bahis`;
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
        {level >= 3 && <BoltCrown count={10} className={c.crownCounter} />}
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div className={c.front} data-level={level} data-done={done || undefined} data-reduced={reducedMotion || undefined}
        data-testid="tarhun-celebration" role="dialog" aria-modal="false"
        aria-label={`${info.title}: ${stormMoney(stormCents(betCents, schedule.totalHundredths))} DEMO`} onClick={onTap}>
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
            <Amount ref={amountRef} text={stormMoney(stormCents(betCents, initial))} testId="tarhun-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{stormTimes(initial)}× bahis</span>
          {level === 5 && <p className={c.capNote}>Tur tavana ulaştı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? 'Devam' : 'Hızlandırmak için dokun'}
          </button>
        </div>
      </div>
    </>
  );
}

export function StormFreeIntro({ awarded, dur, reducedMotion, onTap }: { awarded: number; dur: number; reducedMotion: boolean; onTap: () => void }) {
  return (
    <>
      <div className={c.back} data-level="intro" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <BoltCrown className={c.crownBack} />
      </div>
      <div className={c.front} data-level="intro" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="tz-intro-title" data-testid="tarhun-intro" onClick={onTap}>
        <div className={`${c.column} ${c.introColumn}`}>
          <div className={c.seals} aria-hidden="true">
            {[0, 1, 2, 3].map(i => <span key={i} className={c.seal} style={{ '--i': i } as CSSProperties}><StormSymbolUse symbol="scatter" /></span>)}
          </div>
          <h2 id="tz-intro-title" className={c.introTitle}><DisplayWord text="FIRTINA BAŞLIYOR" className={c.introWord} /><span className="sr-only">Fırtına Başlıyor</span></h2>
          <div className={c.introCount}>
            <strong>{awarded}</strong>
            <span>bedava<br />dönüş</span>
          </div>
          <p className={c.introText}>Kazanan her dönüşte Fırtına Taşları <strong>toplam çarpana</strong> eklenir; toplam çarpan bedava dönüşler boyunca korunur. 3 Şimşek Mührü +5 dönüş verir.</p>
          <button type="button" className={c.go} onClick={event => { event.stopPropagation(); onTap(); }}>Başla</button>
          <span className={c.timer} style={{ '--hold': `${dur}ms` } as CSSProperties} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

export interface StormFeatureTotalProps {
  spins: number; totalHundredths: number; totalMultiplier: number; strikes: number; betCents: number;
  celebration: boolean; capped: boolean; dur: number; elapsed: () => number; reducedMotion: boolean; onTap: () => void;
}
/** "Fırtına Dindi — Toplam": always ends a free-spin round, whatever the total. */
export function StormFeatureTotal({ spins, totalHundredths, totalMultiplier, strikes, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: StormFeatureTotalProps) {
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1500, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, stormMoney(stormCents(betCents, value)));
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
        <BoltCrown count={10} className={c.crownBack} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="tz-ft-title" data-testid="tarhun-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="tz-ft-title" className={c.ftTitle}>Fırtına Dindi <span aria-hidden="true">—</span> Toplam</h2>
          <div className={c.lockup}>
            <Tablet />
            <DisplayWord text="TOPLAM" className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">BEDAVA DÖNÜŞ</span>
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={stormMoney(0)} testId="tarhun-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>Dönüş</dt><dd>{spins} dönüş</dd></div>
            <div><dt>Toplam çarpan</dt><dd>{totalMultiplier > 0 ? `×${totalMultiplier}` : 'Yok'}<small>{strikes > 0 ? `${strikes} yıldırım` : 'küre yok'}</small></dd></div>
            <div><dt>Bahsin</dt><dd>{stormTimes(totalHundredths)}×</dd></div>
          </dl>
          {capped && <p className={c.capNote}>Azami kazanca ulaşıldı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? 'Kutlamaya geç' : 'Devam'}</button>
        </div>
      </div>
    </>
  );
}
