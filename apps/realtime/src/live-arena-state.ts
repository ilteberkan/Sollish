import { LIVE_BET_WINDOW_MS, canAcceptLiveBet, type LivePublicRound, type LiveSide, type LiveTicket, type LiveArenaErrorCode, type LiveServerFrame } from '@sollish/protocol';

/** Anonymous, resettable practice credits. This is not a wallet, token or VRF game. */
export const LIVE_INITIAL_CENTS = 100_000;
export const LIVE_SESSION_MS = 60 * 60 * 1000;
export const LIVE_FIGHT_MS = 8_800;
export const LIVE_RESULT_MS = 4_000;
export const LIVE_MAX_SESSIONS = 512;
export const LIVE_MAX_TICKETS_PER_SESSION = 256;
export const LIVE_MAX_TICKETS_PER_ROUND = 256;
export type ArenaTicket = LiveTicket;
export type ArenaSession = { balanceCents: number; expiresAtMs: number };
export type ArenaErrorCode = LiveArenaErrorCode;
export class ArenaError extends Error { constructor(readonly code: ArenaErrorCode) { super(code); } }

const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER - LIVE_SESSION_MS;
export function openRound(previous: LivePublicRound | null, now: number): LivePublicRound {
  if (!validTime(now)) throw new ArenaError('SERVICE_UNAVAILABLE');
  return { roundId: previous ? (BigInt(previous.roundId) + 1n).toString() : '1', version: (previous?.version ?? 0) + 1, phase: 'open', openedAtMs: now, closesAtMs: now + LIVE_BET_WINDOW_MS, fightStartedAtMs: null, resultAtMs: null, nextRoundAtMs: null, winner: null };
}
export function closeRound(round: LivePublicRound, now: number): LivePublicRound {
  if (round.phase !== 'open' || now < round.closesAtMs) throw new ArenaError('ROUND_CLOSED');
  return { ...round, phase: 'closed', version: round.version + 1 };
}
export function startFight(round: LivePublicRound, now: number, winner: LiveSide): LivePublicRound {
  if (round.phase !== 'closed' || !validTime(now) || now < round.closesAtMs || (winner !== 'kor' && winner !== 'ayaz')) throw new ArenaError('SERVICE_UNAVAILABLE');
  return { ...round, version: round.version + 1, phase: 'fighting', fightStartedAtMs: now, resultAtMs: now + LIVE_FIGHT_MS, nextRoundAtMs: now + LIVE_FIGHT_MS + LIVE_RESULT_MS, winner };
}
export function finishRound(round: LivePublicRound, now: number): LivePublicRound {
  if (round.phase !== 'fighting' || round.resultAtMs === null || now < round.resultAtMs || !round.winner) throw new ArenaError('SERVICE_UNAVAILABLE');
  return { ...round, version: round.version + 1, phase: 'result' };
}
export function admitTicket(round: LivePublicRound, session: ArenaSession, command: Omit<ArenaTicket, 'status' | 'payoutCents'>, now: number, existing: ArenaTicket | null, alreadyBet: boolean): { duplicate: boolean; ticket: ArenaTicket; balanceCents: number } {
  if (!Number.isSafeInteger(session.balanceCents) || session.balanceCents < 0 || !validTime(now)) throw new ArenaError('SERVICE_UNAVAILABLE');
  if (now >= session.expiresAtMs) throw new ArenaError('SESSION_EXPIRED');
  // Retry returns the original receipt even after cutoff; it can never reserve again.
  if (existing) {
    if (existing.roundId !== command.roundId || existing.side !== command.side || existing.amountCents !== command.amountCents) throw new ArenaError('TICKET_CONFLICT');
    return { duplicate: true, ticket: { ...existing }, balanceCents: session.balanceCents };
  }
  if (command.roundId !== round.roundId) throw new ArenaError('WRONG_ROUND');
  if (!canAcceptLiveBet(round, now)) throw new ArenaError('ROUND_CLOSED');
  if (alreadyBet) throw new ArenaError('ALREADY_BET');
  if (!Number.isSafeInteger(command.amountCents) || command.amountCents < 100 || command.amountCents > 50_000 || (command.side !== 'kor' && command.side !== 'ayaz')) throw new ArenaError('INVALID_MESSAGE');
  if (session.balanceCents < command.amountCents) throw new ArenaError('INSUFFICIENT_CREDITS');
  return { duplicate: false, ticket: { clientId: command.clientId, roundId: command.roundId, side: command.side, amountCents: command.amountCents, status: 'accepted', payoutCents: 0 }, balanceCents: session.balanceCents - command.amountCents };
}
export function settleTicket(ticket: ArenaTicket, winner: LiveSide, balanceCents: number): { ticket: ArenaTicket; balanceCents: number } {
  if (ticket.status === 'settled') return { ticket: { ...ticket }, balanceCents };
  const payoutCents = ticket.side === winner ? Math.floor(ticket.amountCents * 196 / 100) : 0;
  const balance = balanceCents + payoutCents;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new ArenaError('SERVICE_UNAVAILABLE');
  return { ticket: { ...ticket, status: 'settled', payoutCents }, balanceCents: balance };
}

/** Complete snapshots contain no session identity, token or pre-cutoff result. */
export type LiveArenaServerFrame = LiveServerFrame;
