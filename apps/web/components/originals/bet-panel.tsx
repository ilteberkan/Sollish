'use client';
import type { ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useT } from '@/lib/i18n/client';
import s from './originals.module.css';

export type BetTab = 'manual' | 'auto';

/** Manuel / Otomatik tabs (Radix Tabs: arrow keys move between tabs, the panel follows). */
/** `shared` (bet amount and game choices) shows under the tabs in both modes, so each control exists exactly once. */
export function BetPanel({ tab, onTabChange, shared, manual, auto }: { tab: BetTab; onTabChange: (tab: BetTab) => void; shared?: ReactNode; manual: ReactNode; auto: ReactNode }) {
  const t = useT('slotKit');
  return (
    <Tabs.Root className={s.tabs} value={tab} onValueChange={value => onTabChange(value === 'auto' ? 'auto' : 'manual')}>
      <Tabs.List className={s.tabList} aria-label={t('originals.tabsLabel')}>
        <Tabs.Trigger className={s.tab} value="manual">{t('originals.manual')}</Tabs.Trigger>
        <Tabs.Trigger className={s.tab} value="auto">{t('originals.auto')}</Tabs.Trigger>
      </Tabs.List>
      {shared}
      <Tabs.Content className={s.tabPanel} value="manual" forceMount data-testid="originals-manual">{manual}</Tabs.Content>
      <Tabs.Content className={s.tabPanel} value="auto" forceMount data-testid="originals-auto">{auto}</Tabs.Content>
    </Tabs.Root>
  );
}

/** ½ and 2× next to the bet (they only rewrite the bet about to be placed, inside the game's own limits). */
export function HalfDouble({ onHalf, onDouble, disabled }: { onHalf: () => void; onDouble: () => void; disabled?: boolean }) {
  const t = useT('slotKit');
  return (
    <>
      <button type="button" className={s.chip} onClick={onHalf} disabled={disabled} aria-label={t('originals.halfAria')} data-testid="bet-half">½</button>
      <button type="button" className={s.chip} onClick={onDouble} disabled={disabled} aria-label={t('originals.doubleAria')} data-testid="bet-double">2×</button>
    </>
  );
}

/** "Bahis tutarı": free DEMO amount (Coinflip, Crash) with ½ and 2× inside the field. */
export function BetAmountField({ id, value, onChange, onHalf, onDouble, disabled, error, errorId = 'amount-error', hint }: {
  id: string; value: string; onChange: (value: string) => void; onHalf: () => void; onDouble: () => void; disabled?: boolean; error?: string; errorId?: string; hint: string;
}) {
  const t = useT('slotKit');
  const tc = useT('common');
  const hintId = `${id}-hint`;
  return (
    <div className={s.field}>
      <div className={s.label}><label htmlFor={id}>{t('originals.betAmount')}</label><small id={hintId}>{hint}</small></div>
      <div className={s.amount} data-invalid={error ? '' : undefined}>
        <input id={id} inputMode="decimal" autoComplete="off" placeholder={tc('game.amountPlaceholder')} value={value} onChange={event => onChange(event.target.value)}
          disabled={disabled} aria-invalid={!!error} aria-describedby={error ? errorId : hintId} />
        <span className={s.unit} aria-hidden="true">DEMO</span>
        <HalfDouble onHalf={onHalf} onDouble={onDouble} disabled={disabled} />
      </div>
      {error && <p id={errorId} className={s.error} role="alert">{error}</p>}
    </div>
  );
}

/** Two-way choice: the selected option yellow, the other grey (Coinflip sides). */
export function ChoiceToggle<V extends string>({ legend, options, value, onChange, disabled }: {
  legend: string; options: ReadonlyArray<{ value: V; label: string; icon?: ReactNode }>; value: V; onChange: (value: V) => void; disabled?: boolean;
}) {
  return (
    <fieldset className={s.field}>
      <legend className={s.label}>{legend}</legend>
      <div className={s.choice}>
        {options.map(option => (
          <button key={option.value} type="button" className={s.choiceBtn} aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>
            {option.icon}{option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** "Toplam kâr" readout. */
export function ProfitReadout({ value, note, up, testId = 'originals-profit' }: { value: string; note?: string; up?: boolean; testId?: string }) {
  const t = useT('slotKit');
  return (
    <div className={s.readout}>
      <span className={s.label}>{t('originals.totalProfit')}</span>
      <output className={s.readoutValue} data-tone={up ? 'up' : undefined} data-testid={testId}><span>{value}</span>{note && <small>{note}</small>}</output>
    </div>
  );
}

export { s as originalsStyles };
