import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction, type AccountInfo } from '@solana/web3.js';
import { schema } from './schema';

export type ProgramName = keyof typeof schema;
type WireType = string | { readonly array: readonly [WireType, number] } | { readonly defined: { readonly name: string } };
type Field = { readonly name: string; readonly type: WireType };
type Value = bigint | number | boolean | PublicKey | Uint8Array | Record<string, unknown>;
const U64_MAX = (1n << 64n) - 1n;

export function u64(value: bigint): Buffer {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw new Error('INVALID_U64');
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

export function instruction(program: ProgramName, name: string, accounts: Record<string, PublicKey>, args: Record<string, bigint | number> = {}) {
  const instructions = schema[program].instructions as Record<string, {
    discriminator: readonly number[];
    accounts: readonly { name: string; signer: boolean; writable: boolean }[];
    args: readonly Field[];
  }>;
  const definition = instructions[name];
  if (!definition) throw new Error('UNKNOWN_INSTRUCTION');
  if (Object.keys(args).some(key => !definition.args.some(arg => arg.name === key))) throw new Error('UNEXPECTED_ARGUMENT');
  const encodedArgs = definition.args.map(arg => {
    const value = args[arg.name];
    if (arg.type === 'u64' && typeof value === 'bigint') return u64(value);
    if (arg.type === 'u8' && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return Buffer.from([value]);
    throw new Error(`INVALID_ARGUMENT:${arg.name}`);
  });
  return new TransactionInstruction({
    programId: new PublicKey(schema[program].address),
    keys: definition.accounts.map(account => {
      if (!accounts[account.name]) throw new Error(`MISSING_ACCOUNT:${account.name}`);
      return { pubkey: accounts[account.name], isSigner: account.signer, isWritable: account.writable };
    }),
    data: Buffer.concat([Buffer.from(definition.discriminator), ...encodedArgs]),
  });
}

/** Decode only canonical fixed-size IDL accounts; reject trailing data, wrong owner and discriminator. */
export function decodeAccount<T>(program: ProgramName, name: string, account: AccountInfo<Buffer>): T {
  if (!account.owner.equals(new PublicKey(schema[program].address)) || account.executable) throw new Error('ACCOUNT_OWNER_MISMATCH');
  const definitions = schema[program].accounts as Record<string, { discriminator: readonly number[]; fields: readonly Field[] }>;
  const definition = definitions[name];
  const data = Buffer.from(account.data);
  if (!definition || !data.subarray(0, 8).equals(Buffer.from(definition.discriminator))) throw new Error('ACCOUNT_DISCRIMINATOR_MISMATCH');
  let offset = 8;
  const take = (length: number) => {
    if (offset + length > data.length) throw new Error('TRUNCATED_ACCOUNT');
    const bytes = data.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };
  const fields = (items: readonly Field[]): Record<string, unknown> => Object.fromEntries(items.map(field => [field.name, read(field.type)]));
  const read = (type: WireType): Value => {
    if (type === 'pubkey') return new PublicKey(take(32));
    if (type === 'u8') return take(1)[0]!;
    if (type === 'bool') {
      const byte = take(1)[0];
      if (byte !== 0 && byte !== 1) throw new Error('INVALID_BOOLEAN');
      return byte === 1;
    }
    if (type === 'u16') return take(2).readUInt16LE();
    if (type === 'u32') return take(4).readUInt32LE();
    if (type === 'u64') return take(8).readBigUInt64LE();
    if (type === 'i64') return take(8).readBigInt64LE();
    if (type === 'u128') { const bytes = take(16); return bytes.readBigUInt64LE() | (bytes.readBigUInt64LE(8) << 64n); }
    if (typeof type === 'object' && 'array' in type && type.array[0] === 'u8') return new Uint8Array(take(type.array[1]));
    if (typeof type === 'object' && 'defined' in type) {
      const types = schema[program].types as Record<string, readonly Field[]>;
      const definition = types[type.defined.name];
      if (!definition) throw new Error('UNSUPPORTED_ACCOUNT_TYPE');
      return fields(definition);
    }
    throw new Error('UNSUPPORTED_ACCOUNT_TYPE');
  };
  const decoded = fields(definition.fields);
  if (offset !== data.length) throw new Error('ACCOUNT_SIZE_MISMATCH');
  return decoded as T;
}
