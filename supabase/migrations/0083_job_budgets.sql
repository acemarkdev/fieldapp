-- ============================================================
--  Fin&Ops ▸ Job costs: a budget per job, made once the Z number exists. It holds the price offered
--  to the customer, the expected cost of producing it in Orpiszew (the same cost lines as the actual
--  costs; labour = hours × a fixed rate) and of buying it in and trading it instead, and the
--  decision: produce, trade or reject (a rejected Z is dropped). After the decision the budget is
--  frozen; an admin can reopen it. Server-only (service-role key).
-- ============================================================
create table if not exists fin_job_budgets (
  job_id          uuid primary key references fin_jobs(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  offer_net       numeric(14,2),                 -- sales price offered to the customer (net)
  produce         jsonb not null default '{}',   -- { material, panels, glass, extras, painting, transport, customs } in zł
  labour_hours    numeric(10,2),
  labour_rate     numeric(10,2),                 -- zł per hour, e.g. 50
  trade_supplier  text,
  trade_purchase  numeric(14,2),
  trade_transport numeric(14,2),
  trade_other     numeric(14,2),
  note            text,
  decision        text not null default 'undecided' check (decision in ('undecided', 'produce', 'trade', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  updated_by      text,
  updated_at      timestamptz not null default now()
);
create index if not exists fin_job_budgets_tenant_idx on fin_job_budgets(tenant_id);
alter table fin_job_budgets enable row level security;
drop policy if exists server_only on fin_job_budgets;
create policy server_only on fin_job_budgets for all to anon, authenticated using (false) with check (false);
