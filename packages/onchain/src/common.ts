import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { u64 } from './codec';
export const pda = (program: PublicKey, ...seeds: (string | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds.map(seed => Buffer.from(seed)), program);
export function key(value: string): PublicKey {
    const parsed = new PublicKey(value);
    if (parsed.toBase58() !== value)
        throw new Error('NON_CANONICAL_PUBLIC_KEY');
    return parsed;
}
export function equal(actual: PublicKey, expected: PublicKey) {
    if (!actual.equals(expected))
        throw new Error('ACCOUNT_LINK_MISMATCH');
}
export function canonical(address: PublicKey, bump: number, derivation: [
    PublicKey,
    number
]) {
    equal(address, derivation[0]);
    if (bump !== derivation[1])
        throw new Error('ACCOUNT_BUMP_MISMATCH');
}
export function required<T>(value: T | null | undefined): T { if (value == null)
    throw new Error('DEPLOYMENT_ACCOUNT_MISSING'); return value; }
export function id(value: string | undefined): bigint {
    if (value == null || !/^(0|[1-9][0-9]*)$/.test(value))
        throw new Error('INVALID_CONFIGURED_ID');
    const result = BigInt(value);
    u64(result);
    return result;
}
export function snapshotSlot(slot: number, minimum: number) {
    if (!Number.isSafeInteger(slot) || slot < minimum || slot < 0)
        throw new Error('STALE_RPC_SNAPSHOT');
    return slot;
}
