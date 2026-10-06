-- ============================================================
--  Settings that only the server needs move out of app_config, which anyone can read without
--  signing in (the phone's demo reads the quote e-mail address from it).
--
--  After this, app_config holds only `demo_leads_email`. Everything else — board ids, sync times,
--  the labour rate, the automatic pull summary (job codes, team names), QA checklists — lives in
--  server_config, which the phone and browser keys cannot read or write at all.
--
--  Run this AFTER the office server v1.14.2 is deployed: that version reads server_config first and
--  falls back to app_config, so it works before and after. (An older server would only look in
--  app_config and see the moved settings as "not set".)
-- ============================================================
create table if not exists server_config (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);
alter table server_config enable row level security;
revoke all on server_config from anon, authenticated;
drop policy if exists server_only on server_config;
create policy server_only on server_config for all to anon, authenticated using (false) with check (false);

insert into server_config (key, value, updated_at)
  select key, value, updated_at from app_config where key <> 'demo_leads_email'
  on conflict (key) do nothing;

delete from app_config where key <> 'demo_leads_email';
