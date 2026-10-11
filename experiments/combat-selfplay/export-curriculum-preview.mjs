import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, episodeSeed, sha } from './environment.mjs';
import { loadReservoir } from './policy.mjs';
import { curriculumEpisode } from './curriculum.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
export async function exportCurriculumPreview(){
  const dir=resolve(HERE,'evidence/curriculum-2'),report=JSON.parse(await readFile(resolve(dir,'evaluation.json'))),modelBytes=await readFile(resolve(dir,'model.json')),model=JSON.parse(modelBytes),oldBytes=await readFile(resolve(HERE,'evidence/connectome-model.json')),v1=JSON.parse(oldBytes);
  if(sha(modelBytes)!==report.modelSha256||sha(oldBytes)!==model.warmStartModelSha256)throw new Error('MODEL_EVIDENCE_MISMATCH');
  const env=await loadEnvironment();if(env.engineSha256!==report.engineSha256||env.adapterSha256!==report.adapterSha256)throw new Error('ENVIRONMENT_EVIDENCE_MISMATCH');
  const graph=await loadReservoir(),out=resolve(dir,'preview'),cases=[];await mkdir(out,{recursive:true});
  for(const [id,name,label]of [[90000,'cross-only','Sürekli cross rakibi'],[90001,'heldout-delayed-counter','Gecikmeli kontra rakibi'],[90002,'heldout-combo','Görülmemiş kombinasyon rakibi']]){
    const seed=episodeSeed('curriculum-final',id),runs=[];
    for(const trained of [false,true]){
      const kind=trained?'curriculum':'v1',parameters=trained?model.parameters:v1.parameters,{replay}=curriculumEpisode(env,graph,parameters,name,seed,0,true);
      replay.version=`research:combat-selfplay-curriculum-2:${kind}:${report.modelSha256.slice(0,12)}`;
      replay.policy=`reward-trained:${trained?report.modelSha256:model.warmStartModelSha256}`;
      const file=`curriculum-${id}-${kind}.json`,bytes=JSON.stringify(replay)+'\n';await writeFile(resolve(out,file),bytes);
      runs.push({id:kind,label:trained?'Curriculum adayı':'Önceki öğrenilmiş model',path:`/research/ringside/${file}`,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),trained});
    }
    cases.push({id:String(id),label,opponent:name,seed,runs});
  }
  const before=report.comparisons.v1.summary,after=report.comparisons.curriculum.summary;
  const manifest={schema:1,experiment:report.experiment,publishedAt:new Date().toISOString(),modelSha256:report.modelSha256,sourceSha256:report.engineSha256,promotionPassed:report.researchGate==='PASS',training:{episodes:report.trainingEpisodes,generations:report.completedGenerations,method:'Geçmiş öğrenci + saldırı sömürücü rakip curriculum; reward tabanlı ES, açık çeşitlilik/override regularizasyonu, öğretmen etiketi yok',seconds:report.trainingMs/1000},evaluation:{games:after.episodes,beforeScore:before.winRate+.5*before.drawRate,afterScore:after.winRate+.5*after.drawRate,baseline:'Önceki öğrenilmiş v1 kontrolcüsü; aynı yeni seed/rakip/taraflar',scope:'32 yeni seed ×2 taraf ×8 rakip. Son testte ağırlık veya eşik değişmedi.'},limitations:[report.researchGate==='PASS'?'Dar araştırma eşikleri geçti; ürün/finansal geçiş onayı değildir.':'Araştırma kalite kapısı geçmedi; sonuçlar başarısız denemeyi de gösterir.','Sekiz hazır eylem seçimi öğrenildi. Eklem torku, fiziksel teknik veya bütün beyin öğrenilmedi.','128 gerçek MaleCNS düğümü; sabit varsayımsal dinamik ve öğrenilen çıkış readout’u.','Yaklaşma/düşük enerjide gard/anti-stall kuralları motor tarafından zorlanır.','Yeni kıyasın rakipleri yine küçük ve öngörülebilir; gerçek insan veya farklı fizik genellemesi kanıtlanmadı.','Yalnız çevrim dışı yerel araştırma kaydı; bahis veya gerçek varlık yetkisi yok.'],cases};
  await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({directory:out,manifest}));return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await exportCurriculumPreview();
