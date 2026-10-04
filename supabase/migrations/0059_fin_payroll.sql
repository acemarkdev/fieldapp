-- ============================================================
--  Fin&Ops ▸ Payroll: total salaries and total payroll tax per department per month, typed in by
--  the finance user. `actual` is ticked once the real figures are in (they arrive a month late);
--  months without it show an estimate (average of the last 3 actual months) in the app.
--  Server-only access (service-role key): RLS is ON with no policies.
-- ============================================================
create table if not exists fin_payroll (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  period_year  int not null,
  period_month int not null check (period_month between 1 and 12),
  department   text not null check (department in ('Office','Sales','Production')),
  salaries     numeric(14,2),
  taxes        numeric(14,2),
  actual       boolean not null default false,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, period_year, period_month, department)
);
alter table fin_payroll enable row level security;
