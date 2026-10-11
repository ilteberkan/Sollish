import{build}from'esbuild';import{resolve}from'node:path';import{pathToFileURL}from'node:url';import{readFile,mkdtemp,rm}from'node:fs/promises';import assert from'node:assert/strict';
const directory=await mkdtemp(resolve('.tooling/physics-trace-tests-'));
try{
const outfile=resolve(directory,'component.mjs');await build({entryPoints:['apps/web/components/boxing-physics-lab.tsx'],outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',alias:{'three/addons':resolve('apps/web/node_modules/three/examples/jsm'),three:resolve('apps/web/node_modules/three/build/three.module.js')},logLevel:'silent'});
const{validatePhysicsTrace}=await import(pathToFileURL(outfile));const trace=JSON.parse(await readFile('experiments/combat-physics/evidence/trace.json','utf8'));assert.equal(validatePhysicsTrace(trace),trace);let count=1;
for(const mutate of [x=>{x.bones[1].parent=1},x=>{x.frames[0].bones[0].p[0]=Infinity},x=>{x.frames[0].bones[0].q=[2,0,0,0]},x=>{x.frames[0].contacts=[{p:[0,0,0],force:NaN,geom1:'a',geom2:'b'}]},x=>{x.frames[0].bag=null},x=>{x.metrics.qualityReady='yes'},x=>{x.frames[2].t=x.frames[1].t}]){const x=structuredClone(trace);mutate(x);assert.throws(()=>validatePhysicsTrace(x));count++;}
console.log(JSON.stringify({traceValidationAssertions:count,status:'PASS'}));
}finally{await rm(directory,{recursive:true,force:true})}
