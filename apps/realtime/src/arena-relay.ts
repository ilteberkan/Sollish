/** Read-only viewer relays for a Ringside LIVE arena (docs/architecture/scale.md "Ringside LIVE fan-out").
 *
 * Tree: the arena Durable Object (root; sessions, tickets, ledger, simulation; ≤ 256 sockets) pushes every public
 * snapshot it broadcasts to LIVE_RELAYS relay objects ("relay:<arena>:<k>"), each of which holds up to
 * LIVE_RELAY_SOCKETS hibernated viewer sockets and forwards the snapshot bytes unchanged. Viewers never reach the root,
 * the ledger or a session: a relay socket accepts no command (betting stays on the root socket, same protocol as before).
 *
 * Backpressure: a snapshot is the full public state (idempotent, ordered by `revision`), so nothing has to be queued.
 * The root keeps only the LATEST pending snapshot per relay and sends at most one per LIVE_RELAY_MIN_INTERVAL_MS
 * (default 250 ms) per relay; a relay drops anything not newer than what it already has. A slow hop therefore skips
 * intermediate revisions instead of growing a queue. Late joiners get the relay's latest snapshot at once; a cold relay
 * (no snapshot yet, or woken after eviction) pulls one from the root ("/relay/sync").
 * Audience: while a relay has viewers it calls "/relay/sync" every 30 s; the root treats that as an open connection for
 * its "open the next round only while someone is there" rule, so a show watched only through relays keeps running.
 * Presentation only: nothing here can change a result, a ticket, a balance or a payout.
 */
import { DurableObject } from "cloudflare:workers";

/** Structural stub type so any Durable Object namespace binding fits. */
type NamespaceLike = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
export interface RelayEnv {
  LIVE_RELAYS?: string;
  LIVE_RELAY_SOCKETS?: string;
  LIVE_RELAY_MIN_INTERVAL_MS?: string;
  ARENA_RELAY?: NamespaceLike;
  CONTACT_ARENA_V5?: NamespaceLike;
}
/** Arenas that may publish to relays, and where a relay finds its root. Only the current shared LIVE arena (v5). */
export const RELAY_ROOTS = Object.freeze({ v5: { binding: "CONTACT_ARENA_V5", name: "ringside-match-v1" } } as const);
export type RelayArena = keyof typeof RELAY_ROOTS;
export const isRelayArena = (value: string | null): value is RelayArena => value !== null && Object.hasOwn(RELAY_ROOTS, value);
const intVar = (raw: string | undefined, min: number, max: number, fallback: number) => { const n = Number.parseInt(raw ?? "", 10); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback; };
/** 0 (default) = relays off: /watch answers 503 and arenas publish nowhere. */
export const relayCount = (env: RelayEnv) => intVar(env.LIVE_RELAYS, 0, 256, 0);
export const relaySocketCap = (env: RelayEnv) => intVar(env.LIVE_RELAY_SOCKETS, 1, 32_000, 2_000);
export const relayMinIntervalMs = (env: RelayEnv) => intVar(env.LIVE_RELAY_MIN_INTERVAL_MS, 0, 10_000, 250);
export const relayName = (arena: RelayArena, k: number) => `relay:${arena}:${k}`;
export const RELAY_HEARTBEAT_MS = 30_000;
/** How long one relay heartbeat counts as an audience at the root. */
export const RELAY_AUDIENCE_MS = 90_000;

/** Root side: latest-only, rate-limited push of one arena's snapshots to its relays. */
export class RelayPublisher {
  private pending = new Map<number, string>();
  private busy = new Set<number>();
  private lastSent = new Map<number, number>();
  constructor(private readonly arena: RelayArena, private readonly env: RelayEnv) {}
  publish(body: string): void {
    const n = relayCount(this.env), ns = this.env.ARENA_RELAY;
    if (!n || !ns) return;
    for (let k = 0; k < n; k++) { this.pending.set(k, body); if (!this.busy.has(k)) void this.pump(k, ns); }
  }
  private async pump(k: number, ns: NamespaceLike): Promise<void> {
    this.busy.add(k);
    try {
      for (;;) {
        const gap = (this.lastSent.get(k) ?? 0) + relayMinIntervalMs(this.env) - Date.now();
        if (gap > 0) await new Promise(r => setTimeout(r, gap));
        const body = this.pending.get(k);
        if (body === undefined) break;
        this.pending.delete(k);
        this.lastSent.set(k, Date.now());
        // A lost push is repaired by the next snapshot or by the relay's own 30 s /relay/sync.
        try { await ns.get(ns.idFromName(relayName(this.arena, k))).fetch("https://relay.internal/publish", { method: "POST", body }); } catch { /* see above */ }
      }
    } finally { this.busy.delete(k); }
  }
}

type ViewerAttachment = { at: number; window: number; count: number };
type Last = { revision: number; body: string };
const revisionOf = (body: string): number | null => {
  try { const v = JSON.parse(body) as { v?: unknown; type?: unknown; revision?: unknown }; return v.type === "snapshot" && typeof v.revision === "number" && Number.isSafeInteger(v.revision) ? v.revision : null; } catch { return null; }
};

export class ArenaRelay extends DurableObject<RelayEnv> {
  private last: Last | null = null;
  private loaded = false;
  private async latest(): Promise<Last | null> {
    if (!this.loaded) { this.last = (await this.ctx.storage.get<Last>("last")) ?? null; this.loaded = true; }
    return this.last;
  }
  private async accept(body: string): Promise<boolean> {
    const revision = revisionOf(body);
    if (revision === null) return false;
    const current = await this.latest();
    if (current && revision <= current.revision) return false;
    this.last = { revision, body };
    await this.ctx.storage.put("last", this.last);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(body); } catch { try { ws.close(1011, "RECONNECT"); } catch { /* closed */ } } }
    return true;
  }
  /** Heartbeat + pull from the root; also repairs a missed push. */
  private async sync(): Promise<void> {
    const arena = await this.ctx.storage.get<string>("arena");
    if (!isRelayArena(arena ?? null)) return;
    const root = RELAY_ROOTS[arena as RelayArena], ns = this.env[root.binding];
    if (!ns) return;
    try {
      const res = await ns.get(ns.idFromName(root.name)).fetch("https://internal/relay/sync", { method: "POST" });
      if (res.ok) await this.accept(await res.text());
    } catch { /* next heartbeat */ }
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/publish" && request.method === "POST") return Response.json({ accepted: await this.accept(await request.text()) });
    if (path !== "/connect" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return Response.json({ code: "INVALID_MESSAGE" }, { status: 400 });
    const arena = request.headers.get("x-relay-arena");
    if (!isRelayArena(arena)) return Response.json({ code: "INVALID_MESSAGE" }, { status: 400 });
    if (this.ctx.getWebSockets().length >= relaySocketCap(this.env)) return Response.json({ code: "CAPACITY" }, { status: 503 });
    if ((await this.ctx.storage.get<string>("arena")) !== arena) await this.ctx.storage.put("arena", arena);
    const first = this.ctx.getWebSockets().length === 0;
    if (!(await this.latest()) || first) await this.sync();
    const pair = new WebSocketPair(), [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ at: now, window: now, count: 0 } satisfies ViewerAttachment);
    const last = await this.latest();
    if (last) server.send(last.body);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + RELAY_HEARTBEAT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
  /** Viewer sockets are read-only. Anything sent is counted; more than 20 messages a minute closes the socket. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const a = ws.deserializeAttachment() as ViewerAttachment, now = Date.now();
    if (typeof message !== "string" || message.length > 256) { ws.close(1009, "MESSAGE_TOO_LARGE"); return; }
    if (now - a.window >= 60_000) { a.window = now; a.count = 0; }
    a.count++; ws.serializeAttachment(a);
    if (a.count > 20) { ws.close(1008, "RATE_LIMITED"); return; }
    // A viewer may ask for the latest snapshot again (e.g. after a hidden tab); nothing else is understood.
    if (message === '{"v":2,"type":"sync"}' && this.last) ws.send(this.last.body);
  }
  webSocketClose(ws: WebSocket, code: number, reason: string): void { try { ws.close(code, reason); } catch { /* closed */ } }
  webSocketError(ws: WebSocket): void { try { ws.close(1011, "RECONNECT"); } catch { /* closed */ } }
  async alarm(): Promise<void> {
    if (!this.ctx.getWebSockets().length) return;
    await this.sync();
    await this.ctx.storage.setAlarm(Date.now() + RELAY_HEARTBEAT_MS);
  }
}
