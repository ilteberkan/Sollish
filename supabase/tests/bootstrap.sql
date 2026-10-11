-- Local PostgreSQL fixture only: Auth table shape needed by this migration.
-- This is NOT a Supabase Auth server or JWT security substitute.
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create schema auth;
create table auth.users(id uuid primary key,banned_until timestamptz,raw_user_meta_data jsonb);
create table auth.identities(id uuid primary key,user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
