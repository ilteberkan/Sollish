'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SLOT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, settingsStorageKeys, type SlotSettings,
} from '@/lib/slot-kit/settings';

export interface UseSlotSettings {
  settings: SlotSettings;
  /** False on the server and on the first client render; settings are the defaults until true. */
  ready: boolean;
  update: (patch: Partial<SlotSettings>) => void;
  reset: () => void;
}

/**
 * Per-game settings remembered in the browser. Reads storage after mount (no hydration mismatch),
 * saves on every change and follows changes made in other tabs.
 */
export function useSlotSettings(gameId: string): UseSlotSettings {
  const [settings, setSettings] = useState<SlotSettings>({ ...DEFAULT_SLOT_SETTINGS });
  const [ready, setReady] = useState(false);
  const current = useRef(settings);

  useEffect(() => {
    const loaded = loadSettings(gameId);
    current.current = loaded;
    setSettings(loaded);
    setReady(true);
    const keys = settingsStorageKeys(gameId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== keys.shared && event.key !== keys.game) return;
      const next = loadSettings(gameId);
      current.current = next;
      setSettings(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [gameId]);

  const update = useCallback((patch: Partial<SlotSettings>) => {
    const next = sanitizeSettings({ ...current.current, ...patch }, current.current);
    current.current = next;
    setSettings(next);
    saveSettings(gameId, next);
  }, [gameId]);

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SLOT_SETTINGS };
    current.current = next;
    setSettings(next);
    saveSettings(gameId, next);
  }, [gameId]);

  return { settings, ready, update, reset };
}
