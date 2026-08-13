-- =============================================================================
-- StrongerApplicant / JobTracker — full database schema
-- =============================================================================
-- Generated on 2026-08-13 by introspecting the LIVE Supabase database
-- (project awebariljrravthdzujq) via pg_catalog / information_schema.
-- This file is the single source of truth for the schema.
--
-- HOW TO USE: paste the whole file into the Supabase SQL editor of a FRESH
-- project and run it top to bottom. It is ordered so that it executes without
-- errors on a clean database:
--   extensions -> types -> schemas -> tables -> indexes -> functions ->
--   triggers -> RLS -> policies -> grants/revokes
--
-- The SQL editor runs as the `postgres` role, which owns every object here and
-- has BYPASSRLS — that is what lets the SECURITY DEFINER credit/rate-limit
-- functions read and write tables that have FORCE ROW LEVEL SECURITY on.
-- Run it as `postgres`, not as a lesser role.
--
-- PROVIDED BY SUPABASE (do not create these yourself):
--   * the `auth` schema and `auth.users` table (all user_id FKs point at it)
--   * the `auth.uid()` helper used by column defaults and RLS policies
--   * the `anon`, `authenticated` and `service_role` roles
--   * the `extensions` schema
--   * default privileges in `public` that automatically grant ALL on new tables
--     and EXECUTE on new functions to anon/authenticated/service_role — the
--     revoke statements at the bottom of this file exist to claw those back.
--
-- NOTE ON COLUMN ORDER: `public.profile` has a historically dropped column, so
-- its live physical column ordinals cannot be reproduced exactly. Columns below
-- are declared in a readable order; nothing in the app depends on ordinal
-- position (all access is by column name).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto provides extensions.gen_random_bytes(), used by the token rotation
-- functions. It is pre-installed on Supabase; this is a no-op there.
create extension if not exists pgcrypto with schema extensions;


-- -----------------------------------------------------------------------------
-- 2. Types
-- -----------------------------------------------------------------------------
create type public.application_status as enum (
  'new',
  'applied',
  'screening',
  'interviewing',
  'negotiating',
  'accepted',
  'rejected',
  'declined',
  'ghosted'
);


-- -----------------------------------------------------------------------------
-- 3. Schemas
-- -----------------------------------------------------------------------------
-- `private` is never exposed through PostgREST and is granted to nobody:
-- only the owner (postgres) and SECURITY DEFINER functions it owns can read it.
-- Do NOT add `private` to the project's "Exposed schemas" setting.
create schema if not exists private;


-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  website       text,
  summary       text,
  size          text,
  industry      text,
  hq            text,
  funding       text,
  products      text,
  recent_news   text,
  research_md   text,
  researched_at timestamptz,
  created_at    timestamptz not null default now()
);

create table public.applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id      uuid references public.companies(id) on delete set null,
  company_name    text not null,
  job_title       text not null,
  job_url         text,
  job_description text,
  location        text,
  salary          text,
  source          text not null default 'manual',
  status          public.application_status not null default 'new',
  notes           text,
  callouts_md     text,
  date_added      timestamptz not null default now(),
  date_applied    date,
  updated_at      timestamptz not null default now()
);

create table public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  type           text not null constraint documents_type_check check (type = any (array['resume'::text, 'cover_letter'::text])),
  content_md     text,
  created_at     timestamptz not null default now()
);

create table public.profile (
  user_id              uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name            text,
  location             text,
  phone                text,
  email                text,
  linkedin_url         text,
  website              text,
  master_resume_md     text,
  highlights_md        text,
  skills_md            text,
  extra_context_md     text,
  anthropic_api_key    text,
  capture_token        text,
  api_token            text,
  onboarding_dismissed boolean not null default false,
  -- credits_cents / suspended / suspended_reason are SERVER-OWNED: they are
  -- writable only by service_role and the SECURITY DEFINER credit functions.
  -- The column grants at the bottom of this file are what enforce that.
  credits_cents        integer not null default 0 constraint profile_credits_cents_check check (credits_cents >= 0),
  suspended            boolean not null default false,
  suspended_reason     text,
  updated_at           timestamptz not null default now(),
  constraint profile_capture_token_key unique (capture_token),
  constraint profile_api_token_key     unique (api_token)
);

-- The live database carries a second, redundant UNIQUE on user_id alongside
-- profile_pkey. It must be added in a separate statement: declared inline in
-- CREATE TABLE, Postgres would collapse it into the primary key and the
-- constraint would not exist.
alter table public.profile add constraint profile_user_id_key unique (user_id);

-- Append-only credit ledger. Every balance change on profile.credits_cents has
-- a matching row here, written inside the same transaction by the functions
-- below. `authenticated` may only read its own rows (see policies + grants).
create table public.credit_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  delta_cents integer not null,
  kind        text not null constraint credit_transactions_kind_check check (
                kind = any (array[
                  'purchase_stripe'::text,
                  'purchase_x402'::text,
                  'grant'::text,
                  'spend_research'::text,
                  'spend_resume'::text,
                  'spend_cover_letter'::text,
                  'refund'::text,
                  'clawback_refund'::text,
                  'clawback_dispute'::text,
                  'adjustment'::text
                ])
              ),
  ref         text,
  created_at  timestamptz not null default now()
);

-- Fixed-window rate limiter. Written only by public.check_rate_limit().
create table public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket       text not null,
  window_start timestamptz not null default now(),
  count        integer not null default 0,
  primary key (user_id, bucket)
);

-- Server-side secrets (Stripe keys, central Anthropic key). Read only through
-- public.get_secret(), which is SECURITY DEFINER and service_role-only.
-- RLS is enabled with ZERO policies, so even if the schema were ever exposed
-- no client role could read a row.
create table private.app_secrets (
  key   text primary key,
  value text not null
);

-- Rows expected here (insert them yourself; values are deliberately not in this file):
--   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CENTRAL_ANTHROPIC_KEY
-- e.g. insert into private.app_secrets (key, value) values ('STRIPE_SECRET_KEY', 'sk_live_...');


-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
create index applications_user_idx on public.applications using btree (user_id);
create index companies_user_idx    on public.companies    using btree (user_id);
create index documents_user_idx    on public.documents    using btree (user_id);

create index profile_capture_token_idx on public.profile using btree (capture_token);
create index profile_api_token_idx     on public.profile using btree (api_token);

create index credit_tx_user_idx on public.credit_transactions using btree (user_id, created_at desc);

-- Idempotency guards: a Stripe/x402 payment reference can only ever be credited
-- once, and a refund/dispute for a given reference can only ever be clawed back
-- once. grant_credits() relies on the unique_violation these raise.
create unique index credit_tx_purchase_ref_uniq
  on public.credit_transactions using btree (kind, ref)
  where ((kind = any (array['purchase_stripe'::text, 'purchase_x402'::text])) and (ref is not null));

create unique index credit_tx_clawback_ref_uniq
  on public.credit_transactions using btree (kind, ref)
  where ((kind = any (array['clawback_refund'::text, 'clawback_dispute'::text])) and (ref is not null));


-- -----------------------------------------------------------------------------
-- 6. Functions
-- -----------------------------------------------------------------------------
-- Bodies below are verbatim from pg_get_functiondef() on the live database.

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_secret(k text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select value from private.app_secrets where key = k $function$;

CREATE OR REPLACE FUNCTION public.spend_credits(p_user_id uuid, p_amount_cents integer, p_kind text, p_ref text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bal int; susp boolean;
begin
  if p_amount_cents <= 0 then return true; end if;
  select credits_cents, suspended into bal, susp from public.profile where user_id = p_user_id for update;
  if bal is null or susp then return false; end if;
  if bal < p_amount_cents then return false; end if;
  update public.profile set credits_cents = credits_cents - p_amount_cents where user_id = p_user_id;
  insert into public.credit_transactions (user_id, delta_cents, kind, ref)
    values (p_user_id, -p_amount_cents, p_kind, p_ref);
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.grant_credits(p_user_id uuid, p_amount_cents integer, p_kind text, p_ref text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  if p_amount_cents <= 0 then return false; end if;
  begin
    insert into public.credit_transactions (user_id, delta_cents, kind, ref)
      values (p_user_id, p_amount_cents, p_kind, p_ref);
  exception when unique_violation then
    return false;
  end;
  update public.profile set credits_cents = credits_cents + p_amount_cents where user_id = p_user_id;
  get diagnostics n = row_count;
  if n = 0 then
    -- create the profile row so a payment is never silently lost
    insert into public.profile (user_id, credits_cents) values (p_user_id, p_amount_cents)
    on conflict (user_id) do update set credits_cents = public.profile.credits_cents + excluded.credits_cents;
  end if;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.debit_credits(p_user_id uuid, p_amount_cents integer, p_kind text, p_ref text, p_suspend boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bal int; taken int;
begin
  if p_amount_cents <= 0 then return 0; end if;
  select credits_cents into bal from public.profile where user_id = p_user_id for update;
  if bal is null then return 0; end if;
  taken := least(bal, p_amount_cents);
  if taken > 0 then
    update public.profile set credits_cents = credits_cents - taken where user_id = p_user_id;
    insert into public.credit_transactions (user_id, delta_cents, kind, ref)
      values (p_user_id, -taken, p_kind, p_ref);
  end if;
  if p_suspend then
    update public.profile
       set suspended = true,
           suspended_reason = coalesce(suspended_reason, 'payment reversed: ' || coalesce(p_ref,''))
     where user_id = p_user_id;
  end if;
  return taken;
end; $function$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_user_id uuid, p_bucket text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur record;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, now(), 0)
  on conflict (user_id, bucket) do nothing;

  select * into cur from public.rate_limits
   where user_id = p_user_id and bucket = p_bucket for update;

  if cur.window_start < now() - make_interval(secs => p_window_seconds) then
    update public.rate_limits set window_start = now(), count = 1
     where user_id = p_user_id and bucket = p_bucket;
    return true;
  end if;

  if cur.count >= p_max then
    return false;
  end if;

  update public.rate_limits set count = count + 1
   where user_id = p_user_id and bucket = p_bucket;
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.rotate_capture_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.profile (user_id, capture_token) values (auth.uid(), t)
  on conflict (user_id) do update set capture_token = t, updated_at = now();
  return t;
end; $function$;

CREATE OR REPLACE FUNCTION public.rotate_api_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.profile (user_id, api_token) values (auth.uid(), t)
  on conflict (user_id) do update set api_token = t, updated_at = now();
  return t;
end; $function$;


-- -----------------------------------------------------------------------------
-- 7. Triggers
-- -----------------------------------------------------------------------------
create trigger applications_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
-- FORCE is applied to every public table so that the table owner (postgres) is
-- also subject to the policies. postgres and service_role still bypass RLS via
-- their BYPASSRLS role attribute, which is how the SECURITY DEFINER functions
-- and the server-side Edge Functions do their work.

alter table public.companies           enable row level security;
alter table public.companies           force  row level security;

alter table public.applications        enable row level security;
alter table public.applications        force  row level security;

alter table public.documents           enable row level security;
alter table public.documents           force  row level security;

alter table public.profile             enable row level security;
alter table public.profile             force  row level security;

alter table public.credit_transactions enable row level security;
alter table public.credit_transactions force  row level security;

alter table public.rate_limits         enable row level security;
alter table public.rate_limits         force  row level security;

-- RLS on, deliberately NO policies: nothing but the owner/BYPASSRLS roles reads it.
alter table private.app_secrets enable row level security;


-- -----------------------------------------------------------------------------
-- 9. Policies
-- -----------------------------------------------------------------------------
create policy "own rows" on public.companies
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own rows" on public.applications
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own rows" on public.documents
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own row" on public.profile
  as permissive for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Read-only ledger: there is intentionally no insert/update/delete policy, so
-- authenticated can only ever SELECT its own transactions.
create policy "own ledger read" on public.credit_transactions
  as permissive for select to authenticated
  using (user_id = auth.uid());

-- public.rate_limits has RLS enabled and NO policies (writes go through
-- check_rate_limit()). private.app_secrets likewise has no policies.


-- -----------------------------------------------------------------------------
-- 10. Grants and revokes
-- -----------------------------------------------------------------------------
-- These are load-bearing for security. Supabase's default privileges hand
-- anon/authenticated ALL privileges on every new table in `public` and EXECUTE
-- on every new function, so the statements below claw that back. Do not drop
-- them.

-- 10a. anon has no table access in public at all.
revoke all on all tables in schema public from anon;

-- 10b. rate_limits is server-internal.
revoke all on public.rate_limits from anon, authenticated;

-- 10c. profile: authenticated keeps SELECT on every column (it needs to read
-- its own balance and tokens), but INSERT/UPDATE are narrowed to the columns a
-- user legitimately owns. credits_cents, suspended, suspended_reason,
-- capture_token and api_token are excluded — a client that could write
-- credits_cents could mint itself unlimited credits, and one that could write
-- capture_token/api_token could set a token it already knows. Tokens are
-- rotated through rotate_capture_token()/rotate_api_token() instead.
revoke insert, update on public.profile from authenticated, anon;

grant insert (
  user_id,
  full_name,
  location,
  phone,
  email,
  linkedin_url,
  website,
  master_resume_md,
  highlights_md,
  skills_md,
  extra_context_md,
  anthropic_api_key,
  onboarding_dismissed,
  updated_at
) on public.profile to authenticated;

grant update (
  user_id,
  full_name,
  location,
  phone,
  email,
  linkedin_url,
  website,
  master_resume_md,
  highlights_md,
  skills_md,
  extra_context_md,
  anthropic_api_key,
  onboarding_dismissed,
  updated_at
) on public.profile to authenticated;

-- 10d. companies / applications / documents / credit_transactions keep the
-- Supabase default table grants for authenticated; RLS is what scopes them.
-- credit_transactions holds table-level write grants but has no write policy,
-- so RLS blocks every client write.
grant select, insert, update, delete on public.companies           to authenticated;
grant select, insert, update, delete on public.applications        to authenticated;
grant select, insert, update, delete on public.documents           to authenticated;
grant select, insert, update, delete on public.credit_transactions to authenticated;

-- 10e. Function EXECUTE grants.
-- Server-only: the credit ledger, the rate limiter and the secret reader must
-- never be callable over PostgREST by a browser client.
revoke all on function public.get_secret(text)                                                     from public, anon, authenticated;
revoke all on function public.spend_credits(uuid, integer, text, text)                             from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, integer, text, text)                             from public, anon, authenticated;
revoke all on function public.debit_credits(uuid, integer, text, text, boolean)                    from public, anon, authenticated;
revoke all on function public.check_rate_limit(uuid, text, integer, integer)                       from public, anon, authenticated;

grant execute on function public.get_secret(text)                                                  to service_role;
grant execute on function public.spend_credits(uuid, integer, text, text)                          to service_role;
grant execute on function public.grant_credits(uuid, integer, text, text)                          to service_role;
grant execute on function public.debit_credits(uuid, integer, text, text, boolean)                 to service_role;
grant execute on function public.check_rate_limit(uuid, text, integer, integer)                    to service_role;

-- Client-callable: both rotation functions are meant to be invoked by a signed-in
-- user via rpc(). They keep the default EXECUTE grant (PUBLIC/anon included);
-- the `auth.uid() is null` guard in each body is what rejects unauthenticated
-- callers, and each writes only the caller's own row.
grant execute on function public.rotate_capture_token() to authenticated, service_role;
grant execute on function public.rotate_api_token()     to authenticated, service_role;

-- set_updated_at() keeps the default EXECUTE grants; it is only reachable as a
-- trigger function.

-- 10f. `private` is granted to no role. Nothing to do — do not add grants here.
