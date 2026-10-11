/** Load clients for the experimental public transport; no financial authority. */
import { applyPublicFrame } from './public-delta.ts';
import { origin,until } from './runtime.mjs';
export function deltaViewers(runtime,metrics,allClients){
 const stats={snapshots:0,deltas:0,gaps:0,resyncs:0,deliberatelyDropped:0,privateLeaks:0,wireBytes:0,wireFrames:0},age=[];
 async function connect(path){
  const ws=new WebSocket(`ws://127.0.0.1:${runtime.port}${path}`,{headers:{Origin:origin}}),c={ws,path,spectator:true,token:null,balance:null,tickets:new Map(),snapshot:null,settledSnapshot:null,errors:[],closed:false,expectedClose:false,current:null,dropNext:false,recovering:false};allClients.push(c);
  const ready=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('VIEWER_TIMEOUT')),20000);c.ready=()=>{clearTimeout(t);resolve(c);};ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('VIEWER_ERROR'));},{once:true});});
  ws.addEventListener('close',()=>{c.closed=true;if(!c.expectedClose)metrics.unexpectedClose++;});
  ws.addEventListener('message',e=>{const raw=String(e.data);stats.wireBytes+=Buffer.byteLength(raw);stats.wireFrames++;metrics.frames++;metrics.bytes+=Buffer.byteLength(raw);
   let f;try{f=JSON.parse(raw);}catch{metrics.invalidFrames++;return;}
   if(f.type==='public.error'&&f.v===1&&f.code==='READ_ONLY'&&Object.keys(f).length===3){c.errors.push(f.code);return;}
   if(f.type==='public.delta'){stats.deltas++;if(c.dropNext){c.dropNext=false;stats.deliberatelyDropped++;return;}}else if(f.type==='public.snapshot')stats.snapshots++;else{stats.privateLeaks++;metrics.invalidFrames++;return;}
   const decoded=applyPublicFrame(c.current,raw);
   if(decoded.status==='gap'){stats.gaps++;if(!c.recovering){c.recovering=true;ws.send(JSON.stringify({v:1,type:'public.sync'}));}return;}
   if(decoded.status==='invalid'){metrics.invalidFrames++;return;}if(decoded.status==='stale')return;
   if(c.recovering&&f.type==='public.snapshot'){stats.resyncs++;c.recovering=false;}
   c.current=decoded.value;c.snapshot=decoded.value.state;if(c.snapshot.round.phase==='result')c.settledSnapshot=c.snapshot;
   age.push(Math.max(0,Date.now()-c.snapshot.at));if(age.length>20000)age.splice(0,10000);c.ready();
  });return ready;
 }
 async function reconnect(c){const start=performance.now();c.expectedClose=true;c.ws.close();await until(()=>c.closed,10000,'VIEWER_CLOSED');const next=await connect(c.path);next.reconnectMs=performance.now()-start;return next;}
 return {connect,reconnect,stats,age};
}
