import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateCombat, combatFrameAt, COMBAT_DURATION_MS, COMBAT_TICK_MS } from '../src/combat';
const seed=(i:number)=>createHash('sha256').update(`combat-verification-${i}`).digest('hex');
test('replay is deterministic and independent of browser time, bets and frame rate',()=>{
 const replay=simulateCombat(seed(1));assert.deepEqual(replay,simulateCombat(seed(1)));assert.notDeepEqual(replay.frames,simulateCombat(seed(2)).frames);
 assert.equal(replay.frames.length,COMBAT_DURATION_MS/COMBAT_TICK_MS+1);
 assert.deepEqual(combatFrameAt(replay,NaN),replay.frames[0]);assert.deepEqual(combatFrameAt(replay,Infinity),replay.frames[0]);assert.deepEqual(combatFrameAt(replay,999999),replay.frames.at(-1));
 assert.throws(()=>simulateCombat('not-a-seed'));
});
test('300 seeded bouts obey physical, event and mirrored-fighter invariants',()=>{
 const seen=new Set<string>();
 for(let i=0;i<300;i++){
  const s=seed(i),a=simulateCombat(s),mirror=simulateCombat(s.slice(16,32)+s.slice(0,16)+s.slice(32));
  assert.equal(a.winner==='kor'?'ayaz':a.winner==='ayaz'?'kor':'draw',mirror.winner);
  for(let j=0;j<a.frames.length;j++)for(const id of ['kor','ayaz'] as const){const f=a.frames[j][id],m=mirror.frames[j][id==='kor'?'ayaz':'kor'];
   assert.equal(f.health,m.health);assert.equal(f.stamina,m.stamina);assert.equal(f.x, -m.x||0);assert.equal(f.z,-m.z||0);
   assert.ok(Number.isInteger(f.x)&&Math.abs(f.x)<=3300&&Math.abs(f.z)<=2300);assert.ok(f.health>=0&&f.health<=1000&&f.stamina>=0&&f.stamina<=1000);seen.add(f.action);
  }
  const first=a.events.find(e=>e.type==='hit');assert.equal(a.firstHit,!first?'none':a.events.filter(e=>e.type==='hit'&&e.tick===first.tick).length>1?'simultaneous':first.actor);
  assert.equal(a.knockdown,a.events.some(e=>e.type==='knockdown')?'yes':'no');assert.equal(a.finish,a.events.some(e=>e.type==='finish')?'stoppage':'decision');
 }
 for(const action of ['advance','retreat','circle','slip','jab','cross','hook','kick','down'])assert.ok(seen.has(action),action);
});
