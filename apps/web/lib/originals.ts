/**
 * "Sollish Originals" game-page template (Coinflip, Crash, Damla): pure helpers for the shared bet panel. Integer cents
 * and integer hundredths only; nothing here reads a round, a seed or the ledger. Presentation helpers can never change a
 * result: ½ / 2× only rewrite the bet the player is about to place, inside the same limits the game already enforces.
 */
import { LOBBY_GAMES, type LobbyGame } from './lobby/games';

/** The Originals row: the in-house instant games (registry kind `instant`), in registry order. */
export function originalsGames(): LobbyGame[] {
  return LOBBY_GAMES.filter(g => g.kind === 'instant');
}

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** ½: half of the bet, floored to a cent, never below the table minimum. An unreadable bet becomes the minimum. */
export function halveCents(cents: number | null, minCents: number): number {
  if (!isCents(cents) || cents < minCents) return minCents;
  return Math.max(minCents, Math.floor(cents / 2));
}

/** 2×: double the bet, never above `maxCents` (table maximum or what the balance allows) and never below the minimum. */
export function doubleCents(cents: number | null, minCents: number, maxCents: number): number {
  const cap = Math.max(minCents, maxCents);
  if (!isCents(cents) || cents < minCents) return Math.min(cap, minCents * 2);
  return Math.min(cap, cents * 2);
}

/** Cents as the text a player would type: "12", "12,5" → "12,50", with the locale's decimal sign. */
export function centsToInput(cents: number, decimal = ','): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return fraction === '00' ? String(whole) : `${whole}${decimal}${fraction}`;
}

/** ½ on a fixed bet ladder: the largest level ≤ half the bet (or the lowest level). */
export function ladderHalf(ladder: readonly number[], cents: number): number {
  const target = Math.floor(cents / 2);
  let best = ladder[0]!;
  for (const level of ladder) if (level <= target) best = level;
  return best;
}

/** 2× on a fixed bet ladder: the smallest level ≥ twice the bet, capped at `maxCents` (the highest allowed level). */
export function ladderDouble(ladder: readonly number[], cents: number, maxCents: number): number {
  const allowed = ladder.filter(level => level <= maxCents);
  if (allowed.length === 0) return ladder[0]!;
  const target = cents * 2;
  return allowed.find(level => level >= target) ?? allowed[allowed.length - 1]!;
}

/* ------------------------------------------------------------------ Crash cash-out target */
/** Local Crash practice: the crash point is capped at ×50 (lib/demo.ts sampleCrash), so a target above it never pays. */
export const CRASH_TARGET_MIN_HUNDREDTHS = 101;
export const CRASH_TARGET_MAX_HUNDREDTHS = 5000;
export const CRASH_TARGET_PRESETS = [150, 200, 500, 1000] as const;

/** "2", "2,5", "2.50", "2,50×" → 250 (hundredths); anything else, or outside 1,01–50,00, → null. Empty → null. */
export function parseCrashTarget(text: string): number | null {
  const normalized = text.trim().replace(/[×x]$/i, '').trim().replace(',', '.');
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return hundredths >= CRASH_TARGET_MIN_HUNDREDTHS && hundredths <= CRASH_TARGET_MAX_HUNDREDTHS ? hundredths : null;
}

/**
 * Outcome of a round with an automatic cash-out target, decided by the crash point alone (never by frame timing): the
 * curve reaches the target before it crashes exactly when point ≥ target, and then the payout is the target.
 * Without a target the round is decided by the player's manual cash-out.
 */
export function crashTargetOutcome(pointHundredths: number, targetHundredths: number): { cashout: boolean; hundredths: number } {
  return pointHundredths >= targetHundredths ? { cashout: true, hundredths: targetHundredths } : { cashout: false, hundredths: pointHundredths };
}

/** Net profit of a win at `hundredths` (gross − stake), integer cents, floored like the ledger's gross payout. */
export function profitCents(stakeCents: number, hundredths: number): number {
  if (!isCents(stakeCents) || !Number.isSafeInteger(hundredths) || hundredths < 0) return 0;
  return Number(BigInt(stakeCents) * BigInt(hundredths) / 100n) - stakeCents;
}
