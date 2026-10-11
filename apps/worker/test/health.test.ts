import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('actual worker process without credentials starts only localhost health and remains unavailable',async()=>{
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../src/main.ts',import.meta.url))],{env:{PATH:process.env.PATH,WORKER_PORT:'18890'},stdio:'ignore'});
 try{let response:Response|undefined;for(let i=0;i<100;i++){try{response=await fetch('http://127.0.0.1:18890/health');break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(response);assert.equal(response.status,503);const state=await response.json();assert.equal(state.configured,false);assert.equal(state.ready,false);assert.equal(state.keeper,'disabled-no-deployment-or-fee-key');assert.equal((await fetch('http://127.0.0.1:18890/anything')).status,404);
 }finally{child.kill('SIGTERM');await new Promise<void>((resolve,reject)=>{if(child.exitCode!==null){resolve();return;}const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('WORKER_SHUTDOWN_TIMEOUT'));},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
});
test('ESM source entrypoint follows a release symlink while normal imports remain inert',async()=>{
 const {mkdtemp,symlink,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {isEntrypoint}=await import('../src/main');
 assert.equal(isEntrypoint(undefined),false);assert.equal(isEntrypoint('/nonexistent/sollish'),false);assert.equal(isEntrypoint(fileURLToPath(import.meta.url)),false);
 const dir=await mkdtemp(join(tmpdir(),'sollish-worker-entry-'));const path=join(dir,'main.ts');await symlink(fileURLToPath(new URL('../src/main.ts',import.meta.url)),path);assert.equal(isEntrypoint(path),true);
 const child=spawn(process.execPath,['--import','tsx',path],{env:{PATH:process.env.PATH,WORKER_PORT:'18891'},stdio:'ignore'});
 try{let response:Response|undefined;for(let i=0;i<100;i++){try{response=await fetch('http://127.0.0.1:18891/health');break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.equal(response?.status,503);assert.equal((await response!.json()).configured,false);
 }finally{child.kill('SIGTERM');await new Promise<void>(r=>{if(child.exitCode!==null){r();return;}child.once('exit',()=>r());});await rm(dir,{recursive:true,force:true});}
});
