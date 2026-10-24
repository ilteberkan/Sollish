import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SLOT_GAME_META } from '@sollish/protocol';
import { createSession, recordSessionRound, sessionStats, slotModeExpectedRtp } from '../lib/slot-kit/session';
import { LOCALES } from '../lib/i18n/config';

test('session stats: rounds, stakes, wins and session RTP are exact; nothing staked -> no RTP', () => {
  let s = createSession(0);
  assert.deepEqual(sessionStats(s), { rounds: 0, spentCents: 0, wonCents: 0, sessionRtp: null, expectedRtp: null, expectedCoversAll: true });
  s = recordSessionRound(s, { costCents: 100, payoutCents: 0, game: 'cascade', mode: 'standard' });
  s = recordSessionRound(s, { costCents: 100, payoutCents: 250, game: 'cascade', mode: 'standard' });
  const st = sessionStats(s);
  assert.equal(st.rounds, 2); assert.equal(st.spentCents, 200); assert.equal(st.wonCents, 250);
  assert.equal(st.sessionRtp, 1.25);
  assert.ok(Math.abs(st.expectedRtp! - SLOT_GAME_META.cascade.expectedRtp.standard!) < 1e-12);
  assert.equal(st.expectedCoversAll, true);
});

test('expected RTP is weighted by the cost of each mode played', () => {
  let s = createSession(0);
  s = recordSessionRound(s, { costCents: 100, payoutCents: 0, game: 'tarhun', mode: 'standard' });
  s = recordSessionRound(s, { costCents: 10_000, payoutCents: 0, game: 'tarhun', mode: 'buy' });
  const m = SLOT_GAME_META.tarhun.expectedRtp;
  const want = (100 * m.standard! + 10_000 * m.buy!) / 10_100;
  assert.ok(Math.abs(sessionStats(s).expectedRtp! - want) < 1e-12);
  assert.equal(sessionStats(s).sessionRtp, 0);
});

test('a round without a known mode counts in the totals but not in the expected RTP, and the panel says so', () => {
  let s = createSession(0);
  s = recordSessionRound(s, { costCents: 100, payoutCents: 50 });
  assert.equal(sessionStats(s).expectedRtp, null);
  s = recordSessionRound(s, { costCents: 100, payoutCents: 50, game: 'damla', mode: 'medium-12' });
  const st = sessionStats(s);
  assert.equal(st.expectedRtp, SLOT_GAME_META.damla.expectedRtp['medium-12']);
  assert.equal(st.expectedCoversAll, false);
  assert.equal(st.sessionRtp, 0.5);
});

test('expected RTP lookup is own-property only and an explicit value wins', () => {
  for (const [g, m] of [['cascade', '__proto__'], ['cascade', 'constructor'], ['__proto__', 'standard'], ['nope', 'standard'], [undefined, undefined]] as const) assert.equal(slotModeExpectedRtp(g, m), null);
  for (const meta of Object.values(SLOT_GAME_META)) for (const mode of meta.modes) assert.equal(slotModeExpectedRtp(meta.id, mode), meta.expectedRtp[mode]);
  const s = recordSessionRound(createSession(0), { costCents: 200, payoutCents: 0, game: 'cascade', mode: 'standard', expectedRtp: 0.5 });
  assert.equal(sessionStats(s).expectedRtp, 0.5);
  assert.throws(() => recordSessionRound(createSession(0), { costCents: -1, payoutCents: 0 }), RangeError);
});

test('the meta expected RTP is the one stated in the original evidence files (not a re-tuned value)', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const dirs: Record<string, string> = { cascade: 'candy-cascade-2-20261011', tarhun: 'storm-throne-20261012', ebru: 'ebru-20261012', cezeri: 'cezeri-20261012', asena: 'asena-20261012', goreme: 'goreme-20261021', damla: 'damla-20261021' };
  for (const meta of Object.values(SLOT_GAME_META)) {
    const ev = JSON.parse(readFileSync(resolve(root, 'ops/evidence', dirs[meta.id]!, 'rtp.json'), 'utf8'));
    for (const mode of meta.modes) {
      const stated = meta.id === 'damla' ? ev.modes[mode].exactRtp : Math.round(ev.modes[mode].rtpVsCost.pointEstimate * 1000) / 1000;
      assert.ok(Math.abs(meta.expectedRtp[mode]! - stated) < 1e-9, `${meta.id}/${mode}: meta ${meta.expectedRtp[mode]} != evidence ${stated}`);
    }
  }
});

test('session stats strings exist in every locale', () => {
  for (const locale of LOCALES) {
    const kit = JSON.parse(readFileSync(resolve(import.meta.dirname, `../messages/${locale}/slotKit.json`), 'utf8'));
    for (const key of ['toggle', 'title', 'rounds', 'spent', 'won', 'sessionRtp', 'expectedRtp', 'partial', 'note']) assert.equal(typeof kit.session.stats[key], 'string', `${locale}: session.stats.${key}`);
  }
});
