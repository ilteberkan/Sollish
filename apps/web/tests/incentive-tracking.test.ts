import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncentivesDeployment, IncentiveTicket } from '@sollish/onchain';
import { decodeIncentiveTracking, storageKey } from '../lib/incentive-tracking';
const player = '11111111111111111111111111111111';
const deployment: IncentivesDeployment = { enabled: true, network: 'devnet', rpcUrl: 'https://api.devnet.solana.com', houseAuthority: player, shardId: 0, tokenMint: player, stakingPoolId: '0', rewardPhaseId: '1' };
const ticket: IncentiveTicket = { version: 1, action: 'stake', player, mint: player, rootAddress: player, configuredId: '0', amount: '1000000', epoch: null, blockhash: player, lastValidBlockHeight: 100, messageBase64: 'AQ==' };
test('public incentive tickets are bound to account, configuration and action family', () => {
  const raw = JSON.stringify({ ticket, signature: null });
  assert.deepEqual(decodeIncentiveTracking(raw, deployment, player, 'stake'), { ticket, signature: null });
  assert.throws(() => decodeIncentiveTracking(raw, deployment, player, 'rewards'));
  assert.throws(() => decodeIncentiveTracking(raw, { ...deployment, stakingPoolId: '1' }, player, 'stake'));
  assert.throws(() => decodeIncentiveTracking(raw, deployment, 'other-wallet', 'stake'));
  assert.notEqual(storageKey(deployment, player, 'stake'), storageKey(deployment, player, 'rewards'));
});
test('malformed and unbounded persisted tickets never enable a payment label', () => {
  for (const alteration of [{ amount: 123 }, { amount: '18446744073709551616' }, { epoch: -1 }, { rootAddress: 'fake' }, { messageBase64: 'a'.repeat(1801) }, { messageBase64: '$invalid' }, { lastValidBlockHeight: 1.5 }]) {
    assert.throws(() => decodeIncentiveTracking(JSON.stringify({ ticket: { ...ticket, ...alteration }, signature: null }), deployment, player, 'stake'));
  }
  assert.throws(() => decodeIncentiveTracking('x'.repeat(8001), deployment, player, 'stake'));
});
