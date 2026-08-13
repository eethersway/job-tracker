-- JobTracker schema (run once in the Supabase SQL editor of a fresh project)

create type application_status as enum
  ('new','applied','screening','interviewing','negotiating','accepted','rejected','declined','ghosted');

create table companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  website text,
  summary text,
  size text,
  industry text,
  hq text,
  funding text,
  products text,
  recent_news text,
  research_md text,
  researched_at timestamptz,
  created_at timestamptz not null default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  company_id uuid references companies(id) on delete set null,
  company_name text not null,
  job_title text not null,
  job_url text,
  job_description text,
  location text,
  salary text,
  source text not null default 'manual',
  status application_status not null default 'new',
  notes text,
  callouts_md text,
  date_added timestamptz not null default now(),
  date_applied date,
  updated_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  application_id uuid not null references applications(id) on delete cascade,
  type text not null check (type in ('resume','cover_letter')),
  content_md text,
  created_at timestamptz not null default now()
);

create table profile (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  full_name text,
  location text,
  phone text,
  email text,
  linkedin_url text,
  website text,
  master_resume_md text,
  highlights_md text,
  skills_md text,
  extra_context_md text,
  anthropic_api_key text,
  capture_token text unique,
  onboarding_dismissed boolean not null default false,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger applications_updated_at before update on applications
for each row execute function set_updated_at();

alter table companies enable row level security;
alter table applications enable row level security;
alter table documents enable row level security;
alter table profile enable row level security;

create policy "own rows" on applications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on companies for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on documents for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own row" on profile for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index applications_user_idx on applications(user_id);
create index companies_user_idx on companies(user_id);
create index documents_user_idx on documents(user_id);
create index profile_capture_token_idx on profile(capture_token);
