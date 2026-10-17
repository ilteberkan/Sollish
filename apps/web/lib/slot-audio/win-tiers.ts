/**
 * Pure logic for win-tier and multiplier sounds: tier and callout class mapping, the key ladder, tier-up
 * transition timing and the optional voice-line bank. No Web Audio here, so it is unit tested in Node.
 * Presentation only: tiers are derived from an already-settled win; nothing here feeds back into a result.
 */
import { versionedVoiceUrl } from './voice-version';

/** Win tiers (round total ÷ base bet, game-standards §6): 1 Büyük ≥10×, 2 Mega ≥25×, 3 Süper ≥50×, 4 Efsane ≥100×. */
export type WinTier = 1 | 2 | 3 | 4;
export const WIN_TIERS: readonly WinTier[] = [1, 2, 3, 4];
export const WIN_TIER_THRESHOLDS: Readonly<Record<WinTier, number>> = Object.freeze({ 1: 10, 2: 25, 3: 50, 4: 100 });
export const WIN_TIER_NAMES: Readonly<Record<WinTier, string>> = Object.freeze({ 1: 'Büyük', 2: 'Mega', 3: 'Süper', 4: 'Efsane' });

/** Tier for a win multiple, 0 below the first tier. Non-finite input is 0. */
export function winTierFor(multiple: number): 0 | WinTier {
  if (!Number.isFinite(multiple)) return 0;
  for (const t of [4, 3, 2, 1] as const) if (multiple >= WIN_TIER_THRESHOLDS[t]) return t;
  return 0;
}

/** Clamp any caller value to a tier (older callers pass 1..3; anything above 4 is the top tier). */
export const toWinTier = (tier: number): WinTier => (Number.isFinite(tier) ? (Math.max(1, Math.min(4, Math.round(tier))) as WinTier) : 1);

/**
 * Key ladder of the celebration music, in semitones above the base key (F major): every tier modulates
 * upward (F → G → A → C) and max win lands highest (D major). Shared by the scores and the runtime.
 */
export const TIER_KEY: Readonly<Record<WinTier | 'max', number>> = Object.freeze({ 1: 0, 2: 2, 3: 4, 4: 7, max: 9 });

/** Celebration tempo (big-win heads, beds, transitions): one beat = 0.5 s. */
export const CELEBRATION_BPM = 120;

/** Tier-up transition clips: the whoosh runs for this long before the hit inside the clip (seconds). */
export const TIER_UP_PRE = 0.4;

/**
 * Timing of a tier-up "whoosh + hit". The hit lands on the next beat of the playing celebration grid (bed or
 * stinger) at least `minLead` seconds ahead, so the new bed or stinger starts on the pulse. The clip starts
 * `pre` seconds before the hit; when that is already in the past it starts now, `clipOffset` seconds into
 * the whoosh, so the hit still lands exactly on the beat. Without a grid the hit is as soon as possible.
 */
export function planTierUp(now: number, grid: { start: number; bpm: number } | null, pre = TIER_UP_PRE, minLead = 0.12): { hitAt: number; clipAt: number; clipOffset: number } {
  const earliest = now + Math.max(0, minLead);
  let hitAt = earliest;
  if (grid && grid.bpm > 0) {
    const beat = 60 / grid.bpm;
    hitAt = grid.start + Math.ceil((earliest - grid.start) / beat - 1e-9) * beat;
    if (hitAt < earliest - 1e-9) hitAt = earliest; // grid in the future: never earlier than the lead
  }
  const clipAt = Math.max(now, hitAt - pre);
  return { hitAt, clipAt, clipOffset: Math.max(0, pre - (hitAt - clipAt)) };
}

/** What a bigWin(tier) call does: start a celebration, climb to a higher tier, or ignore a repeat. */
export function tierAction(current: 0 | WinTier, requested: WinTier, active: boolean): 'start' | 'up' | 'ignore' {
  if (!active || current === 0) return 'start';
  if (requested > current) return 'up';
  if (requested === current) return 'ignore';
  return 'start'; // a lower tier while active can only be a new round: start over
}

/* ---------------- multiplier callouts ---------------- */

/** Applied-multiplier callout classes, named by their lower bound. 'x250' is reserved for the next game. */
export type MultiplierClass = 'x2' | 'x10' | 'x25' | 'x50' | 'x100' | 'x250';
export const MULTIPLIER_CLASSES: readonly MultiplierClass[] = ['x2', 'x10', 'x25', 'x50', 'x100', 'x250'];
export const MULTIPLIER_CLASS_MIN: Readonly<Record<MultiplierClass, number>> = Object.freeze({ x2: 0, x10: 10, x25: 25, x50: 50, x100: 100, x250: 250 });

/** Class of an applied multiplier: <10× → x2, ≥10× → x10, ≥25× → x25, ≥50× → x50, ≥100× → x100, ≥250× → x250. */
export function multiplierClass(value: number): MultiplierClass {
  if (!Number.isFinite(value)) return 'x2';
  for (let i = MULTIPLIER_CLASSES.length - 1; i > 0; i--) { const c = MULTIPLIER_CLASSES[i]!; if (value >= MULTIPLIER_CLASS_MIN[c]) return c; }
  return 'x2';
}

/** Rank 0..5 of a class (for scaling ducks and fallbacks). */
export const multiplierRank = (c: MultiplierClass) => MULTIPLIER_CLASSES.indexOf(c);

/* ---------------- voice bank ---------------- */

/** Voice lines start this long after the callout's impact, so the hit stays clean. */
export const VOICE_DELAY = 0.12;
/** Music is lowered this much while a voice line plays. */
export const VOICE_DUCK_DB = 8;

/**
 * Voice-line URLs per class. A string is a folder (`/audio/voice/cascade` → `/audio/voice/cascade/x100.mp3`);
 * an object names files per class (missing or empty entries mean no line for that class).
 */
export function voiceBankUrls(spec: string | Partial<Record<MultiplierClass, string | null>>, ext = 'mp3'): Record<MultiplierClass, string | null> {
  const out = {} as Record<MultiplierClass, string | null>;
  for (const c of MULTIPLIER_CLASSES) {
    if (typeof spec === 'string') out[c] = spec.trim() ? versionedVoiceUrl(`${spec.replace(/\/+$/, '')}/${c}.${ext}`) : null;
    else { const u = spec[c]; out[c] = typeof u === 'string' && u.trim() ? u : null; }
  }
  return out;
}

/**
 * Load every voice line with `load`; any failure (missing file, network, decode) leaves that class null,
 * silently. Never rejects.
 */
export async function loadVoiceBank<T>(urls: Record<MultiplierClass, string | null>, load: (url: string) => Promise<T | null>): Promise<Map<MultiplierClass, T | null>> {
  const entries = await Promise.all(MULTIPLIER_CLASSES.map(async c => {
    const url = urls[c];
    if (!url) return [c, null] as const;
    try { return [c, (await load(url)) ?? null] as const; } catch { return [c, null] as const; }
  }));
  return new Map(entries);
}
