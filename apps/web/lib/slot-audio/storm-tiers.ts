/**
 * Pure logic for the Tarhun (storm-throne) sound: multiplier callout classes (7, up to the ×500 orb),
 * orb pitch classes, the recorded voice bank (file names from docs/product/storm-throne-voice-script.md),
 * which non-verbal placeholder vocal stands in for a missing line, and the one-voice-at-a-time policy.
 * No Web Audio here, so it is unit tested in Node. Presentation only: nothing here reads or changes a result.
 */
import { versionedVoiceUrl } from './voice-version';
import type { WinTier } from './win-tiers';

/** Applied-multiplier callout classes, named by their lower bound (x2 = anything below ×10). */
export type StormMultiplierClass = 'x2' | 'x10' | 'x25' | 'x50' | 'x100' | 'x250' | 'x500';
export const STORM_MULTIPLIER_CLASSES: readonly StormMultiplierClass[] = ['x2', 'x10', 'x25', 'x50', 'x100', 'x250', 'x500'];
export const STORM_MULTIPLIER_CLASS_MIN: Readonly<Record<StormMultiplierClass, number>> = Object.freeze({ x2: 0, x10: 10, x25: 25, x50: 50, x100: 100, x250: 250, x500: 500 });

/** <10× → x2, ≥10× → x10, ≥25× → x25, ≥50× → x50, ≥100× → x100, ≥250× → x250, ≥500× → x500. Non-finite → x2. */
export function stormMultiplierClass(value: number): StormMultiplierClass {
  if (!Number.isFinite(value)) return 'x2';
  for (let i = STORM_MULTIPLIER_CLASSES.length - 1; i > 0; i--) { const c = STORM_MULTIPLIER_CLASSES[i]!; if (value >= STORM_MULTIPLIER_CLASS_MIN[c]) return c; }
  return 'x2';
}
export const stormMultiplierRank = (c: StormMultiplierClass) => STORM_MULTIPLIER_CLASSES.indexOf(c);

/**
 * Orb pitch: the glassy hum of an orb rises with its value class along chord tones of A Hicaz
 * (A C# D E G A C#: 0, 4, 5, 7, 10, 12, 16 semitones above the ×2–9 orb), so the top classes stay
 * consonant with the base theme. Returns semitones above the ×2 orb.
 */
export const ORB_STEPS: readonly number[] = [0, 4, 5, 7, 10, 12, 16];
export function orbSemitones(value: number): number {
  return ORB_STEPS[stormMultiplierRank(stormMultiplierClass(value))]!;
}

/* ---------------- voice bank ---------------- */

/** Recorded voice lines (file stem → when), exactly the names of the voice script. */
export const STORM_VOICE_LINES = [
  'x2-9', 'x10', 'x25', 'x50', 'x100', 'x250', 'x500',
  'scatter-tease', 'feature-trigger', 'feature-start', 'retrigger',
  'win-big', 'win-mega', 'win-super', 'win-legend', 'win-max',
  'laugh', 'nice', 'feature-end',
] as const;
export type StormVoiceLine = (typeof STORM_VOICE_LINES)[number];

export const STORM_CLASS_VOICE: Readonly<Record<StormMultiplierClass, StormVoiceLine>> = Object.freeze({ x2: 'x2-9', x10: 'x10', x25: 'x25', x50: 'x50', x100: 'x100', x250: 'x250', x500: 'x500' });
export const STORM_TIER_VOICE: Readonly<Record<WinTier | 'max', StormVoiceLine>> = Object.freeze({ 1: 'win-big', 2: 'win-mega', 3: 'win-super', 4: 'win-legend', max: 'win-max' });

/** Non-verbal placeholder vocal ids (rendered effects) that stand in for a missing line; null = none. */
export type StormVocal = 'vo-hum' | 'vo-grunt' | 'vo-laugh';
export const STORM_PLACEHOLDER: Readonly<Record<StormVoiceLine, StormVocal | null>> = Object.freeze({
  'x2-9': null, x10: 'vo-grunt', x25: 'vo-grunt', x50: 'vo-grunt', x100: 'vo-laugh', x250: 'vo-laugh', x500: 'vo-laugh',
  'scatter-tease': 'vo-hum', 'feature-trigger': 'vo-grunt', 'feature-start': null, retrigger: 'vo-grunt',
  'win-big': 'vo-grunt', 'win-mega': 'vo-grunt', 'win-super': 'vo-laugh', 'win-legend': 'vo-laugh', 'win-max': 'vo-laugh',
  laugh: 'vo-laugh', nice: 'vo-hum', 'feature-end': 'vo-hum',
});

/** Priority of a line when two would overlap (higher replaces lower; equal or lower is skipped). */
export const STORM_VOICE_PRIORITY: Readonly<Record<StormVoiceLine, number>> = Object.freeze({
  'x2-9': 2, x10: 4, x25: 5, x50: 6, x100: 7, x250: 8, x500: 9,
  'scatter-tease': 5, 'feature-trigger': 7, 'feature-start': 6, retrigger: 6,
  'win-big': 6, 'win-mega': 7, 'win-super': 8, 'win-legend': 9, 'win-max': 10,
  laugh: 3, nice: 1, 'feature-end': 6,
});

/**
 * One voice at a time: play when nothing is speaking (or the current line is about to end), replace a
 * lower-priority line, otherwise skip the new one.
 */
export function voiceDecision(current: { line: StormVoiceLine; until: number } | null, next: StormVoiceLine, now: number, tolerance = 0.15): 'play' | 'replace' | 'skip' {
  if (!current || current.until - now <= tolerance) return 'play';
  return STORM_VOICE_PRIORITY[next] > STORM_VOICE_PRIORITY[current.line] ? 'replace' : 'skip';
}

/**
 * URL per line. A string is a folder (`/audio/voice/storm` → `/audio/voice/storm/x2-9.mp3`); an object
 * names files per line (missing or blank entries mean no line).
 */
export function stormVoiceBankUrls(spec: string | Partial<Record<StormVoiceLine, string | null>>, ext = 'mp3'): Record<StormVoiceLine, string | null> {
  const out = {} as Record<StormVoiceLine, string | null>;
  for (const line of STORM_VOICE_LINES) {
    if (typeof spec === 'string') out[line] = spec.trim() ? versionedVoiceUrl(`${spec.trim().replace(/\/+$/, '')}/${line}.${ext}`) : null;
    else { const u = spec[line]; out[line] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/** Load every line; a failure of any kind (missing file, network, decode) leaves that line null, silently. Never rejects. */
export async function loadStormVoiceBank<T>(urls: Record<StormVoiceLine, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<StormVoiceLine, T | null>> {
  const entries = await Promise.all(STORM_VOICE_LINES.map(async line => {
    const url = urls[line];
    if (!url) return [line, null] as const;
    try { return [line, (await load(url)) ?? null] as const; } catch { return [line, null] as const; }
  }));
  return new Map(entries);
}

/** Tonic (MIDI) of the Tarhun base key: A (A Hicaz). Celebration tiers climb from here by TIER_KEY. */
export const STORM_TONIC = 57;
