import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { episodeSeed, sha } from './environment.mjs';
import { loadGuardedEnvironment } from './guarded-environment.mjs';
import { loadReservoir } from './policy.mjs';
import { curriculumEpisode } from './curriculum.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export async function exportGuardedPreview(){
  const dir=resolve(HERE,'evidence/guarded-contact-1'),report=JSON.parse(await readFile(resolve(dir,'evaluation.json'))),modelBytes=await readFile(resolve(dir,'model.json')),model=JSON.parse(modelBytes),warmBytes=await readFile(resolve(HERE,'evidence/curriculum-2/model.json')),warm=JSON.parse(warmBytes);
  if(sha(modelBytes)!==report.modelSha256||sha(warmBytes)!==model.warmStartModelSha256)throw new Error('MODEL_EVIDENCE_MISMATCH');
  const env=await loadGuardedEnvironment();if(env.engineSha256!==report.engineSha256||env.adapterSha256!==report.adapterSha256)throw new Error('ENVIRONMENT_EVIDENCE_MISMATCH');
  const graph=await loadReservoir(),out=resolve(dir,'preview'),cases=[];await mkdir(out,{recursive:true});
  // First three predeclared final seeds, never selected to hide losses or poor behavior.
  for(const [id,name,label]of [[120000,'cross-only','Sürekli cross rakibi'],[120001,'heldout-delayed-counter','Gecikmeli kontra rakibi'],[120002,'heldout-combo','Kombinasyon rakibi']]){
    const seed=episodeSeed('guarded-final',id),runs=[];
    for(const trained of [false,true]){
      const kind=trained?'learned':'initial',parameters=trained?model.parameters:warm.parameters,{replay}=curriculumEpisode(env,graph,parameters,name,seed,0,true);
      replay.version=`research:guarded-contact-1:${kind}:${report.modelSha256.slice(0,12)}`;
      replay.policy=`reward-trained:${trained?report.modelSha256:model.warmStartModelSha256}`;
      const file=`selfplay-guarded-${id}-${kind}.json`,bytes=JSON.stringify(replay)+'\n';await writeFile(resolve(out,file),bytes);
      runs.push({id:kind,label:trained?'Gard ortamında yeniden eğitilen':'Önceki curriculum modeli',path:`/research/ringside/${file}`,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),trained});
    }
    cases.push({id:String(id),label,opponent:name,seed,runs});
  }
  const before=report.comparisons.warm.summary,after=report.comparisons.guarded.summary;
  const manifest={schema:1,experiment:report.experiment,publishedAt:new Date().toISOString(),modelSha256:report.modelSha256,sourceSha256:report.engineSha256,promotionPassed:report.researchGate==='PASS',training:{episodes:report.trainingEpisodes,generations:report.completedGenerations,method:'Yeni gard geometrisinde gerçek maç ödülüyle self-play refinement; önceki curriculum modelinden başlangıç, öğretmen etiketi yok',seconds:report.trainingMs/1000},evaluation:{games:after.episodes,beforeScore:before.winRate+.5*before.drawRate,afterScore:after.winRate+.5*after.drawRate,baseline:'Önceki eğitilmiş curriculum modeli; iki aday da aynı YENİ gard ortamında, aynı seed/rakip/taraflarda',scope:'16 yeni seed ×2 taraf ×8 rakip. Checkpoint yalnız validation ile seçildi; son test sonuçlarına göre politika veya eşik değiştirilmedi.'},limitations:[report.researchGate==='PASS'?'Dar araştırma eşikleri geçti; ürün/finansal geçiş onayı değildir.':'Kalite kapısı geçmedi: saldırı çeşitliliği ve motor override oranı hedefin dışında.','Ortalama 2,898 saldırı tekniği (hedef≥3), kararların %64,21’i motor tarafından değiştiriliyor (hedef≤%25).','Düşük enerjide gard motor kuralıdır; bu aday öğrenilmiş enerji yönetimi göstermedi.','Yeni yüksek gard ve önkol kapsülleri araştırma geometrisidir; tam rigid-body humanoid veya gerçekçi boks fiziği kanıtı değil.','128 gerçek MaleCNS düğümü, sabit varsayımsal dinamik ve öğrenilen çıktı ağırlıkları; bütün beyin veya bilinç değil.','Sadece çevrim dışı deney kaydı; canlı v3 motoru/biletleri değiştirilmedi, gerçek varlık kapıları kapalı.'],cases};
  await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({directory:out,manifest}));return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await exportGuardedPreview();
