import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contactCommitmentInput, parseRingServer, RINGSIDE_MARKETS, type RingSnapshot, type ContactBout } from '../src/ringside';
import { CONTACT_INITIAL, COMBAT_V3_VERSION, COMBAT_V3_DURATION_MS } from '../src/combat-v3';
const initial=():RingSnapshot=>({v:2,type:'snapshot',revision:1,at:100000,round:{id:'8',phase:'open',openedAt:100000,closesAt:120000,startsAt:null,endsAt:null,nextAt:null,commitment:'b'.repeat(64),seed:null,engine:COMBAT_V3_VERSION,bout:{id:'7',round:2,score:{kor:1,ayaz:0},initial:structuredClone(CONTACT_INITIAL)},results:null},online:1,participants:0,total:0,count:0,pools:RINGSIDE_MARKETS.map(m=>({market:m.id,total:0,count:0,sides:Object.fromEntries(m.outcomes.map(o=>[o,0])),fee:0,distributed:0,status:'open'})),tape:[]});
const parse=(value:RingSnapshot)=>parseRingServer(JSON.stringify(value));
test('v3 parser requires coherent bout score/id, bounded carried state and engine-specific duration',()=>{
  assert.ok(parse(initial()));
  const cases:((s:RingSnapshot)=>void)[]=[s=>{delete s.round.bout;},s=>{s.round.bout!.score.ayaz=1;},s=>{s.round.bout!.id='6';},s=>{s.round.bout!.initial.health.kor=0;},s=>{s.round.bout!.initial.stamina.ayaz=1001;},s=>{s.round.bout!.round=4 as 3;}];
  for(const mutate of cases){const s=initial();mutate(s);assert.equal(parse(s),null);}
  const s=initial();Object.assign(s.round,{phase:'fighting',startsAt:120000,endsAt:120000+COMBAT_V3_DURATION_MS,nextAt:130000+COMBAT_V3_DURATION_MS,seed:'a'.repeat(64)});s.at=120000;s.pools.forEach(p=>{p.status='locked';});assert.ok(parse(s));s.round.endsAt!+=15000;s.round.nextAt!+=15000;assert.equal(parse(s),null);
});
test('open v3 frames cannot reveal future seed/result or smuggle private session data',()=>{
  for(const extra of [{seed:'a'.repeat(64)},{results:{winner:'kor','first-hit':'kor',knockdown:'no',finish:'decision'}},{session:'private'}]){const s=initial();Object.assign(s.round,extra);assert.equal(parse(s),null);}
});
test('commitment binds engine, round, seed, bout, previous score and every initial-state field',()=>{
  const bout=initial().round.bout!,seed='c'.repeat(64),hash=(id:string,s:string,b:ContactBout)=>createHash('sha256').update(contactCommitmentInput(id,s,b)).digest('hex'),original=hash('8',seed,bout);
  assert.notEqual(hash('9',seed,bout),original);assert.notEqual(hash('8','d'.repeat(64),bout),original);
  for(const mutate of [(b:ContactBout)=>{b.id='6';},(b:ContactBout)=>{b.round=3;},(b:ContactBout)=>{b.score.kor=0;},(b:ContactBout)=>{b.score.ayaz=1;},...(['health','stamina'] as const).flatMap(kind=>(['kor','ayaz'] as const).map(side=>(b:ContactBout)=>{b.initial[kind][side]--; }))]){const b=structuredClone(bout);mutate(b);assert.notEqual(hash('8',seed,b),original);}
  assert.ok(contactCommitmentInput('8',seed,bout).includes(COMBAT_V3_VERSION));
});
