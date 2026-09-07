-- ============================================================
--  Global key/value app config (not tenant-scoped). First use: the demo "Request a quote"
--  destination email, set by an admin in the office app and read by the mobile app.
-- ============================================================

create table if not exists app_config (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

alter table app_config enable row level security;
-- Public read (values here are non-sensitive config); writes happen via the service-role only.
drop policy if exists app_config_sel on app_config;
create policy app_config_sel on app_config for select to anon, authenticated using (true);

insert into app_config(key, value) values ('demo_leads_email', 'sales@acegroup-uk.com')
  on conflict (key) do nothing;
