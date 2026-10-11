import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { decodeEvent, finalizedFacts, verifyDeployment, GAMES, GENESIS } from '../src/chain';
import { loadConfig } from '../src/main';
const house = new PublicKey(new Uint8Array(32).fill(8)), player = new PublicKey(new Uint8Array(32).fill(9));
const signature = '1'.repeat(64), other = '11111111111111111111111111111111';
function event(placed = true) {
 const b = Buffer.alloc(placed ? 201 : 171); createHash('sha256').update(`event:${placed ? 'CoinflipPlaced' : 'CoinflipSettled'}`).digest().copy(b,0,0,8);
 house.toBuffer().copy(b,8); player.toBuffer().copy(b,104); b.writeBigUInt64LE(1n,136); b.writeBigUInt64LE(200n,144);
 const seed=Buffer.alloc(8);seed.writeBigUInt64LE(1n);PublicKey.findProgramAddressSync([Buffer.from('coinflip'),house.toBuffer(),player.toBuffer(),seed],new PublicKey(GAMES))[0].toBuffer().copy(b,72);
 b.writeBigInt64LE(1_790_811_000n,placed?193:162); if(!placed)b.writeBigUInt64LE(392n,152);return b;
}
function tx(logs: string[], keys = [GAMES], programIdIndex=0) { return { slot:100, transaction:{signatures:[signature],message:{accountKeys:keys,instructions:[{programIdIndex}]}},meta:{err:null,logMessages:logs} }; }
const logs = (b=event()) => [`Program ${GAMES} invoke [1]`,`Program data: ${b.toString('base64')}`,`Program ${GAMES} success`];
test('exact admission/settlement ABI and canonical own bet bind facts',()=>{
 assert.equal(decodeEvent(event(),house.toBase58())?.kind,'coinflip.placed'); assert.equal(decodeEvent(event(false),house.toBase58())?.payout,'392');
 assert.equal(finalizedFacts(tx(logs()),signature,100,house.toBase58())[0].instructionId,'0:0:1');
 assert.equal(decodeEvent(event(),player.toBase58()),null); const b=event();b[72]^=1;assert.throws(()=>decodeEvent(b,house.toBase58()),/BINDING/);
 assert.throws(()=>decodeEvent(event().subarray(0,200),house.toBase58()),/LAYOUT/);
});
test('failed transaction, above-finalized head and truncated stack cannot become facts',()=>{
 const t=tx(logs());t.meta.err='failure' as any;assert.throws(()=>finalizedFacts(t,signature,100,house.toBase58()));
 assert.throws(()=>finalizedFacts(tx(logs()),signature,99,house.toBase58()));
 assert.throws(()=>finalizedFacts(tx(logs().slice(0,2)),signature,100,house.toBase58()),/TRUNCATED/);
 assert.throws(()=>finalizedFacts(tx(logs()),'2'.repeat(87),100,house.toBase58()));
});
test('spoofed text and other program event are ignored; failed CPI rolls back its event',()=>{
 const encoded=event().toString('base64');
 assert.deepEqual(finalizedFacts(tx([`Program ${other} invoke [1]`,`Program data: ${encoded}`,`Program log: Program ${GAMES} invoke [2]`,`Program ${other} success`],[other]),signature,100,house.toBase58()),[]);
 const nested=[`Program ${other} invoke [1]`,`Program ${GAMES} invoke [2]`,`Program data: ${encoded}`,`Program ${GAMES} failed: custom program error: 1`,`Program ${other} success`];
 assert.deepEqual(finalizedFacts(tx(nested,[other]),signature,100,house.toBase58()),[]);
 nested[3]=`Program ${GAMES} success`;assert.equal(finalizedFacts(tx(nested,[other]),signature,100,house.toBase58())[0].instructionId,'0:1:2');
});
test('v0 loaded key resolution and canonical base64 reject malformed input',()=>{
 const t=tx(logs(),[other],1) as any;t.meta.loadedAddresses={writable:[],readonly:[GAMES]};assert.equal(finalizedFacts(t,signature,100,house.toBase58()).length,1);
 const bad=logs();bad[1]+=' ';assert.throws(()=>finalizedFacts(tx(bad),signature,100,house.toBase58()),/ENCODING/);
 t.meta.loadedAddresses.readonly=['garbage'];assert.throws(()=>finalizedFacts(t,signature,100,house.toBase58()),/ACCOUNT_KEYS/);
});
test('deployment verifies devnet, loader-derived ProgramData and pinned deployed bytes',async()=>{
 const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'); const address=PublicKey.findProgramAddressSync([new PublicKey(GAMES).toBuffer()],loader)[0];
 const program=Buffer.alloc(36);program.writeUInt32LE(2);address.toBuffer().copy(program,4);const deployed=Buffer.alloc(48);deployed.writeUInt32LE(3);deployed[45]=12;
 const hash=createHash('sha256').update(deployed.subarray(45)).digest('hex');
 const call=async(_u:string,m:string,p:any[]=[])=>m==='getGenesisHash'?GENESIS:{value:{owner:loader.toBase58(),executable:p[0]===GAMES,data:[(p[0]===GAMES?program:deployed).toString('base64'),'base64']}};
 await verifyDeployment('https://rpc.invalid',hash,call);await assert.rejects(verifyDeployment('https://rpc.invalid','0'.repeat(64),call),/CODE_CHANGED/);
 await assert.rejects(verifyDeployment('https://rpc.invalid',hash,async()=> 'mainnet'),/CONFIG/);
});
test('missing credentials stay offline; privileged DB identity and non-TLS endpoints rejected',()=>{
 assert.equal(loadConfig({}),null);const env={DATABASE_URL:'postgres://sollish_worker:fake@127.0.0.1/db',SOLANA_RPC_URL:'https://rpc.invalid',HOUSE_ADDRESS:house.toBase58(),GAMES_PROGRAM_DATA_SHA256:'1'.repeat(64),REALTIME_URL:'http://127.0.0.1:8787',PUBLISH_SIGNING_KEY:'x'.repeat(32)};
 assert.equal(loadConfig(env)?.house,house.toBase58());assert.throws(()=>loadConfig({...env,DATABASE_URL:'postgres://postgres:fake@127.0.0.1/db'}));assert.throws(()=>loadConfig({...env,REALTIME_URL:'ftp://localhost'}));assert.throws(()=>loadConfig({...env,SOLANA_RPC_URL:'http://rpc.invalid'}));
});

test('actual client instruction ordering retains outer indexes across logless ComputeBudget and precompiles',()=>{
 const compute='ComputeBudget111111111111111111111111111111'; const ed='Ed25519SigVerify111111111111111111111111111';
 const log=[`Program ${other} invoke [1]`,`Program ${other} success`,`Program ${GAMES} invoke [1]`,`Program ${GAMES} success`,...logs()];
 const t=tx(log,[compute,other,GAMES,ed]) as any; t.transaction.message.instructions=[{programIdIndex:0},{programIdIndex:1},{programIdIndex:2},{programIdIndex:2},{programIdIndex:3}];
 assert.equal(finalizedFacts(t,signature,100,house.toBase58())[0].instructionId,'3:0:5');
 t.transaction.message.instructions.unshift({programIdIndex:1});assert.throws(()=>finalizedFacts(t,signature,100,house.toBase58()),/OUTER_PROGRAM/);
});
test('actual LiteSVM SBF first/repeat wallet and settlement fixtures decode; optional native logs preserve outer index',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const name of ['first-wallet','repeat-wallet','settlement']){
  const fixture=JSON.parse(await readFile(new URL(`./fixtures/litesvm-${name}.json`,import.meta.url),'utf8'));
  const facts=finalizedFacts(fixture.transaction,fixture.signature,fixture.transaction.slot,fixture.house);
  assert.equal(facts.length,1);assert.equal(facts[0].kind,name==='settlement'?'coinflip.settled':'coinflip.placed');
  const stripped=structuredClone(fixture.transaction);stripped.meta.logMessages=stripped.meta.logMessages.filter((log:string)=>!log.startsWith('Program ComputeBudget111111111111111111111111111111 '));
  const without=finalizedFacts(stripped,fixture.signature,stripped.slot,fixture.house);
  assert.equal(without.length,1);assert.equal(without[0].instructionId.split(':')[0],facts[0].instructionId.split(':')[0]);assert.equal(without[0].bet,facts[0].bet);
 }
});
