-- Patches an existing company_settings table (created before the full sync
-- schema existed) so it has every column the app writes, plus the
-- jobs/configs tables and RLS policies if they're still missing.

alter table public.company_settings add column if not exists name text;
alter table public.company_settings add column if not exists address text;
alter table public.company_settings add column if not exists address2 text;
alter table public.company_settings add column if not exists phone text;
alter table public.company_settings add column if not exists email text;
alter table public.company_settings add column if not exists website text;
alter table public.company_settings add column if not exists logo text;
alter table public.company_settings add column if not exists updated_at timestamptz not null default now();

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

alter table public.jobs enable row level security;
alter table public.configs enable row level security;
alter table public.company_settings enable row level security;

drop policy if exists "Users manage own jobs" on public.jobs;
create policy "Users manage own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own configs" on public.configs;
create policy "Users manage own configs" on public.configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own company_settings" on public.company_settings;
create policy "Users manage own company_settings" on public.company_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
