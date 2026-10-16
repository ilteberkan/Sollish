/** Contact 5 arena: in-match learner engine, a live hash-chained corner-plan log and the match ledger
 * (ringside-match-1): bets are taken once, in a 30 s window before round 1, and every pool settles when
 * the bout ends. All three round seeds are drawn and hashed before that window opens. Own namespace and
 * SQLite class; Contact 3/4 tickets never move here.
 *
 * Timeline of a fighting round (startsAt = cutoff + 2.5 s): plan k answers the state at tick k*180
 * (k*9 s). It is requested at startsAt + 9k s - 2.5 s and must be committed by startsAt + 9k s - 0.5 s.
 * A failed call that leaves time is retried once; a late, failed, disabled or over-budget Jev answer
 * commits the deterministic fallback instead. Each
 * entry is broadcast at once, so browsers replay the round from the revealed seed and the log.
 * Jev's answers change the result after betting closes: this engine stays DEMO-only.
 */
import { COMBAT_V5_VERSION, MATCH_LEDGER, MATCH_MARKETS, MATCH_OPEN_MS, combatResults, matchComplete, matchResults, matchSeedHash, roundOutcome, type V5Replay, type ContactBout, type RingMarketSpec, JEV_CORNER_MODEL, PLAN_COUNT, PLAN_TICKS, V5_PLAN_LEAD_MS, V5_TICK_MS, cornerObsHash, fallbackPlans, planEntry, replayContactV5, replayMatchRounds, type V5Carry, type CornerObservation, type CornerPlan, type ContactEngine, type RingRound } from '@sollish/protocol';
import { RingsideArena, type StoredRound } from './ringside-arena';
import type { RelayArena } from './arena-relay';
import { askJevCorner, validKey, JEV_DEADLINE_MS, type JevFailure, type JevResult } from './jev-corner';

type CoachEnv = { TYPESAFE_API_KEY?: string; DECISION_AGENT_ENABLED?: string; JEV_CALL_BUDGET?: string };
const SEGMENT_MS = PLAN_TICKS * V5_TICK_MS, COMMIT_MARGIN_MS = 500;
export const requestAt = (r: RingRound, k: number) => r.startsAt! + k * SEGMENT_MS - V5_PLAN_LEAD_MS;
export const deadlineAt = (r: RingRound, k: number) => r.startsAt! + k * SEGMENT_MS - COMMIT_MARGIN_MS;
const DEFAULT_BUDGET = 300, RETRY_MIN_MS = 600;
const RETRYABLE: ReadonlySet<JevFailure> = new Set(['TIMEOUT', 'NETWORK_ERROR', 'HTTP_ERROR', 'INVALID_RESPONSE', 'PROVIDER_RATE_LIMITED']);

export class ContactArenaV5 extends RingsideArena {
  protected override contactVersion = true;
  protected override contactEngine: ContactEngine = COMBAT_V5_VERSION;
  protected override fightLeadMs = V5_PLAN_LEAD_MS;
  /** The shared LIVE arena may feed read-only viewer relays (LIVE_RELAYS > 0); the ledger and tickets stay here. */
  protected override relayArena(): RelayArena { return 'v5'; }
  private inflight: { round: string; k: number } | null = null;

  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof RingsideArena>[1]) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS jev_usage (id INTEGER PRIMARY KEY CHECK(id=1), calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO jev_usage VALUES(1,0,0,0)');
  }
  private get coachEnv() { return this.env as unknown as CoachEnv; }
  private budget() { const n = Number(this.coachEnv.JEV_CALL_BUDGET ?? DEFAULT_BUDGET); return Number.isSafeInteger(n) && n >= 0 ? n : 0; }
  private usage() { return this.ctx.storage.sql.exec<{ calls: number; input_tokens: number; output_tokens: number }>('SELECT calls,input_tokens,output_tokens FROM jev_usage WHERE id=1').one(); }

  private carries = new Map<string, V5Carry | undefined>();
  /** The learner carry round k starts from: a pure function of rounds 1..k-1 of the bout (seeds, initial states, plan logs). Round 1 has none. */
  private carryOf(r: RingRound): V5Carry | undefined {
    const prev = r.match?.previous ?? [];
    if (!prev.length) return undefined;
    const key = `${r.bout!.id}:${prev.length}:${prev.at(-1)!.plans.at(-1)?.hash ?? ''}:${prev.at(-1)!.seed}`;
    if (this.carries.has(key)) return this.carries.get(key);
    const replays = replayMatchRounds(prev);
    if (!replays) throw new Error('PLAN_LOG_INVALID');
    const carry = replays.at(-1)!.carry;
    this.carries.set(key, carry);
    if (this.carries.size > 4) this.carries.delete(this.carries.keys().next().value!);
    return carry;
  }

  protected override replayOf(saved: StoredRound) {
    const r = saved.public, p = replayContactV5(saved.secretSeed, r.bout!.initial, r.bout!.round, r.plans ?? [], false, this.carryOf(r));
    if (!p.ok || !p.replay) throw new Error('PLAN_LOG_INVALID');
    return p.replay;
  }
  protected override roundExtras(): Partial<RingRound> { return { plans: [] }; }
  protected override markets(): readonly RingMarketSpec[] { return MATCH_MARKETS; }
  protected override ledgerOf(r: RingRound) { return r.bout?.id ?? r.id; }
  protected override bettingOpen(r: RingRound) { return r.phase === 'open' && r.bout?.round === 1; }
  protected override openWindowMs(bout: ContactBout | undefined) { return bout?.round === 1 ? MATCH_OPEN_MS : 0; }
  /** Round 1 draws all three seeds and publishes their hashes; later rounds reveal the next drawn seed. */
  protected override async openRound(previous: StoredRound | null, bout: ContactBout | undefined, id: string, now: number) {
    if (!bout) throw new Error('BOUT_REQUIRED');
    if (bout.round === 1) {
      const seeds = [0, 1, 2].map(() => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join(''));
      return { seed: seeds[0]!, matchSeeds: seeds, extras: { match: { ledger: MATCH_LEDGER, openedAt: now, closesAt: now + MATCH_OPEN_MS, seedHashes: seeds.map((s, i) => matchSeedHash(id, i + 1, s)), previous: [], results: null } } };
    }
    const prev = previous!.public, seeds = previous!.matchSeeds;
    if (!seeds || !prev.match || !prev.seed || !prev.plans || !prev.bout) throw new Error('MATCH_STATE_MISSING');
    const record = { id: prev.id, seed: prev.seed, initial: prev.bout.initial, plans: prev.plans };
    return { seed: seeds[bout.round - 1]!, matchSeeds: seeds, extras: { match: { ...prev.match, previous: [...prev.match.previous, record], results: null } } };
  }
  /** Pools settle once, on the outcome of the whole bout, after a stoppage or the third round. */
  protected override settlement(saved: StoredRound, _results: Record<string, string>, replay: unknown) {
    const m = saved.public.match;
    if (!m) throw new Error('MATCH_STATE_MISSING');
    const earlier = replayMatchRounds(m.previous);
    if (!earlier) throw new Error('PLAN_LOG_INVALID');
    const rounds = [...earlier.map(roundOutcome), roundOutcome(replay as V5Replay)];
    if (!matchComplete(rounds)) return null;
    const final = matchResults(rounds);
    return { results: final, extras: { match: { ...m, results: final } } };
  }
  protected override extraAlarm(r: RingRound, _now: number) {
    const k = r.plans?.length ?? PLAN_COUNT;
    if (r.phase !== 'fighting' || k >= PLAN_COUNT) return Infinity;
    return this.inflight?.round === r.id && this.inflight.k === k ? deadlineAt(r, k) : requestAt(r, k);
  }

  private commit(saved: StoredRound, obs: CornerObservation, plans: { kor: CornerPlan; ayaz: CornerPlan }, source: 'jev' | 'fallback', model: string | null): StoredRound {
    const r = saved.public, list = r.plans ?? [], k = list.length;
    const entry = planEntry(k ? list[k - 1]!.hash : r.commitment, k, cornerObsHash(obs), plans, source, model);
    return { ...saved, public: { ...r, plans: [...list, entry] } };
  }
  /** Commits the deterministic fallback for every plan whose deadline passed (also after a restart). */
  protected override beforeAdvance(saved: StoredRound, now: number): StoredRound {
    let next = saved;
    for (;;) {
      const r = next.public, k = r.plans?.length ?? PLAN_COUNT;
      if (r.phase !== 'fighting' || k >= PLAN_COUNT || now < deadlineAt(r, k)) return next;
      const p = replayContactV5(next.secretSeed, r.bout!.initial, r.bout!.round, r.plans!, false, this.carryOf(r));
      if (!p.ok || !p.next) throw new Error('PLAN_LOG_INVALID');
      next = this.commit(next, p.next, fallbackPlans(p.next), 'fallback', null);
      if (this.inflight?.round === r.id && this.inflight.k === k) this.inflight = null;
    }
  }

  override async alarm(): Promise<void> { await super.alarm(); await this.coach(); }

  /** Asks Jev outside the storage lock so sessions and syncs are never blocked by the provider call. */
  private async coach(): Promise<void> {
    const job = await this.exclusive(async () => {
      const saved = this.current(); if (!saved) return null;
      const r = saved.public, k = r.plans?.length ?? PLAN_COUNT, now = Date.now();
      if (r.phase !== 'fighting' || k >= PLAN_COUNT || now < requestAt(r, k) || now >= deadlineAt(r, k)) return null;
      if (this.inflight?.round === r.id && this.inflight.k === k) return null;
      const p = replayContactV5(saved.secretSeed, r.bout!.initial, r.bout!.round, r.plans!, false, this.carryOf(r));
      if (!p.ok || !p.next) return null;
      const env = this.coachEnv, enabled = env.DECISION_AGENT_ENABLED === 'true' && validKey(env.TYPESAFE_API_KEY);
      const allowed = enabled && this.usage().calls < this.budget();
      if (allowed) { this.ctx.storage.sql.exec('UPDATE jev_usage SET calls=calls+1 WHERE id=1'); await this.ctx.storage.sync(); }
      this.inflight = { round: r.id, k };
      await this.schedule(now);
      return { round: r.id, k, obs: p.next, code: allowed ? null : enabled ? 'BUDGET_EXHAUSTED' as const : 'DISABLED' as const };
    });
    if (!job) return;
    let result: JevResult = job.code ? { ok: false, code: job.code, elapsedMs: 0 } : await askJevCorner(job.obs, { key: this.coachEnv.TYPESAFE_API_KEY });
    console.log(JSON.stringify({ event: 'jev.corner', round: job.round, plan: job.k, attempt: 1, code: result.ok ? 'OK' : result.code, elapsedMs: result.elapsedMs }));
    // One retry for a transient failure when the deadline still leaves room for a real answer.
    if (!result.ok && RETRYABLE.has(result.code)) {
      const left = await this.exclusive(async () => {
        const saved = this.current(); if (!saved) return 0;
        const r = saved.public, ms = deadlineAt(r, job.k) - Date.now() - 100;
        if (r.id !== job.round || r.phase !== 'fighting' || (r.plans?.length ?? PLAN_COUNT) !== job.k || ms < RETRY_MIN_MS || this.usage().calls >= this.budget()) return 0;
        this.ctx.storage.sql.exec('UPDATE jev_usage SET calls=calls+1 WHERE id=1'); await this.ctx.storage.sync();
        return ms;
      });
      if (left > 0) {
        result = await askJevCorner(job.obs, { key: this.coachEnv.TYPESAFE_API_KEY, timeoutMs: Math.min(JEV_DEADLINE_MS, left) });
        console.log(JSON.stringify({ event: 'jev.corner', round: job.round, plan: job.k, attempt: 2, code: result.ok ? 'OK' : result.code, elapsedMs: result.elapsedMs }));
      }
    }
    await this.exclusive(async () => {
      if (this.inflight?.round === job.round && this.inflight.k === job.k) this.inflight = null;
      const saved = this.current(); if (!saved) return;
      const r = saved.public, now = Date.now();
      if (r.id !== job.round || r.phase !== 'fighting' || (r.plans?.length ?? PLAN_COUNT) !== job.k) return;
      const onTime = now < deadlineAt(r, job.k);
      if (result.ok) this.ctx.storage.sql.exec('UPDATE jev_usage SET input_tokens=input_tokens+?, output_tokens=output_tokens+? WHERE id=1', result.answer.usage.inputTokens, result.answer.usage.outputTokens);
      const next = result.ok && onTime ? this.commit(saved, job.obs, result.answer.plans, 'jev', JEV_CORNER_MODEL) : this.commit(saved, job.obs, fallbackPlans(job.obs), 'fallback', null);
      this.save(next); await this.ctx.storage.sync();
      await this.broadcast(now); await this.schedule(now);
    });
  }
}
