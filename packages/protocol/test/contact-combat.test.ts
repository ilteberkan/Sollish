import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulateContactCombat, sweepSphere, separateBodies, contactFrameAt, CONTACT_INITIAL, COMBAT_V3_DURATION_MS, CONTACT_TICK_MS, COMBAT_V3_VERSION } from '../src/combat-v3';
import { CONNECTOME_POLICY_INFO } from '../src/connectome-policy';
const seed = (i: number) => createHash('sha256').update(`contact-fixture-${i}`).digest('hex');

test('contact sweep catches between-frame hits, tangent and initial overlap without inventing distant hits', () => {
  assert.equal(sweepSphere({x:-10,y:0,z:0},{x:10,y:0,z:0},{x:0,y:0,z:0},2),0.4);
  assert.equal(sweepSphere({x:-10,y:2,z:0},{x:10,y:2,z:0},{x:0,y:0,z:0},2),0.5);
  assert.equal(sweepSphere({x:0,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0},2),0);
  assert.equal(sweepSphere({x:-10,y:3,z:0},{x:10,y:3,z:0},{x:0,y:0,z:0},2),null);
  assert.equal(sweepSphere({x:5,y:0,z:0},{x:5,y:0,z:0},{x:0,y:0,z:0},2),null);
});
test('overlap projection separates coincident bodies symmetrically at integer coordinates', () => {
  for(const positions of [[0,0,0,0],[-100,20,100,20],[30,20,30,40]]){
    const a={x:positions[0],z:positions[1]},b={x:positions[2],z:positions[3]},center={x:a.x+b.x,z:a.z+b.z};
    separateBodies(a,b);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=640);assert.equal(a.x+b.x,center.x);assert.equal(a.z+b.z,center.z);assert.ok(Object.values(a).every(Number.isInteger));
  }
});
test('replay is deterministic with fixed initial state and pinned learned-model identity', () => {
  const initial={health:{kor:700,ayaz:920},stamina:{kor:430,ayaz:650}},copy=structuredClone(initial);
  const a=simulateContactCombat(seed(0),initial),b=simulateContactCombat(seed(0),initial);
  assert.deepEqual(a,b);assert.deepEqual(initial,copy);assert.equal(a.version,COMBAT_V3_VERSION);assert.equal(a.policy,CONNECTOME_POLICY_INFO.version);
  assert.ok(COMBAT_V3_VERSION.endsWith(CONNECTOME_POLICY_INFO.modelSha256.slice(0,8)));assert.equal(a.frames.length,COMBAT_V3_DURATION_MS/CONTACT_TICK_MS+1);
  assert.equal(a.frames[0].kor.health,700);assert.equal(a.frames[0].ayaz.health,920);
  const old=a.frames[1].kor.pose.leftHand.x;a.frames[0].kor.pose.leftHand.x=-99999;assert.equal(a.frames[1].kor.pose.leftHand.x,old);
});
test('every health decrement across sampled replays comes from same-tick recorded contact damage', () => {
  for(let i=0;i<8;i++){
    const replay=simulateContactCombat(seed(i));let previous={kor:1000,ayaz:1000};
    for(const frame of replay.frames){
      for(const side of ['kor','ayaz'] as const){
        const a=frame[side],damage=replay.events.filter(e=>e.tick===frame.tick&&e.target===side&&(e.type==='hit'||e.type==='block')).reduce((sum,e)=>sum+e.damage,0);
        assert.equal(a.health,Math.max(0,previous[side]-damage));previous[side]=a.health;
        assert.ok(a.health>=0&&a.health<=1000);assert.ok(a.stamina>=0&&a.stamina<=1000);assert.ok(Number.isInteger(a.x)&&Number.isInteger(a.z));
        assert.ok(Math.abs(a.x)<=3250&&Math.abs(a.z)<=2200);
        for(const p of Object.values(a.pose))assert.ok(Object.values(p).every(Number.isInteger));
      }
      assert.ok(Math.hypot(frame.kor.x-frame.ayaz.x,frame.kor.z-frame.ayaz.z)>=640,'fighter collision roots remain separated');
    }
    for(const hit of replay.events.filter(e=>e.type==='hit'||e.type==='block')){
      assert.ok(hit.impact&&hit.limb&&hit.bodyPart);assert.ok(hit.damage>0);assert.deepEqual(hit.impact,replay.frames[hit.tick][hit.actor].pose[hit.limb!]);
    }
  }
});
test('first clean hit and finish markets derive only from complete event history', () => {
  for(let i=0;i<8;i++){
    const replay=simulateContactCombat(seed(i)),hits=replay.events.filter(e=>e.type==='hit'),first=hits[0];
    assert.equal(replay.firstHit,!first?'none':hits.some(e=>e.tick===first.tick&&e.actor!==first.actor)?'simultaneous':first.actor);
    assert.equal(replay.knockdown,replay.events.some(e=>e.type==='knockdown')?'yes':'no');
    assert.equal(replay.finish,replay.events.some(e=>e.type==='finish')?'stoppage':'decision');
    if(replay.finish==='decision'){
      const damage=(side:string)=>replay.events.filter(e=>e.actor===side&&(e.type==='hit'||e.type==='block')).reduce((sum,e)=>sum+e.damage,0);
      const k=damage('kor'),a=damage('ayaz');assert.equal(replay.winner,k===a?'draw':k>a?'kor':'ayaz');
    }
  }
});
test('actual low-health contact freezes combat facts after stoppage while presentation may recover', () => {
  const replay=simulateContactCombat(seed(0),{health:{kor:1,ayaz:1},stamina:CONTACT_INITIAL.stamina});
  assert.equal(replay.finish,'stoppage');const ended=replay.events.find(e=>e.type==='finish')!.tick;
  for(const frame of replay.frames.slice(ended))for(const side of ['kor','ayaz'] as const)for(const key of ['x','z','health','stamina','hits','knockdowns'] as const)assert.equal(frame[side][key],replay.frames[ended][side][key]);
  assert.ok(replay.events.every(event=>event.tick<=ended));
  assert.equal(contactFrameAt(replay,-1),replay.frames[0]);assert.equal(contactFrameAt(replay,Infinity),replay.frames[0]);assert.equal(contactFrameAt(replay,90000),replay.frames.at(-1));
});
test('invalid external seed or initial fighter state fails before simulation', () => {
  for(const bad of ['', 'A'.repeat(64),'0'.repeat(63)])assert.throws(()=>simulateContactCombat(bad),TypeError);
  for(const value of [0,-1,1001,1.5,NaN,Infinity])assert.throws(()=>simulateContactCombat(seed(0),{health:{kor:value,ayaz:1000},stamina:CONTACT_INITIAL.stamina}),TypeError);
});
