-- ============================================================
--  Fin&Ops ▸ Job costs (the Excel sheet "Koszty"): profit & loss per job order.
--  One row per job (reference is unique: Z.373, "Z.102 panele", Z.214B … are separate jobs).
--  Costs are entered as lines (fin_job_items) of a type — Material Cost (RW), panels, glass,
--  other extras, painting, transport, customs, labour (hours × rate) — several per job, e.g.
--  several invoices. A locked job cannot be changed until an admin unlocks it.
--  Server-only access (service-role key): RLS is ON with no policies.
-- ============================================================
create table if not exists fin_jobs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  reference     text not null,                    -- as typed, e.g. "Z.102 panele"
  reference_key text not null,                    -- upper-case, no spaces — the uniqueness key
  customer      text,
  period_year   int,
  period_month  int,
  sales         numeric(14,2),                    -- typed for now; from sales invoices in phase 5.1
  note          text,
  locked        boolean not null default false,
  locked_by     text,
  locked_at     timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, reference_key)
);
create index if not exists fin_jobs_period_idx on fin_jobs(tenant_id, period_year, period_month);
alter table fin_jobs enable row level security;

create table if not exists fin_job_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  job_id      uuid not null references fin_jobs(id) on delete cascade,
  kind        text not null check (kind in ('material','panels','glass','extras','painting','transport','customs','labour')),
  amount      numeric(14,2) not null default 0,   -- for labour with hours: hours × rate
  hours       numeric(10,2),
  rate        numeric(10,2),
  invoice_no  text,
  supplier    text,
  item_date   date,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fin_job_items_job_idx on fin_job_items(job_id);
alter table fin_job_items enable row level security;
