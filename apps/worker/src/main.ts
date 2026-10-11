import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import postgres from "postgres";
import { Connection } from "@solana/web3.js";
import { Keeper, KeeperJournal, keeperConfig, loadFeeKey } from "./keeper";
import { parsePublicEvent, publicKey, sequence, signature } from "@sollish/protocol";
import { GENESIS, GAMES, finalizedFacts, rpc, verifyDeployment } from "./chain";

export interface WorkerConfig { databaseUrl: string; rpcUrl: string; house: string; codeHash: string; realtimeUrl: string; publishKey: string }
export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig | null {
  const { DATABASE_URL, SOLANA_RPC_URL, HOUSE_ADDRESS, GAMES_PROGRAM_DATA_SHA256, REALTIME_URL, PUBLISH_SIGNING_KEY } = env;
  if (!DATABASE_URL || !SOLANA_RPC_URL || !HOUSE_ADDRESS || !GAMES_PROGRAM_DATA_SHA256 || !REALTIME_URL || !PUBLISH_SIGNING_KEY) return null;
  const db = new URL(DATABASE_URL), rpcUrl = new URL(SOLANA_RPC_URL), realtime = new URL(REALTIME_URL);
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !/^sollish_worker(?:\.[a-z0-9]{20})?$/.test(decodeURIComponent(db.username)) || rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password || realtime.username || realtime.password || realtime.search || realtime.hash || realtime.pathname !== "/" || !publicKey(HOUSE_ADDRESS) || !/^[0-9a-f]{64}$/.test(GAMES_PROGRAM_DATA_SHA256) || PUBLISH_SIGNING_KEY.length < 32 || (realtime.protocol !== "https:" && !(realtime.protocol === "http:" && ["localhost", "127.0.0.1"].includes(realtime.hostname)))) throw new Error("INVALID_WORKER_CONFIG");
  return { databaseUrl: DATABASE_URL, rpcUrl: SOLANA_RPC_URL, house: HOUSE_ADDRESS, codeHash: GAMES_PROGRAM_DATA_SHA256, realtimeUrl: realtime.origin, publishKey: PUBLISH_SIGNING_KEY };
}
export function publishHeaders(body: string, key: string, timestamp = Date.now(), id = randomUUID()): Record<string, string> {
  const digest = createHash("sha256").update(body).digest("hex"), stamp = String(timestamp);
  return { "Content-Type": "application/json", "x-sollish-timestamp": stamp, "x-sollish-request-id": id, "x-sollish-signature": createHmac("sha256", key).update(`POST\n/internal/publish\n${stamp}\n${id}\n${digest}`).digest("hex") };
}
export async function indexOnce(sql: postgres.Sql, config: WorkerConfig): Promise<void> {
  const session = await sql.reserve();
  try {
    const role = await session`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    if (role.length !== 1 || role[0].rolsuper || role[0].rolbypassrls) throw new Error("PRIVILEGED_DATABASE_ROLE");
    const lock = await session`select pg_try_advisory_lock(hashtextextended('sollish:indexer:coinflip',31)) as locked`;
    if (!lock[0].locked) return;
    await verifyDeployment(config.rpcUrl, config.codeHash);
    const head = await rpc(config.rpcUrl, "getSlot", [{ commitment: "finalized" }]); if (!sequence(head)) throw new Error("INVALID_FINALIZED_HEAD");
    const cursor = (await session`select public.chain_cursor() as cursor`)[0].cursor as { signature: string | null } | null;
    let before: string | undefined;
    const pending: { signature: string; slot: number; err: unknown }[] = [];
    let complete = false;
    for (let page = 0; page < 20; page++) {
      const rows = await rpc(config.rpcUrl, "getSignaturesForAddress", [GAMES, { commitment: "finalized", limit: 1000, ...(before ? { before } : {}), ...(cursor?.signature ? { until: cursor.signature } : {}) }]);
      if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !signature(row.signature) || !sequence(row.slot))) throw new Error("INVALID_SIGNATURE_HISTORY");
      pending.push(...rows.filter(row => row.slot <= head));
      if (rows.length < 1000) { complete = true; break; }
      before = rows.at(-1).signature;
    }
    if (!complete) throw new Error("BACKFILL_LIMIT_REQUIRES_REVIEW");
    let newest = cursor?.signature ?? null;
    for (const item of pending.reverse()) {
      if (!item.err) {
        const tx = await rpc(config.rpcUrl, "getTransaction", [item.signature, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
        if (!tx) throw new Error("FINALIZED_TRANSACTION_UNAVAILABLE");
        for (const fact of finalizedFacts(tx, item.signature, head, config.house)) await session`select public.ingest_coinflip(${GENESIS},${GAMES},${fact.signature},${fact.instructionId},${fact.slot},${fact.bet},${fact.wallet},${fact.stake},${fact.payout},${fact.kind},${fact.occurredAt}::timestamptz)`;
      }
      newest = item.signature;
    }
    // Cursor only advances after the whole bounded scan, including empty scans.
    // A crash replays an already durable prefix through SQL's exact idempotency.
    await session`select public.advance_chain_cursor(${GENESIS},${GAMES},${newest},${head})`;
  } finally { try { await session`select pg_advisory_unlock(hashtextextended('sollish:indexer:coinflip',31))`; } finally { session.release(); } }
}
export async function dispatchOnce(sql: postgres.Sql, config: WorkerConfig, owner: string): Promise<void> {
  const rows = await sql`select public.claim_outbox(${owner}::uuid,32) as event`;
  const events = rows.map(row => parsePublicEvent(row.event));
  if (events.some(event => !event)) throw new Error("INVALID_OUTBOX_EVENT");
  for (const event of events.sort((a, b) => a!.seq - b!.seq)) {
    const body = JSON.stringify(event);
    const response = await fetch(`${config.realtimeUrl}/internal/publish`, { method: "POST", headers: publishHeaders(body, config.publishKey), body, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("PUBLISH_UNAVAILABLE");
    const acknowledged = await sql`select public.ack_outbox(${owner}::uuid,${event!.id}::uuid) as accepted`;
    if (acknowledged[0].accepted !== true) throw new Error("OUTBOX_LEASE_EXPIRED");
  }
}
export async function main(): Promise<void> {
  let config: WorkerConfig | null = null;
  try { config = loadConfig(process.env); } catch { /* health fails closed; no raw config logging */ }
  const state = { configured: !!config, lastSuccess: null as string | null, lastFailure: null as string | null, keeper: "disabled-no-deployment-or-fee-key" };
  const server = createServer((request, response) => {
    if (request.url !== "/health" || request.method !== "GET") { response.writeHead(404); response.end(); return; }
    const ready = state.configured && state.lastSuccess !== null && Date.now() - Date.parse(state.lastSuccess) < 30_000 && (process.env.KEEPER_ENABLED !== "true" || state.keeper === "operational");
    response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify({ service: "worker", ready, ...state }));
  }).listen(Number(process.env.WORKER_PORT ?? 8790), "127.0.0.1");
  let keeper: Keeper | null = null;
  try { const options = keeperConfig(process.env); if (options && config) {
    const payer = await loadFeeKey(options.payerPath);
    const journal = await KeeperJournal.acquire(options.journalPath, config.house, payer.publicKey.toBase58());
    const connection = new Connection(config.rpcUrl, { commitment: "finalized", disableRetryOnRateLimit: true, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }) });
    keeper = new Keeper(options, config, payer, journal, connection); state.keeper = "configured-awaiting-verification";
  } } catch { state.keeper = "unavailable-invalid-config-or-private-state"; }
  let stop = false;
  const sql = config ? postgres(config.databaseUrl, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: new URL(config.databaseUrl).hostname === "127.0.0.1" ? false : { rejectUnauthorized: true } }) : null;
  const shutdown = () => { stop = true; server.close(); }; process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  const owner = randomUUID();
  while (!stop) {
    if (config && sql) {
      try { await indexOnce(sql, config); await dispatchOnce(sql, config, owner); if (keeper) { try { await keeper.tick(); state.keeper = "operational"; } catch { state.keeper = "unavailable-verification-fee-or-submission"; } } state.lastSuccess = new Date().toISOString(); state.lastFailure = null; }
      catch { state.lastFailure = "DEPENDENCY_OR_VERIFICATION_UNAVAILABLE"; }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (keeper) await keeper.journal.close();
  if (sql) await sql.end({ timeout: 5 });
}
export function isEntrypoint(path: string | undefined): boolean {
  try { return !!path && realpathSync(path) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntrypoint(process.argv[1])) main().catch(() => { console.error("WORKER_START_FAILED"); process.exitCode = 1; });
