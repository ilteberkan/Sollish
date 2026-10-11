import test from 'node:test';
import assert from 'node:assert/strict';
import { openRound, closeRound, startFight, finishRound, admitTicket, settleTicket, LIVE_INITIAL_CENTS, LIVE_SESSION_MS, type ArenaTicket } from '../src/live-arena-state';
const start = 1_800_000_000_000;
const session = () => ({ balanceCents: LIVE_INITIAL_CENTS, expiresAtMs: start + LIVE_SESSION_MS });
const command = (roundId = '1') => ({ clientId: '11111111-1111-4111-8111-111111111111', roundId, side: 'kor' as const, amountCents: 1_000 });

test('OPEN is exactly five seconds; exact cutoff and stale alarm cannot extend admission', () => {
  const round = openRound(null, start);
  assert.equal(round.closesAtMs - round.openedAtMs, 5000);
  assert.equal(admitTicket(round, session(), command(), start + 4999, null, false).balanceCents, 99_000);
  for (const time of [start - 1, start + 5000, start + 60_000]) assert.throws(() => admitTicket(round, session(), command(), time, null, false), { code: 'ROUND_CLOSED' });
  assert.equal(round.winner, null); assert.equal(round.phase, 'open');
});
test('result cannot be created before durable caller transition to CLOSED; closed never reopens after clock regression', () => {
  const opened = openRound(null, start);
  assert.throws(() => startFight(opened, start + 5000, 'kor'));
  assert.throws(() => closeRound(opened, start + 4999));
  const closed = closeRound(opened, start + 5000);
  assert.equal(closed.winner, null);
  assert.throws(() => admitTicket(closed, session(), command(), start + 3000, null, false), { code: 'ROUND_CLOSED' });
  const fight = startFight(closed, start + 5001, 'ayaz');
  assert.equal(fight.resultAtMs, start + 13_801); assert.equal(fight.nextRoundAtMs, start + 17_801);
  assert.throws(() => finishRound(fight, fight.resultAtMs! - 1));
  const result = finishRound(fight, fight.resultAtMs!);
  assert.equal(result.phase, 'result'); assert.equal(openRound(result, start + 30_000).roundId, '2');
  assert.equal(opened.winner, null); assert.equal(closed.winner, null);
});
test('duplicate UUID is a receipt retry after cutoff, while changed payload conflicts without another debit', () => {
  const round = openRound(null, start), accepted = admitTicket(round, session(), command(), start + 1, null, false);
  const reserved = { ...session(), balanceCents: accepted.balanceCents };
  const retried = admitTicket(round, reserved, command(), start + 6000, accepted.ticket, true);
  assert.equal(retried.duplicate, true); assert.equal(retried.balanceCents, 99_000);
  for (const change of [{ amountCents: 2000 }, { side: 'ayaz' as const }, { roundId: '2' }]) assert.throws(() => admitTicket(round, reserved, { ...command(), ...change }, start + 100, accepted.ticket, true), { code: 'TICKET_CONFLICT' });
  assert.equal(accepted.ticket.status, 'accepted');
});
test('concurrent commands serialize against a cloned committed ledger; one ticket, no double debit', async () => {
  const round = openRound(null, start); let bank = session(), ticket: ArenaTicket | null = null, queue = Promise.resolve();
  const reserve = () => { const pending = queue.then(() => {
    const draft = admitTicket(round, bank, command(), start + 10, ticket, ticket !== null);
    bank = { ...bank, balanceCents: draft.balanceCents }; ticket = draft.ticket; return draft;
  }); queue = pending.then(() => undefined); return pending; };
  const results = await Promise.all([reserve(), reserve(), reserve()]);
  assert.equal(results.filter(r => !r.duplicate).length, 1); assert.equal(bank.balanceCents, 99_000);
  assert.throws(() => admitTicket(round, bank, { ...command(), clientId: '22222222-2222-4222-8222-222222222222' }, start + 11, null, true), { code: 'ALREADY_BET' });
});
test('a rejected persistence step does not mutate pure caller state or yield a successful acknowledgement', () => {
  const round = openRound(null, start), bank = session(), before = structuredClone({ round, bank }); let acknowledgements = 0;
  assert.throws(() => {
    admitTicket(round, bank, command(), start + 1, null, false);
    throw new Error('synthetic storage failure');
    acknowledgements++;
  });
  assert.deepEqual({ round, bank }, before); assert.equal(acknowledgements, 0);
});
test('wrong round, amount, empty balance, expiry and invalid side are rejected', () => {
  const round = openRound(null, start);
  assert.throws(() => admitTicket(round, session(), command('2'), start + 1, null, false), { code: 'WRONG_ROUND' });
  for (const amountCents of [0, 99, 50_001, 1.1, NaN, Infinity]) assert.throws(() => admitTicket(round, session(), { ...command(), amountCents }, start + 1, null, false), { code: 'INVALID_MESSAGE' });
  assert.throws(() => admitTicket(round, { ...session(), balanceCents: 500 }, command(), start + 1, null, false), { code: 'INSUFFICIENT_CREDITS' });
  assert.throws(() => admitTicket(round, { ...session(), expiresAtMs: start + 1 }, command(), start + 1, null, false), { code: 'SESSION_EXPIRED' });
  assert.throws(() => admitTicket(round, session(), { ...command(), side: 'forged' as 'kor' }, start + 1, null, false), { code: 'INVALID_MESSAGE' });
});
test('disconnect does not settle/refund; completion pays gross once; loss remains debited', () => {
  const accepted = admitTicket(openRound(null, start), session(), command(), start + 1, null, false);
  assert.equal(accepted.balanceCents, 99_000);
  const won = settleTicket(accepted.ticket, 'kor', accepted.balanceCents);
  assert.equal(won.ticket.payoutCents, 1960); assert.equal(won.balanceCents, 100_960);
  assert.deepEqual(settleTicket(won.ticket, 'kor', won.balanceCents), won);
  const lost = settleTicket(accepted.ticket, 'ayaz', accepted.balanceCents);
  assert.equal(lost.balanceCents, 99_000); assert.equal(lost.ticket.payoutCents, 0);
  assert.equal(accepted.ticket.status, 'accepted');
});
