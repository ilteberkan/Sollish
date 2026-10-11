/** EXPERIMENT ONLY. One unchanged ledger; read-only public snapshot fanout.
 * No public method can inject snapshots or place/settle a bet on behalf of a viewer.
 * Bindings below exist solely in the loopback load harness, not deployment config.
 */
import { DurableObject } from 'cloudflare:workers';
import { parseRingClient, parseRingServer } from '../../packages/protocol/src/ringside';
interface Env { ARENA:DurableObjectNamespace; RELAY:DurableObjectNamespace; FANOUT:DurableObjectNamespace }
const ORIGIN='http://localhost:3000';
export class PublicFanout extends DurableObject<Env> {
 private latest:string|null=null;
 private revision=-1;
 private at=0;
 private received=0;
 /** Binding RPC only; the HTTP router does not expose this method. */
 publish(raw:string):boolean {
  const frame=parseRingServer(raw);if(!frame||frame.type!=='snapshot')throw new Error('PUBLIC_SNAPSHOT_ONLY');
  if(frame.revision<this.revision||frame.at<this.at)return false;
  this.latest=raw;this.revision=frame.revision;this.at=frame.at;this.received=Date.now();
  for(const w of this.ctx.getWebSockets())try{w.send(raw);}catch{try{w.close(1011,'CLOSED');}catch{}}
  return true;
 }
 fetch(r:Request):Response {
  if(r.method!=='GET'||new URL(r.url).search||r.headers.get('Origin')!==ORIGIN||r.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('forbidden',{status:403});
  if(this.ctx.getWebSockets().filter(w=>w.readyState===WebSocket.OPEN).length>=256)return new Response('capacity',{status:503});
  if(!this.latest||Date.now()-this.received>15_000)return new Response('source unavailable',{status:503});
  const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({at:Date.now(),count:0});pair[1].send(this.latest);return new Response(null,{status:101,webSocket:pair[0]});
 }
 webSocketMessage(w:WebSocket,raw:string|ArrayBuffer):void {
  const a=w.deserializeAttachment() as {at:number;count:number};if(Date.now()-a.at>60_000){a.at=Date.now();a.count=0;}a.count++;w.serializeAttachment(a);
  if(a.count>20||typeof raw!=='string'||raw.length>2048){w.close(1008,'READ_ONLY_LIMIT');return;}
  const f=parseRingClient(raw);
  if(f?.type==='sync'&&this.latest&&Date.now()-this.received<=15_000)w.send(this.latest);
  else w.send(JSON.stringify({v:2,type:'error',code:'SESSION_REQUIRED'}));
 }
 webSocketClose(w:WebSocket):void {try{w.close(1000,'CLOSED');}catch{}}
}
export class SnapshotRelay extends DurableObject<Env> {
 private source:WebSocket|null=null;
 private starting:Promise<void>|null=null;
 private tail:Promise<void>=Promise.resolve();
 private sessionSent=false;
 async start():Promise<void>{
  if(this.starting)return this.starting;
  if(this.source?.readyState===WebSocket.OPEN)return;
  this.starting=this.open();try{await this.starting;}finally{this.starting=null;}
 }
 private async open():Promise<void>{
  const response=await this.env.ARENA.get(this.env.ARENA.idFromName('global')).fetch(new Request('https://internal/socket',{headers:{Origin:ORIGIN,Upgrade:'websocket'}}));
  const ws=response.webSocket;if(!ws)throw new Error('SOURCE_UNAVAILABLE');this.source=ws;this.sessionSent=false;ws.accept();
  await new Promise<void>((resolve,reject)=>{
   let ready=false;const timeout=setTimeout(()=>reject(new Error('SOURCE_TIMEOUT')),8000);
   ws.addEventListener('message',e=>{
    const raw=String(e.data),frame=parseRingServer(raw);if(!frame){reject(new Error('INVALID_SOURCE'));return;}
    // Private session balances/tokens and ticket receipts NEVER leave the relay.
    if(frame.type!=='snapshot')return;
    if(!this.sessionSent){this.sessionSent=true;ws.send(JSON.stringify({v:2,type:'session'}));}
    this.tail=this.tail.then(async()=>{await Promise.all(Array.from({length:4},(_,i)=>(this.env.FANOUT.get(this.env.FANOUT.idFromName('bucket-'+i)) as unknown as {publish(raw:string):Promise<boolean>}).publish(raw)));if(!ready){ready=true;clearTimeout(timeout);resolve();}}).catch(()=>{try{ws.close(1011,'FANOUT_FAILED');}catch{}reject(new Error('FANOUT_FAILED'));});
   });
   ws.addEventListener('close',()=>{this.source=null;clearTimeout(timeout);if(!ready)reject(new Error('SOURCE_CLOSED'));});
   ws.addEventListener('error',()=>{this.source=null;clearTimeout(timeout);if(!ready)reject(new Error('SOURCE_ERROR'));});
  });
  await this.ctx.storage.setAlarm(Date.now()+5000);
 }
 async alarm():Promise<void>{
  // A fresh public snapshot every 5 seconds makes source loss visibly unavailable.
  // No bets, retries, balance writes or financial acknowledgements originate here.
  if(this.source?.readyState===WebSocket.OPEN){this.source.send(JSON.stringify({v:2,type:'sync'}));await this.ctx.storage.setAlarm(Date.now()+5000);}
 }
}
