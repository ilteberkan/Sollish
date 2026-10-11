/** Integer-only pool accounting, not custody, result authentication or a payment instruction.
 * The caller must freeze the admitted ticket set/fee before revealing the result and atomically
 * debit each stake into this pool's own escrow. One pool cannot borrow another pool's reserve.
 */
export const PARI_MUTUEL_BPS = 10_000n;
export const PARI_MUTUEL_MAX_AMOUNT = (1n << 64n) - 1n;
export type PariMutuelTicket = Readonly<{ ticketId: string; outcome: string; stake: bigint }>;
export type PariMutuelPool = Readonly<{
  poolId: string;
  outcomes: readonly string[];
  feeBps: bigint;
  /** Recorded escrow principal, excluding rent, donations, unrelated pools and existing fees. */
  escrowAmount: bigint;
  tickets: readonly PariMutuelTicket[];
  /** Exactly one declared outcome, or null for a void. Dead heats need a separate declared outcome. */
  winningOutcome: string | null;
}>;
export type PariMutuelRefundReason = "void" | "empty" | "one-sided" | "no-winners";
export type PariMutuelPayout = Readonly<{ ticketId: string; stake: bigint; payout: bigint }>;
export type PariMutuelSettlement = Readonly<{
  poolId: string;
  status: "paid" | "refunded";
  refundReason: PariMutuelRefundReason | null;
  stakeTotal: bigint;
  platformFee: bigint;
  payoutTotal: bigint;
  /** Canonical ASCII ticket ID order; winners' payouts include their returned principal. */
  payouts: readonly PariMutuelPayout[];
}>;
export type PariMutuelBatchSettlement = Readonly<{
  /** Sum of separately validated reserves. These are not interchangeable claim balances. */
  escrowTotal: bigint;
  platformFeeTotal: bigint;
  payoutTotal: bigint;
  pools: readonly PariMutuelSettlement[];
}>;

function amount(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > PARI_MUTUEL_MAX_AMOUNT) throw new RangeError("Amount must be an unsigned u64 BigInt");
  return value;
}
function add(a: bigint, b: bigint): bigint { return amount(a + b); }
function identifier(value: string): void {
  // Locale-independent ordering and bounded IDs; no Unicode normalization or case-fold aliases.
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new RangeError("Invalid pool, outcome or ticket ID");
}
function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Fee is floor(gross pool * feeBps / 10_000), once per pool, and zero on every refund.
 * Net pool is apportioned by winning stake using largest remainders; equal remainders use
 * ascending ASCII ticketId, independent of input/database order. There is no retained dust.
 * A heavily backed winner can receive less than its stake after the fee; no minimum multiplier
 * or operator profit is guaranteed. Ticket splitting can affect the last base unit: enforce
 * admission limits outside this pure function, rather than claiming this is Sybil resistance.
 *
 * Pool concept: https://help.tote.co.uk/en/articles/8899571-what-is-pools-betting
 * Remainder allocation: https://www.census.gov/about/history/historical-censuses-and-surveys/census-programs-surveys/decennial-census/methods.html
 * Refund/tie-break rules here are explicit Sollish design choices, not copied Tote rules.
 */
export function settlePariMutuelPool(pool: PariMutuelPool): PariMutuelSettlement {
  identifier(pool.poolId);
  if (typeof pool.feeBps !== "bigint" || pool.feeBps < 0n || pool.feeBps >= PARI_MUTUEL_BPS) throw new RangeError("Invalid pool fee");
  amount(pool.escrowAmount);
  if (!Array.isArray(pool.outcomes) || pool.outcomes.length < 2 || !Array.isArray(pool.tickets)) throw new RangeError("Invalid pool outcomes or tickets");
  const outcomes = new Set<string>();
  for (const outcome of pool.outcomes) {
    identifier(outcome);
    if (outcomes.has(outcome)) throw new RangeError("Duplicate outcome ID");
    outcomes.add(outcome);
  }
  if (pool.winningOutcome !== null && !outcomes.has(pool.winningOutcome)) throw new RangeError("Unknown winning outcome");
  const ticketIds = new Set<string>();
  const backedOutcomes = new Set<string>();
  let stakeTotal = 0n, winningStake = 0n;
  const tickets = Array.from(pool.tickets, ticket => {
    if (!ticket || typeof ticket !== "object") throw new RangeError("Invalid ticket");
    identifier(ticket.ticketId);
    if (ticketIds.has(ticket.ticketId)) throw new RangeError("Duplicate ticket ID");
    ticketIds.add(ticket.ticketId);
    if (!outcomes.has(ticket.outcome)) throw new RangeError("Unknown ticket outcome");
    const stake = amount(ticket.stake);
    if (stake === 0n) throw new RangeError("Stake must be positive");
    stakeTotal = add(stakeTotal, stake);
    backedOutcomes.add(ticket.outcome);
    if (ticket.outcome === pool.winningOutcome) winningStake = add(winningStake, stake);
    return { ticketId: ticket.ticketId, outcome: ticket.outcome, stake };
  }).sort((a, b) => compareId(a.ticketId, b.ticketId));
  if (pool.escrowAmount !== stakeTotal) throw new RangeError("Pool escrow must equal its recorded stakes");
  const refundReason: PariMutuelRefundReason | null = pool.winningOutcome === null ? "void"
    : tickets.length === 0 ? "empty" : backedOutcomes.size < 2 ? "one-sided" : winningStake === 0n ? "no-winners" : null;
  const platformFee = refundReason === null ? stakeTotal * pool.feeBps / PARI_MUTUEL_BPS : 0n;
  const distributable = stakeTotal - platformFee;
  const payouts = tickets.map(ticket => ({ ticketId: ticket.ticketId, stake: ticket.stake, payout: refundReason === null ? 0n : ticket.stake }));
  if (refundReason === null) {
    let floorTotal = 0n;
    const winners = tickets.flatMap((ticket, index) => {
      if (ticket.outcome !== pool.winningOutcome) return [];
      // BigInt preserves this u64*u64 intermediate exactly; never convert money to Number.
      const numerator = distributable * ticket.stake;
      const floor = numerator / winningStake;
      payouts[index].payout = floor;
      floorTotal = add(floorTotal, floor);
      return [{ index, ticketId: ticket.ticketId, remainder: numerator % winningStake }];
    }).sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : compareId(a.ticketId, b.ticketId));
    let residual = distributable - floorTotal;
    // Sum of fractional parts is strictly less than the number of winners.
    if (residual >= BigInt(winners.length)) throw new RangeError("Invalid payout remainder");
    for (const winner of winners) {
      if (residual === 0n) break;
      payouts[winner.index].payout += 1n;
      residual -= 1n;
    }
  }
  const payoutTotal = payouts.reduce((sum, payout) => add(sum, payout.payout), 0n);
  if (add(platformFee, payoutTotal) !== stakeTotal) throw new RangeError("Pool conservation failed");
  return Object.freeze({ poolId: pool.poolId, status: refundReason === null ? "paid" : "refunded", refundReason, stakeTotal, platformFee, payoutTotal,
    payouts: Object.freeze(payouts.map(payout => Object.freeze(payout))) });
}

/** Multiple props remain independent even when their outcomes are correlated. All amounts must
 * use the same asset/base unit. A ticket's identity is (poolId,ticketId); repeated local IDs in
 * different pools are distinct tickets. Duplicate pool IDs or ticket IDs within a pool fail.
 * The caller must commit the whole batch and its fee ledger atomically and at most once.
 */
export function settlePariMutuelPools(pools: readonly PariMutuelPool[]): PariMutuelBatchSettlement {
  if (!Array.isArray(pools)) throw new RangeError("Invalid pools");
  const ids = new Set<string>();
  let escrowTotal = 0n, platformFeeTotal = 0n, payoutTotal = 0n;
  const settled = Array.from(pools, pool => {
    if (!pool || typeof pool !== "object") throw new RangeError("Invalid pool");
    identifier(pool.poolId);
    if (ids.has(pool.poolId)) throw new RangeError("Duplicate pool ID");
    ids.add(pool.poolId);
    const result = settlePariMutuelPool(pool);
    escrowTotal = add(escrowTotal, result.stakeTotal);
    platformFeeTotal = add(platformFeeTotal, result.platformFee);
    payoutTotal = add(payoutTotal, result.payoutTotal);
    return result;
  }).sort((a, b) => compareId(a.poolId, b.poolId));
  if (add(platformFeeTotal, payoutTotal) !== escrowTotal) throw new RangeError("Batch conservation failed");
  return Object.freeze({ escrowTotal, platformFeeTotal, payoutTotal, pools: Object.freeze(settled) });
}
