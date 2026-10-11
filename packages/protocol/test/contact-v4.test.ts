import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateContactCombatV4, COMBAT_V4_VERSION, COMBAT_V4_DURATION_MS, V4_TICK_MS, V4_STRIKES, type V4Replay } from '../src/combat-v4';
import { COMBAT_V3_VERSION, simulateContactCombat } from '../src/combat-v3';
import { CONNECTOME_POLICY_INFO } from '../src/connectome-policy';
import { CONTACT_ENGINES, combatResults, contactCommitmentInput, contactCommitmentInputV4, type ContactBout } from '../src/ringside';

const seed = (i: number) => createHash('sha256').update(`contact-v4-${i}`).digest('hex');
const replays: V4Replay[] = Array.from({ length: 24 }, (_, i) => simulateContactCombatV4(seed(i), i % 3 ? undefined : { health: { kor: 520, ayaz: 610 }, stamina: { kor: 640, ayaz: 700 } }));

test('v4 is deterministic, pinned to the frozen policy and never mutates its input', () => {
  const initial = { health: { kor: 700, ayaz: 900 }, stamina: { kor: 500, ayaz: 800 } }, copy = structuredClone(initial);
  const a = simulateContactCombatV4(seed(99), initial), b = simulateContactCombatV4(seed(99), initial);
  assert.deepEqual(a, b); assert.deepEqual(initial, copy);
  assert.equal(a.version, COMBAT_V4_VERSION); assert.notEqual(COMBAT_V4_VERSION, COMBAT_V3_VERSION);
  assert.ok(COMBAT_V4_VERSION.endsWith(CONNECTOME_POLICY_INFO.modelSha256.slice(0, 8)));
  assert.equal(a.frames.length, COMBAT_V4_DURATION_MS / V4_TICK_MS + 1);
  assert.throws(() => simulateContactCombatV4('xyz'), TypeError);
});

test('every frame keeps bounded state, separated bodies and damage traceable to same-tick contact', () => {
  for (const r of replays) {
    let previous = { kor: r.frames[0]!.kor.health, ayaz: r.frames[0]!.ayaz.health };
    for (const f of r.frames) {
      for (const side of ['kor', 'ayaz'] as const) {
        const a = f[side], damage = r.events.filter(e => e.tick === f.tick && e.target === side && (e.type === 'hit' || e.type === 'block')).reduce((n, e) => n + e.damage, 0);
        if (f.tick > 0) assert.equal(a.health, Math.max(0, previous[side] - damage));
        previous[side] = a.health;
        assert.ok(a.health >= 0 && a.health <= 1000 && a.stamina >= 0 && a.stamina <= 1000 && a.stun >= 0);
        assert.ok(Number.isInteger(a.x) && Number.isInteger(a.z) && Math.abs(a.x) <= 3100 && Math.abs(a.z) <= 3100);
      }
      assert.ok(Math.hypot(f.kor.x - f.ayaz.x, f.kor.z - f.ayaz.z) >= 600);
    }
  }
});

test('each strike resolves at most once, exactly on its first active tick', () => {
  for (const r of replays) {
    const open = new Map<string, { tick: number; technique: string }>();
    for (const e of r.events) {
      if (e.type === 'strike') { open.set(e.actor, { tick: e.tick, technique: e.technique }); continue; }
      if (!['hit', 'block', 'dodge', 'miss'].includes(e.type)) continue;
      const s = open.get(e.actor);
      assert.ok(s, 'resolution without a strike');
      assert.equal(e.technique, s!.technique);
      assert.equal(e.tick - s!.tick, V4_STRIKES[s!.technique as keyof typeof V4_STRIKES].wind);
      open.delete(e.actor);
    }
  }
});

test('knockdowns run a visible count, then a rise or a stoppage; nobody punches during the count', () => {
  let counted = 0;
  for (const r of replays) for (const kd of r.events.filter(e => e.type === 'knockdown')) {
    counted++;
    const after = r.events.filter(e => e.tick > kd.tick);
    const end = after.find(e => e.type === 'rise' || e.type === 'finish');
    if (!end) { assert.ok(r.frames.at(-1)!.tick - kd.tick < 200, 'only the round bell may cut a count short'); continue; }
    assert.ok(!after.some(e => e.tick < end.tick && e.type === 'strike'), 'no strikes while a fighter is down');
    if (end.type === 'finish') assert.equal(r.finish, 'stoppage');
    const counts = after.filter(e => e.type === 'count' && e.tick < end.tick).map(e => e.count);
    if (end.type === 'rise') assert.ok(counts.length >= 3 && counts.every((c, i) => c === i + 1));
  }
  assert.ok(counted > 0, 'fixture includes knockdowns');
});

test('tempo, technique mix and side balance stay within the published design band', () => {
  const N = 160, wins = { kor: 0, ayaz: 0, draw: 0 }, techniques = new Set<string>();
  let strikes = 0, hits = 0, combos = 0, knockdowns = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateContactCombatV4(createHash('sha256').update(`balance-${i}`).digest('hex'));
    wins[r.winner]++; knockdowns += r.knockdown === 'yes' ? 1 : 0;
    for (const e of r.events) { if (e.type === 'strike') { strikes++; techniques.add(e.technique); if ((e.combo ?? 0) > 0) combos++; } if (e.type === 'hit') hits++; }
  }
  assert.ok(wins.kor / N > .38 && wins.ayaz / N > .38, `balanced sides ${JSON.stringify(wins)}`);
  assert.ok(strikes / N > 70, `tempo ${strikes / N} strikes per round`);
  assert.ok(hits / strikes > .25 && hits / strikes < .5, 'landed share');
  assert.ok(combos / strikes > .2, 'combinations are common');
  assert.equal(techniques.size, Object.keys(V4_STRIKES).length);
  assert.ok(knockdowns / N > .1 && knockdowns / N < .6, `knockdown rate ${knockdowns / N}`);
});

test('engine registry pairs each round with its own commitment bytes and results', () => {
  const bout: ContactBout = { id: '7', round: 1, score: { kor: 0, ayaz: 0 }, initial: { health: { kor: 1000, ayaz: 1000 }, stamina: { kor: 1000, ayaz: 1000 } } };
  assert.ok(contactCommitmentInputV4('7', seed(1), bout).startsWith(`sollish:ringside:v4:${COMBAT_V4_VERSION}:7:`));
  assert.ok(contactCommitmentInput('7', seed(1), bout).startsWith(`sollish:ringside:v3:${COMBAT_V3_VERSION}:7:`));
  assert.equal(CONTACT_ENGINES[COMBAT_V4_VERSION].durationMs, COMBAT_V4_DURATION_MS);
  assert.deepEqual(combatResults(CONTACT_ENGINES[COMBAT_V4_VERSION].simulate(seed(2), bout.initial)), combatResults(simulateContactCombatV4(seed(2), bout.initial)));
  assert.deepEqual(combatResults(CONTACT_ENGINES[COMBAT_V3_VERSION].simulate(seed(2), bout.initial)), combatResults(simulateContactCombat(seed(2), bout.initial)));
});
