import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
import os from 'node:os';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadReservoir,initialParameters,random,ACTIONS,GRAPH_SHA } from './policy.mjs';
import { energyEpisode,energyAggregate } from './energy-refinement.mjs';
import { episodeSeed,sha } from './environment.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),OUT=resolve(HERE,'evidence/energy-cem-6'),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const load=async p=>JSON.parse(await readFile(resolve(HERE,p),'utf8'));
const coordinates=[4,5,6,7].flatMap(a=>[0,11,12,14].map(f=>a*16+f));
function score(summary){return summary.meanReward-2*Math.max(0,3.25-summary.meanAttackTechniques);}
async function context(){const planBytes=await readFile(resolve(HERE,'energy-cem-plan.json')),plan=JSON.parse(planBytes),baseBytes=await readFile(resolve(HERE,'evidence/guarded-contact-1/model.json')),warmBytes=await readFile(resolve(HERE,'evidence/energy-refinement-5/model.json'));if(sha(baseBytes)!==plan.baseModelSha256||sha(warmBytes)!==plan.warmResidualModelSha256)throw new Error('PIN_MISMATCH');const env=await loadGuardedEnvironment();if(env.engineSha256!==plan.expectedEnvironmentSha256)throw new Error('ENVIRONMENT_HASH');return{plan,planBytes,base:JSON.parse(baseBytes).parameters,warm:JSON.parse(warmBytes).parameters,env,reservoir:await loadReservoir()};}
export function evaluateCem(env,reservoir,descriptor,base,opponents,seeds,partition,full=false){const rows=[];for(const name of opponents)for(const id of seeds)for(const side of [0,1])rows.push({...energyEpisode(env,reservoir,descriptor,base,name==='previous-guarded'?{kind:'base',parameters:base}:name==='frozen-v3'?null:name,episodeSeed(partition,id),side,full).metrics,opponent:name,seedId:id,side});return{summary:energyAggregate(rows),perOpponent:Object.fromEntries(opponents.map(name=>[name,energyAggregate(rows.filter(r=>r.opponent===name))])),rows};}
export async function trainCem(){
  const startedAt=new Date().toISOString(),started=performance.now(),{plan,planBytes,base,warm,env,reservoir}=await context();await mkdir(OUT,{recursive:true});
  const sources={};for(const p of ['energy-cem.mjs','energy-cem-plan.json','energy-policy.mjs','energy-refinement.mjs','energy-diagnostic.mjs','guarded-training.mjs','policy.mjs','metrics.mjs','environment.mjs','guarded-environment.mjs','guard-geometry.mjs'])sources[p]=sha(await readFile(resolve(HERE,p)));
  await writeFile(resolve(OUT,'run-plan.json'),JSON.stringify({startedAt,plan,planSha256:sha(planBytes),sources,environmentSha256:env.engineSha256,adapterSha256:env.adapterSha256},null,2)+'\n');
  let mu=Float64Array.from(warm),std=new Float64Array(coordinates.length).fill(.9),best=Float64Array.from(warm),selectedGeneration=0,completed=0,episodes=0;
  const rng=random(plan.seed),history=[],checkpoints=[],pool=[Float64Array.from(warm)];let bestValidation=evaluateCem(env,reservoir,{kind:'energy',parameters:best},base,plan.validationOpponents,plan.validationSeeds,'energy6-validation').summary;
  history.push({generation:0,validation:bestValidation,score:score(bestValidation),selected:true});
  for(let generation=1;generation<=plan.generations;generation++){
    if(performance.now()-started>plan.maxRunSeconds*1000)break;
    const opponents=[{kind:'base',parameters:base},['paced-boxer','energy-kicker','mixed','punisher','counter'][(generation-1)%5],{kind:'energy',parameters:pool[(generation-1)%pool.length]}],population=[];
    for(let k=0;k<plan.population;k++){
      const candidate=Float64Array.from(mu);if(k>0)coordinates.forEach((index,j)=>{candidate[index]+=std[j]*rng.normal();});const rows=[];
      for(let j=0;j<3;j++)for(const side of [0,1]){rows.push(energyEpisode(env,reservoir,{kind:'energy',parameters:candidate},base,opponents[j],episodeSeed('energy6-train',generation*100+j),side).metrics);episodes++;}
      population.push({parameters:candidate,score:score(energyAggregate(rows))});
    }
    population.sort((a,b)=>b.score-a.score);const elite=population.slice(0,plan.elite);
    for(let j=0;j<coordinates.length;j++){const index=coordinates[j],centre=mean(elite.map(e=>e.parameters[index])),deviation=Math.sqrt(mean(elite.map(e=>(e.parameters[index]-centre)**2)));mu[index]=.35*mu[index]+.65*centre;std[j]=Math.max(.10,.35*std[j]+.65*deviation);}
    completed=generation;
    // Validate the best real-episode candidate, not a synthetic averaged action or teacher label.
    if(generation%2===0||generation===plan.generations){const candidate=population[0].parameters,validation=evaluateCem(env,reservoir,{kind:'energy',parameters:candidate},base,plan.validationOpponents,plan.validationSeeds,'energy6-validation').summary,selected=score(validation)>score(bestValidation);if(selected){best=Float64Array.from(candidate);selectedGeneration=generation;bestValidation=validation;}pool.push(Float64Array.from(candidate));checkpoints.push({generation,parameters:Array.from(candidate)});history.push({generation,trainingScore:population[0].score,validation,selected,episodes});console.log(JSON.stringify({generation,selectedGeneration,score:score(validation),types:validation.meanAttackTechniques,override:validation.meanForcedFraction,win:validation.winRate,episodes}));}
  }
  const model={schemaVersion:1,experiment:plan.experiment,kind:'energy',environmentSha256:env.engineSha256,graphSha256:GRAPH_SHA,baseModelSha256:plan.baseModelSha256,warmResidualModelSha256:plan.warmResidualModelSha256,selectedGeneration,featuresPerAction:16,actions:ACTIONS,parameters:Array.from(best),training:'Reward-only closed-loop CEM of16 attack residual coordinates; remaining112 residual weights frozen; no teacher labels or legality mask.'},modelBytes=JSON.stringify(model,null,2)+'\n';
  await writeFile(resolve(OUT,'model.json'),modelBytes);await writeFile(resolve(OUT,'training.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),completedGenerations:completed,trainingEpisodes:episodes,trainingMs:performance.now()-started,selectedGeneration,modelSha256:sha(modelBytes),planSha256:sha(planBytes),sources,history,checkpoints,runtime:{node:process.version,cpu:os.cpus()[0].model,maxRSSBytes:process.resourceUsage().maxRSS*1024}},null,2)+'\n');console.log(JSON.stringify({stage:'training-complete-final-not-evaluated',selectedGeneration,bestValidation}));
}
export async function finalCem(){
  const {plan,planBytes,base,env,reservoir}=await context(),modelBytes=await readFile(resolve(OUT,'model.json')),model=JSON.parse(modelBytes),training=await load('evidence/energy-cem-6/training.json'),curriculum=await load('evidence/curriculum-2/model.json');
  if(sha(modelBytes)!==training.modelSha256||sha(planBytes)!==training.planSha256)throw new Error('SELECTION_CHANGED');for(const [file,hash]of Object.entries(training.sources))if(sha(await readFile(resolve(HERE,file)))!==hash)throw new Error('SOURCE_CHANGED');
  const comparisons={};for(const [name,descriptor]of [['random',{kind:'base',parameters:initialParameters(171)}],['curriculum',{kind:'base',parameters:curriculum.parameters}],['previousGuarded',{kind:'base',parameters:base}],['energy',{kind:'energy',parameters:model.parameters}]])comparisons[name]=evaluateCem(env,reservoir,descriptor,base,plan.finalOpponents,plan.finalTestSeeds,'energy6-final',true);
  const a=comparisons.energy.summary,b=comparisons.random.summary,p=comparisons.curriculum.summary,g=plan.gate,margin=x=>x.meanDamageDealt-x.meanDamageReceived;
  const checks={trainingCompleted:training.completedGenerations===plan.generations,actualSelfPlay:training.checkpoints.length>1,originalWin:a.winRate-b.winRate>=g.originalWinImprovementOverRandom,originalDamage:margin(a)-margin(b)>=g.originalDamageMarginImprovementOverRandom,originalEntropy:a.meanActionEntropy>=g.originalActionEntropyMinimum,originalNoStrike:a.maxNoStrikeMs<=g.originalMaxNoStrikeMs,improveWarmWin:a.winRate-p.winRate>=g.winImprovementOverWarm,improveWarmDamage:margin(a)-margin(p)>=g.damageMarginImprovementOverWarm,attackTypes:a.meanAttackTechniques>=g.meanAttackTechniquesMinimum,overrides:a.meanForcedFraction<=g.meanOverrideFractionMaximum,cleanHits:a.meanCleanHits>=g.meanCleanHitsMinimum,noContact:a.maxNoContactMs<=g.maxNoContactMs,stateBounds:a.ringViolations===g.stateViolations};
  const report={experiment:plan.experiment,evaluatedAt:new Date().toISOString(),planSha256:sha(planBytes),modelSha256:sha(modelBytes),environmentSha256:env.engineSha256,comparisons,checks,researchGate:Object.values(checks).every(Boolean)?'PASS':'FAIL',deploymentGate:'CLOSED',scope:'All candidates and thresholds frozen before this once-used final partition. No further final tuning.'};await writeFile(resolve(OUT,'evaluation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks,researchGate:report.researchGate,summaries:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,v.summary]))}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--evaluate'))await finalCem();else await trainCem();}
