/**
 * Slot kit player settings: shape, defaults, validation and storage.
 *
 * Stored JSON is untrusted (extensions, old versions, hand edits), so every field is validated
 * and clamped on read. Two keys are used: one shared across all Sollish games (mute, master
 * volume, speed and comfort options) and one per game id (music/sfx/ambience mix and intro).
 */

import { DEFAULT_VOICE_LEVEL, sanitizeVoiceLevel, type VoiceLevel } from '@/lib/slot-audio/voice-policy';

export const SPIN_SPEEDS = ['normal', 'quick', 'turbo'] as const;
export type SpinSpeed = (typeof SPIN_SPEEDS)[number];

export interface SlotSettings {
  /** 0..1 */ master: number;
  /** 0..1 */ music: number;
  /** 0..1 */ sfx: number;
  /** 0..1 */ ambience: number;
  muted: boolean;
  spinSpeed: SpinSpeed;
  skipScreens: boolean;
  spaceToSpin: boolean;
  reducedEffects: boolean;
  introScreen: boolean;
  /** Character voice-over: Full / Key moments (default) / Off. Rules: lib/slot-audio/voice-policy.ts */
  voice: VoiceLevel;
}

export const DEFAULT_SLOT_SETTINGS: Readonly<SlotSettings> = Object.freeze({
  master: 0.9,
  music: 0.6,
  sfx: 0.8,
  ambience: 0.4,
  muted: true,
  spinSpeed: 'normal',
  skipScreens: false,
  spaceToSpin: true,
  reducedEffects: false,
  introScreen: true,
  voice: DEFAULT_VOICE_LEVEL,
});

export type SlotAudioChannel = 'music' | 'sfx' | 'ambience';

/** Fields stored once for every game. */
export const SHARED_SETTING_KEYS = ['master', 'muted', 'spinSpeed', 'skipScreens', 'spaceToSpin', 'reducedEffects', 'voice'] as const;
/** Fields stored per game id. */
export const GAME_SETTING_KEYS = ['music', 'sfx', 'ambience', 'introScreen'] as const;

const GAME_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_STORED_CHARS = 4096;

export function assertGameId(gameId: string): string {
  if (typeof gameId !== 'string' || !GAME_ID.test(gameId)) throw new RangeError(`Geçersiz oyun kimliği: ${String(gameId)}`);
  return gameId;
}

export function settingsStorageKeys(gameId: string): { shared: string; game: string } {
  assertGameId(gameId);
  return { shared: 'sollish:slot:shared', game: `sollish:slot:game:${gameId}` };
}

function volume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function own(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

/** Validate/clamp an untrusted value into a full settings object; bad fields fall back to `base`. */
export function sanitizeSettings(input: unknown, base: Readonly<SlotSettings> = DEFAULT_SLOT_SETTINGS): SlotSettings {
  const src: Record<string, unknown> = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const speed = own(src, 'spinSpeed');
  return {
    master: volume(own(src, 'master'), base.master),
    music: volume(own(src, 'music'), base.music),
    sfx: volume(own(src, 'sfx'), base.sfx),
    ambience: volume(own(src, 'ambience'), base.ambience),
    muted: flag(own(src, 'muted'), base.muted),
    spinSpeed: typeof speed === 'string' && (SPIN_SPEEDS as readonly string[]).includes(speed) ? (speed as SpinSpeed) : base.spinSpeed,
    skipScreens: flag(own(src, 'skipScreens'), base.skipScreens),
    spaceToSpin: flag(own(src, 'spaceToSpin'), base.spaceToSpin),
    reducedEffects: flag(own(src, 'reducedEffects'), base.reducedEffects),
    introScreen: flag(own(src, 'introScreen'), base.introScreen),
    voice: sanitizeVoiceLevel(own(src, 'voice'), base.voice),
  };
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage` or null; the accessor itself can throw (private mode, blocked site data). */
export function defaultSettingsStorage(): SettingsStorage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis ? (globalThis.localStorage ?? null) : null;
  } catch {
    return null;
  }
}

function readJson(storage: SettingsStorage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_STORED_CHARS) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function pick<K extends keyof SlotSettings>(source: SlotSettings, keys: readonly K[]): Pick<SlotSettings, K> {
  const out = {} as Pick<SlotSettings, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

/** Shared values apply first; the per-game record only ever contributes its own fields. */
export function loadSettings(gameId: string, storage: SettingsStorage | null = defaultSettingsStorage()): SlotSettings {
  const keys = settingsStorageKeys(gameId);
  if (!storage) return { ...DEFAULT_SLOT_SETTINGS };
  const shared = sanitizeSettings(readJson(storage, keys.shared));
  const game = sanitizeSettings(readJson(storage, keys.game));
  return { ...shared, ...pick(game, GAME_SETTING_KEYS) };
}

/** Returns false when nothing could be written; the page keeps working on in-memory state. */
export function saveSettings(gameId: string, settings: SlotSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  const keys = settingsStorageKeys(gameId);
  if (!storage) return false;
  const clean = sanitizeSettings(settings);
  try {
    storage.setItem(keys.shared, JSON.stringify(pick(clean, SHARED_SETTING_KEYS)));
    storage.setItem(keys.game, JSON.stringify(pick(clean, GAME_SETTING_KEYS)));
    return true;
  } catch {
    return false;
  }
}

/** Final 0..1 gain for a channel: muted wins, otherwise master × channel. */
export function effectiveVolume(settings: SlotSettings, channel: SlotAudioChannel): number {
  if (settings.muted) return 0;
  return Math.round(settings.master * settings[channel] * 1000) / 1000;
}

/** Spin timing multiplier applied to presentation delays (never to results). */
export const SPIN_SPEED_FACTOR: Readonly<Record<SpinSpeed, number>> = Object.freeze({ normal: 1, quick: 0.6, turbo: 0.3 });
