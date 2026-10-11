begin;
create or replace function sollish.assert_session(p_user uuid, p_session uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare ident auth.identities%rowtype; mapped sollish.wallet_accounts%rowtype; identity_count integer; v_wallet text;
begin
 if not exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after > now())) then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 if exists(select 1 from auth.users u where u.id=p_user and u.banned_until > now()) or exists(select 1 from sollish.chat_bans b where b.user_id=p_user and (b.until_at is null or b.until_at > now())) then raise exception 'FORBIDDEN' using errcode='P0001'; end if;
 select count(*) into identity_count from auth.identities i where i.user_id=p_user and i.provider='web3' and i.provider_id like 'web3:solana:%';
 if identity_count <> 1 then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 select * into strict ident from auth.identities i where i.user_id=p_user and i.provider='web3' and i.provider_id like 'web3:solana:%';
 v_wallet := substring(ident.provider_id from 13);
 if v_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or ident.identity_data->>'sub' is distinct from ident.provider_id or jsonb_typeof(ident.identity_data->'custom_claims') is distinct from 'object' or jsonb_typeof(ident.identity_data->'custom_claims'->'chain') is distinct from 'string' or jsonb_typeof(ident.identity_data->'custom_claims'->'address') is distinct from 'string' or ident.identity_data->'custom_claims'->>'chain' is distinct from 'solana' or ident.identity_data->'custom_claims'->>'address' is distinct from v_wallet then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 insert into sollish.wallet_accounts(user_id,identity_id,wallet) values(p_user,ident.id,v_wallet) on conflict(user_id) do nothing;
 select * into strict mapped from sollish.wallet_accounts where user_id=p_user;
 if mapped.wallet <> v_wallet or mapped.identity_id <> ident.id then raise exception 'AUTH_INVALID' using errcode='P0001'; end if;
 return v_wallet;
end $$;
commit;
