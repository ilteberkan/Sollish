import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, loadEnvironment, episodeSeed, sha } from './environment.mjs';
import { loadReservoir, PARAMETERS } from './policy.mjs';
import { curriculumEpisode, curriculumOpponent, curriculumAggregate } from './curriculum.mjs';

test('second pre-registration retains original thresholds, pins warm start and separates all partitions',async()=>{
  const old=JSON.parse(await readFile(resolve(ROOT,'experiments/combat-selfplay/plan.json'))),plan=JSON.parse(await readFile(resolve(ROOT,'experiments/combat-selfplay/curriculum-plan.json')));
  assert.equal(plan.gate.originalWinImprovementOverRandom,old.researchGate.winRateImprovementOverInitial);
  assert.equal(plan.gate.originalDamageMarginImprovementOverRandom,old.researchGate.meanDamageMarginImprovement);
  assert.equal(plan.gate.originalActionEntropyMinimum,old.researchGate.meanActionEntropyMinimum);
  assert.equal(plan.gate.originalMaxNoStrikeMs,old.researchGate.maxNoStrikeMs);
  assert.equal(plan.warmStartModelSha256,sha(await readFile(resolve(ROOT,'experiments/combat-selfplay/evidence/connectome-model.json'))));
  assert.ok(plan.finalTestSeeds.every(s=>!plan.validationSeeds.includes(s)&&!old.finalTestSeeds.includes(s)));
  assert.notEqual(episodeSeed('curriculum-final',90000),episodeSeed('curriculum-train',90000));
});
test('real rollout attributes low-energy proposals, contacts and attack variety to engine events',async()=>{
  const env=await loadEnvironment(),graph=await loadReservoir(),theta=new Float64Array(PARAMETERS);theta[5*139]=10;
  const {metrics,replay}=curriculumEpisode(env,graph,theta,'cross-only',episodeSeed('curriculum-unit',1),0,true);
  assert.ok(metrics.lowStaminaAttackProposals>0);assert.ok(metrics.forcedFraction>0);
  assert.equal(metrics.cleanHits,replay.events.filter(e=>e.actor==='kor'&&e.type==='hit').length);
  assert.equal(metrics.attackCounts.cross,replay.events.filter(e=>e.actor==='kor'&&e.type==='strike'&&e.technique==='cross').length);
  assert.equal(metrics.attackEntropy,0);assert.equal(metrics.attackTechniques,1);
  assert.equal(curriculumAggregate([metrics]).meanCleanHits,metrics.cleanHits);
  assert.equal(metrics.ringViolations,0);
});
test('held-out counters carry independent observable history and cannot mutate inputs',()=>{
  const a=curriculumOpponent('heldout-delayed-counter'),b=curriculumOpponent('heldout-delayed-counter'),x=Object.freeze([-.6,.8,1,1,-1,-1,0,-1,-1,0]);
  assert.equal(a(x),'guard');
  const calm=Object.freeze([-.6,.8,1,-1,-1,-1,0,-1,-1,0]);
  assert.equal(a(calm),'guard');assert.equal(b(calm),'hook');assert.equal(a(calm),'hook');
});
