\set ON_ERROR_STOP on
create function pg_temp.expect_failure(statement text, expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; else raise; end if; end; raise exception 'EXPECTED_FAILURE_NOT_THROWN: %',expected; end $$;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if; end $$;
insert into auth.users values('11111111-1111-4111-8111-111111111111',null,'{"wallet":"attacker-controlled"}');
insert into auth.identities values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','web3','web3:solana:11111111111111111111111111111111','{"sub":"web3:solana:11111111111111111111111111111111","custom_claims":{"chain":"solana","address":"11111111111111111111111111111111"}}');
insert into auth.sessions values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',now()+interval '1 day');
select pg_temp.check_true((public.verify_chat_session('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')->>'wallet')='11111111111111111111111111111111','identity not user metadata');
-- Hosted Web3 Auth stores chain/address under custom_claims, never top-level.
-- A numeric all-base58 address must not pass merely because ->> coerces JSON.
do $$
declare v jsonb; canonical jsonb := '{"sub":"web3:solana:11111111111111111111111111111111","custom_claims":{"chain":"solana","address":"11111111111111111111111111111111"}}';
begin
 for v in select value from jsonb_array_elements('[
  {"chain":"solana","address":"11111111111111111111111111111111"},
  {},
  {"custom_claims":null},
  {"custom_claims":"solana"},
  {"custom_claims":[]},
  {"custom_claims":1},
  {"custom_claims":{"address":"11111111111111111111111111111111"}},
  {"custom_claims":{"chain":"solana"}},
  {"custom_claims":{"chain":"ethereum","address":"11111111111111111111111111111111"}},
  {"custom_claims":{"chain":"solana","address":"22222222222222222222222222222222"}},
  {"custom_claims":{"chain":"solana","address":11111111111111111111111111111111}},
  {"custom_claims":{"chain":"solana","address":["11111111111111111111111111111111"]}},
  {"custom_claims":{"chain":1,"address":"11111111111111111111111111111111"}},
  {"sub":"web3:solana:22222222222222222222222222222222","custom_claims":{"chain":"solana","address":"11111111111111111111111111111111"}}
 ]'::jsonb) loop
  update auth.identities set identity_data=jsonb_build_object('sub',canonical->>'sub')||v;
  perform pg_temp.expect_failure($s$select public.verify_chat_session('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')$s$,'AUTH_INVALID');
 end loop;
 update auth.identities set identity_data=canonical,provider_id='web3:solana:22222222222222222222222222222222';
 perform pg_temp.expect_failure($s$select public.verify_chat_session('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')$s$,'AUTH_INVALID');
 update auth.identities set identity_data=canonical,provider_id=canonical->>'sub';
end $$;
select pg_temp.expect_failure($s$select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello')$s$,'CHAT_UNAVAILABLE');
update sollish.settings set games_program='8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',chat_min_wager_lamports=200;
select public.advance_chain_cursor('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',null,100);
select pg_temp.expect_failure($s$select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello')$s$,'CHAT_INELIGIBLE');
-- Settled-only and old admissions cannot qualify a wallet.
select public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:1',100,repeat('2',32),repeat('1',32),'200','0','coinflip.settled',now()-interval '5 minutes');
select public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:2',100,repeat('3',32),repeat('1',32),'200','0','coinflip.placed',now()-interval '61 minutes');
select pg_temp.expect_failure($s$select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello')$s$,'CHAT_INELIGIBLE');
-- Fixed timestamp allows exact replay/conflict tests.
create temporary table test_clock(t timestamptz);insert into test_clock values(date_trunc('second',now()-interval '1 minute'));
select public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:3',100,repeat('4',32),repeat('1',32),'200','0','coinflip.placed',(select t from test_clock));
select pg_temp.check_true(not public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:3',100,repeat('4',32),repeat('1',32),'200','0','coinflip.placed',(select t from test_clock)),'same fact idempotent');
select pg_temp.expect_failure($s$select public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:3',100,repeat('4',32),repeat('1',32),'201','0','coinflip.placed',(select t from test_clock))$s$,'CHAIN_FACT_CONFLICT');
select pg_temp.expect_failure($s$select public.ingest_coinflip('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','8V4v7SqwVqx6aZUf2kFwJWdbSKBhqn5vdR4YeqZsfcQJ',repeat('1',64),'0:0:4',100,repeat('4',32),repeat('1',32),'200','0','coinflip.placed',(select t from test_clock))$s$,'duplicate key');
select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello');
select pg_temp.check_true((public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello')->>'seq')='4','same chat idempotent');
select pg_temp.expect_failure($s$select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','hello')$s$,'RATE_LIMITED');
select pg_temp.check_true((select count(*)=1 from sollish.chat_messages) and (select count(*)=4 from sollish.outbox) and (select seq=4 from sollish.streams),'message/outbox/sequence atomic');
select pg_temp.check_true((public.chat_snapshot(0,2)->>'truncated')::boolean and jsonb_array_length(public.chat_snapshot(0,2)->'events')=2,'bounded snapshot');
select pg_temp.check_true((select count(*)=4 from public.claim_outbox('66666666-6666-4666-8666-666666666666',32)),'first publisher lease');
select pg_temp.check_true((select count(*)=0 from public.claim_outbox('77777777-7777-4777-8777-777777777777',32)),'second publisher cannot overtake');
select pg_temp.check_true(not public.ack_outbox('77777777-7777-4777-8777-777777777777',(select id from sollish.outbox limit 1)),'wrong owner cannot ack');
select pg_temp.check_true(public.ack_outbox('66666666-6666-4666-8666-666666666666',(select id from sollish.outbox order by seq limit 1)),'lease owner ack');
-- Identity immutable after first binding even if Auth administrative state changes.
update auth.identities set provider_id='web3:solana:'||repeat('2',32),identity_data=jsonb_build_object('sub','web3:solana:'||repeat('2',32),'custom_claims',jsonb_build_object('chain','solana','address',repeat('2',32)));
select pg_temp.expect_failure($s$select public.verify_chat_session('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')$s$,'AUTH_INVALID');
update auth.sessions set not_after=now()-interval '1 second';
select pg_temp.expect_failure($s$select public.verify_chat_session('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')$s$,'AUTH_INVALID');
-- Grant inspection covers every public entry and all eight RLS tables.
select pg_temp.check_true(not has_function_privilege('anon','public.submit_chat(uuid,uuid,uuid,text)','EXECUTE') and not has_function_privilege('authenticated','public.ingest_coinflip(text,text,text,text,bigint,text,text,text,text,text,timestamptz)','EXECUTE'),'public cannot submit or forge facts');
select pg_temp.check_true(not has_function_privilege('sollish_worker','public.verify_chat_session(uuid,uuid)','EXECUTE') and has_function_privilege('sollish_worker','public.chain_cursor()','EXECUTE'),'indexer least privilege');
select pg_temp.check_true((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sollish' and c.relkind='r'),'RLS all backend tables');
select pg_temp.check_true(not has_table_privilege('anon','sollish.wallet_accounts','SELECT') and not has_table_privilege('service_role','sollish.chain_facts','INSERT'),'no raw table authority');
set role anon;
select pg_temp.expect_failure('select * from sollish.wallet_accounts','permission denied');
select pg_temp.expect_failure($s$select public.submit_chat('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','hello')$s$,'permission denied');
select pg_temp.check_true(public.chat_snapshot(0,1)->>'stream'='lobby','anon sanitized read works');
reset role;
set role sollish_worker;
select pg_temp.expect_failure('select * from auth.identities','permission denied');
select pg_temp.check_true((public.chain_cursor()->>'slot')='100','worker narrow chain cursor works');
reset role;
select 'PASS: 41 assertions, actual PostgreSQL; Auth tables are isolated fixtures matching hosted nested Web3 claims' as result;
