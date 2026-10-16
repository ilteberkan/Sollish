import { DurableObject } from 'cloudflare:workers';
import { COMBAT_V3_VERSION, COMBAT_V4_VERSION, CONTACT_ENGINES, CONTACT_INITIAL, type ContactEngine, type ContactBout, COMBAT_VERSION, COMBAT_DURATION_MS, RINGSIDE_OPEN_MS, RINGSIDE_RESULT_MS, RINGSIDE_FEE_BPS, RINGSIDE_MARKETS, type RingMarketSpec, carryInitial, parseRingClient, simulateCombat, combatResults, ringCommitmentInput, settlePariMutuelPool, type RingRound, type RingTicket, type RingPool, type RingSnapshot, type RingServer, type RingMarket, type RingTapeEntry } from '@sollish/protocol';
import { allowedOrigin } from './security';
import { RELAY_AUDIENCE_MS, RelayPublisher, type RelayArena, type RelayEnv } from './arena-relay';
interface Env extends RelayEnv { ALLOWED_ORIGINS?:string; LIVE_ARENA_ENABLED?:string }
type Attachment = { session:string|null; at:number; window:number; count:number };
type Session = { id:string; alias:string; balance:number; expires:number };
type Ticket = { seq:number; session:string; client:string; round:string; market:RingMarket; outcome:string; amount:number; status:RingTicket['status']; payout:number; accepted:number; alias:string };
export type StoredRound = { public:RingRound; secretSeed:string; matchSeeds?:string[] };
const hex=(b:Uint8Array)=>[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async(s:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const receipt=(t:Ticket):RingTicket=>({id:t.client,roundId:t.round,market:t.market,outcome:t.outcome,amount:t.amount,status:t.status,payout:t.payout});
const tapeEntry=(t:Ticket):RingTapeEntry=>({seq:t.seq,alias:t.alias,market:t.market,outcome:t.outcome,amount:t.amount,acceptedAt:t.accepted,status:t.status,payout:t.payout});
class Rejected extends Error { constructor(readonly code:string){super(code);} }
const fail=(code:string):never=>{throw new Rejected(code);};
/** V2 is a separate valueless ledger: existing V1 tickets keep their original settlement rules.
 * A single SQLite writer commits tickets, balances, pool receipts and results before publishing.
 * Remote AI, browsers and betting exposure cannot supply/change the simulation outcome.
 */
export class RingsideArena extends DurableObject<Env> {
 protected contactVersion=false;
 protected contactEngine:ContactEngine=COMBAT_V3_VERSION;
 /** Hooks for engines with a public decision log (Contact 5). Defaults keep v2-v4 behaviour unchanged. */
 protected fightLeadMs=0;
 protected replayOf(saved:StoredRound){return CONTACT_ENGINES[this.contactEngine].simulate(saved.secretSeed,saved.public.bout!.initial);}
 protected roundExtras():Partial<RingRound>{return {};}
 protected beforeAdvance(saved:StoredRound,_now:number):StoredRound{return saved;}
 protected extraAlarm(_r:RingRound,_now:number):number{return Infinity;}
 /** Ledger hooks. Defaults: one set of pools per round, open only in its own window, settled at round end. */
 protected markets():readonly RingMarketSpec[]{return RINGSIDE_MARKETS;}
 protected ledgerOf(r:RingRound):string{return r.id;}
 protected bettingOpen(r:RingRound):boolean{return r.phase==='open';}
 protected openWindowMs(_bout:ContactBout|undefined):number{return RINGSIDE_OPEN_MS;}
 protected async openRound(_previous:StoredRound|null,_bout:ContactBout|undefined,_id:string,_now:number):Promise<{seed:string;matchSeeds?:string[];extras:Partial<RingRound>}>{return {seed:hex(crypto.getRandomValues(new Uint8Array(32))),extras:{}};}
 /** Returns the outcome every pool settles on now, or null when this round does not settle the ledger. */
 protected settlement(_saved:StoredRound,results:Record<string,string>,_replay:unknown):{results:Record<string,string>;extras:Partial<RingRound>}|null{return {results,extras:{}};}
 private queue:Promise<unknown>=Promise.resolve();
 /** Viewer relays (arena-relay.ts). null = this arena publishes to none (v2-v4). Presentation only, never the ledger. */
 protected relayArena():RelayArena|null{return null;}
 private relayPublisher:RelayPublisher|null|undefined;
 /** Until when a relay heartbeat counts as an audience for opening the next round (memory; relays repeat every 30 s). */
 private watchersUntil=0;
 private relays():RelayPublisher|null{if(this.relayPublisher===undefined){const a=this.relayArena();this.relayPublisher=a?new RelayPublisher(a,this.env):null;}return this.relayPublisher;}
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ring_round (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ring_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)');
  ctx.storage.sql.exec('INSERT OR IGNORE INTO ring_meta VALUES(1,0)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ring_sessions (id TEXT PRIMARY KEY, alias TEXT UNIQUE NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0), expires INTEGER NOT NULL)');
  ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS ring_tickets (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, client TEXT NOT NULL, round TEXT NOT NULL, market TEXT NOT NULL, outcome TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), status TEXT NOT NULL, payout INTEGER NOT NULL CHECK(payout>=0), accepted INTEGER NOT NULL, alias TEXT NOT NULL, UNIQUE(session,client), UNIQUE(session,round,market))");
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS ring_tickets_round ON ring_tickets(round)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ring_fees (round TEXT NOT NULL, market TEXT NOT NULL, fee INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(round,market))');
 }
 protected exclusive<T>(f:()=>Promise<T>):Promise<T>{const p=this.queue.then(f);this.queue=p.catch(()=>undefined);return p;}
 private q<T extends Record<string,SqlStorageValue>>(sql:string,...args:SqlStorageValue[]):T[]{return this.ctx.storage.sql.exec<T>(sql,...args).toArray();}
 protected current():StoredRound|null{const r=this.q<{body:string}>('SELECT body FROM ring_round WHERE id=1')[0];return r?JSON.parse(r.body):null;}
 protected save(r:StoredRound){this.ctx.storage.sql.exec('INSERT INTO ring_round VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',JSON.stringify(r));}
 protected sockets(){return this.ctx.getWebSockets().filter(w=>w.readyState===WebSocket.OPEN);}
 private att(w:WebSocket){return w.deserializeAttachment() as Attachment;}
 private session(id:string){return this.q<Session>('SELECT * FROM ring_sessions WHERE id=?',id)[0];}
 private send(w:WebSocket,f:RingServer){try{w.send(JSON.stringify(f));}catch{try{w.close(1011,'CONNECTION_CLOSED');}catch{}}}
 private private(w:WebSocket,token?:string){const id=this.att(w).session;if(!id)return;const s=this.session(id);if(!s)return;this.send(w,{v:2,type:'session',...(token?{token}:{}),balance:s.balance,expires:s.expires,tickets:this.q<Ticket>('SELECT * FROM ring_tickets WHERE session=? ORDER BY seq DESC LIMIT 16',id).map(receipt)});}
 private snapshot(now:number):RingSnapshot {
  const round=this.current()!.public,ledger=this.ledgerOf(round),tickets=this.q<Ticket>('SELECT * FROM ring_tickets WHERE round=? ORDER BY seq DESC',ledger);
  const pools:RingPool[]=this.markets().map(m=>{
   const list=tickets.filter(t=>t.market===m.id), sides:Record<string,number>=Object.fromEntries(m.outcomes.map(o=>[o,0]));for(const t of list)sides[t.outcome]+=t.amount;
   const settlement=this.q<{fee:number;status:'paid'|'refunded'}>('SELECT fee,status FROM ring_fees WHERE round=? AND market=?',ledger,m.id)[0];
   return {market:m.id,total:list.reduce((s,t)=>s+t.amount,0),count:list.length,sides,fee:settlement?.fee??0,distributed:settlement?list.reduce((s,t)=>s+t.payout,0):0,status:settlement?.status??(this.bettingOpen(round)?'open':'locked')};
  });
  const online=new Set(this.sockets().map(w=>this.att(w).session).filter((id):id is string=>!!id&&!!this.session(id)&&this.session(id).expires>now)).size;
  return {v:2,type:'snapshot',revision:this.q<{revision:number}>('SELECT revision FROM ring_meta WHERE id=1')[0].revision,at:now,round,online,participants:new Set(tickets.map(t=>t.session)).size,total:tickets.reduce((s,t)=>s+t.amount,0),count:tickets.length,pools,tape:tickets.slice(0,30).map(tapeEntry)};
 }
 protected async broadcast(now:number,changed:Set<string>=new Set()){
  this.ctx.storage.sql.exec('UPDATE ring_meta SET revision=revision+1 WHERE id=1');await this.ctx.storage.sync();
  const state=this.snapshot(now);for(const w of this.sockets()){this.send(w,state);const id=this.att(w).session;if(id&&changed.has(id))this.private(w);}
  this.relays()?.publish(JSON.stringify(state));
 }
 private async open(previous:StoredRound|null,now:number){
  const id=String(Number(previous?.public.id??0)+1);
  let bout:ContactBout|undefined;
  if(this.contactVersion){
   const prev=previous?.public,old=prev?.bout;
   if(old&&old.round<3&&prev.results?.finish!=='stoppage'){
    const replay=this.replayOf(previous!),last=replay.frames.at(-1)!;
    bout={id:old.id,round:(old.round+1) as 2|3,score:{kor:old.score.kor+(replay.winner==='kor'?1:0),ayaz:old.score.ayaz+(replay.winner==='ayaz'?1:0)},initial:carryInitial(last)};
   }else bout={id,round:1,score:{kor:0,ayaz:0},initial:structuredClone(CONTACT_INITIAL)};
  }
  const {seed,matchSeeds,extras}=await this.openRound(previous,bout,id,now);
  const commitment=await digest(bout?CONTACT_ENGINES[this.contactEngine].commitment(id,seed,bout):ringCommitmentInput(id,seed));
  const value:StoredRound={secretSeed:seed,...(matchSeeds?{matchSeeds}:{}),public:{id,phase:'open',openedAt:now,closesAt:now+this.openWindowMs(bout),startsAt:null,endsAt:null,nextAt:null,commitment,seed:null,engine:this.contactVersion?this.contactEngine:COMBAT_VERSION,...(bout?{bout}:{}),...this.roundExtras(),...extras,results:null}};
  this.save(value);await this.ctx.storage.sync();return value;
 }
 protected async schedule(now:number){const r=this.current()?.public;if(!r)return;let next=r.phase==='open'?r.closesAt:r.phase==='fighting'?Math.min(r.endsAt!,this.extraAlarm(r,now)):this.sockets().length?r.nextAt!:Infinity;
  for(const w of this.sockets()){const a=this.att(w);next=Math.min(next,a.session?(this.session(a.session)?.expires??now):a.at+10_000);}
  if(next===Infinity)await this.ctx.storage.deleteAlarm();else await this.ctx.storage.setAlarm(Math.max(now+1,next));
 }
 private async advance(now:number,connection=false){
  let saved=this.current(),changed=false;const affected=new Set<string>();
  if(!saved){saved=await this.open(null,now);changed=true;}
  let r=saved.public;
  if(r.engine!==(this.contactVersion?this.contactEngine:COMBAT_VERSION))fail('SERVICE_UNAVAILABLE');
  const duration=this.contactVersion?CONTACT_ENGINES[this.contactEngine].durationMs:COMBAT_DURATION_MS;
  if(r.phase==='open'&&now>=r.closesAt){
   // The seed already has a persisted public commitment; reveal only after server cutoff.
   const start=now+this.fightLeadMs;r={...r,phase:'fighting',startsAt:start,endsAt:start+duration,nextAt:start+duration+RINGSIDE_RESULT_MS,seed:saved.secretSeed};saved={...saved,public:r};this.save(saved);await this.ctx.storage.sync();changed=true;
  }
  if(r.phase==='fighting'){const next=this.beforeAdvance(saved,now);if(next!==saved){saved=next;r=saved.public;this.save(saved);await this.ctx.storage.sync();changed=true;}}
  if(r.phase==='fighting'&&now>=r.endsAt!){
   const replay=this.contactVersion?this.replayOf(saved):simulateCombat(saved.secretSeed),results=combatResults(replay),settle=this.settlement(saved,results,replay),ledger=this.ledgerOf(r);
   this.ctx.storage.transactionSync(()=>{
    const all=settle?this.q<Ticket>('SELECT * FROM ring_tickets WHERE round=? ORDER BY seq',ledger):[];if(all.length>256||all.some(t=>t.status!=='accepted'))fail('SERVICE_UNAVAILABLE');
    if(settle)for(const m of this.markets()){
     const list=all.filter(t=>t.market===m.id),settled=settlePariMutuelPool({poolId:`${ledger}:${m.id}`,outcomes:[...m.outcomes],feeBps:BigInt(RINGSIDE_FEE_BPS),escrowAmount:BigInt(list.reduce((s,t)=>s+t.amount,0)),tickets:list.map(t=>({ticketId:String(t.seq).padStart(16,'0'),outcome:t.outcome,stake:BigInt(t.amount)})),winningOutcome:settle.results[m.id]!});
     for(const t of list){const p=settled.payouts.find(p=>p.ticketId===String(t.seq).padStart(16,'0'));if(!p)fail('SERVICE_UNAVAILABLE');const s=this.session(t.session);if(!s)fail('SERVICE_UNAVAILABLE');const balance=s.balance+Number(p!.payout);if(!Number.isSafeInteger(balance))fail('SERVICE_UNAVAILABLE');
      this.ctx.storage.sql.exec('UPDATE ring_sessions SET balance=? WHERE id=?',balance,t.session);this.ctx.storage.sql.exec("UPDATE ring_tickets SET status=?,payout=? WHERE seq=? AND status='accepted'",settled.status,Number(p!.payout),t.seq);affected.add(t.session);}
     this.ctx.storage.sql.exec('INSERT INTO ring_fees VALUES(?,?,?,?)',ledger,m.id,Number(settled.platformFee),settled.status);
    }
    r={...r,phase:'result',results,...settle?.extras};saved={...saved!,public:r};this.save(saved);
   });await this.ctx.storage.sync();changed=true;
  }
  if(r.phase==='result'&&now>=r.nextAt!&&(connection||this.sockets().length||now<this.watchersUntil)){saved=await this.open(saved,now);r=saved.public;changed=true;}
  // Current-round records remain intact for public totals even after the session expires.
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec("DELETE FROM ring_tickets WHERE round<>? AND status<>'accepted' AND session IN(SELECT id FROM ring_sessions WHERE expires<=?)",this.ledgerOf(r),now);
   this.ctx.storage.sql.exec('DELETE FROM ring_sessions WHERE expires<=? AND NOT EXISTS(SELECT 1 FROM ring_tickets t WHERE t.session=ring_sessions.id)',now);
   this.ctx.storage.sql.exec('DELETE FROM ring_fees WHERE CAST(round AS INTEGER)<?',Math.max(0,Number(r.id)-100));
  });
  if(changed)await this.broadcast(now,affected);await this.schedule(now);
 }
 fetch(request:Request):Promise<Response>{return this.exclusive(async()=>{
  if(this.env.LIVE_ARENA_ENABLED!=='true')return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});
  // Internal only (the router forwards public requests as /connect): a relay's heartbeat + latest public snapshot.
  if(new URL(request.url).pathname==='/relay/sync'&&request.method==='POST'&&this.relayArena()){const now=Date.now();this.watchersUntil=now+RELAY_AUDIENCE_MS;try{await this.advance(now,true);await this.schedule(now);return new Response(JSON.stringify(this.snapshot(now)),{headers:{'Content-Type':'application/json'}});}catch{return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});}}
  if(!allowedOrigin(request.headers.get('Origin'),this.env))return Response.json({code:'FORBIDDEN'},{status:403});
  if(request.method!=='GET'||new URL(request.url).search||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return Response.json({code:'INVALID_MESSAGE'},{status:400});
  if(this.sockets().length>=256)return Response.json({code:'CAPACITY'},{status:503});
  try{const now=Date.now();await this.advance(now,true);const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({session:null,at:now,window:now,count:0} satisfies Attachment);this.send(pair[1],this.snapshot(now));await this.schedule(now);return new Response(null,{status:101,webSocket:pair[0]});}catch{return Response.json({code:'SERVICE_UNAVAILABLE'},{status:503});}
 });}
 webSocketMessage(w:WebSocket,raw:string|ArrayBuffer):Promise<void>{return this.exclusive(async()=>{
  try{if(w.readyState!==WebSocket.OPEN)return;const now=Date.now(),a=this.att(w);if(typeof raw!=='string'||new TextEncoder().encode(raw).length>2048){w.close(1009,'MESSAGE_TOO_LARGE');return;}
   if(!a.session&&now>=a.at+10_000){w.close(1008,'SESSION_EXPIRED');return;}if(now-a.window>=60_000){a.window=now;a.count=0;}a.count++;w.serializeAttachment(a);if(a.count>40){w.close(1008,'RATE_LIMITED');return;}
   const f=parseRingClient(raw);if(!f)fail('INVALID_MESSAGE');await this.advance(now);
   if(f!.type==='session'){
    if(a.session)fail('INVALID_MESSAGE');const token=f!.token??hex(crypto.getRandomValues(new Uint8Array(32))),id=await digest(token);let s=this.session(id);
    if(f!.token&&!s)fail('SESSION_INVALID');if(s&&now>=s.expires)fail('SESSION_EXPIRED');if(this.sockets().filter(w=>this.att(w).session===id).length>=3)fail('CAPACITY');
    if(!s){if(this.q<{n:number}>('SELECT COUNT(*) AS n FROM ring_sessions')[0].n>=512)fail('CAPACITY');this.ctx.storage.sql.exec('INSERT INTO ring_sessions VALUES(?,?,?,?)',id,'S-'+hex(crypto.getRandomValues(new Uint8Array(6))).toUpperCase(),100_000,now+3_600_000);await this.ctx.storage.sync();s=this.session(id);}
    a.session=id;w.serializeAttachment(a);this.private(w,f!.token?undefined:token);await this.broadcast(now);await this.schedule(now);return;
   }
   if(!a.session)fail('SESSION_REQUIRED');const s=this.session(a.session!);if(!s)fail('SESSION_INVALID');if(now>=s.expires)fail('SESSION_EXPIRED');
   if(f!.type==='sync'){this.private(w);this.send(w,this.snapshot(now));return;}
   if(f!.type==='audit'){if(f!.roundId!==this.ledgerOf(this.current()!.public))fail('WRONG_ROUND');this.send(w,{v:2,type:'audit',roundId:f!.roundId,entries:this.q<Ticket>('SELECT * FROM ring_tickets WHERE round=? ORDER BY seq DESC',f!.roundId).map(tapeEntry)});return;}
   if(f!.type!=='bet')return;const bet=f!;
   let t:Ticket|undefined,duplicate=false;
   this.ctx.storage.transactionSync(()=>{
    t=this.q<Ticket>('SELECT * FROM ring_tickets WHERE session=? AND client=?',s.id,bet.id)[0];
    if(t){if(t.round!==bet.roundId||t.market!==bet.market||t.outcome!==bet.outcome||t.amount!==bet.amount)fail('TICKET_CONFLICT');duplicate=true;return;}
    const r=this.current()!.public,ledger=this.ledgerOf(r),accepted=Date.now();if(accepted>=s.expires)fail('SESSION_EXPIRED');if(!this.markets().some(m=>m.id===bet.market))fail('INVALID_MESSAGE');if(ledger!==bet.roundId)fail('WRONG_ROUND');if(!this.bettingOpen(r)||accepted<r.openedAt||accepted>=r.closesAt)fail('ROUND_CLOSED');
    if(this.q<Ticket>('SELECT * FROM ring_tickets WHERE session=? AND round=? AND market=?',s.id,ledger,bet.market).length)fail('ALREADY_BET');
    if(this.q<{n:number}>('SELECT COUNT(*) AS n FROM ring_tickets WHERE session=?',s.id)[0].n>=256||this.q<{n:number}>('SELECT COUNT(*) AS n FROM ring_tickets WHERE round=?',ledger)[0].n>=256)fail('CAPACITY');
    if(s.balance<bet.amount)fail('INSUFFICIENT_CREDITS');
    this.ctx.storage.sql.exec("INSERT INTO ring_tickets(session,client,round,market,outcome,amount,status,payout,accepted,alias) VALUES(?,?,?,?,?,?,'accepted',0,?,?)",s.id,bet.id,ledger,bet.market,bet.outcome,bet.amount,accepted,s.alias);
    this.ctx.storage.sql.exec('UPDATE ring_sessions SET balance=balance-? WHERE id=?',bet.amount,s.id);t=this.q<Ticket>('SELECT * FROM ring_tickets WHERE session=? AND client=?',s.id,bet.id)[0];
   });await this.ctx.storage.sync();this.send(w,{v:2,type:'ticket',ticket:receipt(t!)});if(duplicate)this.private(w);else await this.broadcast(Date.now(),new Set([s.id]));
  }catch(e){this.send(w,{v:2,type:'error',code:e instanceof Rejected?e.code:'SERVICE_UNAVAILABLE'});}
 });}
 webSocketClose(w:WebSocket):Promise<void>{return this.exclusive(async()=>{try{w.close(1000,'CLOSED');}catch{}await this.broadcast(Date.now());await this.schedule(Date.now());});}
 webSocketError(w:WebSocket):Promise<void>{return this.webSocketClose(w);}
 alarm():Promise<void>{return this.exclusive(async()=>{const now=Date.now();for(const w of this.sockets()){const a=this.att(w),deadline=a.session?(this.session(a.session)?.expires??now):a.at+10_000;if(now>=deadline)w.close(1008,'SESSION_EXPIRED');}await this.advance(now);});}
}

/** Independent namespace/storage. Existing V2 ledgers are never migrated. */
export class ContactArena extends RingsideArena { protected override contactVersion=true; }
/** Contact 4 (combinations, counts) in its own namespace and SQLite storage; Contact 3 tickets stay on ContactArena. */
export class ContactArenaV4 extends RingsideArena { protected override contactVersion=true; protected override contactEngine:ContactEngine=COMBAT_V4_VERSION; }
