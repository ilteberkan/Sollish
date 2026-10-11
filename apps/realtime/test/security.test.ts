import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { allowedOrigin, authBase, configured, verifyPublisher, dbRpc, boundedText } from '../src/security';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',PUBLISH_SIGNING_KEY:'x'.repeat(32),ALLOWED_ORIGINS:'https://sollish.example,http://localhost:3000'};
test('exact origin and auth endpoint scheme configuration is fail closed',()=>{
 assert.equal(configured({}),false);assert.equal(configured(env),true);assert.equal(allowedOrigin('https://sollish.example.evil',env),false);assert.equal(allowedOrigin(null,env),false);assert.equal(allowedOrigin('https://sollish.example',env),true);
 assert.throws(()=>authBase({...env,SUPABASE_URL:'http://remote.invalid',ALLOW_LOCAL_AUTH:'true'}));assert.throws(()=>authBase({...env,SUPABASE_URL:'https://user:pass@example.supabase.co'}));assert.throws(()=>authBase({...env,SUPABASE_URL:'ftp://localhost',ALLOW_LOCAL_AUTH:'true'}));
 assert.equal(authBase({...env,SUPABASE_URL:'http://127.0.0.1:10000',ALLOW_LOCAL_AUTH:'true'}),'http://127.0.0.1:10000');
});
test('service publisher binds exact body, freshness and request ID',async()=>{
 const body='{"test":1}',stamp=Date.now(),id=randomUUID();const mac=createHmac('sha256',env.PUBLISH_SIGNING_KEY).update(`POST\n/internal/publish\n${stamp}\n${id}\n${createHash('sha256').update(body).digest('hex')}`).digest('hex');
 const request=new Request('https://worker.invalid/internal/publish',{headers:{'x-sollish-timestamp':String(stamp),'x-sollish-request-id':id,'x-sollish-signature':mac}});
 assert.equal(await verifyPublisher(request,body,env,stamp),true);assert.equal(await verifyPublisher(request,body+' ',env,stamp),false);assert.equal(await verifyPublisher(request,body,env,stamp+30_001),false);assert.equal(await verifyPublisher(request,body,{},stamp),false);
});
test('untrusted RPC errors never escape as raw provider data',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({message:'SECRET RAW BODY'}, {status:500});
 try{await assert.rejects(dbRpc(env,'verify_chat_session',{}),{message:'SERVICE_UNAVAILABLE'});}finally{globalThis.fetch=old;}
});

test('chunked publisher body cancels immediately at byte limit; invalid UTF8 rejected',async()=>{
 let reads=0,cancelled=false;const stream=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}});
 const request=new Request('http://localhost',{method:'POST',body:stream,duplex:'half'} as RequestInit);
 await assert.rejects(boundedText(request,8192),{message:'MESSAGE_TOO_LARGE'});assert.equal(cancelled,true);assert.ok(reads<=4);
 await assert.rejects(boundedText(new Request('http://localhost',{method:'POST',body:new Uint8Array([255])}),8),{message:'INVALID_MESSAGE'});
 assert.equal(await boundedText(new Request('http://localhost',{method:'POST',body:'ö'}),2),'ö');
});
