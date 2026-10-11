import { createRemoteJWKSet, jwtVerify } from "jose";
import { UUID, publicKey, type ErrorCode } from "@sollish/protocol";
export interface AuthEnv {
  SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  PUBLISH_SIGNING_KEY?: string; ALLOWED_ORIGINS?: string; ALLOW_LOCAL_AUTH?: string;
}
export class ServiceError extends Error { constructor(public code: ErrorCode, public status = 503) { super(code); } }
const knownErrors = new Set<ErrorCode>(["AUTH_INVALID", "AUTH_EXPIRED", "FORBIDDEN", "RATE_LIMITED", "INVALID_MESSAGE", "CHAT_INELIGIBLE", "CHAT_UNAVAILABLE"]);
export function authBase(env: AuthEnv): string {
  if (!env.SUPABASE_URL) throw new ServiceError("SERVICE_UNAVAILABLE");
  const url = new URL(env.SUPABASE_URL);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.protocol !== "https:" && !(url.protocol === "http:" && loopback && env.ALLOW_LOCAL_AUTH === "true")) throw new ServiceError("SERVICE_UNAVAILABLE");
  return url.origin;
}
export function configured(env: AuthEnv): boolean {
  try { authBase(env); return !!env.SUPABASE_ANON_KEY && !!env.SUPABASE_SERVICE_ROLE_KEY && (env.PUBLISH_SIGNING_KEY?.length ?? 0) >= 32 && originList(env).length > 0; } catch { return false; }
}
export function originList(env: AuthEnv): string[] {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(v => {
    try { const u = new URL(v); return u.origin === v && (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)); } catch { return false; }
  });
}
export function allowedOrigin(origin: string | null, env: AuthEnv): boolean { return origin !== null && originList(env).includes(origin); }
export async function dbRpc<T>(env: AuthEnv, name: string, body: unknown, publicRead = false): Promise<T> {
  const key = publicRead ? env.SUPABASE_ANON_KEY : env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ServiceError("SERVICE_UNAVAILABLE");
  let response: Response;
  try {
    response = await fetch(`${authBase(env)}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  } catch { throw new ServiceError("SERVICE_UNAVAILABLE"); }
  if (!response.ok) {
    let error: { message?: unknown } = {}; try { error = await response.json(); } catch { /* never log response */ }
    if (typeof error.message === "string" && knownErrors.has(error.message as ErrorCode)) throw new ServiceError(error.message as ErrorCode, 403);
    throw new ServiceError("SERVICE_UNAVAILABLE");
  }
  try { return await response.json() as T; } catch { throw new ServiceError("SERVICE_UNAVAILABLE"); }
}
export type Identity = { userId: string; sessionId: string; wallet: string; expiresAt: number };
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function activeSession(identity: Pick<Identity, "userId" | "sessionId">, env: AuthEnv): Promise<string> {
  const result = await dbRpc<{ wallet?: unknown }>(env, "verify_chat_session", { p_user: identity.userId, p_session: identity.sessionId });
  if (!publicKey(result.wallet)) throw new ServiceError("AUTH_INVALID", 401);
  return result.wallet;
}
export async function authenticate(token: string, env: AuthEnv): Promise<Identity> {
  const base = authBase(env);
  if (!env.SUPABASE_ANON_KEY) throw new ServiceError("SERVICE_UNAVAILABLE");
  let keys = jwks.get(base);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), { timeoutDuration: 5000, cacheMaxAge: 300_000 }); jwks.set(base, keys); }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `${base}/auth/v1`, audience: "authenticated", algorithms: ["ES256", "RS256"], clockTolerance: 0 });
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub) || typeof payload.session_id !== "string" || !UUID.test(payload.session_id) || payload.role !== "authenticated" || typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) throw new Error("invalid claims");
    // getUser checks the live Auth user; SQL additionally checks the current
    // auth.sessions row and immutable provider identity, never user_metadata.
    const user = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) });
    if (!user.ok || (await user.json() as { id?: unknown }).id !== payload.sub) throw new Error("invalid user");
    const identity = { userId: payload.sub, sessionId: payload.session_id, expiresAt: payload.exp * 1000 };
    const wallet = await activeSession(identity, env);
    if (identity.expiresAt <= Date.now()) throw new ServiceError("AUTH_EXPIRED", 401);
    return { ...identity, wallet };
  } catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError("AUTH_INVALID", 401); }
}
export async function bodyDigest(body: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
export async function verifyPublisher(request: Request, body: string, env: AuthEnv, now = Date.now()): Promise<boolean> {
  if (!env.PUBLISH_SIGNING_KEY || env.PUBLISH_SIGNING_KEY.length < 32) return false;
  const stamp = request.headers.get("x-sollish-timestamp"), nonce = request.headers.get("x-sollish-request-id"), signature = request.headers.get("x-sollish-signature");
  if (!stamp || !/^\d{13}$/.test(stamp) || Math.abs(Number(stamp) - now) > 30_000 || !nonce || !UUID.test(nonce) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PUBLISH_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const message = `POST\n/internal/publish\n${stamp}\n${nonce}\n${await bodyDigest(body)}`;
  return crypto.subtle.verify("HMAC", key, Uint8Array.from(signature.match(/../g)!, h => parseInt(h, 16)), new TextEncoder().encode(message));
}

/** Enforce the cap while consuming, including chunked requests without Content-Length. */
export async function boundedText(request: Request, limit: number): Promise<string> {
  if (Number(request.headers.get("Content-Length") ?? "0") > limit) throw new ServiceError("MESSAGE_TOO_LARGE", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) { await reader.cancel(); throw new ServiceError("MESSAGE_TOO_LARGE", 413); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { throw new ServiceError("INVALID_MESSAGE", 400); }
}
