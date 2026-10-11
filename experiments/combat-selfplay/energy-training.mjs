import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { episodeSeed, sha } from './environment.mjs';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { createController, initialParameters, loadReservoir, random, ACTIONS, GRAPH_SHA } from './policy.mjs';
import { createEnergyController, initialEnergyParameters, ENERGY_PARAMETERS } from './energy-policy.mjs';
import { curriculumOpponent, curriculumAggregate } from './guarded-training.mjs';
import { summarizeEpisode } from './metrics.mjs';
import { interventionReason } from './energy-diagnostic.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),OUT=resolve(HERE,'evidence/energy-controller-4'),ATTACKS=['jab','cross','hook','kick'],COST={jab:90,cross:130,hook:145,kick:185};
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
export function energyOpponent(name){
  let t=0;
  if(!['paced-boxer','energy-kicker','unseen-lowhigh','unseen-reactive-jab','unseen-burst-rest','unseen-pressure'].includes(name))return curriculumOpponent(name);
  return x=>{t++;const stamina=(x[1]+1)*500;
    if(name==='paced-boxer')return stamina<360?'guard':['jab','cross','hook','kick'][t%4];
    if(name==='energy-kicker')return stamina<330?'guard':x[3]>0?'slip':'kick';
    if(name==='unseen-lowhigh')return stamina<290?'guard':['kick','jab','hook','kick','cross'][t%5];
    if(name==='unseen-reactive-jab')return stamina<250?'guard':x[3]>0?'slip':x[4]>0?'cross':'jab';
    if(name==='unseen-burst-rest')return t%7<2||stamina<300?'guard':['hook','cross','kick'][t%3];
    return x[5]>0?'circle':stamina<400?'guard':['jab','hook','kick','cross','hook'][t%5];
  };
}
export function energyEpisode(env,reservoir,descriptor,base,opponent,seed,side,full=false){
  const make=d=>d===null?null:typeof d==='string'?energyOpponent(d):d.kind==='energy'?createEnergyController(d.parameters,base,reservoir):createController(d.parameters,reservoir);
  const controller=make(descriptor),other=make(opponent),decisions=[],reasons={};let lastObservation,low=0,belowRule=0,ownN=0;
  const own=x=>{lastObservation=x;return controller(x);};
  const replay=env.simulate(seed,env.initial,{controllers:side===0?[own,other]:[other,own],recordFrames:full,onDecision:(i,tick,proposed,effective)=>{
    decisions.push({side:i,tick,proposed,effective});if(i!==side)return;ownN++;
    const reason=interventionReason(lastObservation,proposed,effective);reasons[reason]=(reasons[reason]??0)+1;
    if(Object.hasOwn(COST,proposed)){const stamina=(lastObservation[1]+1)*500;if(stamina<COST[proposed])low++;if(stamina<210)belowRule++;}
  }});
  const metrics=summarizeEpisode(replay,side,decisions),id=side===0?'kor':'ayaz',counts=ATTACKS.map(a=>replay.events.filter(e=>e.actor===id&&e.type==='strike'&&e.technique===a).length),total=counts.reduce((s,x)=>s+x,0),attackEntropy=Math.max(0,-counts.filter(Boolean).map(n=>n/total).reduce((s,p)=>s+p*Math.log(p),0)/Math.log(4)),attackTechniques=counts.filter(n=>n>=2).length,cleanHits=replay.events.filter(e=>e.actor===id&&e.type==='hit').length;
  const reward=(metrics.win-metrics.loss)+.002*(metrics.damageDealt-metrics.damageReceived)+.7*attackEntropy+1.5*Math.min(attackTechniques,3)/3-4*metrics.forcedFraction-4*low/ownN-.3*metrics.noContactMs/45000;
  return {replay,metrics:{...metrics,reward,attackEntropy,attackTechniques,cleanHits,lowStaminaAttackProposals:low,unaffordableProposalFraction:low/ownN,belowEngineEnergyRuleProposalFraction:belowRule/ownN,attackCounts:Object.fromEntries(ATTACKS.map((a,i)=>[a,counts[i]])),interventionReasons:reasons}};
}
export function energyAggregate(rows){return{...curriculumAggregate(rows),meanUnaffordableProposalFraction:mean(rows.map(x=>x.unaffordableProposalFraction)),meanBelowEngineEnergyRuleProposalFraction:mean(rows.map(x=>x.belowEngineEnergyRuleProposalFraction)),interventionReasons:rows.reduce((a,r)=>{for(const [k,v]of Object.entries(r.interventionReasons))a[k]=(a[k]??0)+v;return a;},{})};}
function evaluate(env,reservoir,descriptor,base,opponents,seeds,partition,full=false){const rows=[];for(const name of opponents)for(const id of seeds)for(const side of [0,1])rows.push({...energyEpisode(env,reservoir,descriptor,base,name==='previous-guarded'?{kind:'base',parameters:base}:name==='frozen-v3'?null:name,episodeSeed(partition,id),side,full).metrics,opponent:name,seedId:id,side});return{summary:energyAggregate(rows),rows};}
async function context(){const planBytes=await readFile(resolve(HERE,'energy-plan.json')),plan=JSON.parse(planBytes),baseBytes=await readFile(resolve(HERE,'evidence/guarded-contact-1/model.json')),warmBytes=await readFile(resolve(HERE,'evidence/curriculum-2/model.json'));if(sha(baseBytes)!==plan.baseModelSha256||sha(warmBytes)!==plan.curriculumBaselineSha256)throw new Error('BASE_HASH');const env=await loadGuardedEnvironment();if(env.engineSha256!==plan.expectedEnvironmentSha256)throw new Error('ENVIRONMENT_HASH');return{plan,planBytes,base:JSON.parse(baseBytes).parameters,warm:JSON.parse(warmBytes).parameters,env,reservoir:await loadReservoir()};}
export async function trainEnergy(){
  const startedAt=new Date().toISOString(),started=performance.now(),{plan,planBytes,base,env,reservoir}=await context();await mkdir(OUT,{recursive:true});
  const sources={};for(const name of ['energy-policy.mjs','energy-training.mjs','energy-diagnostic.mjs','energy-plan.json','guarded-environment.mjs','guard-geometry.mjs','policy.mjs','metrics.mjs'])sources[name]=sha(await readFile(resolve(HERE,name)));
  await writeFile(resolve(OUT,'run-plan.json'),JSON.stringify({startedAt,plan,planSha256:sha(planBytes),sources,environmentSha256:env.engineSha256,adapterSha256:env.adapterSha256},null,2)+'\n');
  const theta=initialEnergyParameters(),rng=random(plan.seed),m=new Float64Array(ENERGY_PARAMETERS),v=new Float64Array(ENERGY_PARAMETERS),pool=[Float64Array.from(theta)],history=[],checkpoints=[];
  let best=Float64Array.from(theta),selectedGeneration=0,completed=0,episodes=0,bestValidation=evaluate(env,reservoir,{kind:'energy',parameters:theta},base,plan.validationOpponents,plan.validationSeeds,'energy-validation').summary;
  history.push({generation:0,validation:bestValidation,selected:true});
  for(let generation=1;generation<=plan.generations;generation++){
    if(performance.now()-started>plan.maxRunSeconds*1000)break;
    const opponents=[{kind:'base',parameters:base},['cross-only','counter','guard','punisher','mixed','paced-boxer','energy-kicker'][(generation-1)%7],{kind:'energy',parameters:pool[(generation-1)%pool.length]}],noise=[],returns=[];
    for(let d=0;d<plan.directions;d++){
      const epsilon=Float64Array.from({length:ENERGY_PARAMETERS},()=>rng.normal()),pair=[];noise.push(epsilon);
      for(const sign of [1,-1]){const parameters=Float64Array.from(theta,(x,j)=>x+sign*plan.sigma*epsilon[j]),rewards=[];
        for(let j=0;j<3;j++)for(const side of [0,1]){rewards.push(energyEpisode(env,reservoir,{kind:'energy',parameters},base,opponents[j],episodeSeed('energy-train',generation*100+j),side).metrics.reward);episodes++;}pair.push(mean(rewards));}
      returns.push(pair);
    }
    const avg=mean(returns.flat()),std=Math.max(1e-6,Math.sqrt(mean(returns.flat().map(x=>(x-avg)**2)))),gradient=new Float64Array(ENERGY_PARAMETERS);
    for(let d=0;d<plan.directions;d++)for(let j=0;j<ENERGY_PARAMETERS;j++)gradient[j]+=(returns[d][0]-returns[d][1])*noise[d][j]/(2*plan.directions*plan.sigma*std);
    for(let j=0;j<ENERGY_PARAMETERS;j++){m[j]=.9*m[j]+.1*gradient[j];v[j]=.999*v[j]+.001*gradient[j]**2;theta[j]+=plan.learningRate*(m[j]/(1-.9**generation))/(Math.sqrt(v[j]/(1-.999**generation))+1e-8);if(!Number.isFinite(theta[j]))throw new Error('NONFINITE_PARAMETERS');}
    completed=generation;const row={generation,trainingReward:avg,episodes,poolSize:pool.length};
    if(generation%plan.validationEvery===0||generation===plan.generations){row.validation=evaluate(env,reservoir,{kind:'energy',parameters:theta},base,plan.validationOpponents,plan.validationSeeds,'energy-validation').summary;row.selected=row.validation.meanReward>bestValidation.meanReward;if(row.selected){best=Float64Array.from(theta);selectedGeneration=generation;bestValidation=row.validation;}pool.push(Float64Array.from(theta));checkpoints.push({generation,parameters:Array.from(theta)});console.log(JSON.stringify({generation,selectedGeneration,validationReward:row.validation.meanReward,types:row.validation.meanAttackTechniques,override:row.validation.meanForcedFraction,win:row.validation.winRate,episodes}));}history.push(row);
  }
  const model={schemaVersion:1,experiment:plan.experiment,kind:'energy',environmentSha256:env.engineSha256,graphSha256:GRAPH_SHA,baseModelSha256:plan.baseModelSha256,selectedGeneration,featuresPerAction:16,actions:ACTIONS,parameters:Array.from(best),training:'Closed-loop reward learning of 128 residual parameters; frozen 128-neuron reservoir + previous learned 1112-parameter readout; no teacher labels or action masks.'},modelBytes=JSON.stringify(model,null,2)+'\n';
  await writeFile(resolve(OUT,'model.json'),modelBytes);await writeFile(resolve(OUT,'training.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),completedGenerations:completed,trainingEpisodes:episodes,trainingMs:performance.now()-started,selectedGeneration,modelSha256:sha(modelBytes),planSha256:sha(planBytes),sources,history,checkpoints,runtime:{node:process.version,cpu:os.cpus()[0].model,arch:process.arch,maxRSSBytes:process.resourceUsage().maxRSS*1024}},null,2)+'\n');console.log(JSON.stringify({stage:'training-complete-final-not-evaluated',selectedGeneration,bestValidation}));
}
export async function evaluateEnergy(){
  const {plan,planBytes,base,warm,env,reservoir}=await context(),modelBytes=await readFile(resolve(OUT,'model.json')),model=JSON.parse(modelBytes),training=JSON.parse(await readFile(resolve(OUT,'training.json'),'utf8'));
  if(sha(planBytes)!==training.planSha256||sha(modelBytes)!==training.modelSha256)throw new Error('SELECTION_IDENTITY_CHANGED');
  const comparisons={};for(const [name,descriptor]of [['random',{kind:'base',parameters:initialParameters(171)}],['curriculum',{kind:'base',parameters:warm}],['previousGuarded',{kind:'base',parameters:base}],['energy',{kind:'energy',parameters:model.parameters}]])comparisons[name]=evaluate(env,reservoir,descriptor,base,plan.finalOpponents,plan.finalTestSeeds,'energy-final',true);
  const a=comparisons.energy.summary,b=comparisons.random.summary,p=comparisons.curriculum.summary,g=plan.gate,margin=x=>x.meanDamageDealt-x.meanDamageReceived;
  const checks={trainingCompleted:training.completedGenerations===plan.generations,actualSelfPlay:training.checkpoints.length>1,originalWin:a.winRate-b.winRate>=g.originalWinImprovementOverRandom,originalDamage:margin(a)-margin(b)>=g.originalDamageMarginImprovementOverRandom,originalEntropy:a.meanActionEntropy>=g.originalActionEntropyMinimum,originalNoStrike:a.maxNoStrikeMs<=g.originalMaxNoStrikeMs,improveWarmWin:a.winRate-p.winRate>=g.winImprovementOverWarm,improveWarmDamage:margin(a)-margin(p)>=g.damageMarginImprovementOverWarm,attackTypes:a.meanAttackTechniques>=g.meanAttackTechniquesMinimum,overrides:a.meanForcedFraction<=g.meanOverrideFractionMaximum,cleanHits:a.meanCleanHits>=g.meanCleanHitsMinimum,noContact:a.maxNoContactMs<=g.maxNoContactMs,stateBounds:a.ringViolations===g.stateViolations};
  const report={experiment:plan.experiment,evaluatedAt:new Date().toISOString(),planSha256:sha(planBytes),modelSha256:sha(modelBytes),environmentSha256:env.engineSha256,comparisons,checks,researchGate:Object.values(checks).every(Boolean)?'PASS':'FAIL',deploymentGate:'CLOSED',scope:'Fresh final partition; no teacher labels, mask, inference-time legal projection, or live/financial promotion.'};await writeFile(resolve(OUT,'evaluation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks,researchGate:report.researchGate,summaries:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,v.summary]))}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.includes('--evaluate'))await evaluateEnergy();else await trainEnergy();}
