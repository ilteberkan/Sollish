import { COMBAT_V3_VERSION, COMBAT_V3_DURATION_MS, type ContactReplay, type ContactInitial } from './combat-v3';
import { COMBAT_VERSION, COMBAT_DURATION_MS, type CombatReplay } from './combat';
import { COMBAT_V4_VERSION, COMBAT_V4_DURATION_MS, simulateContactCombatV4, type V4Replay } from './combat-v4';
import { simulateContactCombat } from './combat-v3';
import { COMBAT_V5_VERSION, COMBAT_V5_DURATION_MS, V5_PLAN_LEAD_MS, replayContactV5, type V5Carry, type V5Replay } from './combat-v5';
import { PLAN_COUNT, verifyPlanChain, type PlanEntry } from './corner-plan';
import { sha256Utf8Hex } from './fight-style';
import { CONTACT_INITIAL } from './combat-v3';
import { MATCH_LEDGER, MATCH_MARKETS, MATCH_OPEN_MS, MATCH_ROUNDS, carryInitial, matchSeedHash, roundOutcome, type MatchMarket, type RingMatch, type RoundOutcome } from './ringside-match';
export * from './ringside-match';
export const RINGSIDE_OPEN_MS = 20_000;
export const RINGSIDE_RESULT_MS = 10_000;
export const RINGSIDE_FEE_BPS = 200;
export const RINGSIDE_MARKETS = [
  { id:'winner', label:'Maç sonucu', outcomes:['kor','ayaz','draw'], labels:['KOR','AYAZ','Beraberlik'] },
  { id:'first-hit', label:'İlk temiz isabet', outcomes:['kor','ayaz','simultaneous','none'], labels:['KOR','AYAZ','Aynı anda','İsabet yok'] },
  { id:'knockdown', label:'Yere düşme olur mu?', outcomes:['yes','no'], labels:['Olur','Olmaz'] },
  { id:'finish', label:'Maç nasıl biter?', outcomes:['stoppage','decision'], labels:['Durdurma','Puanla'] },
] as const;
export type RoundMarket = typeof RINGSIDE_MARKETS[number]['id'];
/** Round pools (Contact 2-4) and the Contact 5 match ledger never share a market id. */
export type RingMarket = RoundMarket|MatchMarket;
export type RingMarketSpec = { id:RingMarket; label:string; outcomes:readonly string[]; labels:readonly string[] };
export const marketsOf=(engine:string):readonly RingMarketSpec[]=>engine===COMBAT_V5_VERSION?MATCH_MARKETS:RINGSIDE_MARKETS;
export type ContactBout = {id:string;round:1|2|3;score:{kor:number;ayaz:number};initial:ContactInitial};
export type RingRound = { id:string; phase:'open'|'fighting'|'result'; openedAt:number; closesAt:number; startsAt:number|null; endsAt:number|null; nextAt:number|null; commitment:string; seed:string|null; engine:typeof COMBAT_VERSION|typeof COMBAT_V3_VERSION|typeof COMBAT_V4_VERSION|typeof COMBAT_V5_VERSION; bout?:ContactBout; plans?:PlanEntry[]; match?:RingMatch; results:Record<RoundMarket,string>|null };
export type RingTicket = { id:string; roundId:string; market:RingMarket; outcome:string; amount:number; status:'accepted'|'paid'|'refunded'; payout:number };
export type RingTapeEntry = { seq:number; alias:string; market:RingMarket; outcome:string; amount:number; acceptedAt:number; status:RingTicket['status']; payout:number };
export type RingPool = { market:RingMarket; total:number; count:number; sides:Record<string,number>; fee:number; distributed:number; status:'open'|'locked'|'paid'|'refunded' };
export type RingSnapshot = { v:2; type:'snapshot'; revision:number; at:number; round:RingRound; online:number; participants:number; total:number; count:number; pools:RingPool[]; tape:RingTapeEntry[] };
export type RingClient = {v:2;type:'session';token?:string}|{v:2;type:'sync'}|{v:2;type:'audit';roundId:string}|{v:2;type:'bet';id:string;roundId:string;market:RingMarket;outcome:string;amount:number};
export type RingServer = RingSnapshot|{v:2;type:'audit';roundId:string;entries:RingTapeEntry[]}|{v:2;type:'session';token?:string;balance:number;expires:number;tickets:RingTicket[]}|{v:2;type:'ticket';ticket:RingTicket}|{v:2;type:'error';code:string};
export const RING_ERRORS = ['INVALID_MESSAGE','SESSION_INVALID','SESSION_REQUIRED','SESSION_EXPIRED','ALREADY_BET','TICKET_CONFLICT','ROUND_CLOSED','WRONG_ROUND','INSUFFICIENT_CREDITS','CAPACITY','RATE_LIMITED','SERVICE_UNAVAILABLE'] as const;
const obj = (x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const uint=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const roundId=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,14}$/.test(x);
export const ringOutcome=(m:unknown,o:unknown)=>typeof o==='string'&&[...RINGSIDE_MARKETS,...MATCH_MARKETS].some(x=>x.id===m&&(x.outcomes as readonly string[]).includes(o));
const marketResults=(x:unknown,list:readonly RingMarketSpec[])=>obj(x)&&exact(x,list.map(m=>m.id))&&list.every(m=>ringOutcome(m.id,x[m.id]));
const initialState=(v:unknown)=>obj(v)&&exact(v,['health','stamina'])&&['health','stamina'].every(k=>{const s=v[k];return obj(s)&&exact(s,['kor','ayaz'])&&Object.values(s).every(n=>uint(n)&&n>=1&&n<=1000);});
const matchRecord=(r:unknown)=>obj(r)&&exact(r,['id','seed','initial','plans'])&&roundId(r.id)&&hash(r.seed)&&initialState(r.initial)&&Array.isArray(r.plans)&&r.plans.length===PLAN_COUNT;
/** Contact 5 match block: window, seed hashes and earlier rounds; replays are checked by verifyMatchHistory. */
function matchBlock(x:Record<string,unknown>,b:ContactBout):boolean{
 const m=x.match;if(!obj(m)||!exact(m,['ledger','openedAt','closesAt','seedHashes','previous','results'])||m.ledger!==MATCH_LEDGER||!uint(m.openedAt)||!uint(m.closesAt)||m.closesAt-m.openedAt!==MATCH_OPEN_MS)return false;
 if(!Array.isArray(m.seedHashes)||m.seedHashes.length!==MATCH_ROUNDS||!m.seedHashes.every(hash)||!Array.isArray(m.previous)||m.previous.length!==b.round-1||!m.previous.every(matchRecord))return false;
 if(b.round===1?m.openedAt!==x.openedAt||m.closesAt!==x.closesAt:x.closesAt!==x.openedAt||(x.openedAt as number)<m.closesAt)return false;
 const done=x.phase==='result'&&(b.round===MATCH_ROUNDS||obj(x.results)&&x.results.finish==='stoppage');
 return done?marketResults(m.results,MATCH_MARKETS):m.results===null;
}
const stake=(x:unknown)=>uint(x)&&x>=100&&x<=50_000;
function read(raw:string,max:number):Record<string,unknown>|null {if(new TextEncoder().encode(raw).length>max)return null;try{const x:unknown=JSON.parse(raw);return obj(x)?x:null;}catch{return null;}}
export function parseRingClient(raw:string):RingClient|null {
 const x=read(raw,2048);if(!x||x.v!==2)return null;
 if(x.type==='session'&&(exact(x,['v','type'])||exact(x,['v','type','token'])&&hash(x.token)))return x as RingClient;
 if(x.type==='sync'&&exact(x,['v','type']))return x as RingClient;
 if(x.type==='audit'&&exact(x,['v','type','roundId'])&&roundId(x.roundId))return x as RingClient;
 if(x.type==='bet'&&exact(x,['v','type','id','roundId','market','outcome','amount'])&&uuid(x.id)&&roundId(x.roundId)&&ringOutcome(x.market,x.outcome)&&stake(x.amount))return x as RingClient;
 return null;
}
function ticket(x:unknown):x is RingTicket {return obj(x)&&exact(x,['id','roundId','market','outcome','amount','status','payout'])&&uuid(x.id)&&roundId(x.roundId)&&ringOutcome(x.market,x.outcome)&&stake(x.amount)&&uint(x.payout)&&x.payout<=12_800_000&&((x.status==='accepted'&&x.payout===0)||x.status==='paid'||x.status==='refunded'&&x.payout===x.amount);}
function results(x:unknown):boolean{return marketResults(x,RINGSIDE_MARKETS);}
function round(x:unknown):x is RingRound {
 if(!obj(x))return false;
 const v5=x.engine===COMBAT_V5_VERSION,contact=x.engine===COMBAT_V3_VERSION||x.engine===COMBAT_V4_VERSION||v5;
 if(!exact(x,['id','phase','openedAt','closesAt','startsAt','endsAt','nextAt','commitment','seed','engine','results',...(contact?['bout']:[]),...(v5?['plans','match']:[])])||!roundId(x.id)||!uint(x.openedAt)||!uint(x.closesAt)||(!v5&&x.closesAt-x.openedAt!==RINGSIDE_OPEN_MS)||!hash(x.commitment)||(!contact&&x.engine!==COMBAT_VERSION))return false;
 if(contact){const b=x.bout;if(!obj(b)||!exact(b,['id','round','score','initial'])||!roundId(b.id)||!uint(b.round)||b.round<1||b.round>3||!obj(b.score)||!exact(b.score,['kor','ayaz'])||!Object.values(b.score).every(n=>uint(n)&&n<(b.round as number))||!obj(b.initial)||!exact(b.initial,['health','stamina']))return false;if((b.score.kor as number)+(b.score.ayaz as number)>(b.round as number)-1||Number(b.id)+(b.round as number)-1!==Number(x.id))return false;for(const kind of ['health','stamina']){const v=b.initial[kind];if(!obj(v)||!exact(v,['kor','ayaz'])||!Object.values(v).every(n=>uint(n)&&n>=1&&n<=1000))return false;}}

 // Contact 5: the published plan log must chain from this round's commitment; observation hashes are checked by replay.
 if(v5){const p=x.plans;if(!Array.isArray(p)||p.length>PLAN_COUNT||!verifyPlanChain(p,x.commitment as string).ok||(x.phase==='open'&&p.length)||(x.phase==='result'&&p.length!==PLAN_COUNT)||!matchBlock(x,x.bout as ContactBout))return false;}
 if(x.phase==='open')return x.startsAt===null&&x.endsAt===null&&x.nextAt===null&&x.seed===null&&x.results===null;
 return (x.phase==='fighting'||x.phase==='result')&&uint(x.startsAt)&&x.startsAt>=x.closesAt&&uint(x.endsAt)&&x.endsAt-x.startsAt===(x.engine===COMBAT_V4_VERSION?COMBAT_V4_DURATION_MS:v5?COMBAT_V5_DURATION_MS:contact?COMBAT_V3_DURATION_MS:COMBAT_DURATION_MS)&&uint(x.nextAt)&&x.nextAt-x.endsAt===RINGSIDE_RESULT_MS&&hash(x.seed)&&(x.phase==='result'?results(x.results):x.results===null);
}
export function parseRingServer(raw:string):RingServer|null {
 const x=read(raw,131072);if(!x||x.v!==2)return null;
 if(x.type==='audit'&&exact(x,['v','type','roundId','entries'])&&roundId(x.roundId)&&Array.isArray(x.entries)&&x.entries.length<=256&&validTape(x.entries))return x as RingServer;
 if(x.type==='error'&&exact(x,['v','type','code'])&&typeof x.code==='string'&&(RING_ERRORS as readonly string[]).includes(x.code))return x as RingServer;
 if(x.type==='ticket'&&exact(x,['v','type','ticket'])&&ticket(x.ticket))return x as RingServer;
 if(x.type==='session'&&(exact(x,['v','type','balance','expires','tickets'])||exact(x,['v','type','token','balance','expires','tickets'])&&hash(x.token))&&uint(x.balance)&&uint(x.expires)&&Array.isArray(x.tickets)&&x.tickets.length<=16&&x.tickets.every(ticket)&&new Set(x.tickets.map(t=>t.id)).size===x.tickets.length)return x as RingServer;
 if(x.type!=='snapshot'||!exact(x,['v','type','revision','at','round','online','participants','total','count','pools','tape'])||!uint(x.revision)||!uint(x.at)||!round(x.round)||!uint(x.online)||x.online>256||!uint(x.participants)||x.participants>256||!uint(x.total)||x.total>12_800_000||!uint(x.count)||x.count>256||x.participants>x.count||!Array.isArray(x.pools)||x.pools.length!==marketsOf(x.round.engine).length||!Array.isArray(x.tape)||x.tape.length>30)return null;
 // Contact 5 snapshots may arrive during the 2.5 s planning lead between cutoff and the first tick.
 if(x.at<(x.round.phase==='open'?x.round.openedAt:x.round.phase==='fighting'?x.round.startsAt!-(x.round.engine===COMBAT_V5_VERSION?V5_PLAN_LEAD_MS:0):x.round.endsAt!))return null;
 const markets=marketsOf(x.round.engine),r=x.round,settled=r.match?r.match.results:r.phase==='result'?r.results:null,open=r.phase==='open'&&(!r.match||r.bout?.round===1),window=r.match??r;
 for(let i=0;i<x.pools.length;i++){
  const p=x.pools[i], m=markets[i];if(!obj(p)||!exact(p,['market','total','count','sides','fee','distributed','status'])||p.market!==m.id||!uint(p.total)||!uint(p.count)||!uint(p.fee)||!uint(p.distributed)||!obj(p.sides)||!exact(p.sides,[...m.outcomes])||!Object.values(p.sides).every(uint)||Object.values(p.sides).reduce<number>((s,n)=>s+(n as number),0)!==p.total)return null;
  if(settled){const won=(settled as Record<string,string>)[m.id],refund=Object.values(p.sides).filter(n=>(n as number)>0).length<2||p.sides[won]===0;const fee=refund?0:Math.floor(p.total*RINGSIDE_FEE_BPS/10000);if(p.status!==(refund?'refunded':'paid')||p.fee!==fee||p.fee+p.distributed!==p.total)return null;}
  else if(p.status!==(open?'open':'locked')||p.fee!==0||p.distributed!==0)return null;
 }
 if(x.pools.reduce((s,p)=>s+p.total,0)!==x.total||x.pools.reduce((s,p)=>s+p.count,0)!==x.count)return null;
 const checkedRound=x.round;
 if(!validTape(x.tape)||x.tape.length!==Math.min(x.count,30)||x.tape.some(e=>e.acceptedAt<window.openedAt||e.acceptedAt>=window.closesAt||(settled?e.status==='accepted':e.status!=='accepted')||!markets.some(m=>m.id===e.market)))return null;
 return x as RingSnapshot;
}
function validTape(entries:unknown[]):boolean{let last=Infinity;for(const e of entries){if(!obj(e)||!exact(e,['seq','alias','market','outcome','amount','acceptedAt','status','payout'])||!uint(e.seq)||e.seq===0||e.seq>=last||typeof e.alias!=='string'||!/^S-[0-9A-F]{12}$/.test(e.alias)||!ringOutcome(e.market,e.outcome)||!stake(e.amount)||!uint(e.acceptedAt)||!uint(e.payout)||e.payout>12_800_000||!(['accepted','paid','refunded'] as unknown[]).includes(e.status)||(e.status==='accepted'&&e.payout!==0)||(e.status==='refunded'&&e.payout!==e.amount))return false;last=e.seq;}return true;}
export function combatResults(replay:CombatReplay|ContactReplay|V4Replay|V5Replay):Record<RoundMarket,string>{return {'winner':replay.winner,'first-hit':replay.firstHit,'knockdown':replay.knockdown,'finish':replay.finish};}
/** Published before admission; pin these exact bytes when verifying a round's seed commitment. */
export function ringCommitmentInput(roundId:string,seed:string):string { return `sollish:ringside:v2:${COMBAT_VERSION}:${roundId}:${seed}`; }

/** V3 binds the complete initial round state; round-2 state cannot be swapped after admission. */
export function contactCommitmentInput(roundId:string,seed:string,b:ContactBout):string{return `sollish:ringside:v3:${COMBAT_V3_VERSION}:${roundId}:${seed}:${b.id}:${b.round}:${b.score.kor}:${b.score.ayaz}:${b.initial.health.kor}:${b.initial.health.ayaz}:${b.initial.stamina.kor}:${b.initial.stamina.ayaz}`;}

/** V4 binds the same complete initial state under its own engine id and prefix. */
export function contactCommitmentInputV4(roundId:string,seed:string,b:ContactBout):string{return `sollish:ringside:v4:${COMBAT_V4_VERSION}:${roundId}:${seed}:${b.id}:${b.round}:${b.score.kor}:${b.score.ayaz}:${b.initial.health.kor}:${b.initial.health.ayaz}:${b.initial.stamina.kor}:${b.initial.stamina.ayaz}`;}
/** V5 binds the same complete initial state; the corner plan log chains from this commitment. */
export function contactCommitmentInputV5(roundId:string,seed:string,b:ContactBout):string{return `sollish:ringside:v5:${COMBAT_V5_VERSION}:${roundId}:${seed}:${b.id}:${b.round}:${b.score.kor}:${b.score.ayaz}:${b.initial.health.kor}:${b.initial.health.ayaz}:${b.initial.stamina.kor}:${b.initial.stamina.ayaz}`;}
export type ContactEngine=typeof COMBAT_V3_VERSION|typeof COMBAT_V4_VERSION|typeof COMBAT_V5_VERSION;
/** One registry so servers and browsers cannot pair a round with another engine's rules. */
export const CONTACT_ENGINES={
 [COMBAT_V3_VERSION]:{durationMs:COMBAT_V3_DURATION_MS,commitment:contactCommitmentInput,simulate:(seed:string,initial:ContactInitial)=>simulateContactCombat(seed,initial) as ContactReplay|V4Replay|V5Replay},
 [COMBAT_V4_VERSION]:{durationMs:COMBAT_V4_DURATION_MS,commitment:contactCommitmentInputV4,simulate:(seed:string,initial:ContactInitial)=>simulateContactCombatV4(seed,initial) as ContactReplay|V4Replay|V5Replay},
 // Contact 5 needs the round's complete, verified plan log; without it there is no result.
 [COMBAT_V5_VERSION]:{durationMs:COMBAT_V5_DURATION_MS,commitment:contactCommitmentInputV5,simulate:(seed:string,initial:ContactInitial,round=1,plans?:readonly PlanEntry[],carry?:V5Carry)=>{const r=plans?replayContactV5(seed,initial,round,plans,false,carry):null;if(!r||!r.ok||!r.replay)throw new Error('PLAN_LOG_INVALID');return r.replay as ContactReplay|V4Replay|V5Replay;}},
} as const;

export type MatchRoundSummary = RoundOutcome & { id:string; round:number; points:{kor:number;ayaz:number} };
const sameInitial=(a:ContactInitial,b:ContactInitial)=>a.health.kor===b.health.kor&&a.health.ayaz===b.health.ayaz&&a.stamina.kor===b.stamina.kor&&a.stamina.ayaz===b.stamina.ayaz;
/** Replays every earlier round of a Contact 5 bout from the published records: seed hashes, commitments,
 * plan chains, carried state and score must all agree. Browsers run it once per round they join. */
/** Also threads the learner carry (weights, opponent model, lessons) from round to round and returns the one the current round starts from (none in round 1). */
export function verifyMatchHistory(r:RingRound):{ok:true;rounds:MatchRoundSummary[];carry?:V5Carry}|{ok:false;reason:string}{
 const m=r.match,b=r.bout;if(r.engine!==COMBAT_V5_VERSION||!m||!b)return {ok:false,reason:'NOT_A_MATCH'};
 const score={kor:0,ayaz:0},rounds:MatchRoundSummary[]=[];let carry:V5Carry|undefined;
 if(!sameInitial((m.previous[0]?.initial??b.initial),CONTACT_INITIAL))return {ok:false,reason:'OPENING_STATE'};
 for(let k=1;k<=m.previous.length;k++){
  const rec=m.previous[k-1]!;if(rec.id!==String(Number(b.id)+k-1)||matchSeedHash(b.id,k,rec.seed)!==m.seedHashes[k-1])return {ok:false,reason:'SEED'};
  const commitment=sha256Utf8Hex(contactCommitmentInputV5(rec.id,rec.seed,{id:b.id,round:k as 1|2|3,score:{...score},initial:rec.initial}));
  if(!verifyPlanChain(rec.plans,commitment).ok)return {ok:false,reason:'PLAN_CHAIN'};
  const p=replayContactV5(rec.seed,rec.initial,k,rec.plans,false,carry);if(!p.ok||!p.replay)return {ok:false,reason:'REPLAY'};carry=p.replay.carry;
  const res=roundOutcome(p.replay);if(res.finish==='stoppage')return {ok:false,reason:'ENDED'};
  rounds.push({id:rec.id,round:k,...res,points:p.replay.points});if(res.winner==='kor'||res.winner==='ayaz')score[res.winner]++;
  if(!sameInitial(carryInitial(p.replay.frames.at(-1)!),k<m.previous.length?m.previous[k]!.initial:b.initial))return {ok:false,reason:'CARRY'};
 }
 if(score.kor!==b.score.kor||score.ayaz!==b.score.ayaz)return {ok:false,reason:'SCORE'};
 if(r.seed&&matchSeedHash(b.id,b.round,r.seed)!==m.seedHashes[b.round-1])return {ok:false,reason:'SEED'};
 return {ok:true,rounds,...(carry?{carry}:{})};
}
