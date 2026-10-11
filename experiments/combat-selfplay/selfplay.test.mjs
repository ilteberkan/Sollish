import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvironment, adaptSource, ROOT, episodeSeed } from './environment.mjs';
import { loadReservoir, initialParameters, createController, PARAMETERS, ACTIONS } from './policy.mjs';
import { episode, trainVariant } from './train.mjs';

test('adapter is pinned, default replay is identical to frozen engine and headless keeps all events/results',async()=>{
  const env=await loadEnvironment();
  // Native TS module uses the same frozen runtime; no source edits needed.
  const original=await import('../../packages/protocol/src/combat-v3.ts');
  for(const n of [12,49]){
    const seed=episodeSeed('parity',n),baseline=original.simulateContactCombat(seed),full=env.simulate(seed);
    assert.deepEqual(full,baseline);
    const headless=env.simulate(seed,env.initial,{recordFrames:false});
    assert.deepEqual({...headless,frames:[]},{...baseline,frames:[]});
    assert.deepEqual(headless.frames,[baseline.frames[0],baseline.frames.at(-1)]);
  }
  const source=await readFile(resolve(ROOT,'packages/protocol/src/combat-v3.ts'),'utf8');
  assert.throws(()=>adaptSource(source+' '),/HASH_MISMATCH/);
});
test('real graph policies use isolated episode state and reject nonfinite observations',async()=>{
  const graph=await loadReservoir(),params=initialParameters(),a=createController(params,graph),b=createController(params,graph),x=Array(10).fill(0);
  assert.equal(graph.pre.length,4949);assert.equal(params.length,PARAMETERS);
  const first=a(x);params.fill(999);assert.equal(first,b(x));
  assert.throws(()=>a([...x.slice(1),NaN]),/BAD_OBSERVATION/);
  for(let n=0;n<20;n++)assert.ok(ACTIONS.includes(a(x)));
});
test('policy choices produce actual different contact and damage outcomes; no teacher label path',async()=>{
  const env=await loadEnvironment(),graph=await loadReservoir(),a=new Float64Array(PARAMETERS),b=new Float64Array(PARAMETERS);
  a[2*139]=10;b[7*139]=10;
  const seed=episodeSeed('unit',42),guard=episode(env,graph,a,'jab-only',seed,0,true),kick=episode(env,graph,b,'jab-only',seed,0,true);
  assert.notDeepEqual(guard.replay.events,kick.replay.events);assert.notEqual(guard.metrics.damageDealt,kick.metrics.damageDealt);
  for(const result of [guard,kick])assert.equal(result.metrics.damageDealt,1000-result.replay.frames.at(-1).ayaz.health);
  assert.equal(kick.metrics.ringViolations,0);
});
test('bounded ES actually changes parameters from episode rewards and uses immutable checkpoints',async()=>{
  const env=await loadEnvironment(),plan=JSON.parse(await readFile(resolve(ROOT,'experiments/combat-selfplay/plan.json'),'utf8'));
  const tiny={...plan,generations:2,directions:2,trainingEpisodesPerCandidate:2,validationEvery:1,validationSeeds:[21000],validationOpponents:['initial']};
  const result=await trainVariant(env,'connectome',tiny,performance.now()+30000);
  assert.equal(result.trainingEpisodes,16);assert.equal(result.checkpoints.length,2);
  assert.notDeepEqual(result.checkpoints[0].parameters,Array.from(result.initial));
  assert.notDeepEqual(result.checkpoints[0].parameters,result.checkpoints[1].parameters);
  assert.equal(result.history[2].poolSize,2);
  assert.ok(result.history.every(row=>!Object.hasOwn(row,'labels')));
});
