/** Local workerd + local cryptographically signed Auth/DB fixture.
 * Never contacts Supabase/cloud accounts; not a hosted latency/capacity claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const folder=resolve(root,'.tooling/realtime-integration');await mkdir(folder,{recursive:true});
const port=18879,authPort=18880,base=`http://127.0.0.1:${port}`,authBase=`http://127.0.0.1:${authPort}`;
const user='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',wallet='11111111111111111111111111111111',secret='local-fixture-only-publisher-key-00000000';
const {privateKey,publicKey}=await generateKeyPair('ES256');const jwk={...await exportJWK(publicKey),kid:'fixture',use:'sig',alg:'ES256'};
const token=async(exp=300)=>new SignJWT({session_id:session,role:'authenticated',user_metadata:{wallet:'forged-ignored'}}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setSubject(user).setIssuer(`${authBase}/auth/v1`).setAudience('authenticated').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+exp).sign(privateKey);
let history=[],revoked=false,holdSnapshot=false,heldSnapshotStarted=false,releaseSnapshot;const requests={jwks:0,user:0,session:0,snapshot:0};
const auth=createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;res.setHeader('Content-Type','application/json');const send=x=>res.end(JSON.stringify(x));
 if(req.url==='/auth/v1/.well-known/jwks.json'){requests.jwks++;return send({keys:[jwk]});}
 if(req.url==='/auth/v1/user'){requests.user++;return send({id:user});}
 if(req.url==='/rest/v1/rpc/verify_chat_session'){requests.session++;if(revoked){res.statusCode=403;return send({message:'AUTH_INVALID'});}return send({wallet});}
 if(req.url==='/rest/v1/rpc/chat_snapshot'){requests.snapshot++;const after=JSON.parse(body).p_after;const captured={v:1,type:'snapshot',stream:'lobby',seq:history.at(-1)?.seq??0,events:history.filter(e=>e.seq>after).slice(-100),truncated:after===0};if(holdSnapshot){holdSnapshot=false;heldSnapshotStarted=true;await new Promise(r=>{releaseSnapshot=r;});}return send(captured);}
 if(req.url==='/rest/v1/rpc/platform_status')return send({indexFresh:true,lastIndexedSlot:123,chatMinWagerLamports:'10000000'});
 if(req.url==='/rest/v1/rpc/submit_chat'){res.statusCode=403;return send({message:'CHAT_INELIGIBLE'});}
 res.statusCode=404;send({});
});await new Promise(r=>auth.listen(authPort,'127.0.0.1',r));
const config={name:'sollish-realtime-local-test',main:resolve(root,'apps/realtime/src/index.ts'),compatibility_date:'2026-10-01',compatibility_flags:['nodejs_compat'],vars:{SUPABASE_URL:authBase,SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',PUBLISH_SIGNING_KEY:secret,ALLOW_LOCAL_AUTH:'true',ALLOWED_ORIGINS:'http://localhost:3000',FANOUT_BUCKETS:'8'},durable_objects:{bindings:[{name:'ROOMS',class_name:'RoomCoordinator'},{name:'BUCKETS',class_name:'FanoutBucket'},{name:'ADMISSION',class_name:'AdmissionGate'}]},migrations:[{tag:'v1',new_sqlite_classes:['RoomCoordinator','FanoutBucket','AdmissionGate']}]};
await writeFile(resolve(folder,'wrangler.json'),JSON.stringify(config,null,2));await rm(resolve(folder,'state'),{recursive:true,force:true});
let logs='';const child=spawn('pnpm',['exec','wrangler','dev','--config',resolve(folder,'wrangler.json'),'--port',String(port),'--ip','127.0.0.1','--persist-to',resolve(folder,'state'),'--show-interactive-dev-session=false'],{cwd:resolve(root,'apps/realtime'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',b=>{logs=(logs+b).slice(-30000);});child.stderr.on('data',b=>{logs=(logs+b).slice(-30000);});
const wait=ms=>new Promise(r=>setTimeout(r,ms));const sockets=[];let checks=0;
const until=async(fn,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await wait(20);}throw new Error('LOCAL_TEST_TIMEOUT');};
function connect(index,accessToken,after=0){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(`ws://127.0.0.1:${port}/v1/rooms/lobby?after=${after}`,{headers:{Origin:'http://localhost:3000','CF-Connecting-IP':`198.18.${Math.floor(index/250)}.${index%250+1}`}});const frames=[];const timer=setTimeout(()=>reject(new Error(`SOCKET_AUTH_TIMEOUT_${index}`)),15000);sockets.push(ws);
 ws.addEventListener('close',e=>frames.push({type:'close',code:e.code,reason:e.reason}));
 ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error(`SOCKET_CONNECT_FAILED_${index}`));});
 ws.addEventListener('message',e=>{const frame=JSON.parse(String(e.data));frames.push({...frame,received:performance.now()});if(frame.type==='auth.required')ws.send(JSON.stringify({v:1,type:'auth',access_token:accessToken}));if(frame.type==='snapshot'){clearTimeout(timer);resolve({ws,frames});}if(frame.type==='error'&&frames.every(f=>f.type!=='hello')){clearTimeout(timer);reject(new Error(frame.code));}});
 });}
function event(seq){const now=new Date().toISOString();return {v:1,stream:'lobby',id:randomUUID(),seq,occurredAt:now,kind:'chat.message',payload:{id:randomUUID(),wallet,body:`load fixture ${seq}`,createdAt:now}};}
async function publish(e,valid=true){const body=JSON.stringify(e),stamp=Date.now(),id=randomUUID();const mac=createHmac('sha256',secret).update(`POST\n/internal/publish\n${stamp}\n${id}\n${createHash('sha256').update(body).digest('hex')}`).digest('hex');return fetch(`${base}/internal/publish`,{method:'POST',headers:{'x-sollish-timestamp':String(stamp),'x-sollish-request-id':id,'x-sollish-signature':valid?mac:'0'.repeat(64)},body});}
try{
 await until(async()=>{try{return(await fetch(`${base}/health`)).ok;}catch{return false;}},30000);
 assert.equal((await fetch(`${base}/v1/public/status`,{headers:{Origin:'https://evil.invalid'}})).status,403);checks++;
 const jwt=await token();const parts=jwt.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);await assert.rejects(connect(6000,parts.join('.')),/AUTH_INVALID/);checks++;await assert.rejects(connect(6001,await token(-1)),/AUTH_INVALID/);checks++;
 const count=Number(process.env.SPECTATORS??1000);assert.ok(Number.isInteger(count)&&count>=1&&count<=5000);
 const clients=[],start=performance.now();for(let i=0;i<count;i+=20){clients.push(...await Promise.all(Array.from({length:Math.min(20,count-i)},(_,j)=>connect(i+j,jwt))));}
 const authMs=performance.now()-start;assert.equal(clients.length,count);checks++;
 const first=event(1);assert.equal((await publish(first,false)).status,403);checks++;
 history.push(first);const sent=performance.now();assert.equal((await publish(first)).status,200);await until(()=>clients.every(c=>c.frames.some(f=>f.type==='event'&&f.event.seq===1)),30000);checks++;
 const latencies=clients.map(c=>c.frames.find(f=>f.type==='event'&&f.event.seq===1).received-sent).sort((a,b)=>a-b);
 assert.equal((await publish(first)).status,200);await wait(100);assert.ok(clients.every(c=>c.frames.filter(f=>f.type==='event'&&f.event.seq===1).length===1));checks++;
 clients[0].ws.send(JSON.stringify({v:1,type:'chat.send',client_id:randomUUID(),body:'cannot invent eligibility'}));await until(()=>clients[0].frames.some(f=>f.code==='CHAT_INELIGIBLE'));checks++;
 clients[1].ws.send('x'.repeat(10241));await until(()=>clients[1].frames.some(f=>f.type==='close'&&f.code===1009));checks++;
 for(let i=0;i<41;i++)clients[2].ws.send(JSON.stringify({v:1,type:'ping'}));await until(()=>clients[2].frames.some(f=>f.type==='close'&&f.code===1008));checks++;
 const second=event(2);history.push(second);await publish(second);await until(()=>clients[3].frames.some(f=>f.type==='event'&&f.event.seq===2));clients[3].ws.close();
 const reconnected=await connect(count+10,jwt,1);assert.deepEqual(reconnected.frames.find(f=>f.type==='snapshot').events.map(e=>e.seq),[2]);checks++;
 const expires=await connect(count+11,await token(2),2);await until(()=>expires.ws.readyState===WebSocket.CLOSED,6000);checks++;
 revoked=true;reconnected.ws.send(JSON.stringify({v:1,type:'resume',after:2}));await until(()=>reconnected.frames.some(f=>f.code==='AUTH_INVALID'));revoked=false;checks++;
 holdSnapshot=true;const syncConnection=connect(count+12,jwt,2);await until(()=>heldSnapshotStarted);const third=event(3);history.push(third);const inFlightPublish=publish(third);await wait(100);releaseSnapshot();const synchronized=await syncConnection;assert.equal((await inFlightPublish).status,200);await until(()=>synchronized.frames.some(f=>f.type==='event'&&f.event.seq===3));assert.ok(!synchronized.frames.some(f=>f.code==='REPLAY_REQUIRED'));checks++;
 const chunked=new ReadableStream({start(c){c.enqueue(new Uint8Array(6000));c.enqueue(new Uint8Array(6000));c.close();}});assert.equal((await fetch(`${base}/internal/publish`,{method:'POST',body:chunked,duplex:'half'})).status,413);checks++;
 const gap=event(5);history.push(gap);await publish(gap);await until(()=>clients[4].frames.some(f=>f.code==='REPLAY_REQUIRED'));checks++;
 const report={at:new Date().toISOString(),runtime:'local-workerd',node:process.version,auth:'local ES256 JWKS/Auth/DB fixture, no cloud connection',spectators:count,fanoutBuckets:8,authenticatedSockets:count,checks,authenticationBatchMs:Math.round(authMs),eventFanoutMs:{p50:Math.round(latencies[Math.floor(count*.5)]),p95:Math.round(latencies[Math.floor(count*.95)]),max:Math.round(latencies.at(-1))},authFixtureRequests:requests,scope:'one localhost host; synthetic public chat event; no financial transactions, hosted Supabase, production geography, reconnect storm or sustained load'};
 await mkdir(resolve(root,'apps/realtime/evidence'),{recursive:true});await writeFile(resolve(root,'apps/realtime/evidence/local-workerd.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error('Integration failed:',e.message);console.error(logs.slice(-6000));process.exitCode=1;}finally{for(const ws of sockets){try{ws.close();}catch{}}child.kill('SIGTERM');auth.closeAllConnections();await new Promise(r=>auth.close(r));await wait(500);}
