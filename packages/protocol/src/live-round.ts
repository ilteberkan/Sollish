/** Public LIVE DEMO protocol and collateral estimates. No funds, signing or claim rights. */
export const LIVE_BET_WINDOW_MS = 5_000 as const;
export const LIVE_FIGHT_DURATION_MS = 8_800 as const;
export const LIVE_RESULT_DURATION_MS = 4_000 as const;
export const LIVE_MIN_BET_CENTS = 100 as const;
export const LIVE_MAX_BET_CENTS = 50_000 as const;
export const LIVE_EDGE_BPS = 200n;
export type LiveSide = "kor" | "ayaz";
export type LiveRoundPhase = "open" | "closed" | "fighting" | "result";
export type LivePublicRound = {
  roundId: string; version: number; phase: LiveRoundPhase;
  openedAtMs: number; closesAtMs: number;
  fightStartedAtMs: number | null; resultAtMs: number | null; nextRoundAtMs: number | null; winner: LiveSide | null;
};
export type LiveClientFrame =
  | { v: 1; type: "session"; token?: string }
  | { v: 1; type: "bet"; clientId: string; roundId: string; side: LiveSide; amountCents: number }
  | { v: 1; type: "sync" }
  | { v: 1; type: "ping" };
export type LiveTicket = { clientId: string; roundId: string; side: LiveSide; amountCents: number; status: "accepted" | "settled"; payoutCents: number };
export type LiveArenaErrorCode = "INVALID_MESSAGE" | "SESSION_REQUIRED" | "SESSION_INVALID" | "SESSION_EXPIRED" | "SESSION_ALREADY_SET" | "ROUND_CLOSED" | "WRONG_ROUND" | "TICKET_CONFLICT" | "ALREADY_BET" | "INSUFFICIENT_CREDITS" | "CAPACITY" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE";
export type LiveServerFrame =
  | { v: 1; type: "arena.snapshot"; version: number; serverTimeMs: number; round: LivePublicRound; ticketCount: number }
  | { v: 1; type: "arena.session"; token?: string; balanceCents: number; expiresAtMs: number }
  | { v: 1; type: "arena.ticket"; ticket: LiveTicket }
  | { v: 1; type: "arena.error"; code: LiveArenaErrorCode }
  | { v: 1; type: "pong"; serverTimeMs: number };

const uint = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const object = (n: unknown): n is Record<string, unknown> => !!n && typeof n === "object" && !Array.isArray(n);
const exact = (n: Record<string, unknown>, keys: string[]): boolean => Object.keys(n).length === keys.length && keys.every(k => Object.hasOwn(n, k));
const liveUuid = (n: unknown): n is string => typeof n === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n);
const liveAmount = (n: unknown): n is number => uint(n) && n >= LIVE_MIN_BET_CENTS && n <= LIVE_MAX_BET_CENTS;
export const liveSessionToken = (n: unknown): n is string => typeof n === "string" && /^[0-9a-f]{64}$/.test(n);
export const liveRoundId = (n: unknown): n is string => typeof n === "string" && /^[1-9]\d{0,19}$/.test(n) && BigInt(n) <= U64_MAX;

/** The server's serialized admission operation supplies now; a browser timestamp is never authoritative.
 * A persisted closed phase cannot reopen after a backward clock adjustment. Exactly at cutoff is late.
 */
export function canAcceptLiveBet(round: Pick<LivePublicRound, "phase" | "openedAtMs" | "closesAtMs">, serverNowMs: number): boolean {
  return round.phase === "open" && uint(serverNowMs) && uint(round.openedAtMs) && uint(round.closesAtMs)
    && round.closesAtMs - round.openedAtMs === LIVE_BET_WINDOW_MS
    && serverNowMs >= round.openedAtMs && serverNowMs < round.closesAtMs;
}

/** Unknown fields cannot smuggle a wallet, balance, outcome or client-chosen acceptance time. */
export function parseLiveClientFrame(raw: string): LiveClientFrame | null {
  if (new TextEncoder().encode(raw).length > 10_240) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== 1) return null;
  if (value.type === "session" && (exact(value, ["v", "type"]) || (exact(value, ["v", "type", "token"]) && liveSessionToken(value.token)))) return value as LiveClientFrame;
  if ((value.type === "sync" || value.type === "ping") && exact(value, ["v", "type"])) return value as LiveClientFrame;
  if (value.type === "bet" && exact(value, ["v", "type", "clientId", "roundId", "side", "amountCents"])
    && liveUuid(value.clientId)
    && liveRoundId(value.roundId) && (value.side === "kor" || value.side === "ayaz")
    && liveAmount(value.amountCents)) return value as LiveClientFrame;
  return null;
}

function publicRound(value: unknown): value is LivePublicRound {
  if (!object(value) || !exact(value, ["roundId", "version", "phase", "openedAtMs", "closesAtMs", "fightStartedAtMs", "resultAtMs", "nextRoundAtMs", "winner"])
    || !liveRoundId(value.roundId) || !uint(value.version) || value.version === 0
    || !uint(value.openedAtMs) || !uint(value.closesAtMs) || value.closesAtMs - value.openedAtMs !== LIVE_BET_WINDOW_MS) return false;
  if (value.phase === "open" || value.phase === "closed") return value.winner === null && value.fightStartedAtMs === null && value.resultAtMs === null && value.nextRoundAtMs === null;
  return (value.phase === "fighting" || value.phase === "result") && (value.winner === "kor" || value.winner === "ayaz")
    && uint(value.fightStartedAtMs) && value.fightStartedAtMs >= value.closesAtMs
    && uint(value.resultAtMs) && value.resultAtMs - value.fightStartedAtMs === LIVE_FIGHT_DURATION_MS
    && uint(value.nextRoundAtMs) && value.nextRoundAtMs - value.resultAtMs === LIVE_RESULT_DURATION_MS;
}
function ticket(value: unknown): value is LiveTicket {
  if (!object(value) || !exact(value, ["clientId", "roundId", "side", "amountCents", "status", "payoutCents"])
    || !liveUuid(value.clientId) || !liveRoundId(value.roundId) || (value.side !== "kor" && value.side !== "ayaz")
    || !liveAmount(value.amountCents) || !uint(value.payoutCents)) return false;
  return value.status === "accepted" ? value.payoutCents === 0 : value.status === "settled" && (value.payoutCents === 0 || value.payoutCents === Math.floor(value.amountCents * 196 / 100));
}
const errorCodes: readonly string[] = ["INVALID_MESSAGE", "SESSION_REQUIRED", "SESSION_INVALID", "SESSION_EXPIRED", "SESSION_ALREADY_SET", "ROUND_CLOSED", "WRONG_ROUND", "TICKET_CONFLICT", "ALREADY_BET", "INSUFFICIENT_CREDITS", "CAPACITY", "RATE_LIMITED", "SERVICE_UNAVAILABLE"];
/** Shape validation is not proof of fairness. Consumers must also discard older snapshot versions;
 * no token, balance or ticket belongs in a broadcast round. This protocol carries valueless DEMO only.
 */
export function parseLiveServerFrame(raw: string): LiveServerFrame | null {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 10_240) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== 1) return null;
  if (value.type === "arena.snapshot" && exact(value, ["v", "type", "version", "serverTimeMs", "round", "ticketCount"])
    && publicRound(value.round) && value.version === value.round.version && uint(value.serverTimeMs)
    && value.serverTimeMs >= value.round.openedAtMs && uint(value.ticketCount) && value.ticketCount <= 256) {
    const earliest = value.round.phase === "closed" ? value.round.closesAtMs
      : value.round.phase === "fighting" ? value.round.fightStartedAtMs!
      : value.round.phase === "result" ? value.round.resultAtMs! : value.round.openedAtMs;
    return value.serverTimeMs >= earliest ? value as LiveServerFrame : null;
  }
  if (value.type === "arena.session" && (exact(value, ["v", "type", "balanceCents", "expiresAtMs"])
    || (exact(value, ["v", "type", "token", "balanceCents", "expiresAtMs"]) && liveSessionToken(value.token)))
    && uint(value.balanceCents) && uint(value.expiresAtMs)) return value as LiveServerFrame;
  if (value.type === "arena.ticket" && exact(value, ["v", "type", "ticket"]) && ticket(value.ticket)) return value as LiveServerFrame;
  if (value.type === "arena.error" && exact(value, ["v", "type", "code"]) && typeof value.code === "string" && errorCodes.includes(value.code)) return value as LiveServerFrame;
  if (value.type === "pong" && exact(value, ["v", "type", "serverTimeMs"]) && uint(value.serverTimeMs)) return value as LiveServerFrame;
  return null;
}

export const U64_MAX = (1n << 64n) - 1n;
function amount(n: bigint): bigint {
  if (typeof n !== "bigint" || n < 0n || n > U64_MAX) throw new RangeError("Amount must be an unsigned u64 integer");
  return n;
}
function add(a: bigint, b: bigint): bigint { return amount(a + b); }
/** Gross payout includes the winning stake. Floor separately for each accepted bet. */
export function binaryGrossPayout(stake: bigint, edgeBps: bigint = LIVE_EDGE_BPS): bigint {
  amount(stake);
  if (stake === 0n || typeof edgeBps !== "bigint" || edgeBps < 0n || edgeBps >= 10_000n) throw new RangeError("Invalid stake or edge");
  return amount(stake * 2n * (10_000n - edgeBps) / 10_000n);
}
export type BinaryExposure = Readonly<{
  stakeTotal: bigint; korGross: bigint; ayazGross: bigint; conservativeReserve: bigint;
}>;
export const EMPTY_BINARY_EXPOSURE: BinaryExposure = Object.freeze({ stakeTotal: 0n, korGross: 0n, ayazGross: 0n, conservativeReserve: 0n });
/** Safe current House model: each bet retains its own principal; every extra liability is reserved. */
export function addBinaryExposure(exposure: BinaryExposure, side: LiveSide, stake: bigint, edgeBps: bigint = LIVE_EDGE_BPS): BinaryExposure {
  for (const n of [exposure.stakeTotal, exposure.korGross, exposure.ayazGross, exposure.conservativeReserve]) amount(n);
  if (side !== "kor" && side !== "ayaz") throw new RangeError("Invalid side");
  const gross = binaryGrossPayout(stake, edgeBps);
  return Object.freeze({
    stakeTotal: add(exposure.stakeTotal, stake),
    korGross: add(exposure.korGross, side === "kor" ? gross : 0n),
    ayazGross: add(exposure.ayazGross, side === "ayaz" ? gross : 0n),
    conservativeReserve: add(exposure.conservativeReserve, gross > stake ? gross - stake : 0n),
  });
}
/** DESIGN ESTIMATE ONLY: valid solely for a future audited pooled round vault that can use ALL
 * recorded stakes to pay either mutually exclusive outcome. Never feed this reduced reserve into
 * today's House: stakes live in separate receipts and may not yet have settled into the shard.
 */
export function pooledBinaryReserveEstimate(exposure: BinaryExposure): bigint {
  const total = amount(exposure.stakeTotal);
  const worst = amount(exposure.korGross) > amount(exposure.ayazGross) ? exposure.korGross : exposure.ayazGross;
  return worst > total ? worst - total : 0n;
}
/** Sum every simultaneous round/solo reservation. Independent round outcomes cannot be netted.
 * Balance includes rent; buffer and reservations are unavailable. Under-collateralization fails.
 */
export function availableHouseCollateral(balance: bigint, rent: bigint, buffer: bigint, reservations: readonly bigint[]): bigint {
  amount(balance); amount(rent); amount(buffer);
  const protectedTotal = reservations.reduce((sum, n) => add(sum, amount(n)), add(rent, buffer));
  if (protectedTotal > balance) throw new RangeError("Insufficient collateral");
  return balance - protectedTotal;
}
