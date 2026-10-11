import { constants } from 'node:fs';
import { open, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { Keypair, PublicKey, ComputeBudgetProgram, Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { addresses, decodeAccount, readCoinflip, settleCoinflipInstruction, HOUSE_PROGRAM, type CoinflipDeployment } from '@sollish/onchain';
import { publicKey, signature, sequence } from '@sollish/protocol';
import { GENESIS, GAMES, verifyDeployment } from './chain';
import type { WorkerConfig } from './main';
export type KeeperConfig = { payerPath:string; journalPath:string; houseAuthority:string; shardId:number; maxFee:bigint; lifetimeBudget:bigint; minBalance:bigint; houseCodeHash:string };
const amount=(value:string|undefined)=>{if(!value||!/^(0|[1-9][0-9]{0,15})$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('INVALID_KEEPER_LIMIT');return BigInt(value);};
export function keeperConfig(env:NodeJS.ProcessEnv):KeeperConfig|null{
 if(env.KEEPER_ENABLED!=='true')return null;
 const payerPath=env.KEEPER_FEE_KEY_PATH??'',journalPath=env.KEEPER_JOURNAL_PATH??'',houseAuthority=env.HOUSE_AUTHORITY??'',shardId=Number(env.KEEPER_SHARD_ID),houseCodeHash=env.HOUSE_PROGRAM_DATA_SHA256??'';
 if(!isAbsolute(payerPath)||!isAbsolute(journalPath)||!publicKey(houseAuthority)||!Number.isInteger(shardId)||shardId<0||shardId>65535||!/^[a-f0-9]{64}$/.test(houseCodeHash))throw new Error('INVALID_KEEPER_CONFIG');
 const maxFee=amount(env.KEEPER_MAX_FEE_LAMPORTS),lifetimeBudget=amount(env.KEEPER_LIFETIME_BUDGET_LAMPORTS),minBalance=amount(env.KEEPER_MIN_BALANCE_LAMPORTS);
 if(maxFee===0n||lifetimeBudget<maxFee||payerPath===journalPath)throw new Error('INVALID_KEEPER_LIMIT');
 return {payerPath,journalPath,houseAuthority,shardId,maxFee,lifetimeBudget,minBalance,houseCodeHash};
}
export async function loadFeeKey(path:string):Promise<Keypair>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.()||stat.size>4096)throw new Error('UNSAFE_FEE_KEY_FILE');
 const raw=await file.readFile();try{const bytes=JSON.parse(raw.toString());if(!Array.isArray(bytes)||bytes.length!==64||bytes.some(b=>!Number.isInteger(b)||b<0||b>255))throw new Error('INVALID_FEE_KEY');const secret=Uint8Array.from(bytes);try{return Keypair.fromSecretKey(secret);}finally{secret.fill(0);bytes.fill(0);}}finally{raw.fill(0);}
 }finally{await file.close();}
}
type Entry={signature:string;fee:string;state:'pending'|'finalized'|'failed';lastValidBlockHeight:number;finalizedSlot?:number};
type Journal={v:1;genesis:string;program:string;house:string;payer:string;reserved:string;entries:Record<string,Entry>};
export class KeeperJournal{
 private data:Journal;private released=false;
 private constructor(readonly path:string,data:Journal){this.data=data;}
 static async acquire(path:string,house:string,payer:string):Promise<KeeperJournal>{
  const directory=await open(dirname(path),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await directory.stat();if(!stat.isDirectory()||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw new Error('UNSAFE_JOURNAL_DIRECTORY');}finally{await directory.close();}
  await mkdir(path+'.lock',{mode:0o700});
  try{let data:Journal={v:1,genesis:GENESIS,program:GAMES,house,payer,reserved:'0',entries:{}};
   try{const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await file.stat();if(!st.isFile()||(st.mode&0o777)!==0o600||st.uid!==process.getuid?.()||st.size>10_000_000)throw new Error('UNSAFE_JOURNAL_FILE');data=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   if(data.v!==1||data.genesis!==GENESIS||data.program!==GAMES||data.house!==house||data.payer!==payer||!/^(0|[1-9]\d{0,19})$/.test(data.reserved)||!data.entries||Array.isArray(data.entries))throw new Error('JOURNAL_BINDING_MISMATCH');
   let total=0n;for(const [bet,e]of Object.entries(data.entries)){if(!publicKey(bet)||!signature(e.signature)||!/^[1-9]\d{0,15}$/.test(e.fee)||!['pending','finalized','failed'].includes(e.state)||!sequence(e.lastValidBlockHeight)||(e.finalizedSlot!==undefined&&(!sequence(e.finalizedSlot)||e.state==='pending')))throw new Error('INVALID_JOURNAL_ENTRY');total+=BigInt(e.fee);}
   if(total!==BigInt(data.reserved))throw new Error('JOURNAL_BUDGET_MISMATCH');return new KeeperJournal(path,data);
  }catch(e){await rm(path+'.lock',{recursive:true});throw e;}
 }
 has(bet:string){return Object.hasOwn(this.data.entries,bet);}
 entries(){return Object.entries(this.data.entries).map(([bet,e])=>({bet,...e}));}
 /** Finalized fees may leave the balance reserve only when the balance read is
  * from at least that finalized bank. Legacy entries without a slot stay reserved. */
 balanceGuard(){let pendingFees=0n,minContextSlot=0;for(const e of Object.values(this.data.entries)){if(e.state==='pending'||e.finalizedSlot===undefined)pendingFees+=BigInt(e.fee);else minContextSlot=Math.max(minContextSlot,e.finalizedSlot);}return {pendingFees,minContextSlot};}
 async reserve(bet:string,entry:Entry,budget:bigint){if(this.has(bet))throw new Error('BET_ALREADY_ATTEMPTED');if(BigInt(this.data.reserved)+BigInt(entry.fee)>budget)throw new Error('KEEPER_LIFETIME_BUDGET');this.data.entries[bet]=entry;this.data.reserved=(BigInt(this.data.reserved)+BigInt(entry.fee)).toString();await this.save();}
 async mark(bet:string,state:'finalized'|'failed',finalizedSlot:number){if(!this.has(bet))throw new Error('UNKNOWN_ATTEMPT');if(!sequence(finalizedSlot))throw new Error('INVALID_FINALIZED_SLOT');this.data.entries[bet].state=state;this.data.entries[bet].finalizedSlot=finalizedSlot;await this.save();}
 private async save(){const temp=this.path+'.tmp';const file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await file.writeFile(JSON.stringify(this.data));await file.sync();}finally{await file.close();}await rename(temp,this.path);const parent=await open(dirname(this.path),constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}}
 async close(){if(!this.released){await rm(this.path+'.lock',{recursive:true});this.released=true;}}
}
/** Exact read-only candidates are decoded again by the shared generated IDL client.
 * RPC filters optimize the scan; they never authorize payout or replace checks. */
export function keeperCandidate(account:{pubkey:PublicKey;account:any},config:KeeperConfig,house:string):{player:string;id:bigint}|null{
 const bet=decodeAccount<{house:PublicKey;shard:PublicKey;player:PublicKey;id:bigint;status:number}>('games','CoinflipBet',account.account);
 if(bet.house.toBase58()!==house||bet.status!==1)return null;
 const derived=addresses(new PublicKey(config.houseAuthority),bet.player,config.shardId,bet.id);
 if(!derived.house.equals(bet.house)||!derived.shard.equals(bet.shard)||!derived.bet.equals(account.pubkey))return null;
 return {player:bet.player.toBase58(),id:bet.id};
}
export interface KeeperRpc extends Pick<Connection,'getGenesisHash'|'getProgramAccounts'|'getAccountInfo'|'getLatestBlockhash'|'getBalance'|'getFeeForMessage'|'simulateTransaction'|'sendRawTransaction'|'getSignatureStatuses'>{}
export class Keeper{
 private running=false;
 constructor(readonly config:KeeperConfig,readonly worker:WorkerConfig,readonly payer:Keypair,readonly journal:KeeperJournal,readonly connection:KeeperRpc,readonly verify=verifyDeployment){}
 async tick():Promise<void>{if(this.running)return;this.running=true;try{await this.run();}finally{this.running=false;}}
 private async run(){
  if(await this.connection.getGenesisHash()!==GENESIS)throw new Error('GENESIS_MISMATCH');
  const games=await this.verify(this.worker.rpcUrl,this.worker.codeHash),house=await this.verify(this.worker.rpcUrl,this.config.houseCodeHash,undefined,HOUSE_PROGRAM.toBase58());
  const feeKey=this.payer.publicKey.toBase58();if([this.config.houseAuthority,games.upgradeAuthority,house.upgradeAuthority].includes(feeKey))throw new Error('PRIVILEGED_FEE_KEY');
  const ownHouse=addresses(new PublicKey(this.config.houseAuthority),this.payer.publicKey,this.config.shardId,1n).house;if(ownHouse.toBase58()!==this.worker.house)throw new Error('KEEPER_HOUSE_MISMATCH');
  for(const attempt of this.journal.entries().filter(e=>e.state==='pending')){const status=(await this.connection.getSignatureStatuses([attempt.signature],{searchTransactionHistory:true})).value[0];if(status?.confirmationStatus==='finalized'){
   if(!Object.hasOwn(status,'err')||(status.err!==null&&(typeof status.err!=='object'||Array.isArray(status.err)||Object.keys(status.err).length===0)))throw new Error('INVALID_FINALIZED_STATUS');
   await this.journal.mark(attempt.bet,status.err===null?'finalized':'failed',status.slot);
  }}
  const candidates=await this.connection.getProgramAccounts(new PublicKey(GAMES),{commitment:'finalized',filters:[{dataSize:252},{memcmp:{offset:40,bytes:this.worker.house}},{memcmp:{offset:250,bytes:'2'}}]});
  if(candidates.length>10_000)throw new Error('KEEPER_SCAN_LIMIT');
  const deployment:CoinflipDeployment={enabled:true,network:'devnet',rpcUrl:this.worker.rpcUrl,houseAuthority:this.config.houseAuthority,shardId:this.config.shardId};
  for(const raw of candidates){if(this.journal.has(raw.pubkey.toBase58()))continue;const candidate=keeperCandidate(raw,this.config,this.worker.house);if(!candidate)continue;
   const read=await readCoinflip(deployment,candidate.player,candidate.id,this.connection as any,'finalized');if(read?.status!=='ready-to-settle')continue;
   const block=await this.connection.getLatestBlockhash('finalized');if(!sequence(block.lastValidBlockHeight))throw new Error('INVALID_BLOCK_HEIGHT');
   const tx=new Transaction({feePayer:this.payer.publicKey,...block}).add(ComputeBudgetProgram.setComputeUnitLimit({units:300_000}),settleCoinflipInstruction(this.config.houseAuthority,candidate.player,this.config.shardId,candidate.id));
   const wire=new VersionedTransaction(tx.compileMessage());wire.sign([this.payer]);
   const simulated=await this.connection.simulateTransaction(wire,{sigVerify:true,commitment:'finalized'});if(!simulated?.value||typeof simulated.value!=='object'||Array.isArray(simulated.value)||!Object.hasOwn(simulated.value,'err')||simulated.value.err!==null)throw new Error('KEEPER_SIMULATION_FAILED');
   const guard=this.journal.balanceGuard();
   const quoted=(await this.connection.getFeeForMessage(wire.message,'finalized')).value,balance=await this.connection.getBalance(this.payer.publicKey,{commitment:'finalized',minContextSlot:guard.minContextSlot});
   if(!sequence(quoted)||quoted===0||!sequence(balance)||BigInt(quoted)>this.config.maxFee||BigInt(balance)<BigInt(quoted)+guard.pendingFees+this.config.minBalance)throw new Error('KEEPER_FEE_BOUND');
   const sig=encodeBase58(wire.signatures[0]);await this.journal.reserve(raw.pubkey.toBase58(),{signature:sig,fee:String(quoted),state:'pending',lastValidBlockHeight:block.lastValidBlockHeight},this.config.lifetimeBudget);
   // Exactly one send attempt. Timeout/restart tracks this signature; never
   // constructs a replacement transaction or releases the reserved fee budget.
   try{const returned=await this.connection.sendRawTransaction(wire.serialize(),{skipPreflight:false,preflightCommitment:'finalized',maxRetries:0});if(returned!==sig)throw new Error('KEEPER_SIGNATURE_MISMATCH');}catch{throw new Error('KEEPER_SUBMISSION_UNKNOWN');}
   return; // At most one transaction per tick and no automatic receipt close.
  }
 }
}
function encodeBase58(bytes:Uint8Array){const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let result='';while(n){result=alphabet[Number(n%58n)]+result;n/=58n;}for(const b of bytes){if(b!==0)break;result='1'+result;}return result;}
