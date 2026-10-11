import { readFile, writeFile } from 'node:fs/promises';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadReservoir, PARAMETERS, FEATURES, ACTIONS } from './policy.mjs';
import { energyEpisode, energyAggregate } from './energy-training.mjs';
import { episodeSeed, sha } from './environment.mjs';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const plan=await read('./energy-plan.json'),auditPlan=await read('./energy-audit-plan.json'),selection=await read('./evidence/energy-controller-4/evaluation.json'),baseDoc=await read('./evidence/guarded-contact-1/model.json'),env=await loadGuardedEnvironment(),reservoir=await loadReservoir();
const comparisons={};
for(const action of ['jab','cross','hook','kick']){
  const parameters=new Float64Array(PARAMETERS);parameters[ACTIONS.indexOf(action)*FEATURES]=100;
  const rows=[];for(const name of plan.finalOpponents)for(const id of plan.finalTestSeeds)for(const side of [0,1])rows.push({...energyEpisode(env,reservoir,{kind:'base',parameters},baseDoc.parameters,name==='previous-guarded'?{kind:'base',parameters:baseDoc.parameters}:name==='frozen-v3'?null:name,episodeSeed('energy-final',id),side,true).metrics,opponent:name,seedId:id,side});
  comparisons[`always-${action}`]={summary:energyAggregate(rows),rows};
}
const dominance=rows=>rows.map(r=>{const values=Object.values(r.attackCounts),total=values.reduce((a,b)=>a+b,0);return total?Math.max(...values)/total:0;});
const shares=dominance(selection.comparisons.energy.rows),meanDominantAttackShare=shares.reduce((a,b)=>a+b,0)/shares.length;
const report={experiment:auditPlan.experiment,at:new Date().toISOString(),auditPlanSha256:sha(await readFile(new URL('./energy-audit-plan.json',import.meta.url))),selectedModelSha256:selection.modelSha256,meanDominantAttackShare,maximumEpisodeDominantAttackShare:Math.max(...shares),diversityGate:meanDominantAttackShare<=auditPlan.additionalDiversityGate.meanDominantAttackShareMaximum?'PASS':'FAIL',comparisons,limits:auditPlan.limits};
await writeFile(new URL('./evidence/energy-controller-4/single-action-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,comparisons:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,v.summary]))}));
