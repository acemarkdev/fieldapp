-- ============================================================
--  Fin&Ops ▸ Performance ▸ Result: the two figures typed in by finance per month —
--  depreciation and financial cost (they do not come from invoices, sales or payroll).
--  Server-only access (service-role key): RLS is ON with no policies.
-- ============================================================
create table if not exists fin_result_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  period_year    int not null,
  period_month   int not null check (period_month between 1 and 12),
  depreciation   numeric(14,2),
  financial_cost numeric(14,2),
  updated_by     text,
  updated_at     timestamptz not null default now(),
  unique (tenant_id, period_year, period_month)
);
alter table fin_result_items enable row level security;
