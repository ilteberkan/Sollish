import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { createController, loadReservoir } from './policy.mjs';
import { curriculumOpponent } from './guarded-training.mjs';
import { episodeSeed, sha } from './environment.mjs';

export function interventionReason(x, proposed, effective) {
  if(proposed===effective)return 'none';
  if((x[0]+1)*2000>860)return 'approach';
  if((x[1]+1)*500<210)return 'low-stamina';
  if((x[9]+1)*40>42)return 'engagement-timeout';
  if(proposed==='advance'&&(x[0]+1)*2000<740)return 'too-close-advance';
  return 'other';
}
export async function diagnose(){
  const env=await loadGuardedEnvironment(),reservoir=await loadReservoir(),path=new URL('./evidence/guarded-contact-1/model.json',import.meta.url),bytes=await readFile(path),theta=JSON.parse(bytes).parameters;
  const reasons={},pairs={},byEnergy={},rows=[];
  for(const opponent of ['cross-only','counter','mixed','heldout-energy'])for(let seed=0;seed<4;seed++)for(const side of [0,1]){
    let last;const controller=createController(theta,reservoir),own=x=>{last=x;return controller(x);},other=curriculumOpponent(opponent);let decisions=0,overrides=0;
    env.simulate(episodeSeed('energy-diagnostic',seed),env.initial,{controllers:side===0?[own,other]:[other,own],recordFrames:false,onDecision:(i,tick,proposed,effective)=>{if(i!==side)return;decisions++;const reason=interventionReason(last,proposed,effective),bucket=Math.floor((last[1]+1)*5)/10;reasons[reason]=(reasons[reason]??0)+1;byEnergy[bucket]??={decisions:0,overrides:0};byEnergy[bucket].decisions++;if(reason!=='none'){overrides++;byEnergy[bucket].overrides++;const pair=`${proposed}->${effective}`;pairs[pair]=(pairs[pair]??0)+1;}}});rows.push({opponent,seed,side,decisions,overrides});
  }
  const report={experiment:'energy-diagnostic-4',at:new Date().toISOString(),sourceModelSha256:sha(bytes),environmentSha256:env.engineSha256,reasons,pairs,byEnergy,rows,scope:'Diagnostic partition only; not validation/final evaluation; no engine or reward changes.'};
  await mkdir(new URL('./evidence/energy-controller-4/',import.meta.url),{recursive:true});await writeFile(new URL('./evidence/energy-controller-4/diagnostic.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({reasons,pairs,byEnergy}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await diagnose();
