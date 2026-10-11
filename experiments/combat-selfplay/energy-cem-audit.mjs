import { readFile, writeFile } from 'node:fs/promises';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadReservoir, PARAMETERS, FEATURES, ACTIONS } from './policy.mjs';
import { energyEpisode, energyAggregate } from './energy-refinement.mjs';
import { episodeSeed, sha } from './environment.mjs';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const plan=await read('./energy-cem-plan.json'),auditPlan=await read('./energy-cem-audit-plan.json'),selection=await read('./evidence/energy-cem-6/evaluation.json'),baseDoc=await read('./evidence/guarded-contact-1/model.json'),env=await loadGuardedEnvironment(),reservoir=await loadReservoir();
const comparisons={};
for(const action of ['jab','cross','hook','kick']){
  const parameters=new Float64Array(PARAMETERS);parameters[ACTIONS.indexOf(action)*FEATURES]=100;
  const rows=[];for(const name of plan.finalOpponents)for(const id of plan.finalTestSeeds)for(const side of [0,1])rows.push({...energyEpisode(env,reservoir,{kind:'base',parameters},baseDoc.parameters,name==='previous-guarded'?{kind:'base',parameters:baseDoc.parameters}:name==='frozen-v3'?null:name,episodeSeed('energy6-final',id),side,true).metrics,opponent:name,seedId:id,side});
  comparisons[`always-${action}`]={summary:energyAggregate(rows),rows};
}
const dominance=rows=>rows.map(r=>{const values=Object.values(r.attackCounts),total=values.reduce((a,b)=>a+b,0);return total?Math.max(...values)/total:0;});
const shares=dominance(selection.comparisons.energy.rows),meanDominantAttackShare=shares.reduce((a,b)=>a+b,0)/shares.length;
const perOpponent=Object.fromEntries(plan.finalOpponents.map(name=>{const rows=selection.comparisons.energy.rows.filter(r=>r.opponent===name),rawAttackProposals=rows.reduce((s,r)=>s+['jab','cross','hook','kick'].reduce((a,k)=>a+r.proposed[k],0),0),unaffordable=rows.reduce((s,r)=>s+r.lowStaminaAttackProposals,0);return[name,{games:rows.length,techniqueHistogram:Object.fromEntries([0,1,2,3,4].map(n=>[n,rows.filter(r=>r.attackTechniques===n).length])),strikeCounts:Object.fromEntries(['jab','cross','hook','kick'].map(a=>[a,rows.reduce((s,r)=>s+r.attackCounts[a],0)])),rawAttackProposals,affordableAttackProposals:rawAttackProposals-unaffordable,unaffordableAttackProposals:unaffordable}];}));
const report={perOpponent,experiment:auditPlan.experiment,at:new Date().toISOString(),auditPlanSha256:sha(await readFile(new URL('./energy-cem-audit-plan.json',import.meta.url))),selectedModelSha256:selection.modelSha256,meanDominantAttackShare,maximumEpisodeDominantAttackShare:Math.max(...shares),diversityGate:meanDominantAttackShare<=auditPlan.additionalDiversityGate.meanDominantAttackShareMaximum?'PASS':'FAIL',comparisons,limits:auditPlan.limits};
await writeFile(new URL('./evidence/energy-cem-6/single-action-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,comparisons:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,v.summary]))}));
