import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment,episodeSeed,sha } from './environment.mjs';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadReservoir,PARAMETERS } from './policy.mjs';
import { curriculumEpisode,curriculumAggregate } from './curriculum.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export async function diagnose(){
  const old=await loadEnvironment(),guarded=await loadGuardedEnvironment(),graph=await loadReservoir(),out=resolve(HERE,'evidence/guarded-contact-1');await mkdir(out,{recursive:true});
  const results={},traces=[];
  for(const [name,action,opponent]of [['cross-guard',5,'guard'],['cross-counter',5,'counter'],['kick-guard',7,'guard']]){
    const theta=new Float64Array(PARAMETERS);theta[action*139]=10;const comparison={};
    for(const [label,env]of [['frozen',old],['guarded',guarded]]){
      const rows=[];let blocks=0,cleanHits=0;
      for(let id=1000;id<1008;id++)for(const side of [0,1]){
        const result=curriculumEpisode(env,graph,theta,opponent,episodeSeed('guard-diagnostic',id),side,true);rows.push(result.metrics);
        const actor=side===0?'kor':'ayaz';blocks+=result.replay.events.filter(e=>e.actor===actor&&e.type==='block').length;cleanHits+=result.replay.events.filter(e=>e.actor===actor&&e.type==='hit').length;
        if(name==='cross-guard'&&id===1000&&side===0){
          result.replay.version=`research:guard-diagnostic:${label}`;result.replay.policy='constant-cross-vs-constant-guard-with-engine-overrides';
          const file=`diagnostic-${label}.json`,bytes=JSON.stringify(result.replay)+'\n';await writeFile(resolve(out,file),bytes);traces.push({label,file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),engineSha256:env.engineSha256});
        }
      }
      comparison[label]={...curriculumAggregate(rows),blocks,cleanHits,blockFractionOfContacts:blocks/(blocks+cleanHits)};
    }
    results[name]=comparison;
  }
  const sourceHashes={};for(const file of ['guard-diagnostic.mjs','guarded-environment.mjs','guard-geometry.mjs'])sourceHashes[file]=sha(await readFile(resolve(HERE,file)));
  const checks={crossGuardBlocksIncreased:results['cross-guard'].guarded.blocks>results['cross-guard'].frozen.blocks,crossGuardCleanDamageDecreased:results['cross-guard'].guarded.meanDamageDealt<results['cross-guard'].frozen.meanDamageDealt,guardNotInvulnerableToKick:results['kick-guard'].guarded.cleanHits>0,baseSourceFrozen:guarded.baseEngineSha256===old.engineSha256};
  const report={schemaVersion:1,scope:'Same seeds/actions on frozen versus separate guarded research geometry; no learning, no monetary game',version:guarded.version,baseEngineSha256:old.engineSha256,guardedEngineSha256:guarded.engineSha256,guardedAdapterSha256:guarded.adapterSha256,sourceHashes,checks,results,traces,limitations:['Higher guard and two-link forearm capsules are explicit approximations, not full rigid-body or complete boxing defense.','Non-striking glove/forearm blocks during attacks; striking arm is excluded.','Contact is still a swept effector against current target geometry, not full continuous target-body motion.','Torso/leg kicks may bypass high guard; offense/defense balance still needs wider testing.']};
  await writeFile(resolve(out,'diagnostic.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await diagnose();
