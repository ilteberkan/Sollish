import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { adaptSource, ROOT, sha, ENGINE_SHA, FROZEN_POLICY_SHA } from './environment.mjs';
import { atomicImport } from './atomic-module.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw new Error('GUARDED_SOURCE_SHAPE');return source.replace(from,to);}
export async function loadGuardedEnvironment(){
  const folder=resolve(ROOT,'packages/protocol/src'),source=await readFile(resolve(folder,'combat-v3.ts'),'utf8');
  if(sha(await readFile(resolve(folder,'connectome-policy.ts')))!==FROZEN_POLICY_SHA)throw new Error('FROZEN_POLICY_HASH_MISMATCH');
  let adapted=adaptSource(source);
  adapted=`import {researchElbow,researchGuardShapes,researchSweep} from ${JSON.stringify(resolve(HERE,'guard-geometry.mjs'))};\n`+adapted;
  adapted=replaceOnce(adapted,"'ringside-contact-3-f8cd1d1f' as const","'research:guarded-contact-1' as const");
  for(const [from,to]of [
    ['leftHand:local(a,-180,1460,300)','leftHand:local(a,-140,1600,260)'],
    ['rightHand:local(a,180,1460,300)','rightHand:local(a,140,1600,260)'],
    ['leftElbow:local(a,-400,1200,70)','leftElbow:researchElbow(local(a,-198,1423,-138),local(a,-140,1600,260),local(a,-350,1280,20))'],
    ['rightElbow:local(a,400,1200,70)','rightElbow:researchElbow(local(a,232,1464,34),local(a,140,1600,260),local(a,350,1300,20))'],
    ["return a.action==='guard'?[{bodyPart:'guard' as const,center:a.pose.leftHand,radius:120},{bodyPart:'guard' as const,center:a.pose.rightHand,radius:120},...body]:body;","return [...researchGuardShapes(a),...body];"],
    ["t:sweepSphere(from,to,s.center,s.radius+(spec.limb==='rightFoot'?100:85))","t:researchSweep(from,to,s,spec.limb==='rightFoot'?100:85)"]
  ])adapted=replaceOnce(adapted,from,to);
  const geometryBytes=await readFile(resolve(HERE,'guard-geometry.mjs'));
  const engineSha256=sha(adapted+geometryBytes.toString('utf8'));
  const built=await build({stdin:{contents:adapted,loader:'ts',resolveDir:folder,sourcefile:'research-guarded-contact-1.ts'},bundle:true,format:'esm',platform:'node',target:'node24',write:false});
  const code=built.outputFiles[0].contents,path=resolve(ROOT,'.tooling/combat-selfplay',`guarded-${sha(code)}.mjs`);
  const module=await atomicImport(path,code);
  return {simulate:module.simulateContactCombat,initial:module.CONTACT_INITIAL,engineSha256,adapterSha256:sha(code),baseEngineSha256:ENGINE_SHA,geometrySha256:sha(geometryBytes),version:'research:guarded-contact-1'};
}
