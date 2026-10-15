'use client';
/**
 * Asena end-of-round and feature screens: the escalating win celebration (Büyük → Mega → Süper → Efsane, Azami for a
 * capped round), the Ergenekon intro, the Ergenekon total and the global-multiplier burst (the iron mountain cracks:
 * ×2 veins, ×3 a wider rift, ×5 the mountain splits open). Original lockups: a gold-rimmed night banner crowned by the
 * star-wolf head, a ring of constellation rays behind it, eight-pointed steppe stars at the ends. Presentation only.
 *
 * The screens read the timeline player's clock (`elapsed`) instead of keeping their own timer, so a tap that moves the
 * player forward also moves the counter, a hidden tab pauses both together, and the last frame always shows the engine
 * total exactly (`countUpValueAt` returns the total from `countUp` on). Counters write their own text nodes.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from 'react';
import { ASENA_TEMPLATES } from '@sollish/protocol';
import { WIN_TIER_INFO, countUpValueAt, levelAt, type CelebrationLevel, type CountUpSchedule } from '@/lib/slot-kit/win-tiers';
import { asenaCents, asenaMoney, asenaTimes } from '@/lib/asena-timeline';
import { AS_WOLF_HEAD, AsenaSymbolUse, asSparkle } from './symbols';
import { AsenaTemplateGlyph } from './template-glyph';
import c from './asena-celebration.module.css';

const PIPS = [{ level: 1, x: '10×' }, { level: 2, x: '25×' }, { level: 3, x: '50×' }, { level: 4, x: '100×' }] as const;
const f1 = (n: number) => Math.round(n * 10) / 10;

/** Ring of constellation rays: alternating long and short rays, each with star nodes along it. */
function StarRays({ rays = 16, className }: { rays?: number; className?: string }) {
  const nodes: string[] = [];
  const lines: string[] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, long = i % 2 === 0;
    const r0 = 44, r1 = long ? 98 : 78;
    const x0 = 100 + Math.cos(a) * r0, y0 = 100 + Math.sin(a) * r0, x1 = 100 + Math.cos(a) * r1, y1 = 100 + Math.sin(a) * r1;
    lines.push(`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`);
    for (const k of long ? [0.45, 1] : [1]) nodes.push(asSparkle(f1(x0 + (x1 - x0) * k), f1(y0 + (y1 - y0) * k), long && k === 1 ? 3.6 : 2.4, 0.2));
  }
  return (
    <svg className={`${c.rays} ${className ?? ''}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <path d={lines.join('')} fill="none" style={{ stroke: 'var(--c-hi)' }} strokeOpacity=".4" strokeWidth=".8" strokeDasharray="1.5 2.5" />
      <path d={nodes.join('')} style={{ fill: 'var(--c-hi)' }} fillOpacity=".85" />
      <circle cx="100" cy="100" r="40" fill="none" style={{ stroke: 'var(--c-mid)' }} strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 5" />
    </svg>
  );
}

/** Eight-pointed steppe star (two squares). */
const eightStar = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.55 : r; pts.push(`${f1(cx + Math.cos(a) * rr)} ${f1(cy + Math.sin(a) * rr)}`); }
  return `M${pts.join('L')}Z`;
};

/** Gold-rimmed night banner with the star-wolf crest and steppe stars at the ends. */
function Banner() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `acb${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const band = 'M40 70Q260 30 480 70L500 95L480 150Q260 118 40 150L20 95Z';
  const inner = 'M54 80Q260 44 466 80L480 96L466 140Q260 108 54 140L40 96Z';
  return (
    <svg className={c.banner} viewBox="0 0 520 190" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={k('gold')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fffbe2" /><stop offset=".3" stopColor="#ffd970" /><stop offset=".62" stopColor="#c27c14" /><stop offset=".84" stopColor="#f2c650" /><stop offset="1" stopColor="#5a3204" /></linearGradient>
        <radialGradient id={k('field')} cx=".5" cy=".4" r=".75"><stop offset="0" style={{ stopColor: 'var(--c-field-hi)' }} /><stop offset=".7" style={{ stopColor: 'var(--c-field)' }} /><stop offset="1" stopColor="#020414" /></radialGradient>
        <linearGradient id={k('wolf')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#cfe8ff" /><stop offset="1" stopColor="#6f8fd8" /></linearGradient>
      </defs>
      <path d={band} fill={u('gold')} stroke="#2a1606" strokeWidth="2.4" strokeLinejoin="round" />
      <path d={inner} fill={u('field')} stroke="#2a1606" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M70 86Q260 54 450 86" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="3" strokeLinecap="round" />
      {[[86, 112], [150, 98], [372, 98], [434, 112], [260, 126]].map(([x, y]) => <path key={`${x}`} d={asSparkle(x!, y!, 3, 0.2)} fill="#e6f4ff" opacity=".7" />)}
      <path d={eightStar(20, 95, 20)} fill={u('gold')} stroke="#2a1606" strokeWidth="2" strokeLinejoin="round" />
      <path d={eightStar(500, 95, 20)} fill={u('gold')} stroke="#2a1606" strokeWidth="2" strokeLinejoin="round" />
      <path d={eightStar(20, 95, 8)} style={{ fill: 'var(--c-mid)' }} />
      <path d={eightStar(500, 95, 8)} style={{ fill: 'var(--c-mid)' }} />
      <g transform="translate(228 -4) scale(.64)">
        <circle cx="50" cy="56" r="48" fill={u('field')} stroke={u('gold')} strokeWidth="5" />
        <path d={AS_WOLF_HEAD} fill={u('wolf')} stroke="#070a1c" strokeWidth="3" strokeLinejoin="round" />
        <path d="M30.4 51C34.6 48 39.4 48.6 43 52.4C39.4 54.8 34.6 54.8 30.4 51ZM69.6 51C65.4 48 60.6 48.6 57 52.4C60.6 54.8 65.4 54.8 69.6 51Z" fill="#ffd25a" />
        <path d={asSparkle(50, 40.6, 7)} fill="#fff6d0" />
      </g>
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

export interface AsenaCelebrationProps {
  schedule: CountUpSchedule;
  betCents: number;
  elapsed: () => number;
  reducedMotion: boolean;
  onLevel: (level: CelebrationLevel, first: boolean, remainingMs: number) => void;
  onCountDone: () => void;
  /** Tap / click / Space: the first finishes the count-up, the next closes. */
  onTap: () => void;
}

export function AsenaCelebration({ schedule, betCents, elapsed, reducedMotion, onLevel, onCountDone, onTap }: AsenaCelebrationProps) {
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
      const text = asenaMoney(asenaCents(betCents, value));
      if (text !== lastText) {
        lastText = text;
        writeAmount(amountRef.current, text);
        if (multRef.current) multRef.current.textContent = `${asenaTimes(value)}× bahis`;
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
  const style = { '--spin': `${[0, 48, 40, 32, 26, 18][level]}s` } as CSSProperties;
  return (
    <>
      <div className={c.back} data-level={level} data-reduced={reducedMotion || undefined} style={style} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <StarRays className={c.raysBack} />
        {level >= 3 && <StarRays rays={10} className={c.raysCounter} />}
        {flash > 0 && <div key={flash} className={c.flash} />}
      </div>
      <div className={c.front} data-level={level} data-done={done || undefined} data-reduced={reducedMotion || undefined}
        data-testid="asena-celebration" role="dialog" aria-modal="false"
        aria-label={`${info.title}: ${asenaMoney(asenaCents(betCents, schedule.totalHundredths))} DEMO`} onClick={onTap}>
        <div className={c.column}>
          <ol className={c.pips} aria-hidden="true">
            {PIPS.map(pip => <li key={pip.level} data-on={level >= pip.level || undefined}><span>{pip.x}</span></li>)}
          </ol>
          <div key={level} className={c.lockup} data-shake>
            <Banner />
            <DisplayWord text={info.word} className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">KAZANÇ</span>
          </div>
          <div ref={plaqueRef} className={c.plaque}>
            <Amount ref={amountRef} text={asenaMoney(asenaCents(betCents, initial))} testId="asena-celebration-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <span ref={multRef} className={c.mult}>{asenaTimes(initial)}× bahis</span>
          {level === 5 && <p className={c.capNote}>Tur tavana ulaştı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>
            {done ? 'Devam' : 'Hızlandırmak için dokun'}
          </button>
        </div>
      </div>
    </>
  );
}

export function AsenaFreeIntro({ awarded, dur, reducedMotion, onTap }: { awarded: number; dur: number; reducedMotion: boolean; onTap: () => void }) {
  return (
    <>
      <div className={c.back} data-level="intro" data-reduced={reducedMotion || undefined} aria-hidden="true">
        <div className={c.dim} />
        <div className={c.halo} />
        <StarRays className={c.raysBack} />
      </div>
      <div className={c.front} data-level="intro" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="as-intro-title" data-testid="asena-intro" onClick={onTap}>
        <div className={`${c.column} ${c.introColumn}`}>
          <div className={c.seals} aria-hidden="true">
            {[0, 1, 2].map(i => <span key={i} className={c.seal} style={{ '--i': i } as CSSProperties}><AsenaSymbolUse symbol="moon" /></span>)}
          </div>
          <h2 id="as-intro-title" className={c.introTitle}><DisplayWord text="ERGENEKON" className={c.introWord} /><span className="sr-only">Ergenekon Başlıyor</span></h2>
          <div className={c.introCount}>
            <strong>{awarded}</strong>
            <span>bedava<br />dönüş</span>
          </div>
          <ul className={c.introGlyphs} aria-hidden="true">
            {ASENA_TEMPLATES.map((t, i) => <li key={t.id} style={{ '--i': i } as CSSProperties}><AsenaTemplateGlyph id={t.id} /><span>×{t.multiplier}</span></li>)}
          </ul>
          <p className={c.introText}>Yanan her takımyıldız <strong>Ergenekon haritasının</strong> bir parçasını açar. <strong>3 farklı</strong> takımyıldız +5 dönüş ve genel çarpan <strong>×2</strong>, <strong>altısı</strong> +5 dönüş ve <strong>×3</strong>, hepsi iki kez yanınca <strong>×5</strong>. Genel çarpan özellik boyunca kalır ve her kazancı çarpar. 3 Ay Ata +3 dönüş.</p>
          <button type="button" className={c.go} onClick={event => { event.stopPropagation(); onTap(); }}>Başla</button>
          <span className={c.timer} style={{ '--hold': `${dur}ms` } as CSSProperties} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}

export interface AsenaFeatureTotalProps {
  spins: number; totalHundredths: number; constellations: number; distinct: number; globalMultiplier: number; wolfSteps: number; betCents: number;
  celebration: boolean; capped: boolean; dur: number; elapsed: () => number; reducedMotion: boolean; onTap: () => void;
}
/** "Ergenekon — Toplam": always ends a free-spin round, whatever the total. */
export function AsenaFeatureTotal({ spins, totalHundredths, constellations, distinct, globalMultiplier, wolfSteps, betCents, celebration, capped, dur, elapsed, reducedMotion, onTap }: AsenaFeatureTotalProps) {
  const amountRef = useRef<HTMLSpanElement>(null);
  const countMs = Math.max(1, Math.min(1500, Math.round(dur * 0.5)));
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const e = Math.max(0, elapsed());
      const p = reducedMotion ? 1 : Math.min(1, e / countMs);
      const value = p >= 1 ? totalHundredths : Math.floor(totalHundredths * (1 - (1 - p) ** 3));
      writeAmount(amountRef.current, asenaMoney(asenaCents(betCents, value)));
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
        <StarRays rays={12} className={c.raysBack} />
      </div>
      <div className={c.front} data-level="feature" data-reduced={reducedMotion || undefined} role="dialog" aria-modal="false" aria-labelledby="as-ft-title" data-testid="asena-feature-total" onClick={onTap}>
        <div className={`${c.column} ${c.featureColumn}`}>
          <h2 id="as-ft-title" className={c.ftTitle}>Ergenekon <span aria-hidden="true">—</span> Toplam</h2>
          <div className={c.lockup}>
            <Banner />
            <DisplayWord text="TOPLAM" className={c.tierWord} />
            <span className={c.sub} aria-hidden="true">BEDAVA DÖNÜŞ</span>
          </div>
          <div className={c.plaque}>
            <Amount ref={amountRef} text={asenaMoney(0)} testId="asena-feature-amount" />
            <small className={c.unit}>DEMO</small>
          </div>
          <dl className={c.stats}>
            <div><dt>Dönüş</dt><dd>{spins} dönüş<small>{wolfSteps > 0 ? `${wolfSteps} kurt adımı` : 'kurt yürümedi'}</small></dd></div>
            <div><dt>Takımyıldız</dt><dd>{constellations}<small>harita {distinct}/6</small></dd></div>
            <div><dt>Genel çarpan</dt><dd>×{globalMultiplier}<small>{asenaTimes(totalHundredths)}× bahis</small></dd></div>
          </dl>
          {capped && <p className={c.capNote}>Azami kazanca ulaşıldı · kalan dönüşler oynanmaz</p>}
          <button type="button" className={c.tap} onClick={event => { event.stopPropagation(); onTap(); }}>{celebration ? 'Kutlamaya geç' : 'Devam'}</button>
        </div>
      </div>
    </>
  );
}

/** Global multiplier burst over the board: the iron mountain of Ergenekon cracks (level 1 ×2, 2 ×3) or splits open (3 ×5).
 * Two halves move apart (transform), the veins and the cleft light up (opacity). Purely decorative; aria-hidden. */
export function AsenaErgenekonBurst({ level, multiplier, life, reducedMotion }: { level: 1 | 2 | 3; multiplier: number; life: number; reducedMotion: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const k = (n: string) => `aeb${uid}${n}`;
  const u = (n: string) => `url(#${k(n)})`;
  const left = 'M10 196L70 104L92 116L132 22L150 60L150 196Z';
  const right = 'M150 196L150 60L168 84L196 62L230 120L250 112L290 196Z';
  return (
    <div className={c.erg} data-level={level} data-reduced={reducedMotion || undefined} style={{ '--life': `${life}ms` } as CSSProperties} aria-hidden="true" data-testid="asena-ergenekon" data-multiplier={multiplier}>
      <span className={c.ergGlow} />
      <svg className={c.ergArt} viewBox="0 0 300 200" focusable="false">
        <defs>
          <linearGradient id={k('iron')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a6488" /><stop offset=".5" stopColor="#2a3050" /><stop offset="1" stopColor="#10142a" /></linearGradient>
          <linearGradient id={k('lava')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff6d0" /><stop offset=".4" stopColor="#ffb84a" /><stop offset="1" stopColor="#ff4a1a" /></linearGradient>
        </defs>
        <path className={c.ergCleft} d="M132 22L150 60L168 84L156 196H144Z" fill={u('lava')} />
        <g className={c.ergLeft}>
          <path d={left} fill={u('iron')} stroke="#070a1c" strokeWidth="3" strokeLinejoin="round" />
          <path d="M132 22L120 70L136 96L124 140" className={c.ergV1} fill="none" stroke={u('lava')} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M70 108L84 138L74 170M104 120L112 156" className={c.ergV2} fill="none" stroke={u('lava')} strokeWidth="2.6" strokeLinecap="round" />
        </g>
        <g className={c.ergRight}>
          <path d={right} fill={u('iron')} stroke="#070a1c" strokeWidth="3" strokeLinejoin="round" />
          <path d="M196 64L188 104L204 132L196 170" className={c.ergV1} fill="none" stroke={u('lava')} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M230 122L222 150L238 178M170 92L176 130" className={c.ergV2} fill="none" stroke={u('lava')} strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </svg>
      <span className={c.ergTag}>ERGENEKON · GENEL ÇARPAN</span>
      <span className={c.ergText} data-text={`×${multiplier}`}><span className={c.ergFill}>×{multiplier}</span></span>
    </div>
  );
}
