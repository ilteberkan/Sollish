/** Local-only workerd harness. Never accepts a remote destination or mutates production data. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseRingServer } from '../../packages/protocol/src/ringside.ts';
export const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const origin='http://localhost:3000';
export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export async function until(fn,ms=30000,label='CONDITION'){const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await wait(20);}throw new Error(`TIMEOUT_${label}`);}
export const digest=x=>createHash('sha256').update(x).digest('hex');
export const quantiles=values=>{const a=[...values].sort((a,b)=>a-b);return Object.fromEntries([['p50',.5],['p95',.95],['p99',.99],['max',1]].map(([k,q])=>[k,a.length?Math.round(a[Math.ceil(a.length*q)-1]):null]));};
export async function sourceHashes(extra=[]){const paths=['apps/realtime/src/ringside-arena.ts','packages/protocol/src/ringside.ts','packages/protocol/src/combat-v3.ts','packages/protocol/src/connectome-policy.ts','packages/protocol/src/pari-mutuel.ts','pnpm-lock.yaml','experiments/load/runtime.mjs',...extra];return Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile(resolve(root,p)))])));}
export const statsSubclass=`export class MeasuredArena extends ContactArena {
 async fetch(r:Request):Promise<Response>{if(new URL(r.url).pathname==='/stats')return Response.json({
 sessions:this.ctx.storage.sql.exec('SELECT COUNT(*) AS n,COALESCE(SUM(balance),0) AS balance FROM ring_sessions').one(),
 tickets:this.ctx.storage.sql.exec("SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS stakes,COALESCE(SUM(payout),0) AS payouts,COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS pending FROM ring_tickets").one(),
 pools:this.ctx.storage.sql.exec("SELECT t.round,t.market,COUNT(*) AS n,SUM(t.amount) AS stakes,SUM(t.payout) AS payouts,MAX(f.fee) AS fee FROM ring_tickets t LEFT JOIN ring_fees f ON t.round=f.round AND t.market=f.market GROUP BY t.round,t.market").toArray(),
 fees:this.ctx.storage.sql.exec('SELECT COALESCE(SUM(fee),0) AS total FROM ring_fees').one()
 });return super.fetch(r);}
}`;
export async function startRuntime(name,port,entry,bindings,classes){
 assert.match(name,/^[a-z-]+$/);assert.ok(port>=18889&&port<=18899);
 const base=`http://127.0.0.1:${port}`,folder=resolve(root,'.tooling/load',`${name}-${Date.now()}`);
 // Refuse an occupied port; never stop another task's service.
 try{await fetch(`${base}/ready`,{signal:AbortSignal.timeout(500)});throw new Error('LOAD_PORT_IN_USE');}catch(e){if(e.message==='LOAD_PORT_IN_USE')throw e;}
 await mkdir(folder,{recursive:true});await writeFile(resolve(folder,'entry.ts'),entry);
 await writeFile(resolve(folder,'wrangler.json'),JSON.stringify({name:`sollish-local-${name}`,main:resolve(folder,'entry.ts'),compatibility_date:'2026-10-01',compatibility_flags:['nodejs_compat'],vars:{ALLOWED_ORIGINS:origin,LIVE_ARENA_ENABLED:'true'},durable_objects:{bindings},migrations:[{tag:'v1',new_sqlite_classes:classes}]}));
 const child=spawn('pnpm',['exec','wrangler','dev','--config',resolve(folder,'wrangler.json'),'--port',String(port),'--ip','127.0.0.1','--persist-to',resolve(folder,'state'),'--show-interactive-dev-session=false'],{cwd:resolve(root,'apps/realtime'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 let logs='';for(const s of[child.stdout,child.stderr])s.on('data',b=>{logs=(logs+b).slice(-16000);});
 const close=async()=>{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),wait(5000)]);await until(async()=>{try{await fetch(`${base}/ready`,{signal:AbortSignal.timeout(500)});return false;}catch{return true;}},10000,'OWN_RUNTIME_EXIT');await rm(resolve(folder,'state'),{recursive:true,force:true});};
 try{await until(async()=>{try{return(await fetch(`${base}/ready`)).ok;}catch{return false;}},30000,'RUNTIME_READY');}catch(e){console.error(logs);await close();throw e;}
 return {base,port,child,folder,logs:()=>logs,close,entryHash:digest(entry)};
}
export function measurement(runtime){
 const lag=monitorEventLoopDelay({resolution:20});lag.enable();const start=process.cpuUsage();
 const m={frames:0,bytes:0,invalidFrames:0,unexpectedClose:0,peakClientRss:0,peakRuntimeTreeRss:0,guard:null};
 function sample(){m.peakClientRss=Math.max(m.peakClientRss,process.memoryUsage().rss);try{const rows=execFileSync('ps',['-Ao','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));const ids=new Set([runtime.child.pid]);for(let i=0;i<5;i++)for(const [pid,parent]of rows)if(ids.has(parent))ids.add(pid);m.peakRuntimeTreeRss=Math.max(m.peakRuntimeTreeRss,rows.filter(r=>ids.has(r[0])).reduce((s,r)=>s+r[2]*1024,0));}catch{}if(m.peakClientRss+m.peakRuntimeTreeRss>3*1024**3||m.bytes>4*1024**3||m.frames>1_000_000)m.guard='RESOURCE_BOUND';}
 sample();const timer=setInterval(sample,2000);timer.unref();
 return {data:m,finish(){clearInterval(timer);sample();lag.disable();return {...m,clientEventLoopDelayMs:{p95:Math.round(lag.percentile(95)/1e6),max:Math.round(lag.max/1e6)},clientCpuMs:Object.fromEntries(Object.entries(process.cpuUsage(start)).map(([k,v])=>[k,Math.round(v/1000)]))};}};
}
export const hardware=()=>({node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),wrangler:'4.145.0',runtime:'local workerd, real SQLite and WebSockets; shared development host'});
export function clientHarness(runtime,metrics){
 const clients=[],cache=new Map();const latency=[];
 async function connect(path,{token=null,spectator=false}={}){
  const ws=new WebSocket(`ws://127.0.0.1:${runtime.port}${path}`,{headers:{Origin:origin}});
  const c={ws,path,spectator,token,balance:null,tickets:new Map(),snapshot:null,settledSnapshot:null,errors:[],closed:false,expectedClose:false,sentAt:null,ackAt:null,command:null,settledAt:null,sessionStarted:false};clients.push(c);
  const ready=new Promise((res,rej)=>{const timer=setTimeout(()=>rej(new Error('SESSION_TIMEOUT')),30000);c.ready=()=>{clearTimeout(timer);res(c);};ws.addEventListener('error',()=>{clearTimeout(timer);rej(new Error('SOCKET_ERROR'));},{once:true});});
  ws.addEventListener('close',()=>{c.closed=true;if(!c.expectedClose)metrics.unexpectedClose++;});
  ws.addEventListener('message',e=>{
   const raw=String(e.data);metrics.frames++;metrics.bytes+=Buffer.byteLength(raw);let f=cache.get(raw);
   if(!f){f=parseRingServer(raw);if(!f){metrics.invalidFrames++;return;}if(f.type==='snapshot'){if(cache.size>2048)cache.clear();cache.set(raw,f);}}
   if(f.type==='snapshot'){
    if(c.snapshot&&f.revision<c.snapshot.revision)metrics.invalidFrames++;
    c.snapshot=f;if(f.round.phase==='result'&&(!c.command||c.command.roundId===f.round.id))c.settledSnapshot=f;
    if(spectator){latency.push(Math.max(0,Date.now()-f.at));if(latency.length>20000)latency.splice(0,10000);c.ready();}
    else if(!c.sessionStarted){c.sessionStarted=true;send(c,{type:'session',...(token?{token}:{})});}
   }
   if(f.type==='session'){
    if(spectator){metrics.invalidFrames++;return;}c.token=f.token??c.token;c.balance=f.balance;
    for(const t of f.tickets)record(c,t);c.ready();
   }
   if(f.type==='ticket')record(c,f.ticket);
   if(f.type==='error')c.errors.push(f.code);
  });return ready;
 }
 function record(c,t){c.tickets.set(t.id,t);if(c.command?.id===t.id){if(c.ackAt===null)c.ackAt=performance.now();if(t.status!=='accepted')c.settledAt=Date.now();}}
 function send(c,body){assert.equal(c.ws.readyState,WebSocket.OPEN);c.ws.send(JSON.stringify({v:2,...body}));}
 async function reconnect(c){const start=performance.now();c.expectedClose=true;c.ws.close();await until(()=>c.closed,10000,'SOCKET_CLOSED');const replacement=await connect(c.path,{token:c.token,spectator:c.spectator});replacement.command=c.command;replacement.sentAt=c.sentAt;replacement.ackAt=c.ackAt;if(c.command)send(replacement,c.command);replacement.reconnectMs=performance.now()-start;return replacement;}
 return {clients,connect,send,reconnect,latency,async close(){for(const c of clients){c.expectedClose=true;try{c.ws.close();}catch{}}await wait(100);}};
}
export async function writeEvidence(name,report){const folder=resolve(root,'experiments/load/evidence');await mkdir(folder,{recursive:true});await writeFile(resolve(folder,`${name}-latest.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
