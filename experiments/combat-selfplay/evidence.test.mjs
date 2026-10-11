import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, sha } from './environment.mjs';
import { clusteredScoreInterval } from './analyse.mjs';

const base=resolve(ROOT,'experiments/combat-selfplay/evidence');
async function recordedSourceHash(file,digest){const current=sha(await readFile(resolve(ROOT,'experiments/combat-selfplay',file)));return current===digest?current:sha(await readFile(resolve(base,'source-archive',`${digest}.mjs`)));}
test('completed training evidence pins current sources and models and retains failure without weakening thresholds',async()=>{
  const report=JSON.parse(await readFile(resolve(base,'evaluation.json'))),plan=await readFile(resolve(ROOT,'experiments/combat-selfplay/plan.json'));
  assert.equal(report.planSha256,sha(plan));assert.ok(report.finishedAt);
  for(const [file,digest]of Object.entries(report.sources))assert.equal(await recordedSourceHash(file,digest),digest);
  for(const [variant,result]of Object.entries(report.variants)){
    assert.equal(sha(await readFile(resolve(base,`${variant}-model.json`))),result.modelSha256);
    assert.equal(result.trainingEpisodes,2304);assert.equal(result.completedGenerations,24);
    assert.equal(result.learned.episodes,256);assert.equal(result.initial.episodes,256);
  }
  assert.equal(report.variants.connectome.researchGate,'FAIL');assert.equal(report.variants.connectome.checks.actionEntropy,false);
  assert.equal(report.deploymentGate,'CLOSED');
});
test('public preview has explicit research identity and hash-bound paired traces with coherent event damage',async()=>{
  for(const folder of ['preview','curriculum-2/preview','guarded-contact-1/preview']){
  const manifest=JSON.parse(await readFile(resolve(base,folder,'manifest.json')));assert.equal(manifest.promotionPassed,false);
  assert.equal(manifest.cases.length,3);
  for(const example of manifest.cases)for(const run of example.runs){
    const filename=run.path.split('/').at(-1);assert.match(filename,/^[a-z0-9-]+\.json$/);
    const bytes=await readFile(resolve(base,folder,filename));assert.equal(bytes.length,run.bytes);assert.equal(sha(bytes),run.sha256);
    const replay=JSON.parse(bytes);assert.ok(replay.version.startsWith('research:'));assert.equal(replay.seed,example.seed);assert.equal(replay.frames.length,901);
    for(let tick=1;tick<901;tick++)for(const side of ['kor','ayaz']){
      const damage=replay.events.filter(e=>e.tick===tick&&e.target===side&&(e.type==='hit'||e.type==='block')).reduce((s,e)=>s+e.damage,0);
      assert.equal(replay.frames[tick][side].health,Math.max(0,replay.frames[tick-1][side].health-damage));
    }
  }
  }
});
test('analysis clusters both sides and opponent types by seed, with a zero-difference control',()=>{
  const rows=Array.from({length:32},()=>({win:1,draw:0}));
  const result=clusteredScoreInterval({a:{learnedEpisodes:rows,initialEpisodes:rows},b:{learnedEpisodes:rows,initialEpisodes:rows}});
  assert.equal(result.seedClusters,16);assert.equal(result.scoreImprovement,0);assert.deepEqual(result.bootstrap95,[0,0]);
});
test('later curriculum and guarded runs preserve source/model identity and display the correct learned baseline',async()=>{
  for(const [folder,key,baseline]of [['curriculum-2','curriculum','v1'],['guarded-contact-1','guarded','warm']]){
    const report=JSON.parse(await readFile(resolve(base,folder,'evaluation.json'))),manifest=JSON.parse(await readFile(resolve(base,folder,'preview/manifest.json')));
    assert.equal(sha(await readFile(resolve(base,folder,'model.json'))),report.modelSha256);
    for(const [file,digest]of Object.entries(report.sources))assert.equal(await recordedSourceHash(file,digest),digest);
    assert.equal(manifest.beforeScore,undefined); // Score is explicitly under the evaluation object.
    const before=report.comparisons[baseline].summary,after=report.comparisons[key].summary;
    assert.equal(manifest.evaluation.beforeScore,before.winRate+.5*before.drawRate);assert.equal(manifest.evaluation.afterScore,after.winRate+.5*after.drawRate);
    assert.equal(report.researchGate,'FAIL');assert.equal(manifest.promotionPassed,false);assert.equal(report.deploymentGate,'CLOSED');
    assert.equal(report.checks.attackTypes,false);assert.equal(report.checks.overrides,false);
  }
});
