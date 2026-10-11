import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from '@solana/web3.js';
import { equal, pda } from './common';
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
function extensions(data: Buffer, base: number, accountType: number, allowed: ReadonlyMap<number, number | null>) {
    if (data.length === base)
        return;
    if (data.length < 166 || data[165] !== accountType || data.subarray(base, 165).some(byte => byte !== 0))
        throw new Error('INVALID_TOKEN_EXTENSIONS');
    const seen = new Set<number>();
    let offset = 166;
    while (offset < data.length) {
        if (data.subarray(offset).every(byte => byte === 0))
            return;
        if (offset + 4 > data.length)
            throw new Error('INVALID_TOKEN_EXTENSIONS');
        const type = data.readUInt16LE(offset), size = data.readUInt16LE(offset + 2);
        offset += 4;
        if (!allowed.has(type) || seen.has(type) || (allowed.get(type) !== null && allowed.get(type) !== size) || offset + size > data.length)
            throw new Error('UNSUPPORTED_TOKEN_EXTENSION');
        if (type === 19 && size < 80)
            throw new Error('INVALID_TOKEN_EXTENSIONS');
        seen.add(type);
        offset += size;
    }
}
function tokenData(account: AccountInfo<Buffer>, base: number, kind: number, allowed: ReadonlyMap<number, number | null>) {
    if (account.executable || account.data.length < base)
        throw new Error('INVALID_TOKEN_ACCOUNT');
    if (account.owner.equals(TOKEN_PROGRAM)) {
        if (account.data.length !== base)
            throw new Error('INVALID_TOKEN_ACCOUNT');
    }
    else if (account.owner.equals(TOKEN_2022_PROGRAM))
        extensions(account.data, base, kind, allowed);
    else
        throw new Error('UNSUPPORTED_TOKEN_PROGRAM');
    return Buffer.from(account.data);
}
export function readMint(account: AccountInfo<Buffer>) {
    const data = tokenData(account, 82, 1, new Map([[18, 64], [19, null]]));
    if (data.readUInt32LE(0) !== 0 || data.readUInt32LE(46) !== 0 || data[44] !== 6 || data[45] !== 1)
        throw new Error('UNSUPPORTED_REWARD_MINT');
    return { tokenProgram: account.owner, decimals: 6 as const, supply: data.readBigUInt64LE(36) };
}
export function readToken(account: AccountInfo<Buffer>, mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey) {
    equal(account.owner, tokenProgram);
    const data = tokenData(account, 165, 2, new Map([[7, 0]]));
    equal(new PublicKey(data.subarray(0, 32)), mint);
    equal(new PublicKey(data.subarray(32, 64)), owner);
    if (data[108] !== 1 || data.readUInt32LE(72) !== 0 || data.readUInt32LE(109) !== 0 || data.readBigUInt64LE(121) !== 0n || data.readUInt32LE(129) !== 0)
        throw new Error('UNSUPPORTED_TOKEN_ACCOUNT');
    return data.readBigUInt64LE(64);
}
export const associatedToken = (player: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => pda(ATA_PROGRAM, player.toBytes(), tokenProgram.toBytes(), mint.toBytes())[0];
/** Official ATA interface CreateIdempotent ABI, with recipient pinned to the signer. */
export function createAssociatedToken(player: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
    return new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [
            { pubkey: player, isSigner: true, isWritable: true },
            { pubkey: associatedToken(player, mint, tokenProgram), isSigner: false, isWritable: true },
            ...[player, mint, SystemProgram.programId, tokenProgram].map(pubkey => ({ pubkey, isSigner: false, isWritable: false })),
        ] });
}
