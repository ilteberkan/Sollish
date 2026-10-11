import test from "node:test";
import assert from "node:assert/strict";
import { PARI_MUTUEL_MAX_AMOUNT, settlePariMutuelPool, settlePariMutuelPools, type PariMutuelPool, type PariMutuelTicket } from "../src/pari-mutuel.ts";

const ticket = (ticketId: string, outcome: string, stake: bigint): PariMutuelTicket => ({ ticketId, outcome, stake });
const pool = (tickets: readonly PariMutuelTicket[], changes: Partial<PariMutuelPool> = {}): PariMutuelPool => ({
  poolId: "winner", outcomes: ["kor", "ayaz"], feeBps: 200n,
  escrowAmount: tickets.reduce((sum, t) => sum + t.stake, 0n), tickets, winningOutcome: "kor", ...changes,
});
const payments = (value: ReturnType<typeof settlePariMutuelPool>) => Object.fromEntries(value.payouts.map(p => [p.ticketId, p.payout]));

test("balanced pool deducts the explicit fee once and pays only from escrow", () => {
  const result = settlePariMutuelPool(pool([ticket("a", "kor", 10_000n), ticket("b", "ayaz", 10_000n)]));
  assert.equal(result.status, "paid");
  assert.equal(result.refundReason, null);
  assert.equal(result.stakeTotal, 20_000n);
  assert.equal(result.platformFee, 400n);
  assert.equal(result.payoutTotal, 19_600n);
  assert.deepEqual(payments(result), { a: 19_600n, b: 0n });
  assert.equal(result.platformFee + result.payoutTotal, result.stakeTotal);
});

test("skew changes the dividend and a correct favorite need not recover its principal", () => {
  const input = pool([ticket("favorite", "kor", 9_999n), ticket("underdog", "ayaz", 1n)]);
  assert.deepEqual(payments(settlePariMutuelPool(input)), { favorite: 9_800n, underdog: 0n });
  const upset = settlePariMutuelPool({ ...input, winningOutcome: "ayaz" });
  assert.deepEqual(payments(upset), { favorite: 0n, underdog: 9_800n });
  assert.equal(upset.platformFee + upset.payoutTotal, input.escrowAmount);
});

test("largest fractional remainder wins before a larger stake or earlier ticket ID", () => {
  const result = settlePariMutuelPool(pool([ticket("a-larger", "kor", 2n), ticket("z-smaller", "kor", 1n), ticket("loser", "ayaz", 2n)], { feeBps: 0n }));
  assert.deepEqual(payments(result), { "a-larger": 3n, loser: 0n, "z-smaller": 2n });
  assert.equal(result.payoutTotal, 5n, "all dust reaches winning tickets");
});

test("equal remainders use ASCII ID order and do not depend on input order", () => {
  const input = pool([ticket("a", "kor", 1n), ticket("Z", "kor", 1n), ticket("b", "kor", 1n), ticket("loser", "ayaz", 2n)], { feeBps: 0n });
  const result = settlePariMutuelPool(input);
  assert.deepEqual(payments(result), { Z: 2n, a: 2n, b: 1n, loser: 0n });
  assert.deepEqual(settlePariMutuelPool({ ...input, tickets: [...input.tickets].reverse() }), result);
  assert.deepEqual(settlePariMutuelPool({ ...input, tickets: [input.tickets[2], input.tickets[0], input.tickets[3], input.tickets[1]] }), result);
});

test("void, empty and one-sided pools refund every stake without a fee", () => {
  const inputs: [PariMutuelPool, string][] = [
    [pool([ticket("a", "kor", 3n), ticket("b", "ayaz", 9n)], { winningOutcome: null, feeBps: 9_999n }), "void"],
    [pool([]), "empty"],
    [pool([ticket("a", "kor", 3n), ticket("b", "kor", 7n)]), "one-sided"],
    [pool([ticket("a", "ayaz", 3n)], { feeBps: 9_999n }), "one-sided"],
  ];
  for (const [input, reason] of inputs) {
    const result = settlePariMutuelPool(input);
    assert.equal(result.status, "refunded"); assert.equal(result.refundReason, reason);
    assert.equal(result.platformFee, 0n); assert.equal(result.payoutTotal, input.escrowAmount);
    for (const p of result.payouts) assert.equal(p.payout, p.stake);
  }
});

test("generic three-outcome props refund when the actual outcome has no winning tickets", () => {
  const input = pool([ticket("a", "kor", 3n), ticket("b", "ayaz", 9n)], { poolId: "clean-hits", outcomes: ["kor", "ayaz", "draw"], winningOutcome: "draw" });
  const result = settlePariMutuelPool(input);
  assert.equal(result.refundReason, "no-winners");
  assert.equal(result.platformFee, 0n); assert.deepEqual(payments(result), { a: 3n, b: 9n });
  const draw = settlePariMutuelPool({ ...input, tickets: [...input.tickets, ticket("c", "draw", 1n)], escrowAmount: 13n });
  assert.equal(draw.status, "paid"); assert.deepEqual(payments(draw), { a: 0n, b: 0n, c: 13n });
});

test("duplicate tickets and outcomes fail even on a refund path", () => {
  for (const winningOutcome of ["kor", null]) {
    assert.throws(() => settlePariMutuelPool(pool([ticket("same", "kor", 1n), ticket("same", "ayaz", 1n)], { winningOutcome })), /Duplicate ticket/);
    assert.throws(() => settlePariMutuelPool(pool([], { outcomes: ["kor", "kor"], winningOutcome })), /Duplicate outcome/);
  }
  assert.throws(() => settlePariMutuelPool(pool([ticket("a", "unknown", 1n)])), /Unknown ticket/);
  assert.throws(() => settlePariMutuelPool(pool([], { winningOutcome: "unlisted" })), /Unknown winning/);
});

test("recorded escrow must match its own stakes exactly, including for voids", () => {
  for (const escrowAmount of [0n, 9n, 11n, PARI_MUTUEL_MAX_AMOUNT]) {
    for (const winningOutcome of ["kor", null]) {
      assert.throws(() => settlePariMutuelPool(pool([ticket("a", "kor", 4n), ticket("b", "ayaz", 6n)], { escrowAmount, winningOutcome })), /escrow/);
    }
  }
});

test("u64 boundary remains exact despite a u128-sized intermediate and rejects aggregate overflow", () => {
  const input = pool([ticket("big", "kor", PARI_MUTUEL_MAX_AMOUNT - 1n), ticket("small", "ayaz", 1n)]);
  const result = settlePariMutuelPool(input);
  assert.equal(result.platformFee, PARI_MUTUEL_MAX_AMOUNT * 200n / 10_000n);
  assert.equal(result.platformFee + result.payoutTotal, PARI_MUTUEL_MAX_AMOUNT);
  assert.equal(result.payouts[0].payout, PARI_MUTUEL_MAX_AMOUNT - result.platformFee);
  assert.throws(() => settlePariMutuelPool(pool([ticket("a", "kor", PARI_MUTUEL_MAX_AMOUNT), ticket("b", "ayaz", 1n)], { escrowAmount: PARI_MUTUEL_MAX_AMOUNT })), RangeError);
});

test("amounts, fees and identifiers fail closed without Number coercion or locale normalization", () => {
  for (const stake of [0n, -1n, PARI_MUTUEL_MAX_AMOUNT + 1n, 1, "1", NaN, Infinity] as bigint[]) {
    assert.throws(() => settlePariMutuelPool({ ...pool([]), escrowAmount: 1n, tickets: [ticket("a", "kor", stake)] }), RangeError);
  }
  for (const feeBps of [-1n, 10_000n, 200, "200", NaN, undefined] as bigint[]) assert.throws(() => settlePariMutuelPool(pool([], { feeBps })), RangeError);
  for (const id of ["", " ", "a b", "a\n", "é", "a".repeat(129), "../escape"]) {
    assert.throws(() => settlePariMutuelPool(pool([], { poolId: id })), RangeError);
    assert.throws(() => settlePariMutuelPool(pool([ticket(id, "kor", 1n)])), RangeError);
  }
  assert.throws(() => settlePariMutuelPool(pool([], { outcomes: ["kor"] })), RangeError);
  assert.throws(() => settlePariMutuelPool({ ...pool([]), tickets: Array(1) }), RangeError);
  assert.throws(() => settlePariMutuelPools(Array(1)), RangeError);
});

test("pool fees floor only once and no house-funded minimum return is manufactured", () => {
  const result = settlePariMutuelPool(pool([ticket("a", "kor", 1n), ticket("b", "kor", 1n), ticket("c", "ayaz", 1n)], { feeBps: 9_999n }));
  assert.equal(result.platformFee, 2n);
  assert.deepEqual(payments(result), { a: 1n, b: 0n, c: 0n });
  assert.equal(result.payoutTotal, 1n);
});

test("multiple prop pools preserve independent reserves and reject duplicate pool IDs", () => {
  const winner = pool([ticket("session-a", "kor", 100n), ticket("session-b", "ayaz", 100n)]);
  const knockdowns = pool([ticket("session-a", "none", 90n), ticket("session-b", "any", 10n)], { poolId: "total-knockdowns", outcomes: ["none", "any"], winningOutcome: "none", feeBps: 1_000n });
  const cleanHits = pool([ticket("session-a", "draw", 50n)], { poolId: "clean-hits", outcomes: ["kor", "ayaz", "draw"], winningOutcome: "kor" });
  const result = settlePariMutuelPools([winner, knockdowns, cleanHits]);
  assert.equal(result.escrowTotal, 350n); assert.equal(result.platformFeeTotal, 14n); assert.equal(result.payoutTotal, 336n);
  assert.deepEqual(result.pools.map(p => p.poolId), ["clean-hits", "total-knockdowns", "winner"]);
  for (const p of result.pools) assert.equal(p.platformFee + p.payoutTotal, p.stakeTotal);
  assert.deepEqual(settlePariMutuelPools([cleanHits, winner, knockdowns]), result);
  assert.throws(() => settlePariMutuelPools([winner, winner]), /Duplicate pool/);
  // The aggregate custody amount is unchanged, but moving a unit between props is still invalid.
  assert.throws(() => settlePariMutuelPools([{ ...winner, escrowAmount: 199n }, { ...knockdowns, escrowAmount: 101n }]), /escrow/);
  assert.throws(() => settlePariMutuelPools([pool([ticket("a", "kor", PARI_MUTUEL_MAX_AMOUNT)]), pool([ticket("b", "kor", 1n)], { poolId: "other" })]), RangeError);
  assert.deepEqual(settlePariMutuelPools([]), { escrowTotal: 0n, platformFeeTotal: 0n, payoutTotal: 0n, pools: [] });
});

test("input stays untouched and returned accounting cannot be mutated", () => {
  const input = Object.freeze(pool(Object.freeze([Object.freeze(ticket("b", "kor", 1n)), Object.freeze(ticket("a", "ayaz", 1n))])));
  const before = structuredClone(input);
  const result = settlePariMutuelPool(input);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.payouts), true); assert.equal(Object.isFrozen(result.payouts[0]), true);
  const batch = settlePariMutuelPools([input]); assert.equal(Object.isFrozen(batch), true); assert.equal(Object.isFrozen(batch.pools), true);
});

test("bounded adversarial enumeration conserves each pool and satisfies each winner's floor-or-ceiling quota", () => {
  // Deterministic test-data generator, never game randomness.
  let state = 871n;
  const next = () => { state = (state * 48_271n) % 2_147_483_647n; return state; };
  for (let n = 0; n < 500; n++) {
    const outcomes = ["kor", "ayaz", "draw"];
    const tickets = Array.from({ length: 2 + Number(next() % 31n) }, (_, i) => ticket(`t${i.toString().padStart(3, "0")}`, outcomes[Number(next() % 3n)], 1n + next() * (next() % 1_000_000n)));
    const input = pool(tickets, { outcomes, feeBps: next() % 10_000n, winningOutcome: outcomes[n % 3] });
    const result = settlePariMutuelPool(input);
    assert.equal(result.platformFee + result.payoutTotal, input.escrowAmount);
    assert.ok(result.payoutTotal <= input.escrowAmount);
    assert.deepEqual(settlePariMutuelPool({ ...input, tickets: [...tickets].reverse() }), result);
    const winningStake = tickets.filter(t => t.outcome === input.winningOutcome).reduce((sum, t) => sum + t.stake, 0n);
    for (const payout of result.payouts) {
      const original = tickets.find(t => t.ticketId === payout.ticketId)!;
      if (result.status === "refunded") { assert.equal(payout.payout, original.stake); continue; }
      if (original.outcome !== input.winningOutcome) { assert.equal(payout.payout, 0n); continue; }
      const numerator = result.payoutTotal * original.stake;
      const floor = numerator / winningStake;
      const ceiling = (numerator + winningStake - 1n) / winningStake;
      assert.ok(payout.payout === floor || payout.payout === ceiling);
    }
  }
});
