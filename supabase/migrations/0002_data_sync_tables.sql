-- Jobs, configs, and company settings tables for cross-device sync.
-- Each row is owned by a single auth user; RLS restricts access to the owner.

create table if not exists public.jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer jsonb,
  vehicle jsonb,
  axles jsonb,
  after_axles jsonb,
  full_distance text,
  notes text,
  config_id text,
  config_name text,
  measure_method text,
  updated_at timestamptz not null default now()
);
create index if not exists jobs_user_id_idx on public.jobs(user_id);

create table if not exists public.configs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  axles jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists configs_user_id_idx on public.configs(user_id);

create table if not exists public.company_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  address text,
  address2 text,
  phone text,
  email text,
  website text,
  logo text,
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
alter table public.configs enable row level security;
alter table public.company_settings enable row level security;

create policy "Users manage own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own configs" on public.configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own company_settings" on public.company_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
