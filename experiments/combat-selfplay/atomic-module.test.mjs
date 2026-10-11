import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec=promisify(execFile);
test('concurrent independent builders import complete exports and preserve the recorded guarded artifact',async()=>{
  const regular=new URL('./environment.mjs',import.meta.url).href,guarded=new URL('./guarded-environment.mjs',import.meta.url).href;
  const code=`const {loadEnvironment}=await import(${JSON.stringify(regular)});const {loadGuardedEnvironment}=await import(${JSON.stringify(guarded)});const runs=await Promise.all([loadEnvironment(),loadGuardedEnvironment(),loadEnvironment(),loadGuardedEnvironment()]);for(const r of runs)if(typeof r.simulate!=='function')throw Error('INCOMPLETE_MODULE');console.log(JSON.stringify(runs.map(r=>({engine:r.engineSha256,adapter:r.adapterSha256}))));`;
  const workers=await Promise.all(Array.from({length:4},()=>exec(process.execPath,['--input-type=module','-e',code],{timeout:30000,maxBuffer:16384}))),reference=JSON.parse(await readFile(new URL('./evidence/guarded-contact-1/evaluation.json',import.meta.url)));
  for(const worker of workers){const identities=JSON.parse(worker.stdout);assert.equal(identities.length,4);for(const i of [1,3]){assert.equal(identities[i].engine,reference.engineSha256);assert.equal(identities[i].adapter,reference.adapterSha256);}assert.deepEqual(identities[0],identities[2]);}
});
