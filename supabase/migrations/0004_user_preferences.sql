-- Add user preference columns to company_settings so they sync across devices/browsers.
alter table public.company_settings add column if not exists measure_mode text;
alter table public.company_settings add column if not exists show_adj_calc boolean;
