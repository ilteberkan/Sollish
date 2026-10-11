import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, sha } from './environment.mjs';

export const ACTIONS = Object.freeze(['advance','circle','guard','slip','jab','cross','hook','kick']);
export const FEATURES = 139;
export const PARAMETERS = FEATURES * ACTIONS.length;
export const GRAPH_FILE_SHA = 'd1e5c9b2554b5f898e3075de505794b06cf4fdce8196dd762c6247b35b38e272';
export const GRAPH_SHA = '284dca2f166169c47d50a489d96bb011ceab3ae01a73922c2dd4c44da041e37d';
export function random(seed) {
  let a = seed >>> 0;
  const uniform = () => { a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296; };
  return {uniform,normal:()=>Math.sqrt(-2*Math.log(Math.max(Number.MIN_VALUE,uniform())))*Math.cos(2*Math.PI*uniform())};
}
export async function loadReservoir(variant='connectome') {
  if (!['connectome','scrambled','no-recurrence'].includes(variant)) throw new Error('UNKNOWN_VARIANT');
  const bytes = await readFile(resolve(ROOT, 'experiments/connectome/evidence/descending-128.json'));
  if (sha(bytes)!==GRAPH_FILE_SHA) throw new Error('GRAPH_FILE_HASH_MISMATCH');
  const doc=JSON.parse(bytes); if(doc.graphSha256!==GRAPH_SHA||doc.nodeCount!==128||doc.edgeCount!==4949)throw new Error('GRAPH_SHAPE');
  const ids=new Map(doc.graph.nodes.map((n,i)=>[n.bodyId,i]));
  const edges=doc.graph.edges.map(([a,b,w])=>[ids.get(a),ids.get(b),w]);
  if(variant==='scrambled'){
    const rng=random(9011), posts=edges.map(e=>e[1]);
    for(let i=posts.length-1;i>0;i--){const j=Math.floor(rng.uniform()*(i+1));[posts[i],posts[j]]=[posts[j],posts[i]];}
    edges.forEach((e,i)=>{e[1]=posts[i];});
  }
  const totals=new Float64Array(128);for(const [,b,w]of edges)totals[b]+=w;
  const pre=Int32Array.from(edges,e=>e[0]),post=Int32Array.from(edges,e=>e[1]),weights=Float64Array.from(edges,e=>.8*e[2]/totals[e[1]]);
  const rng=random(11),input=Float64Array.from({length:128*11},()=>rng.uniform()*1.3-.65);
  return {variant,pre,post,weights,input,nodes:128,graphSha256:GRAPH_SHA};
}
export function initialParameters(seed=171) {const rng=random(seed);return Float64Array.from({length:PARAMETERS},()=>rng.normal()*.04);}
export function createController(parameters, reservoir) {
  if(parameters.length!==PARAMETERS||Array.from(parameters).some(n=>!Number.isFinite(n)))throw new Error('BAD_PARAMETERS');
  // Copy freezes an opponent checkpoint throughout an episode, even if a trainer mutates its source.
  const theta=Float64Array.from(parameters),state=new Float64Array(128),drive=new Float64Array(128),features=new Float64Array(FEATURES),scores=new Float64Array(8);
  return inputs=>{
    if(inputs.length!==10||inputs.some(x=>!Number.isFinite(x)||x < -1||x > 1))throw new Error('BAD_OBSERVATION');
    for(let i=0;i<128;i++){let v=reservoir.input[i*11];for(let j=0;j<10;j++)v+=reservoir.input[i*11+j+1]*inputs[j];drive[i]=v;}
    if(reservoir.variant!=='no-recurrence')for(let e=0;e<reservoir.pre.length;e++)drive[reservoir.post[e]]+=reservoir.weights[e]*state[reservoir.pre[e]];
    features[0]=1;for(let j=0;j<10;j++)features[j+1]=inputs[j];
    for(let i=0;i<128;i++){state[i]=reservoir.variant==='no-recurrence'?Math.tanh(drive[i]):.65*state[i]+.35*Math.tanh(drive[i]);features[i+11]=state[i];}
    let best=0;for(let action=0;action<8;action++){let v=0;for(let j=0;j<FEATURES;j++)v+=theta[action*FEATURES+j]*features[j];scores[action]=v;if(v>scores[best])best=action;}
    return ACTIONS[best];
  };
}
/** Transparent comparison opponents; none supplies labels or gradients. */
export function scripted(kind) {
  let decision=0;
  return x=>{
    decision++;
    if(kind==='jab-only')return 'jab';
    if(kind==='kick-only')return 'kick';
    if(kind==='turtle')return 'guard';
    if(kind==='evasive')return decision%3===0?'slip':'circle';
    if(kind==='alternating')return ['jab','cross','hook','kick'][decision%4];
    if(kind==='counter')return x[3]>0?'slip':x[4]>0?'cross':'jab';
    throw new Error('UNKNOWN_OPPONENT');
  };
}
