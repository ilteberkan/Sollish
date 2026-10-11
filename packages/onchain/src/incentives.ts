import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction, Message, VersionedTransaction, ComputeBudgetProgram, type Commitment } from '@solana/web3.js';
import { createRpc, validateDeployment, DEVNET_GENESIS, HOUSE_PROGRAM, GAMES_PROGRAM, CHAIN, type CoinflipDeployment, type Rpc, type TransactionWallet } from './index';
import { canonical, equal, id, key, pda, required, snapshotSlot } from './common';
import { decodeAccount, instruction, u64 } from './codec';
import { schema } from './schema';
import { associatedToken, createAssociatedToken, readMint, readToken } from './token';
export const INCENTIVES_PROGRAM = new PublicKey(schema.incentives.address);
const SYSVAR_OWNER = new PublicKey('Sysvar1111111111111111111111111111111111111');
const SCALE = 1000000000000000000n;
export interface IncentivesDeployment extends CoinflipDeployment {
    tokenMint: string;
    stakingPoolId?: string;
    rewardPhaseId?: string;
}
type Pool = {
    house: PublicKey;
    mint: PublicKey;
    token_program: PublicKey;
    id: bigint;
    start_ts: bigint;
    end_ts: bigint;
    budget: bigint;
    emitted: bigint;
    allocated: bigint;
    claimed: bigint;
    total_staked: bigint;
    reward_per_share: bigint;
    emission_fraction: bigint;
    bump: number;
};
type Position = {
    pool: PublicKey;
    player: PublicKey;
    amount: bigint;
    pending: bigint;
    checkpoint: bigint;
    fraction: bigint;
    bump: number;
};
type Phase = {
    house: PublicKey;
    game_program: PublicKey;
    mint: PublicKey;
    token_program: PublicKey;
    id: bigint;
    start_epoch: bigint;
    end_epoch: bigint;
    wager_budget: bigint;
    rate_units_per_sol: bigint;
    hourly_budget: bigint;
    minimum_wager_lamports: bigint;
    total_budget: bigint;
    wager_allocated: bigint;
    wager_claimed: bigint;
    hourly_claimed: bigint;
    credits_closed: boolean;
    bump: number;
};
type RewardPlayer = {
    phase: PublicKey;
    player: PublicKey;
    pending: bigint;
    total_credited: bigint;
    total_claimed: bigint;
    bump: number;
};
type Epoch = {
    phase: PublicKey;
    epoch: bigint;
    total_wagered_lamports: bigint;
    qualified_wallets: bigint;
    qualified_wagered_lamports: bigint;
    claimed_wallets: bigint;
    sealed: boolean;
    bump: number;
};
type Participant = {
    phase: PublicKey;
    player: PublicKey;
    epoch: bigint;
    wagered_lamports: bigint;
    qualified: boolean;
    bump: number;
};
export function incentiveAddresses(deployment: IncentivesDeployment, player: PublicKey, tokenProgram: PublicKey, kind: 'staking' | 'phase', configuredId: bigint, epoch = 0n) {
    const mint = key(deployment.tokenMint), authority = key(deployment.houseAuthority);
    const house = pda(HOUSE_PROGRAM, 'house', authority.toBytes())[0];
    const root = pda(INCENTIVES_PROGRAM, kind, house.toBytes(), mint.toBytes(), u64(configuredId))[0];
    return { player, house, mint, pool: root, phase: root, token_program: tokenProgram,
        position: pda(INCENTIVES_PROGRAM, 'stake', root.toBytes(), player.toBytes())[0],
        principal_vault: pda(INCENTIVES_PROGRAM, 'principal', root.toBytes())[0],
        reward_vault: pda(INCENTIVES_PROGRAM, kind === 'staking' ? 'staking_rewards' : 'phase_vault', root.toBytes())[0],
        player_tokens: associatedToken(player, mint, tokenProgram),
        player_rewards: pda(INCENTIVES_PROGRAM, 'reward_user', root.toBytes(), player.toBytes())[0],
        epoch_state: pda(INCENTIVES_PROGRAM, 'hour', root.toBytes(), u64(epoch))[0],
        participant: pda(INCENTIVES_PROGRAM, 'hour_user', root.toBytes(), u64(epoch), player.toBytes())[0],
        incentives_authority: pda(GAMES_PROGRAM, 'incentives_authority', house.toBytes())[0],
        incentives_program: INCENTIVES_PROGRAM, system_program: SystemProgram.programId };
}
function clock(account: Awaited<ReturnType<Rpc['getAccountInfo']>>) {
    const value = required(account);
    equal(value.owner, SYSVAR_OWNER);
    if (value.executable || value.data.length !== 40)
        throw new Error('INVALID_CLOCK');
    return Buffer.from(value.data).readBigInt64LE(32);
}
async function preflight(deployment: IncentivesDeployment, rpc: Rpc, commitment: Commitment) {
    validateDeployment(deployment);
    const mint = key(deployment.tokenMint);
    if (await rpc.getGenesisHash() !== DEVNET_GENESIS)
        throw new Error('GENESIS_MISMATCH');
    const first = await rpc.getMultipleAccountsInfoAndContext([mint, SYSVAR_CLOCK_PUBKEY], commitment);
    return { ...readMint(required(first.value[0])), chainTimestamp: clock(first.value[1]), slot: snapshotSlot(first.context.slot, 0) };
}
function checkBase(deployment: IncentivesDeployment, a: ReturnType<typeof incentiveAddresses>, values: Awaited<ReturnType<Rpc['getMultipleAccountsInfoAndContext']>>['value']) {
    if (!required(values[0]).executable || !required(values[1]).executable || !required(values[2]).executable)
        throw new Error('PROGRAM_NOT_EXECUTABLE');
    const house = decodeAccount<{
        authority: PublicKey;
        game_program: PublicKey;
        bump: number;
    }>('house', 'HouseConfig', required(values[3]));
    const authority = key(deployment.houseAuthority);
    equal(house.authority, authority);
    equal(house.game_program, GAMES_PROGRAM);
    canonical(a.house, house.bump, pda(HOUSE_PROGRAM, 'house', authority.toBytes()));
    const mint = readMint(required(values[4]));
    equal(mint.tokenProgram, a.token_program);
    // Pause gates games admissions, never principal withdrawals or earned claims.
    return clock(values[5]);
}
const baseKeys = (a: ReturnType<typeof incentiveAddresses>) => [INCENTIVES_PROGRAM, HOUSE_PROGRAM, a.token_program, a.house, a.mint, SYSVAR_CLOCK_PUBKEY];
function checkU128(value: bigint) { if (value < 0n || value >= 1n << 128n)
    throw new Error('INVALID_REWARD_ACCOUNT'); return value; }
function pendingStake(pool: Pool, position: Position | null, now: bigint) {
    const clamped = now < pool.start_ts ? pool.start_ts : now > pool.end_ts ? pool.end_ts : now;
    const target = pool.budget * (clamped - pool.start_ts) / (pool.end_ts - pool.start_ts);
    const newlyEmitted = target > pool.emitted ? target - pool.emitted : 0n;
    const rps = pool.reward_per_share + (pool.total_staked > 0n ? checkU128(newlyEmitted * SCALE + pool.emission_fraction) / pool.total_staked : 0n);
    checkU128(rps);
    if (!position)
        return 0n;
    const numerator = checkU128(position.amount * (rps - position.checkpoint) + position.fraction);
    const pending = position.pending + numerator / SCALE;
    u64(pending);
    return pending;
}
async function stakingSnapshot(deployment: IncentivesDeployment, playerAddress: string, rpc: Rpc, commitment: Commitment) {
    const configuredId = id(deployment.stakingPoolId), player = key(playerAddress);
    const initial = await preflight(deployment, rpc, commitment);
    const a = incentiveAddresses(deployment, player, initial.tokenProgram, 'staking', configuredId);
    const response = await rpc.getMultipleAccountsInfoAndContext([...baseKeys(a), a.pool, a.position, a.principal_vault, a.reward_vault, a.player_tokens], { commitment, minContextSlot: initial.slot });
    snapshotSlot(response.context.slot, initial.slot);
    const v = response.value, now = checkBase(deployment, a, v);
    const pool = decodeAccount<Pool>('incentives', 'StakingPool', required(v[6]));
    equal(pool.house, a.house);
    equal(pool.mint, a.mint);
    equal(pool.token_program, a.token_program);
    canonical(a.pool, pool.bump, pda(INCENTIVES_PROGRAM, 'staking', a.house.toBytes(), a.mint.toBytes(), u64(configuredId)));
    if (pool.id !== configuredId || pool.start_ts < 0n || pool.end_ts <= pool.start_ts || pool.budget === 0n || pool.claimed > pool.allocated || pool.allocated > pool.emitted || pool.emitted > pool.budget)
        throw new Error('INVALID_POOL');
    const position = v[7] ? decodeAccount<Position>('incentives', 'StakePosition', v[7]) : null;
    if (position) {
        equal(position.pool, a.pool);
        equal(position.player, player);
        canonical(a.position, position.bump, pda(INCENTIVES_PROGRAM, 'stake', a.pool.toBytes(), player.toBytes()));
        if (position.amount > pool.total_staked || position.checkpoint > pool.reward_per_share || position.fraction >= SCALE)
            throw new Error('INVALID_POSITION');
    }
    const principal = readToken(required(v[8]), a.mint, a.pool, a.token_program);
    const reserve = readToken(required(v[9]), a.mint, a.pool, a.token_program);
    if (principal < pool.total_staked || reserve < pool.budget - pool.claimed)
        throw new Error('INSUFFICIENT_TOKEN_RESERVE');
    const walletBalance = v[10] ? readToken(v[10], a.mint, player, a.token_program) : 0n;
    const state = { tokenMint: a.mint.toBase58(), tokenProgram: a.token_program.toBase58(), tokenDecimals: 6 as const,
        poolAddress: a.pool.toBase58(), positionAddress: a.position.toBase58(), staked: position?.amount ?? 0n,
        pendingRewards: pendingStake(pool, position, now), walletBalance, totalStaked: pool.total_staked,
        budget: pool.budget, rewardReserve: reserve, principalReserve: principal, startTs: pool.start_ts, endTs: pool.end_ts,
        chainTimestamp: now, slot: response.context.slot, positionExists: position !== null };
    return { state, a, position, walletAccountExists: !!v[10] };
}
export async function readStakingState(deployment: IncentivesDeployment, player: string, rpc: Rpc = createRpc(deployment), commitment: Commitment = 'finalized') {
    return (await stakingSnapshot(deployment, player, rpc, commitment)).state;
}
async function rewardsSnapshot(deployment: IncentivesDeployment, playerAddress: string, selectedEpoch: bigint | undefined, rpc: Rpc, commitment: Commitment) {
    const configuredId = id(deployment.rewardPhaseId), player = key(playerAddress);
    const initial = await preflight(deployment, rpc, commitment);
    if (initial.chainTimestamp < 0n)
        throw new Error('INVALID_REWARD_CLOCK');
    const observedEpoch = initial.chainTimestamp / 3600n;
    const epoch = selectedEpoch ?? (observedEpoch > 0n ? observedEpoch - 1n : 0n);
    u64(epoch);
    const a = incentiveAddresses(deployment, player, initial.tokenProgram, 'phase', configuredId, epoch);
    const response = await rpc.getMultipleAccountsInfoAndContext([...baseKeys(a), a.phase, a.player_rewards, a.epoch_state, a.participant, a.reward_vault, a.player_tokens], { commitment, minContextSlot: initial.slot });
    snapshotSlot(response.context.slot, initial.slot);
    const v = response.value, now = checkBase(deployment, a, v);
    if (now < 0n || (selectedEpoch === undefined && now / 3600n !== observedEpoch))
        throw new Error('SNAPSHOT_EPOCH_CHANGED');
    const phase = decodeAccount<Phase>('incentives', 'RewardPhase', required(v[6]));
    equal(phase.house, a.house);
    equal(phase.game_program, GAMES_PROGRAM);
    equal(phase.mint, a.mint);
    equal(phase.token_program, a.token_program);
    canonical(a.phase, phase.bump, pda(INCENTIVES_PROGRAM, 'phase', a.house.toBytes(), a.mint.toBytes(), u64(configuredId)));
    if (phase.id !== configuredId || phase.end_epoch <= phase.start_epoch || phase.end_epoch - phase.start_epoch > 2160n || phase.minimum_wager_lamports === 0n || phase.total_budget === 0n || phase.end_epoch > ((1n << 63n) - 1n) / 3600n || phase.wager_claimed > phase.wager_allocated || phase.wager_allocated > phase.wager_budget || phase.total_budget !== phase.wager_budget + (phase.end_epoch - phase.start_epoch) * phase.hourly_budget || phase.hourly_claimed > phase.total_budget - phase.wager_budget)
        throw new Error('INVALID_PHASE');
    const rewards = v[7] ? decodeAccount<RewardPlayer>('incentives', 'RewardPlayer', v[7]) : null;
    if (rewards) {
        equal(rewards.phase, a.phase);
        equal(rewards.player, player);
        canonical(a.player_rewards, rewards.bump, pda(INCENTIVES_PROGRAM, 'reward_user', a.phase.toBytes(), player.toBytes()));
        if (rewards.total_credited !== rewards.pending + rewards.total_claimed || rewards.total_credited > phase.wager_allocated || rewards.total_claimed > phase.wager_claimed)
            throw new Error('INVALID_REWARD_ACCOUNT');
    }
    const hour = v[8] ? decodeAccount<Epoch>('incentives', 'HourlyEpoch', v[8]) : null;
    if (hour) {
        equal(hour.phase, a.phase);
        canonical(a.epoch_state, hour.bump, pda(INCENTIVES_PROGRAM, 'hour', a.phase.toBytes(), u64(epoch)));
        if (hour.epoch !== epoch || epoch < phase.start_epoch || epoch >= phase.end_epoch || hour.claimed_wallets > hour.qualified_wallets || hour.qualified_wagered_lamports > hour.total_wagered_lamports || (hour.qualified_wallets === 0n) !== (hour.qualified_wagered_lamports === 0n))
            throw new Error('INVALID_EPOCH');
    }
    const participant = v[9] ? decodeAccount<Participant>('incentives', 'HourlyParticipant', v[9]) : null;
    if (participant) {
        equal(participant.phase, a.phase);
        equal(participant.player, player);
        canonical(a.participant, participant.bump, pda(INCENTIVES_PROGRAM, 'hour_user', a.phase.toBytes(), u64(epoch), player.toBytes()));
        if (!hour || participant.epoch !== epoch || participant.qualified !== (participant.wagered_lamports >= phase.minimum_wager_lamports) || participant.wagered_lamports > hour.total_wagered_lamports || (participant.qualified && participant.wagered_lamports > hour.qualified_wagered_lamports))
            throw new Error('INVALID_PARTICIPANT');
    }
    const reserve = readToken(required(v[10]), a.mint, a.phase, a.token_program);
    if (reserve < phase.total_budget - phase.wager_claimed - phase.hourly_claimed)
        throw new Error('INSUFFICIENT_TOKEN_RESERVE');
    const walletBalance = v[11] ? readToken(v[11], a.mint, player, a.token_program) : 0n;
    const finished = !!hour && (hour.sealed || now / 3600n > epoch);
    const claimable = finished && participant?.qualified ? phase.hourly_budget * participant.wagered_lamports / required(hour).qualified_wagered_lamports : 0n;
    const state = { tokenMint: a.mint.toBase58(), tokenProgram: a.token_program.toBase58(), tokenDecimals: 6 as const,
        phaseAddress: a.phase.toBase58(), wagerPending: rewards?.pending ?? 0n, hourlyClaimable: claimable,
        qualified: participant?.qualified ?? false, epoch, currentEpoch: now / 3600n, chainTimestamp: now, slot: response.context.slot,
        hourlyBudget: phase.hourly_budget, minimumWager: phase.minimum_wager_lamports,
        phaseRemaining: phase.wager_budget - phase.wager_allocated, rateUnitsPerSol: phase.rate_units_per_sol,
        startEpoch: phase.start_epoch, endEpoch: phase.end_epoch, creditsClosed: phase.credits_closed,
        sealed: hour?.sealed ?? false, epochFinished: finished, recordExists: participant !== null,
        playerWager: participant?.wagered_lamports ?? 0n, qualifiedWagerTotal: hour?.qualified_wagered_lamports ?? 0n,
        qualifiedWallets: hour?.qualified_wallets ?? 0n, walletBalance, rewardReserve: reserve };
    return { state, a, walletAccountExists: !!v[11] };
}
/** Default is the last COMPLETED UTC hour; a missing receipt is not evidence of payment. */
export async function readRewardState(deployment: IncentivesDeployment, player: string, epoch?: bigint, rpc: Rpc = createRpc(deployment), commitment: Commitment = 'finalized') {
    return (await rewardsSnapshot(deployment, player, epoch, rpc, commitment)).state;
}
export type IncentiveAction = 'stake' | 'unstake' | 'claim-staking' | 'claim-wager' | 'claim-hourly';
export interface IncentiveTicket {
    version: 1;
    action: IncentiveAction;
    player: string;
    mint: string;
    rootAddress: string;
    configuredId: string;
    amount: string;
    epoch: string | null;
    blockhash: string;
    lastValidBlockHeight: number;
    messageBase64: string;
}
export interface IncentiveArgs {
    deployment: IncentivesDeployment;
    player: string;
    action: IncentiveAction;
    amount?: bigint;
    epoch?: bigint;
}
export async function prepareIncentive(args: IncentiveArgs, rpc: Rpc = createRpc(args.deployment)) {
    const { deployment, action } = args;
    if (!['stake', 'unstake', 'claim-staking', 'claim-wager', 'claim-hourly'].includes(action))
        throw new Error('INVALID_INCENTIVE_ACTION');
    if (action === 'stake' || action === 'unstake') {
        u64(required(args.amount));
        if (args.amount === 0n)
            throw new Error('ZERO_AMOUNT');
    }
    else if (args.amount !== undefined)
        throw new Error('UNEXPECTED_AMOUNT');
    if (args.epoch !== undefined && action !== 'claim-hourly')
        throw new Error('UNEXPECTED_EPOCH');
    const staking = action === 'stake' || action === 'unstake' || action === 'claim-staking';
    const instructions = [];
    let a: ReturnType<typeof incentiveAddresses>, slot: number, amount: bigint, epoch: bigint | null = null;
    if (staking) {
        const snap = await stakingSnapshot(deployment, args.player, rpc, 'confirmed');
        a = snap.a;
        slot = snap.state.slot;
        amount = action === 'claim-staking' ? snap.state.pendingRewards : required(args.amount);
        if (action === 'stake') {
            if (snap.state.chainTimestamp >= snap.state.endTs)
                throw new Error('POOL_ENDED');
            if (amount > snap.state.walletBalance)
                throw new Error('INSUFFICIENT_TOKEN_BALANCE');
            if (!snap.position)
                instructions.push(instruction('incentives', 'initialize_staker', a));
        }
        else if (!snap.position)
            throw new Error('POSITION_MISSING');
        if (action === 'unstake' && amount > snap.state.staked)
            throw new Error('INSUFFICIENT_STAKE');
        if (action === 'claim-staking' && amount === 0n)
            throw new Error('NOTHING_TO_CLAIM');
        if (!snap.walletAccountExists)
            instructions.push(createAssociatedToken(a.player, a.mint, a.token_program));
        instructions.push(instruction('incentives', action === 'claim-staking' ? 'claim_staking' : action, a, action === 'claim-staking' ? {} : { amount }));
    }
    else {
        const snap = await rewardsSnapshot(deployment, args.player, args.epoch, rpc, 'confirmed');
        a = snap.a;
        slot = snap.state.slot;
        amount = action === 'claim-wager' ? snap.state.wagerPending : snap.state.hourlyClaimable;
        if (action === 'claim-hourly') {
            epoch = snap.state.epoch;
            if (!snap.state.recordExists || !snap.state.qualified || !snap.state.epochFinished)
                throw new Error('HOURLY_NOT_CLAIMABLE');
            // A valid zero share may still close its receipt and recover rent.
        }
        else if (amount === 0n)
            throw new Error('NOTHING_TO_CLAIM');
        if (!snap.walletAccountExists)
            instructions.push(createAssociatedToken(a.player, a.mint, a.token_program));
        const composite = { ...a, ...Object.fromEntries(Object.entries(a).map(([name, value]) => [`transfer.${name}`, value])) };
        instructions.push(instruction('incentives', action === 'claim-wager' ? 'claim_wager_rewards' : 'claim_hourly', composite));
    }
    const block = await rpc.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: slot });
    const transaction = new Transaction({ feePayer: a.player, ...block });
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), ...instructions);
    const wire = new VersionedTransaction(transaction.compileMessage());
    const serialized = wire.serialize();
    if (serialized.length > 1232)
        throw new Error('TRANSACTION_PACKET_TOO_LARGE');
    const simulation = await rpc.simulateTransaction(wire, { sigVerify: false, commitment: 'confirmed', minContextSlot: slot });
    snapshotSlot(simulation.context.slot, slot);
    if (!simulation.value || simulation.value.err !== null)
        throw new Error('TRANSACTION_SIMULATION_FAILED');
    const ticket: IncentiveTicket = { version: 1, action, player: args.player, mint: deployment.tokenMint, rootAddress: a.pool.toBase58(),
        configuredId: staking ? required(deployment.stakingPoolId) : required(deployment.rewardPhaseId), amount: amount.toString(), epoch: epoch?.toString() ?? null,
        blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight, messageBase64: Buffer.from(wire.message.serialize()).toString('base64') };
    return { transaction: serialized, ticket, quote: { action, amount, tokenDecimals: 6 as const, tokenMint: deployment.tokenMint, epoch, slot } };
}
export class IncentiveSubmissionUnknownError extends Error {
    constructor(readonly ticket: IncentiveTicket, readonly signature: string | null) { super('INCENTIVE_SUBMISSION_UNKNOWN_DO_NOT_RESUBMIT'); this.name = 'IncentiveSubmissionUnknownError'; }
}
/** Read-only reconciliation. A missing signature/history never proves a transfer did not occur. */
async function validateTicket(deployment: IncentivesDeployment, ticket: IncentiveTicket, rpc: Rpc) {
    const staking = ['stake', 'unstake', 'claim-staking'].includes(ticket.action);
    if (!['stake', 'unstake', 'claim-staking', 'claim-wager', 'claim-hourly'].includes(ticket.action) || ticket.version !== 1 || ticket.mint !== deployment.tokenMint || ticket.configuredId !== (staking ? deployment.stakingPoolId : deployment.rewardPhaseId))
        throw new Error('INVALID_TRACKING_TICKET');
    const amount = id(ticket.amount), configuredId = id(ticket.configuredId), player = key(ticket.player);
    if ((ticket.action === 'stake' || ticket.action === 'unstake') && amount === 0n)
        throw new Error('INVALID_TRACKING_TICKET');
    const epoch = ticket.action === 'claim-hourly' ? id(required(ticket.epoch)) : 0n;
    if (ticket.action !== 'claim-hourly' && ticket.epoch !== null)
        throw new Error('INVALID_TRACKING_TICKET');
    if (!Number.isSafeInteger(ticket.lastValidBlockHeight) || ticket.lastValidBlockHeight < 0)
        throw new Error('INVALID_TRACKING_TICKET');
    const mint = readMint(required(await rpc.getAccountInfo(key(deployment.tokenMint), 'finalized')));
    const a = incentiveAddresses(deployment, player, mint.tokenProgram, staking ? 'staking' : 'phase', configuredId, epoch);
    if (ticket.rootAddress !== a.pool.toBase58())
        throw new Error('INVALID_TRACKING_TICKET');
    const bytes = Buffer.from(ticket.messageBase64, 'base64');
    if (bytes.toString('base64') !== ticket.messageBase64)
        throw new Error('INVALID_TRACKING_TICKET');
    const message = Message.from(bytes);
    if (!message.serialize().equals(bytes) || message.recentBlockhash !== ticket.blockhash || message.header.numRequiredSignatures !== 1 || !message.accountKeys[0]?.equals(player))
        throw new Error('INVALID_TRACKING_TICKET');
    const candidate = Transaction.populate(message).instructions;
    const expected = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 })];
    let next = 1;
    const initialize = instruction('incentives', 'initialize_staker', a);
    if (ticket.action === 'stake' && candidate[next]?.programId.equals(INCENTIVES_PROGRAM) && candidate[next]?.data.equals(initialize.data)) {
        expected.push(initialize);
        next++;
    }
    const ata = createAssociatedToken(player, a.mint, a.token_program);
    if (candidate[next]?.programId.equals(ata.programId)) {
        expected.push(ata);
        next++;
    }
    const composite = { ...a, ...Object.fromEntries(Object.entries(a).map(([name, value]) => [`transfer.${name}`, value])) };
    expected.push(instruction('incentives', ({ stake: 'stake', unstake: 'unstake', 'claim-staking': 'claim_staking', 'claim-wager': 'claim_wager_rewards', 'claim-hourly': 'claim_hourly' } as const)[ticket.action], composite, ticket.action === 'stake' || ticket.action === 'unstake' ? { amount } : {}));
    const rebuilt = new Transaction({ feePayer: player, recentBlockhash: ticket.blockhash }).add(...expected).compileMessage().serialize();
    if (!rebuilt.equals(bytes))
        throw new Error('INVALID_TRACKING_TICKET');
    // Claim amounts are simulation-time quotes, not instruction arguments or
    // proofs of the eventual transfer. Finalized balances/events show actual pay.
}
export async function trackIncentive(deployment: IncentivesDeployment, ticket: IncentiveTicket, signature: string | null, rpc: Rpc = createRpc(deployment)): Promise<'unknown' | 'pending' | 'failed' | 'finalized'> {
    validateDeployment(deployment);
    if (await rpc.getGenesisHash() !== DEVNET_GENESIS)
        throw new Error('GENESIS_MISMATCH');
    await validateTicket(deployment, ticket, rpc);
    if (signature === null)
        return 'unknown';
    if (bs58.decode(signature).length !== 64)
        throw new Error('INVALID_SIGNATURE');
    const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (!status)
        return 'unknown';
    if (status.confirmationStatus !== 'finalized')
        return 'pending';
    const landed = await rpc.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!landed)
        return 'unknown';
    if (landed.transaction.signatures?.[0] !== signature || !Buffer.from(landed.transaction.message.serialize()).equals(Buffer.from(ticket.messageBase64, 'base64')))
        throw new Error('FINALIZED_TRANSACTION_MISMATCH');
    const validError = (value: unknown) => value === null || typeof value === 'string' || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1);
    if (!landed.meta || !Object.hasOwn(landed.meta, 'err') || !validError(landed.meta.err) || !Object.hasOwn(status, 'err') || !validError(status.err) || (status.err === null) !== (landed.meta.err === null))
        throw new Error('UNVERIFIED_TRANSACTION_METADATA');
    return landed.meta.err === null ? 'finalized' : 'failed';
}
export async function sendIncentive(args: Omit<IncentiveArgs, 'player'> & {
    wallet: TransactionWallet;
    onPrepared?: (ticket: IncentiveTicket) => void;
}, rpc: Rpc = createRpc(args.deployment)) {
    const player = args.wallet.address;
    const prepared = await prepareIncentive({ ...args, player }, rpc);
    args.onPrepared?.(prepared.ticket);
    if (args.wallet.address !== player)
        throw new Error('WALLET_CHANGED');
    let signature: string;
    try {
        const signed = await args.wallet.signAndSendTransaction(prepared.transaction, CHAIN);
        if (!(signed instanceof Uint8Array) || signed.length !== 64)
            throw new Error('INVALID_WALLET_SIGNATURE');
        signature = bs58.encode(signed);
    }
    catch {
        throw new IncentiveSubmissionUnknownError(prepared.ticket, null);
    }
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        try {
            const status = await trackIncentive(args.deployment, prepared.ticket, signature, rpc);
            if (status === 'finalized')
                return { signature, ticket: prepared.ticket, status };
            if (status === 'failed')
                throw new Error('TRANSACTION_FAILED');
        }
        catch (error) {
            if (error instanceof Error && ['TRANSACTION_FAILED', 'FINALIZED_TRANSACTION_MISMATCH'].includes(error.message))
                throw error;
            throw new IncentiveSubmissionUnknownError(prepared.ticket, signature);
        }
        await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new IncentiveSubmissionUnknownError(prepared.ticket, signature);
}
/** Called only by the explicit rewarded admission path. No fallback silently drops rewards. */
export async function prepareWagerReward(deployment: IncentivesDeployment, player: string, amount: bigint, rpc: Rpc, minimumSlot: number) {
    const initial = await preflight(deployment, rpc, 'confirmed');
    if (initial.slot < minimumSlot || initial.chainTimestamp < 0n)
        throw new Error('STALE_REWARD_SNAPSHOT');
    const epoch = initial.chainTimestamp / 3600n;
    const snap = await rewardsSnapshot(deployment, player, epoch, rpc, 'confirmed');
    if (snap.state.slot < minimumSlot || snap.state.currentEpoch !== epoch)
        throw new Error('STALE_REWARD_SNAPSHOT');
    if (snap.state.creditsClosed || snap.state.sealed || epoch < snap.state.startEpoch || epoch >= snap.state.endEpoch)
        throw new Error('REWARD_PHASE_INACTIVE');
    const reward = amount * snap.state.rateUnitsPerSol / 1000000000n;
    if (reward > snap.state.phaseRemaining)
        throw new Error('WAGER_BUDGET_EXHAUSTED');
    return { accounts: snap.a, epoch, reward, phaseAddress: snap.state.phaseAddress, slot: snap.state.slot };
}
