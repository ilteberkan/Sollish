import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incentiveDeployment, parseTokens, tokenLabel, utcEpochLabel } from '../lib/tokens';
import { liveDeployment } from '../lib/live';
test('token units preserve six decimals and reject overprecision and u64 overflow', () => {
  assert.equal(parseTokens('1,000001'), 1000001n);
  assert.equal(parseTokens('0.000001'), 1n);
  assert.equal(parseTokens('18446744073709.551615'), 18_446_744_073_709_551_615n);
  for (const bad of ['0', '-1', '0.0000001', '1e6', '18446744073709.551616', 'Infinity']) assert.equal(parseTokens(bad), null);
  assert.equal(tokenLabel(12345000123n), '12.345,000123');
});
test('hourly token periods are explicit UTC epochs, not a rolling hour', () => {
  assert.match(utcEpochLabel(0n), /UTC$/);
  assert.equal(utcEpochLabel(-1n), 'Geçersiz dönem');
});
test('staking access is independent from the Coinflip admission switch', () => {
  const values: Record<string, string> = { NEXT_PUBLIC_COINFLIP_ENABLED: 'false', NEXT_PUBLIC_INCENTIVES_ENABLED: 'true', NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com', NEXT_PUBLIC_HOUSE_AUTHORITY: '11111111111111111111111111111111', NEXT_PUBLIC_HOUSE_SHARD_ID: '0', NEXT_PUBLIC_TOKEN_MINT: '11111111111111111111111111111111', NEXT_PUBLIC_STAKING_POOL_ID: '0' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try { Object.assign(process.env, values); assert.equal(liveDeployment(), null); assert.equal(incentiveDeployment('stake')?.stakingPoolId, '0'); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
