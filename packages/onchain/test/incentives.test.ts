import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Buffer } from 'buffer';
import { PublicKey, Keypair, SystemProgram, SYSVAR_CLOCK_PUBKEY, Transaction, VersionedTransaction, type AccountInfo } from '@solana/web3.js';
import { schema } from '../src/schema';
import { u64, instruction } from '../src/codec';
import { pda } from '../src/common';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, associatedToken, createAssociatedToken, readMint, readToken } from '../src/token';
import { INCENTIVES_PROGRAM, HOUSE_PROGRAM, GAMES_PROGRAM, VRF_PROGRAM, VRF_QUEUE, DEVNET_GENESIS, addresses, incentiveAddresses, readStakingState, readRewardState, prepareIncentive, sendIncentive, trackIncentive, prepareCoinflip, IncentiveSubmissionUnknownError, type IncentivesDeployment, type Rpc } from '../src/index';
const player = Keypair.generate().publicKey, authority = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
const deployment: IncentivesDeployment = { enabled: true, network: 'devnet', rpcUrl: 'https://rpc.example.test', houseAuthority: authority.toBase58(), shardId: 0, tokenMint: mint.toBase58(), stakingPoolId: '4', rewardPhaseId: '5' };
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };
const u128 = (v: bigint) => Buffer.concat([u64(v & ((1n << 64n) - 1n)), u64(v >> 64n)]);
const account = (owner: PublicKey, data: Buffer): AccountInfo<Buffer> => ({ owner, data, executable: false, lamports: 10000000000, rentEpoch: 0 });
const executable = { ...account(SystemProgram.programId, Buffer.alloc(0)), executable: true };
const disc = (name: keyof typeof schema.incentives.accounts) => Buffer.from(schema.incentives.accounts[name].discriminator);
function token(owner: PublicKey, balance: bigint, program = TOKEN_PROGRAM) { const b = Buffer.alloc(165); mint.toBuffer().copy(b); owner.toBuffer().copy(b, 32); b.writeBigUInt64LE(balance, 64); b[108] = 1; return account(program, b); }
function fixture(tokenProgram = TOKEN_PROGRAM) {
    const a = incentiveAddresses(deployment, player, tokenProgram, 'staking', 4n);
    const r = incentiveAddresses(deployment, player, tokenProgram, 'phase', 5n, 1n);
    const g = addresses(authority, player, 0, 1n);
    const map = new Map<string, AccountInfo<Buffer>>();
    const put = (k: PublicKey, v: AccountInfo<Buffer>) => map.set(k.toBase58(), v);
    for (const p of [INCENTIVES_PROGRAM, HOUSE_PROGRAM, GAMES_PROGRAM, VRF_PROGRAM, tokenProgram])
        put(p, executable);
    const mintData = Buffer.alloc(82);
    mintData.writeBigUInt64LE(1000000000000000n, 36);
    mintData[44] = 6;
    mintData[45] = 1;
    put(mint, account(tokenProgram, mintData));
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(7200n, 32);
    put(SYSVAR_CLOCK_PUBKEY, account(new PublicKey('Sysvar1111111111111111111111111111111111111'), clock));
    // Fixed Rust serialization order, independent of the decoder/schema fields.
    put(a.house, account(HOUSE_PROGRAM, Buffer.concat([Buffer.from(schema.house.accounts.HouseConfig.discriminator), authority.toBuffer(), GAMES_PROGRAM.toBuffer(), Buffer.from([1, pda(HOUSE_PROGRAM, 'house', authority.toBytes())[1]])])));
    put(a.pool, account(INCENTIVES_PROGRAM, Buffer.concat([disc('StakingPool'), a.house.toBuffer(), mint.toBuffer(), tokenProgram.toBuffer(), u64(4n), i64(3600n), i64(10800n), u64(1000n), u64(100n), u64(100n), u64(0n), u64(100n), u128(1000000000000000000n), u128(0n), Buffer.from([pda(INCENTIVES_PROGRAM, 'staking', a.house.toBytes(), mint.toBytes(), u64(4n))[1]])])));
    put(a.position, account(INCENTIVES_PROGRAM, Buffer.concat([disc('StakePosition'), a.pool.toBuffer(), player.toBuffer(), u64(25n), u64(2n), u128(0n), u128(0n), Buffer.from([pda(INCENTIVES_PROGRAM, 'stake', a.pool.toBytes(), player.toBytes())[1]])])));
    put(a.principal_vault, token(a.pool, 100n, tokenProgram));
    put(a.reward_vault, token(a.pool, 1000n, tokenProgram));
    put(a.player_tokens, token(player, 500n, tokenProgram));
    put(r.phase, account(INCENTIVES_PROGRAM, Buffer.concat([disc('RewardPhase'), r.house.toBuffer(), GAMES_PROGRAM.toBuffer(), mint.toBuffer(), tokenProgram.toBuffer(), ...[5n, 1n, 3n, 10000n, 100000000n, 1001n, 20000000n, 12002n, 300n, 0n, 0n].map(u64), Buffer.from([0, pda(INCENTIVES_PROGRAM, 'phase', r.house.toBytes(), mint.toBytes(), u64(5n))[1]])])));
    put(r.player_rewards, account(INCENTIVES_PROGRAM, Buffer.concat([disc('RewardPlayer'), r.phase.toBuffer(), player.toBuffer(), u64(300n), u64(300n), u64(0n), Buffer.from([pda(INCENTIVES_PROGRAM, 'reward_user', r.phase.toBytes(), player.toBytes())[1]])])));
    put(r.epoch_state, account(INCENTIVES_PROGRAM, Buffer.concat([disc('HourlyEpoch'), r.phase.toBuffer(), u64(1n), u128(60000000n), u64(2n), u64(50000000n), u64(0n), Buffer.from([0, pda(INCENTIVES_PROGRAM, 'hour', r.phase.toBytes(), u64(1n))[1]])])));
    put(r.participant, account(INCENTIVES_PROGRAM, Buffer.concat([disc('HourlyParticipant'), r.phase.toBuffer(), player.toBuffer(), u64(1n), u128(30000000n), Buffer.from([1, pda(INCENTIVES_PROGRAM, 'hour_user', r.phase.toBytes(), u64(1n), player.toBytes())[1]])])));
    put(r.reward_vault, token(r.phase, 12002n, tokenProgram));
    put(g.config, account(GAMES_PROGRAM, Buffer.concat([Buffer.from(schema.games.accounts.CoinflipConfig.discriminator), g.house.toBuffer(), VRF_QUEUE.toBuffer(), Buffer.from([200, 0, pda(GAMES_PROGRAM, 'coinflip_config', g.house.toBytes())[1]])])));
    const shard = Buffer.concat([Buffer.from(schema.house.accounts.HouseShard.discriminator), g.house.toBuffer(), Buffer.from([0, 0]), u64(0n), u64(100000000n), u64(1000000000n), u64(0n), u64(0n), u64(0n), Buffer.from([pda(HOUSE_PROGRAM, 'shard', g.house.toBytes(), Buffer.alloc(2))[1]])]);
    put(g.shard, account(HOUSE_PROGRAM, shard));
    put(VRF_QUEUE, account(VRF_PROGRAM, Buffer.alloc(8)));
    let simulated: VersionedTransaction | null = null;
    let genesis = DEVNET_GENESIS;
    const calls = { simulations: 0, wallet: 0 };
    const rpc = { getGenesisHash: async () => genesis, getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: 123 }, value: keys.map(k => map.get(k.toBase58()) ?? null) }), getAccountInfo: async (k: PublicKey) => map.get(k.toBase58()) ?? null,
        getMinimumBalanceForRentExemption: async () => 1000, getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 }),
        simulateTransaction: async (tx: VersionedTransaction) => { simulated = tx; calls.simulations++; return { context: { slot: 123 }, value: { err: null } }; },
        getSignatureStatuses: async () => ({ context: { slot: 125 }, value: [{ err: null, confirmationStatus: 'finalized', slot: 125, confirmations: null }] }), getTransaction: async (signature: string) => ({ meta: { err: null }, transaction: { signatures: [signature], message: simulated!.message } }) } as unknown as Rpc;
    const wallet = { address: player.toBase58(), signAndSendTransaction: async () => { calls.wallet++; return new Uint8Array(64).fill(7); } };
    return { a, r, g, map, put, rpc, wallet, calls, setGenesis: (v: string) => { genesis = v; }, setClock: (v: bigint) => { clock.writeBigInt64LE(v, 32); }, unpause: () => { map.get(a.house.toBase58())!.data[72] = 0; } };
}
test('checked-in client schema preserves nested admission/claim ABI order and signer boundaries', () => {
    // Pure source checkout test. Actual built IDL comparison is idl:check in
    // the contracts CI job, after SBF/IDL generation; no target files here.
    const game = ['player', 'house', 'config', 'shard', 'house_bet', 'player_ledger', 'bet', 'game_program', 'house_authority', 'program_identity', 'oracle_queue', 'vrf_program', 'slot_hashes', 'house_program', 'system_program', 'activity'].map(name => `game.${name}`);
    const rewarded = schema.games.instructions.place_coinflip_rewarded;
    assert.deepEqual(rewarded.accounts.map(a => a.name), [...game, 'reward_phase', 'incentives_authority', 'player_rewards', 'epoch_state', 'participant', 'incentives_program']);
    assert.deepEqual(rewarded.accounts.flatMap((a, i) => a.signer ? [i] : []), [0]);
    assert.deepEqual(rewarded.accounts.flatMap((a, i) => a.writable ? [i] : []), [0, 3, 4, 5, 6, 10, 16, 18, 19, 20]);
    const transfer = ['transfer.player', 'transfer.phase', 'transfer.mint', 'transfer.reward_vault', 'transfer.player_tokens', 'transfer.token_program'];
    for (const [name, extra] of [['claim_hourly', ['epoch_state', 'participant']], ['claim_wager_rewards', ['player_rewards']]] as const) {
        const ix = schema.incentives.instructions[name];
        assert.deepEqual(ix.accounts.map(a => a.name), [...transfer, ...extra]);
        assert.deepEqual(ix.accounts.flatMap((a, i) => a.signer ? [i] : []), [0]);
        assert.deepEqual(ix.accounts.map(a => a.writable), [true, true, false, true, true, false, ...extra.map(() => true)]);
    }
    for (const [name, ix] of [['place_coinflip_rewarded', rewarded], ...Object.entries(schema.incentives.instructions)] as const) {
        assert.deepEqual(Buffer.from(ix.discriminator), createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));
    }
});
test('staking raw Rust layouts decode and projected rewards use exact integer accumulator while house paused', async () => {
    const e = fixture();
    const s = await readStakingState(deployment, player.toBase58(), e.rpc);
    assert.equal(s.staked, 25n);
    assert.equal(s.pendingRewards, 127n);
    assert.equal(s.walletBalance, 500n);
    assert.equal(s.totalStaked, 100n);
    assert.equal(s.tokenDecimals, 6);
    e.setClock(0n);
    assert.equal((await readStakingState(deployment, player.toBase58(), e.rpc)).pendingRewards, 27n);
});
test('hourly quote is qualified-volume pro-rata, uses completed UTC epoch, and is claimable before first seal', async () => {
    const e = fixture();
    const s = await readRewardState(deployment, player.toBase58(), undefined, e.rpc);
    assert.equal(s.epoch, 1n);
    assert.equal(s.currentEpoch, 2n);
    assert.equal(s.sealed, false);
    assert.equal(s.hourlyClaimable, 600n);
    assert.equal(s.qualifiedWagerTotal, 50000000n);
    assert.equal(s.playerWager, 30000000n);
    assert.equal(s.wagerPending, 300n);
    const p = await prepareIncentive({ deployment, player: player.toBase58(), action: 'claim-hourly' }, e.rpc);
    assert.equal(p.quote.amount, 600n);
    assert.equal(p.ticket.epoch, '1');
});
test('stake/unstake/claim builders bind wallet ATA and nested reward transfer accounts', async () => {
    for (const action of ['stake', 'unstake', 'claim-staking', 'claim-wager', 'claim-hourly'] as const) {
        const e = fixture();
        const p = await prepareIncentive({ deployment, player: player.toBase58(), action, ...(action === 'stake' || action === 'unstake' ? { amount: 10n } : {}) }, e.rpc);
        const tx = Transaction.populate(VersionedTransaction.deserialize(p.transaction).message as any);
        const last = tx.instructions.at(-1)!;
        assert(last.programId.equals(INCENTIVES_PROGRAM));
        assert(last.keys[0]!.pubkey.equals(player));
        assert(last.keys.some(k => k.pubkey.equals(e.a.player_tokens)));
        assert(p.transaction.length <= 1232);
        assert.equal(tx.compileMessage().header.numRequiredSignatures, 1);
        assert.equal(e.calls.simulations, 1);
    }
});
test('missing position initializes only on stake; missing wallet ATA is idempotently created for exits', async () => {
    const e = fixture();
    e.map.delete(e.a.position.toBase58());
    const p = await prepareIncentive({ deployment, player: player.toBase58(), action: 'stake', amount: 1n }, e.rpc);
    const tx = Transaction.populate(VersionedTransaction.deserialize(p.transaction).message as any);
    assert(tx.instructions[1]!.data.equals(instruction('incentives', 'initialize_staker', e.a).data));
    await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'unstake', amount: 1n }, e.rpc), /POSITION_MISSING/);
    const f = fixture();
    f.map.delete(f.a.player_tokens.toBase58());
    const exit = await prepareIncentive({ deployment, player: player.toBase58(), action: 'unstake', amount: 1n }, f.rpc);
    const exitTx = Transaction.populate(VersionedTransaction.deserialize(exit.transaction).message as any);
    assert(exitTx.instructions[1]!.programId.equals(ATA_PROGRAM));
    assert.equal(exitTx.instructions[1]!.data[0], 1);
});
test('official ATA idempotent ABI fixes wallet, mint, token program and six account order', () => {
    for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
        const ix = createAssociatedToken(player, mint, program);
        assert.deepEqual([...ix.data], [1]);
        assert.deepEqual(ix.keys.map(k => k.pubkey.toBase58()), [player, associatedToken(player, mint, program), player, mint, SystemProgram.programId, program].map(k => k.toBase58()));
        assert.deepEqual(ix.keys.map(k => k.isSigner), [true, false, false, false, false, false]);
        assert.deepEqual(ix.keys.map(k => k.isWritable), [true, true, false, false, false, false]);
    }
});
test('reject wrong genesis, disabled deployment, noncanonical IDs and mutable or unsupported mint', async () => {
    const e = fixture();
    e.setGenesis('wrong');
    await assert.rejects(readStakingState(deployment, player.toBase58(), e.rpc), /GENESIS_MISMATCH/);
    for (const d of [{ ...deployment, enabled: false }, { ...deployment, stakingPoolId: '04' }, { ...deployment, network: 'mainnet-beta' as 'devnet' }])
        await assert.rejects(readStakingState(d, player.toBase58(), fixture().rpc));
    for (const offset of [0, 44, 46]) {
        const f = fixture();
        f.map.get(mint.toBase58())!.data[offset] = 1;
        await assert.rejects(readStakingState(deployment, player.toBase58(), f.rpc), /UNSUPPORTED_REWARD_MINT/);
    }
});
test('foreign pools/positions/receipt links, underfunded vaults and redirected token owners fail closed', async () => {
    for (const mutate of [(e: ReturnType<typeof fixture>) => { e.map.get(e.a.pool.toBase58())!.data[8] ^= 1; }, (e: ReturnType<typeof fixture>) => { e.map.get(e.a.position.toBase58())!.data[40] ^= 1; }, (e: ReturnType<typeof fixture>) => { e.map.get(e.a.reward_vault.toBase58())!.data.writeBigUInt64LE(999n, 64); }, (e: ReturnType<typeof fixture>) => { e.map.get(e.a.principal_vault.toBase58())!.data[32] ^= 1; }]) {
        const e = fixture();
        mutate(e);
        await assert.rejects(readStakingState(deployment, player.toBase58(), e.rpc));
    }
    const e = fixture();
    e.map.get(e.r.participant.toBase58())!.data[40] ^= 1;
    await assert.rejects(readRewardState(deployment, player.toBase58(), 1n, e.rpc), /ACCOUNT_LINK_MISMATCH/);
});
test('Token-2022 permits inert metadata and immutable owner, rejects fees/delegates/frozen state', async () => {
    const e = fixture(TOKEN_2022_PROGRAM);
    const base = e.map.get(mint.toBase58())!;
    const extended = Buffer.alloc(234);
    base.data.copy(extended);
    extended[165] = 1;
    extended.writeUInt16LE(18, 166);
    extended.writeUInt16LE(64, 168);
    base.data = extended;
    assert.equal((await readStakingState(deployment, player.toBase58(), e.rpc)).tokenProgram, TOKEN_2022_PROGRAM.toBase58());
    extended.writeUInt16LE(1, 166);
    assert.throws(() => readMint(base), /UNSUPPORTED_TOKEN_EXTENSION/);
    const t = token(player, 1n, TOKEN_2022_PROGRAM);
    t.data = Buffer.concat([t.data, Buffer.from([2, 7, 0, 0, 0])]);
    assert.equal(readToken(t, mint, player, TOKEN_2022_PROGRAM), 1n);
    t.data[108] = 2;
    assert.throws(() => readToken(t, mint, player, TOKEN_2022_PROGRAM), /UNSUPPORTED_TOKEN_ACCOUNT/);
});
test('zero, overflow, insufficient balances/stake and expired admission reject before wallet', async () => {
    for (const amount of [0n, -1n, 1n << 64n, 501n])
        await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'stake', amount }, fixture().rpc));
    await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'unstake', amount: 26n }, fixture().rpc), /INSUFFICIENT_STAKE/);
    const e = fixture();
    e.setClock(10800n);
    await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'stake', amount: 1n }, e.rpc), /POOL_ENDED/);
    await prepareIncentive({ deployment, player: player.toBase58(), action: 'unstake', amount: 25n }, e.rpc);
});
test('missing hourly receipt is not paid evidence and uncompleted epoch cannot be claimed', async () => {
    const e = fixture();
    e.map.delete(e.r.participant.toBase58());
    const s = await readRewardState(deployment, player.toBase58(), 1n, e.rpc);
    assert.equal(s.recordExists, false);
    assert.equal(s.hourlyClaimable, 0n);
    await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'claim-hourly', epoch: 1n }, e.rpc), /HOURLY_NOT_CLAIMABLE/);
    const f = fixture();
    f.setClock(4000n);
    await assert.rejects(prepareIncentive({ deployment, player: player.toBase58(), action: 'claim-hourly', epoch: 1n }, f.rpc), /HOURLY_NOT_CLAIMABLE/);
    f.map.get(f.r.epoch_state.toBase58())!.data[88] = 1;
    assert.equal((await readRewardState(deployment, player.toBase58(), 1n, f.rpc)).hourlyClaimable, 600n);
});
test('one wallet call, durable ticket precedes broadcast, finalized message is checked', async () => {
    const e = fixture();
    let stored = false;
    const original = e.wallet.signAndSendTransaction;
    e.wallet.signAndSendTransaction = async () => { assert.equal(stored, true); return original(); };
    const result = await sendIncentive({ deployment, wallet: e.wallet, action: 'stake', amount: 2n, onPrepared: t => { assert.doesNotThrow(() => JSON.stringify(t)); stored = true; } }, e.rpc);
    assert.equal(result.status, 'finalized');
    assert.equal(e.calls.wallet, 1);
    const f = fixture();
    await assert.rejects(sendIncentive({ deployment, wallet: f.wallet, action: 'stake', amount: 2n, onPrepared: () => { throw Error('storage'); } }, f.rpc), /storage/);
    assert.equal(f.calls.wallet, 0);
});
test('wallet bridge failure and RPC uncertainty retain exact public ticket and never rebroadcast', async () => {
    const e = fixture();
    e.wallet.signAndSendTransaction = async () => { e.calls.wallet++; throw Error('bridge'); };
    await assert.rejects(sendIncentive({ deployment, wallet: e.wallet, action: 'stake', amount: 1n }, e.rpc), (error: unknown) => error instanceof IncentiveSubmissionUnknownError && error.signature === null && error.ticket.amount === '1');
    assert.equal(e.calls.wallet, 1);
    const f = fixture();
    f.rpc.getSignatureStatuses = async () => { throw Error('offline'); };
    await assert.rejects(sendIncentive({ deployment, wallet: f.wallet, action: 'unstake', amount: 1n }, f.rpc), (error: unknown) => error instanceof IncentiveSubmissionUnknownError && error.signature !== null);
    assert.equal(f.calls.wallet, 1);
});
test('tracking rejects tampered action/amount/root/wallet and unrelated transactions; no signature remains unknown', async () => {
    const e = fixture();
    const p = await prepareIncentive({ deployment, player: player.toBase58(), action: 'stake', amount: 2n }, e.rpc);
    assert.equal(await trackIncentive(deployment, p.ticket, null, e.rpc), 'unknown');
    for (const change of [{ amount: '3' }, { action: 'unstake' as const }, { rootAddress: player.toBase58() }, { player: authority.toBase58() }, { configuredId: '6' }])
        await assert.rejects(trackIncentive(deployment, { ...p.ticket, ...change }, null, e.rpc), /INVALID_TRACKING_TICKET/);
    const unrelated = new Transaction({ feePayer: player, recentBlockhash: p.ticket.blockhash }).add(SystemProgram.transfer({ fromPubkey: player, toPubkey: authority, lamports: 2 }));
    await assert.rejects(trackIncentive(deployment, { ...p.ticket, messageBase64: unrelated.compileMessage().serialize().toString('base64') }, null, e.rpc), /INVALID_TRACKING_TICKET/);
});
test('rewarded coinflip requires explicit opt-in and funded active canonical phase', async () => {
    const e = fixture();
    e.unpause();
    e.setClock(4000n);
    const plain = await prepareCoinflip({ deployment, player: player.toBase58(), amountLamports: 100n, side: 0 }, e.rpc);
    assert.equal(plain.rewardQuote, null);
    const rewarded = await prepareCoinflip({ deployment, player: player.toBase58(), amountLamports: 100n, side: 0, rewardPhaseId: '5' }, e.rpc);
    assert.equal(rewarded.rewardQuote?.tokenUnits, 10n);
    assert.equal(rewarded.rewardQuote?.epoch, 1n);
    const tx = Transaction.populate(VersionedTransaction.deserialize(rewarded.transaction).message as any);
    assert(tx.instructions.at(-1)!.data.subarray(0, 8).equals(Buffer.from(schema.games.instructions.place_coinflip_rewarded.discriminator)));
    assert(rewarded.transaction.length <= 1232);
    await assert.rejects(prepareCoinflip({ deployment, player: player.toBase58(), amountLamports: 100000000n, side: 0, rewardPhaseId: '5' }, e.rpc), /WAGER_BUDGET_EXHAUSTED/);
});
test('stale RPC snapshots, epoch rollover and simulation from an older bank fail before signing', async () => {
    const e = fixture();
    let calls = 0;
    const read = e.rpc.getMultipleAccountsInfoAndContext;
    e.rpc.getMultipleAccountsInfoAndContext = (async (...args: Parameters<Rpc['getMultipleAccountsInfoAndContext']>) => { const result = await read(...args); if (++calls === 2)
        result.context.slot = 122; return result; }) as Rpc['getMultipleAccountsInfoAndContext'];
    await assert.rejects(readStakingState(deployment, player.toBase58(), e.rpc), /STALE_RPC_SNAPSHOT/);
    const f = fixture();
    let reads = 0;
    const second = f.rpc.getMultipleAccountsInfoAndContext;
    f.rpc.getMultipleAccountsInfoAndContext = (async (...args: Parameters<Rpc['getMultipleAccountsInfoAndContext']>) => { if (++reads === 2)
        f.setClock(10800n); return second(...args); }) as Rpc['getMultipleAccountsInfoAndContext'];
    await assert.rejects(readRewardState(deployment, player.toBase58(), undefined, f.rpc), /SNAPSHOT_EPOCH_CHANGED/);
    const g = fixture();
    g.rpc.simulateTransaction = (async () => ({ context: { slot: 122 }, value: { err: null, logs: [] } })) as Rpc['simulateTransaction'];
    await assert.rejects(sendIncentive({ deployment, wallet: g.wallet, action: 'stake', amount: 1n }, g.rpc), /STALE_RPC_SNAPSHOT/);
    assert.equal(g.calls.wallet, 0);
});
test('malformed, duplicate and value-changing Token-2022 TLVs cannot pass the allowlist', () => {
    for (const extension of [Buffer.from([18, 0, 64, 0]), Buffer.from([7, 0, 0, 0]), Buffer.from([18, 0, 0, 0]), Buffer.concat([Buffer.from([18, 0, 64, 0]), Buffer.alloc(64), Buffer.from([18, 0, 64, 0]), Buffer.alloc(64)])]) {
        const e = fixture(TOKEN_2022_PROGRAM);
        const value = e.map.get(mint.toBase58())!;
        const header = Buffer.alloc(166);
        value.data.copy(header);
        header[165] = 1;
        value.data = Buffer.concat([header, extension]);
        assert.throws(() => readMint(value));
    }
});
test('tracking never treats confirmed-only or missing transaction history as finalized payment', async () => {
    const e = fixture();
    const p = await prepareIncentive({ deployment, player: player.toBase58(), action: 'claim-wager' }, e.rpc);
    const signature = (await import('bs58')).default.encode(new Uint8Array(64).fill(7));
    e.rpc.getSignatureStatuses = (async () => ({ context: { slot: 124 }, value: [{ err: null, confirmationStatus: 'confirmed', slot: 124, confirmations: 1 }] })) as Rpc['getSignatureStatuses'];
    assert.equal(await trackIncentive(deployment, p.ticket, signature, e.rpc), 'pending');
    e.rpc.getSignatureStatuses = (async () => ({ context: { slot: 125 }, value: [{ err: null, confirmationStatus: 'finalized', slot: 125, confirmations: null }] })) as Rpc['getSignatureStatuses'];
    e.rpc.getTransaction = async () => null;
    assert.equal(await trackIncentive(deployment, p.ticket, signature, e.rpc), 'unknown');
});

test('finalized proof requires explicit consistent metadata and returned first signature binding', async () => {
  for (const meta of [null, undefined, {}, {err: undefined}]) {
    const e = fixture();
    const get = e.rpc.getTransaction;
    e.rpc.getTransaction = (async (...args: Parameters<Rpc['getTransaction']>) => ({...await get(...args), meta})) as unknown as Rpc['getTransaction'];
    await assert.rejects(sendIncentive({deployment, wallet: e.wallet, action: 'stake', amount: 1n}, e.rpc), (error: unknown) => error instanceof IncentiveSubmissionUnknownError && error.signature !== null);
    assert.equal(e.calls.wallet, 1);
  }
  for (const err of [undefined, false, 0]) {
    const e = fixture();
    e.rpc.getSignatureStatuses = (async () => ({context: {slot: 125}, value: [{confirmationStatus: 'finalized', slot: 125, confirmations: null, ...(err === undefined ? {} : {err})}]})) as unknown as Rpc['getSignatureStatuses'];
    await assert.rejects(sendIncentive({deployment, wallet: e.wallet, action: 'stake', amount: 1n}, e.rpc), IncentiveSubmissionUnknownError);
    assert.equal(e.calls.wallet, 1);
  }
  const e = fixture();
  const get = e.rpc.getTransaction;
  e.rpc.getTransaction = (async (...args: Parameters<Rpc['getTransaction']>) => {
    const result = await get(...args);
    return {...result, transaction: {...result!.transaction, signatures: ['unrelated']}};
  }) as unknown as Rpc['getTransaction'];
  await assert.rejects(sendIncentive({deployment, wallet: e.wallet, action: 'stake', amount: 1n}, e.rpc), /FINALIZED_TRANSACTION_MISMATCH/);
  assert.equal(e.calls.wallet, 1);
});

test('missing and malformed simulation success never opens the incentives wallet', async () => {
  for (const value of [undefined, null, {}, {err: undefined}, {err: false}, {err: 0}]) {
    const e = fixture();
    e.rpc.simulateTransaction = (async () => ({context: {slot: 123}, value})) as unknown as Rpc['simulateTransaction'];
    await assert.rejects(sendIncentive({deployment, wallet: e.wallet, action: 'stake', amount: 1n}, e.rpc), /TRANSACTION_SIMULATION_FAILED/);
    assert.equal(e.calls.wallet, 0);
  }
});
