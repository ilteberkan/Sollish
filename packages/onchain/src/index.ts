import { Buffer } from 'buffer';
import bs58 from 'bs58';
import {
  Connection, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction, VersionedTransaction, ComputeBudgetProgram,
  type AccountInfo, type Commitment,
} from '@solana/web3.js';
import { decodeAccount, instruction, u64 } from './codec';
import { schema } from './schema';
import { prepareWagerReward, type IncentivesDeployment } from './incentives';
import { pda, key, equal, canonical, required, snapshotSlot } from './common';

export const HOUSE_PROGRAM = new PublicKey(schema.house.address);
export const GAMES_PROGRAM = new PublicKey(schema.games.address);
export const VRF_PROGRAM = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
export const VRF_QUEUE = new PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const CHAIN = 'solana:devnet' as const;
export interface CoinflipDeployment {
  enabled: boolean;
  network: 'devnet';
  rpcUrl: string;
  houseAuthority: string;
  shardId: number;
  tokenMint?: string;
}
export interface TransactionWallet {
  address: string;
  /** Wallet Standard solana:signAndSendTransaction; never sign a server-provided transaction. */
  signAndSendTransaction(transaction: Uint8Array, chain: typeof CHAIN): Promise<Uint8Array>;
}
export type CoinflipStatus = 'awaiting-randomness' | 'ready-to-settle' | 'settled';
export interface CoinflipResult {
  betAddress: string; player: string; id: bigint; stake: bigint; payout: bigint;
  side: 0 | 1; winningSide: 0 | 1 | null; status: CoinflipStatus;
}

type Rpc = Pick<Connection, 'getGenesisHash' | 'getMultipleAccountsInfoAndContext' | 'getLatestBlockhash' |
  'getMinimumBalanceForRentExemption' | 'simulateTransaction' | 'getSignatureStatuses' | 'getTransaction' | 'getAccountInfo'>;
type House = { authority: PublicKey; game_program: PublicKey; paused: boolean; bump: number };
type Shard = { config: PublicKey; id: number; buffer: bigint; max_stake: bigint; max_gross: bigint; reserved: bigint; bump: number };
type Config = { house: PublicKey; queue: PublicKey; edge_bps: number; bump: number };
type Ledger = { config: PublicKey; player: PublicKey; last_bet_id: bigint; bump: number };
type Activity = { house: PublicKey; player: PublicKey; bump: number };
type Bet = {
  config: PublicKey; house: PublicKey; shard: PublicKey; player: PublicKey;
  id: bigint; stake: bigint; max_gross: bigint; payout: bigint; side: number; status: number;
  randomness: Uint8Array; request_tag: Uint8Array; bump: number;
};

/** Intentionally no mainnet switch. These contracts and the provider's queue are a devnet candidate. */
export function validateDeployment(deployment: CoinflipDeployment) {
  if (!deployment.enabled) throw new Error('DEPLOYMENT_DISABLED');
  if (deployment.network !== 'devnet') throw new Error('UNSUPPORTED_NETWORK');
  const endpoint = new URL(deployment.rpcUrl);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('INVALID_RPC_URL');
  if (!Number.isInteger(deployment.shardId) || deployment.shardId < 0 || deployment.shardId > 65535) throw new Error('INVALID_SHARD');
  key(deployment.houseAuthority);
}
export function createRpc(deployment: CoinflipDeployment): Connection {
  validateDeployment(deployment);
  return new Connection(deployment.rpcUrl, {
    commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }),
  });
}

export function addresses(authority: PublicKey, player: PublicKey, shardId: number, id: bigint) {
  if (!Number.isInteger(shardId) || shardId < 0 || shardId > 65535 || id <= 0n) throw new Error('INVALID_BET_ADDRESS');
  const shardBytes = Buffer.alloc(2); shardBytes.writeUInt16LE(shardId);
  const house = pda(HOUSE_PROGRAM, 'house', authority.toBytes())[0];
  return {
    player, authority, house,
    config: pda(GAMES_PROGRAM, 'coinflip_config', house.toBytes())[0],
    shard: pda(HOUSE_PROGRAM, 'shard', house.toBytes(), shardBytes)[0],
    player_ledger: pda(HOUSE_PROGRAM, 'player', house.toBytes(), player.toBytes())[0],
    activity: pda(GAMES_PROGRAM, 'activity', house.toBytes(), player.toBytes())[0],
    bet: pda(GAMES_PROGRAM, 'coinflip', house.toBytes(), player.toBytes(), u64(id))[0],
    house_bet: pda(HOUSE_PROGRAM, 'bet', house.toBytes(), player.toBytes(), u64(id))[0],
    house_authority: pda(GAMES_PROGRAM, 'house_authority', house.toBytes())[0],
    program_identity: pda(GAMES_PROGRAM, 'identity')[0],
    game_program: GAMES_PROGRAM, house_program: HOUSE_PROGRAM, vrf_program: VRF_PROGRAM,
    oracle_queue: VRF_QUEUE, slot_hashes: SYSVAR_SLOT_HASHES_PUBKEY, system_program: SystemProgram.programId,
  };
}

async function deploymentState(deployment: CoinflipDeployment, player: PublicKey, rpc: Rpc) {
  validateDeployment(deployment);
  if (await rpc.getGenesisHash() !== DEVNET_GENESIS) throw new Error('GENESIS_MISMATCH');
  const authority = key(deployment.houseAuthority);
  const a = addresses(authority, player, deployment.shardId, 1n);
  const response = await rpc.getMultipleAccountsInfoAndContext([HOUSE_PROGRAM, GAMES_PROGRAM, VRF_PROGRAM, a.house, a.config, a.shard, VRF_QUEUE, a.player_ledger, a.activity], 'confirmed');
  const values = response.value;
  for (let i = 0; i < 3; i++) if (!required(values[i]).executable) throw new Error('PROGRAM_NOT_EXECUTABLE');
  const house = decodeAccount<House>('house', 'HouseConfig', required(values[3]));
  equal(house.authority, authority); equal(house.game_program, GAMES_PROGRAM);
  canonical(a.house, house.bump, pda(HOUSE_PROGRAM, 'house', authority.toBytes()));
  if (house.paused) throw new Error('HOUSE_PAUSED');
  const config = decodeAccount<Config>('games', 'CoinflipConfig', required(values[4]));
  equal(config.house, a.house); equal(config.queue, VRF_QUEUE);
  canonical(a.config, config.bump, pda(GAMES_PROGRAM, 'coinflip_config', a.house.toBytes()));
  if (config.edge_bps > 500) throw new Error('INVALID_HOUSE_EDGE');
  const shardAccount = required(values[5]);
  const shard = decodeAccount<Shard>('house', 'HouseShard', shardAccount);
  equal(shard.config, a.house);
  if (shard.id !== deployment.shardId) throw new Error('SHARD_ID_MISMATCH');
  const bytes = Buffer.alloc(2); bytes.writeUInt16LE(shard.id);
  canonical(a.shard, shard.bump, pda(HOUSE_PROGRAM, 'shard', a.house.toBytes(), bytes));
  equal(required(values[6]).owner, VRF_PROGRAM);
  let nextId = 1n;
  if (values[7]) {
    const ledger = decodeAccount<Ledger>('house', 'PlayerLedger', values[7]);
    equal(ledger.config, a.house); equal(ledger.player, player);
    canonical(a.player_ledger, ledger.bump, pda(HOUSE_PROGRAM, 'player', a.house.toBytes(), player.toBytes()));
    nextId = ledger.last_bet_id + 1n; u64(nextId);
  }
  if (values[8]) {
    const activity = decodeAccount<Activity>('games', 'GamePlayerActivity', values[8]);
    equal(activity.house, a.house); equal(activity.player, player);
    canonical(a.activity, activity.bump, pda(GAMES_PROGRAM, 'activity', a.house.toBytes(), player.toBytes()));
  }
  return { a: addresses(authority, player, deployment.shardId, nextId), nextId, config, shard, shardAccount, initLedger: !values[7], initActivity: !values[8], slot: snapshotSlot(response.context.slot, 0) };
}

export async function prepareCoinflip(args: { deployment: CoinflipDeployment; player: string; amountLamports: bigint; side: 0 | 1; rewardPhaseId?: string }, rpc: Rpc = createRpc(args.deployment)) {
  validateDeployment(args.deployment);
  if (args.amountLamports <= 0n || typeof args.amountLamports !== 'bigint' || (args.side !== 0 && args.side !== 1)) throw new Error('INVALID_BET');
  u64(args.amountLamports);
  const player = key(args.player);
  const state = await deploymentState(args.deployment, player, rpc);
  const gross = args.amountLamports * BigInt(2 * (10_000 - state.config.edge_bps)) / 10_000n;
  if (args.amountLamports > state.shard.max_stake || gross > state.shard.max_gross || gross < args.amountLamports) throw new Error('BET_LIMIT_EXCEEDED');
  const rent = await rpc.getMinimumBalanceForRentExemption(state.shardAccount.data.length, 'confirmed');
  if (!Number.isSafeInteger(state.shardAccount.lamports) || !Number.isSafeInteger(rent)) throw new Error('UNSAFE_RPC_INTEGER');
  const free = BigInt(state.shardAccount.lamports) - BigInt(rent) - state.shard.buffer - state.shard.reserved;
  if (free < gross - args.amountLamports) throw new Error('INSUFFICIENT_HOUSE_RESERVE');
  const reward = args.rewardPhaseId !== undefined
    ? await prepareWagerReward({ ...args.deployment, tokenMint: required(args.deployment.tokenMint), rewardPhaseId: args.rewardPhaseId } as IncentivesDeployment, args.player, args.amountLamports, rpc, state.slot)
    : null;
  const snapshotSlotValue = Math.max(state.slot, reward?.slot ?? 0);
  const block = await rpc.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: snapshotSlotValue });
  const transaction = new Transaction({ feePayer: player, ...block });
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  if (state.initLedger) transaction.add(instruction('house', 'initialize_player', { ...state.a, config: state.a.house }));
  if (state.initActivity) transaction.add(instruction('games', 'initialize_activity', state.a));
  if (reward) {
    const gameAccounts = Object.fromEntries(Object.entries(state.a).map(([name, value]) => [`game.${name}`, value]));
    transaction.add(instruction('games', 'place_coinflip_rewarded', {
      ...gameAccounts, ...reward.accounts, reward_phase: reward.accounts.phase,
    }, {id: state.nextId, side: args.side, stake: args.amountLamports, epoch: reward.epoch}));
  } else transaction.add(instruction('games', 'place_coinflip', state.a, { id: state.nextId, side: args.side, stake: args.amountLamports }));
  const wire = new VersionedTransaction(transaction.compileMessage());
  if (wire.serialize().length > 1232) throw new Error('TRANSACTION_PACKET_TOO_LARGE');
  const simulation = await rpc.simulateTransaction(wire, { sigVerify: false, commitment: 'confirmed', minContextSlot: snapshotSlotValue });
  snapshotSlot(simulation.context.slot, snapshotSlotValue);
  if (!simulation.value || simulation.value.err !== null) throw new Error('TRANSACTION_SIMULATION_FAILED');
  return { transaction: wire.serialize(), message: wire.message.serialize(), betAddress: state.a.bet.toBase58(), id: state.nextId, expectedGrossLamports: gross, rewardQuote: reward ? {phaseAddress: reward.phaseAddress, epoch: reward.epoch, tokenUnits: reward.reward, tokenDecimals: 6 as const} : null, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight };
}

export class SubmissionUnknownError extends Error {
  constructor(readonly signature: string, readonly betAddress: string, readonly id: bigint) {
    super('SUBMISSION_UNKNOWN_TRACK_SIGNATURE_DO_NOT_RESUBMIT'); this.name = 'SubmissionUnknownError';
  }
}
export class WalletSubmissionUnknownError extends Error {
  constructor(readonly betAddress: string, readonly id: bigint, readonly lastValidBlockHeight: number) {
    super('WALLET_SUBMISSION_UNKNOWN_CHECK_BET_BEFORE_RETRY'); this.name = 'WalletSubmissionUnknownError';
  }
}
export interface PreparedBetTicket {
  readonly betAddress: string;
  readonly id: bigint;
  readonly lastValidBlockHeight: number;
}
/** Exactly one wallet call. A timeout is unknown, never a safe reason to place a new bet. */
export async function sendCoinflip(args: { deployment: CoinflipDeployment; wallet: TransactionWallet; amountLamports: bigint; side: 0 | 1; rewardPhaseId?: string; onPrepared?: (ticket: PreparedBetTicket) => void }, rpc: Rpc = createRpc(args.deployment)) {
  const prepared = await prepareCoinflip({ ...args, player: args.wallet.address }, rpc);
  // Persist only public tracking metadata before the wallet can broadcast. A
  // failed persistence hook aborts before requesting any signature.
  args.onPrepared?.({ betAddress: prepared.betAddress, id: prepared.id, lastValidBlockHeight: prepared.lastValidBlockHeight });
  let signed: Uint8Array;
  try {
    signed = await args.wallet.signAndSendTransaction(prepared.transaction, CHAIN);
    if (!(signed instanceof Uint8Array) || signed.length !== 64) throw new Error('INVALID_WALLET_SIGNATURE');
  } catch {
    // A wallet may have broadcast successfully before its bridge disconnects.
    // Preserve the deterministic bet address even when no signature returns.
    throw new WalletSubmissionUnknownError(prepared.betAddress, prepared.id, prepared.lastValidBlockHeight);
  }
  const signature = bs58.encode(signed);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = response.value[0];
      if (status?.err) throw new Error('TRANSACTION_FAILED');
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        const landed = await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (landed) {
          if (landed.transaction.signatures?.[0] !== signature || !Buffer.from(landed.transaction.message.serialize()).equals(Buffer.from(prepared.message))) {
            throw new Error('CONFIRMED_TRANSACTION_MISMATCH');
          }
          if (!landed.meta || !Object.hasOwn(landed.meta, 'err') || landed.meta.err !== null || !Object.hasOwn(status, 'err') || status.err !== null) throw new Error('UNVERIFIED_TRANSACTION_METADATA');
          return { signature, betAddress: prepared.betAddress, id: prepared.id, status: 'confirmed' as const };
        }
      }
    } catch (error) {
      if (error instanceof Error && ['TRANSACTION_FAILED', 'CONFIRMED_TRANSACTION_MISMATCH'].includes(error.message)) throw error;
      throw new SubmissionUnknownError(signature, prepared.betAddress, prepared.id);
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new SubmissionUnknownError(signature, prepared.betAddress, prepared.id);
}

/** Use finalized when presenting money as paid. Missing (possibly closed) receipts are not a win/loss. */
export async function readCoinflip(deployment: CoinflipDeployment, playerAddress: string, id: bigint, rpc: Rpc = createRpc(deployment), commitment: Commitment = 'finalized'): Promise<CoinflipResult | null> {
  validateDeployment(deployment);
  if (await rpc.getGenesisHash() !== DEVNET_GENESIS) throw new Error('GENESIS_MISMATCH');
  const a = addresses(key(deployment.houseAuthority), key(playerAddress), deployment.shardId, id);
  const account = await rpc.getAccountInfo(a.bet, commitment);
  if (!account) return null;
  const bet = decodeAccount<Bet>('games', 'CoinflipBet', account);
  equal(bet.house, a.house); equal(bet.config, a.config); equal(bet.shard, a.shard); equal(bet.player, a.player);
  canonical(a.bet, bet.bump, pda(GAMES_PROGRAM, 'coinflip', a.house.toBytes(), a.player.toBytes(), u64(id)));
  if (bet.id !== id || bet.side > 1 || bet.status > 2 || !Buffer.from(bet.request_tag).equals(a.bet.toBuffer())) throw new Error('INVALID_BET_ACCOUNT');
  if (bet.stake <= 0n || bet.max_gross < bet.stake) throw new Error('INVALID_BET_ACCOUNT');
  const resolvedPayout = (bet.randomness[0]! & 1) === bet.side ? bet.max_gross : 0n;
  if (bet.status === 2 ? bet.payout !== resolvedPayout : bet.payout !== 0n) throw new Error('INVALID_PAYOUT');
  return { betAddress: a.bet.toBase58(), player: playerAddress, id, stake: bet.stake, payout: bet.payout, side: bet.side as 0 | 1, winningSide: bet.status === 0 ? null : (bet.randomness[0]! & 1) as 0 | 1, status: (['awaiting-randomness', 'ready-to-settle', 'settled'] as const)[bet.status]! };
}

/** Permissionless keeper instruction. No server chooses payout, receiver, or randomness. */
export function settleCoinflipInstruction(authority: string, player: string, shardId: number, id: bigint) {
  return instruction('games', 'settle_coinflip', addresses(key(authority), key(player), shardId, id));
}
export function closeCoinflipInstruction(authority: string, player: string, shardId: number, id: bigint) {
  return instruction('games', 'close_coinflip', addresses(key(authority), key(player), shardId, id));
}
export { decodeAccount, instruction } from './codec';
export type { Rpc, AccountInfo };

export { INCENTIVES_PROGRAM, incentiveAddresses, readStakingState, readRewardState, prepareIncentive, sendIncentive, trackIncentive, IncentiveSubmissionUnknownError } from './incentives';
export type { IncentivesDeployment, IncentiveAction, IncentiveTicket, IncentiveArgs } from './incentives';
