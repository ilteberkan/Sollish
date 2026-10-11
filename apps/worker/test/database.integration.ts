/** Explicit local-only PostgreSQL test, after supabase/tests/local-postgres.sh. */
import postgres from 'postgres';
import assert from 'node:assert/strict';
const sql=postgres({host:'127.0.0.1',port:55432,database:'sollish_backend_test',max:3});
try{
 const writer=async()=>{for(let i=0;i<200;i++)await sql.begin(async tx=>{const [{seq}]=await tx`update sollish.streams set seq=seq+1 where id='lobby' returning seq`;const id=crypto.randomUUID();await tx`insert into sollish.outbox(id,seq,event) values(${id},${seq},${tx.json({seq:Number(seq)})})`;});};
 const reader=async()=>{for(let i=0;i<300;i++){const [{view}]=await sql`select public.chat_snapshot(${i%2?0:Math.max(0,i-5)},20) as view`;assert.ok(view.events.every((event:{seq:number})=>event.seq<=view.seq));assert.ok(view.events.length<=20);}};
 await Promise.all([writer(),reader(),reader()]);console.log('PASS: 200 concurrent commits, 600 bounded snapshots / 1200 assertions');
}finally{await sql.end();}
