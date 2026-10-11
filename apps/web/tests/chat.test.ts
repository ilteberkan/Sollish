import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredApi, mergeChatEvent, parseChatSnapshot } from '../lib/chat';
const event = (seq: number) => ({ v: 1, stream: 'lobby', id: '550e8400-e29b-41d4-a716-446655440000', seq, occurredAt: '2026-10-01T00:00:00Z', kind: 'chat.message', payload: { id: '550e8400-e29b-41d4-a716-446655440000', wallet: '11111111111111111111111111111111', body: 'Selam', createdAt: '2026-10-01T00:00:00Z' } });
test('chat requires gap recovery and never advances on a malformed event', () => {
  const state = { cursor: 0, events: [] };
  const next = mergeChatEvent(state, event(1));
  assert.equal(next.state.cursor, 1);
  assert.equal(mergeChatEvent(next.state, event(3)).gap, true);
  assert.equal(mergeChatEvent(next.state, event(1)).state.events.length, 1);
  assert.equal(mergeChatEvent(next.state, { ...event(2), payload: { body: '<script>' } }).state.cursor, 1);
});
test('snapshot validates sequence, message identity and bounded records', () => {
  assert.equal(parseChatSnapshot({ seq: 2, events: [event(1), event(2)] })?.cursor, 2);
  assert.equal(parseChatSnapshot({ seq: 3, events: [event(1), event(3)] }), null);
  assert.equal(parseChatSnapshot({ seq: 3, events: [event(1), event(2)] }), null);
  assert.equal(parseChatSnapshot({ seq: -1, events: [] }), null);
});
test('API URL never permits token-bearing URLs or insecure remote transport', () => {
  assert.equal(configuredApi('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(configuredApi('https://api.example.test/'), 'https://api.example.test');
  for (const bad of ['http://example.test', 'https://user:secret@example.test', 'https://api.test?token=secret', 'javascript:alert(1)', '']) assert.equal(configuredApi(bad), null);
});
