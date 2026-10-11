import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS, PROGRAMS, RPC_URL, selectPrograms, parseArgs, validateArtifact, validateLimits, calculateFunding, inspectNetwork, createReadonlyRpc, saveImmutablePlan, sealPlan } from './plan.mjs';
const limits = { maxFeePerTransactionLamports: 100_000, maxTotalFeesLamports: 10_000_000, payerReserveLamports: 100_000_000 };
const fixture = () => { const binary=Buffer.alloc(64); binary.set([127,69,76,70,2,1]); binary.writeUInt16LE(263,18); binary.writeUInt32LE(2,48); const program=PROGRAMS[0]; return {program,binary,source:`declare_id!("${program.id}");`,idl:{address:program.id},manifestHash:createHash('sha256').update(binary).digest('hex'),keyPublic:program.id}; };

test('source, IDL, exact key and manifest must agree; a generated wrong key is rejected',()=>{
 const input=fixture(); assert.equal(validateArtifact(input).binaryBytes,64);
 for(const altered of [{keyPublic:PROGRAMS[1].id},{idl:{address:PROGRAMS[1].id}},{source:`declare_id!("${PROGRAMS[1].id}");`},{manifestHash:'0'.repeat(64)},{binary:Buffer.from('notELF')}])assert.throws(()=>validateArtifact({...input,...altered}));
});
test('reward-free selection pins correct keys and dependency order; invalid subsets and duplicate names fail',()=>{
 const pair=selectPrograms('games,house');assert.deepEqual(pair.map(p=>p.name),['house','games']);
 assert.deepEqual(pair.map(p=>p.keyPath),['.tooling/keys/house-keypair.json','.tooling/keys/games-keypair.json']);
 assert.deepEqual(pair.map(p=>p.id),['9bHnYHRGiNP8umiqtpAsALJYgcAJu3dKWVE1voGfqAu2','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ']);
 assert.deepEqual(selectPrograms('all').map(p=>p.name),['house','incentives','games']);assert.equal(selectPrograms('all')[1].keyPath,'target/deploy/incentives-keypair.json');
 for(const value of ['','house','games','house,incentives','house,games,games','house,games,mock_vrf'])assert.throws(()=>selectPrograms(value));
 const flags=['--max-fee-per-transaction-lamports','100000','--max-total-fees-lamports','10000000','--payer-reserve-lamports','100000000'];
 assert.deepEqual(parseArgs(['--programs','house,games',...flags]).selected,pair);
 assert.throws(()=>parseArgs(['--programs','house,games','--programs','all',...flags]));assert.throws(()=>parseArgs(['--url','mainnet',...flags]));
});
test('fee ceilings require exact explicit fields, safe integers and nonzero per-transaction ceiling',()=>{
 assert.deepEqual(validateLimits(limits),limits);
 for(const value of [undefined,null,-1,1.5,Number.MAX_SAFE_INTEGER+1,'100'])assert.throws(()=>validateLimits({...limits,maxTotalFeesLamports:value}));
 assert.throws(()=>validateLimits({...limits,unknown:true}));assert.throws(()=>validateLimits({...limits,maxTotalFeesLamports:1}));assert.throws(()=>validateLimits({...limits,maxFeePerTransactionLamports:0}));
});
test('three-program budget separates permanent rent, sequential buffer, total fees and reserve',()=>{
 const rows=PROGRAMS.map(p=>({...p,rents:{program:1,programData:10,buffer:9}}));
 const result=calculateFunding(rows,5,{maxFeePerTransactionLamports:1,maxTotalFeesLamports:3,payerReserveLamports:4});
 assert.equal(result.permanentRentLamports,33);assert.equal(result.sequentialConservativeEnvelopeLamports,49);assert.equal(result.allBuffersConservativeEnvelopeLamports,67);assert.equal(result.sequentialShortfallLamports,44);
 assert.equal(calculateFunding(rows,100,limits).permanentRentOnlyShortfallLamports,0);
 assert.throws(()=>calculateFunding(rows,-1,limits));assert.throws(()=>calculateFunding(rows.slice(1),1,limits));
 assert.throws(()=>calculateFunding(rows.map(p=>({...p,rents:{program:Number.MAX_SAFE_INTEGER,programData:1,buffer:1}})),1,limits));
});
test('Agave new-deploy buffer recycling does not double-count ProgramData rent in two-program peak',()=>{
 const rows=selectPrograms('house,games').map(p=>({...p,rents:{program:3,programData:100,buffer:90}}));
 const result=calculateFunding(rows,15,{maxFeePerTransactionLamports:1,maxTotalFeesLamports:5,payerReserveLamports:7});
 assert.equal(result.permanentRentLamports,206);assert.equal(result.cliSequentialRentPeakLamports,206);assert.equal(result.cliSequentialEnvelopeWithLimitsLamports,218);assert.equal(result.cliSequentialShortfallLamports,203);
 assert.deepEqual(result.cliStages.map(s=>[s.priorPermanentRentLamports,s.cliInitialBufferDepositLamports,s.rentPeakBeforeBufferReuseLamports]),[[0,100,103],[103,100,206]]);
 assert.equal(result.sequentialConservativeEnvelopeLamports,308);assert.throws(()=>calculateFunding([...rows].reverse(),15,limits),/ORDER/);
});
function mock(overrides={}) { const methods=[];return {methods,call:async(method,params)=>{methods.push({method,params});if(Object.hasOwn(overrides,method))return overrides[method];return ({getGenesisHash:GENESIS,getBalance:{context:{slot:10},value:5},getMultipleAccounts:{context:{slot:11},value:[null,null,null]},getMinimumBalanceForRentExemption:3})[method];}}; }
const programs=PROGRAMS.map((p,i)=>({name:p.name,programId:p.id,maxLenBytes:100+i}));
test('fresh finalized balance and absent owned accounts precede cached rent quotes; wrong genesis stops',async()=>{
 const m=mock();const report=await inspectNetwork(programs,limits,m.call);assert.equal(report.payerBalanceSlot,10);assert.equal(report.programAccountSlot,11);
 assert.equal(m.methods.filter(x=>x.method==='getMinimumBalanceForRentExemption').length,7);assert.equal(m.methods[2].params[1].minContextSlot,10);
 const wrong=mock({getGenesisHash:'mainnet'});await assert.rejects(inspectNetwork(programs,limits,wrong.call),/NON_DEVNET/);assert.equal(wrong.methods.length,1);
});
test('two-program inspection requests exactly House and Games and five rent sizes',async()=>{
 const pair=selectPrograms('house,games').map((p,i)=>({name:p.name,programId:p.id,maxLenBytes:100+i}));
 const m=mock({getMultipleAccounts:{context:{slot:11},value:[null,null]}});const report=await inspectNetwork(pair,limits,m.call);
 assert.deepEqual(m.methods[2].params[0],pair.map(p=>p.programId));assert.equal(report.programs.length,2);assert.equal(m.methods.filter(x=>x.method==='getMinimumBalanceForRentExemption').length,5);
 await assert.rejects(inspectNetwork(pair,limits,mock().call),/SNAPSHOT/);
});
test('missing/malformed balance, stale snapshots and already-existing programs block deployment planning',async()=>{
 for(const overrides of [{getBalance:{context:{slot:10}}},{getBalance:{context:{slot:10},value:'5'}},{getMultipleAccounts:{context:{slot:9},value:[null,null,null]}},{getMultipleAccounts:{context:{slot:11},value:[null,null]}},{getMultipleAccounts:{context:{slot:11},value:[null,{},null]}},{getMinimumBalanceForRentExemption:null}])await assert.rejects(inspectNetwork(programs,limits,mock(overrides).call));
});
test('RPC pins devnet and only read methods, paces calls, and does not retry429',async()=>{
 let now=0;const starts=[];const call=createReadonlyRpc({now:()=>now,wait:async ms=>{now+=ms;},fetchImpl:async(url,init)=>{assert.equal(url,RPC_URL);const body=JSON.parse(init.body);starts.push(now);return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:1}),{status:200});}});
 await assert.rejects(call('sendTransaction',['secret']),/NOT_READ_ONLY/);await Promise.all([call('getGenesisHash'),call('getBalance'),call('getMultipleAccounts')]);assert.deepEqual(starts,[0,600,1200]);
 let requests=0;const rate=createReadonlyRpc({fetchImpl:async()=>{requests++;return new Response('',{status:429});}});await assert.rejects(rate('getBalance'),/429/);assert.equal(requests,1);
});
test('RPC malformed envelopes and oversized responses never become valid observations',async()=>{
 for(const body of [{jsonrpc:'2.0',id:2,result:null},{jsonrpc:'2.0',id:1,error:{message:'remote raw error'}},{jsonrpc:'2.0',id:1},'x'.repeat(70_000)]) {
  const call=createReadonlyRpc({fetchImpl:async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status:200})});await assert.rejects(call('getGenesisHash'));
 }
});
test('immutable report refuses overwrite and hash binds genesis, artifacts and configured fee caps',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sollish-deployment-plan-'));try {
  const path=join(dir,'plan.json'),plan={genesis:GENESIS,artifactSha256:'a'.repeat(64),limits};const hash=await saveImmutablePlan(path,plan);assert.equal(hash,sealPlan(plan).planSha256);
  await assert.rejects(saveImmutablePlan(path,{changed:true}));assert.equal(await readFile(path,'utf8'),sealPlan(plan).contents);
  for(const change of [{genesis:'other'},{artifactSha256:'b'.repeat(64)},{limits:{...limits,maxTotalFeesLamports:20_000_000}}])assert.notEqual(sealPlan({...plan,...change}).planSha256,hash);
 }finally{await rm(dir,{recursive:true,force:true});}
});
