import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { random } from './policy.mjs';
import { sha } from './environment.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export function clusteredScoreInterval(opponents) {
  const groups=[];
  // Each seed's two sides AND all opponent types remain together in the bootstrap.
  for(let i=0;i<16;i++){
    const differences=[];
    for(const row of Object.values(opponents))for(const side of [0,1]){
      const a=row.learnedEpisodes[i*2+side],b=row.initialEpisodes[i*2+side];
      differences.push(a.win+.5*a.draw-b.win-.5*b.draw);
    }
    groups.push(differences.reduce((s,x)=>s+x,0)/differences.length);
  }
  const rng=random(202611),samples=[];
  for(let b=0;b<2000;b++){let sum=0;for(let i=0;i<groups.length;i++)sum+=groups[Math.floor(rng.uniform()*groups.length)];samples.push(sum/groups.length);}
  samples.sort((a,b)=>a-b);
  return {seedClusters:16,scoreImprovement:groups.reduce((s,x)=>s+x,0)/16,bootstrap95:[samples[50],samples[1949]],scope:'Seed-cluster resampling includes both sides/all opponent types. One optimizer seed only; not uncertainty across training runs or physical-world transfer.'};
}
export async function analyse() {
  const dir=resolve(HERE,'evidence'),bytes=await readFile(resolve(dir,'evaluation.json')),report=JSON.parse(bytes);
  if(!report.finishedAt||Object.keys(report.variants).length!==3)throw new Error('RUN_INCOMPLETE');
  const variants={};
  for(const [name,r]of Object.entries(report.variants)){
    const attacks=Object.fromEntries(['jab','cross','hook','kick'].map(a=>[a,r.learned.actions[a]])),total=Object.values(attacks).reduce((s,x)=>s+x,0);
    const rows=Object.values(r.opponents).flatMap(x=>x.learnedEpisodes),proposals={};
    for(const row of rows)for(const [action,n]of Object.entries(row.proposed))proposals[action]=(proposals[action]??0)+n;
    variants[name]={initialScore:r.initial.winRate+.5*r.initial.drawRate,learnedScore:r.learned.winRate+.5*r.learned.drawRate,researchGate:r.researchGate,attackCounts:attacks,largestAttackShare:Math.max(...Object.values(attacks))/total,proposals,clustered:clusteredScoreInterval(r.opponents),unseenOpponentTypes:['kick-only','counter','alternating','turtle','evasive','frozen-v3']};
  }
  const result={schemaVersion:1,evaluationSha256:sha(bytes),variants,limitations:['Anatomical topology superiority is not established by this single optimizer seed.','Per-episode intervals in raw evaluation.json are exploratory; prefer seed-cluster intervals here because the two sides share seeds.','Scripted baseline policies are deliberately small and predictable. Strong unseen learned adversaries, different physics and privileged-information audits remain future work.','Action safety and max no-strike partly follow hard engine overrides, not learned competence.']};
  await writeFile(resolve(dir,'analysis.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await analyse(),null,2));
