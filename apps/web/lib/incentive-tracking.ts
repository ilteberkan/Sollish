import type { IncentivesDeployment, IncentiveTicket, IncentiveAction } from '@sollish/onchain';
import { publicKey, signature as validSignature } from '@sollish/protocol';
export type IncentiveTracking = { ticket: IncentiveTicket; signature: string | null };
type Tracking = IncentiveTracking;
export function storageKey(deployment: IncentivesDeployment, player: string, kind: 'stake' | 'rewards') {
  return `sollish:incentives:${deployment.houseAuthority}:${deployment.tokenMint}:${kind}:${kind === 'stake' ? deployment.stakingPoolId : deployment.rewardPhaseId}:${player}`;
}
export function decodeIncentiveTracking(raw: string, deployment: IncentivesDeployment, player: string, kind: 'stake' | 'rewards'): Tracking {
  if (raw.length > 8000) throw new Error('INVALID_TRACKING_TICKET');
  const value = JSON.parse(raw) as Tracking;
  const ticket = value?.ticket;
  const actions: IncentiveAction[] = kind === 'stake' ? ['stake', 'unstake', 'claim-staking'] : ['claim-wager', 'claim-hourly'];
  if (!ticket || ticket.version !== 1 || ticket.player !== player || ticket.mint !== deployment.tokenMint || ticket.configuredId !== (kind === 'stake' ? deployment.stakingPoolId : deployment.rewardPhaseId) || !actions.includes(ticket.action) || !publicKey(ticket.rootAddress) || !publicKey(ticket.blockhash) || !Number.isSafeInteger(ticket.lastValidBlockHeight) || ticket.lastValidBlockHeight < 0 || typeof ticket.messageBase64 !== 'string' || ticket.messageBase64.length > 1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ticket.messageBase64) || typeof ticket.amount !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(ticket.amount) || BigInt(ticket.amount) > 18_446_744_073_709_551_615n || (ticket.epoch !== null && (typeof ticket.epoch !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(ticket.epoch) || BigInt(ticket.epoch) > 18_446_744_073_709_551_615n)) || (value.signature !== null && !validSignature(value.signature))) throw new Error('INVALID_TRACKING_TICKET');
  return value;
}

