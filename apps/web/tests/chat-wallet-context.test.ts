import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSigningWallet } from '../lib/chat-auth';
import { assertWalletContext, type ConnectedWallet } from '../lib/wallet';

function fixture(sign: () => Promise<{ signature: Uint8Array }[]>) {
  return { address: '11111111111111111111111111111111', account: { address: '11111111111111111111111111111111' }, wallet: { features: { 'solana:signMessage': { signMessage: sign } } } } as unknown as ConnectedWallet;
}
test('chat signing rejects a disconnected or same-address reconnected wallet before prompting', async () => {
  let prompts = 0; const wallet = fixture(async () => { prompts++; return [{ signature: new Uint8Array(64) }]; });
  for (const current of [null, { ...wallet }]) {
    const adapter = chatSigningWallet(wallet, () => assertWalletContext(wallet, current, true));
    await assert.rejects(adapter.signMessage(new Uint8Array([1])), /WALLET_CHANGED/);
  }
  assert.equal(prompts, 0);
});
test('late SIWS signature cannot reach auth after disconnect, same-address reconnect, or unmount', async () => {
  for (const change of ['disconnect', 'reconnect', 'unmount'] as const) {
    let resolve!: (value: { signature: Uint8Array }[]) => void;
    const wallet = fixture(() => new Promise(value => { resolve = value; })); let current: ConnectedWallet | null = wallet, alive = true;
    const adapter = chatSigningWallet(wallet, () => assertWalletContext(wallet, current, alive));
    const pending = adapter.signMessage(new Uint8Array([1]));
    if (change === 'disconnect') current = null; else if (change === 'reconnect') current = { ...wallet }; else alive = false;
    resolve([{ signature: new Uint8Array(64) }]); await assert.rejects(pending, /WALLET_CHANGED|VIEW_CLOSED/);
  }
});
test('unchanged explicit chat login passes its original signature; malformed results fail closed', async () => {
  const signature = new Uint8Array(64).fill(7); const wallet = fixture(async () => [{ signature }]);
  const adapter = chatSigningWallet(wallet, () => assertWalletContext(wallet, wallet, true));
  assert.equal(adapter.publicKey.toBase58(), wallet.address); assert.equal(await adapter.signMessage(new Uint8Array([1])), signature);
  for (const result of [[], [{ signature: new Uint8Array(63) }], [{ signature: Array(64).fill(1) as unknown as Uint8Array }]]) {
    const invalid = fixture(async () => result); await assert.rejects(chatSigningWallet(invalid, () => {}).signMessage(new Uint8Array([1])), /INVALID_SIGNATURE/);
  }
});
