import { DurableObject } from "cloudflare:workers";
import { MAX_FRAME_BYTES, MAX_SERVER_FRAME_BYTES, parseClientFrame, parsePublicEvent, sequence, type ErrorCode, type PublicEvent, type PublicStatus, type ServerFrame } from "@sollish/protocol";
import { ServiceError, activeSession, allowedOrigin, authenticate, boundedText, bodyDigest, configured, dbRpc, verifyPublisher, type AuthEnv, type Identity } from "./security";

import { LiveArena } from "./live-arena";
import { RingsideArena, ContactArena, ContactArenaV4 } from "./ringside-arena";
import { ContactArenaV5 } from "./contact-arena-v5";
import { SLOT_PATH_PREFIX, handleSlots, type SlotEnv } from "./slots";
import { SlotWallet } from "./slot-wallet";
import { SlotReplay } from "./slot-replay";
import { SlotMonitor } from "./slot-monitor";
export { RingsideArena, ContactArena, ContactArenaV4, ContactArenaV5 };
export { LiveArena };
export { SlotWallet, SlotReplay, SlotMonitor };

export interface Env extends AuthEnv, SlotEnv { CONTACT_ARENA: DurableObjectNamespace<ContactArena>; CONTACT_ARENA_V4: DurableObjectNamespace<ContactArenaV4>; CONTACT_ARENA_V5: DurableObjectNamespace<ContactArenaV5>; RINGSIDE_ARENA: DurableObjectNamespace<RingsideArena>; LIVE_ARENA: DurableObjectNamespace<LiveArena>; LIVE_ARENA_ENABLED?: string; ROOMS: DurableObjectNamespace<RoomCoordinator>; BUCKETS: DurableObjectNamespace<FanoutBucket>; ADMISSION: DurableObjectNamespace<AdmissionGate>; FANOUT_BUCKETS?: string }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const errorCode = (e: unknown): ErrorCode => e instanceof ServiceError ? e.code : "SERVICE_UNAVAILABLE";
const buckets = (env: Env) => Math.max(1, Math.min(64, Number.parseInt(env.FANOUT_BUCKETS ?? "8", 10) || 8));
export async function snapshot(env: Env, after: number): Promise<Extract<ServerFrame, { type: "snapshot" }>> {
  const raw = await dbRpc<Record<string, unknown>>(env, "chat_snapshot", { p_after: after, p_limit: 100 }, true);
  if (raw.v !== 1 || raw.type !== "snapshot" || raw.stream !== "lobby" || !sequence(raw.seq) || typeof raw.truncated !== "boolean" || !Array.isArray(raw.events) || raw.events.length > 200) throw new ServiceError("SERVICE_UNAVAILABLE");
  const events: PublicEvent[] = [];
  for (const value of raw.events) { const event = parsePublicEvent(value); if (!event || event.seq > raw.seq || events.at(-1)?.seq === event.seq) throw new ServiceError("SERVICE_UNAVAILABLE"); events.push(event); }
  if (events.some((e, i) => i > 0 && e.seq <= events[i - 1].seq)) throw new ServiceError("SERVICE_UNAVAILABLE");
  return { v: 1, type: "snapshot", stream: "lobby", seq: raw.seq, events, truncated: raw.truncated };
}
async function status(env: Env): Promise<PublicStatus> {
  const base: PublicStatus = { v: 1, chain: "solana-devnet", finality: "finalized", availability: "unavailable", now: new Date().toISOString(), lastIndexedSlot: null, games: [{ id: "coinflip", available: false, reason: "WALLET_TO_CHAIN_DEPLOYMENT_REQUIRES_VERIFICATION" }, { id: "crash", available: false, reason: "PER_SECURITY_ACCEPTANCE_PENDING" }], chat: { available: false, windowSeconds: 3600, minWagerLamports: null }, rewards: { available: false, claimable: null, authority: "on-chain", reason: "READ_VERIFIED_CONTRACT_ACCOUNTS" } };
  if (!configured(env)) return base;
  try {
    const state = await dbRpc<{ indexFresh?: unknown; lastIndexedSlot?: unknown; chatMinWagerLamports?: unknown }>(env, "platform_status", {}, true);
    if (sequence(state.lastIndexedSlot)) base.lastIndexedSlot = state.lastIndexedSlot;
    if (typeof state.chatMinWagerLamports === "string" && /^[1-9]\d{0,19}$/.test(state.chatMinWagerLamports)) base.chat.minWagerLamports = state.chatMinWagerLamports;
    base.chat.available = state.indexFresh === true && base.chat.minWagerLamports !== null;
    base.availability = base.chat.available ? "operational" : "unavailable";
  } catch { /* explicit unavailable, no invented history or rewards */ }
  return base;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get("Origin");
    if (origin && !allowedOrigin(origin, env)) return json({ code: "FORBIDDEN" }, 403);
    // DEMO slot service (default off: SLOTS_ENABLED). Own CORS, body, auth and rate rules: src/slots.ts.
    if (url.pathname.startsWith(SLOT_PATH_PREFIX)) return handleSlots(request, env, url);
    const cors = (response: Response) => { if (origin) { response.headers.set("Access-Control-Allow-Origin", origin); response.headers.set("Vary", "Origin"); } return response; };
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } }));
    try {
      if (url.pathname === "/health") { const ready = (await status(env)).chat.available; return cors(json({ service: "realtime", ready, status: ready ? "operational" : "unavailable" }, ready ? 200 : 503)); }
      if (request.method === "GET" && url.pathname === "/v1/public/status") return cors(json(await status(env)));
      if (request.method === "GET" && ["/v1/arena/ringside", "/v2/arena/ringside", "/v3/arena/ringside", "/v4/arena/ringside", "/v5/arena/ringside"].includes(url.pathname)) {
        if (!allowedOrigin(origin, env)) return json({ code: "FORBIDDEN" }, 403);
        if (env.LIVE_ARENA_ENABLED !== "true") return json({ code: "SERVICE_UNAVAILABLE" }, 503);
        if (url.search || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ code: "INVALID_MESSAGE" }, 400);
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        const key = await bodyDigest(`arena:${env.PUBLISH_SIGNING_KEY ?? "local-demo"}:${ip}`);
        const admitted = await env.ADMISSION.get(env.ADMISSION.idFromName(key)).fetch("https://internal/admit", { method: "POST" });
        if (!admitted.ok) return json({ code: "RATE_LIMITED" }, 429);
        return url.pathname === "/v5/arena/ringside"
          ? env.CONTACT_ARENA_V5.get(env.CONTACT_ARENA_V5.idFromName("ringside-match-v1")).fetch(new Request("https://internal/connect", request))
          : url.pathname === "/v4/arena/ringside"
          ? env.CONTACT_ARENA_V4.get(env.CONTACT_ARENA_V4.idFromName("ringside-contact-v4")).fetch(new Request("https://internal/connect", request))
          : url.pathname === "/v3/arena/ringside"
          ? env.CONTACT_ARENA.get(env.CONTACT_ARENA.idFromName("ringside-contact-v3")).fetch(new Request("https://internal/connect", request))
          : url.pathname === "/v2/arena/ringside"
          ? env.RINGSIDE_ARENA.get(env.RINGSIDE_ARENA.idFromName("ringside-pools-v2")).fetch(new Request("https://internal/connect", request))
          : env.LIVE_ARENA.get(env.LIVE_ARENA.idFromName("ringside-demo-v1")).fetch(new Request("https://internal/connect", request));
      }
      if (request.method === "GET" && url.pathname === "/v1/chat/history") {
        if (!configured(env)) return cors(json({ code: "SERVICE_UNAVAILABLE", events: [] }, 503));
        const after = Number(url.searchParams.get("after") ?? "0"); if (!sequence(after)) return cors(json({ code: "INVALID_MESSAGE" }, 400));
        return cors(json(await snapshot(env, after)));
      }
      if (request.method === "GET" && url.pathname === "/v1/rooms/lobby" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        if (!allowedOrigin(origin, env)) return json({ code: "FORBIDDEN" }, 403);
        if (!configured(env)) return json({ code: "SERVICE_UNAVAILABLE" }, 503);
        if ([...url.searchParams.keys()].some(k => k !== "after")) return json({ code: "INVALID_MESSAGE" }, 400);
        const after = Number(url.searchParams.get("after") ?? "0"); if (!sequence(after)) return json({ code: "INVALID_MESSAGE" }, 400);
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        const key = await bodyDigest(`${env.PUBLISH_SIGNING_KEY}:${ip}`);
        const admitted = await env.ADMISSION.get(env.ADMISSION.idFromName(key)).fetch("https://internal/admit", { method: "POST" });
        if (!admitted.ok) return json({ code: "RATE_LIMITED" }, 429);
        const bucket = crypto.getRandomValues(new Uint32Array(1))[0] % buckets(env);
        const target = new URL("https://internal/connect"); target.searchParams.set("after", String(after));
        return env.BUCKETS.get(env.BUCKETS.idFromName(`lobby:${bucket}`)).fetch(new Request(target, request));
      }
      if (request.method === "POST" && url.pathname === "/internal/publish") {
        if (Number(request.headers.get("Content-Length") ?? "0") > 8192) return json({ code: "MESSAGE_TOO_LARGE" }, 413);
        const text = await boundedText(request, 8192);
        if (new TextEncoder().encode(text).length > 8192 || !await verifyPublisher(request, text, env)) return json({ code: "FORBIDDEN" }, 403);
        let event: PublicEvent | null = null; try { event = parsePublicEvent(JSON.parse(text)); } catch { /* fixed response */ }
        if (!event) return json({ code: "INVALID_MESSAGE" }, 400);
        return env.ROOMS.get(env.ROOMS.idFromName("lobby")).fetch("https://internal/publish", { method: "POST", body: JSON.stringify(event) });
      }
      return cors(json({ code: "NOT_FOUND" }, 404));
    } catch (error) { return cors(json({ code: errorCode(error) }, error instanceof ServiceError ? error.status : 503)); }
  },
};

export class AdmissionGate extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const now = Date.now(), old = await this.ctx.storage.get<{ since: number; count: number }>("window");
    const state = old && now - old.since < 60_000 ? old : { since: now, count: 0 };
    if (state.count >= 30) return new Response(null, { status: 429 });
    state.count++; await this.ctx.storage.put("window", state); await this.ctx.storage.setAlarm(now + 120_000); return new Response(null, { status: 204 });
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}
export class RoomCoordinator extends DurableObject<Env> {
  private pending: Promise<unknown> = Promise.resolve();
  fetch(request: Request): Promise<Response> {
    const result = this.pending.then(() => this.publish(request));
    this.pending = result.catch(() => undefined);
    return result;
  }
  private async publish(request: Request): Promise<Response> {
    const event = parsePublicEvent(await request.json()); if (!event) return json({ code: "INVALID_MESSAGE" }, 400);
    const old = await this.ctx.storage.get<{ seq: number; id: string }>("tail");
    if (old && event.seq <= old.seq) {
      const known = await this.ctx.storage.get<string>(`event:${event.seq}`);
      return known === event.id ? json({ duplicate: true }) : json({ code: "PUBLISH_CONFLICT" }, 409);
    }
    // DB is the sole sequence source. A gap is explicit and forces every live
    // subscriber to reload its bounded durable snapshot; it is never hidden.
    const gap = event.seq !== (old?.seq ?? 0) + 1;
    const results = await Promise.all(Array.from({ length: buckets(this.env) }, (_, i) => this.env.BUCKETS.get(this.env.BUCKETS.idFromName(`lobby:${i}`)).fetch("https://internal/event", { method: "POST", body: JSON.stringify({ event, gap }) })));
    if (results.some(r => !r.ok)) return json({ code: "SERVICE_UNAVAILABLE" }, 503);
    await this.ctx.storage.put({ tail: { seq: event.seq, id: event.id }, [`event:${event.seq}`]: event.id });
    if (event.seq > 200) await this.ctx.storage.delete(`event:${event.seq - 200}`);
    return json({ accepted: true });
  }
}
type Attachment = { deadline: number; after: number; identity?: Identity; windowStart: number; count: number };
export class FanoutBucket extends DurableObject<Env> {
  private synchronizing = new Map<WebSocket, Promise<void>>();
  private send(ws: WebSocket, message: ServerFrame): void { try { const encoded = JSON.stringify(message); if (new TextEncoder().encode(encoded).length > MAX_SERVER_FRAME_BYTES) throw new Error("FRAME_LIMIT"); ws.send(encoded); } catch { try { ws.close(1013, "RECONNECT"); } catch { /* socket already closed */ } } }
  private state(ws: WebSocket): Attachment { return ws.deserializeAttachment() as Attachment; }
  private save(ws: WebSocket, state: Attachment): void { const latest = this.state(ws); ws.serializeAttachment({ ...state, windowStart: latest.windowStart, count: latest.count }); }
  private async alarmSoon(): Promise<void> {
    const sockets = this.ctx.getWebSockets(); if (!sockets.length) return;
    const next = Math.min(Date.now() + 60_000, ...sockets.map(ws => this.state(ws).identity?.expiresAt ?? this.state(ws).deadline));
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 100));
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (this.ctx.getWebSockets().length >= 256) return json({ code: "RATE_LIMITED" }, 429);
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const after = Number(url.searchParams.get("after") ?? "0");
      server.serializeAttachment({ deadline: Date.now() + 10_000, after, windowStart: Date.now(), count: 0 } satisfies Attachment);
      this.send(server, { v: 1, type: "auth.required", deadline: new Date(Date.now() + 10_000).toISOString() });
      await this.alarmSoon(); return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/event") {
      const body = await request.json() as { event: unknown; gap: boolean }; const event = parsePublicEvent(body.event);
      if (!event) return json({ code: "INVALID_MESSAGE" }, 400);
      const latest = await this.ctx.storage.get<{ seq: number; id: string }>("tail");
      if (latest && event.seq <= latest.seq) return latest.seq === event.seq && latest.id !== event.id ? json({ code: "PUBLISH_CONFLICT" }, 409) : json({ duplicate: true });
      await Promise.all([...this.synchronizing.values()]);
      for (const ws of this.ctx.getWebSockets()) {
        const state = this.state(ws); if (!state.identity) continue;
        if (state.identity.expiresAt <= Date.now()) { ws.close(4001, "AUTH_EXPIRED"); continue; }
        if (body.gap || event.seq !== state.after + 1 && event.seq > state.after) { this.send(ws, { v: 1, type: "error", code: "REPLAY_REQUIRED" }); ws.close(1012, "REPLAY_REQUIRED"); continue; }
        if (event.seq <= state.after) continue;
        this.send(ws, { v: 1, type: "event", event }); state.after = event.seq; this.save(ws, state);
      }
      await this.ctx.storage.put("tail", { seq: event.seq, id: event.id }); return json({ accepted: true });
    }
    return new Response(null, { status: 404 });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const state = this.state(ws), now = Date.now();
    if (typeof message !== "string" || new TextEncoder().encode(message).length > MAX_FRAME_BYTES) { ws.close(1009, "MESSAGE_TOO_LARGE"); return; }
    if (now - state.windowStart > 60_000) { state.windowStart = now; state.count = 0; }
    state.count++; ws.serializeAttachment(state);
    if (state.count > 40) { ws.close(1008, "RATE_LIMITED"); return; }
    if (this.synchronizing.has(ws)) { ws.close(1008, "RATE_LIMITED"); return; }
    const pending = this.handleMessage(ws, message);
    this.synchronizing.set(ws, pending);
    try { await pending; } finally { if (this.synchronizing.get(ws) === pending) this.synchronizing.delete(ws); }
  }
  private async handleMessage(ws: WebSocket, message: string): Promise<void> {
    const state = this.state(ws), now = Date.now();
    const frame = parseClientFrame(message); if (!frame) { this.send(ws, { v: 1, type: "error", code: "INVALID_MESSAGE" }); return; }
    try {
      if (frame.type === "auth") {
        const identity = await authenticate(frame.access_token, this.env);
        if (state.identity && state.identity.userId !== identity.userId) throw new ServiceError("FORBIDDEN", 403);
        state.identity = identity; this.save(ws, state);
        this.send(ws, { v: 1, type: "hello", stream: "lobby", wallet: identity.wallet, expiresAt: new Date(identity.expiresAt).toISOString() });
        const view = await snapshot(this.env, state.after); this.send(ws, view); state.after = view.seq; this.save(ws, state); await this.alarmSoon(); return;
      }
      if (!state.identity) throw new ServiceError("AUTH_REQUIRED", 401);
      if (state.identity.expiresAt <= now) { ws.close(4001, "AUTH_EXPIRED"); return; }
      if (frame.type === "ping") { this.send(ws, { v: 1, type: "pong" }); return; }
      const wallet = await activeSession(state.identity, this.env); if (state.identity.expiresAt <= Date.now()) throw new ServiceError("AUTH_EXPIRED", 401); if (wallet !== state.identity.wallet) throw new ServiceError("AUTH_INVALID", 401);
      if (frame.type === "resume") { const view = await snapshot(this.env, frame.after); this.send(ws, view); state.after = view.seq; this.save(ws, state); return; }
      const event = parsePublicEvent(await dbRpc(this.env, "submit_chat", { p_user: state.identity.userId, p_session: state.identity.sessionId, p_client_id: frame.client_id, p_body: frame.body }));
      if (!event) throw new ServiceError("SERVICE_UNAVAILABLE");
      this.send(ws, { v: 1, type: "chat.accepted", client_id: frame.client_id, event_id: event.id, seq: event.seq });
    } catch (error) { this.send(ws, { v: 1, type: "error", code: errorCode(error) }); if (error instanceof ServiceError && ["AUTH_INVALID", "AUTH_EXPIRED", "FORBIDDEN"].includes(error.code)) ws.close(4001, error.code); }
  }
  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws);
      if ((state.identity?.expiresAt ?? state.deadline) <= Date.now()) { ws.close(4001, "AUTH_EXPIRED"); continue; }
      if (state.identity) { try { if (await activeSession(state.identity, this.env) !== state.identity.wallet) ws.close(4001, "AUTH_INVALID"); } catch { ws.close(4001, "AUTH_INVALID"); } }
    }
    await this.alarmSoon();
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> { try { ws.close(code, reason); } catch { /* already closed */ } await this.alarmSoon(); }
  webSocketError(ws: WebSocket): void { try { ws.close(1011, "RECONNECT"); } catch { /* already closed */ } }
}
