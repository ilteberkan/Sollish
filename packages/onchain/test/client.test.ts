import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type AccountInfo } from '@solana/web3.js';
import {
  addresses, prepareCoinflip, sendCoinflip, readCoinflip, settleCoinflipInstruction,
  validateDeployment, decodeAccount, DEVNET_GENESIS, HOUSE_PROGRAM, GAMES_PROGRAM, VRF_PROGRAM,
  VRF_QUEUE, SubmissionUnknownError, WalletSubmissionUnknownError, type Rpc, type CoinflipDeployment,
} from '../src/index';
import { schema } from '../src/schema';

const authority = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
const player = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
const config: CoinflipDeployment = { enabled: true, network: 'devnet', rpcUrl: 'https://api.devnet.solana.com', houseAuthority: authority.toBase58(), shardId: 7 };
const a = addresses(authority, player, 7, 1n);
const discriminator = (name: string) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const account = (owner: PublicKey, data: Buffer, lamports = 1_000_000_000): AccountInfo<Buffer> => ({ owner, data, executable: false, lamports, rentEpoch: 0 });
function fixture() {
  // Fixed Rust layouts, intentionally independent of the client IDL-driven decoder.
  const house = Buffer.alloc(74); discriminator('HouseConfig').copy(house);
  authority.toBuffer().copy(house, 8); GAMES_PROGRAM.toBuffer().copy(house, 40);
  house[73] = PublicKey.findProgramAddressSync([Buffer.from('house'), authority.toBuffer()], HOUSE_PROGRAM)[1];
  const game = Buffer.alloc(75); discriminator('CoinflipConfig').copy(game);
  a.house.toBuffer().copy(game, 8); VRF_QUEUE.toBuffer().copy(game, 40); game.writeUInt16LE(200, 72);
  game[74] = PublicKey.findProgramAddressSync([Buffer.from('coinflip_config'), a.house.toBuffer()], GAMES_PROGRAM)[1];
  const shard = Buffer.alloc(91); discriminator('HouseShard').copy(shard); a.house.toBuffer().copy(shard, 8);
  shard.writeUInt16LE(7, 40); shard.writeBigUInt64LE(10_000_000n, 42); shard.writeBigUInt64LE(10_000_000n, 50);
  shard.writeBigUInt64LE(20_000_000n, 58); shard.writeBigUInt64LE(100_000_000n, 66);
  shard[90] = PublicKey.findProgramAddressSync([Buffer.from('shard'), a.house.toBuffer(), Buffer.from([7, 0])], HOUSE_PROGRAM)[1];
  const executable = { ...account(SystemProgram.programId, Buffer.alloc(0)), executable: true };
  const accounts: (AccountInfo<Buffer> | null)[] = [executable, executable, executable,
    account(HOUSE_PROGRAM, house), account(GAMES_PROGRAM, game), account(HOUSE_PROGRAM, shard), account(VRF_PROGRAM, Buffer.alloc(0)), null, null];
  let simulation: VersionedTransaction | undefined;
  const calls: string[] = [];
  const rpc = {
    getGenesisHash: async () => { calls.push('genesis'); return DEVNET_GENESIS; },
    getMultipleAccountsInfoAndContext: async () => ({ context: { slot: 50 }, value: accounts }),
    getMinimumBalanceForRentExemption: async () => 1_524_240,
    getLatestBlockhash: async () => ({ blockhash: Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey.toBase58(), lastValidBlockHeight: 500 }),
    simulateTransaction: async (tx: VersionedTransaction) => { calls.push('simulate'); simulation = tx; return { context: { slot: 51 }, value: { err: null, logs: [] } }; },
    getSignatureStatuses: async () => ({ context: { slot: 52 }, value: [{ err: null, confirmationStatus: 'confirmed' }] }),
    getTransaction: async (signature: string) => ({ meta: { err: null }, transaction: { signatures: [signature], message: simulation!.message } }),
    getAccountInfo: async () => null,
  } as unknown as Rpc;
  return { accounts, rpc, calls };
}
const request = { deployment: config, player: player.toBase58(), amountLamports: 1_000_001n, side: 1 as const };

test('first wallet bet atomically initializes both permanent accounts and signs only as player', async () => {
  const { rpc } = fixture();
  const result = await prepareCoinflip(request, rpc);
  const tx = Transaction.from(Buffer.from(result.transaction));
  assert.equal(result.expectedGrossLamports, 1_960_001n);
  assert.equal(result.id, 1n);
  assert.equal(result.betAddress, a.bet.toBase58());
  assert.equal(tx.instructions.length, 4);
  assert.equal(tx.instructions[1]!.programId.toBase58(), HOUSE_PROGRAM.toBase58());
  assert.equal(tx.instructions[2]!.programId.toBase58(), GAMES_PROGRAM.toBase58());
  const place = tx.instructions[3]!;
  assert.equal(place.data.length, 25);
  assert.deepEqual(place.data.subarray(0, 8), createHash('sha256').update('global:place_coinflip').digest().subarray(0, 8));
  assert.equal(place.data.readBigUInt64LE(8), 1n); assert.equal(place.data[16], 1); assert.equal(place.data.readBigUInt64LE(17), 1_000_001n);
  assert.deepEqual(place.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58()), [player.toBase58()]);
  assert.equal(place.keys[4]!.pubkey.toBase58(), a.house_bet.toBase58());
  assert.equal(place.keys[6]!.pubkey.toBase58(), a.bet.toBase58());
  assert.equal(place.keys[10]!.pubkey.toBase58(), VRF_QUEUE.toBase58());
  assert.ok(result.transaction.length <= 1232);
});

test('wrong network and disabled deployment cannot reach wallet or RPC', async () => {
  const { rpc, calls } = fixture(); let walletCalls = 0;
  const wallet = { address: player.toBase58(), signAndSendTransaction: async () => { walletCalls++; return new Uint8Array(64); } };
  await assert.rejects(sendCoinflip({ ...request, deployment: { ...config, enabled: false }, wallet }, rpc), /DEPLOYMENT_DISABLED/);
  assert.deepEqual(calls, []); assert.equal(walletCalls, 0);
  rpc.getGenesisHash = async () => 'mainnet-genesis';
  await assert.rejects(sendCoinflip({ ...request, wallet }, rpc), /GENESIS_MISMATCH/);
  assert.equal(walletCalls, 0);
  assert.throws(() => validateDeployment({ ...config, network: 'mainnet-beta' as 'devnet' }), /UNSUPPORTED_NETWORK/);
  assert.throws(() => validateDeployment({ ...config, rpcUrl: 'http://remote.example/rpc' }), /INVALID_RPC_URL/);
});

for (const [name, mutate, error] of [
  ['house owner', (v: (AccountInfo<Buffer> | null)[]) => { v[3]!.owner = GAMES_PROGRAM; }, 'OWNER_MISMATCH'],
  ['house paused', (v: (AccountInfo<Buffer> | null)[]) => { v[3]!.data[72] = 1; }, 'HOUSE_PAUSED'],
  ['wrong authority', (v: (AccountInfo<Buffer> | null)[]) => { player.toBuffer().copy(v[3]!.data, 8); }, 'LINK_MISMATCH'],
  ['wrong stored bump', (v: (AccountInfo<Buffer> | null)[]) => { v[3]!.data[73] ^= 1; }, 'BUMP_MISMATCH'],
  ['wrong VRF queue owner', (v: (AccountInfo<Buffer> | null)[]) => { v[6]!.owner = HOUSE_PROGRAM; }, 'LINK_MISMATCH'],
  ['out of collateral', (v: (AccountInfo<Buffer> | null)[]) => { v[5]!.lamports = 111_524_240; }, 'INSUFFICIENT_HOUSE_RESERVE'],
  ['unsafe RPC lamports', (v: (AccountInfo<Buffer> | null)[]) => { v[5]!.lamports = Number.MAX_SAFE_INTEGER + 1; }, 'UNSAFE_RPC_INTEGER'],
  ['wrong discriminator', (v: (AccountInfo<Buffer> | null)[]) => { v[5]!.data[0] ^= 1; }, 'DISCRIMINATOR_MISMATCH'],
  ['noncanonical bool', (v: (AccountInfo<Buffer> | null)[]) => { v[3]!.data[72] = 2; }, 'INVALID_BOOLEAN'],
] as const) {
  test(`untrusted account rejected: ${name}`, async () => {
    const { rpc, accounts, calls } = fixture(); mutate(accounts);
    await assert.rejects(prepareCoinflip(request, rpc), new RegExp(error));
    assert.ok(!calls.includes('simulate'));
  });
}

test('strict next nonce above JavaScript safe integers retains exact u64 precision', async () => {
  const { rpc, accounts } = fixture();
  const ledger = Buffer.alloc(81); discriminator('PlayerLedger').copy(ledger); a.house.toBuffer().copy(ledger, 8); player.toBuffer().copy(ledger, 40);
  const previous = 9_007_199_254_740_993n; ledger.writeBigUInt64LE(previous, 72);
  ledger[80] = PublicKey.findProgramAddressSync([Buffer.from('player'), a.house.toBuffer(), player.toBuffer()], HOUSE_PROGRAM)[1];
  accounts[7] = account(HOUSE_PROGRAM, ledger);
  const result = await prepareCoinflip(request, rpc);
  assert.equal(result.id, previous + 1n);
  assert.equal(Transaction.from(Buffer.from(result.transaction)).instructions.length, 3);
  assert.equal(result.betAddress, addresses(authority, player, 7, previous + 1n).bet.toBase58());
  ledger.writeBigUInt64LE((1n << 64n) - 1n, 72);
  await assert.rejects(prepareCoinflip(request, rpc), /INVALID_U64/);
});

test('invalid wagers and failed simulation cannot prompt a wallet', async () => {
  const { rpc } = fixture();
  for (const amount of [0n, -1n, 1n << 64n, 10_000_001n]) {
    await assert.rejects(prepareCoinflip({ ...request, amountLamports: amount }, rpc));
  }
  rpc.simulateTransaction = (async () => ({ context: { slot: 51 }, value: { err: 'InsufficientFunds' } })) as unknown as Rpc['simulateTransaction'];
  let calls = 0;
  await assert.rejects(sendCoinflip({ ...request, wallet: { address: player.toBase58(), signAndSendTransaction: async () => { calls++; return new Uint8Array(64); } } }, rpc), /SIMULATION_FAILED/);
  assert.equal(calls, 0);
});

test('wallet sends once; returned confirmation means admission, never payout', async () => {
  const { rpc } = fixture(); let calls = 0;
  const result = await sendCoinflip({ ...request, wallet: { address: player.toBase58(), signAndSendTransaction: async (bytes, chain) => { calls++; assert.equal(chain, 'solana:devnet'); assert.ok(bytes.length > 100); return new Uint8Array(64).fill(42); } } }, rpc);
  assert.equal(calls, 1); assert.equal(result.status, 'confirmed'); assert.ok(!('payout' in result));
});

test('RPC loss after wallet submission returns trackable uncertainty without retry', async () => {
  const { rpc } = fixture(); let calls = 0;
  rpc.getSignatureStatuses = async () => { throw new Error('RPC down'); };
  await assert.rejects(sendCoinflip({ ...request, wallet: { address: player.toBase58(), signAndSendTransaction: async () => { calls++; return new Uint8Array(64).fill(1); } } }, rpc), (error: unknown) => {
    assert.ok(error instanceof SubmissionUnknownError); assert.equal(error.betAddress, a.bet.toBase58()); assert.equal(error.id, 1n); assert.ok(error.signature.length > 80); return true;
  });
  assert.equal(calls, 1);
});

test('wallet bridge failure preserves the exact bet nonce for recovery without a signature', async () => {
  const { rpc } = fixture(); let calls = 0;
  await assert.rejects(sendCoinflip({ ...request, wallet: { address: player.toBase58(), signAndSendTransaction: async () => { calls++; throw new Error('bridge disconnected after broadcast'); } } }, rpc), (error: unknown) => {
    assert.ok(error instanceof WalletSubmissionUnknownError); assert.equal(error.betAddress, a.bet.toBase58()); assert.equal(error.id, 1n); assert.equal(error.lastValidBlockHeight, 500); return true;
  });
  assert.equal(calls, 1);
});

test('public tracking is persisted before any wallet call and storage failure fails closed', async () => {
  const { rpc } = fixture(); const order: string[] = [];
  const wallet = { address: player.toBase58(), signAndSendTransaction: async () => { order.push('wallet'); return new Uint8Array(64).fill(8); } };
  await sendCoinflip({ ...request, wallet, onPrepared(ticket) { order.push('persist'); assert.equal(ticket.id, 1n); assert.equal(ticket.betAddress, a.bet.toBase58()); } }, rpc);
  assert.deepEqual(order, ['persist', 'wallet']); order.length = 0;
  await assert.rejects(sendCoinflip({ ...request, wallet, onPrepared() { throw new Error('Storage unavailable'); } }, rpc), /Storage unavailable/);
  assert.deepEqual(order, []);
});

test('confirmed unrelated signature does not masquerade as the prepared bet', async () => {
  const { rpc } = fixture();
  rpc.getTransaction = (async () => ({ meta: { err: null }, transaction: { message: { serialize: () => new Uint8Array(0) } } })) as unknown as Rpc['getTransaction'];
  await assert.rejects(sendCoinflip({ ...request, wallet: { address: player.toBase58(), signAndSendTransaction: async () => new Uint8Array(64).fill(5) } }, rpc), /CONFIRMED_TRANSACTION_MISMATCH/);
});

test('missing receipts remain unknown and finalized is the default read commitment', async () => {
  const { rpc } = fixture();
  rpc.getAccountInfo = async (_address, commitment) => { assert.equal(commitment, 'finalized'); return null; };
  assert.equal(await readCoinflip(config, player.toBase58(), 1n, rpc), null);
});

test('keeper cannot set payout or recipient; instruction is precisely the generated account order', () => {
  const ix = settleCoinflipInstruction(authority.toBase58(), player.toBase58(), 7, 1n);
  assert.equal(ix.data.length, 8);
  assert.equal(ix.keys[0]!.pubkey.toBase58(), player.toBase58());
  assert.equal(ix.keys.filter(k => k.isSigner).length, 0);
  assert.equal(ix.keys.length, schema.games.instructions.settle_coinflip.accounts.length);
});

test('fixed account decoding rejects trailing bytes and truncation', () => {
  const { accounts } = fixture(); const house = accounts[3]!;
  assert.throws(() => decodeAccount('house', 'HouseConfig', { ...house, data: Buffer.concat([house.data, Buffer.from([0])]) }), /SIZE_MISMATCH/);
  assert.throws(() => decodeAccount('house', 'HouseConfig', { ...house, data: house.data.subarray(0, 73) }), /TRUNCATED_ACCOUNT/);
});

function betFixture(side: 0 | 1, status: 0 | 1 | 2, randomnessBit: 0 | 1, payout: bigint) {
  // Rust CoinflipBet is 252 bytes including its discriminator. These offsets
  // deliberately do not use the IDL decoder that this fixture validates.
  const data = Buffer.alloc(252); discriminator('CoinflipBet').copy(data);
  a.config.toBuffer().copy(data, 8); a.house.toBuffer().copy(data, 40);
  a.shard.toBuffer().copy(data, 72); player.toBuffer().copy(data, 104);
  data.writeBigUInt64LE(1n, 136); data.writeBigUInt64LE(1_000_000n, 144);
  data.writeBigUInt64LE(1_960_000n, 152); a.bet.toBuffer().copy(data, 160);
  data[192] = randomnessBit; data.writeBigUInt64LE(payout, 224);
  data[249] = side; data[250] = status;
  data[251] = PublicKey.findProgramAddressSync([Buffer.from('coinflip'), a.house.toBuffer(), player.toBuffer(), Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])], GAMES_PROGRAM)[1];
  return account(GAMES_PROGRAM, data);
}

test('finalized outcome decoding accepts exactly the contract win/loss payout relation', async () => {
  const { rpc } = fixture();
  for (const side of [0, 1] as const) for (const randomnessBit of [0, 1] as const) {
    const payout = side === randomnessBit ? 1_960_000n : 0n;
    rpc.getAccountInfo = async () => betFixture(side, 2, randomnessBit, payout);
    const result = await readCoinflip(config, player.toBase58(), 1n, rpc);
    assert.equal(result!.payout, payout); assert.equal(result!.winningSide, randomnessBit);
    assert.equal(result!.status, 'settled');
  }
  rpc.getAccountInfo = async () => betFixture(1, 0, 0, 0n);
  assert.equal((await readCoinflip(config, player.toBase58(), 1n, rpc))!.winningSide, null);
  rpc.getAccountInfo = async () => betFixture(1, 1, 1, 0n);
  assert.equal((await readCoinflip(config, player.toBase58(), 1n, rpc))!.status, 'ready-to-settle');
});

test('inconsistent owned bet snapshots cannot be presented as valid payouts', async () => {
  const { rpc } = fixture();
  for (const invalid of [
    betFixture(0, 2, 0, 1n),
    betFixture(0, 2, 0, 0n),
    betFixture(0, 2, 1, 1_960_000n),
    betFixture(0, 1, 0, 1_960_000n),
  ]) {
    rpc.getAccountInfo = async () => invalid;
    await assert.rejects(readCoinflip(config, player.toBase58(), 1n, rpc), /INVALID_PAYOUT/);
  }
  const zeroStake = betFixture(0, 2, 0, 1_960_000n); zeroStake.data.writeBigUInt64LE(0n, 144);
  const insufficientGross = betFixture(0, 0, 0, 0n); insufficientGross.data.writeBigUInt64LE(999_999n, 152);
  for (const invalid of [zeroStake, insufficientGross]) {
    rpc.getAccountInfo = async () => invalid;
    await assert.rejects(readCoinflip(config, player.toBase58(), 1n, rpc), /INVALID_BET_ACCOUNT/);
  }
});

test('confirmed admission requires explicit success metadata and matching returned signature', async () => {
  for (const meta of [null, undefined, {}, {err: undefined}]) {
    const {rpc} = fixture();
    const get = rpc.getTransaction;
    rpc.getTransaction = (async (...args: Parameters<Rpc['getTransaction']>) => ({...await get(...args), meta})) as unknown as Rpc['getTransaction'];
    await assert.rejects(sendCoinflip({...request, wallet: {address: player.toBase58(), signAndSendTransaction: async () => new Uint8Array(64).fill(7)}}, rpc), SubmissionUnknownError);
  }
  const {rpc} = fixture();
  const get = rpc.getTransaction;
  rpc.getTransaction = (async (...args: Parameters<Rpc['getTransaction']>) => {const result = await get(...args); return {...result, transaction: {...result!.transaction, signatures: ['unrelated']}};}) as unknown as Rpc['getTransaction'];
  await assert.rejects(sendCoinflip({...request, wallet: {address: player.toBase58(), signAndSendTransaction: async () => new Uint8Array(64).fill(7)}}, rpc), /CONFIRMED_TRANSACTION_MISMATCH/);
});

test('missing and malformed simulation success never opens the Coinflip wallet', async () => {
  for (const value of [undefined, null, {}, {err: undefined}, {err: false}, {err: 0}]) {
    const {rpc} = fixture(); let calls = 0;
    rpc.simulateTransaction = (async () => ({context: {slot: 51}, value})) as unknown as Rpc['simulateTransaction'];
    await assert.rejects(sendCoinflip({...request, wallet: {address: player.toBase58(), signAndSendTransaction: async () => {calls++; return new Uint8Array(64);}}}, rpc), /TRANSACTION_SIMULATION_FAILED/);
    assert.equal(calls, 0);
  }
});
