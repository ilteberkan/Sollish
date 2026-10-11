import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletConnection, connectedWallet, WALLET_PREFERENCE_KEY, type ConnectedWallet, type StandardWallet, type WalletAccount, type EventsFeature, type WalletRegistry } from '../lib/wallet';

const account = (last = 0): WalletAccount => ({ address: '1'.repeat(last ? 31 : 32) + (last ? '2' : ''), publicKey: Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? last : 0), chains: ['solana:devnet'], features: [] });
function fixture(saved?: string) {
  const values = new Map<string, string>(saved ? [[WALLET_PREFERENCE_KEY, saved]] : []);
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  let wallets: StandardWallet[] = []; const listeners = new Set<() => void>();
  const registry: WalletRegistry = { get wallets() { return wallets; }, subscribe: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; } };
  const updates: (ConnectedWallet | null)[] = [];
  const controller = new WalletConnection(wallet => updates.push(wallet), store, async () => registry);
  const set = (...next: StandardWallet[]) => { wallets = next; for (const listener of listeners) listener(); };
  return { values, store, registry, updates, controller, set, latest: () => updates.at(-1) ?? null };
}
function wallet(name = 'Selected') {
  let accounts: readonly WalletAccount[] = [account()];
  const calls: ({ silent?: boolean } | undefined)[] = [];
  const listeners = new Set<Parameters<EventsFeature['on']>[1]>();
  const instance: StandardWallet = { name, icon: '', chains: ['solana:devnet'], get accounts() { return accounts; }, features: {
    'standard:connect': { connect: async (input?: { silent?: boolean }) => { calls.push(input); return { accounts }; } },
    'standard:disconnect': { disconnect: async () => { throw new Error('Extension rejected disconnect'); } },
    'standard:events': { on: (_event: 'change', listener: Parameters<EventsFeature['on']>[1]) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
  } };
  return { instance, calls, change: (next: readonly WalletAccount[]) => { accounts = next; for (const listener of [...listeners]) listener({ accounts }); } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('no preference never silently selects even an already-authorized wallet', async () => {
  const f = fixture(), w = wallet(); f.set(w.instance); await f.controller.start(); await flush();
  assert.deepEqual(w.calls, []); assert.equal(f.latest(), null); f.controller.dispose();
});
test('reload restores only the explicit selection, silently and without retaining any account or signature', async () => {
  const f = fixture(), selected = wallet(), other = wallet('Other'); f.set(other.instance, selected.instance); await f.controller.start();
  await f.controller.connect(selected.instance); assert.deepEqual(selected.calls, [undefined]); assert.deepEqual([...f.values], [[WALLET_PREFERENCE_KEY, 'Selected']]);
  f.controller.dispose(); const updates: (ConnectedWallet | null)[] = [];
  const reload = new WalletConnection(value => updates.push(value), f.store, async () => f.registry); await reload.start(); await flush();
  assert.deepEqual(selected.calls, [undefined, { silent: true }]); assert.deepEqual(other.calls, []); assert.equal(updates.at(-1)?.address, account().address); reload.dispose();
});
test('late registration restores selected wallet once; duplicate labels require explicit choice', async () => {
  const f = fixture('Selected'), a = wallet(), b = wallet(); await f.controller.start(); f.set(a.instance, b.instance); await flush();
  assert.deepEqual(a.calls, []); assert.deepEqual(b.calls, []); f.set(a.instance); await flush();
  assert.deepEqual(a.calls, [{ silent: true }]); f.set(a.instance); await flush(); assert.equal(a.calls.length, 1); f.controller.dispose();
});
test('disconnect immediately forgets preference despite extension failure and does not restore on reload', async () => {
  const f = fixture('Selected'), w = wallet(); f.set(w.instance); await f.controller.start(); await flush();
  await f.controller.disconnect(); assert.equal(f.latest(), null); assert.equal(f.values.size, 0);
  f.set(w.instance); await flush(); assert.equal(w.calls.length, 1); f.controller.dispose();
  const reload = new WalletConnection(() => assert.fail('Unexpected restored connection'), f.store, async () => f.registry); await reload.start(); await flush(); assert.equal(w.calls.length, 1); reload.dispose();
});
test('disconnect or a newer selection invalidates an in-flight connect response', async () => {
  const f = fixture(); let resolve!: (value: { accounts: WalletAccount[] }) => void;
  const slow = wallet('Slow'); slow.instance.features['standard:connect'] = { connect: () => new Promise(value => { resolve = value; }) };
  const pending = f.controller.connect(slow.instance); await f.controller.disconnect(); resolve({ accounts: [account()] }); await assert.rejects(pending, /WALLET_CHANGED/); assert.equal(f.latest(), null); assert.equal(f.values.size, 0);
  const pendingAgain = f.controller.connect(slow.instance); const newer = wallet('New'); await f.controller.connect(newer.instance); resolve({ accounts: [account()] }); await assert.rejects(pendingAgain, /WALLET_CHANGED/); assert.equal(f.latest()?.name, 'New'); f.controller.dispose();
});
test('account events rotate connection identity; account loss forgets selection; unregister invalidates connection', async () => {
  const f = fixture(), w = wallet(); f.set(w.instance); await f.controller.start(); await f.controller.connect(w.instance); const original = f.latest();
  w.change([account()]); assert.notEqual(f.latest(), original); w.change([account(1)]); assert.equal(f.latest()?.address, account(1).address);
  w.change([]); assert.equal(f.latest(), null); assert.equal(f.values.size, 0);
  w.change([account()]); assert.equal(f.latest(), null); await f.controller.connect(w.instance); f.set(); assert.equal(f.latest(), null); f.controller.dispose();
});
test('disposed controller cannot publish a late result or subscribe to events', async () => {
  const f = fixture(); let resolve!: (value: { accounts: WalletAccount[] }) => void; const w = wallet();
  w.instance.features['standard:connect'] = { connect: () => new Promise(value => { resolve = value; }) };
  const pending = f.controller.connect(w.instance); const count = f.updates.length; f.controller.dispose(); resolve({ accounts: [account()] });
  await assert.rejects(pending, /WALLET_CHANGED/); assert.equal(f.updates.length, count); assert.equal(f.values.size, 0);
});
test('silent rejection never falls back to prompting; explicit retry still works', async () => {
  const f = fixture('Selected'), w = wallet(); let prompts = 0;
  w.instance.features['standard:connect'] = { connect: async (input?: { silent?: boolean }) => { if (input?.silent) throw new Error('Not authorized'); prompts++; return { accounts: [account()] }; } };
  f.set(w.instance); await f.controller.start(); await flush(); f.set(w.instance); await flush(); assert.equal(prompts, 0); assert.equal(f.latest(), null);
  await f.controller.connect(w.instance); assert.equal(prompts, 1); f.controller.dispose();
});
test('account decoder rejects mismatched address, malformed key and non-Solana chains', () => {
  const w = wallet().instance, a = account();
  assert.equal(connectedWallet(w, [{ ...a, address: account(1).address }]), null);
  assert.equal(connectedWallet(w, [{ ...a, publicKey: new Uint8Array(31) }]), null);
  assert.equal(connectedWallet(w, [{ ...a, chains: ['ethereum:1'] }]), null);
  const decoded = connectedWallet(w, [a])!; a.publicKey[0] = 1; assert.equal(decoded.publicKey[0], 0);
});
