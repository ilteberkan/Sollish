/** 1120 real local clients, FIVE independent existing ContactArena ledgers. No simulated time. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { RINGSIDE_MARKETS,contactCommitmentInput,combatResults } from '../../packages/protocol/src/ringside.ts';
import { simulateContactCombat } from '../../packages/protocol/src/combat-v3.ts';
import {root,sourceHashes,statsSubclass,startRuntime,measurement,clientHarness,hardware,until,quantiles,digest,writeEvidence} from './runtime.mjs';
const rooms=5,perRoom=224,reconnectPerRoom=32,latePerRoom=16;
const before=await sourceHashes(['experiments/load/contact-rooms.mjs']);
const entry=`import {ContactArena} from ${JSON.stringify(resolve(root,'apps/realtime/src/ringside-arena.ts'))};\n${statsSubclass}\nexport default {fetch(r:Request,e:any){const u=new URL(r.url);if(u.pathname==='/ready')return new Response('ready');const m=/^\\/room\\/([0-4])\\/(socket|stats)$/.exec(u.pathname);if(!m)return new Response('not found',{status:404});u.pathname=m[2]==='stats'?'/stats':'/socket';return e.ARENA.get(e.ARENA.idFromName('room-'+m[1])).fetch(new Request(u,r));}};`;
const runtime=await startRuntime('contact-rooms',18889,entry,[{name:'ARENA',class_name:'MeasuredArena'}],['MeasuredArena']);
const metrics=measurement(runtime),h=clientHarness(runtime,metrics.data),groups=Array.from({length:rooms},()=>[]);
const started=new Date().toISOString();let report;
const bound=setTimeout(()=>{metrics.data.guard='WALL_TIME_BOUND';for(const c of h.clients)c.ws.close();},240000);
try{
 const joinStart=performance.now();
 for(let n=0;n<perRoom;n+=8){const batch=await Promise.all(Array.from({length:Math.min(8,perRoom-n)*rooms},(_,i)=>h.connect(`/room/${i%rooms}/socket`)));batch.forEach((c,i)=>groups[i%rooms].push(c));assert.equal(metrics.data.guard,null);}
 const joinMs=performance.now()-joinStart;assert.equal(h.clients.length,1120);assert.ok(h.clients.every(c=>c.balance===100000));console.log('CHECKPOINT 1120 sessions connected; waiting for an actual open window');
 await until(()=>groups.every(g=>g.every(c=>c.snapshot?.round.id===g[0].snapshot.round.id&&c.snapshot.round.phase==='open')&&g[0].snapshot.round.closesAt-Date.now()>14000),95000,'FRESH_WINDOWS');
 const roundIds=groups.map(g=>g[0].snapshot.round.id),commitments=groups.map(g=>g[0].snapshot.round.commitment);
 for(const g of groups)for(const [i,c]of g.entries()){const m=RINGSIDE_MARKETS[i%4];c.command={type:'bet',id:randomUUID(),roundId:c.snapshot.round.id,market:m.id,outcome:m.outcomes[Math.floor(i/4)%m.outcomes.length],amount:1000};c.sentAt=performance.now();h.send(c,c.command);if(i<32)h.send(c,c.command);}
 await until(()=>groups.flat().every(c=>c.ackAt!==null||c.errors.length),30000,'ALL_ADMISSION_RESPONSES');
 const accepted=groups.map(g=>g.filter(c=>c.tickets.has(c.command.id)).length),ack=groups.flat().filter(c=>c.ackAt!==null).map(c=>c.ackAt-c.sentAt);console.log('CHECKPOINT admission',JSON.stringify({accepted,latency:quantiles(ack)}));
 assert.equal(metrics.data.guard,null);
 const reconnect=[];
 for(let n=0;n<reconnectPerRoom;n+=4){const jobs=[];for(const g of groups)for(let j=n;j<Math.min(n+4,reconnectPerRoom);j++)jobs.push(h.reconnect(g[j]).then(c=>{g[j]=c;reconnect.push(c.reconnectMs);}));await Promise.all(jobs);}
 await until(()=>groups.every(g=>g.every(c=>c.snapshot.round.id===roundIds[groups.indexOf(g)]&&c.snapshot.round.phase==='fighting')),30000,'CUTOFF');
 for(const g of groups)for(const c of g.slice(0,latePerRoom))h.send(c,{...c.command,id:randomUUID()});
 await until(()=>groups.every(g=>g.slice(0,latePerRoom).every(c=>c.errors.includes('ROUND_CLOSED'))),15000,'LATE_REJECTIONS');
 await until(()=>groups.every(g=>g.every(c=>c.settledSnapshot?.round.id===c.command.roundId&&(c.tickets.has(c.command.id)?c.tickets.get(c.command.id).status!=='accepted'&&c.balance===99000+c.tickets.get(c.command.id).payout:c.balance===100000))),65000,'SETTLEMENT');
 const stats=[];
 for(let i=0;i<rooms;i++){
  const s=await(await fetch(`${runtime.base}/room/${i}/stats`)).json(),g=groups[i],snapshot=g[0].settledSnapshot,r=snapshot.round;
  assert.equal(r.commitment,commitments[i]);assert.equal(digest(contactCommitmentInput(r.id,r.seed,r.bout)),r.commitment);assert.deepEqual(r.results,combatResults(simulateContactCombat(r.seed,r.bout.initial)));
  assert.ok(g.every(c=>JSON.stringify(c.settledSnapshot.round)===JSON.stringify(r)));assert.equal(s.sessions.n,perRoom);assert.equal(s.tickets.n,accepted[i]);assert.equal(s.tickets.pending,0);assert.equal(s.tickets.stakes,accepted[i]*1000);assert.equal(s.sessions.balance+s.fees.total,perRoom*100000);assert.equal(s.sessions.balance,g.reduce((sum,c)=>sum+c.balance,0));
  for(const p of s.pools)assert.equal(p.stakes,p.payouts+p.fee);assert.ok(s.pools.length<=4);stats.push({room:i,roundId:r.id,...s});
 }
 assert.equal(metrics.data.invalidFrames,0);assert.equal(metrics.data.unexpectedClose,0);assert.equal(metrics.data.guard,null);assert.deepEqual(await sourceHashes(['experiments/load/contact-rooms.mjs']),before);
 report={status:accepted.every(n=>n===perRoom)?'PASS_BOUNDED_LOCAL_TARGET':'ADMISSION_TARGET_NOT_MET_LEDGER_VERIFIED',startedAt:started,finishedAt:new Date().toISOString(),hardware:hardware(),sourceHashes:before,entrySha256:runtime.entryHash,topology:{rooms,independentLedgers:rooms,simultaneousSessions:1120,perRoom},clock:'Actual 20s open + 45s fight; no clock/seed/state override',joinMs:Math.round(joinMs),admission:{attempted:1120,accepted:accepted.reduce((a,n)=>a+n,0),acceptedPerRoom:accepted,duplicateFrames:160,uniqueLedgerTickets:accepted.reduce((a,n)=>a+n,0),latencyMs:quantiles(ack)},reconnect:{sessions:reconnect.length,sameTokenSameId:true,latencyMs:quantiles(reconnect)},late:{attempts:rooms*latePerRoom,rejected:rooms*latePerRoom},ledger:stats,metrics:metrics.finish(),scope:'Local workerd and real SQLite/signature-free demo sessions. Five separate rounds; NOT one shared round or hosted/cloud/real-asset throughput. Other local development workloads may contend. Full source hashes and bounded resources retained; no production cap changes.'};
}catch(e){report={status:'TARGET_NOT_MET',startedAt:started,finishedAt:new Date().toISOString(),error:e.message,hardware:hardware(),sourceHashes:before,metrics:metrics.finish(),clientsConnected:h.clients.filter(c=>c.balance!==null).length,acceptedPerRoom:groups.map(g=>g.filter(c=>c.command&&c.tickets.has(c.command.id)).length),errorCodes:[...new Set(h.clients.flatMap(c=>c.errors))],scope:'Failed bounded local target retained; no throughput claim.'};process.exitCode=1;console.error(runtime.logs().slice(-1200));}
finally{clearTimeout(bound);await h.close();await runtime.close();await writeEvidence('contact-rooms',report);}
