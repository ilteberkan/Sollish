/** Learned residual policy; no legality mask or deterministic guard/attack rule. */
import { ACTIONS, FEATURES, PARAMETERS } from './policy.mjs';

export const ENERGY_FEATURES=16;
export const ENERGY_PARAMETERS=ENERGY_FEATURES*8;
const COST=[0,0,0,0,90,130,145,185];
export function initialEnergyParameters(){const p=new Float64Array(ENERGY_PARAMETERS);for(let a=0;a<8;a++)p[a*ENERGY_FEATURES+14]=1;return p;}
export function createEnergyController(parameters,baseParameters,reservoir,observe){
  if(parameters.length!==ENERGY_PARAMETERS||baseParameters.length!==PARAMETERS||[...parameters,...baseParameters].some(x=>!Number.isFinite(x)))throw new Error('BAD_ENERGY_PARAMETERS');
  const theta=Float64Array.from(parameters),base=Float64Array.from(baseParameters),state=new Float64Array(128),drive=new Float64Array(128),features=new Float64Array(FEATURES),baseScores=new Float64Array(8),scores=new Float64Array(8),history=new Float64Array(8);let previous=-1;
  return inputs=>{
    if(inputs.length!==10||inputs.some(x=>!Number.isFinite(x)||x< -1||x>1))throw new Error('BAD_OBSERVATION');
    for(let i=0;i<128;i++){let v=reservoir.input[i*11];for(let j=0;j<10;j++)v+=reservoir.input[i*11+j+1]*inputs[j];drive[i]=v;}
    if(reservoir.variant!=='no-recurrence')for(let e=0;e<reservoir.pre.length;e++)drive[reservoir.post[e]]+=reservoir.weights[e]*state[reservoir.pre[e]];
    features[0]=1;for(let j=0;j<10;j++)features[j+1]=inputs[j];
    for(let i=0;i<128;i++){state[i]=reservoir.variant==='no-recurrence'?Math.tanh(drive[i]):.65*state[i]+.35*Math.tanh(drive[i]);features[i+11]=state[i];}
    for(let a=0;a<8;a++){let v=0;for(let j=0;j<FEATURES;j++)v+=base[a*FEATURES+j]*features[j];baseScores[a]=v;}
    const centre=baseScores.reduce((s,x)=>s+x,0)/8,scale=Math.max(.01,Math.sqrt(baseScores.reduce((s,x)=>s+(x-centre)**2,0)/8)),energy=(inputs[1]+1)/2,distance=(inputs[0]+1)*2;
    let selected=0;
    for(let a=0;a<8;a++){
      // Features describe own resources/history and public controller geometry. None excludes an action.
      const x=[1,energy,energy*energy,energy**3,inputs[0],Math.max(0,distance-.74),Math.max(0,distance-.86),inputs[3],inputs[4],inputs[2],inputs[9],history[a],previous===a?1:0,(1-energy)*COST[a]/185,(baseScores[a]-centre)/scale,Math.max(0,.4-energy)];
      let v=0;for(let j=0;j<ENERGY_FEATURES;j++)v+=theta[a*ENERGY_FEATURES+j]*x[j];scores[a]=v;if(v>scores[selected])selected=a;
    }
    if(scores.some(x=>!Number.isFinite(x)))throw new Error('NONFINITE_ENERGY_SCORES');
    observe?.({proposed:ACTIONS[selected],scores:Array.from(scores),energy,previous:previous<0?null:ACTIONS[previous]});
    for(let a=0;a<8;a++)history[a]=.75*history[a]+(a===selected?.25:0);previous=selected;
    return ACTIONS[selected];
  };
}
