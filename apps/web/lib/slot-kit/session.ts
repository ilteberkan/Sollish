/**
 * Responsible-play session helpers: wall-clock session duration, net result and the periodic
 * reality-check schedule. Pure functions on timestamps (ms); callers pass `Date.now()`.
 * Wall-clock time is intentional: a hidden tab or a sleeping laptop still counts as session time.
 */

export const DEFAULT_REALITY_INTERVAL_MS = 30 * 60 * 1000;
const MIN_REALITY_INTERVAL_MS = 1000;

export interface SessionState {
  readonly startedAtMs: number;
  readonly spentCents: number;
  readonly wonCents: number;
  readonly rounds: number;
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function createSession(startedAtMs: number): SessionState {
  if (!isTime(startedAtMs)) throw new RangeError('Başlangıç zamanı geçersiz');
  return Object.freeze({ startedAtMs, spentCents: 0, wonCents: 0, rounds: 0 });
}

export function recordSessionRound(session: SessionState, round: { costCents: number; payoutCents: number }): SessionState {
  if (!isCents(round.costCents) || !isCents(round.payoutCents)) throw new RangeError('Tur kaydı geçersiz');
  const spent = session.spentCents + round.costCents;
  const won = session.wonCents + round.payoutCents;
  if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(won)) throw new RangeError('Oturum toplamı çok büyük');
  return Object.freeze({ ...session, spentCents: spent, wonCents: won, rounds: session.rounds + 1 });
}

/** Never negative, even if the system clock moves back. */
export function sessionElapsedMs(session: SessionState, nowMs: number): number {
  return Math.max(0, nowMs - session.startedAtMs);
}

/** Won minus spent since the session began (refills of the DEMO balance are not counted). */
export function sessionNetCents(session: SessionState): number {
  return session.wonCents - session.spentCents;
}

export interface RealityCheckState {
  readonly intervalMs: number;
  readonly nextDueAtMs: number;
  /** How many reminders the player has already answered. */
  readonly acknowledged: number;
}

export function createRealityCheck(startedAtMs: number, intervalMs: number = DEFAULT_REALITY_INTERVAL_MS): RealityCheckState {
  if (!isTime(startedAtMs)) throw new RangeError('Başlangıç zamanı geçersiz');
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_REALITY_INTERVAL_MS) throw new RangeError('Hatırlatma aralığı en az 1 saniye olmalı');
  return Object.freeze({ intervalMs, nextDueAtMs: startedAtMs + intervalMs, acknowledged: 0 });
}

export function realityCheckDue(check: RealityCheckState, nowMs: number): boolean {
  return nowMs >= check.nextDueAtMs;
}

export function msUntilRealityCheck(check: RealityCheckState, nowMs: number): number {
  return Math.min(check.intervalMs, Math.max(0, check.nextDueAtMs - nowMs));
}

/** Player pressed Devam: the next reminder is one full interval from now (no pile-up after sleep). */
export function acknowledgeRealityCheck(check: RealityCheckState, nowMs: number): RealityCheckState {
  if (!isTime(nowMs)) throw new RangeError('Zaman geçersiz');
  return Object.freeze({ ...check, nextDueAtMs: nowMs + check.intervalMs, acknowledged: check.acknowledged + 1 });
}

/** If the system clock jumped back, pull a too-distant schedule in so a reminder cannot be skipped. */
export function rebaseRealityCheck(check: RealityCheckState, nowMs: number): RealityCheckState {
  if (check.nextDueAtMs - nowMs <= check.intervalMs) return check;
  return Object.freeze({ ...check, nextDueAtMs: nowMs + check.intervalMs });
}

const two = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" wall clock. `utcOffsetMinutes` is for tests; omitted means the device's local time. */
export function formatClock(nowMs: number, utcOffsetMinutes?: number): string {
  if (!Number.isFinite(nowMs)) return '--:--';
  if (utcOffsetMinutes === undefined) {
    const d = new Date(nowMs);
    return `${two(d.getHours())}:${two(d.getMinutes())}`;
  }
  const d = new Date(nowMs + utcOffsetMinutes * 60_000);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** 45 sn · 12 dk · 1 sa 05 dk. */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} sa ${two(minutes)} dk`;
  if (minutes > 0) return `${minutes} dk`;
  return `${total} sn`;
}
