begin;
-- Operator grants LOGIN/password separately; this migration contains no secret.
do $$ begin if not exists(select 1 from pg_roles where rolname='sollish_worker') then create role sollish_worker nologin; end if; end $$;
create schema if not exists sollish;
revoke all on schema sollish from public, anon, authenticated, service_role;

create table sollish.settings (
 id boolean primary key default true check(id),
 chat_min_wager_lamports numeric(20,0) check(chat_min_wager_lamports > 0),
 games_program text,
 genesis text not null default 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
 check(genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
);
insert into sollish.settings(id) values(true);
create table sollish.wallet_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 identity_id uuid not null unique,
 wallet text not null unique check(wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 verified_at timestamptz not null default now()
);
create table sollish.chat_bans (user_id uuid primary key references auth.users(id), until_at timestamptz, reason_code text not null);
create table sollish.index_state (
 stream text primary key, genesis text not null, program text not null,
 cursor_signature text, finalized_slot bigint not null check(finalized_slot >= 0),
 refreshed_at timestamptz not null default now()
);
create table sollish.chain_facts (
 id text primary key, genesis text not null, program text not null,
 signature text not null check(signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
 instruction_id text not null check(instruction_id ~ '^[0-9]{1,4}:[0-9]{1,4}:[0-9]{1,5}$'),
 slot bigint not null check(slot >= 0 and slot <= 9007199254740991),
 bet text not null check(bet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 wallet text not null check(wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
 stake_lamports numeric(20,0) not null check(stake_lamports > 0 and stake_lamports <= 18446744073709551615),
 payout_lamports numeric(20,0) not null check(payout_lamports >= 0 and payout_lamports <= 18446744073709551615),
 occurred_at timestamptz not null,
 event_kind text not null check(event_kind in ('coinflip.placed','coinflip.settled')),
 finality text not null check(finality = 'finalized'),
 unique(genesis, program, signature, instruction_id),
 unique(genesis, program, bet, event_kind)
);
create index chain_facts_wallet_time on sollish.chain_facts(wallet, occurred_at desc);
create table sollish.streams (id text primary key check(id = 'lobby'), seq bigint not null default 0 check(seq between 0 and 9007199254740991));
insert into sollish.streams(id) values('lobby');
create table sollish.chat_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 wallet text not null, client_id uuid not null, body text not null check(char_length(body) between 1 and 500 and octet_length(body) <= 2000),
 created_at timestamptz not null default now(), seq bigint not null unique,
 unique(user_id, client_id)
);
create index chat_user_recent on sollish.chat_messages(user_id, created_at desc);
create table sollish.outbox (
 id uuid primary key default gen_random_uuid(), seq bigint not null unique,
 event jsonb not null, created_at timestamptz not null default now(),
 delivered_at timestamptz, lease_owner uuid, lease_until timestamptz
);
create index outbox_pending on sollish.outbox(seq) where delivered_at is null;
alter table sollish.settings enable row level security;
alter table sollish.wallet_accounts enable row level security;
alter table sollish.chat_bans enable row level security;
alter table sollish.index_state enable row level security;
alter table sollish.chain_facts enable row level security;
alter table sollish.streams enable row level security;
alter table sollish.chat_messages enable row level security;
alter table sollish.outbox enable row level security;
-- No table policies/grants expose identity, moderation, facts or outbox. Public
-- reads and narrowly privileged writes pass through the functions below.
revoke all on all tables in schema sollish from public, anon, authenticated, service_role;

create function sollish.assert_session(p_user uuid, p_session uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare ident auth.identities%rowtype; mapped sollish.wallet_accounts%rowtype; identity_count integer; v_wallet text;
begin
 if not exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after > now())) then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 if exists(select 1 from auth.users u where u.id=p_user and u.banned_until > now()) or exists(select 1 from sollish.chat_bans b where b.user_id=p_user and (b.until_at is null or b.until_at > now())) then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
 select count(*) into identity_count from auth.identities i where i.user_id=p_user and i.provider='web3' and i.provider_id like 'web3:solana:%';
 if identity_count <> 1 then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 select * into strict ident from auth.identities i where i.user_id=p_user and i.provider='web3' and i.provider_id like 'web3:solana:%';
 v_wallet := substring(ident.provider_id from 13);
 if v_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or ident.identity_data->>'sub' is distinct from ident.provider_id or ident.identity_data->>'chain' is distinct from 'solana' or ident.identity_data->>'address' is distinct from v_wallet then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 insert into sollish.wallet_accounts(user_id,identity_id,wallet) values(p_user,ident.id,v_wallet) on conflict(user_id) do nothing;
 select * into strict mapped from sollish.wallet_accounts where user_id=p_user;
 if mapped.wallet <> v_wallet or mapped.identity_id <> ident.id then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 return v_wallet;
end $$;

create function public.verify_chat_session(p_user uuid, p_session uuid) returns jsonb
language sql security definer set search_path = '' as $$
 select jsonb_build_object('wallet',sollish.assert_session(p_user,p_session));
$$;

create function public.submit_chat(p_user uuid,p_session uuid,p_client_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_wallet text; minimum numeric; total numeric; message sollish.chat_messages%rowtype; event jsonb; next_seq bigint; event_id uuid; created timestamptz := clock_timestamp();
begin
 v_wallet := sollish.assert_session(p_user,p_session);
 -- Serialize per-user idempotency and rate limits across every bucket/connection.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,17));
 select * into message from sollish.chat_messages where user_id=p_user and client_id=p_client_id;
 if found then select o.event into event from sollish.outbox o where o.seq=message.seq; return event; end if;
 if p_body is null or p_body <> btrim(p_body) or char_length(p_body) not between 1 and 500 or octet_length(p_body)>2000 or p_body ~ '[[:cntrl:]]' then raise exception 'INVALID_MESSAGE' using errcode='P0001'; end if;
 select chat_min_wager_lamports into minimum from sollish.settings where id;
 if minimum is null or not exists(select 1 from sollish.index_state where stream='coinflip' and refreshed_at > now()-interval '90 seconds') then raise exception 'CHAT_UNAVAILABLE' using errcode='P0001'; end if;
 select coalesce(sum(stake_lamports),0) into total from sollish.chain_facts f where f.wallet=v_wallet and f.event_kind='coinflip.placed' and f.finality='finalized' and f.occurred_at > now()-interval '1 hour' and f.occurred_at <= now();
 if total < minimum then raise exception 'CHAT_INELIGIBLE' using errcode='P0001'; end if;
 if exists(select 1 from sollish.chat_messages where user_id=p_user and created_at > now()-interval '2 seconds') or (select count(*) from sollish.chat_messages where user_id=p_user and created_at > now()-interval '1 minute') >= 20 then raise exception 'RATE_LIMITED' using errcode='P0001'; end if;
 update sollish.streams set seq=seq+1 where id='lobby' returning seq into next_seq;
 insert into sollish.chat_messages(user_id,wallet,client_id,body,created_at,seq) values(p_user,v_wallet,p_client_id,p_body,created,next_seq) returning * into message;
 event_id := gen_random_uuid();
 event := jsonb_build_object('v',1,'stream','lobby','id',event_id,'seq',next_seq,'occurredAt',created,'kind','chat.message','payload',jsonb_build_object('id',message.id,'wallet',v_wallet,'body',p_body,'createdAt',created));
 insert into sollish.outbox(id,seq,event) values(event_id,next_seq,event);
 return event;
end $$;

create function public.ingest_coinflip(p_genesis text,p_program text,p_signature text,p_instruction_id text,p_slot bigint,p_bet text,p_wallet text,p_stake text,p_payout text,p_event_kind text,p_occurred_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare cfg sollish.settings%rowtype; fact_id text; existing sollish.chain_facts%rowtype; next_seq bigint; event_id uuid; event jsonb;
begin
 select * into strict cfg from sollish.settings where id;
 if cfg.games_program is null or p_program is distinct from cfg.games_program or p_genesis is distinct from cfg.genesis then raise exception 'CHAIN_CONFIG_MISMATCH'; end if;
 if p_stake !~ '^[1-9][0-9]{0,19}$' or p_payout !~ '^(0|[1-9][0-9]{0,19})$' or p_occurred_at > now()+interval '30 seconds' or p_event_kind not in ('coinflip.placed','coinflip.settled') then raise exception 'INVALID_CHAIN_FACT'; end if;
 fact_id := p_genesis||':'||p_program||':'||p_signature||':'||p_instruction_id;
 perform pg_advisory_xact_lock(hashtextextended(fact_id,23));
 select * into existing from sollish.chain_facts where id=fact_id;
 if found then
  if existing.bet is distinct from p_bet or existing.wallet is distinct from p_wallet or existing.stake_lamports is distinct from p_stake::numeric or existing.payout_lamports is distinct from p_payout::numeric or existing.slot is distinct from p_slot or existing.occurred_at is distinct from p_occurred_at or existing.event_kind is distinct from p_event_kind then raise exception 'CHAIN_FACT_CONFLICT'; end if;
  return false;
 end if;
 insert into sollish.chain_facts values(fact_id,p_genesis,p_program,p_signature,p_instruction_id,p_slot,p_bet,p_wallet,p_stake::numeric,p_payout::numeric,p_occurred_at,p_event_kind,'finalized');
 update sollish.streams set seq=seq+1 where id='lobby' returning seq into next_seq;
 event_id := gen_random_uuid();
 event := jsonb_build_object('v',1,'stream','lobby','id',event_id,'seq',next_seq,'occurredAt',clock_timestamp(),'kind','chain.'||p_event_kind,'payload',jsonb_build_object('game','coinflip','transaction',p_signature,'instructionId',p_instruction_id,'slot',p_slot,'wallet',p_wallet,'stakeLamports',p_stake) || case when p_event_kind='coinflip.settled' then jsonb_build_object('payoutLamports',p_payout,'settledAt',p_occurred_at) else jsonb_build_object('acceptedAt',p_occurred_at) end);
 insert into sollish.outbox(id,seq,event) values(event_id,next_seq,event);
 return true;
end $$;

create function public.advance_chain_cursor(p_genesis text,p_program text,p_signature text,p_slot bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from sollish.settings where id and genesis=p_genesis and games_program=p_program) or p_slot < 0 then raise exception 'CHAIN_CONFIG_MISMATCH'; end if;
 insert into sollish.index_state(stream,genesis,program,cursor_signature,finalized_slot) values('coinflip',p_genesis,p_program,p_signature,p_slot)
 on conflict(stream) do update set cursor_signature=excluded.cursor_signature,finalized_slot=excluded.finalized_slot,refreshed_at=now()
 where sollish.index_state.finalized_slot <= excluded.finalized_slot;
end $$;
create function public.chain_cursor() returns jsonb language sql security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('signature',cursor_signature,'slot',finalized_slot,'refreshedAt',refreshed_at) from sollish.index_state where stream='coinflip'),'null'::jsonb);
$$;

create function public.chat_snapshot(p_after bigint default 0,p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tail bigint; count_limit integer := least(greatest(p_limit,1),200); full_reset boolean; events jsonb;
begin
 if p_after < 0 or p_after > 9007199254740991 then raise exception 'INVALID_CURSOR'; end if;
 select seq into tail from sollish.streams where id='lobby';
 full_reset := p_after=0 or tail-p_after > count_limit or p_after > tail;
 if full_reset then select coalesce(jsonb_agg(event order by seq),'[]'::jsonb) into events from (select seq,event from sollish.outbox where seq <= tail order by seq desc limit count_limit) recent;
 else select coalesce(jsonb_agg(event order by seq),'[]'::jsonb) into events from sollish.outbox where seq > p_after and seq <= tail; end if;
 return jsonb_build_object('v',1,'type','snapshot','stream','lobby','seq',tail,'events',events,'truncated',full_reset);
end $$;

create function public.platform_status() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('lastIndexedSlot',(select finalized_slot from sollish.index_state where stream='coinflip'), 'indexFresh',exists(select 1 from sollish.index_state where stream='coinflip' and refreshed_at>now()-interval '90 seconds'), 'chatMinWagerLamports',(select chat_min_wager_lamports::text from sollish.settings where id));
$$;

create function public.claim_outbox(p_owner uuid,p_limit integer default 32) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare head sollish.outbox%rowtype;
begin
 -- One bounded publisher lease per logical stream; no later sequence can pass a
 -- leased head. Different streams may use separate locks when introduced.
 perform pg_advisory_xact_lock(hashtextextended('outbox:lobby',29));
 select * into head from sollish.outbox where delivered_at is null order by seq limit 1 for update;
 if not found or (head.lease_until > now() and head.lease_owner <> p_owner) then return; end if;
 return query update sollish.outbox set lease_owner=p_owner,lease_until=now()+interval '30 seconds'
 where id in (select id from sollish.outbox where delivered_at is null order by seq limit least(greatest(p_limit,1),32)) returning event;
end $$;
create function public.ack_outbox(p_owner uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update sollish.outbox set delivered_at=now(),lease_until=null where id=p_id and lease_owner=p_owner and lease_until >= now() and delivered_at is null;
 return found;
end $$;

revoke all on all functions in schema sollish from public,anon,authenticated,service_role;
revoke all on function public.verify_chat_session(uuid,uuid),public.submit_chat(uuid,uuid,uuid,text),public.ingest_coinflip(text,text,text,text,bigint,text,text,text,text,text,timestamptz),public.advance_chain_cursor(text,text,text,bigint),public.chain_cursor(),public.claim_outbox(uuid,integer),public.ack_outbox(uuid,uuid),public.chat_snapshot(bigint,integer),public.platform_status() from public,anon,authenticated,service_role;
grant execute on function public.verify_chat_session(uuid,uuid),public.submit_chat(uuid,uuid,uuid,text),public.ingest_coinflip(text,text,text,text,bigint,text,text,text,text,text,timestamptz),public.advance_chain_cursor(text,text,text,bigint),public.chain_cursor(),public.claim_outbox(uuid,integer),public.ack_outbox(uuid,uuid) to service_role;
grant execute on function public.chat_snapshot(bigint,integer),public.platform_status() to anon,authenticated,service_role;
grant usage on schema public to sollish_worker;
grant execute on function public.ingest_coinflip(text,text,text,text,bigint,text,text,text,text,text,timestamptz),public.advance_chain_cursor(text,text,text,bigint),public.chain_cursor(),public.claim_outbox(uuid,integer),public.ack_outbox(uuid,uuid) to sollish_worker;
commit;
