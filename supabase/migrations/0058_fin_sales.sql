-- ============================================================
--  Fin&Ops ▸ Sales (the Excel sheet "Sprzedaż"): sales invoices, entered by hand until Subiekt nexo
--  is connected. One row per invoice; the app shows them grouped per job (a job has several
--  invoices: prepayments and the final one). The sum per job feeds Job costs.
--  Server-only access (service-role key): RLS is ON with no policies.
-- ============================================================
create table if not exists fin_sales (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  invoice_no    text,                              -- empty = planned / not invoiced yet
  invoice_date  date,
  job_ref       text,                              -- as typed: "Z.164", "AKCESORIA"; empty = not tied to a job
  job_key       text,                              -- upper-case, no spaces (matches fin_jobs.reference_key)
  period_year   int,
  period_month  int,
  producer      text,                              -- "Acemark PL" = made in Orpiszew; anything else = trade
  buyer         text,
  net           numeric(14,2) not null default 0,
  gross         numeric(14,2),
  country       text,
  kind          text not null default 'final' check (kind in ('prepaid','final')),
  note          text,
  seller        text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fin_sales_job_idx on fin_sales(tenant_id, job_key);
create index if not exists fin_sales_period_idx on fin_sales(tenant_id, period_year, period_month);
alter table fin_sales enable row level security;
