-- ACE Scaffolding: actual costs on a job, line by line (crew, subcontractor, transport, materials / hire-in, licences…),
-- each against the erection ('up'), the dismantle ('down') or 'other'. A job's actual cost = these lines + the actual
-- cost up / down imported from monday (scaf_jobs.actual_cost_up / _down). Server-only access.
create table if not exists scaf_job_costs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  job_id      uuid not null references scaf_jobs(id) on delete cascade,
  day         date not null,
  phase       text not null default 'up' check (phase in ('up', 'down', 'other')),
  category    text not null default 'other' check (category in ('crew', 'subcontractor', 'transport', 'materials', 'licence', 'other')),
  supplier    text,
  description text,
  amount      numeric(12,2) not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists scaf_job_costs_job on scaf_job_costs(job_id);

alter table scaf_job_costs enable row level security;
drop policy if exists server_only on scaf_job_costs;
create policy server_only on scaf_job_costs for all to anon, authenticated using (false) with check (false);
drop policy if exists scaf_job_costs_block_scaffolding on scaf_job_costs;
create policy scaf_job_costs_block_scaffolding on scaf_job_costs as restrictive for all to authenticated using (auth_role() is distinct from 'scaffolding') with check (auth_role() is distinct from 'scaffolding');
drop policy if exists scaf_job_costs_block_scaffolder on scaf_job_costs;
create policy scaf_job_costs_block_scaffolder on scaf_job_costs as restrictive for all to authenticated using (auth_role() is distinct from 'scaffolder') with check (auth_role() is distinct from 'scaffolder');
