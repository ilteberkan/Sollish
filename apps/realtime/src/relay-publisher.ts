/** Pure parts of the Ringside LIVE viewer relays (no Durable Object imports, unit-testable in Node). The relay object and
 * the full design note: arena-relay.ts, docs/architecture/scale.md §5. */
/** Structural stub type so any Durable Object namespace binding fits. */
export type NamespaceLike = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
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

