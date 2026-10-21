'use client';
/**
 * Göreme end-of-round and feature screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami for a
 * capped round), the Şafak Şöleni intro and the Şafak Şöleni total. Original lockups: a tuff-stone plaque bound with a
 * kilim band, a rising dawn sun behind it with stepped rays, balloons drifting up on each side. Each tier has its own
 * colour (dawn rose, turquoise, plum, ember, royal gold). Presentation only.
 *
 * The screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that moves the
 * player forward also moves the counter, a hidden tab pauses both together, and the last frame always shows the engine
 * total exactly (`countUpValueAt` returns the total from `countUp` on). Counters write their own text nodes.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from 'react';
import { GOREME_SCATTER_AWARDS } from '@sollish/protocol';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { goremeCents, goremeMoney, goremeTimes } from '@/lib/goreme-timeline';
import { useFormat, useT } from '@/lib/i18n/client';
import { richText } from '../game-rich';
import { GR_PALETTE as P, GoremeSymbol, grDiamond } from './symbols';
import c from './goreme-celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;
const f1 = (n: number) => Math.round(n * 10) / 10;

/** Dawn sun with stepped kilim rays (the ring turns slowly behind the plaque). */
function SunRays({ rays = 20, className }: { rays?: number; className?: string }) {
  const d: string[] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, long = i % 2 === 0, r0 = 40, r1 = long ? 98 : 80, w = long ? 0.07 : 0.05;
    const p = (r: number, da: number) => `${f1(100 + Math.cos(a + da) * r)} ${f1(100 + Math.sin(a + da) * r)}`;
    d.push(`M${p(r0, -w)}L${p((r0 + r1) / 2, -w * 0.6)}L${p(r1, 0)}L${p((r0 + r1) / 2, w * 0.6)}L${p(r0, w)}Z`);
  }
  return (
    <svg className={`${c.rays} ${className ?? ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <path d={d.join('')} style={{ fill: 'var(--c-mid)' }} fillOpacity=".55" />
      <circle cx="100" cy="100" r="36" style={{ fill: 'var(--c-hi)' }} fillOpacity=".35" />
      <circle cx="100" cy="100" r="44" fill="none" style={{ stroke: 'var(--c-hi)' }} strokeOpacity=".5" strokeWidth="1.2" strokeDasharray="3 4" />
    </svg>
  );
}

/** Tuff plaque bound with a kilim band; stepped diamonds at the ends. */
function Plaque() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `gcb${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const stone = 'M34 64Q260 26 486 64L506 98L486 152Q260 122 34 152L14 98Z';
  const face = 'M50 76Q260 42 470 76L486 98L470 140Q260 112 50 140L34 98Z';
  return (
    <svg className={c.banner} viewBox="0 0 520 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('tuff')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.tuff.hi} /><stop offset=".55" stopColor={P.tuff.light} /><stop offset="1" stopColor={P.tuff.deep} /></linearGradient>
        <radialGradient id={k('field')} cx=".5" cy=".35" r=".8"><stop offset="0" style={{ stopColor: 'var(--c-field-hi)' }} /><stop offset=".75" style={{ stopColor: 'var(--c-field)' }} /><stop offset="1" stopColor="#1a0812" /></radialGradient>
        <pattern id={k('kilim')} width="26" height="14" patternUnits="userSpaceOnUse">
          <rect width="26" height="14" fill={P.madder.base} />
          <path d={grDiamond(13, 7, 7, 5.5)} fill={P.saffron.light} /><path d={grDiamond(13, 7, 3, 2.4)} fill={P.indigo.base} />
        </pattern>
      </defs>
      <path d={stone} fill={u('tuff')} stroke={P.ink} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M40 150Q260 120 480 150L486 160Q260 132 34 160Z" fill={u('kilim')} stroke={P.ink} strokeWidth="1.6" />
      <path d={face} fill={u('field')} stroke={P.ink} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M66 86Q260 54 454 86" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="3" strokeLinecap="round" />
      {[[14, 98], [506, 98]].map(([x, y]) => <g key={x}><path d={grDiamond(x!, y!, 20, 22)} fill={P.saffron.base} stroke={P.ink} strokeWidth="2" /><path d={grDiamond(x!, y!, 9, 10)} style={{ fill: 'var(--c-mid)' }} /></g>)}
    </svg>
  );
}

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
/** Balloons drifting up behind the lockup (decorative, transform only). */
function Drifters({ count = 6 }: { count?: number }) {
  const mults = [2, 5, 9, 15, 3, 25, 7, 12];
  return (
    <div className={c.drifters} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={c.drifter} style={{ '--i': i, '--x': `${[6, 88, 18, 76, 30, 64, 46, 94][i]}%` } as CSSProperties}>
          <GoremeSymbol sprite symbol="balloon" multiplier={mults[i % mults.length]} label={null} />
        </span>
      ))}
    </div>
  );
}

export interface GoremeCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  onCountDone: () => void;
  /** Tap / click / Space: the first finishes the count-up, the next closes. */
  onTap: () => void;
}

export function GoremeCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: GoremeCelebrationProps) {
  const t = useT('goreme');
  const tk = useT('slotKit');
  const loc = useFormat().locale;
  const multText = useRef<(value: number) => string>(() => '');
  multText.current = (value: number) => t('celebration.times', { times: goremeTimes(value, loc) });
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
      const text = goremeMoney(goremeCents(betCents, value), loc);
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = multText.current(value);
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
  }, [schedule, betCents, elapsed, reducedMotion, loc]);

  const info = WIN_TIER_INFO[level];
  const initial = countUpValueAt(schedule, Math.max(0, elapsed()));
  const style = { '--spin': `${[0, 60, 48, 40, 32, 22][level]}s` } as CSSProperties;
  return (
    <>
      <div className={c.back} data-level={level} data-reduced={reducedMotion || undefined} style={style} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <SunRays className={c.raysBack} />
        {level >= 3 && <SunRays rays={12} className={c.raysCounter} />}
        {!reducedMotion && <Drifters count={2 + level} />}
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div className={c.front} data-level={level} data-done={done || undefined} data-reduced={reducedMotion || undefined}
        data-testid="goreme-celebration" role="dialog" aria-modal="false"
        aria-label={t('celebration.aria', { title: tk(`winTier.${info.id}.title`), money: goremeMoney(goremeCents(betCents, schedule.totalHundredths), loc) })} onClick={onTap}>
        <div className={c.column}>
          <ol className={c.pips} aria-hidden="true">
            {PIPS.map(pip => <li key={pip.level} data-on={level >= pip.level || undefined}><span>{pip.x}</span></li>)}
          </ol>
          <div key={level} className={c.lockup}>
            <Plaque />
            <DisplayWord text={tk(`winTier.${info.id}.word`)} className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">{tk('winWord')}</span>
          </div>
          <div ref={plaqueRef} className={c.plaque}>
            <Amount ref={amountRef} text={goremeMoney(goremeCents(betCents, initial), loc)} testId="goreme-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{multText.current(initial)}</span>
          {level === 5 && <p className={c.capNote}>{t('celebration.capNote')}</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? t('celebration.continue') : t('celebration.speedUp')}
          </button>
        </div>
      </div>
    </>
  );
}

export function GoremeFreeIntro({ awarded, dur, reducedMotion, onTap }: { awarded: number; dur: number; reducedMotion: boolean; onTap: () => void }) {
  const t = useT('goreme');
  return (
    <>
      <div className={c.back} data-level="intro" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <SunRays className={c.raysBack} />
        {!reducedMotion && <Drifters count={6} />}
      </div>
      <div className={c.front} data-level="intro" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="gr-intro-title" data-testid="goreme-intro" onClick={onTap}>
        <div className={`${c.column} ${c.introColumn}`}>
          <div className={c.seals} aria-hidden="true">
            {[0, 1, 2].map(i => <span key={i} className={c.seal} style={{ '--i': i } as CSSProperties}><GoremeSymbol sprite symbol="sun" label={null} /></span>)}
          </div>
          <h2 id="gr-intro-title" className={c.introTitle}><DisplayWord text={t('intro.word')} className={c.introWord} /><span className="sr-only">{t('intro.srTitle')}</span></h2>
          <div className={c.introCount}>
            <strong>{awarded}</strong>
            <span style={{ whiteSpace: 'pre-line' }}>{t('intro.freeSpins')}</span>
          </div>
          <p className={c.introText}>{richText(t, 'intro.text')}</p>
          <button type="button" className={c.go} onClick={event => { event.stopPropagation(); onTap(); }}>{t('intro.start')}</button>
          <span className={c.timer} style={{ '--hold': `${dur}ms` } as CSSProperties} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

export interface GoremeFeatureTotalProps {
  spins: number; totalHundredths: number; sky: number; moored: number; betCents: number;
  celebration: boolean; capped: boolean; dur: number; elapsed: () => number; reducedMotion: boolean; onTap: () => void;
}
/** "Şafak Şöleni — Toplam": always ends a free-spin round, whatever the total. */
export function GoremeFeatureTotal({ spins, totalHundredths, sky, moored, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: GoremeFeatureTotalProps) {
  const t = useT('goreme');
  const loc = useFormat().locale;
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1500, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, goremeMoney(goremeCents(betCents, value), loc));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [elapsed, countMs, totalHundredths, betCents, reducedMotion, loc]);
  return (
    <>
      <div className={c.back} data-level="feature" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <SunRays rays={16} className={c.raysBack} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="gr-ft-title" data-testid="goreme-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="gr-ft-title" className={c.ftTitle}>{t('total.title')}</h2>
          <div className={c.lockup}>
            <Plaque />
            <DisplayWord text={t('total.word')} className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">{t('total.sub')}</span>
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={goremeMoney(0, loc)} testId="goreme-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>{t('total.spins')}</dt><dd>{t('total.spinsValue', { spins })}</dd></div>
            <div><dt>{t('total.sky')}</dt><dd>×{sky}<small>{t('total.moored', { n: moored })}</small></dd></div>
            <div><dt>{t('total.ofBetLabel')}</dt><dd>{goremeTimes(totalHundredths, loc)}×</dd></div>
          </dl>
          {capped && <p className={c.capNote}>{t('total.capNote')}</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? t('total.toCelebration') : t('celebration.continue')}</button>
        </div>
      </div>
    </>
  );
}

/** Scatter award values for the intro / info (3..6 suns). */
export const GOREME_SUN_AWARDS = GOREME_SCATTER_AWARDS;
