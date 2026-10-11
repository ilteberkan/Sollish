import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadEnvironment, episodeSeed, ROOT, sha } from './environment.mjs';
import { ACTIONS, PARAMETERS, loadReservoir, initialParameters, createController, random, scripted, GRAPH_SHA } from './policy.mjs';
import { summarizeEpisode, aggregate } from './metrics.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export function episode(env,reservoir,theta,opponent,seed,side,trace=false) {
  const decisions=[],own=createController(theta,reservoir);
  const other=opponent===null?null:typeof opponent==='string'?scripted(opponent):createController(opponent,reservoir);
  const replay=env.simulate(seed,env.initial,{controllers:side===0?[own,other]:[other,own],recordFrames:trace,onDecision:(i,tick,proposed,effective)=>decisions.push({side:i,tick,proposed,effective})});
  return {metrics:summarizeEpisode(replay,side,decisions),replay};
}
function stats(scores) {const mean=scores.reduce((s,x)=>s+x,0)/scores.length;return {mean,std:Math.sqrt(scores.reduce((s,x)=>s+(x-mean)**2,0)/scores.length)};}
function pairedDifference(before,after) {
  const differences=after.map((r,i)=>r.win+.5*r.draw-before[i].win-.5*before[i].draw),rng=random(883),samples=[];
  for(let b=0;b<2000;b++){let sum=0;for(let i=0;i<differences.length;i++)sum+=differences[Math.floor(rng.uniform()*differences.length)];samples.push(sum/differences.length);}
  samples.sort((a,b)=>a-b);return {scoreImprovement:stats(differences).mean,bootstrap95:[samples[50],samples[1949]],unit:'paired episode win=1 draw=0.5 loss=0; heuristic environment uncertainty, not human-transfer confidence'};
}
function validate(env,reservoir,theta,initial,plan) {
  const rows=[];
  for(const name of plan.validationOpponents)for(const id of plan.validationSeeds)for(const side of [0,1])rows.push(episode(env,reservoir,theta,name==='initial'?initial:name,episodeSeed('validation',id),side).metrics);
  return aggregate(rows);
}
export async function trainVariant(env,variant,plan,deadline) {
  const reservoir=await loadReservoir(variant),initial=initialParameters(plan.initialPolicySeed),theta=Float64Array.from(initial),rng=random(plan.seed),m=new Float64Array(PARAMETERS),v=new Float64Array(PARAMETERS);
  const pool=[Float64Array.from(initial)],history=[],checkpoints=[];
  let best=Float64Array.from(initial),selectedGeneration=0,bestValidation=validate(env,reservoir,best,initial,plan),episodes=0,completed=0;
  history.push({generation:0,validation:bestValidation,selected:true,poolSize:1});
  for(let generation=1;generation<=plan.generations;generation++){
    if(performance.now()>deadline)break;
    const opponent=pool[(generation-1)%pool.length],noise=[],returns=[];
    for(let direction=0;direction<plan.directions;direction++){
      const epsilon=Float64Array.from({length:PARAMETERS},()=>rng.normal()),pair=[];noise.push(epsilon);
      for(const sign of [1,-1]){
        const candidate=Float64Array.from(theta,(x,j)=>x+sign*plan.sigma*epsilon[j]);let total=0;
        for(let j=0;j<plan.trainingEpisodesPerCandidate/2;j++)for(const side of [0,1]){
          total+=episode(env,reservoir,candidate,opponent,episodeSeed('train',generation*100+j),side).metrics.reward;episodes++;
        }
        pair.push(total/plan.trainingEpisodesPerCandidate);
      }
      returns.push(pair);
    }
    const scale=Math.max(stats(returns.flat()).std,1e-6),gradient=new Float64Array(PARAMETERS);
    for(let d=0;d<plan.directions;d++)for(let j=0;j<PARAMETERS;j++)gradient[j]+=(returns[d][0]-returns[d][1])*noise[d][j]/(2*plan.directions*plan.sigma*scale);
    for(let j=0;j<PARAMETERS;j++){
      m[j]=.9*m[j]+.1*gradient[j];v[j]=.999*v[j]+.001*gradient[j]**2;
      theta[j]+=plan.learningRate*(m[j]/(1-.9**generation))/(Math.sqrt(v[j]/(1-.999**generation))+1e-8);
      if(!Number.isFinite(theta[j]))throw new Error('NONFINITE_TRAINING');
    }
    completed=generation;
    const row={generation,trainingMean:stats(returns.flat()).mean,trainingStd:scale,poolSize:pool.length,episodes};
    if(generation%plan.validationEvery===0||generation===plan.generations){
      row.validation=validate(env,reservoir,theta,initial,plan);row.selected=row.validation.meanReward>bestValidation.meanReward;
      if(row.selected){best=Float64Array.from(theta);selectedGeneration=generation;bestValidation=row.validation;}
      pool.push(Float64Array.from(theta));checkpoints.push({generation,parameters:Array.from(theta)});
      console.log(JSON.stringify({variant,generation,validation:row.validation.meanReward,selectedGeneration,episodes}));
    }
    history.push(row);
  }
  return {reservoir,initial,parameters:best,selectedGeneration,bestValidation,history,checkpoints,trainingEpisodes:episodes,completedGenerations:completed};
}
export async function main() {
  const startedAt=new Date().toISOString(),started=performance.now(),planBytes=await readFile(resolve(HERE,'plan.json')),plan=JSON.parse(planBytes);
  const env=await loadEnvironment(),out=resolve(HERE,'evidence');await mkdir(out,{recursive:true});
  const sources={};for(const name of ['environment.mjs','policy.mjs','metrics.mjs','train.mjs','plan.json'])sources[name]=sha(await readFile(resolve(HERE,name)));
  // This pre-run record fixes protocol and partition choices before any final evaluation.
  await writeFile(resolve(out,'run-plan.json'),JSON.stringify({startedAt,plan,planSha256:sha(planBytes),sources,engineSha256:env.engineSha256,adapterSha256:env.adapterSha256,graphSha256:GRAPH_SHA},null,2)+'\n');
  const report={schemaVersion:1,experiment:plan.experiment,startedAt,planSha256:sha(planBytes),engineSha256:env.engineSha256,adapterSha256:env.adapterSha256,graphSha256:GRAPH_SHA,teacherLabels:false,variants:{},deploymentGate:'CLOSED',observations:'10 bounded v3 observation fields only; future seeds/opponent policy/wagers not supplied',sources};
  for(const variant of plan.variants){
    const trainingStart=performance.now(),trained=await trainVariant(env,variant,plan,started+plan.maxRunSeconds*1000),trainingMs=performance.now()-trainingStart;
    const model={schemaVersion:1,experiment:plan.experiment,variant,graphSha256:GRAPH_SHA,engineSha256:env.engineSha256,actions:ACTIONS,features:139,learnedParameters:PARAMETERS,selectedGeneration:trained.selectedGeneration,parameters:Array.from(trained.parameters),reservoir:{nodes:128,leak:.35,gain:.8,inputSeed:11,inputDistribution:'uniform(-.65,.65), independent of imitation model',scrambleSeed:variant==='scrambled'?9011:null},training:'episode reward only; output readout learned from random initialization by antithetic ES'};
    const modelBytes=JSON.stringify(model,null,2)+'\n',modelSha256=sha(modelBytes);
    // Freeze selected model to disk BEFORE first final test episode.
    await writeFile(resolve(out,`${variant}-model.json`),modelBytes);
    await writeFile(resolve(out,`${variant}-training.json`),JSON.stringify({selectedGeneration:trained.selectedGeneration,history:trained.history,checkpoints:trained.checkpoints},null,2)+'\n');
    const results={},allInitial=[],allLearned=[];
    for(const name of plan.finalOpponents){
      const before=[],after=[];
      const opponent=name==='initial'?trained.initial:name==='frozen-v3'?null:name;
      for(const id of plan.finalTestSeeds)for(const side of [0,1]){
        const seed=episodeSeed('test',id);
        before.push(episode(env,trained.reservoir,trained.initial,opponent,seed,side,true).metrics);
        after.push(episode(env,trained.reservoir,trained.parameters,opponent,seed,side,true).metrics);
      }
      results[name]={initial:aggregate(before),learned:aggregate(after),paired:pairedDifference(before,after),initialEpisodes:before,learnedEpisodes:after};allInitial.push(...before);allLearned.push(...after);
    }
    const before=aggregate(allInitial),after=aggregate(allLearned),gate=plan.researchGate;
    const checks={trainingCompleted:trained.completedGenerations===plan.generations,actualSelfPlay:trained.checkpoints.length>1,winImprovement:after.winRate-before.winRate>=gate.winRateImprovementOverInitial,damageMarginImprovement:(after.meanDamageDealt-after.meanDamageReceived)-(before.meanDamageDealt-before.meanDamageReceived)>=gate.meanDamageMarginImprovement,actionEntropy:after.meanActionEntropy>=gate.meanActionEntropyMinimum,noStrike:after.maxNoStrikeMs<=gate.maxNoStrikeMs,ringBounds:after.ringViolations===0};
    report.variants[variant]={modelSha256,selectedGeneration:trained.selectedGeneration,trainingEpisodes:trained.trainingEpisodes,completedGenerations:trained.completedGenerations,trainingMs,initial:before,learned:after,paired:pairedDifference(allInitial,allLearned),checks,researchGate:Object.values(checks).every(Boolean)?'PASS':'FAIL',opponents:results};
    if(variant==='connectome'){
      const id=plan.finalTestSeeds[0],opponent='counter',seed=episodeSeed('test',id),traces=[];
      for(const label of ['initial','learned']){
        const result=episode(env,trained.reservoir,label==='initial'?trained.initial:trained.parameters,opponent,seed,0,true);
        const filename=`trace-${label}-counter-${id}.json`,bytes=JSON.stringify(result.replay)+'\n';await writeFile(resolve(out,filename),bytes);
        traces.push({label,file:filename,sha256:sha(bytes),seed,opponent,player:'kor',metrics:result.metrics});
      }
      await writeFile(resolve(out,'trace-manifest.json'),JSON.stringify({schemaVersion:1,scope:'isolated local closed-loop research; ContactReplay shape only, not a deployed v3 match',engineSha256:env.engineSha256,adapterSha256:env.adapterSha256,modelSha256,selectedGeneration:trained.selectedGeneration,researchGate:report.variants[variant].researchGate,traces},null,2)+'\n');
    }
    console.log(JSON.stringify({variant,gate:report.variants[variant].researchGate,initialWin:before.winRate,learnedWin:after.winRate,trainingMs}));
    await writeFile(resolve(out,'evaluation.json'),JSON.stringify(report,null,2)+'\n');
  }
  report.finishedAt=new Date().toISOString();report.wallTimeMs=performance.now()-started;
  report.runtime={node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,totalMemoryBytes:os.totalmem(),maxRSSBytes:process.resourceUsage().maxRSS*1024};
  await writeFile(resolve(out,'evaluation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({finishedAt:report.finishedAt,wallTimeMs:report.wallTimeMs,maxRSSBytes:report.runtime.maxRSSBytes}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
