/** Public, signed round records for "Kazancını paylaş" (share). One instance per round-id prefix ("replay:00".."replay:ff").
 * A record is written only when the player shares a round. It holds no balance, time, session id, token or IP; the
 * server seed and client seed appear only after that server seed was revealed by a rotation. The round's steps are
 * recomputed from (engine, seedHex, bet, mode) on read, so storage stays small and the engine stays the authority.
 */
import { DurableObject } from "cloudflare:workers";
import { SLOT_ROUND_ID_PATTERN, slotGame } from "@sollish/protocol";
import { SLOT_LIMITS, slotErrorResponse, slotJson, type SlotEnv } from "./slots";
import { isReplayRecord } from "./slot-records";

export class SlotReplay extends DurableObject<SlotEnv> {
  private ready = false;
  private hasTable(): boolean {
    if (!this.ready) this.ready = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='slot_replays'").toArray().length > 0;
    return this.ready;
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return slotErrorResponse("INVALID_MESSAGE"); }
    const now = Date.now();
    if (path === "/put") {
      if (!isReplayRecord(body.record)) return slotErrorResponse("INVALID_MESSAGE");
      const record = body.record;
      if (!this.hasTable()) { this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS slot_replays (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)"); this.ready = true; }
      this.ctx.storage.sql.exec("INSERT INTO slot_replays(id, body, updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at", record.roundId, JSON.stringify(record), now);
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + SLOT_LIMITS.replayTtlMs);
      return slotJson({ stored: true });
    }
    if (path === "/get") {
      const id = body.id;
      if (typeof id !== "string" || !SLOT_ROUND_ID_PATTERN.test(id) || !this.hasTable()) return slotErrorResponse("NOT_FOUND");
      const row = this.ctx.storage.sql.exec<{ body: string; updated_at: number }>("SELECT body, updated_at FROM slot_replays WHERE id=?", id).toArray()[0];
      if (!row || now - row.updated_at > SLOT_LIMITS.replayTtlMs) return slotErrorResponse("NOT_FOUND");
      const replay = JSON.parse(row.body) as unknown;
      if (!isReplayRecord(replay)) return slotErrorResponse("SERVICE_UNAVAILABLE");
      const game = slotGame(replay.game);
      if (!game || game.engineId !== replay.engineId) return slotErrorResponse("ENGINE_RETIRED");
      const round = game.play(replay.fair.seedHex, replay.betCents, replay.mode);
      if (round.payoutCents !== replay.payoutCents || round.totalHundredths !== replay.totalHundredths || round.costCents !== replay.costCents) return slotErrorResponse("SERVICE_UNAVAILABLE");
      return slotJson({ replay, round });
    }
    return slotErrorResponse("NOT_FOUND");
  }
  async alarm(): Promise<void> {
    if (!this.hasTable()) return;
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM slot_replays WHERE updated_at < ?", now - SLOT_LIMITS.replayTtlMs);
    const oldest = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT MIN(updated_at) AS at FROM slot_replays").one().at;
    if (oldest !== null) await this.ctx.storage.setAlarm(oldest + SLOT_LIMITS.replayTtlMs + 1000);
  }
}
