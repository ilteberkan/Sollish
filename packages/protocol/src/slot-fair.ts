/** Provably fair seed derivation for the server-authoritative slot service (RGS), `sollish-slot-fair-1`.
 * Authoritative text: docs/architecture/slot-rgs.md. DEMO credits only; not a certified RNG.
 *
 * Commit / reveal:
 *   serverSeed      32 random bytes chosen by the server; kept secret until the seed is rotated.
 *   serverSeedHash  SHA-256(serverSeed bytes), lowercase hex. Published before any round uses the seed.
 *   clientSeed      chosen by the player per round, 1..64 characters of [A-Za-z0-9_-].
 *   nonce           0, 1, 2 ... per server seed; every round consumes exactly one nonce.
 *   seedHex         first 16 bytes of HMAC-SHA256(key = serverSeed bytes, message = UTF-8 `${clientSeed}:${nonce}`),
 *                   32 lowercase hex characters: the engine seed of that round.
 * The engine (cascade-2.ts, storm-throne.ts ...) turns (seedHex, betCents, mode) into the whole round.
 *
 * Only WebCrypto (crypto.subtle) and TextEncoder are used, so Workers, browsers and Node give identical bytes.
 * seedHex is a PRF output: publishing it for a past round reveals nothing about serverSeed or a future round.
 */

export const SLOT_FAIR_VERSION = "sollish-slot-fair-1" as const;
export const SLOT_SERVER_SEED_BYTES = 32;
/** Highest nonce one server seed may reach (the server rotates long before). */
export const SLOT_MAX_NONCE = 1_000_000_000;
export const SLOT_CLIENT_SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SLOT_HEX64_PATTERN = /^[0-9a-f]{64}$/;
export const SLOT_SEED_HEX_PATTERN = /^[0-9a-f]{32}$/;
export const SLOT_ROUND_ID_PATTERN = /^[0-9a-f]{32}$/;

const encoder = new TextEncoder();

export function slotBytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
/** Strict: even length, lowercase hex only. */
export function slotHexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new RangeError("Expected lowercase hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> { const copy = new Uint8Array(bytes.length); copy.set(bytes); return copy; }

export function isClientSeed(value: unknown): value is string { return typeof value === "string" && SLOT_CLIENT_SEED_PATTERN.test(value); }
export function isSlotNonce(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= SLOT_MAX_NONCE; }

/** The exact HMAC message of a round. */
export function slotNonceMessage(clientSeed: string, nonce: number): string {
  if (!isClientSeed(clientSeed)) throw new RangeError("clientSeed must be 1-64 characters of [A-Za-z0-9_-]");
  if (!isSlotNonce(nonce)) throw new RangeError("nonce must be an integer 0..1e9");
  return `${clientSeed}:${nonce}`;
}

export async function slotSha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : owned(data);
  return slotBytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function serverSeedBytes(serverSeed: Uint8Array | string): Uint8Array<ArrayBuffer> {
  const bytes = typeof serverSeed === "string" ? slotHexToBytes(serverSeed) : owned(serverSeed);
  if (bytes.length !== SLOT_SERVER_SEED_BYTES) throw new RangeError("serverSeed must be 32 bytes (64 hex characters)");
  return bytes;
}

/** SHA-256 of the raw 32 server-seed bytes (not of the hex text). */
export async function slotServerSeedHash(serverSeed: Uint8Array | string): Promise<string> { return slotSha256Hex(serverSeedBytes(serverSeed)); }

/** seedHex = first 16 bytes of HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) as 32 lowercase hex characters. */
export async function deriveSeedHex(serverSeed: Uint8Array | string, clientSeed: string, nonce: number): Promise<string> {
  const message = encoder.encode(slotNonceMessage(clientSeed, nonce));
  const key = await crypto.subtle.importKey("raw", serverSeedBytes(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  return slotBytesToHex(mac.subarray(0, 16));
}

/** Engine output fields every slot round carries (Cascade2Round and StormRound both satisfy it). */
export interface SlotRoundSummary {
  engine: string; seedHex: string; mode: string; betCents: number; costCents: number;
  payoutCents: number; totalHundredths: number; capped: boolean; freeSpinsTriggered: boolean;
}
/** What a verifier needs from a game: its engine id and its pure engine. */
export interface SlotVerifiableGame<R extends SlotRoundSummary = SlotRoundSummary> {
  id: string; engineId: string;
  play(seedHex: string, betCents: number, mode: string): R;
}
export interface SlotVerifyInput {
  /** Revealed server seed, 64 lowercase hex characters. */
  serverSeed: string;
  /** Published commitment; when given it must equal SHA-256(serverSeed). */
  serverSeedHash?: string;
  clientSeed: string; nonce: number; betCents: number; mode: string;
}
/** Values the record claims; each one that is given is compared. */
export interface SlotVerifyExpected { engineId?: string; seedHex?: string; payoutCents?: number; totalHundredths?: number; costCents?: number }
export type SlotVerifyCheck = "hash" | "engine" | "seed" | "payout" | "total" | "cost";
export interface SlotVerifyResult<R extends SlotRoundSummary = SlotRoundSummary> {
  /** True when every comparison that could be made matched and the engine ran. */
  ok: boolean;
  serverSeedHash: string; seedHex: string; round: R | null;
  /** Per check: true = matched, false = mismatch, null = nothing to compare. */
  checks: Record<SlotVerifyCheck, boolean | null>;
  error: string | null;
}

/** Recomputes a round from a revealed seed: hash commitment, seedHex, engine round, payout, total and cost. */
export async function verifySlotRound<R extends SlotRoundSummary>(game: SlotVerifiableGame<R>, input: SlotVerifyInput, expected: SlotVerifyExpected = {}): Promise<SlotVerifyResult<R>> {
  const checks: Record<SlotVerifyCheck, boolean | null> = { hash: null, engine: null, seed: null, payout: null, total: null, cost: null };
  const fail = (error: string, serverSeedHash = "", seedHex = ""): SlotVerifyResult<R> => ({ ok: false, serverSeedHash, seedHex, round: null, checks, error });
  if (typeof input.serverSeed !== "string" || !SLOT_HEX64_PATTERN.test(input.serverSeed)) return fail("SERVER_SEED_FORMAT");
  if (input.serverSeedHash !== undefined && !SLOT_HEX64_PATTERN.test(input.serverSeedHash)) return fail("SERVER_SEED_HASH_FORMAT");
  if (!isClientSeed(input.clientSeed)) return fail("CLIENT_SEED_FORMAT");
  if (!isSlotNonce(input.nonce)) return fail("NONCE_FORMAT");
  const hash = await slotServerSeedHash(input.serverSeed);
  if (input.serverSeedHash !== undefined) checks.hash = hash === input.serverSeedHash;
  if (expected.engineId !== undefined) checks.engine = expected.engineId === game.engineId;
  const seedHex = await deriveSeedHex(input.serverSeed, input.clientSeed, input.nonce);
  if (expected.seedHex !== undefined) checks.seed = expected.seedHex === seedHex;
  let round: R;
  try { round = game.play(seedHex, input.betCents, input.mode); } catch { return fail("ENGINE_REJECTED_INPUT", hash, seedHex); }
  if (expected.payoutCents !== undefined) checks.payout = expected.payoutCents === round.payoutCents;
  if (expected.totalHundredths !== undefined) checks.total = expected.totalHundredths === round.totalHundredths;
  if (expected.costCents !== undefined) checks.cost = expected.costCents === round.costCents;
  const ok = Object.values(checks).every(v => v !== false) && round.engine === game.engineId;
  return { ok, serverSeedHash: hash, seedHex, round, checks, error: ok ? null : "MISMATCH" };
}

/* ---------------------------------------------------------------- signed records
 * The server signs these canonical texts with HMAC-SHA256(SLOT_SIGNING_KEY, text) and returns lowercase hex. Only the
 * server can check an HMAC; the browser's independent check is the seed + engine recomputation above. Every field is
 * validated to contain no newline before it is joined. */

export interface SlotReceiptFields {
  roundId: string; game: string; engineId: string; mode: string; betCents: number; costCents: number; payoutCents: number;
  totalHundredths: number; seedHex: string; serverSeedHash: string; clientSeed: string; nonce: number; balanceCents: number; at: number;
}
export interface SlotReplayFields {
  roundId: string; game: string; engineId: string; mode: string; betCents: number; costCents: number; payoutCents: number;
  totalHundredths: number; seedHex: string; serverSeedHash: string; nonce: number; serverSeed: string | null; clientSeed: string | null;
}
const plain = (value: string | number): string => {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new RangeError("Signed fields cannot contain line breaks");
  return text;
};
export function slotReceiptMessage(r: SlotReceiptFields): string {
  return ["sollish-slot-receipt-1", r.roundId, r.game, r.engineId, r.mode, r.betCents, r.costCents, r.payoutCents, r.totalHundredths, r.seedHex, r.serverSeedHash, r.clientSeed, r.nonce, r.balanceCents, r.at].map(plain).join("\n");
}
export function slotReplayMessage(r: SlotReplayFields): string {
  return ["sollish-slot-replay-1", r.roundId, r.game, r.engineId, r.mode, r.betCents, r.costCents, r.payoutCents, r.totalHundredths, r.seedHex, r.serverSeedHash, r.nonce, r.serverSeed ?? "-", r.clientSeed ?? "-"].map(plain).join("\n");
}
