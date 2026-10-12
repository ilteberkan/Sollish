'use client';
/**
 * Candy Cascade end-of-round screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami for a
 * capped round) and the free-spin total screen. Original lockups, palettes and motion; presentation only.
 *
 * Both screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that
 * moves the player forward also moves the counter, a hidden tab pauses both together, and the last frame always
 * shows the engine total exactly (`countUpValueAt` returns the total from `countUp` on). The counter writes its
 * own text nodes; React only re-renders on a level change.
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { centsFor, moneyText, multiplierText } from '@/lib/cascade-timeline';
import c from './celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;

/** Original 20-point candy starburst drawn behind the lockup (rotated by CSS). */
function Starburst() {
  const points: string[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r = i % 2 === 0 ? 50 : 34;
    points.push(`${(50 + Math.cos(a) * r).toFixed(2)},${(50 + Math.sin(a) * r).toFixed(2)}`);
  }
  return (
    <svg className={c.burst} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ccBurstFill" cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: 'var(--c-hi)', stopOpacity: 0.95 }} />
          <stop offset=".45" style={{ stopColor: 'var(--c-mid)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--c-lo)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <polygon points={points.join(' ')} fill="url(#ccBurstFill)" />
    </svg>
  );
}

/** Original candy crown for the two top levels (Efsane, Azami). */
function Crown() {
  return (
    <svg className={c.crown} viewBox="0 0 120 70" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ccCrownGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6d6" /><stop offset=".45" stopColor="#ffd36b" /><stop offset=".55" stopColor="#e89a26" /><stop offset="1" stopColor="#a8590c" />
        </linearGradient>
      </defs>
      <path d="M10 58 4 18l26 20L60 6l30 32 26-20-6 40z" fill="#2a1200" transform="translate(0 4)" opacity=".55" />
      <path d="M10 58 4 18l26 20L60 6l30 32 26-20-6 40z" fill="url(#ccCrownGold)" stroke="#4a1f00" strokeWidth="3" strokeLinejoin="round" />
      <rect x="10" y="52" width="100" height="12" rx="5" fill="url(#ccCrownGold)" stroke="#4a1f00" strokeWidth="3" />
      <circle cx="60" cy="34" r="7" fill="#ff5d8f" stroke="#4a1f00" strokeWidth="2.5" />
      <circle cx="33" cy="44" r="5" fill="#31e0c2" stroke="#4a1f00" strokeWidth="2.2" />
      <circle cx="87" cy="44" r="5" fill="#a47dff" stroke="#4a1f00" strokeWidth="2.2" />
      <circle cx="4" cy="18" r="4.5" fill="#fff4c8" stroke="#4a1f00" strokeWidth="2" />
      <circle cx="60" cy="6" r="5" fill="#fff4c8" stroke="#4a1f00" strokeWidth="2" />
      <circle cx="116" cy="18" r="4.5" fill="#fff4c8" stroke="#4a1f00" strokeWidth="2" />
      <path d="M57 31a4 4 0 0 1 4-3" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".8" />
    </svg>
  );
}
/** Four twinkling sugar glints around the lockup. */
function Glints() {
  return <span className={c.glints} aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} />)}</span>;
}

/** Layered display word: dark outline + extrusion, light rim, gradient fill, gloss. */
function DisplayWord({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`${c.word} ${className ?? ''}`} data-text={text} aria-hidden="true">
      <span className={c.wordRim} data-text={text} />
      <span className={c.wordFill}>{text}</span>
    </span>
  );
}

/** Counter text: outline/glow layer (data-text) under a gradient fill; written directly every frame. */
function Amount({ ref, text, testId }: { ref: Ref<HTMLSpanElement>; text: string; testId: string }) {
  return <span ref={ref} className={c.amount} data-text={text} data-testid={testId}><span className={c.amountFill}>{text}</span></span>;
}
function writeAmount(el: HTMLSpanElement | null, text: string) {
  if (!el) return;
  el.setAttribute('data-text', text);
  const fill = el.firstElementChild;
  if (fill) fill.textContent = text;
}

export interface WinCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  /** Milliseconds since this screen started on the timeline player's clock (Infinity when there is no player). */
  elapsed: () => number;
  reducedMotion: boolean;
  /** The visible level changed (also called once at the start with `first`). `remainingMs` = time left on screen. */
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  /** The counter reached the final total (naturally or after a tap). */
  onCountDone: () => void;
  /** Tap / click / Enter / Space: the first fast-forwards the count-up, the next one closes. */
  onTap: () => void;
}

export function WinCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: WinCelebrationProps) {
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
      const text = moneyText(centsFor(betCents, value));
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = `${multiplierText(value)}×`;
      }
      const now = levelAt(schedule, e);
      if (now !== shownLevel) {
        const first = shownLevel === 0;
        shownLevel = now;
        setLevel(now);
        if (!first) setFlash(f => f + 1);
        if (!first && !reducedMotion) plaqueRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.22 }, { transform: 'scale(.96)', offset: 0.55 }, { transform: 'scale(1)' }],
          { duration: 620, easing: 'cubic-bezier(.2,.9,.3,1)' },
        );
        callbacks.current.onLevel(now, first, Number.isFinite(e) ? Math.max(0, total - e) : 0);
      }
      if (!finished && e >= schedule.countUp) {
        finished = true;
        setDone(true);
        if (!reducedMotion) plaqueRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.3 }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'ease-out' },
        );
        callbacks.current.onCountDone();
      }
      if (!finished) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [schedule, betCents, elapsed, reducedMotion]);

  const info = WIN_TIER_INFO[level];
  const initial = countUpValueAt(schedule, Math.max(0, elapsed()));
  const style = { '--rays-speed': `${[0, 22, 16, 11, 8, 6][level]}s` } as CSSProperties;
  return (
    <>
      <div className={c.back} data-level={level} data-reduced={reducedMotion || undefined} style={style} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.rays} />
        {level >= 3 && <div className={`${c.rays} ${c.raysCounter}`} />}
        <div className={c.halo} />
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div
        className={c.front}
        data-level={level}
        data-done={done || undefined}
        data-reduced={reducedMotion || undefined}
        data-testid="cascade-celebration"
        role="dialog"
        aria-modal="false"
        aria-label={`${info.title}: ${moneyText(centsFor(betCents, schedule.totalHundredths))} DEMO`}
        onClick={onTap}
      >
        <div className={c.column}>
          <ol className={c.pips} aria-hidden="true">
            {PIPS.map(pip => <li key={pip.level} data-on={level >= pip.level || undefined}><span>{pip.x}</span></li>)}
          </ol>
          <div key={level} className={c.lockup} data-shake>
            <Starburst />
            {level >= 4 && <Crown />}
            <DisplayWord text={info.word} className={c.tierWord} />
            {!reducedMotion && <Glints />}
            <span className={c.ribbon} aria-hidden="true"><span>KAZANÇ</span></span>
          </div>
          <div ref={plaqueRef} className={c.plaque}>
            <Amount ref={amountRef} text={moneyText(centsFor(betCents, initial))} testId="cascade-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{multiplierText(initial)}×</span>
          {level === 5 && <p className={c.capNote}>Tur tavana ulaştı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? 'Devam' : 'Hızlandırmak için dokun'}
          </button>
        </div>
      </div>
    </>
  );
}

export interface FeatureTotalProps {
  spins: number;
  totalHundredths: number;
  multipliers: number[];
  betCents: number;
  /** A tier celebration follows this screen. */
  celebration: boolean;
  capped: boolean;
  /** Screen length on the timeline (ms) and the clock since it started. */
  dur: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onTap: () => void;
}

/** "Bedava Dönüş Toplamı": always ends a free-spin round, whatever the total. */
export function FeatureTotal({ spins, totalHundredths, multipliers, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: FeatureTotalProps) {
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1400, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, moneyText(centsFor(betCents, value)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [elapsed, countMs, totalHundredths, betCents, reducedMotion]);
  const crystalSum = multipliers.reduce((a, b) => a + b, 0);
  const best = multipliers.length ? Math.max(...multipliers) : 0;
  return (
    <>
      <div className={c.back} data-level="feature" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.rays} />
        <div className={c.halo} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="cc-ft-title" data-testid="cascade-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="cc-ft-title" className="sr-only">Bedava Dönüş Toplamı</h2>
          <span className={`${c.ribbon} ${c.ribbonTop}`} aria-hidden="true"><span>BEDAVA DÖNÜŞ</span></span>
          <div className={c.lockup}>
            <Starburst />
            <DisplayWord text="TOPLAM" className={c.featureWord} />
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={moneyText(0)} testId="cascade-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>Dönüş</dt><dd>{spins} dönüş</dd></div>
            <div><dt>Kristal</dt><dd>{crystalSum > 0 ? <>×{crystalSum}<small>{multipliers.length} kez{multipliers.length > 1 ? ` · en yüksek ×${best}` : ''}</small></> : 'Uygulanmadı'}</dd></div>
            <div><dt>Bahsin</dt><dd>{multiplierText(totalHundredths)}×</dd></div>
          </dl>
          {capped && <p className={c.capNote}>Azami kazanca ulaşıldı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? 'Kutlamaya geç' : 'Devam'}</button>
        </div>
      </div>
    </>
  );
}
