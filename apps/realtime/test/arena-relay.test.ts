import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayPublisher, isRelayArena, relayCount, relayMinIntervalMs, relayName, relaySocketCap } from '../src/relay-publisher';

test('relay settings: off by default, bounded, only the shared LIVE arena may publish', () => {
  assert.equal(relayCount({}), 0); assert.equal(relayCount({ LIVE_RELAYS: '16' }), 16); assert.equal(relayCount({ LIVE_RELAYS: '9999' }), 0); assert.equal(relayCount({ LIVE_RELAYS: '-1' }), 0);
  assert.equal(relaySocketCap({}), 2000); assert.equal(relaySocketCap({ LIVE_RELAY_SOCKETS: '40000' }), 2000);
  assert.equal(relayMinIntervalMs({}), 250);
  assert.equal(isRelayArena('v5'), true); for (const v of ['v4', 'v2', '', null, '__proto__', 'toString']) assert.equal(isRelayArena(v as string | null), false);
  assert.equal(relayName('v5', 3), 'relay:v5:3');
});

test('relay publisher: latest-only per relay, rate-limited, no queue growth, failures do not throw', async () => {
  const sent: { name: string; body: string; at: number }[] = [];
  let fail = false;
  const ns = {
    idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({ fetch: async (_u: RequestInfo | URL, init?: RequestInit) => { const at = Date.now(); await new Promise(r => setTimeout(r, 5)); if (fail) throw new Error('lost'); sent.push({ name: (id as unknown as { name: string }).name, body: String(init?.body), at }); return new Response('{}'); } }),
  };
  const pub = new RelayPublisher('v5', { LIVE_RELAYS: '2', LIVE_RELAY_MIN_INTERVAL_MS: '100', ARENA_RELAY: ns });
  for (let rev = 1; rev <= 50; rev++) pub.publish(JSON.stringify({ revision: rev }));
  await new Promise(r => setTimeout(r, 400));
  for (const name of ['relay:v5:0', 'relay:v5:1']) {
    const mine = sent.filter(s => s.name === name);
    assert.equal(mine[0]!.body, '{"revision":1}'); assert.equal(mine.at(-1)!.body, '{"revision":50}', 'the newest snapshot always arrives');
    assert.ok(mine.length <= 3, `coalesced: ${mine.length} pushes for 50 snapshots`);
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i]!.at - mine[i - 1]!.at >= 98, 'min interval honoured (send start to send start)');
  }
  fail = true; pub.publish('{"revision":51}'); await new Promise(r => setTimeout(r, 250));
  fail = false; pub.publish('{"revision":52}'); await new Promise(r => setTimeout(r, 250));
  assert.equal(sent.filter(s => s.name === 'relay:v5:0').at(-1)!.body, '{"revision":52}');
  const off = new RelayPublisher('v5', { ARENA_RELAY: ns }); const before = sent.length; off.publish('{"revision":99}'); await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.length, before, 'LIVE_RELAYS unset publishes nothing');
});
