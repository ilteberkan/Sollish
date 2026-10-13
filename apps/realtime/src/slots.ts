/** Server-authoritative slot service (RGS), router and shared helpers. Authoritative text: docs/architecture/slot-rgs.md.
 * DEMO credits only. Nothing here touches a wallet, Supabase, a token or a chain; the real-asset gates stay closed.
 *
 * Trust boundary: the browser sends a bet, a mode, its own client seed and an idempotency key, nothing else. The
 * bearer token is minted here (random 32 bytes + a 16-byte HMAC tag, so forged tokens never reach a Durable Object),
 * travels only in the Authorization header, and is stored only as SHA-256 in the session's SlotWallet.
 */
import { slotBytesToHex, slotGame, SLOT_GAMES, SLOT_ROUND_ID_PATTERN, type SlotGameDefinition } from "@sollish/protocol";
import { ServiceError, allowedOrigin, bodyDigest, boundedText, type AuthEnv } from "./security";
import type { SlotWallet } from "./slot-wallet";
import type { SlotReplay } from "./slot-replay";
import type { SlotMonitor } from "./slot-monitor";

export interface SlotEnv {
  SLOTS_ENABLED?: string;
  /** Worker secret (>= 32 characters). Without it every isolate signs with its own random key: `signature.key = "dev"`. */
  SLOT_SIGNING_KEY?: string;
  /** Rounds per game/mode before the observed-RTP deviation check may log (default 1000). */
  SLOT_RTP_MIN_ROUNDS?: string;
  SLOT_WALLET?: DurableObjectNamespace<SlotWallet>;
  SLOT_REPLAY?: DurableObjectNamespace<SlotReplay>;
  SLOT_MONITOR?: DurableObjectNamespace<SlotMonitor>;
  /** The existing per-key admission gate (30 requests/minute), used per client IP for session creation and replay reads. */
  ADMISSION?: { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
}
export type SlotRouterEnv = SlotEnv & AuthEnv;

export const SLOT_LIMITS = Object.freeze({
  bodyBytes: 2048,
  startBalanceCents: 100_000,
  roundsPerSecond: 4,
  roundsPerMinute: 600,
  /** Every request to one session, in memory (GETs, retries and rejected calls included). */
  requestsPerSecond: 12,
  maxRoundsPerSession: 100_000,
  maxRotationsPerSession: 1_000,
  maxSharesPerSession: 500,
  sessionIdleMs: 7 * 24 * 60 * 60 * 1000,
  replayTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** Highest bet x maxMultiplier one round may expose (500 DEMO x 5000). */
  maxExposureCents: 250_000_000,
  historyRows: 50,
  revealedSeedsShown: 10,
  monitorFlushMs: 5_000,
  rtpMinRounds: 1_000,
  rtpAlertSigma: 4,
});

export type SlotErrorCode =
  | "AUTH_REQUIRED" | "AUTH_INVALID" | "SESSION_EXPIRED" | "FORBIDDEN" | "NOT_FOUND" | "UNKNOWN_GAME" | "INVALID_MESSAGE" | "INVALID_BET"
  | "INVALID_MODE" | "MESSAGE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "SESSION_BUSY" | "IDEMPOTENCY_CONFLICT" | "INSUFFICIENT_BALANCE"
  | "SESSION_LIMIT" | "RATE_LIMITED" | "ENGINE_RETIRED" | "SERVICE_UNAVAILABLE";
const STATUS: Record<SlotErrorCode, number> = {
  AUTH_REQUIRED: 401, AUTH_INVALID: 401, SESSION_EXPIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, UNKNOWN_GAME: 404, INVALID_MESSAGE: 400,
  INVALID_BET: 400, INVALID_MODE: 400, MESSAGE_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, SESSION_BUSY: 409, IDEMPOTENCY_CONFLICT: 409,
  INSUFFICIENT_BALANCE: 409, SESSION_LIMIT: 409, RATE_LIMITED: 429, ENGINE_RETIRED: 410, SERVICE_UNAVAILABLE: 503,
};
export class SlotError extends Error { constructor(readonly code: SlotErrorCode, readonly retryAfterSeconds?: number) { super(code); } }

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json; charset=utf-8" } as const;
export function slotJson(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...BASE_HEADERS, ...extra } });
}
export function slotErrorResponse(code: SlotErrorCode, retryAfterSeconds?: number): Response {
  const retry = retryAfterSeconds ?? (code === "SESSION_BUSY" ? 1 : code === "RATE_LIMITED" ? 1 : undefined);
  return slotJson({ code }, STATUS[code], retry === undefined ? {} : { "Retry-After": String(Math.max(1, Math.ceil(retry))) });
}
export function errorResponseFor(error: unknown): Response {
  if (error instanceof SlotError) return slotErrorResponse(error.code, error.retryAfterSeconds);
  if (error instanceof ServiceError && (error.code === "MESSAGE_TOO_LARGE" || error.code === "INVALID_MESSAGE")) return slotErrorResponse(error.code);
  return slotErrorResponse("SERVICE_UNAVAILABLE");
}

/* ---------------------------------------------------------------- strict bodies */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MODE_PATTERN = /^[a-z]{1,16}$/;
/** JSON object with exactly `keys` (none missing, none extra). An empty body counts as `{}` only when no key is required. */
export function parseExactObject(text: string, keys: readonly string[]): Record<string, unknown> {
  if (text === "" && keys.length === 0) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SlotError("INVALID_MESSAGE"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new SlotError("INVALID_MESSAGE");
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every(k => Object.hasOwn(value, k))) throw new SlotError("INVALID_MESSAGE");
  return value as Record<string, unknown>;
}
export interface RoundRequest { betCents: number; mode: string; clientSeed: string; idempotencyKey: string }
export function parseRoundBody(text: string): RoundRequest {
  const body = parseExactObject(text, ["betCents", "mode", "clientSeed", "idempotencyKey"]);
  if (typeof body.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey)) throw new SlotError("INVALID_MESSAGE");
  if (typeof body.clientSeed !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.clientSeed)) throw new SlotError("INVALID_MESSAGE");
  if (typeof body.betCents !== "number" || !Number.isSafeInteger(body.betCents) || body.betCents <= 0) throw new SlotError("INVALID_BET");
  if (typeof body.mode !== "string" || !MODE_PATTERN.test(body.mode)) throw new SlotError("INVALID_MODE");
  return { betCents: body.betCents, mode: body.mode, clientSeed: body.clientSeed, idempotencyKey: body.idempotencyKey };
}
/** Bet level, mode, integer cost and exposure against the game definition (the engine is never asked first). */
export function admitBet(game: SlotGameDefinition, betCents: number, mode: string): number {
  if (!game.betLevels.includes(betCents)) throw new SlotError("INVALID_BET");
  if (!game.modes.includes(mode)) throw new SlotError("INVALID_MODE");
  let cost: number;
  try { cost = game.cost(betCents, mode); } catch { throw new SlotError("INVALID_BET"); }
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new SlotError("INVALID_BET");
  if (!Number.isSafeInteger(betCents * game.maxMultiplier) || betCents * game.maxMultiplier > SLOT_LIMITS.maxExposureCents) throw new SlotError("INVALID_BET");
  return cost;
}

/* ---------------------------------------------------------------- keys, tokens, signatures */
const encoder = new TextEncoder();
let devSecret: string | null = null;
const keyCache = new Map<string, Promise<CryptoKey>>();
/** The Worker secret, or (dev/tests) one random key per isolate that never leaves memory. */
export function signingSecret(env: SlotEnv): { secret: string; kind: "worker" | "dev" } {
  const configured = env.SLOT_SIGNING_KEY;
  if (typeof configured === "string" && configured.length >= 32) return { secret: configured, kind: "worker" };
  devSecret ??= slotBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  return { secret: devSecret, kind: "dev" };
}
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) { key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); keyCache.set(secret, key); }
  return key;
}
export async function hmacHex(env: SlotEnv, message: string): Promise<string> {
  const key = await hmacKey(signingSecret(env).secret);
  return slotBytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}
export interface SlotSignature { alg: "HMAC-SHA256"; key: "worker" | "dev"; value: string }
export async function signText(env: SlotEnv, message: string): Promise<SlotSignature> {
  return { alg: "HMAC-SHA256", key: signingSecret(env).kind, value: await hmacHex(env, message) };
}
/** Equal-length lowercase hex compare without an early exit. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export const SLOT_TOKEN_PATTERN = /^[0-9a-f]{96}$/;
const tokenTag = async (env: SlotEnv, random: string) => (await hmacHex(env, `sollish-slot-token-1\n${random}`)).slice(0, 32);
export async function mintToken(env: SlotEnv): Promise<string> {
  const random = slotBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  return random + await tokenTag(env, random);
}
export async function tokenValid(env: SlotEnv, token: string): Promise<boolean> {
  if (!SLOT_TOKEN_PATTERN.test(token)) return false;
  return timingSafeEqualHex(token.slice(64), await tokenTag(env, token.slice(0, 64)));
}
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer ([0-9a-f]{96})$/.exec(header);
  return match ? match[1]! : "";
}
export async function sha256HexText(text: string): Promise<string> { return slotBytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))); }
export function rtpMinRounds(env: SlotEnv): number {
  const value = Number.parseInt(env.SLOT_RTP_MIN_ROUNDS ?? "", 10);
  return Number.isSafeInteger(value) && value >= 10 && value <= 100_000_000 ? value : SLOT_LIMITS.rtpMinRounds;
}

/* ---------------------------------------------------------------- router */
export const SLOT_PATH_PREFIX = "/v1/slots/";
const ROUND_PATH = /^\/v1\/slots\/([a-z][a-z0-9-]{0,31})\/rounds$/;
const LAST_PATH = /^\/v1\/slots\/([a-z][a-z0-9-]{0,31})\/rounds\/last$/;
const REPLAY_PATH = /^\/v1\/slots\/replay\/([^/]+)$/;
type Route = { op: "create" | "state" | "rotate" | "reset" | "history" | "share" | "round" | "last"; auth: boolean; post: boolean; game?: SlotGameDefinition };

function route(method: string, path: string): Route | "replay" | null {
  if (method === "GET" && REPLAY_PATH.test(path)) return "replay";
  if (path === "/v1/slots/session") return method === "POST" ? { op: "create", auth: false, post: true } : method === "GET" ? { op: "state", auth: true, post: false } : null;
  if (method === "POST" && path === "/v1/slots/seed/rotate") return { op: "rotate", auth: true, post: true };
  if (method === "POST" && path === "/v1/slots/balance/reset") return { op: "reset", auth: true, post: true };
  if (method === "GET" && path === "/v1/slots/history") return { op: "history", auth: true, post: false };
  if (method === "POST" && path === "/v1/slots/replay") return { op: "share", auth: true, post: true };
  const round = method === "POST" ? ROUND_PATH.exec(path) : null;
  const last = method === "GET" ? LAST_PATH.exec(path) : null;
  const id = round?.[1] ?? last?.[1];
  if (id === undefined) return null;
  const game = slotGame(id);
  if (!game) throw new SlotError("UNKNOWN_GAME");
  return { op: round ? "round" : "last", auth: true, post: !!round, game };
}

async function admit(env: SlotRouterEnv, scope: string, request: Request): Promise<boolean> {
  if (!env.ADMISSION) return true;
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const key = await bodyDigest(`${scope}:${signingSecret(env).secret}:${ip}`);
  const result = await env.ADMISSION.get(env.ADMISSION.idFromName(key)).fetch("https://internal/admit", { method: "POST" });
  return result.ok;
}
export function slotHealth(env: SlotRouterEnv): Response {
  if (env.SLOTS_ENABLED !== "true") return slotJson({ code: "SERVICE_UNAVAILABLE", service: "slots", enabled: false }, 503);
  const games = Object.values(SLOT_GAMES).map(g => ({ id: g.id, engineId: g.engineId, modes: g.modes, betLevels: g.betLevels, maxMultiplier: g.maxMultiplier }));
  return slotJson({ v: 1, service: "slots", enabled: true, demo: true, fair: "sollish-slot-fair-1", signature: signingSecret(env).kind, games, limits: { bodyBytes: SLOT_LIMITS.bodyBytes, roundsPerSecond: SLOT_LIMITS.roundsPerSecond, roundsPerMinute: SLOT_LIMITS.roundsPerMinute, startBalanceCents: SLOT_LIMITS.startBalanceCents } });
}

/** Handles every /v1/slots/* request. `origin` was already checked against ALLOWED_ORIGINS when present. */
export async function handleSlots(request: Request, env: SlotRouterEnv, url: URL): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = (response: Response): Response => {
    const out = new Response(response.body, response);
    if (origin && allowedOrigin(origin, env)) {
      out.headers.set("Access-Control-Allow-Origin", origin);
      out.headers.set("Access-Control-Expose-Headers", "Retry-After, Idempotent-Replayed");
    }
    out.headers.set("Vary", "Origin");
    return out;
  };
  try {
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin, env)) return slotErrorResponse("FORBIDDEN");
      return cors(new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" } }));
    }
    // Nothing is ever read from a query string; a token in a URL is refused outright.
    if (url.search) return cors(slotErrorResponse("INVALID_MESSAGE"));
    if (request.method === "GET" && url.pathname === "/v1/slots/health") return cors(slotHealth(env));
    if (env.SLOTS_ENABLED !== "true") return cors(slotErrorResponse("SERVICE_UNAVAILABLE"));
    if (!allowedOrigin(origin, env)) return slotErrorResponse("FORBIDDEN");
    const target = route(request.method, url.pathname);
    if (target === null) return cors(slotErrorResponse("NOT_FOUND"));
    if (!env.SLOT_WALLET || !env.SLOT_REPLAY) return cors(slotErrorResponse("SERVICE_UNAVAILABLE"));
    if (target === "replay") {
      const id = REPLAY_PATH.exec(url.pathname)![1]!;
      if (!SLOT_ROUND_ID_PATTERN.test(id)) return cors(slotErrorResponse("NOT_FOUND"));
      if (!await admit(env, "slots-replay", request)) return cors(slotErrorResponse("RATE_LIMITED", 60));
      const stub = env.SLOT_REPLAY.get(env.SLOT_REPLAY.idFromName(`replay:${id.slice(0, 2)}`));
      return cors(await stub.fetch("https://slot-replay.internal/get", { method: "POST", body: JSON.stringify({ id }) }));
    }
    let text = "";
    if (target.post) {
      const type = request.headers.get("Content-Type") ?? "";
      if (!/^application\/json(;\s*charset=utf-8)?$/i.test(type.trim())) return cors(slotErrorResponse("UNSUPPORTED_MEDIA_TYPE"));
      text = await boundedText(request, SLOT_LIMITS.bodyBytes);
    }
    let token: string;
    if (target.auth) {
      const presented = bearerToken(request);
      if (presented === null) return cors(slotErrorResponse("AUTH_REQUIRED"));
      if (!presented || !await tokenValid(env, presented)) return cors(slotErrorResponse("AUTH_INVALID"));
      token = presented;
    } else {
      if (request.headers.has("Authorization")) return cors(slotErrorResponse("INVALID_MESSAGE"));
      if (!await admit(env, "slots-session", request)) return cors(slotErrorResponse("RATE_LIMITED", 60));
      token = await mintToken(env);
    }
    const tokenHash = await sha256HexText(token);
    const stub = env.SLOT_WALLET.get(env.SLOT_WALLET.idFromName(`slot:${tokenHash}`));
    const headers: Record<string, string> = { "x-slot-token-hash": tokenHash };
    if (target.game) headers["x-slot-game"] = target.game.id;
    const response = await stub.fetch(`https://slot-wallet.internal/${target.op}`, { method: "POST", headers, body: text });
    if (target.op !== "create" || response.status !== 201) return cors(response);
    // The raw token exists only in this one response body; the Durable Object never sees it.
    const created = await response.json() as Record<string, unknown>;
    return cors(slotJson({ ...created, token }, 201));
  } catch (error) {
    return cors(errorResponseFor(error));
  }
}
