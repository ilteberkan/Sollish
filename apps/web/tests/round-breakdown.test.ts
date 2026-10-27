import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASENA_MAX_WIN_MULTIPLIER, ASENA_MODES, CASCADE2_MAX_WIN_MULTIPLIER, CASCADE2_MODES, CEZERI_MAX_WIN_MULTIPLIER, CEZERI_MODES, DAMLA_MODES,
  EBRU_MAX_WIN_MULTIPLIER, EBRU_MODES, GOREME_MAX_WIN_MULTIPLIER, GOREME_MODES, STORM_MAX_WIN_MULTIPLIER, STORM_MODES,
  playAsenaRound, playCascade2Round, playCezeriRound, playDamlaRound, playEbruRound, playGoremeRound, playStormRound,
} from '@sollish/protocol';
import { asenaBreakdown } from '../lib/round-breakdown/asena';
import { cascadeBreakdown } from '../lib/round-breakdown/cascade';
import { cezeriBreakdown } from '../lib/round-breakdown/cezeri';
import { damlaBreakdown } from '../lib/round-breakdown/damla';
import { ebruBreakdown } from '../lib/round-breakdown/ebru';
import { goremeBreakdown } from '../lib/round-breakdown/goreme';
import { tarhunBreakdown } from '../lib/round-breakdown/tarhun';
import { allLines, exactDecimal, verifyBreakdown, type RoundBreakdown } from '../lib/round-breakdown/types';

/** Deterministic, well-spread 32-hex seeds (SplitMix32 over the index), so every run checks the same rounds. */
function seedAt(game: number, mode: number, i: number): string {
  let a = (Math.imul(game + 1, 0x9e3779b1) ^ Math.imul(mode + 1, 0x85ebca6b) ^ i) | 0;
  let out = '';
  for (let w = 0; w < 4; w++) {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
    out += ((t ^ (t >>> 15)) >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}
const BETS = [100, 300, 2500, 50_000];
/** Rounds per mode. Buy rounds are all feature rounds and take longer, so they get fewer (still thousands of free spins). */
const N = Number(process.env.BREAKDOWN_ROUNDS ?? 20_000);
const N_BUY = Number(process.env.BREAKDOWN_BUY_ROUNDS ?? 4_000);

interface Stats { rounds: number; wins: number; lines: number; feature: number; capped: number; multiplied: number }
function sweep(name: string, gameIndex: number, modes: readonly string[], play: (seed: string, bet: number, mode: string) => RoundBreakdown, perMode: (mode: string) => number): Record<string, Stats> {
  const out: Record<string, Stats> = {};
  modes.forEach((mode, m) => {
    const s: Stats = { rounds: 0, wins: 0, lines: 0, feature: 0, capped: 0, multiplied: 0 };
    const n = perMode(mode);
    for (let i = 0; i < n; i++) {
      const seed = seedAt(gameIndex, m, i), bet = BETS[i % BETS.length]!;
      const b = play(seed, bet, mode);
      const check = verifyBreakdown(b);
      if (!check.ok) assert.fail(`${name} ${mode} ${seed} bet ${bet}: ${check.mismatches.slice(0, 5).join('; ')}`);
      assert.equal(check.payoutCents, b.payoutCents);
      assert.equal(check.totalHundredths, b.totalHundredths);
      s.rounds++;
      if (b.payoutCents > 0) s.wins++;
      s.lines += allLines(b).length;
      if (b.spins.length > 1) s.feature++;
      if (b.capped) s.capped++;
      if (b.spins.some(sp => sp.factors.length > 0 || sp.groups.some(g => g.factors.length > 0 || g.lines.some(l => l.factors.some(f => f.kind !== 'ways' || f.value > 1))))) s.multiplied++;
    }
    out[mode] = s;
  });
  return out;
}
const summary: Record<string, Record<string, Stats>> = {};
const record = (name: string, stats: Record<string, Stats>) => {
  summary[name] = stats;
  for (const [mode, s] of Object.entries(stats)) {
    assert.ok(s.wins > 0, `${name} ${mode}: no winning round`);
    if (mode !== 'standard' && mode !== 'ante' && !mode.includes('-')) assert.equal(s.feature, s.rounds, `${name} ${mode}: every buy round plays free spins`);
  }
};
const perMode = (mode: string) => (mode === 'buy' ? N_BUY : N);

test('Candy Cascade: breakdown lines x crystals + scatter add up to the engine payout in every round', () => {
  const stats = sweep('cascade', 0, CASCADE2_MODES, (s, b, m) => cascadeBreakdown(playCascade2Round(s, b, m as never)), perMode);
  record('cascade', stats);
  assert.ok(Object.values(stats).some(s => s.multiplied > 0), 'crystal multipliers were exercised');
});
test('Tarhun: breakdown lines x orbs / total multiplier + scatter add up to the engine payout', () => {
  record('tarhun', sweep('tarhun', 1, STORM_MODES, (s, b, m) => tarhunBreakdown(playStormRound(s, b, m as never)), perMode));
});
test('Ebru: cluster pays x stain sums + comb scatter add up to the engine payout', () => {
  record('ebru', sweep('ebru', 2, EBRU_MODES, (s, b, m) => ebruBreakdown(playEbruRound(s, b, m as never)), perMode));
});
test('Cezeri: (full - paid before) x hub per spoke + vessel scatter add up to the engine payout', () => {
  record('cezeri', sweep('cezeri', 3, CEZERI_MODES, (s, b, m) => cezeriBreakdown(playCezeriRound(s, b, m as never)), perMode));
});
test('Asena: cluster pays x constellation x global multiplier + moon scatter add up to the engine payout', () => {
  record('asena', sweep('asena', 4, ASENA_MODES, (s, b, m) => asenaBreakdown(playAsenaRound(s, b, m as never)), perMode));
});
test('Göreme: pay per way x weighted ways, floor(board x sky / 100), + sun scatter add up to the engine payout', () => {
  record('goreme', sweep('goreme', 5, GOREME_MODES, (s, b, m) => goremeBreakdown(playGoremeRound(s, b, m as never)), perMode));
});
test('Göreme: the DEMO amount shown on every line (the board label share) adds up to the payout exactly', () => {
  for (const mode of GOREME_MODES) {
    for (let i = 0; i < (mode === 'buy' ? 400 : 4000); i++) {
      const seed = createHash('sha256').update(`goreme-share-${mode}-${i}`).digest('hex').slice(0, 32);
      const b = goremeBreakdown(playGoremeRound(seed, [100, 300, 2500, 50_000][i % 4]!, mode as never));
      const shown = b.spins.flatMap(s => [...s.groups.flatMap(g => g.lines), ...s.extras]);
      for (const l of shown) assert.notEqual(l.shareCents, undefined, `${mode} ${seed}: every shown line has its share`);
      assert.equal(shown.reduce((n, l) => n + (l.shareCents ?? 0), 0), b.payoutCents, `${mode} ${seed}`);
    }
  }
});
test('Damla: pool multiplier x bet = payout for every mode', () => {
  const stats = sweep('damla', 6, DAMLA_MODES, (s, b, m) => damlaBreakdown(playDamlaRound(s, b, m as never)), () => Math.max(2000, Math.floor(N / 10)));
  record('damla', stats);
});

test('caps come from the engine constants, and a capped round shows the cap as its total', () => {
  const round = playCascade2Round('0'.repeat(32), 100, 'standard');
  assert.equal(cascadeBreakdown(round).capHundredths, CASCADE2_MAX_WIN_MULTIPLIER * 100);
  assert.equal(tarhunBreakdown(playStormRound('0'.repeat(32), 100, 'standard')).capHundredths, STORM_MAX_WIN_MULTIPLIER * 100);
  assert.equal(ebruBreakdown(playEbruRound('0'.repeat(32), 100, 'standard')).capHundredths, EBRU_MAX_WIN_MULTIPLIER * 100);
  assert.equal(cezeriBreakdown(playCezeriRound('0'.repeat(32), 100, 'standard')).capHundredths, CEZERI_MAX_WIN_MULTIPLIER * 100);
  assert.equal(asenaBreakdown(playAsenaRound('0'.repeat(32), 100, 'standard')).capHundredths, ASENA_MAX_WIN_MULTIPLIER * 100);
  assert.equal(goremeBreakdown(playGoremeRound('0'.repeat(32), 100, 'standard')).capHundredths, GOREME_MAX_WIN_MULTIPLIER * 100);
  assert.equal(damlaBreakdown(playDamlaRound('0'.repeat(32), 100, 'low-8')).capHundredths, null);
  // Synthetic: a breakdown whose spins exceed the cap must show exactly the cap.
  const b = cascadeBreakdown(round, 100);
  const forced: RoundBreakdown = { ...b, spins: [{ index: 0, kind: 'base', groups: [], factors: [], extras: [{ kind: 'scatter', symbol: 'star', count: 6, base: 10_000, factors: [], amount: 10_000, unit: 100 }], winHundredths: 10_000 }], capped: true, totalHundredths: 100, payoutCents: 100 };
  assert.ok(verifyBreakdown(forced).ok);
  assert.ok(!verifyBreakdown({ ...forced, payoutCents: 101 }).ok, 'a wrong payout is reported');
  assert.ok(!verifyBreakdown({ ...forced, capped: false }).ok, 'an uncapped sum above the cap is reported');
});

test('a tampered line is caught by the check', () => {
  for (let i = 0; i < 500; i++) {
    const b = cascadeBreakdown(playCascade2Round(seedAt(9, 0, i), 100, 'standard'));
    const line = b.spins[0]!.groups[0]?.lines[0];
    if (!line) continue;
    line.amount += 1;
    assert.ok(!verifyBreakdown(b).ok);
    return;
  }
  assert.fail('no winning round found');
});

test('exactDecimal prints exact fractions with the locale separators', () => {
  const g = (w: bigint) => w.toLocaleString('en-US');
  assert.equal(exactDecimal(225n, 4, '.', g), '0.0225');
  assert.equal(exactDecimal(1_234_500n, 4, ',', g), '123,45');
  assert.equal(exactDecimal(100n, 2, '.', g), '1.00');
  assert.equal(exactDecimal(123_456_789n, 6, '.', g), '123.456789');
  assert.equal(exactDecimal(-5n, 2, '.', g), '−0.05');
});

test.after(() => {
  if (process.env.BREAKDOWN_SUMMARY) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary));
  }
});
