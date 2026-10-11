/** Experimental public transport only; never a source of financial acknowledgements. */
import { parseRingServer,type RingSnapshot } from '../../packages/protocol/src/ringside';
export type PublicState={sequence:number;state:RingSnapshot};
type Changes=Partial<Omit<RingSnapshot,'v'|'type'>>;
export type PublicFrame={v:1;type:'public.snapshot';sequence:number;state:RingSnapshot}|{v:1;type:'public.delta';sequence:number;baseSequence:number;changes:Changes};
const keys=['revision','at','round','online','participants','total','count','pools','tape'] as const;
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,k:string[])=>Object.keys(x).length===k.length&&k.every(s=>Object.hasOwn(x,s));
const seq=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
function snapshot(value:unknown):RingSnapshot|null{const x=parseRingServer(JSON.stringify(value));return x?.type==='snapshot'?x:null;}
export function publicFrame(previous:PublicState|null,state:RingSnapshot):PublicFrame{
 if(!snapshot(state))throw new Error('INVALID_PUBLIC_STATE');
 const sequence=(previous?.sequence??0)+1;if(!seq(sequence))throw new Error('SEQUENCE_EXHAUSTED');
 if(!previous)return {v:1,type:'public.snapshot',sequence,state};
 const changes:Changes={};for(const key of keys)if(JSON.stringify(previous.state[key])!==JSON.stringify(state[key]))Object.assign(changes,{[key]:state[key]});
 return {v:1,type:'public.delta',sequence,baseSequence:previous.sequence,changes};
}
export function publicSnapshot(state:PublicState):PublicFrame{return {v:1,type:'public.snapshot',sequence:state.sequence,state:state.state};}
export function applyPublicFrame(previous:PublicState|null,raw:string):{status:'accepted';value:PublicState}|{status:'stale'|'gap'|'invalid'}{
 if(new TextEncoder().encode(raw).length>132000)return {status:'invalid'};let f:unknown;try{f=JSON.parse(raw);}catch{return {status:'invalid'};}
 if(!obj(f)||f.v!==1||!seq(f.sequence))return {status:'invalid'};
 let state:RingSnapshot|null;
 if(f.type==='public.snapshot'){
  if(!exact(f,['v','type','sequence','state']))return {status:'invalid'};
  state=snapshot(f.state);
 }else if(f.type==='public.delta'){
  if(!exact(f,['v','type','sequence','baseSequence','changes'])||!seq(f.baseSequence)||f.sequence!==f.baseSequence+1||!obj(f.changes)||Object.keys(f.changes).some(k=>!(keys as readonly string[]).includes(k)))return {status:'invalid'};
  if(previous&&f.sequence<=previous.sequence)return {status:'stale'};
  if(!previous||previous.sequence!==f.baseSequence)return {status:'gap'};
  state=snapshot({...previous.state,...f.changes});
 }else return {status:'invalid'};
 if(!state)return {status:'invalid'};
 if(previous){
  if(f.sequence<previous.sequence)return {status:'stale'};
  if(f.sequence===previous.sequence)return JSON.stringify(state)===JSON.stringify(previous.state)?{status:'stale'}:{status:'invalid'};
  if(state.revision<previous.state.revision||state.at<previous.state.at)return {status:'invalid'};
 }
 return {status:'accepted',value:{sequence:f.sequence,state}};
}
