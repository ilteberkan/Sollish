import test from "node:test";
import assert from "node:assert/strict";
import { addBinaryExposure, availableHouseCollateral, binaryGrossPayout, canAcceptLiveBet, EMPTY_BINARY_EXPOSURE, parseLiveClientFrame, parseLiveServerFrame, pooledBinaryReserveEstimate, U64_MAX } from "../src/live-round.ts";

const open = { phase: "open" as const, openedAtMs: 10_000, closesAtMs: 15_000 };
const command = { v: 1, type: "bet", clientId: "cd06c820-86c0-4266-85b0-20953c37af9c", roundId: "12", side: "kor", amountCents: 1_000 };
test("five-second admission is inclusive at opening and exclusive at the exact deadline", () => {
  for (const [now, accepted] of [[9_999, false], [10_000, true], [14_999, true], [15_000, false], [15_001, false]] as const) assert.equal(canAcceptLiveBet(open, now), accepted);
  for (const phase of ["closed", "fighting", "result"] as const) assert.equal(canAcceptLiveBet({ ...open, phase }, 10_001), false, "clock regression cannot reopen persisted cutoff");
  for (const now of [NaN, Infinity, 14_999.5, Number.MAX_SAFE_INTEGER + 1, -1]) assert.equal(canAcceptLiveBet(open, now), false);
  assert.equal(canAcceptLiveBet({ ...open, closesAtMs: 15_001 }, 10_001), false);
});
test("strict commands reject client timestamps, chosen balances, invalid amounts and secrets", () => {
  assert.deepEqual(parseLiveClientFrame(JSON.stringify(command)), command);
  for (const bad of [{ ...command, acceptedAt: 10_001 }, { ...command, balance: 1_000_000 }, { ...command, winner: "kor" }, { ...command, amountCents: 99 }, { ...command, amountCents: 50_001 }, { ...command, amountCents: 100.1 }, { ...command, amountCents: "100" }, { ...command, roundId: "01" }, { ...command, roundId: (U64_MAX + 1n).toString() }, { ...command, side: "both" }, { ...command, v: 2 }]) assert.equal(parseLiveClientFrame(JSON.stringify(bad)), null);
  assert.equal(parseLiveClientFrame("x".repeat(10_241)), null);
  for (const token of ["ab".repeat(32), undefined]) {
    const session = { v: 1, type: "session", ...(token ? { token } : {}) };
    assert.deepEqual(parseLiveClientFrame(JSON.stringify(session)), session);
  }
  for (const token of [null, "ab".repeat(31), "AB".repeat(32), "g".repeat(64)]) assert.equal(parseLiveClientFrame(JSON.stringify({ v: 1, type: "session", token })), null);
});
test("gross payout includes principal, floors per bet and rejects unsafe integer domains", () => {
  assert.equal(binaryGrossPayout(10_000_000n), 19_600_000n);
  assert.equal(binaryGrossPayout(1n), 1n);
  assert.equal(binaryGrossPayout(1n, 0n), 2n);
  assert.equal(binaryGrossPayout(10_000n, 9_999n), 2n);
  for (const stake of [0n, -1n, U64_MAX + 1n, U64_MAX]) assert.throws(() => binaryGrossPayout(stake), RangeError);
  for (const edge of [-1n, 10_000n]) assert.throws(() => binaryGrossPayout(1n, edge), RangeError);
});
test("correlated 100-bet outcome is fully reserved; balanced sides only reduce a future pooled model", () => {
  let oneSide = EMPTY_BINARY_EXPOSURE, balanced = EMPTY_BINARY_EXPOSURE;
  for (let i = 0; i < 100; i++) {
    oneSide = addBinaryExposure(oneSide, "kor", 10_000_000n);
    balanced = addBinaryExposure(balanced, i % 2 ? "kor" : "ayaz", 10_000_000n);
  }
  assert.equal(oneSide.stakeTotal, 1_000_000_000n);
  assert.equal(oneSide.korGross, 1_960_000_000n);
  assert.equal(oneSide.conservativeReserve, 960_000_000n);
  assert.equal(pooledBinaryReserveEstimate(oneSide), 960_000_000n);
  assert.equal(balanced.conservativeReserve, 960_000_000n, "current receipt custody does not cross-fund bets");
  assert.equal(pooledBinaryReserveEstimate(balanced), 0n);
  assert.equal(balanced.korGross, 980_000_000n);
  assert.equal(EMPTY_BINARY_EXPOSURE.stakeTotal, 0n);
});
test("both shared outcomes conserve stakes plus reserved house collateral across skew and rounding", () => {
  for (const stakes of [[1n, 1n, 1n], [100n, 999n, 31n], [900_000_000n, 10_000_000n, 7n]]) {
    for (let mask = 0; mask < 8; mask++) {
      const exposure = stakes.reduce((e, stake, i) => addBinaryExposure(e, mask & (1 << i) ? "kor" : "ayaz", stake), EMPTY_BINARY_EXPOSURE);
      const pool = exposure.stakeTotal + pooledBinaryReserveEstimate(exposure);
      assert.ok(pool >= exposure.korGross && pool >= exposure.ayazGross);
      assert.ok(exposure.conservativeReserve >= pooledBinaryReserveEstimate(exposure));
    }
  }
});
test("global reservations share one bankroll without double counting, including rent and buffer", () => {
  assert.equal(availableHouseCollateral(1_000_000_000n, 0n, 0n, [960_000_000n]), 40_000_000n);
  assert.equal(availableHouseCollateral(1_000_000_000n, 10n, 20n, [400_000_000n, 500_000_000n]), 99_999_970n);
  assert.throws(() => availableHouseCollateral(1_000_000_000n, 0n, 0n, [960_000_000n, 960_000_000n]), /Insufficient collateral/);
  assert.throws(() => availableHouseCollateral(1_000_000_000n, 0n, 40_000_001n, [960_000_000n]), /Insufficient collateral/);
  assert.throws(() => availableHouseCollateral(U64_MAX, 0n, 0n, [U64_MAX, 1n]), RangeError);
  assert.throws(() => addBinaryExposure({ ...EMPTY_BINARY_EXPOSURE, stakeTotal: U64_MAX }, "kor", 1n), RangeError);
});
test("server snapshots bind version, exact schedule and never carry an outcome before the cutoff", () => {
  const round = { ...open, roundId: "12", version: 7, fightStartedAtMs: null, resultAtMs: null, nextRoundAtMs: null, winner: null };
  const snapshot = { v: 1, type: "arena.snapshot", version: 7, serverTimeMs: 10_001, round, ticketCount: 0 };
  assert.deepEqual(parseLiveServerFrame(JSON.stringify(snapshot)), snapshot);
  for (const bad of [{ ...snapshot, token: "ab".repeat(32) }, { ...snapshot, version: 8 }, { ...snapshot, ticketCount: 257 }, { ...snapshot, round: { ...round, winner: "kor" } }, { ...snapshot, round: { ...round, phase: "closed", winner: "ayaz" } }, { ...snapshot, round: { ...round, phase: "closed" } }]) assert.equal(parseLiveServerFrame(JSON.stringify(bad)), null);
  const fighting = { ...snapshot, serverTimeMs: 15_000, round: { ...round, phase: "fighting", fightStartedAtMs: 15_000, resultAtMs: 23_800, nextRoundAtMs: 27_800, winner: "kor" } };
  assert.deepEqual(parseLiveServerFrame(JSON.stringify(fighting)), fighting);
  for (const bad of [{ ...fighting, serverTimeMs: 14_999 }, { ...fighting, round: { ...fighting.round, fightStartedAtMs: 14_999 } }, { ...fighting, round: { ...fighting.round, resultAtMs: 23_799 } }, { ...fighting, round: { ...fighting.round, nextRoundAtMs: 27_799 } }, { ...fighting, round: { ...fighting.round, phase: "result" } }]) assert.equal(parseLiveServerFrame(JSON.stringify(bad)), null);
  const result = { ...fighting, serverTimeMs: 23_800, round: { ...fighting.round, phase: "result" } };
  assert.deepEqual(parseLiveServerFrame(JSON.stringify(result)), result);
});
test("private server messages validate ticket economics and reject arbitrary outcome/payment claims", () => {
  const accepted = { clientId: command.clientId, roundId: "12", side: "kor", amountCents: 1_000, status: "accepted", payoutCents: 0 };
  for (const payoutCents of [0, 1960]) {
    const frame = { v: 1, type: "arena.ticket", ticket: { ...accepted, status: "settled", payoutCents } };
    assert.deepEqual(parseLiveServerFrame(JSON.stringify(frame)), frame);
  }
  for (const bad of [{ ...accepted, payoutCents: 1960 }, { ...accepted, status: "settled", payoutCents: 1961 }, { ...accepted, status: "paid_sol" }, { ...accepted, amountCents: 99 }]) assert.equal(parseLiveServerFrame(JSON.stringify({ v: 1, type: "arena.ticket", ticket: bad })), null);
  const session = { v: 1, type: "arena.session", token: "ab".repeat(32), balanceCents: 100_000, expiresAtMs: 3_600_000 };
  assert.deepEqual(parseLiveServerFrame(JSON.stringify(session)), session);
  for (const bad of [{ ...session, balanceCents: -1 }, { ...session, balanceCents: Number.MAX_SAFE_INTEGER + 1 }, { ...session, token: "abc" }, { v: 1, type: "arena.error", code: "PAYMENT_CONFIRMED" }, { v: 1, type: "pong", serverTimeMs: -1 }]) assert.equal(parseLiveServerFrame(JSON.stringify(bad)), null);
});
