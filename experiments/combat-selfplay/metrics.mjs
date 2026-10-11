import { ACTIONS } from './policy.mjs';

export function summarizeEpisode(replay, side, decisions) {
  const id=side===0?'kor':'ayaz',opponent=side===0?'ayaz':'kor';
  const strikes=replay.events.filter(e=>e.actor===id&&e.type==='strike');
  const contacts=replay.events.filter(e=>e.actor===id&&(e.type==='hit'||e.type==='block'));
  const suffered=replay.events.filter(e=>e.actor===opponent&&(e.type==='hit'||e.type==='block'));
  const counts=Object.fromEntries(ACTIONS.map(a=>[a,0])),proposed={...counts};let forced=0;
  for(const d of decisions)if(d.side===side){counts[d.effective]++;proposed[d.proposed]++;if(d.effective!==d.proposed)forced++;}
  const n=Object.values(counts).reduce((a,b)=>a+b,0), probabilities=Object.values(counts).filter(Boolean).map(x=>x/n);
  const entropy=-probabilities.reduce((s,p)=>s+p*Math.log(p),0)/Math.log(8);
  const end=replay.events.find(e=>e.type==='finish')?.tick??900;
  const maxGap=ticks=>Math.max(...[0,...ticks,end].slice(1).map((t,i)=>t-[0,...ticks,end][i]))*50;
  const damageDealt=contacts.reduce((s,e)=>s+e.damage,0),damageReceived=suffered.reduce((s,e)=>s+e.damage,0);
  const terminal=replay.winner==='draw'?0:replay.winner===id?1:-1;
  const noContactMs=maxGap(contacts.map(e=>e.tick));
  // Reward observes the result, never selects it. No teacher labels or wager data.
  const reward=terminal+.002*(damageDealt-damageReceived)+.15*entropy-.15*Math.min(1,noContactMs/45000);
  return {reward,win:terminal===1?1:0,draw:terminal===0?1:0,loss:terminal===-1?1:0,damageDealt,damageReceived,strikes:strikes.length,contacts:contacts.length,entropy,uniqueActions:probabilities.length,maxActionShare:Math.max(...probabilities,0),noStrikeMs:maxGap(strikes.map(e=>e.tick)),noContactMs,forcedFraction:n?forced/n:0,decisions:n,counts,proposed,ringViolations:replay.frames.flatMap(f=>[f.kor,f.ayaz]).filter(f=>Math.abs(f.x)>3250||Math.abs(f.z)>2200||!Number.isFinite(f.health)||f.stamina<0||f.stamina>1000).length};
}
export function aggregate(rows) {
  const mean=key=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
  return {episodes:rows.length,winRate:mean('win'),drawRate:mean('draw'),lossRate:mean('loss'),meanReward:mean('reward'),meanDamageDealt:mean('damageDealt'),meanDamageReceived:mean('damageReceived'),meanStrikes:mean('strikes'),meanContacts:mean('contacts'),meanActionEntropy:mean('entropy'),meanUniqueActions:mean('uniqueActions'),maxActionShare:Math.max(...rows.map(r=>r.maxActionShare)),maxNoStrikeMs:Math.max(...rows.map(r=>r.noStrikeMs)),maxNoContactMs:Math.max(...rows.map(r=>r.noContactMs)),meanForcedFraction:mean('forcedFraction'),ringViolations:rows.reduce((s,r)=>s+r.ringViolations,0),actions:Object.fromEntries(ACTIONS.map(a=>[a,rows.reduce((s,r)=>s+r.counts[a],0)]))};
}
