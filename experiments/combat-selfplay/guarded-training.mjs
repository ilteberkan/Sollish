/** Separate versioned refinement. Derived from the preserved curriculum-2 runner; no live v3 edits. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { episodeSeed, sha } from './environment.mjs';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { createController, initialParameters, loadReservoir, PARAMETERS, ACTIONS, random, GRAPH_SHA } from './policy.mjs';
import { summarizeEpisode, aggregate } from './metrics.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const ATTACKS=['jab','cross','hook','kick'];
const COST={jab:90,cross:130,hook:145,kick:185};
export function curriculumOpponent(name) {
  let t=0,threatMemory=0;
  return x=>{
    t++;
    if(name==='cross-only')return 'cross';
    if(name==='hook-only')return 'hook';
    if(name==='guard')return 'guard';
    if(name==='counter')return x[3]>0?'slip':x[4]>0?'cross':'jab';
    if(name==='punisher')return x[4]>0?'cross':x[3]>0?'guard':'hook';
    if(name==='mixed')return ATTACKS[t%4];
    if(name==='heldout-delayed-counter'){threatMemory=x[3]>0?2:Math.max(0,threatMemory-1);return threatMemory>0?'guard':x[4]>0?'cross':'hook';}
    if(name==='heldout-combo')return ['jab','jab','cross','kick','hook','slip'][t%6];
    if(name==='heldout-energy')return x[1]<-.2?'guard':x[3]>0?'slip':x[4]>0?'cross':'hook';
    if(name==='heldout-ring')return x[5]>0?'circle':x[3]>0?'guard':t%3===0?'cross':'hook';
    throw new Error('UNKNOWN_CURRICULUM_OPPONENT');
  };
}
export function curriculumEpisode(env,reservoir,theta,opponent,seed,side,full=false) {
  const stateful=createController(theta,reservoir),decisions=[];let lastObservation=null,lowStaminaAttackProposals=0;
  const own=x=>{lastObservation=x;return stateful(x);};
  const other=opponent===null?null:typeof opponent==='string'?curriculumOpponent(opponent):createController(opponent,reservoir);
  const replay=env.simulate(seed,env.initial,{controllers:side===0?[own,other]:[other,own],recordFrames:full,onDecision:(i,tick,proposed,effective)=>{
    decisions.push({side:i,tick,proposed,effective});
    if(i===side&&Object.hasOwn(COST,proposed)&&(lastObservation[1]+1)*500<COST[proposed])lowStaminaAttackProposals++;
  }});
  const metrics=summarizeEpisode(replay,side,decisions),id=side===0?'kor':'ayaz',counts=ATTACKS.map(a=>replay.events.filter(e=>e.actor===id&&e.type==='strike'&&e.technique===a).length),total=counts.reduce((s,x)=>s+x,0);
  const attackEntropy=Math.max(0,-counts.filter(Boolean).map(n=>n/total).reduce((s,p)=>s+p*Math.log(p),0)/Math.log(4)),attackTechniques=counts.filter(n=>n>=2).length;
  const cleanHits=replay.events.filter(e=>e.actor===id&&e.type==='hit').length;
  const reward=.6*(metrics.win-metrics.loss)+.0015*(metrics.damageDealt-metrics.damageReceived)+.9*attackEntropy+.5*attackTechniques/4-.9*metrics.forcedFraction-.3*metrics.noContactMs/45000;
  return {replay,metrics:{...metrics,reward,attackEntropy,attackTechniques,cleanHits,lowStaminaAttackProposals,attackCounts:Object.fromEntries(ATTACKS.map((a,i)=>[a,counts[i]]))}};
}
export function curriculumAggregate(rows) {
  const mean=key=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
  return {...aggregate(rows),meanAttackEntropy:mean('attackEntropy'),meanAttackTechniques:mean('attackTechniques'),meanCleanHits:mean('cleanHits'),meanLowStaminaAttackProposals:mean('lowStaminaAttackProposals'),threeTechniqueEpisodeFraction:rows.filter(r=>r.attackTechniques>=3).length/rows.length};
}
function mean(values){return values.reduce((s,x)=>s+x,0)/values.length;}
function evaluate(env,reservoir,theta,warm,opponents,seeds,partition,full=false){const rows=[];for(const name of opponents)for(const id of seeds)for(const side of [0,1])rows.push({...curriculumEpisode(env,reservoir,theta,name==='warm-learner'?warm:name==='frozen-v3'?null:name,episodeSeed(partition,id),side,full).metrics,opponent:name,seedId:id,side});return{summary:curriculumAggregate(rows),rows};}
export async function runGuarded(){
  const startedAt=new Date().toISOString(),started=performance.now(),planBytes=await readFile(resolve(HERE,'guarded-plan.json')),plan=JSON.parse(planBytes),warmBytes=await readFile(resolve(HERE,'evidence/curriculum-2/model.json'));
  if(sha(warmBytes)!==plan.warmStartModelSha256)throw new Error('WARMSTART_HASH');
  const warm=JSON.parse(warmBytes).parameters,env=await loadGuardedEnvironment(),reservoir=await loadReservoir(),out=resolve(HERE,'evidence/guarded-contact-1');await mkdir(out,{recursive:true});
  if(env.engineSha256!==plan.expectedEnvironmentSha256)throw new Error('GUARDED_ENVIRONMENT_HASH');
  const sources={};for(const name of ['guarded-training.mjs','guarded-plan.json','guard-geometry.mjs','guarded-environment.mjs','policy.mjs','environment.mjs','metrics.mjs'])sources[name]=sha(await readFile(resolve(HERE,name)));
  await writeFile(resolve(out,'run-plan.json'),JSON.stringify({startedAt,plan,planSha256:sha(planBytes),sources,engineSha256:env.engineSha256,adapterSha256:env.adapterSha256,baseEngineSha256:env.baseEngineSha256,geometrySha256:env.geometrySha256},null,2)+'\n');
  const theta=Float64Array.from(warm),rng=random(plan.seed),m=new Float64Array(PARAMETERS),v=new Float64Array(PARAMETERS),pool=[Float64Array.from(warm)],history=[],checkpoints=[];
  let best=Float64Array.from(theta),selectedGeneration=0,completed=0,episodes=0;
  let bestValidation=evaluate(env,reservoir,theta,warm,plan.validationOpponents,plan.validationSeeds,'guarded-validation').summary;
  history.push({generation:0,validation:bestValidation,selected:true,poolSize:pool.length});
  for(let generation=1;generation<=plan.generations;generation++){
    if(performance.now()-started>plan.maxRunSeconds*1000)break;
    const opponents=[warm,['cross-only','counter','guard','punisher','mixed'][(generation-1)%5],pool[(generation-1)%pool.length]],noise=[],returns=[];
    for(let d=0;d<plan.directions;d++){
      const epsilon=Float64Array.from({length:PARAMETERS},()=>rng.normal()),pair=[];noise.push(epsilon);
      for(const sign of [1,-1]){
        const candidate=Float64Array.from(theta,(x,j)=>x+sign*plan.sigma*epsilon[j]),rewards=[];
        for(let j=0;j<3;j++)for(const side of [0,1]){rewards.push(curriculumEpisode(env,reservoir,candidate,opponents[j],episodeSeed('guarded-train',generation*100+j),side).metrics.reward);episodes++;}
        pair.push(mean(rewards));
      }
      returns.push(pair);
    }
    const avg=mean(returns.flat()),std=Math.max(1e-6,Math.sqrt(mean(returns.flat().map(x=>(x-avg)**2)))),gradient=new Float64Array(PARAMETERS);
    for(let d=0;d<plan.directions;d++)for(let j=0;j<PARAMETERS;j++)gradient[j]+=(returns[d][0]-returns[d][1])*noise[d][j]/(2*plan.directions*plan.sigma*std);
    for(let j=0;j<PARAMETERS;j++){m[j]=.9*m[j]+.1*gradient[j];v[j]=.999*v[j]+.001*gradient[j]**2;theta[j]+=plan.learningRate*(m[j]/(1-.9**generation))/(Math.sqrt(v[j]/(1-.999**generation))+1e-8);if(!Number.isFinite(theta[j]))throw new Error('NONFINITE_PARAMETERS');}
    completed=generation;const row={generation,trainingReward:avg,episodes,poolSize:pool.length};
    if(generation%plan.validationEvery===0||generation===plan.generations){
      row.validation=evaluate(env,reservoir,theta,warm,plan.validationOpponents,plan.validationSeeds,'guarded-validation').summary;row.selected=row.validation.meanReward>bestValidation.meanReward;
      if(row.selected){best=Float64Array.from(theta);selectedGeneration=generation;bestValidation=row.validation;}
      pool.push(Float64Array.from(theta));checkpoints.push({generation,parameters:Array.from(theta)});console.log(JSON.stringify({generation,selectedGeneration,validationReward:row.validation.meanReward,attackTypes:row.validation.meanAttackTechniques,overrides:row.validation.meanForcedFraction,episodes}));
    }
    history.push(row);
  }
  const trainingMs=performance.now()-started,model={schemaVersion:1,experiment:plan.experiment,variant:'connectome',engineSha256:env.engineSha256,graphSha256:GRAPH_SHA,warmStartModelSha256:plan.warmStartModelSha256,selectedGeneration,features:139,actions:ACTIONS,parameters:Array.from(best),training:'real episode reward, historical self-play, explicit curriculum and diversity/override regularization; no teacher labels'};
  const modelBytes=JSON.stringify(model,null,2)+'\n',modelSha256=sha(modelBytes);
  await writeFile(resolve(out,'model.json'),modelBytes);await writeFile(resolve(out,'training.json'),JSON.stringify({history,checkpoints},null,2)+'\n');
  // All model/reward/checkpoint choices are frozen before accessing this fresh partition.
  const comparisons={};for(const [name,parameters]of [['random',initialParameters(171)],['warm',warm],['guarded',best]])comparisons[name]=evaluate(env,reservoir,parameters,warm,plan.finalOpponents,plan.finalTestSeeds,'guarded-final',true);
  const a=comparisons.guarded.summary,b=comparisons.random.summary,p=comparisons.warm.summary,g=plan.gate;
  const margin=x=>x.meanDamageDealt-x.meanDamageReceived;
  const checks={trainingCompleted:completed===plan.generations,actualSelfPlay:checkpoints.length>1,originalWin:a.winRate-b.winRate>=g.originalWinImprovementOverRandom,originalDamage:margin(a)-margin(b)>=g.originalDamageMarginImprovementOverRandom,originalEntropy:a.meanActionEntropy>=g.originalActionEntropyMinimum,originalNoStrike:a.maxNoStrikeMs<=g.originalMaxNoStrikeMs,improveWarmWin:a.winRate-p.winRate>=g.winImprovementOverWarm,improveWarmDamage:margin(a)-margin(p)>=g.damageMarginImprovementOverWarm,attackTypes:a.meanAttackTechniques>=g.meanAttackTechniquesMinimum,overrides:a.meanForcedFraction<=g.meanOverrideFractionMaximum,cleanHits:a.meanCleanHits>=g.meanCleanHitsMinimum,noContact:a.maxNoContactMs<=g.maxNoContactMs,stateBounds:a.ringViolations===g.stateViolations};
  const report={schemaVersion:1,experiment:plan.experiment,startedAt,finishedAt:new Date().toISOString(),planSha256:sha(planBytes),sources,engineSha256:env.engineSha256,adapterSha256:env.adapterSha256,baseEngineSha256:env.baseEngineSha256,geometrySha256:env.geometrySha256,modelSha256,selectedGeneration,completedGenerations:completed,trainingEpisodes:episodes,trainingMs,wallTimeMs:performance.now()-started,comparisons,checks,researchGate:Object.values(checks).every(Boolean)?'PASS':'FAIL',deploymentGate:'CLOSED',runtime:{node:process.version,cpu:os.cpus()[0].model,arch:process.arch,maxRSSBytes:process.resourceUsage().maxRSS*1024}};
  await writeFile(resolve(out,'evaluation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({gate:report.researchGate,checks,trainingMs,wallTimeMs:report.wallTimeMs,random:b,warm:p,guarded:a}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runGuarded();
