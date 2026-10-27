'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useFormat, useT } from '@/lib/i18n/client';
import type { Formatter } from '@/lib/i18n/format';
import {
  exactDecimal, groupsSum, linesSum, verifyBreakdown,
  type BreakdownFactor, type BreakdownGame, type BreakdownLine, type BreakdownSpin, type BreakdownUnit, type RoundBreakdown,
} from '@/lib/round-breakdown/types';
import { Modal } from './modal';
import { cx } from './cx';
import styles from './round-breakdown.module.css';

/* "Tur ayrıntısı": every win of a round as the engine paid it, its multipliers, the spin and round sums, the cap, and
   bet x total = payout, with a visible check that the re-added chain equals the engine's own payout. Presentation only:
   the numbers come from lib/round-breakdown/<game>.ts, which copies them from the engine round. */

const STEP_KIND: Record<BreakdownGame, 'tumble' | 'board' | 'chain' | 'drop'> = {
  cascade: 'tumble', tarhun: 'tumble', ebru: 'tumble', asena: 'tumble', goreme: 'board', cezeri: 'chain', damla: 'drop',
};
const digitsOf = (unit: BreakdownUnit): number => (unit === 100 ? 2 : 4);

/** Symbol names from the game's own namespace (`<game>.symbols.<id>`). */
function useSymbolName(game: BreakdownGame): (id: string) => string {
  const t = useT(game === 'damla' ? 'damla' : game);
  return useMemo(() => (id: string) => {
    const key = `symbols.${id}`;
    return t.has(key) ? t(key as never) : id;
  }, [t]);
}

function useNumbers(format: Formatter) {
  return useMemo(() => {
    const group = (whole: bigint) => (whole <= BigInt(Number.MAX_SAFE_INTEGER) ? format.number(Number(whole), 0) : whole.toString());
    /** value / unit as a bet multiple: "1.62×". */
    const times = (value: number | bigint, unit: BreakdownUnit) => `${exactDecimal(BigInt(value), digitsOf(unit), format.decimal, group)}×`;
    /** bet x value / unit in DEMO, exact. */
    const money = (betCents: number, value: number | bigint, unit: BreakdownUnit) => exactDecimal(BigInt(betCents) * BigInt(value), digitsOf(unit) + 2, format.decimal, group);
    return { times, money };
  }, [format]);
}

export interface RoundBreakdownPanelProps {
  breakdown: RoundBreakdown;
  /** Visible name of the round's mode (defaults to the engine mode id). */
  modeLabel?: string;
}

/** The breakdown itself (no dialog chrome). */
export function RoundBreakdownPanel({ breakdown: b, modeLabel }: RoundBreakdownPanelProps) {
  const t = useT('slotKit');
  const format = useFormat();
  const symbolName = useSymbolName(b.game);
  const { times, money } = useNumbers(format);
  const check = useMemo(() => verifyBreakdown(b), [b]);
  const stepKind = STEP_KIND[b.game];

  const factorText = (f: BreakdownFactor) => t(`breakdown.factor.${f.kind}`, { value: format.number(f.value, 0) });
  const lineLabel = (l: BreakdownLine): string => {
    switch (l.kind) {
      case 'cluster': return t('breakdown.line.cluster', { count: l.count });
      case 'ways': return t('breakdown.line.ways', { count: l.count, ways: l.ways ?? 0 });
      case 'spoke': return t('breakdown.line.spoke', { spoke: l.spoke ?? 0, count: l.count, rotation: l.rotation ?? 1 });
      case 'scatter': return t('breakdown.line.scatter', { count: l.count });
      case 'pool': return t('breakdown.line.pool', { rows: l.count, slot: (l.slot ?? 0) + 1 });
    }
  };
  const lineCalc = (l: BreakdownLine): string => {
    const parts = [times(l.base, l.unit)];
    if (l.deduct) parts.push(t('breakdown.deduct', { amount: times(l.deduct, l.unit) }));
    for (const f of l.factors) parts.push(`× ${factorText(f)}`);
    return parts.join(' ');
  };
  const lineRow = (l: BreakdownLine, key: string): ReactNode => (
    <li key={key} className={styles.line} data-testid="round-breakdown-line">
      <span className={styles.lineName}>
        <strong>{l.kind === 'pool' ? t('breakdown.pool') : symbolName(l.symbol)}</strong>
        <small>{lineLabel(l)}</small>
        {l.path && <small className={styles.path} aria-label={t('breakdown.pathAria', { path: l.path })}>{l.path.split('').map(c => (c === 'R' ? '↘' : '↙')).join('')}</small>}
      </span>
      <span className={styles.lineCalc}>{l.factors.length || l.deduct ? lineCalc(l) : ''}{l.clamp !== undefined && BigInt(l.amount) === BigInt(l.clamp) ? ` · ${t('breakdown.clamped')}` : ''}</span>
      <span className={styles.lineAmount}><strong>{times(l.amount, l.unit)}</strong><small>{l.shareCents !== undefined ? format.amount(l.shareCents) : money(b.betCents, l.amount, l.unit)} DEMO</small></span>
    </li>
  );
  const spinTitle = (s: BreakdownSpin) => (s.kind === 'base' ? t('breakdown.base') : t('breakdown.free', { n: s.index }));

  const paidSpins = b.spins.filter(s => s.groups.length > 0 || s.extras.length > 0);
  const quietFree = b.spins.filter(s => s.kind === 'free' && s.groups.length === 0 && s.extras.length === 0).length;
  const capped = b.capHundredths !== null && b.capped;

  return (
    <div className={styles.panel} data-testid="round-breakdown" data-ok={check.ok || undefined}>
      <p className={styles.meta}>
        {t('breakdown.meta', { bet: format.demo(b.betCents), mode: modeLabel ?? b.mode, id: b.seedHex.slice(0, 8) })}
      </p>
      {paidSpins.length === 0 ? <p className={styles.empty}>{t('breakdown.noWin')}</p> : paidSpins.map(spin => {
        const sum = groupsSum(spin);
        return (
          <section key={spin.index} className={styles.spin} aria-label={spinTitle(spin)}>
            {(b.spins.length > 1 || b.game !== 'damla') && <h3 className={styles.spinTitle}>{spinTitle(spin)}</h3>}
            {spin.groups.map(g => (
              <div key={g.step} className={styles.group}>
                {(spin.groups.length > 1 || stepKind === 'chain') && <p className={styles.groupTitle}>{t(`breakdown.step.${stepKind}`, { n: g.step })}</p>}
                <ul className={styles.lines}>{g.lines.map((l, i) => lineRow(l, `${g.step}-${i}`))}</ul>
                {(g.factors.length > 0 || g.divisor !== 1) && (
                  <p className={styles.sumRow}>
                    <span>{t('breakdown.groupSum', { sum: times(linesSum(g.lines), g.unit) })}{g.factors.map(f => ` × ${factorText(f)}`).join('')}{g.divisor !== 1 ? ` · ${t('breakdown.floor')}` : ''}</span>
                    <strong>{times(g.amountHundredths, 100)}</strong>
                  </p>
                )}
              </div>
            ))}
            {spin.factors.length > 0 && (
              <p className={styles.sumRow}>
                <span>{t('breakdown.spinSum', { sum: times(sum, 100) })}{spin.factors.map(f => ` × ${factorText(f)}`).join('')}</span>
                <strong>{times(sum * spin.factors.reduce((p, f) => p * BigInt(f.value), 1n), 100)}</strong>
              </p>
            )}
            {spin.extras.length > 0 && <ul className={styles.lines}>{spin.extras.map((l, i) => lineRow(l, `x${i}`))}</ul>}
            {b.game !== 'damla' && (
              <p className={cx(styles.sumRow, styles.spinTotal)}>
                <span>{t('breakdown.spinWin')}</span>
                <strong>{times(spin.winHundredths, 100)}</strong>
              </p>
            )}
          </section>
        );
      })}
      {quietFree > 0 && <p className={styles.quiet}>{t('breakdown.quietFree', { n: quietFree })}</p>}
      <footer className={styles.total}>
        {b.spins.length > 1 && <p className={styles.sumRow}><span>{t('breakdown.sumSpins')}</span><strong>{times(check.sumHundredths, 100)}</strong></p>}
        {capped && <p className={cx(styles.sumRow, styles.cap)}><span>{t('breakdown.cap', { cap: times(b.capHundredths!, 100) })}</span><strong>{times(b.capHundredths!, 100)}</strong></p>}
        <p className={styles.sumRow}><span>{t('breakdown.total')}</span><strong data-testid="round-breakdown-times">{times(b.totalHundredths, 100)}</strong></p>
        <p className={cx(styles.sumRow, styles.payout)}>
          <span>{t('breakdown.payout', { bet: format.amount(b.betCents), times: times(b.totalHundredths, 100) })}</span>
          <strong><span data-testid="round-breakdown-total">{format.amount(b.payoutCents)}</span> <small>DEMO</small></strong>
        </p>
        <p className={cx(styles.check, check.ok ? styles.checkOk : styles.checkBad)} data-testid="round-breakdown-check" role="status">
          {check.ok ? t('breakdown.checkOk', { amount: format.demo(b.payoutCents), engine: b.engine }) : t('breakdown.checkBad', { amount: format.demo(check.payoutCents), engine: format.demo(b.payoutCents) })}
        </p>
        <p className={styles.note}>{t('breakdown.note')}</p>
      </footer>
    </div>
  );
}

export interface RoundBreakdownDialogProps extends Partial<RoundBreakdownPanelProps> {
  open: boolean;
  onClose: () => void;
}
/** Controlled dialog (one per screen; history tables keep one and fill it per row). */
export function RoundBreakdownDialog({ open, onClose, breakdown, modeLabel }: RoundBreakdownDialogProps) {
  const t = useT('slotKit');
  return (
    <Modal open={open && !!breakdown} onClose={onClose} title={t('breakdown.title')} size="md" className={styles.modal}>
      {breakdown && <RoundBreakdownPanel breakdown={breakdown} modeLabel={modeLabel} />}
    </Modal>
  );
}

export interface RoundBreakdownButtonProps {
  onClick: () => void;
  disabled?: boolean;
  /** Small icon-and-word variant for history rows. */
  compact?: boolean;
  className?: string;
  /** Accessible name; defaults to "Round breakdown". */
  label?: string;
  testId?: string;
}
export function RoundBreakdownButton({ onClick, disabled, compact, className, label, testId = 'round-breakdown-open' }: RoundBreakdownButtonProps) {
  const t = useT('slotKit');
  return (
    <button type="button" className={cx(styles.button, compact && styles.buttonCompact, className)} onClick={onClick} disabled={disabled}
      aria-haspopup="dialog" aria-label={label} data-testid={testId}>
      <svg viewBox="0 0 24 24" width={compact ? 14 : 16} height={compact ? 14 : 16} aria-hidden="true" focusable="false">
        <path d="M5 4h14v16H5zM8 8.5h8M8 12h8M8 15.5h5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{t('breakdown.open')}</span>
    </button>
  );
}

export interface RoundBreakdownLauncherProps {
  /** The finished round's breakdown, or null (the button is then not rendered). */
  breakdown: RoundBreakdown | null;
  modeLabel?: string;
  disabled?: boolean;
  className?: string;
}
/** Button + its dialog, for the spot next to a game's win readout. */
export function RoundBreakdownLauncher({ breakdown, modeLabel, disabled, className }: RoundBreakdownLauncherProps) {
  const [open, setOpen] = useState(false);
  if (!breakdown) return null;
  return (
    <>
      <RoundBreakdownButton onClick={() => setOpen(true)} disabled={disabled} className={className} />
      <RoundBreakdownDialog open={open} onClose={() => setOpen(false)} breakdown={breakdown} modeLabel={modeLabel} />
    </>
  );
}
