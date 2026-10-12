'use client';
import { useId } from 'react';
import type { SlotSettings, SpinSpeed } from '@/lib/slot-kit/settings';
import { Segmented, Slider, Toggle } from './controls';
import { cx } from './cx';
import styles from './kit.module.css';

export interface SettingsPanelProps {
  settings: SlotSettings;
  onChange: (patch: Partial<SlotSettings>) => void;
  /** Adds a "Varsayılana dön" button when given. */
  onReset?: () => void;
  className?: string;
}

const SPEEDS: ReadonlyArray<{ value: SpinSpeed; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'quick', label: 'Hızlı' },
  { value: 'turbo', label: 'Turbo' },
];

/** Sound mix, spin speed and comfort options. Controlled: the parent owns `settings`. */
export function SettingsPanel({ settings, onChange, onReset, className }: SettingsPanelProps) {
  const id = useId();
  return (
    <div className={cx(styles.kit, styles.panel, className)}>
      <section className={styles.group} aria-labelledby={`${id}-sound`}>
        <h3 id={`${id}-sound`} className={styles.groupTitle}>Ses</h3>
        <Toggle label="Sesi kapat" description="Müzik ve efektlerin hepsini susturur." checked={settings.muted} onChange={muted => onChange({ muted })} />
        <div className={styles.sliders} data-dim={settings.muted || undefined}>
          <Slider label="Ana ses" value={settings.master} onChange={master => onChange({ master })} />
          <Slider label="Müzik" value={settings.music} onChange={music => onChange({ music })} />
          <Slider label="Efektler" value={settings.sfx} onChange={sfx => onChange({ sfx })} />
          <Slider label="Ortam sesi" value={settings.ambience} onChange={ambience => onChange({ ambience })} />
        </div>
      </section>
      <section className={styles.group} aria-labelledby={`${id}-play`}>
        <h3 id={`${id}-play`} className={styles.groupTitle}>Oynanış</h3>
        <Segmented label="Dönüş hızı" options={SPEEDS} value={settings.spinSpeed} onChange={spinSpeed => onChange({ spinSpeed })} />
        <Toggle label="Giriş ekranlarını atla" description="Özellik giriş ve çıkış ekranları beklemeden geçilir." checked={settings.skipScreens} onChange={skipScreens => onChange({ skipScreens })} />
        <Toggle label="Boşluk tuşuyla döndür" description="Boşluk tuşu dönüşü başlatır; tur sürerken yalnız kutlama sayacını hızlandırır." checked={settings.spaceToSpin} onChange={spaceToSpin => onChange({ spaceToSpin })} />
        <Toggle label="Az efekt" description="Parçacık, sarsıntı ve parlamayı azaltır." checked={settings.reducedEffects} onChange={reducedEffects => onChange({ reducedEffects })} />
        <Toggle label="Açılış ekranını göster" description="Oyun açılırken tanıtım ekranı oynar." checked={settings.introScreen} onChange={introScreen => onChange({ introScreen })} />
      </section>
      {onReset && <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onReset}>Varsayılana dön</button>}
    </div>
  );
}
