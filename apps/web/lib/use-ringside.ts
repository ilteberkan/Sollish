'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMBAT_VERSION, COMBAT_V3_VERSION, COMBAT_V4_VERSION, COMBAT_V5_VERSION, CONTACT_ENGINES, contactCommitmentInput, type ContactEngine, parseRingClient, parseRingServer, ringCommitmentInput, simulateCombat, combatResults, RINGSIDE_MARKETS, verifyMatchHistory, matchResults, roundOutcome, type MatchRoundSummary, type V5Carry, type RingRound, type V5Replay, type RingClient, type RingMarket, type RingSnapshot, type RingTicket, type RingTapeEntry } from '@sollish/protocol';
import { configuredApi } from './chat';
const api=configuredApi(process.env.NEXT_PUBLIC_API_URL);

type State=RingSnapshot&{receivedAt:number;serverAt:number};
/** The ledger a ticket belongs to: the bout for Contact 5 match tickets, else the round. */
export const ledgerOf=(r:RingRound)=>r.match?r.bout!.id:r.id;
/** Bets are open only in the published window: before round 1 for a match, else the round's own window. */
export const bettingOpen=(r:RingRound,now:number)=>r.phase==='open'&&now<r.closesAt&&(!r.match||r.bout?.round===1);
/** Locked match fields: window, seed hashes and earlier rounds may only grow; results may only appear once. */
function matchChanged(a:RingRound,b:RingRound){const x=a.match,y=b.match;if(!x||!y||a.bout?.id!==b.bout?.id)return false;return x.ledger!==y.ledger||x.openedAt!==y.openedAt||x.closesAt!==y.closesAt||x.seedHashes.join()!==y.seedHashes.join()||x.previous.length>y.previous.length||x.previous.some((r,i)=>r.id!==y.previous[i]?.id||r.seed!==y.previous[i]?.seed||r.plans.at(-1)?.hash!==y.previous[i]?.plans.at(-1)?.hash)||(!!x.results&&JSON.stringify(x.results)!==JSON.stringify(y.results));}
/** User-facing failures are codes; the arena translates them (`ringside.error.<code>`). Codes never reach a result or payout. */
export type RingsideError='NOT_CONFIGURED'|'SERVER_DATA'|'ENGINE_MISMATCH'|'RESULT_CHANGED'|'LOCKED_CHANGED'|'HISTORY_MISMATCH'|'COMMITMENT_MISMATCH'|'PLAN_LOG_MISMATCH'|'RESULT_MISMATCH'|'MATCH_RESULT_MISMATCH'|'VERIFY_FAILED'|'NO_TICKET_ID'|'AMOUNT_RANGE'|'RECOVERY_FAILED'|'TICKET_RECHECK'|'ROUND_CLOSED'|'WRONG_ROUND'|'ALREADY_BET'|'INVALID_MESSAGE'|'INSUFFICIENT_CREDITS'|'CAPACITY'|'SESSION_EXPIRED'|'SESSION_INVALID';
const SERVER_ERRORS:readonly string[]=['ROUND_CLOSED','WRONG_ROUND','ALREADY_BET','INVALID_MESSAGE','INSUFFICIENT_CREDITS','CAPACITY','SESSION_EXPIRED','SESSION_INVALID'];
const serverError=(code:string):RingsideError=>SERVER_ERRORS.includes(code)?code as RingsideError:'TICKET_RECHECK';
export function useRingside(version:2|3|4|5=5){
 const engine=version===5?COMBAT_V5_VERSION:version===4?COMBAT_V4_VERSION:version===3?COMBAT_V3_VERSION:COMBAT_VERSION;
 const KEY=`sollish.ringside.pools.session.v${version}`,PENDING=`sollish.ringside.pools.pending.v${version}`;
 const [audit,setAudit]=useState<{roundId:string;entries:RingTapeEntry[]}|null>(null);
 const [history,setHistory]=useState<{key:string;rounds:MatchRoundSummary[];carry?:V5Carry}|null>(null);
 const [state,setState]=useState<State|null>(null),[tickets,setTickets]=useState<RingTicket[]>([]),[balance,setBalance]=useState<number|null>(null),[connected,setConnected]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<RingsideError|''>(''),[now,setNow]=useState(0),[verified,setVerified]=useState(false);
 const checked=useRef<{key:string;rounds:MatchRoundSummary[];carry?:V5Carry}|null>(null);
 const wsRef=useRef<WebSocket|null>(null),latest=useRef<State|null>(null),token=useRef<string|null>(null),command=useRef<Extract<RingClient,{type:'bet'}>|null>(null);
 const send=useCallback((f:RingClient)=>{try{if(wsRef.current?.readyState!==WebSocket.OPEN)return false;wsRef.current.send(JSON.stringify(f));return true;}catch{return false;}},[]);
 const clear=useCallback(()=>{command.current=null;setPending(false);try{sessionStorage.removeItem(PENDING);}catch{}},[PENDING]);
 useEffect(()=>{
  if(!api){setError('NOT_CONFIGURED');return;}
  let stopped=false,retry:ReturnType<typeof setTimeout>|undefined,attempt=0;
  try{const s=sessionStorage.getItem(KEY);token.current=s&&/^[0-9a-f]{64}$/.test(s)?s:null;const p=sessionStorage.getItem(PENDING);if(p&&p.length<2048){const saved=JSON.parse(p),f=parseRingClient(JSON.stringify(saved.command));if(saved.token===token.current&&token.current&&f?.type==='bet'){command.current=f;setPending(true);}}}catch{}
  const connect=()=>{
   if(stopped)return;const u=new URL(`/v${version}/arena/ringside`,api);u.protocol=u.protocol==='https:'?'wss:':'ws:';const w=new WebSocket(u);wsRef.current=w;let authenticated=false,retried=false,queue=Promise.resolve();
   const active=()=>!stopped&&wsRef.current===w;
   w.onopen=()=>{if(active())send({v:2,type:'session',...(token.current?{token:token.current}:{})});};
   w.onmessage=e=>{queue=queue.then(async()=>{
    if(!active())return;const f=typeof e.data==='string'?parseRingServer(e.data):null;if(!f){setError('SERVER_DATA');w.close();return;}
    if(f.type==='session'){
     if(f.token){token.current=f.token;try{sessionStorage.setItem(KEY,f.token);}catch{}}authenticated=true;setBalance(f.balance);setTickets(f.tickets);setError(e=>e==='SESSION_INVALID'||e==='SESSION_EXPIRED'?'':e);
     if(command.current&&f.tickets.some(t=>t.id===command.current!.id)){clear();setError('');}
     if(command.current&&!retried){retried=true;send(command.current);}if(!command.current)attempt=0;return;
    }
    if(f.type==='snapshot'){
     if(f.round.engine!==engine){setError('ENGINE_MISMATCH');w.close();return;}
     const old=latest.current;if(old&&(f.revision<old.revision||f.at<old.at))return;
     if(old){const a=old.round,b=f.round;if(a.id===b.id&&a.results&&(!b.results||RINGSIDE_MARKETS.some(m=>a.results![m.id]!==b.results![m.id]))){setError('RESULT_CHANGED');w.close();return;}const phases=['open','fighting','result'];if(Number(b.id)<Number(a.id)||(a.id===b.id&&(phases.indexOf(b.phase)<phases.indexOf(a.phase)||a.engine!==b.engine||(a.bout?contactCommitmentInput(a.id,'',a.bout):'')!==(b.bout?contactCommitmentInput(b.id,'',b.bout):'')||a.commitment!==b.commitment||a.openedAt!==b.openedAt||a.closesAt!==b.closesAt||['startsAt','endsAt','nextAt','seed'].some(k=>a[k as keyof typeof a]!==null&&a[k as keyof typeof a]!==b[k as keyof typeof b])||(a.plans?.length??0)>(b.plans?.length??0)||(a.plans??[]).some((e,i)=>e.hash!==b.plans?.[i]?.hash)))||matchChanged(a,b)){setError('LOCKED_CHANGED');w.close();return;}}
     // Contact 5 match: replay every earlier round of the bout once per round and seed reveal.
     let rounds:MatchRoundSummary[]=[],carry:V5Carry|undefined;
     if(f.round.match){const key=`${f.round.id}:${f.round.seed??''}:${f.round.match.previous.length}`;if(checked.current?.key===key){rounds=checked.current.rounds;carry=checked.current.carry;}else{const h=verifyMatchHistory(f.round);if(!h.ok){setError('HISTORY_MISMATCH');setVerified(false);w.close();return;}rounds=h.rounds;carry=h.carry;checked.current={key,rounds,...(carry?{carry}:{})};setHistory({key,rounds,...(carry?{carry}:{})});}}
     if(f.round.seed){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.round.bout?CONTACT_ENGINES[f.round.engine as ContactEngine].commitment(f.round.id,f.round.seed,f.round.bout):ringCommitmentInput(f.round.id,f.round.seed)));if(!active())return;const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==f.round.commitment){setError('COMMITMENT_MISMATCH');setVerified(false);w.close();return;}if(f.round.results){let expected;try{expected=combatResults(f.round.bout?CONTACT_ENGINES[f.round.engine as ContactEngine].simulate(f.round.seed,f.round.bout.initial,f.round.bout.round,f.round.plans,carry):simulateCombat(f.round.seed));}catch{setError('PLAN_LOG_MISMATCH');setVerified(false);w.close();return;}if(RINGSIDE_MARKETS.some(m=>expected[m.id]!==f.round.results![m.id])){setError('RESULT_MISMATCH');setVerified(false);w.close();return;}
      if(f.round.match?.results){const replay=CONTACT_ENGINES[f.round.engine as ContactEngine].simulate(f.round.seed,f.round.bout!.initial,f.round.bout!.round,f.round.plans,carry) as V5Replay,final=matchResults([...rounds,roundOutcome(replay)]);if(Object.entries(final).some(([k,v])=>f.round.match!.results![k as keyof typeof final]!==v)){setError('MATCH_RESULT_MISMATCH');setVerified(false);w.close();return;}}}setVerified(true);}else setVerified(false);
     const receivedAt=performance.now(),serverAt=Math.max(f.at,old?old.serverAt+receivedAt-old.receivedAt:0);const fresh={...f,receivedAt,serverAt};latest.current=fresh;setState(fresh);setNow(serverAt);if(authenticated)setConnected(true);return;
    }
    if(f.type==='audit'){setAudit({roundId:f.roundId,entries:f.entries});return;}
    if(f.type==='ticket'){setTickets(list=>[f.ticket,...list.filter(t=>t.id!==f.ticket.id)].slice(0,16));if(command.current?.id===f.ticket.id){clear();setError('');}return;}
    setError(serverError(f.code));
    if(['SERVICE_UNAVAILABLE','RATE_LIMITED','SESSION_REQUIRED','TICKET_CONFLICT'].includes(f.code)){w.close();return;}clear();
    if(['SESSION_INVALID','SESSION_EXPIRED'].includes(f.code)){token.current=null;latest.current=null;setTickets([]);setBalance(null);try{sessionStorage.removeItem(KEY);}catch{}w.close();}
   }).catch(()=>{if(active()){setError('VERIFY_FAILED');w.close();}});};
   w.onerror=()=>{if(active())setConnected(false);};w.onclose=()=>{if(active()){setConnected(false);retry=setTimeout(connect,Math.min(15_000,1000*2**Math.min(attempt++,4)));}};
  };
  connect();const timer=setInterval(()=>{const s=latest.current;if(s)setNow(s.serverAt+performance.now()-s.receivedAt);},100),sync=setInterval(()=>send({v:2,type:'sync'}),10_000);
  const resume=()=>{if(!document.hidden)send({v:2,type:'sync'});};document.addEventListener('visibilitychange',resume);
  return()=>{stopped=true;clearTimeout(retry);clearInterval(timer);clearInterval(sync);document.removeEventListener('visibilitychange',resume);wsRef.current?.close();wsRef.current=null;};
 },[clear,send,version,engine,KEY,PENDING]);
 const bet=useCallback((market:RingMarket,outcome:string,amount:number)=>{
  const s=latest.current;if(!s||!connected||command.current)return;if(!bettingOpen(s.round,s.serverAt+performance.now()-s.receivedAt)){setError('ROUND_CLOSED');return;}
  let id:string;try{id=crypto.randomUUID();}catch{setError('NO_TICKET_ID');return;}
  const c:RingClient={v:2,type:'bet',id,roundId:ledgerOf(s.round),market,outcome,amount};if(!parseRingClient(JSON.stringify(c))){setError('AMOUNT_RANGE');return;}
  try{if(!token.current)throw new Error();sessionStorage.setItem(PENDING,JSON.stringify({token:token.current,command:c}));}catch{setError('RECOVERY_FAILED');return;}
  command.current=c;setPending(true);setError('');if(!send(c))wsRef.current?.close();
 },[connected,send,PENDING]);
 const requestAudit=useCallback(()=>{const s=latest.current;if(s)send({v:2,type:'audit',roundId:ledgerOf(s.round)});},[send]);
 return{state,audit,requestAudit,tickets,balance,connected,pending,error,now,verified,bet,history:history?.rounds??[],carry:history?.carry};
}
