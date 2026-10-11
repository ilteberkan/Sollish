/** Ringside match ledger (Contact 5): one betting window before round 1, one ticket per market for the
 * whole bout (up to three rounds), settled once when the bout ends. Every round seed is drawn and its
 * hash published before the window opens, so later rounds cannot be re-drawn after tickets are known.
 * Pools stay separate: each market settles only from its own escrow (settlePariMutuelPool).
 */
import type { ContactInitial } from './combat-v3';
import type { PlanEntry } from './corner-plan';
import { sha256Utf8Hex } from './fight-style';

export const MATCH_LEDGER = 'ringside-match-1' as const;
export const MATCH_OPEN_MS = 30_000;
export const MATCH_ROUNDS = 3;
export const MATCH_MARKETS = [
  { id: 'match-winner', label: 'Kazanan', outcomes: ['kor', 'draw', 'ayaz'], labels: ['KOR kazanır', 'Berabere', 'AYAZ kazanır'] },
  { id: 'match-method', label: 'Tam sonuç', outcomes: ['kor-stop', 'kor-points', 'draw', 'ayaz-points', 'ayaz-stop'], labels: ['KOR durdurmayla', 'KOR puanla', 'Berabere', 'AYAZ puanla', 'AYAZ durdurmayla'] },
  { id: 'match-knockdowns', label: 'Yere düşme', outcomes: ['0-1', '2', '3-plus'], labels: ['0–1 yere düşme', '2 yere düşme', '3+ yere düşme'] },
] as const;
export type MatchMarket = typeof MATCH_MARKETS[number]['id'];
export type MatchResults = Record<MatchMarket, string>;
/** A finished earlier round of the current bout: everything a browser needs to replay and check it. */
export type MatchRoundRecord = { id: string; seed: string; initial: ContactInitial; plans: PlanEntry[] };
export type RingMatch = { ledger: typeof MATCH_LEDGER; openedAt: number; closesAt: number; seedHashes: string[]; previous: MatchRoundRecord[]; results: MatchResults | null };
export type RoundOutcome = { winner: string; finish: string; knockdowns: number };
/** What a finished round contributes to the match: its winner, how it ended and its knockdown count. */
export const roundOutcome = (r: { winner: string; finish: string; events: readonly { type: string }[] }): RoundOutcome => ({ winner: r.winner, finish: r.finish, knockdowns: r.events.filter(e => e.type === 'knockdown').length });

/** Binds round n's seed to its bout before any ticket exists. */
export const matchSeedHash = (boutId: string, round: number, seed: string) => sha256Utf8Hex(`sollish:${MATCH_LEDGER}:seed:${boutId}:${round}:${seed}`);
/** The bout ends at a stoppage or after the third round. */
export const matchComplete = (rounds: readonly RoundOutcome[]) => rounds.length >= MATCH_ROUNDS || rounds.at(-1)?.finish === 'stoppage';
/** Rounds won decide a bout that goes the distance; equal rounds are a draw. A stoppage wins outright. */
export function matchResults(rounds: readonly RoundOutcome[]): MatchResults {
  const last = rounds.at(-1);
  if (!last || !matchComplete(rounds)) throw new Error('MATCH_NOT_COMPLETE');
  const won = (id: string) => rounds.filter(r => r.winner === id).length;
  const stopped = last.finish === 'stoppage' && (last.winner === 'kor' || last.winner === 'ayaz');
  const winner = stopped ? last.winner : won('kor') > won('ayaz') ? 'kor' : won('ayaz') > won('kor') ? 'ayaz' : 'draw';
  return {
    'match-winner': winner,
    'match-method': winner === 'draw' ? 'draw' : `${winner}-${stopped ? 'stop' : 'points'}`,
    'match-knockdowns': ((n: number) => n <= 1 ? '0-1' : n === 2 ? '2' : '3-plus')(rounds.reduce((s, r) => s + r.knockdowns, 0)),
  };
}
/** Next round's opening state: health +250 and stamina +350, capped at 1000. */
export const carryInitial = (last: { kor: { health: number; stamina: number }; ayaz: { health: number; stamina: number } }): ContactInitial => ({
  health: { kor: Math.min(1000, last.kor.health + 250), ayaz: Math.min(1000, last.ayaz.health + 250) },
  stamina: { kor: Math.min(1000, last.kor.stamina + 350), ayaz: Math.min(1000, last.ayaz.stamina + 350) },
});
