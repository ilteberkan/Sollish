'use client';
import { useId } from 'react';
import type { SlotSettings, SpinSpeed } from '@/lib/slot-kit/settings';
import type { VoiceLevel } from '@/lib/slot-audio/voice-policy';
import { HTML_LANG, LOCALE_NATIVE_NAMES, LOCALES, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { Segmented, Slider, Toggle } from './controls';
import { cx } from './cx';
import styles from './kit.module.css';

export interface SettingsPanelProps {
  settings: SlotSettings;
  onChange: (patch: Partial<SlotSettings>) => void;
  /** Adds a "Restore defaults" button when given. */
  onReset?: () => void;
  /** Show the language picker (default true). The choice is site-wide, not per game, and is not reset by onReset. */
  showLanguage?: boolean;
  className?: string;
}

const SPEEDS = ['normal', 'quick', 'turbo'] as const satisfies readonly SpinSpeed[];
const SPEED_KEY = { normal: 'settings.speedNormal', quick: 'settings.speedQuick', turbo: 'settings.speedTurbo' } as const;

/**
 * Character voice level. The translated labels live in slotKit `settings.voice*` (all 9 locales); this constant keeps
 * the original Turkish text for reference and existing imports.
 */
export const VOICE_LEVEL_UI: { label: string; options: ReadonlyArray<{ value: VoiceLevel; label: string; hint: string }> } = {
  label: 'Ses anonsu',
  options: [
    { value: 'full', label: 'Tam', hint: 'Her replik' },
    { value: 'key', label: 'Önemli anlar', hint: 'Kazanç ve özellikler' },
    { value: 'off', label: 'Kapalı', hint: 'Sessiz' },
  ],
};
const VOICE_KEY = {
  full: { label: 'settings.voiceFull', hint: 'settings.voiceFullHint' },
  key: { label: 'settings.voiceKey', hint: 'settings.voiceKeyHint' },
  off: { label: 'settings.voiceOff', hint: 'settings.voiceOffHint' },
} as const satisfies Record<VoiceLevel, { label: string; hint: string }>;

/** Sound mix, spin speed, comfort options and the site language. Controlled: the parent owns `settings`. */
export function SettingsPanel({ settings, onChange, onReset, showLanguage = true, className }: SettingsPanelProps) {
  const id = useId();
  const t = useT('slotKit');
  const { selected, setLocale } = useLocale();
  return (
    <div className={cx(styles.kit, styles.panel, className)}>
      <section className={styles.group} aria-labelledby={`${id}-sound`}>
        <h3 id={`${id}-sound`} className={styles.groupTitle}>{t('settings.sound')}</h3>
        <Toggle label={t('settings.mute')} description={t('settings.muteDesc')} checked={settings.muted} onChange={muted => onChange({ muted })} />
        <div className={styles.sliders} data-dim={settings.muted || undefined}>
          <Slider label={t('settings.master')} value={settings.master} onChange={master => onChange({ master })} />
          <Slider label={t('settings.music')} value={settings.music} onChange={music => onChange({ music })} />
          <Slider label={t('settings.sfx')} value={settings.sfx} onChange={sfx => onChange({ sfx })} />
          <Slider label={t('settings.ambience')} value={settings.ambience} onChange={ambience => onChange({ ambience })} />
        </div>
        <Segmented label={t('settings.voice')} options={VOICE_LEVEL_UI.options.map(({ value }) => ({ value, label: t(VOICE_KEY[value].label), hint: t(VOICE_KEY[value].hint) }))} value={settings.voice} onChange={voice => onChange({ voice })} />
      </section>
      <section className={styles.group} aria-labelledby={`${id}-play`}>
        <h3 id={`${id}-play`} className={styles.groupTitle}>{t('settings.play')}</h3>
        <Segmented label={t('settings.speed')} options={SPEEDS.map(value => ({ value, label: t(SPEED_KEY[value]) }))} value={settings.spinSpeed} onChange={spinSpeed => onChange({ spinSpeed })} />
        <Toggle label={t('settings.skipScreens')} description={t('settings.skipScreensDesc')} checked={settings.skipScreens} onChange={skipScreens => onChange({ skipScreens })} />
        <Toggle label={t('settings.spaceToSpin')} description={t('settings.spaceToSpinDesc')} checked={settings.spaceToSpin} onChange={spaceToSpin => onChange({ spaceToSpin })} />
        <Toggle label={t('settings.reducedEffects')} description={t('settings.reducedEffectsDesc')} checked={settings.reducedEffects} onChange={reducedEffects => onChange({ reducedEffects })} />
        <Toggle label={t('settings.introScreen')} description={t('settings.introScreenDesc')} checked={settings.introScreen} onChange={introScreen => onChange({ introScreen })} />
      </section>
      {showLanguage && (
        <section className={styles.group} aria-labelledby={`${id}-lang`}>
          <h3 id={`${id}-lang`} className={styles.groupTitle}>{t('settings.language')}</h3>
          <Segmented<Locale>
            className={styles.langChips}
            label={<span className={styles.srOnly}>{t('settings.language')}</span>}
            layout="chips"
            options={LOCALES.map(code => ({ value: code, label: <span lang={HTML_LANG[code]}>{LOCALE_NATIVE_NAMES[code]}</span> }))}
            value={selected}
            onChange={next => { void setLocale(next); }}
          />
        </section>
      )}
      {onReset && <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onReset}>{t('settings.reset')}</button>}
    </div>
  );
}
