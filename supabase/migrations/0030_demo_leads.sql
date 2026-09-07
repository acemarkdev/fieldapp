-- ============================================================
--  Demo leads: prospects who try the mobile demo and/or request a quote.
--  Not tenant-scoped (they are not customers yet). Written by the mobile app with the
--  anon key (prospects aren't signed in); readable only via the service-role (office server).
-- ============================================================

create table if not exists demo_leads (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  kind         text not null default 'demo_started',   -- 'demo_started' | 'quote'
  name         text,
  company      text,
  phone        text,
  message      text,
  app_version  text,
  created_at   timestamptz not null default now()
);
create index if not exists demo_leads_created on demo_leads(created_at desc);

alter table demo_leads enable row level security;

-- Prospects are unauthenticated: allow anon (and authenticated) to INSERT a lead, and nothing else.
drop policy if exists demo_leads_ins on demo_leads;
create policy demo_leads_ins on demo_leads for insert to anon, authenticated with check (true);
-- No SELECT/UPDATE/DELETE policies on purpose — leads are only readable via the service-role.
