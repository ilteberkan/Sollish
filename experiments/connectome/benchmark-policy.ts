/** Local CPU inference only. Never executes combat, RPC, claims or deployment. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, arch, platform } from 'node:os';
import { createHash } from 'node:crypto';
import { CONNECTOME_POLICY_INFO, createPolicyState, evaluateCombatPolicy } from '../../packages/protocol/src/connectome-policy';
const fixture = JSON.parse(readFileSync(new URL('./evidence/policy-mlp-parity.json',import.meta.url),'utf8')) as {steps:{inputs:number[]}[]};
const state=createPolicyState(), samples:number[]=[];
for(let i=0;i<1000;i++) evaluateCombatPolicy(fixture.steps[i%fixture.steps.length].inputs,state);
const started=performance.now();
for(let i=0;i<10000;i++) {
  const start=performance.now();evaluateCombatPolicy(fixture.steps[i%fixture.steps.length].inputs,state);samples.push(performance.now()-start);
}
const elapsed=performance.now()-started;samples.sort((a,b)=>a-b);
const source=readFileSync(new URL('../../packages/protocol/src/connectome-policy.ts',import.meta.url));
const report={observedAt:new Date().toISOString(),scope:'local Node CPU inference after1000warmup; 10000observations; NOT Cloudflare/phone/fighting benchmark',model:CONNECTOME_POLICY_INFO,sourceSha256:createHash('sha256').update(source).digest('hex'),runtime:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},p50Ms:samples[4999],p95Ms:samples[9499],p99Ms:samples[9899],maxMs:samples.at(-1),totalMs:elapsed,budget:{criterion:'p95<1ms local; no nonfinite outputs',passed:samples[9499]<1},financialReadiness:false};
writeFileSync(new URL('./evidence/policy-runtime.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
