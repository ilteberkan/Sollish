import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepCapsule, researchElbow, researchGuardShapes, researchSweep } from './guard-geometry.mjs';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadEnvironment,episodeSeed } from './environment.mjs';

test('finite capsule catches its shaft, endpoints, initial overlap and rejects misses',()=>{
  const a={x:0,y:0,z:0},b={x:0,y:100,z:0};
  assert.equal(sweepCapsule({x:50,y:50,z:0},{x:-50,y:50,z:0},a,b,10),.4);
  assert.equal(sweepCapsule({x:0,y:50,z:0},{x:100,y:50,z:0},a,b,10),0);
  assert.equal(sweepCapsule({x:50,y:130,z:0},{x:-50,y:130,z:0},a,b,10),null);
  assert.equal(sweepCapsule({x:0,y:120,z:0},{x:0,y:100,z:0},a,b,10),.5);
  assert.equal(sweepCapsule({x:50,y:0,z:0},{x:-50,y:0,z:0},a,a,10),.4);
  assert.throws(()=>sweepCapsule(a,b,a,b,NaN),/INVALID/);
});
test('high guard elbows stay on measured two-link reach and striking arm cannot be a shield',()=>{
  const shoulder={x:-198,y:1423,z:-138},hand={x:-140,y:1600,z:260},elbow=researchElbow(shoulder,hand,{x:-350,y:1280,z:20});
  assert.ok(Math.abs(Math.hypot(elbow.x-shoulder.x,elbow.y-shoulder.y,elbow.z-shoulder.z)-265)<1);
  assert.ok(Math.abs(Math.hypot(elbow.x-hand.x,elbow.y-hand.y,elbow.z-hand.z)-347)<1);
  const pose={leftHand:hand,leftElbow:elbow,rightHand:{...hand,x:140},rightElbow:{...elbow,x:250}};
  assert.equal(researchGuardShapes({action:'guard',pose}).length,4);
  const jab=researchGuardShapes({action:'jab',pose});assert.equal(jab.length,2);assert.equal(jab[0].center,pose.rightHand);
  const cross=researchGuardShapes({action:'cross',pose});assert.equal(cross[0].center,pose.leftHand);
  assert.equal(researchGuardShapes({action:'advance',pose}).length,0);
  assert.throws(()=>researchElbow(shoulder,{x:2000,y:1600,z:260},hand),/REACH/);
});
test('specific center-high straight sweep fits old guard gap but meets the new guard before the head',()=>{
  const from={x:0,y:1650,z:800},to={x:0,y:1650,z:0};
  const head=researchSweep(from,to,{center:{x:0,y:1670,z:0},radius:130},85);
  assert.ok(head!==null);
  for(const x of [-180,180])assert.equal(researchSweep(from,to,{center:{x,y:1460,z:300},radius:120},85),null);
  for(const x of [-140,140]){const guard=researchSweep(from,to,{center:{x,y:1600,z:260},radius:120},85);assert.ok(guard!==null&&guard<head);}
});
test('research geometry has new identity and changes defense without rewriting frozen replay',async()=>{
  const old=await loadEnvironment(),next=await loadGuardedEnvironment(),seed=episodeSeed('guard-unit',4),controllers=[()=> 'cross',()=> 'guard'];
  const before=old.simulate(seed,old.initial,{controllers}),after=next.simulate(seed,next.initial,{controllers});
  assert.equal(after.version,'research:guarded-contact-1');assert.notEqual(before.version,after.version);
  assert.notEqual(old.engineSha256,next.engineSha256);
  const blocks=r=>r.events.filter(e=>e.actor==='kor'&&e.type==='block').length;
  assert.ok(blocks(after)>blocks(before));assert.ok(after.frames.at(-1).ayaz.health>before.frames.at(-1).ayaz.health);
  const kick=next.simulate(seed,next.initial,{controllers:[()=> 'kick',()=> 'guard']});
  assert.ok(kick.events.some(e=>e.actor==='kor'&&e.type==='hit'),'high guard must not grant torso/leg invulnerability');
  for(const replay of [after,kick])for(const side of ['kor','ayaz']){
    const strikes=replay.events.filter(e=>e.actor===side&&e.type==='strike');
    for(let i=0;i<strikes.length;i++){const end=strikes[i+1]?.tick??901;assert.ok(replay.events.filter(e=>e.actor===side&&['hit','block'].includes(e.type)&&e.tick>=strikes[i].tick&&e.tick<end).length<=1);}
  }
});
