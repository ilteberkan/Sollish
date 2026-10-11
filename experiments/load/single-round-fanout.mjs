/** 1000 spectators + 64 bettors, ONE unchanged ContactArena ledger. Loopback only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { RINGSIDE_MARKETS,contactCommitmentInput,combatResults } from '../../packages/protocol/src/ringside.ts';
import { simulateContactCombat } from '../../packages/protocol/src/combat-v3.ts';
import {root,sourceHashes,statsSubclass,startRuntime,measurement,clientHarness,hardware,until,quantiles,digest,writeEvidence} from './runtime.mjs';
const files=['experiments/load/public-fanout-worker.ts','experiments/load/single-round-fanout.mjs'];
const before=await sourceHashes(files);
const entry=`import {ContactArena} from ${JSON.stringify(resolve(root,'apps/realtime/src/ringside-arena.ts'))};
export {PublicFanout,SnapshotRelay} from ${JSON.stringify(resolve(root,'experiments/load/public-fanout-worker.ts'))};
${statsSubclass}
export default {async fetch(r:Request,e:any){const u=new URL(r.url);if(u.pathname==='/ready')return new Response('ready');
if(u.pathname==='/stats'||u.pathname==='/bettor')return e.ARENA.get(e.ARENA.idFromName('global')).fetch(r);
const m=/^\\/viewer\\/([0-3])$/.exec(u.pathname);if(!m)return new Response('not found',{status:404});
await e.RELAY.get(e.RELAY.idFromName('source')).start();return e.FANOUT.get(e.FANOUT.idFromName('bucket-'+m[1])).fetch(r);}};`;
const runtime=await startRuntime('single-round-fanout',18890,entry,[{name:'ARENA',class_name:'MeasuredArena'},{name:'RELAY',class_name:'SnapshotRelay'},{name:'FANOUT',class_name:'PublicFanout'}],['MeasuredArena','SnapshotRelay','PublicFanout']);
const metrics=measurement(runtime),h=clientHarness(runtime,metrics.data),bettors=[],viewers=[];
const started=new Date().toISOString();let report;
const bound=setTimeout(()=>{metrics.data.guard='WALL_TIME_BOUND';for(const c of h.clients)c.ws.close();},240000);
try{
 const joinStart=performance.now();
 // The relay holds one private demo session; spectators have NO funded session.
 for(let i=0;i<1000;i+=20)viewers.push(...await Promise.all(Array.from({length:20},(_,j)=>h.connect(`/viewer/${(i+j)%4}`,{spectator:true}))));
 for(let i=0;i<64;i+=8)bettors.push(...await Promise.all(Array.from({length:8},()=>h.connect('/bettor'))));
 const joinMs=performance.now()-joinStart;assert.ok(bettors.every(c=>c.balance===100000));assert.equal(viewers.length,1000);console.log('CHECKPOINT 1000 same-round spectators + 64 bettors connected');
 // An attempted financial command on a read-only fanout cannot create a session/debit.
 const baseline=await(await fetch(`${runtime.base}/stats`)).json();assert.equal(baseline.sessions.n,65);assert.equal(baseline.tickets.n,0);
 h.send(viewers[0],{type:'bet',id:randomUUID(),roundId:viewers[0].snapshot.round.id,market:'winner',outcome:'kor',amount:1000});
 await until(()=>viewers[0].errors.includes('SESSION_REQUIRED'),10000,'VIEWER_WRITE_DENIED');
 assert.deepEqual(await(await fetch(`${runtime.base}/stats`)).json(),baseline);
 await until(()=>bettors.every(c=>c.snapshot.round.phase==='open'&&c.snapshot.round.id===bettors[0].snapshot.round.id)&&bettors[0].snapshot.round.closesAt-Date.now()>14000,95000,'FRESH_WINDOW');
 const roundId=bettors[0].snapshot.round.id,commitment=bettors[0].snapshot.round.commitment;
 for(const [i,c]of bettors.entries()){const m=RINGSIDE_MARKETS[i%4];c.command={type:'bet',id:randomUUID(),roundId,market:m.id,outcome:m.outcomes[Math.floor(i/4)%m.outcomes.length],amount:1000};c.sentAt=performance.now();h.send(c,c.command);h.send(c,c.command);}
 await until(()=>bettors.every(c=>c.ackAt!==null||c.errors.length),20000,'ADMISSION');
 assert.ok(bettors.every(c=>c.tickets.has(c.command.id)));const acknowledgements=bettors.map(c=>c.ackAt-c.sentAt);console.log('CHECKPOINT 64 accepted',JSON.stringify(quantiles(acknowledgements)));
 const reconnect=[];for(let i=0;i<64;i+=8)await Promise.all(Array.from({length:8},(_,j)=>h.reconnect(bettors[i+j]).then(c=>{bettors[i+j]=c;reconnect.push(c.reconnectMs);})));for(let i=0;i<40;i+=8)await Promise.all(Array.from({length:8},(_,j)=>h.reconnect(viewers[i+j]).then(c=>{viewers[i+j]=c;reconnect.push(c.reconnectMs);})));
 await until(()=>bettors.every(c=>c.snapshot.round.id===roundId&&c.snapshot.round.phase==='fighting')&&viewers.every(c=>c.snapshot.round.id===roundId&&c.snapshot.round.phase==='fighting'),30000,'SHARED_FIGHT');
 for(const c of bettors.slice(0,16))h.send(c,{...c.command,id:randomUUID()});await until(()=>bettors.slice(0,16).every(c=>c.errors.includes('ROUND_CLOSED')),10000,'LATE_DENIAL');
 await until(()=>bettors.every(c=>c.tickets.get(c.command.id)?.status!=='accepted'&&c.settledSnapshot?.round.id===roundId&&c.balance===99000+c.tickets.get(c.command.id)?.payout)&&viewers.every(c=>c.settledSnapshot?.round.id===roundId),65000,'ALL_SETTLED');
 const s=await(await fetch(`${runtime.base}/stats`)).json(),final=bettors[0].settledSnapshot,r=final.round;
 assert.equal(r.commitment,commitment);assert.equal(digest(contactCommitmentInput(r.id,r.seed,r.bout)),r.commitment);assert.deepEqual(r.results,combatResults(simulateContactCombat(r.seed,r.bout.initial)));
 const sameRound=JSON.stringify(r);assert.ok([...viewers,...bettors].every(c=>JSON.stringify(c.settledSnapshot.round)===sameRound));
 assert.equal(s.sessions.n,65);assert.equal(s.tickets.n,64);assert.equal(s.tickets.pending,0);assert.equal(s.tickets.stakes,64000);assert.equal(s.sessions.balance+s.fees.total,65*100000);assert.equal(s.sessions.balance,bettors.reduce((a,c)=>a+c.balance,100000));for(const p of s.pools)assert.equal(p.stakes,p.payouts+p.fee);assert.equal(s.pools.length,4);
 assert.ok(viewers.every(c=>c.balance===null&&c.token===null&&c.tickets.size===0));assert.ok(viewers.every(c=>c.settledSnapshot.online<=65));assert.equal(metrics.data.invalidFrames,0);assert.equal(metrics.data.unexpectedClose,0);assert.equal(metrics.data.guard,null);assert.deepEqual(await sourceHashes(files),before);
 report={status:'PASS_BOUNDED_LOCAL_TARGET',startedAt:started,finishedAt:new Date().toISOString(),hardware:hardware(),sourceHashes:before,entrySha256:runtime.entryHash,topology:{authoritativeLedgers:1,publicFanoutObjects:4,simultaneousSpectators:1000,simultaneousBettors:64,privateRelaySession:1,spectatorFinancialSessions:0},clock:'Actual 20s open + 45s fight; no clock/seed/state override',joinMs:Math.round(joinMs),admission:{accepted:64,duplicateFrames:64,uniqueLedgerTickets:64,latencyMs:quantiles(acknowledgements)},reconnect:{bettors:64,spectators:40,sameTokenSameId:true,latencyMs:quantiles(reconnect)},late:{attempts:16,rejected:16},broadcast:{all1064SameRoundAndOutcome:true,strictPublicSchema:true,viewerCommandCannotWrite:true,snapshotDeliveryLagMs:quantiles(h.latency),settlementReceiptLagMs:quantiles(bettors.map(c=>c.settledAt-r.endsAt))},ledger:s,metrics:metrics.finish(),scope:'EXPERIMENTAL loopback adapter only. 1000 viewers observe one unchanged ledger and 64 real local demo admissions. Does not raise production ticket/session caps, deploy fanout, validate cloud geography/soak/failure recovery or authorize real assets. Spectator count is NOT fabricated into ledger online/participants.'};
}catch(e){report={status:'TARGET_NOT_MET',startedAt:started,finishedAt:new Date().toISOString(),error:e.message,hardware:hardware(),sourceHashes:before,metrics:metrics.finish(),spectatorsConnected:viewers.length,bettorsConnected:bettors.length,accepted:bettors.filter(c=>c.command&&c.tickets.has(c.command.id)).length,errorCodes:[...new Set(h.clients.flatMap(c=>c.errors))],scope:'Failed bounded local target retained; no throughput claim.'};process.exitCode=1;console.error(runtime.logs().slice(-2000));}
finally{clearTimeout(bound);await h.close();await runtime.close();await writeEvidence('single-round-fanout',report);}
