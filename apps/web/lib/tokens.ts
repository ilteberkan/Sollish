import { publicKey } from '@sollish/protocol';
import { deploymentConfig } from './live';

export function incentiveDeployment(kind: 'stake' | 'rewards') {
  const base = deploymentConfig(process.env.NEXT_PUBLIC_INCENTIVES_ENABLED === 'true');
  const tokenMint = process.env.NEXT_PUBLIC_TOKEN_MINT;
  const stakingPoolId = process.env.NEXT_PUBLIC_STAKING_POOL_ID;
  const rewardPhaseId = process.env.NEXT_PUBLIC_REWARD_PHASE_ID;
  const id = kind === 'stake' ? stakingPoolId : rewardPhaseId;
  if (!base || !publicKey(tokenMint) || id === undefined || !/^(0|[1-9]\d{0,19})$/.test(id) || BigInt(id) > 18_446_744_073_709_551_615n) return null;
  return { ...base, tokenMint, ...(stakingPoolId !== undefined ? { stakingPoolId } : {}), ...(rewardPhaseId !== undefined ? { rewardPhaseId } : {}) };
}
export function parseTokens(value: string, decimals = 6): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) return null;
  const clean = value.trim().replace(',', '.');
  if (!new RegExp(`^\\d{1,15}${decimals ? `(?:\\.\\d{1,${decimals}})?` : ''}$`).test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const units = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return units > 0n && units <= 18_446_744_073_709_551_615n ? units : null;
}
export function tokenLabel(units: bigint, decimals = 6): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9 || units < 0n) throw new RangeError('Invalid token value');
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${(units / scale).toLocaleString('tr-TR')}${fraction ? `,${fraction}` : ''}`;
}
export function utcEpochLabel(epoch: bigint): string {
  const seconds = epoch * 3600n;
  if (seconds < 0n || seconds > 8_640_000_000_000n) return 'Geçersiz dönem';
  return `${new Date(Number(seconds * 1000n)).toLocaleString('tr-TR', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC`;
}
