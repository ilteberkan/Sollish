import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTracking, encodeTracking, parseSol, solLabel, transactionWallet } from '../lib/live';
import { assertWalletContext, type ConnectedWallet } from '../lib/wallet';
test('SOL parsing uses integer lamports without floating-point truncation', () => {
  assert.equal(parseSol('0.000000001'), 1n);
  assert.equal(parseSol('0,123456789'), 123456789n);
  assert.equal(solLabel(1234567890n), '1,23456789');
  for (const invalid of ['0', '-1', '1e9', '0.0000000001', 'Infinity', '1,2.3']) assert.equal(parseSol(invalid), null);
});
test('receipt tracking survives serialization with exact u64 and wallet identity', () => {
  const player = '11111111111111111111111111111111';
  const tracking = { player, betAddress: player, id: 18_446_744_073_709_551_615n };
  assert.deepEqual(decodeTracking(encodeTracking(tracking), player), tracking);
  assert.equal(decodeTracking(encodeTracking(tracking), 'other'), null);
  assert.equal(decodeTracking(JSON.stringify({ ...tracking, id: '18446744073709551616' }), player), null);
  assert.equal(decodeTracking(JSON.stringify({ ...tracking, id: '1', signature: 'fake' }), player), null);
});
test('wallet adapter rejects unsupported devnet before invoking wallet methods', () => {
  let called = false;
  const wallet = { address: '11111111111111111111111111111111', account: { chains: ['solana:mainnet'] }, wallet: { features: { 'solana:signAndSendTransaction': { signAndSendTransaction() { called = true; } } } } } as unknown as ConnectedWallet;
  assert.throws(() => transactionWallet(wallet)); assert.equal(called, false);
});

function connectedFixture(address: string, onSign: () => void): ConnectedWallet {
  return { address, account: { chains: ['solana:devnet'] }, wallet: { features: { 'solana:signAndSendTransaction': { async signAndSendTransaction() { onSign(); return [{ signature: new Uint8Array(64) }]; } } } } } as unknown as ConnectedWallet;
}
test('review is bound to the connection instance, including same-address reconnects', () => {
  const a = connectedFixture('wallet-A', () => {});
  const b = connectedFixture('wallet-B', () => {});
  assert.doesNotThrow(() => assertWalletContext(a, a, true));
  for (const changed of [b, null, { ...a }]) assert.throws(() => assertWalletContext(a, changed, true), /WALLET_CHANGED/);
  assert.throws(() => assertWalletContext(a, a, false), /VIEW_CLOSED/);
});
test('disconnect or navigation during asynchronous prepare prevents ticket admission and wallet invocation', async () => {
  for (const change of ['disconnect', 'switch', 'unmount'] as const) {
    let invoked = 0;
    const a = connectedFixture('wallet-A', () => { invoked++; });
    let current: ConnectedWallet | null = a;
    let alive = true;
    const requireContext = () => assertWalletContext(a, current, alive);
    const adapter = transactionWallet(a, requireContext);
    const delayedPrepare = Promise.resolve();
    if (change === 'disconnect') current = null;
    if (change === 'switch') current = connectedFixture('wallet-B', () => { invoked++; });
    if (change === 'unmount') alive = false;
    await delayedPrepare;
    let persisted = false;
    assert.throws(() => { requireContext(); persisted = true; });
    assert.equal(persisted, false);
    await assert.rejects(adapter.signAndSendTransaction(new Uint8Array(), 'solana:devnet'));
    assert.equal(invoked, 0);
  }
});
