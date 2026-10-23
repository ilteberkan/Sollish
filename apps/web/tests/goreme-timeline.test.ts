import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goremeSeedFromEntropy, playGoremeRound, type GoremeMode, type GoremeRound } from '@sollish/protocol';
import {
  GOREME_SPEED_FACTOR, buildGoremeTimeline, goremeFinalBoard, goremeHistoryDetail, goremeHistorySummary, goremeTickMs, goremeWaysCallout, type GoremeEvent,
} from '../lib/goreme-timeline';
import { winTierOf } from '../lib/slot-kit/win-tiers';

const seedOf = (fill: number) => goremeSeedFromEntropy(new Uint32Array([fill, fill, fill, fill]));
const engine = (fill: number, mode: GoremeMode = 'standard', bet = 1000) => playGoremeRound(seedOf(fill), bet, mode);
/* Fills found with the engine (the browser spec uses the same ones). */
export const GOREME_FILLS = {
  LOSS: 2_364_027_904,      // standard and ante at 10 DEMO: no win, no lift
  LIFT: 1_824_259_072,      // base: two or more lifts, 1,60x
  CALLOUT: 3_852_139_584,   // base: a way multiplier of 10 or more, below 10x
  BUYUK: 3_727_255_296,     // base 11,28x -> Büyük
  MEGA: 3_029_292_032,      // base 25,92x -> Büyük, Mega
  FREE_LOW: 245_234_176,    // standard: Dawn Festival, 2,28x: total screen only
  BUY_SKY: 4_139_144_192,   // buy: sky reaches x15, 90,16x -> Süper
  FREE_BIG: 71_414_784,     // standard: Dawn Festival, sky x15, 209,15x -> Efsane
  BUY_MERGE: 3_650_240_146, // buy: two balloons merge in a free spin, 27,68x
} as const;
const F = GOREME_FILLS;
const ofType = <T extends GoremeEvent['type']>(events: readonly GoremeEvent[], type: T) => events.filter((e): e is Extract<GoremeEvent, { type: T }> => e.type === type);
const stepsOf = (round: GoremeRound, type: string) => round.spins.reduce((n, s) => n + s.steps.filter(st => st.type === type).length, 0);

test('fixtures: the fills give the documented rounds', () => {
  assert.equal(engine(F.LOSS).totalHundredths, 0); assert.equal(engine(F.LOSS, 'ante').totalHundredths, 0);
  assert.ok(engine(F.LIFT).spins[0]!.lifts >= 2); assert.equal(engine(F.LIFT).freeSpinsTriggered, false);
  assert.equal(winTierOf(engine(F.BUYUK).totalHundredths), 1); assert.equal(winTierOf(engine(F.MEGA).totalHundredths), 2);
  assert.ok(engine(F.FREE_LOW).freeSpinsTriggered && engine(F.FREE_LOW).totalHundredths < 1000);
  const buy = engine(F.BUY_SKY, 'buy');
  assert.equal(buy.spins.at(-1)!.skyAfter, 15); assert.equal(winTierOf(buy.totalHundredths), 3);
  assert.equal(winTierOf(engine(F.FREE_BIG).totalHundredths), 4);
});

test('every engine step maps to its event, in order, and the timeline ends with the engine payout', () => {
  for (const [fill, mode] of [[F.LIFT, 'standard'], [F.CALLOUT, 'standard'], [F.FREE_LOW, 'standard'], [F.BUY_SKY, 'buy'], [F.FREE_BIG, 'standard']] as const) {
    const round = engine(fill, mode);
    const { events, duration } = buildGoremeTimeline(round);
    for (let i = 1; i < events.length; i++) assert.ok(events[i]!.at >= events[i - 1]!.at, 'sorted');
    assert.equal(ofType(events, 'spin').length, stepsOf(round, 'spin'));
    assert.equal(ofType(events, 'respin').length, stepsOf(round, 'respin'));
    assert.equal(ofType(events, 'lift').length, stepsOf(round, 'lift'));
    assert.equal(ofType(events, 'lift-move').length, stepsOf(round, 'lift'));
    assert.equal(ofType(events, 'sky').length, stepsOf(round, 'sky'));
    assert.equal(ofType(events, 'scatter').length, stepsOf(round, 'scatter'));
    assert.equal(ofType(events, 'win').length, round.spins.reduce((n, s) => n + s.steps.filter(st => st.type === 'ways' && st.wins.length > 0).length, 0));
    assert.equal(ofType(events, 'spin-start').length, round.spins.length);
    assert.equal(ofType(events, 'spin-end').length, round.spins.length);
    const end = events.at(-1)!;
    assert.equal(end.type, 'end'); assert.equal(end.at, duration);
    if (end.type === 'end') { assert.equal(end.payoutCents, round.payoutCents); assert.equal(end.totalHundredths, round.totalHundredths); }
    // win events re-state the engine's ways numbers (sky applied)
    const ways = round.spins.flatMap(s => s.steps.filter(st => st.type === 'ways' && st.wins.length > 0));
    ofType(events, 'win').forEach((e, i) => { const w = ways[i]!; assert.equal(w.type, 'ways'); if (w.type === 'ways') { assert.equal(e.stepHundredths, w.winHundredths); assert.equal(e.sky, w.skyMultiplier); } });
  }
});

test('the cumulative meter never decreases and ends on the round total; spin-end matches the engine', () => {
  for (const [fill, mode] of [[F.LIFT, 'standard'], [F.BUY_SKY, 'buy'], [F.FREE_BIG, 'standard'], [F.MEGA, 'standard']] as const) {
    const round = engine(fill, mode);
    const readings = buildGoremeTimeline(round).events.flatMap(e => ('meter' in e ? [e.meter.total] : []));
    for (let i = 1; i < readings.length; i++) assert.ok(readings[i]! >= readings[i - 1]!, `meter ${i}`);
    assert.equal(readings.at(-1), round.totalHundredths);
    const ends = ofType(buildGoremeTimeline(round).events, 'spin-end');
    ends.forEach((e, i) => assert.equal(e.meter.total, round.spins[i]!.totalHundredthsAfter));
  }
});

test('balloons keep their engine id: replaying lift moves and merges over the boards reproduces every board', () => {
  for (const [fill, mode] of [[F.LIFT, 'standard'], [F.BUY_SKY, 'buy'], [F.FREE_BIG, 'standard'], [F.BUY_MERGE, 'buy']] as const) {
    const round = engine(fill, mode);
    let at = new Map<number, string>();
    for (const e of buildGoremeTimeline(round).events) {
      if (e.type === 'spin' || e.type === 'respin') {
        const next = new Map<number, string>();
        e.grid.forEach((column, c) => column.forEach((cell, r) => { if (cell.symbol === 'balloon') next.set(cell.id, `${c},${r}`); }));
        if (e.type === 'respin') for (const [id, pos] of at) if (!e.drops.includes(id)) assert.equal(next.get(id), pos, `balloon ${id} stays put through the respin`);
        at = next;
      } else if (e.type === 'lift') {
        for (const b of e.balloons) assert.equal(at.get(b.id), `${b.col},${b.row}`, `lift starts where balloon ${b.id} is`);
      } else if (e.type === 'lift-move') {
        for (const x of e.exits) at.delete(x.id);
        for (const m of e.moves) at.set(m.id, `${m.to[0]},${m.to[1]}`);
      } else if (e.type === 'merge') {
        for (const m of e.merges) { for (const id of m.absorbed) { assert.equal(at.get(id), `${m.at[0]},${m.at[1]}`); at.delete(id); } assert.equal(at.get(m.id), `${m.at[0]},${m.at[1]}`); }
      }
    }
    const final = new Map<number, string>();
    goremeFinalBoard(round).forEach((column, c) => column.forEach((cell, r) => { if (cell.symbol === 'balloon') final.set(cell.id, `${c},${r}`); }));
    assert.deepEqual([...at].sort(), [...final].sort());
  }
});

test('free spins: trigger, intro hold, free mode, sky band moorings, total screen; tiers follow the owner rule', () => {
  const buy = engine(F.BUY_SKY, 'buy');
  const tl = buildGoremeTimeline(buy);
  const types = tl.events.map(e => e.type);
  assert.ok(types.indexOf('trigger') < types.indexOf('free-intro') && types.indexOf('free-intro') < types.indexOf('free-mode'));
  const sky = ofType(tl.events, 'sky');
  assert.ok(sky.length >= 1);
  for (let i = 1; i < sky.length; i++) assert.equal(sky[i]!.before, sky[i - 1]!.after, 'the sky only grows step by step');
  assert.equal(sky.at(-1)!.after, 15);
  assert.ok(sky.every(s => s.after > s.before && s.moored.length > 0));
  const outro = ofType(tl.events, 'free-outro')[0]!;
  assert.equal(outro.sky, 15); assert.equal(outro.totalHundredths, buy.totalHundredths); assert.equal(outro.hold, true);
  assert.equal(outro.moored, sky.reduce((n, s) => n + s.moored.length, 0));
  const big = ofType(tl.events, 'big-win')[0]!;
  assert.equal(big.tier, 3); assert.deepEqual(big.schedule.stages.map(s => s.level), [1, 2, 3]);
  // low free round: total screen, no celebration
  const low = buildGoremeTimeline(engine(F.FREE_LOW));
  assert.equal(ofType(low.events, 'free-outro').length, 1); assert.equal(ofType(low.events, 'big-win').length, 0); assert.equal(ofType(low.events, 'total-win').length, 0);
  // base: flourish below 10x, Büyük and Mega above
  assert.equal(ofType(buildGoremeTimeline(engine(F.LIFT)).events, 'total-win').length, 1);
  assert.equal(ofType(buildGoremeTimeline(engine(F.BUYUK)).events, 'big-win')[0]!.tier, 1);
  assert.equal(ofType(buildGoremeTimeline(engine(F.MEGA)).events, 'big-win')[0]!.tier, 2);
  assert.equal(ofType(buildGoremeTimeline(engine(F.FREE_BIG)).events, 'big-win')[0]!.tier, 4);
  assert.equal(ofType(buildGoremeTimeline(engine(F.LOSS)).events, 'big-win').length, 0);
});

test('multiplier callouts: only values of 10 or more, each with its tier; sky callouts when the sky reaches 10+', () => {
  assert.equal(goremeWaysCallout([{ multiplierProduct: 9 }], 1, false), 0);
  assert.equal(goremeWaysCallout([{ multiplierProduct: 10 }], 1, false), 10);
  assert.equal(goremeWaysCallout([{ multiplierProduct: 1 }], 20, true), 0, 'free spins: the sky alone is announced by the sky step');
  assert.equal(goremeWaysCallout([{ multiplierProduct: 2 }], 15, true), 30);
  const base = buildGoremeTimeline(engine(F.CALLOUT));
  const callouts = ofType(base.events, 'callout');
  assert.ok(callouts.length >= 1 && callouts.every(c => c.value >= 10 && c.tier >= 1 && c.source === 'ways'));
  const buy = ofType(buildGoremeTimeline(engine(F.BUY_SKY, 'buy')).events, 'callout');
  assert.deepEqual(buy.filter(c => c.source === 'sky').map(c => c.value), [10, 15]);
});

test('speeds change timing only: same events and numbers, turbo shorter, reduced motion keeps every step', () => {
  const round = engine(F.BUY_SKY, 'buy');
  const strip = (e: GoremeEvent) => { const { at: _a, dur: _d, ...rest } = e as GoremeEvent & Record<string, unknown>; delete (rest as Record<string, unknown>).stops; delete (rest as Record<string, unknown>).dropMs; delete (rest as Record<string, unknown>).delays; delete (rest as Record<string, unknown>).ms; delete (rest as Record<string, unknown>).tickMs; delete (rest as Record<string, unknown>).schedule; delete (rest as Record<string, unknown>).countUp; return JSON.stringify(rest); };
  const normal = buildGoremeTimeline(round), quick = buildGoremeTimeline(round, { speed: 'quick' }), turbo = buildGoremeTimeline(round, { speed: 'turbo' }), reduced = buildGoremeTimeline(round, { reducedMotion: true });
  for (const other of [quick, turbo, reduced]) assert.deepEqual(other.events.map(strip), normal.events.map(strip));
  assert.ok(turbo.duration < quick.duration && quick.duration < normal.duration);
  assert.equal(GOREME_SPEED_FACTOR.turbo, 0.35);
  // hold screens stay readable in turbo and short with skipped intros
  const introTurbo = ofType(turbo.events, 'free-intro')[0]!; assert.ok(introTurbo.dur >= 1500);
  const skip = buildGoremeTimeline(round, { skipScreens: true });
  assert.ok(ofType(skip.events, 'free-intro')[0]!.dur <= 900 && ofType(skip.events, 'free-outro')[0]!.dur <= 900);
});

test('board lengths travel in the events: reels stop left to right, the timeline waits for the last stop and every drop', () => {
  const tl = buildGoremeTimeline(engine(F.LIFT));
  for (const e of ofType(tl.events, 'spin')) {
    for (let i = 1; i < 6; i++) assert.ok(e.stops[i]! > e.stops[i - 1]!);
    assert.ok(e.dur >= e.stops[5]!);
  }
  for (const e of ofType(tl.events, 'respin')) assert.ok(e.dur >= e.delays[5]! + e.dropMs);
  for (const e of ofType(tl.events, 'lift-move')) assert.equal(e.dur, e.ms);
  const reelStops = ofType(tl.events, 'reel-stop');
  assert.equal(reelStops.length, 6 * ofType(tl.events, 'spin').length);
  // the tease: two suns down with reels still turning slows the rest
  const buy = buildGoremeTimeline(engine(F.BUY_SKY, 'buy'));
  const first = ofType(buy.events, 'spin')[0]!;
  if (first.tease !== null) {
    assert.ok(first.stops[first.tease]! - first.stops[first.tease - 1]! > (first.tease > 1 ? first.stops[1]! - first.stops[0]! : 0));
    assert.equal(ofType(buy.events, 'sun-tease').filter(e => e.on).length >= 1, true);
  }
});

test('history summary and stored detail', () => {
  assert.deepEqual(goremeHistorySummary(engine(F.LOSS)), { kind: 'none', total: 0 });
  assert.equal(goremeHistoryDetail(engine(F.LOSS)), 'Kazanç yok');
  const lift = engine(F.LIFT);
  const s = goremeHistorySummary(lift);
  assert.equal(s.kind, 'base');
  assert.match(goremeHistoryDetail(lift), /yol kazancı · \d+ kalkış · 1,60×$/);
  assert.match(goremeHistoryDetail(engine(F.BUY_SKY, 'buy')), /^Şafak Şöleni ×10 · Gök ×15 · 90,16×$/);
});

test('a merge: the survivor keeps the lowest id, its multiplier is the sum of the parts (at most x25)', () => {
  const tl = buildGoremeTimeline(engine(F.BUY_MERGE, 'buy'));
  const merges = ofType(tl.events, 'merge').flatMap(e => e.merges);
  assert.ok(merges.length >= 1);
  for (const m of merges) {
    assert.ok(m.absorbed.every(id => id > m.id));
    assert.equal(m.multiplier, Math.min(25, m.parts.reduce((a, b) => a + b, 0)));
  }
  const ev = ofType(tl.events, 'merge')[0]!;
  const move = ofType(tl.events, 'lift-move').find(e => e.step === ev.step && e.spin === ev.spin)!;
  assert.equal(ev.at, move.at + move.dur, 'the merge burst starts when the rise ends');
});

test('lift presentation timing: burner before the rise, +1 tick inside the rise, merge after it, moorings before the sky tick', () => {
  for (const [fill, mode] of [[F.LIFT, 'standard'], [F.BUY_MERGE, 'buy'], [F.BUY_SKY, 'buy']] as const) {
    for (const speed of ['normal', 'quick', 'turbo'] as const) {
      const tl = buildGoremeTimeline(engine(fill, mode), { speed });
      const lifts = ofType(tl.events, 'lift'), moves = ofType(tl.events, 'lift-move');
      assert.equal(lifts.length, moves.length);
      lifts.forEach((lift, i) => {
        const move = moves[i]!;
        // the burner flare plays first and the rise starts when it ends
        assert.equal(move.at, lift.at + lift.dur);
        assert.ok(lift.dur >= (speed === 'turbo' ? 140 : 250), `burner readable (${lift.dur} ms)`);
        // the badge ticks part-way up: after half the rise, before it ends
        assert.equal(move.tickMs, goremeTickMs(move.ms));
        assert.ok(move.tickMs > move.ms / 2 && move.tickMs < move.ms);
        // a merge starts when the rise is over; a sky tick comes after the rise (and after any merge of that lift)
        const merge = ofType(tl.events, 'merge').find(e => e.spin === move.spin && e.step === move.step);
        if (merge) assert.equal(merge.at, move.at + move.dur);
        const sky = ofType(tl.events, 'sky').find(e => e.spin === move.spin && e.at >= move.at);
        if (move.exits.some(e => e.moored)) {
          assert.ok(sky, 'moored exits are followed by the sky tick');
          assert.ok(sky!.at >= move.at + move.ms + (merge ? merge.dur : 0));
        }
      });
    }
  }
});

test('respins spin the reels again: every column lands left to right after a visible spin, and the timeline waits for the last landing', () => {
  for (const speed of ['normal', 'quick', 'turbo'] as const) {
    const tl = buildGoremeTimeline(engine(F.LIFT), { speed });
    const respins = ofType(tl.events, 'respin');
    assert.ok(respins.length >= 2);
    for (const r of respins) {
      for (let c = 1; c < 6; c++) assert.ok(r.delays[c]! > r.delays[c - 1]!, 'columns land left to right');
      // the strips spin before the first column lands (a respin is not an instant swap)
      assert.ok(r.delays[0]! >= Math.round(200 * GOREME_SPEED_FACTOR[speed]) - 1);
      assert.ok(r.dur >= r.delays[5]! + r.dropMs);
      // balloons landing in a respin land when their column does
      for (const land of ofType(tl.events, 'balloon-land').filter(e => e.at > r.at && e.at <= r.at + r.dur)) assert.equal(land.at, r.at + r.delays[land.col]! + r.dropMs);
    }
  }
  // reduced motion keeps every step but short
  const reduced = buildGoremeTimeline(engine(F.LIFT), { reducedMotion: true });
  for (const r of ofType(reduced.events, 'respin')) assert.ok(r.dur <= 400);
});
