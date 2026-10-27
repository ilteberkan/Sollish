import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAMLA_BET_LEVELS_CENTS } from '@sollish/protocol';
import { CRASH_TARGET_PRESETS, centsToInput, crashTargetOutcome, doubleCents, halveCents, ladderDouble, ladderHalf, originalsGames, parseCrashTarget, profitCents } from '../lib/originals';
import { DEMO_MAX_BET_CENTS, grossPayout, parseDemoAmount, sampleCrash } from '../lib/demo';
import { lobbyStats } from '../lib/lobby/stats';

test('½ and 2× on a free DEMO amount stay inside 1–500 DEMO and the balance', () => {
  assert.equal(halveCents(1000, 100), 500);
  assert.equal(halveCents(1001, 100), 500); // floored to a cent
  assert.equal(halveCents(150, 100), 100);  // never below the minimum
  assert.equal(halveCents(null, 100), 100); // unreadable → minimum
  assert.equal(doubleCents(1000, 100, DEMO_MAX_BET_CENTS), 2000);
  assert.equal(doubleCents(40_000, 100, DEMO_MAX_BET_CENTS), DEMO_MAX_BET_CENTS);
  assert.equal(doubleCents(1000, 100, 1500), 1500); // balance cap
  assert.equal(doubleCents(null, 100, DEMO_MAX_BET_CENTS), 200);
  assert.equal(doubleCents(1000, 100, 50), 100);    // a cap below the minimum still yields the minimum
  // Every result round-trips through the game's own amount parser.
  for (const cents of [100, 101, 999, 1050, 25_000, 50_000]) {
    for (const value of [halveCents(cents, 100), doubleCents(cents, 100, DEMO_MAX_BET_CENTS)]) {
      assert.equal(parseDemoAmount(centsToInput(value, ',')), value);
      assert.equal(parseDemoAmount(centsToInput(value, '.')), value);
    }
  }
  assert.equal(centsToInput(1250, ','), '12,50');
  assert.equal(centsToInput(1200, '.'), '12');
});

test('½ and 2× on the Damla ladder land on ladder levels', () => {
  const ladder = DAMLA_BET_LEVELS_CENTS;
  assert.equal(ladderHalf(ladder, 1000), 500);
  assert.equal(ladderHalf(ladder, 300), 100);   // 150 is not a level → largest level ≤ 150
  assert.equal(ladderHalf(ladder, 100), 100);
  assert.equal(ladderDouble(ladder, 100, 50_000), 200);
  assert.equal(ladderDouble(ladder, 300, 50_000), 800); // 600 → next level 800
  assert.equal(ladderDouble(ladder, 40_000, 50_000), 50_000);
  assert.equal(ladderDouble(ladder, 1000, 1500), 1500); // balance cap
  for (const bet of ladder) {
    assert.ok(ladder.includes(ladderHalf(ladder, bet)));
    assert.ok(ladder.includes(ladderDouble(ladder, bet, 50_000)));
  }
});

test('Crash cash-out target: parsing, range and the outcome decided by the crash point only', () => {
  assert.equal(parseCrashTarget('2'), 200);
  assert.equal(parseCrashTarget('2,5'), 250);
  assert.equal(parseCrashTarget('2.50×'), 250);
  assert.equal(parseCrashTarget('1'), null);       // 1,00× is no cash-out
  assert.equal(parseCrashTarget('1,01'), 101);
  assert.equal(parseCrashTarget('50'), 5000);
  assert.equal(parseCrashTarget('50,01'), null);  // above the ×50 practice cap
  assert.equal(parseCrashTarget(''), null);
  assert.equal(parseCrashTarget('abc'), null);
  for (const preset of CRASH_TARGET_PRESETS) assert.equal(parseCrashTarget(centsToInput(preset, ',')), preset);
  assert.deepEqual(crashTargetOutcome(250, 200), { cashout: true, hundredths: 200 });
  assert.deepEqual(crashTargetOutcome(200, 200), { cashout: true, hundredths: 200 }); // reaching the target counts
  assert.deepEqual(crashTargetOutcome(199, 200), { cashout: false, hundredths: 199 });
  // Monte Carlo over the local sampler: a fixed target returns ≈ 98 % (P(point ≥ m) · m = 0.98), as the lobby states.
  let paid = 0n; const rounds = 200_000; const stake = 10_000;
  for (let i = 0; i < rounds; i++) {
    const point = Math.round(sampleCrash((i + 0.5) / rounds) * 100);
    const outcome = crashTargetOutcome(point, 200);
    if (outcome.cashout) paid += BigInt(grossPayout(stake, outcome.hundredths / 100));
  }
  const rtp = Number(paid) / (rounds * stake);
  assert.ok(Math.abs(rtp - 0.98) < 0.005, `target ×2 RTP ${rtp}`);
});

test('profit readout = gross payout − stake (integer, floored like the ledger)', () => {
  assert.equal(profitCents(1000, 196), 960);
  assert.equal(profitCents(333, 196), grossPayout(333, 1.96) - 333);
  assert.equal(profitCents(1000, 250), 1500);
});

test('Originals row lists the instant games and the strip RTP is the registry figure', () => {
  assert.deepEqual(originalsGames().map(g => g.id), ['crash', 'coinflip', 'damla']);
  assert.equal(lobbyStats('coinflip').rtp, 0.98);
  assert.equal(lobbyStats('crash').rtp, 0.98);
});
