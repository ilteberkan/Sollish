import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { publicKey, sequence, signature } from "@sollish/protocol";
export const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const GAMES = "8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ";
// Runtime may omit invoke logs for these native/precompiled instructions only.
// See Agave precompiles/src/lib.rs and svm/message-processor processing path.
export const OPTIONAL_RUNTIME_LOG_PROGRAMS = new Set([
 "ComputeBudget111111111111111111111111111111",
 "Ed25519SigVerify111111111111111111111111111",
 "KeccakSecp256k11111111111111111111111111111",
 "Secp256r1SigVerify1111111111111111111111111",
]);
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const discriminator = (name: string) => createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
export type ChainFact = { signature: string; instructionId: string; slot: number; wallet: string; bet: string; stake: string; payout: string; kind: "coinflip.placed" | "coinflip.settled"; occurredAt: string };
type Json = Record<string, any>;
export async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const body = await response.json() as Json;
  if (body.jsonrpc !== "2.0" || body.id !== 1 || body.error || !Object.hasOwn(body, "result")) throw new Error("RPC_INVALID_RESPONSE");
  return body.result;
}
export function decodeEvent(data: Buffer, house: string): Omit<ChainFact, "signature" | "slot" | "instructionId"> | null {
  const placed = data.subarray(0, 8).equals(discriminator("CoinflipPlaced"));
  const settled = data.subarray(0, 8).equals(discriminator("CoinflipSettled"));
  if (!placed && !settled) return null;
  if (data.length !== (placed ? 201 : 171)) throw new Error("EVENT_LAYOUT_MISMATCH");
  if (new PublicKey(data.subarray(8, 40)).toBase58() !== house) return null;
  const bet = new PublicKey(data.subarray(72, 104)), player = new PublicKey(data.subarray(104, 136));
  const id = data.readBigUInt64LE(136), stake = data.readBigUInt64LE(144);
  const seed = Buffer.alloc(8); seed.writeBigUInt64LE(id);
  const expected = PublicKey.findProgramAddressSync([Buffer.from("coinflip"), new PublicKey(house).toBuffer(), player.toBuffer(), seed], new PublicKey(GAMES))[0];
  if (id === 0n || stake === 0n || !bet.equals(expected) || data[placed ? 152 : 160] > 1 || settled && (data[161] > 1 || data[170] > 1)) throw new Error("EVENT_BINDING_MISMATCH");
  const timestamp = data.readBigInt64LE(placed ? 193 : 162);
  if (timestamp < 0n || timestamp > 253402300799n) throw new Error("EVENT_TIME_INVALID");
  return { wallet: player.toBase58(), bet: bet.toBase58(), stake: stake.toString(), payout: placed ? "0" : data.readBigUInt64LE(152).toString(), kind: placed ? "coinflip.placed" : "coinflip.settled", occurredAt: new Date(Number(timestamp) * 1000).toISOString() };
}
/** Runtime invoke-stack scopes Anchor Program data. Spoofed Program log text,
 * failed CPI frames, failed transactions and incomplete logs never become facts. */
export function finalizedFacts(tx: Json, txSignature: string, head: number, house: string): ChainFact[] {
  if (!signature(txSignature) || !publicKey(house) || !sequence(head) || !tx?.meta || tx.meta.err !== null || !sequence(tx.slot) || tx.slot > head || !Array.isArray(tx.meta.logMessages) || tx.meta.logMessages.length > 10_000) throw new Error("UNVERIFIED_TRANSACTION");
  if (tx.transaction?.signatures?.[0] !== txSignature) throw new Error("TRANSACTION_ID_MISMATCH");
  const msg = tx.transaction.message;
  if (!Array.isArray(msg.accountKeys) || msg.accountKeys.some((k: unknown) => !publicKey(k)) || !Array.isArray(msg.instructions)) throw new Error("UNSUPPORTED_MESSAGE");
  const loaded = tx.meta.loadedAddresses ?? { writable: [], readonly: [] };
  const keys: string[] = [...msg.accountKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])];
  if (keys.length > 256 || keys.some(k => !publicKey(k))) throw new Error("INVALID_ACCOUNT_KEYS");
  const instructions = msg.instructions as { programIdIndex: number }[];
  type Frame = { program: string; outer: number; inner: number; facts: ChainFact[] };
  const frames: Frame[] = [], result: ChainFact[] = [];
  let outer = -1, inner = 0, bytes = 0;
  for (const [logIndex, log] of (tx.meta.logMessages as unknown[]).entries()) {
    if (typeof log !== "string" || (bytes += Buffer.byteLength(log)) > 512 * 1024) throw new Error("LOG_BOUNDS_EXCEEDED");
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/.exec(log);
    if (invoke) {
      const depth = Number(invoke[2]);
      if (depth !== frames.length + 1 || depth > 16) throw new Error("INVALID_INVOKE_STACK");
      if (depth === 1) {
        outer++; inner = 0;
        while (outer < instructions.length && keys[instructions[outer]?.programIdIndex] !== invoke[1] && OPTIONAL_RUNTIME_LOG_PROGRAMS.has(keys[instructions[outer]?.programIdIndex])) outer++;
        if (keys[instructions[outer]?.programIdIndex] !== invoke[1]) throw new Error("OUTER_PROGRAM_MISMATCH");
      }
      else inner++;
      frames.push({ program: invoke[1], outer, inner: depth === 1 ? 0 : inner, facts: [] }); continue;
    }
    const finish = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed:.*)$/.exec(log);
    if (finish) {
      const current = frames.pop(); if (!current || current.program !== finish[1]) throw new Error("INVALID_INVOKE_STACK");
      if (finish[2] === "success") { if (frames.length) frames.at(-1)!.facts.push(...current.facts); else result.push(...current.facts); }
      continue;
    }
    const current = frames.at(-1);
    if (log.startsWith("Program data: ") && current?.program === GAMES) {
      const encoded = log.slice(14); if (encoded.length > 4096) throw new Error("EVENT_BOUNDS_EXCEEDED");
      const data = Buffer.from(encoded, "base64"); if (data.toString("base64") !== encoded) throw new Error("EVENT_ENCODING_INVALID");
      const event = decodeEvent(data, house);
      if (event) current.facts.push({ ...event, signature: txSignature, slot: tx.slot, instructionId: `${current.outer}:${current.inner}:${logIndex}` });
    }
  }
  while (outer + 1 < instructions.length && OPTIONAL_RUNTIME_LOG_PROGRAMS.has(keys[instructions[outer + 1]?.programIdIndex])) outer++;
  if (frames.length || outer + 1 !== instructions.length) throw new Error("TRUNCATED_RUNTIME_LOGS");
  return result;
}
export async function verifyDeployment(url: string, expectedHash: string, call = rpc, programId = GAMES): Promise<{ upgradeAuthority: string | null }> {
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || await call(url, "getGenesisHash") !== GENESIS) throw new Error("CHAIN_CONFIG_MISMATCH");
  const program = (await call(url, "getAccountInfo", [programId, { encoding: "base64", commitment: "finalized" }])).value;
  if (!program || !program.executable || program.owner !== LOADER || program.data?.[1] !== "base64") throw new Error("PROGRAM_UNAVAILABLE");
  const data = Buffer.from(program.data[0], "base64");
  if (data.length !== 36 || data.readUInt32LE(0) !== 2) throw new Error("INVALID_PROGRAM_LOADER");
  const address = new PublicKey(data.subarray(4)).toBase58();
  if (address !== PublicKey.findProgramAddressSync([new PublicKey(programId).toBuffer()], new PublicKey(LOADER))[0].toBase58()) throw new Error("INVALID_PROGRAM_DATA");
  const deployed = (await call(url, "getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }])).value;
  if (!deployed || deployed.owner !== LOADER || deployed.executable || deployed.data?.[1] !== "base64") throw new Error("INVALID_PROGRAM_DATA");
  const code = Buffer.from(deployed.data[0], "base64");
  if (code.length < 45 || code.readUInt32LE(0) !== 3 || createHash("sha256").update(code.subarray(45)).digest("hex") !== expectedHash) throw new Error("PROGRAM_CODE_CHANGED");
  if (code[12] !== 0 && code[12] !== 1) throw new Error("INVALID_UPGRADE_AUTHORITY");
  return { upgradeAuthority: code[12] === 1 ? new PublicKey(code.subarray(13, 45)).toBase58() : null };
}
