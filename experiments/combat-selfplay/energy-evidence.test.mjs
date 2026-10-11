import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha } from './environment.mjs';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
test('energy training evidence pins sources/models and preserves the held-out failure',async()=>{
  const old=await read('./guarded-plan.json'),plan=await read('./energy-cem-plan.json'),training=await read('./evidence/energy-cem-6/training.json'),report=await read('./evidence/energy-cem-6/evaluation.json');
  assert.deepEqual(plan.gate,old.gate);assert.equal(report.modelSha256,sha(await readFile(new URL('./evidence/energy-cem-6/model.json',import.meta.url))));
  for(const [name,hash]of Object.entries(training.sources)){const current=sha(await readFile(new URL(name,import.meta.url)));assert.equal(current===hash?current:sha(await readFile(new URL(`./evidence/source-archive/${hash}.mjs`,import.meta.url))),hash);}
  assert.ok(Date.parse(report.evaluatedAt)>Date.parse(training.finishedAt));assert.equal(report.researchGate,'FAIL');assert.equal(report.deploymentGate,'CLOSED');
  assert.equal(report.checks.attackTypes,true);assert.equal(report.checks.overrides,true);assert.equal(report.checks.cleanHits,false);
  assert.equal(report.comparisons.energy.rows.length,24*2*12);assert.equal(Object.keys(report.comparisons.energy.perOpponent).length,12);
  const attempted=report.comparisons.energy.rows.reduce((s,r)=>s+r.lowStaminaAttackProposals,0);assert.equal(attempted,1);
  await assert.rejects(readFile(new URL('./evidence/energy-controller-4/evaluation.json',import.meta.url)),{code:'ENOENT'});await assert.rejects(readFile(new URL('./evidence/energy-refinement-5/evaluation.json',import.meta.url)),{code:'ENOENT'});
});
test('new paired traces preserve research identity, exact hash, chronological frames and contact damage',async()=>{
  const manifest=await read('./evidence/energy-cem-6/preview/manifest.json'),plan=await read('./energy-preview-plan.json'),report=await read('./evidence/energy-cem-6/evaluation.json');assert.equal(manifest.promotionPassed,false);assert.equal(manifest.cases.length,3);assert.ok(Date.parse(plan.declaredAt)<Date.parse(report.evaluatedAt));
  for(const example of manifest.cases)for(const run of example.runs){const path=`./evidence/energy-cem-6/preview/${run.path.split('/').at(-1)}`,bytes=await readFile(new URL(path,import.meta.url)),replay=JSON.parse(bytes);assert.equal(bytes.length,run.bytes);assert.equal(sha(bytes),run.sha256);assert.ok(replay.version.startsWith('research:energy-cem-6:'));assert.equal(replay.frames.length,901);assert.equal(replay.seed,example.seed);
    for(let tick=1;tick<901;tick++)for(const side of ['kor','ayaz']){assert.equal(replay.frames[tick].tick,tick);const damage=replay.events.filter(e=>e.tick===tick&&e.target===side&&(e.type==='hit'||e.type==='block')).reduce((s,e)=>s+e.damage,0);assert.equal(replay.frames[tick][side].health,Math.max(0,replay.frames[tick-1][side].health-damage));}
  }
  assert.equal(manifest.evaluation.beforeScore,report.comparisons.previousGuarded.summary.winRate);assert.equal(manifest.evaluation.afterScore,report.comparisons.energy.summary.winRate+.5*report.comparisons.energy.summary.drawRate);
});
