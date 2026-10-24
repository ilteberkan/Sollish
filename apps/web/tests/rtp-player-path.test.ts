/** RTP audit (2026-10-23), part b: the player's own money path, end to end, for every slot game and mode.
 *
 * Each round goes through exactly what a game route runs in local DEMO mode:
 *   lib/rgs-client.ts createLocalSource(slotEnginesOf(<GAME>_ENGINE)).resolve(game, bet, mode)   (engine)
 *   -> <game>Cost(bet, mode)                         (what the game debits)
 *   -> DemoLedger.reserve(cost, id, <game>LedgerLimits(...))  (providers.tsx reserveDemo)
 *   -> DemoLedger.settle({ id, stake: cost, payout: round.payoutCents })  (providers.tsx settleDemo)
 *   -> recordSessionRound(session, { costCents, payoutCents })  (use-session.ts)
 * and checks, per round and in total, integer-exact: balance change == payout - cost, ledger credit == engine payout, no clamp or
 * refusal by the ledger cap, and the session totals equal the ledger totals. Bets cycle through the real bet ladder. When the DEMO
 * balance cannot cover the next cost, the ledger's own reset ("Bakiyeyi yenile") refills it, as a player would.
 *
 * Fast by default (CI). Evidence run (ops/evidence/rtp-audit-20261023/player-path.json):
 *   RTP_PLAYER_PATH_ROUNDS=200000 RTP_PLAYER_PATH_OUT=../../ops/evidence/rtp-audit-20261023/player-path.json \
 *     bash scripts/use-node.sh pnpm --filter @sollish/web exec tsx --test tests/rtp-player-path.test.ts
 * Entropy is deterministic (sha256 of "sollish-rtp-audit-20261023/player/<game>/<mode>/<i>") so a run is reproducible; the engine
 * still receives it through the same `entropy` hook the browser fills with crypto.getRandomValues.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SLOT_GAME_META, SLOT_GAMES, DAMLA_EXACT_RTP, DAMLA_PAYTABLES, type SlotGameId } from '@sollish/protocol';
import { createLocalSource, slotEnginesOf, type SlotEngine, type SlotMode } from '../lib/rgs-client';
import { DemoLedger, DEMO_START_CENTS } from '../lib/demo';
import { createSession, recordSessionRound } from '../lib/slot-kit/session';
import { CASCADE_ENGINE } from '../lib/slot-engines/cascade';
import { TARHUN_ENGINE } from '../lib/slot-engines/tarhun';
import { EBRU_ENGINE } from '../lib/slot-engines/ebru';
import { CEZERI_ENGINE } from '../lib/slot-engines/cezeri';
import { ASENA_ENGINE } from '../lib/slot-engines/asena';
import { DAMLA_ENGINE } from '../lib/slot-engines/damla';
import { GOREME_ENGINE } from '../lib/slot-engines/goreme';
import { CASCADE_BET_LADDER, cascadeCost, cascadeLedgerLimits } from '../lib/cascade-controls';
import { STORM_BET_LADDER, stormCost, stormLedgerLimits } from '../lib/storm-controls';
import { EBRU_BET_LADDER, ebruCost, ebruLedgerLimits } from '../lib/ebru-controls';
import { CEZERI_BET_LADDER, cezeriCost, cezeriLedgerLimits } from '../lib/cezeri-controls';
import { ASENA_BET_LADDER, asenaCost, asenaLedgerLimits } from '../lib/asena-controls';
import { GOREME_BET_LADDER, goremeCost, goremeLedgerLimits } from '../lib/goreme-controls';
import { DAMLA_BET_LADDER, damlaCost, damlaLedgerLimits, type DamlaMode } from '../lib/damla-controls';

type Limits = { maxMultiplier: number; maxStakeCents: number };
interface PlayerGame { engine: SlotEngine; ladder: readonly number[]; cost(bet: number, mode: string): number; limits(bet: number, mode: string): Limits }
/* The casts mirror the game routes, which pass their own mode union. */
const GAMES: Record<SlotGameId, PlayerGame> = {
  cascade: { engine: CASCADE_ENGINE as SlotEngine, ladder: CASCADE_BET_LADDER, cost: (b, m) => cascadeCost(b, m as SlotMode), limits: (b, m) => cascadeLedgerLimits(b, m as SlotMode) },
  tarhun: { engine: TARHUN_ENGINE as SlotEngine, ladder: STORM_BET_LADDER, cost: (b, m) => stormCost(b, m as SlotMode), limits: (b, m) => stormLedgerLimits(b, m as SlotMode) },
  ebru: { engine: EBRU_ENGINE as SlotEngine, ladder: EBRU_BET_LADDER, cost: (b, m) => ebruCost(b, m as SlotMode), limits: (b, m) => ebruLedgerLimits(b, m as SlotMode) },
  cezeri: { engine: CEZERI_ENGINE as SlotEngine, ladder: CEZERI_BET_LADDER, cost: (b, m) => cezeriCost(b, m as SlotMode), limits: (b, m) => cezeriLedgerLimits(b, m as SlotMode) },
  asena: { engine: ASENA_ENGINE as SlotEngine, ladder: ASENA_BET_LADDER, cost: (b, m) => asenaCost(b, m as SlotMode), limits: (b, m) => asenaLedgerLimits(b, m as SlotMode) },
  damla: { engine: DAMLA_ENGINE as SlotEngine, ladder: DAMLA_BET_LADDER, cost: b => damlaCost(b), limits: (_b, m) => damlaLedgerLimits(m as DamlaMode) },
  goreme: { engine: GOREME_ENGINE as SlotEngine, ladder: GOREME_BET_LADDER, cost: (b, m) => goremeCost(b, m as SlotMode), limits: (b, m) => goremeLedgerLimits(b, m as SlotMode) },
};

const ROUNDS = Number(process.env.RTP_PLAYER_PATH_ROUNDS ?? 300);
const OUT = process.env.RTP_PLAYER_PATH_OUT;
const ONLY = process.env.RTP_PLAYER_PATH_GAMES?.split(',');
const NAMESPACE = 'sollish-rtp-audit-20261023/player';

/** Expected RTP of a mode as the game shows it: Damla's exact binomial value, otherwise the registry's simulated value. */
export function expectedRtp(game: SlotGameId, mode: string): number {
  return game === 'damla' ? DAMLA_EXACT_RTP[mode as DamlaMode] : SLOT_GAMES[game]!.rtp[mode]!.rtp;
}

interface ModeResult {
  game: SlotGameId; mode: string; rounds: number; betsCents: readonly number[]; sumCostCents: number; sumPayoutCents: number; sumBalanceChangeCents: number; resets: number; resetRefillCents: number;
  ledgerMismatches: number; ledgerRefusals: number; costMismatches: number; replayMismatches: number; sessionMatches: boolean;
  maxPayoutOverCost: number; ledgerMaxMultiplierMin: number; rtpWeighted: number; rtpWeightedCi95: [number, number]; rtpPerRoundMean: number; rtpPerRoundCi95: [number, number];
  hitFrequency: number; maxWinXBet: number; expectedRtp: number; zWeightedVsExpected: number;
}

function playMode(game: SlotGameId, mode: string, rounds: number): ModeResult {
  const g = GAMES[game];
  let counter = 0;
  // Deterministic entropy through the same hook the browser fills with crypto.getRandomValues.
  const source = createLocalSource(slotEnginesOf(g.engine), words => {
    const digest = createHash('sha256').update(`${NAMESPACE}/${game}/${mode}/${counter++}`).digest();
    for (let i = 0; i < words.length; i++) words[i] = digest.readUInt32BE(i * 4);
  });
  const ledger = new DemoLedger();
  let session = createSession(0);
  let sumCost = 0, sumPayout = 0, sumChange = 0, resets = 0, refill = 0, ledgerMismatches = 0, refusals = 0, costMismatches = 0, replayMismatches = 0, hits = 0;
  let maxRatio = 0, minLedgerMax = Infinity, maxWinXBet = 0, sumR = 0, sumR2 = 0, sumCost2 = 0, sumCostPay = 0, sumPay2 = 0;
  // A player can only stake what a fresh DEMO balance covers (buy at the top of the ladder would cost up to 50 000 DEMO).
  const playable = g.ladder.filter(b => g.cost(b, mode) <= DEMO_START_CENTS);
  for (let i = 0; i < rounds; i++) {
    const bet = playable[i % playable.length]!;
    const cost = g.cost(bet, mode);
    if (cost > ledger.balance) { const before = ledger.balance; assert.equal(ledger.reset(), true); refill += ledger.balance - before; resets++; }
    const round = source.resolve(game, bet, mode as SlotMode);
    if (round.costCents !== cost || round.betCents !== bet || round.mode !== mode) costMismatches++;
    if (i % 97 === 0 && JSON.stringify(g.engine.play(round.seedHex, bet, mode)) !== JSON.stringify(round)) replayMismatches++;
    const limits = g.limits(bet, mode);
    minLedgerMax = Math.min(minLedgerMax, limits.maxMultiplier);
    const before = ledger.balance;
    const id = ledger.reserve(cost, () => `${game}:${mode}:${i}`, limits);
    if (id === null) { refusals++; continue; }
    const reserved = ledger.balance;
    try { ledger.settle({ id, stake: cost, payout: round.payoutCents }); } catch { refusals++; continue; }
    const credited = ledger.balance - reserved;
    if (credited !== round.payoutCents || before - reserved !== cost) ledgerMismatches++;
    sumChange += ledger.balance - before;
    sumCost += cost; sumPayout += round.payoutCents;
    session = recordSessionRound(session, { costCents: cost, payoutCents: round.payoutCents });
    if (round.payoutCents > 0) hits++;
    const r = round.payoutCents / cost;
    maxRatio = Math.max(maxRatio, r); maxWinXBet = Math.max(maxWinXBet, round.payoutCents / bet);
    sumR += r; sumR2 += r * r; sumCost2 += cost * cost; sumCostPay += cost * round.payoutCents; sumPay2 += round.payoutCents * round.payoutCents;
  }
  const n = rounds - refusals;
  const rtpWeighted = sumPayout / sumCost;
  // Ratio estimator variance: sum((pay_i - R cost_i)^2) / (sum cost)^2
  const resid = Math.max(0, sumPay2 - 2 * rtpWeighted * sumCostPay + rtpWeighted * rtpWeighted * sumCost2);
  const seW = Math.sqrt(resid * n / Math.max(1, n - 1)) / sumCost;
  const mean = sumR / n, sd = Math.sqrt(Math.max(0, (sumR2 - n * mean * mean) / Math.max(1, n - 1))), seM = sd / Math.sqrt(n);
  const exp = expectedRtp(game, mode);
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return {
    game, mode, rounds, betsCents: playable, sumCostCents: sumCost, sumPayoutCents: sumPayout, sumBalanceChangeCents: sumChange, resets, resetRefillCents: refill,
    ledgerMismatches, ledgerRefusals: refusals, costMismatches, replayMismatches,
    sessionMatches: session.spentCents === sumCost && session.wonCents === sumPayout && session.rounds === n,
    maxPayoutOverCost: r6(maxRatio), ledgerMaxMultiplierMin: minLedgerMax,
    rtpWeighted: r6(rtpWeighted), rtpWeightedCi95: [r6(rtpWeighted - 1.96 * seW), r6(rtpWeighted + 1.96 * seW)],
    rtpPerRoundMean: r6(mean), rtpPerRoundCi95: [r6(mean - 1.96 * seM), r6(mean + 1.96 * seM)],
    hitFrequency: r6(hits / n), maxWinXBet: r6(maxWinXBet), expectedRtp: exp, zWeightedVsExpected: Math.round(((rtpWeighted - exp) / seW) * 1000) / 1000,
  };
}

const results: ModeResult[] = [];
for (const game of Object.keys(GAMES) as SlotGameId[]) {
  if (ONLY && !ONLY.includes(game)) continue;
  test(`player path ${game}: ledger and session follow the engine exactly in every mode (${ROUNDS} rounds per mode)`, () => {
    for (const mode of SLOT_GAME_META[game].modes) {
      const r = playMode(game, mode, ROUNDS);
      results.push(r);
      assert.equal(r.ledgerRefusals, 0, `${game}/${mode}: ledger refused or clamped a round`);
      assert.equal(r.ledgerMismatches, 0, `${game}/${mode}: ledger credit differs from the engine payout`);
      assert.equal(r.costMismatches, 0, `${game}/${mode}: engine cost differs from the game's cost`);
      assert.equal(r.replayMismatches, 0, `${game}/${mode}: re-running the seed gave another round`);
      assert.equal(r.sumBalanceChangeCents, r.sumPayoutCents - r.sumCostCents, `${game}/${mode}: balance change != payout - cost`);
      assert.equal(r.sessionMatches, true, `${game}/${mode}: session totals differ from the ledger`);
      assert.ok(r.maxPayoutOverCost <= r.ledgerMaxMultiplierMin, `${game}/${mode}: a payout above the ledger cap`);
    }
  });
}

test('the ledger cap never clamps a capped engine win at any ladder bet in any mode', () => {
  for (const game of Object.keys(GAMES) as SlotGameId[]) {
    const g = GAMES[game], cap = SLOT_GAME_META[game].maxMultiplier;
    for (const mode of SLOT_GAME_META[game].modes) for (const bet of g.ladder) {
      const cost = g.cost(bet, mode), limits = g.limits(bet, mode);
      // Damla: the largest pool of the mode (hundredths of the bet); slots: the engine cap x bet.
      const maxEnginePayout = game === 'damla' ? Number(BigInt(bet) * BigInt(Math.max(...DAMLA_PAYTABLES[mode as DamlaMode]!)) / 100n) : bet * cap;
      assert.ok(maxEnginePayout <= cost * limits.maxMultiplier, `${game}/${mode}/${bet}: cap ${maxEnginePayout} > ledger ${cost * limits.maxMultiplier}`);
      assert.ok(cost <= limits.maxStakeCents, `${game}/${mode}/${bet}: cost above the ledger stake ceiling`);
    }
  }
});

test.after(() => {
  if (!OUT || results.length === 0) return;
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    kind: 'rtp-audit-player-path', date: '2026-10-23', scope: 'DEMO ledger (lib/demo.ts) driven by the web client local round source; not the remote RGS',
    command: `RTP_PLAYER_PATH_ROUNDS=${ROUNDS} RTP_PLAYER_PATH_OUT=${OUT} bash scripts/use-node.sh pnpm --filter @sollish/web exec tsx --test tests/rtp-player-path.test.ts`,
    node: process.version, roundsPerMode: ROUNDS, entropy: `sha256("${NAMESPACE}/<game>/<mode>/<draw index>") -> 4 big-endian words`,
    bets: 'round i uses playable[i mod playable.length], playable = ladder levels whose cost fits the 1000 DEMO start balance (all 19 levels for standard/ante/Damla; buy: see betsCents)',
    rtp: 'rtpWeighted = sum(payout)/sum(cost) (what the balance sees); rtpPerRoundMean = mean(payout/cost) (bet-size neutral); 95% intervals by normal approximation',
    results,
  }, null, 2));
});
