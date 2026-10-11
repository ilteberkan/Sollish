/** Isolated 4Hz snapshot/delta fanout experiment. Never imported by a deployed route. */
import { DurableObject } from 'cloudflare:workers';
import { parseRingServer,type RingSnapshot } from '../../packages/protocol/src/ringside';
import { applyPublicFrame,publicFrame,publicSnapshot,type PublicState } from './public-delta';
interface Env { ARENA:DurableObjectNamespace; RELAY:DurableObjectNamespace; FANOUT:DurableObjectNamespace }
const ORIGIN='http://localhost:3000';
export class DeltaFanout extends DurableObject<Env> {
 private current:PublicState|null=null;private received=0;
 ingest(raw:string):boolean{
  const result=applyPublicFrame(this.current,raw);if(result.status!=='accepted')return result.status==='stale';
  this.current=result.value;this.received=Date.now();for(const w of this.ctx.getWebSockets())try{w.send(raw);}catch{try{w.close(1011,'CLOSED');}catch{}}return true;
 }
 fetch(r:Request):Response{
  if(r.method!=='GET'||new URL(r.url).search||r.headers.get('Origin')!==ORIGIN||r.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('forbidden',{status:403});
  if(this.ctx.getWebSockets().filter(w=>w.readyState===WebSocket.OPEN).length>=256)return new Response('capacity',{status:503});
  if(!this.current||Date.now()-this.received>15000)return new Response('source unavailable',{status:503});
  const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment({at:Date.now(),count:0});pair[1].send(JSON.stringify(publicSnapshot(this.current)));return new Response(null,{status:101,webSocket:pair[0]});
 }
 webSocketMessage(w:WebSocket,raw:string|ArrayBuffer):void{
  const a=w.deserializeAttachment() as {at:number;count:number};if(Date.now()-a.at>60000){a.at=Date.now();a.count=0;}a.count++;w.serializeAttachment(a);
  if(a.count>20||typeof raw!=='string'||raw.length>2048){w.close(1008,'READ_ONLY_LIMIT');return;}
  let f;try{f=JSON.parse(raw);}catch{}
  if(f&&Object.keys(f).length===2&&f.v===1&&f.type==='public.sync'&&this.current&&Date.now()-this.received<=15000)w.send(JSON.stringify(publicSnapshot(this.current)));
  else w.send(JSON.stringify({v:1,type:'public.error',code:'READ_ONLY'}));
 }
 webSocketClose(w:WebSocket):void{try{w.close(1000,'CLOSED');}catch{}}
}
export class DeltaRelay extends DurableObject<Env>{
 private source:WebSocket|null=null;private starting:Promise<void>|null=null;private pending:RingSnapshot|null=null;private published:PublicState|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private flushing=false;private lastFlush=0;
 async start():Promise<void>{if(this.starting)return this.starting;if(this.source?.readyState===WebSocket.OPEN)return;this.starting=this.open();try{await this.starting;}finally{this.starting=null;}}
 private schedule():void{if(this.timer||this.flushing)return;this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{try{this.source?.close(1011,'FANOUT_FAILED');}catch{}});},Math.max(0,250-(Date.now()-this.lastFlush)));}
 private async flush():Promise<void>{
  if(!this.pending||this.flushing)return;this.flushing=true;const state=this.pending;this.pending=null;
  try{
   const frame=publicFrame(this.published,state),next:PublicState={sequence:frame.sequence,state},raw=JSON.stringify(frame),full=JSON.stringify(publicSnapshot(next));
   await Promise.all(Array.from({length:4},async(_,i)=>{const stub=this.env.FANOUT.get(this.env.FANOUT.idFromName('bucket-'+i)) as unknown as {ingest(raw:string):Promise<boolean>};if(!await stub.ingest(raw)&&!await stub.ingest(full))throw new Error('FANOUT_REJECTED');}));
   this.published=next;this.lastFlush=Date.now();
  }finally{this.flushing=false;if(this.pending)this.schedule();}
 }
 private async open():Promise<void>{
  const res=await this.env.ARENA.get(this.env.ARENA.idFromName('global')).fetch(new Request('https://internal/socket',{headers:{Origin:ORIGIN,Upgrade:'websocket'}}));const ws=res.webSocket;if(!ws)throw new Error('SOURCE_UNAVAILABLE');this.source=ws;ws.accept();let session=false;
  await new Promise<void>((resolve,reject)=>{let ready=false;const timeout=setTimeout(()=>reject(new Error('SOURCE_TIMEOUT')),8000);
   ws.addEventListener('message',e=>{const f=parseRingServer(String(e.data));if(!f){reject(new Error('INVALID_SOURCE'));return;}if(f.type!=='snapshot')return;
    if(!session){session=true;ws.send(JSON.stringify({v:2,type:'session'}));}
    this.pending=f;if(!ready){ready=true;void this.flush().then(()=>{clearTimeout(timeout);resolve();},reject);}else this.schedule();
   });
   ws.addEventListener('close',()=>{this.source=null;clearTimeout(timeout);if(!ready)reject(new Error('SOURCE_CLOSED'));});ws.addEventListener('error',()=>{this.source=null;clearTimeout(timeout);if(!ready)reject(new Error('SOURCE_ERROR'));});
  });await this.ctx.storage.setAlarm(Date.now()+5000);
 }
 async alarm():Promise<void>{if(this.source?.readyState===WebSocket.OPEN){this.source.send(JSON.stringify({v:2,type:'sync'}));await this.ctx.storage.setAlarm(Date.now()+5000);}}
}
