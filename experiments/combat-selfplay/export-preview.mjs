/** Public-safe offline research records. The research prefix rejects live v3 identity. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, episodeSeed, sha } from './environment.mjs';
import { loadReservoir, initialParameters } from './policy.mjs';
import { episode } from './train.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export async function exportPreview() {
  const dir=resolve(HERE,'evidence'),report=JSON.parse(await readFile(resolve(dir,'evaluation.json'),'utf8'));
  const result=report.variants.connectome,modelBytes=await readFile(resolve(dir,'connectome-model.json')),model=JSON.parse(modelBytes);
  if(!result||sha(modelBytes)!==result.modelSha256)throw new Error('MODEL_EVIDENCE_MISMATCH');
  const env=await loadEnvironment();if(env.engineSha256!==report.engineSha256||env.adapterSha256!==report.adapterSha256)throw new Error('ENVIRONMENT_EVIDENCE_MISMATCH');
  const graph=await loadReservoir(),initial=initialParameters(171),initialSha=sha(JSON.stringify(Array.from(initial))),out=resolve(dir,'preview');await mkdir(out,{recursive:true});
  const cases=[];
  // Fixed first three held-out seeds, not chosen for attractive results or winning clips.
  for(const [id,name,label]of [[40000,'counter','Kontra rakibi'],[40001,'kick-only','Tekme ağırlıklı rakip'],[40002,'frozen-v3','Dondurulmuş v3 rakibi']]){
    const seed=episodeSeed('test',id),runs=[];
    for(const trained of [false,true]){
      const label=trained?'Öğrenilmiş aday':'Eğitim öncesi',kind=trained?'learned':'initial',parameters=trained?model.parameters:initial;
      const {replay}=episode(env,graph,parameters,name==='frozen-v3'?null:name,seed,0,true);
      replay.version=`research:combat-selfplay-es-1:${kind}:${result.modelSha256.slice(0,12)}`;
      replay.policy=trained?`reward-trained:${result.modelSha256}`:`random-initial:${initialSha}`;
      const file=`selfplay-${id}-${kind}.json`,bytes=JSON.stringify(replay)+'\n';await writeFile(resolve(out,file),bytes);
      runs.push({id:kind,label,path:`/research/ringside/${file}`,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),trained});
    }
    cases.push({id:String(id),label,opponent:name,seed,runs});
  }
  const manifest={schema:1,experiment:report.experiment,publishedAt:new Date().toISOString(),modelSha256:result.modelSha256,sourceSha256:report.engineSha256,promotionPassed:result.researchGate==='PASS',training:{episodes:result.trainingEpisodes,generations:result.completedGenerations,method:'Öğretmen etiketi olmadan, geçmiş politikalarla self-play ve ödül temelli evolution strategy; 1.112 çıkış parametresi',seconds:result.trainingMs/1000},evaluation:{games:result.learned.episodes,beforeScore:result.initial.winRate+.5*result.initial.drawRate,afterScore:result.learned.winRate+.5*result.learned.drawRate,baseline:'Aynı seed ve taraflarda başlangıç politikası; 8 rakip tipi',scope:'16 görülmemiş seed × 2 taraf × 8 rakip; kazanma=1, beraberlik=0,5. Son test sonuçlarına göre politika seçilmedi.'},limitations:['Araştırma kalite kapısı geçmedi: eylem çeşitliliği hedefin altında.','Cross ağırlıklı dar bir strateji; daha gerçekçi dövüş, insan becerisi veya biyolojik düşünme kanıtı değil.','Mevcut v3 kuralları yaklaşma, düşük enerjide gard ve saldırısız kalma süresini zorlar; bunlar öğrenilmedi.','128 gerçek MaleCNS düğümü; bütün beyin değil. Anatomik kenarlar ve varsayımsal dinamikler sabit; yalnız çıkış ağırlıkları öğrenildi.','Bu kayıtlar yerel deneydir. Canlı maç, bahis, para veya finansal protokol yetkisi yoktur.'],cases};
  await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {directory:out,manifest,cases:cases.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await exportPreview()));
