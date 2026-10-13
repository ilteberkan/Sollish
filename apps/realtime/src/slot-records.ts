/** Public replay record shape for the slot service (pure, unit-testable). The exact key set is enforced so that nothing
 * private (balance, time, session, token, IP) can ride along into a record anyone can open. */
import { SLOT_HEX64_PATTERN, SLOT_ROUND_ID_PATTERN, SLOT_SEED_HEX_PATTERN, slotGame, type SlotReplayFields } from "@sollish/protocol";
import type { SlotSignature } from "./slots";

export interface SlotReplayRecord {
  v: 1; roundId: string; game: string; engineId: string; mode: string; betCents: number; costCents: number; payoutCents: number; totalHundredths: number;
  fair: { version: "sollish-slot-fair-1"; seedHex: string; serverSeedHash: string; nonce: number; serverSeed: string | null; clientSeed: string | null };
  signature: SlotSignature;
}
export function replayFields(r: Omit<SlotReplayRecord, "signature">): SlotReplayFields {
  return { roundId: r.roundId, game: r.game, engineId: r.engineId, mode: r.mode, betCents: r.betCents, costCents: r.costCents, payoutCents: r.payoutCents, totalHundredths: r.totalHundredths, seedHex: r.fair.seedHex, serverSeedHash: r.fair.serverSeedHash, nonce: r.fair.nonce, serverSeed: r.fair.serverSeed, clientSeed: r.fair.clientSeed };
}
const RECORD_KEYS = ["v", "roundId", "game", "engineId", "mode", "betCents", "costCents", "payoutCents", "totalHundredths", "fair", "signature"];
const FAIR_KEYS = ["version", "seedHex", "serverSeedHash", "nonce", "serverSeed", "clientSeed"];
const int = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
/** Exact shape, so nothing private can ride along into a public record. */
export function isReplayRecord(value: unknown): value is SlotReplayRecord {
  const r = value as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Object.keys(r).length !== RECORD_KEYS.length || !RECORD_KEYS.every(k => Object.hasOwn(r, k))) return false;
  const f = r.fair as Record<string, unknown> | null, s = r.signature as Record<string, unknown> | null;
  if (!f || typeof f !== "object" || Object.keys(f).length !== FAIR_KEYS.length || !FAIR_KEYS.every(k => Object.hasOwn(f, k))) return false;
  if (!s || typeof s !== "object" || Object.keys(s).length !== 3 || s.alg !== "HMAC-SHA256" || (s.key !== "worker" && s.key !== "dev") || typeof s.value !== "string" || !SLOT_HEX64_PATTERN.test(s.value)) return false;
  const game = slotGame(r.game);
  return r.v === 1 && typeof r.roundId === "string" && SLOT_ROUND_ID_PATTERN.test(r.roundId) && !!game && r.engineId === game.engineId && typeof r.mode === "string" && game.modes.includes(r.mode)
    && int(r.betCents) && int(r.costCents) && int(r.payoutCents) && int(r.totalHundredths) && f.version === "sollish-slot-fair-1"
    && typeof f.seedHex === "string" && SLOT_SEED_HEX_PATTERN.test(f.seedHex) && typeof f.serverSeedHash === "string" && SLOT_HEX64_PATTERN.test(f.serverSeedHash) && int(f.nonce)
    && (f.serverSeed === null || (typeof f.serverSeed === "string" && SLOT_HEX64_PATTERN.test(f.serverSeed)))
    && (f.clientSeed === null || (typeof f.clientSeed === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(f.clientSeed)));
}
