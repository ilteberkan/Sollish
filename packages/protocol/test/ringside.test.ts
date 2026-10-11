import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_VERSION } from '../src/combat';
import { RINGSIDE_MARKETS, parseRingClient, parseRingServer, type RingSnapshot, type RingTicket } from '../src/ringside';
const now=1_800_000_000_000,id='12',uuid='11111111-1111-4111-8111-111111111111';
const snapshot=():RingSnapshot=>({v:2,type:'snapshot',revision:1,at:now,round:{id,phase:'open',openedAt:now,closesAt:now+20000,startsAt:null,endsAt:null,nextAt:null,commitment:'a'.repeat(64),seed:null,engine:COMBAT_VERSION,results:null},online:1,participants:0,total:0,count:0,tape:[],pools:RINGSIDE_MARKETS.map(m=>({market:m.id,total:0,count:0,sides:Object.fromEntries(m.outcomes.map(o=>[o,0])),fee:0,distributed:0,status:'open'}))});
const parse=(x:unknown)=>parseRingServer(JSON.stringify(x));
test('v2 commands close the money/state/identity allowlist and separate markets',()=>{
 const command={v:2,type:'bet',id:uuid,roundId:id,market:'first-hit',outcome:'simultaneous',amount:100};assert.deepEqual(parseRingClient(JSON.stringify(command)),command);
 for(const patch of [{amount:99},{amount:50001},{amount:1.5},{market:'unlisted'},{outcome:'red-card'},{roundId:'0'},{id:'x'},{wallet:'x'},{winner:'kor'},{time:now},{amount:-100}])assert.equal(parseRingClient(JSON.stringify({...command,...patch})),null);
 assert.ok(parseRingClient(JSON.stringify({v:2,type:'audit',roundId:id})));assert.equal(parseRingClient(JSON.stringify({v:2,type:'session',token:'a'.repeat(63)})),null);
});
test('snapshot binds schedule, engine, public pool sums, unique markets and admission-only tape',()=>{
 const value=snapshot();assert.deepEqual(parse(value),value);
 for(const mutate of [(x:RingSnapshot)=>x.round.seed='b'.repeat(64),(x:RingSnapshot)=>x.round.closesAt++,(x:RingSnapshot)=>x.total=1,(x:RingSnapshot)=>x.count=1,(x:RingSnapshot)=>x.online=257,(x:RingSnapshot)=>x.pools.reverse(),(x:RingSnapshot)=>x.pools[0].sides.kor=20]){const x=snapshot();mutate(x);assert.equal(parse(x),null);}
 const x=snapshot();x.count=1;x.participants=1;x.total=100;x.pools[0].count=1;x.pools[0].total=100;x.pools[0].sides.kor=100;x.tape=[{seq:1,alias:'S-123456789ABC',market:'winner',outcome:'kor',amount:100,acceptedAt:now,status:'accepted',payout:0}];assert.ok(parse(x));
 assert.equal(parse({...x,tape:[{...x.tape[0],acceptedAt:x.round.closesAt}]}),null);assert.equal(parse({...x,tape:[{...x.tape[0],session:'private'}]}),null);assert.equal(parse({...x,tape:[...x.tape,...x.tape]}),null);
});
test('result frames require pool conservation; audit has no private identities or unbounded history',()=>{
 const x=snapshot();x.round={...x.round,phase:'result',seed:'b'.repeat(64),startsAt:now+20000,endsAt:now+80000,nextAt:now+90000,results:{winner:'kor','first-hit':'simultaneous',knockdown:'yes',finish:'stoppage'}};x.at=now+80000;x.pools.forEach(p=>p.status='refunded');assert.ok(parse(x));
 x.pools[0].fee=1;assert.equal(parse(x),null);
 const entry={seq:1,alias:'S-123456789ABC',market:'winner',outcome:'kor',amount:100,acceptedAt:now,status:'refunded',payout:100};assert.ok(parse({v:2,type:'audit',roundId:id,entries:[entry]}));assert.equal(parse({v:2,type:'audit',roundId:id,entries:[{...entry,payout:99}]}),null);
 assert.equal(parse({v:2,type:'audit',roundId:id,entries:Array.from({length:257},(_,i)=>({...entry,seq:258-i}))}),null);
});
test('pooled payout may exceed fixed odds; refunds equal stake and private tickets are bounded',()=>{
 const t:RingTicket={id:uuid,roundId:id,market:'winner',outcome:'kor',amount:100,status:'paid',payout:9999};assert.ok(parse({v:2,type:'ticket',ticket:t}));assert.equal(parse({v:2,type:'ticket',ticket:{...t,status:'accepted'}}),null);assert.equal(parse({v:2,type:'ticket',ticket:{...t,status:'refunded'}}),null);
 assert.equal(parse({v:2,type:'session',balance:100,expires:now,tickets:[t,t]}),null);
});
