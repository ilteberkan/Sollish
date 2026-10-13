/** Public protocol only. No transaction signing, secret game state or entitlement arithmetic. */
export * from "./live-round";
export * from "./combat";
export * from "./combat-v3";
export * from "./combat-v4";
export * from "./combat-v5";
export * from "./combat-v5-strikes";
export * from "./contact-learner";
export * from "./corner-plan";
export { RESERVOIR_INFO } from "./connectome-reservoir";
export * from "./combat-sparring";
export * from "./combat-capsules";
export * from "./combat-referee";
export * from "./fight-style";
export * from "./neuro-boxer";
export * from "./neuro-boxer-2";
export * from "./ringside";
export * from "./pari-mutuel";
export * from "./cascade";
export * from "./cascade-2";
export * from "./storm-throne";
export * from "./slot-fair";
export * from "./slot-games";
export * from "./asena";
export * from "./cezeri";
export * from "./ebru";
export const PROTOCOL_VERSION = 1 as const;
export const CHAT_STREAM = "lobby" as const;
export const MAX_FRAME_BYTES = 10_240;
/** Bounded snapshot response; inbound commands retain the smaller limit. */
export const MAX_SERVER_FRAME_BYTES = 524_288;
export const MAX_CHAT_BYTES = 2_000;
export const MAX_CHAT_CHARACTERS = 500;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export type ErrorCode = "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_EXPIRED" | "RATE_LIMITED" | "MESSAGE_TOO_LARGE" | "INVALID_MESSAGE" | "CHAT_INELIGIBLE" | "CHAT_UNAVAILABLE" | "SERVICE_UNAVAILABLE" | "REPLAY_REQUIRED" | "PUBLISH_CONFLICT" | "FORBIDDEN";
export type ClientFrame =
  | { v: 1; type: "auth"; access_token: string }
  | { v: 1; type: "chat.send"; client_id: string; body: string }
  | { v: 1; type: "resume"; after: number }
  | { v: 1; type: "ping" };
export type ChatPayload = { id: string; wallet: string; body: string; createdAt: string };
export type SettlementPayload = { game: "coinflip"; transaction: string; instructionId: string; slot: number; wallet: string; stakeLamports: string; payoutLamports: string; settledAt: string };
export type AdmissionPayload = { game: "coinflip"; transaction: string; instructionId: string; slot: number; wallet: string; stakeLamports: string; acceptedAt: string };
export type PublicEvent = { v: 1; stream: "lobby"; id: string; seq: number; occurredAt: string } & (
  | { kind: "chat.message"; payload: ChatPayload }
  | { kind: "chain.coinflip.settled"; payload: SettlementPayload }
  | { kind: "chain.coinflip.placed"; payload: AdmissionPayload }
);
export type ServerFrame =
  | { v: 1; type: "auth.required"; deadline: string }
  | { v: 1; type: "hello"; stream: "lobby"; wallet: string; expiresAt: string }
  | { v: 1; type: "event"; event: PublicEvent }
  | { v: 1; type: "snapshot"; stream: "lobby"; seq: number; events: PublicEvent[]; truncated: boolean }
  | { v: 1; type: "chat.accepted"; client_id: string; event_id: string; seq: number }
  | { v: 1; type: "pong" }
  | { v: 1; type: "error"; code: ErrorCode; retryAfterSeconds?: number };
export type PublicStatus = {
  v: 1; chain: "solana-devnet"; finality: "finalized";
  availability: "unavailable" | "operational"; now: string; lastIndexedSlot: number | null;
  games: { id: "crash" | "coinflip"; available: boolean; reason: string }[];
  chat: { available: boolean; windowSeconds: 3600; minWagerLamports: string | null };
  rewards: { available: false; claimable: null; authority: "on-chain"; reason: string };
};
export function publicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  let n = 0n;
  for (const c of value) { const digit = BASE58.indexOf(c); if (digit < 0) return false; n = n * 58n + BigInt(digit); }
  let length = 0; while (n > 0n) { length++; n >>= 8n; }
  let zeroes = 0; while (value[zeroes] === "1") zeroes++;
  return length + zeroes === 32;
}
export function signature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 88) return false;
  let n = 0n; for (const c of value) { const digit = BASE58.indexOf(c); if (digit < 0) return false; n = n * 58n + BigInt(digit); }
  let length = 0; while (n > 0n) { length++; n >>= 8n; }
  let zeroes = 0; while (value[zeroes] === "1") zeroes++;
  return length + zeroes === 64;
}
export const sequence = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const isoDate = (value: unknown): value is string => typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value)) && /^\d{4}-\d\d-\d\dT/.test(value);
export const integerAmount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
export function chatText(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && [...value].length <= MAX_CHAT_CHARACTERS && new TextEncoder().encode(value).length <= MAX_CHAT_BYTES && !/[\u0000-\u001f\u007f]/.test(value);
}
export function parseClientFrame(raw: string): ClientFrame | null {
  if (new TextEncoder().encode(raw).length > MAX_FRAME_BYTES) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== 1) return null;
  if (value.type === "auth" && exact(value, ["v", "type", "access_token"]) && typeof value.access_token === "string" && value.access_token.length >= 20 && value.access_token.length <= 8192) return value as ClientFrame;
  if (value.type === "chat.send" && exact(value, ["v", "type", "client_id", "body"]) && typeof value.client_id === "string" && UUID.test(value.client_id) && chatText(value.body)) return value as ClientFrame;
  if (value.type === "resume" && exact(value, ["v", "type", "after"]) && sequence(value.after)) return value as ClientFrame;
  if (value.type === "ping" && exact(value, ["v", "type"])) return value as ClientFrame;
  return null;
}
export function parsePublicEvent(value: unknown): PublicEvent | null {
  if (!object(value) || !exact(value, ["v", "stream", "id", "seq", "occurredAt", "kind", "payload"]) || value.v !== 1 || value.stream !== CHAT_STREAM || typeof value.id !== "string" || !UUID.test(value.id) || !sequence(value.seq) || value.seq === 0 || !isoDate(value.occurredAt) || !object(value.payload)) return null;
  const p = value.payload;
  if (value.kind === "chat.message" && exact(p, ["id", "wallet", "body", "createdAt"]) && typeof p.id === "string" && UUID.test(p.id) && publicKey(p.wallet) && chatText(p.body) && isoDate(p.createdAt)) return value as PublicEvent;
  if (value.kind === "chain.coinflip.settled" && exact(p, ["game", "transaction", "instructionId", "slot", "wallet", "stakeLamports", "payoutLamports", "settledAt"]) && p.game === "coinflip" && signature(p.transaction) && typeof p.instructionId === "string" && /^\d{1,4}:\d{1,4}:\d{1,5}$/.test(p.instructionId) && sequence(p.slot) && publicKey(p.wallet) && integerAmount(p.stakeLamports) && integerAmount(p.payoutLamports) && isoDate(p.settledAt)) return value as PublicEvent;
  if (value.kind === "chain.coinflip.placed" && exact(p, ["game", "transaction", "instructionId", "slot", "wallet", "stakeLamports", "acceptedAt"]) && p.game === "coinflip" && signature(p.transaction) && typeof p.instructionId === "string" && /^\d{1,4}:\d{1,4}:\d{1,5}$/.test(p.instructionId) && sequence(p.slot) && publicKey(p.wallet) && integerAmount(p.stakeLamports) && isoDate(p.acceptedAt)) return value as PublicEvent;
  return null;
}
/** Unknown/gap events must trigger replay, never silently advance the cursor. */
export function classifySequence(cursor: number, event: PublicEvent): "next" | "duplicate" | "gap" {
  return event.seq <= cursor ? "duplicate" : event.seq === cursor + 1 ? "next" : "gap";
}
