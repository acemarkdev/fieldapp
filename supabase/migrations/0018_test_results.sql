-- In-app QA: testers tick each scenario OK/NOK with a comment. The scenario LIST lives in
-- code (apps/api/src/testScenarios.json, versioned with the app); only the RESULTS live here.
-- Each submission is its own row (full history); the app shows the latest per scenario for
-- the current app version.
create table test_results (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  scenario_code text not null,                 -- e.g. "T-001"
  app_version   text not null,                 -- which build was tested
  status        text not null check (status in ('ok','nok')),
  comment       text,
  tested_by     text,                          -- tester's name (denormalised for easy reading)
  tested_by_id  uuid references app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on test_results (tenant_id, app_version, scenario_code, created_at desc);

alter table test_results enable row level security;
drop policy if exists test_results_rw on test_results;
create policy test_results_rw on test_results for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());
