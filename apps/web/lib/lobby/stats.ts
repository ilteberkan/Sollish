/**
 * Lobby tile facts (RTP, max win, volatility) without importing any engine. The slot values are literal copies of the
 * standard-mode rows of each engine's evidence constant (CASCADE2_RTP, STORM_RTP, EBRU_RTP, CEZERI_RTP, ASENA_RTP, GOREME_RTP, from
 * ops/evidence/<game>-2026101x/rtp.json); max win comes from the engine-free SLOT_GAME_META. tests/lobby.test.ts fails
 * when a copy drifts from its engine, the same rule as SLOT_GAME_META. Simulated DEMO estimates, not certified RTPs.
 */
import { SLOT_GAME_META } from '@sollish/protocol';
import type { LobbyGameId } from './games';

/** Standard mode: return / cost and the standard deviation of the per-round return in cost units. */
export const SLOT_STANDARD_RTP = Object.freeze({
  cascade: Object.freeze({ rtp: 0.957, stdDev: 13.874 }),
  tarhun: Object.freeze({ rtp: 0.965, stdDev: 12.709 }),
  ebru: Object.freeze({ rtp: 0.957, stdDev: 22.114 }),
  cezeri: Object.freeze({ rtp: 0.955, stdDev: 12.445 }),
  asena: Object.freeze({ rtp: 0.952, stdDev: 21.369 }),
  goreme: Object.freeze({ rtp: 0.963, stdDev: 28.138 }),
});

/** Local DEMO practice: Crash pays the chosen target while crash point = 0.98 / (1 − u) (lib/demo.ts sampleCrash, cap
 * ×50), so P(reach m) · m = 0.98 for every target; Coinflip pays ×1.96 at 50 %. The standard deviation of a ×1.96
 * coin is 0.98 cost units. Crash volatility depends on the target the player picks. */
export const CRASH_DEMO = Object.freeze({ rtp: 0.98, maxMultiplier: 50 });
export const COINFLIP_DEMO = Object.freeze({ rtp: 0.98, maxMultiplier: 1.96, stdDev: 0.98 });
/** Damla (instant drop game): every mode has its own exact RTP (DAMLA_EXACT_RTP, 98.45–98.56 %); the tile shows the lowest
 * (medium-12, the default mode). Volatility is the player's choice (risk and terraces). Max win = the registry cap (high-16). */
export const DAMLA_LOBBY = Object.freeze({ rtp: 0.984467773 });
/** Ringside pools: integer pari-mutuel, 2 % fee per settled pool, refunds without fee. No fixed RTP or max win. */
export const RINGSIDE_POOL_FEE = 0.02;

export type Volatility = 'low' | 'medium' | 'high' | 'veryHigh' | 'player';
/** Bands on the standard deviation of one round's return in cost units (evidence `stdDev`). */
export function volatilityOf(stdDev: number): Exclude<Volatility, 'player'> {
  if (stdDev < 3) return 'low';
  if (stdDev < 10) return 'medium';
  if (stdDev < 18) return 'high';
  return 'veryHigh';
}

export interface LobbyStats {
  /** Return to player as a ratio (0.965), or null when the game has none (pool betting). */
  rtp: number | null;
  /** Max win as a multiple of the bet, or null. */
  maxWin: number | null;
  volatility: Volatility | null;
  /** Pool fee as a ratio (Ringside only). */
  poolFee: number | null;
}

export function lobbyStats(id: LobbyGameId): LobbyStats {
  switch (id) {
    case 'crash': return { rtp: CRASH_DEMO.rtp, maxWin: CRASH_DEMO.maxMultiplier, volatility: 'player', poolFee: null };
    case 'coinflip': return { rtp: COINFLIP_DEMO.rtp, maxWin: COINFLIP_DEMO.maxMultiplier, volatility: volatilityOf(COINFLIP_DEMO.stdDev), poolFee: null };
    case 'ringside': return { rtp: null, maxWin: null, volatility: null, poolFee: RINGSIDE_POOL_FEE };
    case 'damla': return { rtp: DAMLA_LOBBY.rtp, maxWin: SLOT_GAME_META.damla.maxMultiplier, volatility: 'player', poolFee: null };
    default: {
      const row = SLOT_STANDARD_RTP[id];
      return { rtp: row.rtp, maxWin: SLOT_GAME_META[id].maxMultiplier, volatility: volatilityOf(row.stdDev), poolFee: null };
    }
  }
}
