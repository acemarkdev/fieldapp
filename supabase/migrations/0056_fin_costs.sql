-- ============================================================
--  Fin&Ops ▸ Costs: purchase invoices synced from the monday board "FAKTURY WSZYSTKIE".
--
--  One row per monday item. `cost_id` (SUPPLIER#INVOICE NO#NET) is fixed the first time a complete
--  invoice is synced and is the TRUSTED copy: every later sync rebuilds the id from monday's
--  current values, and a difference marks the row `changed` (someone edited the supplier,
--  invoice number or net amount after registration). Server-only access (service-role key):
--  RLS is ON with no policies.
-- ============================================================
create table if not exists fin_costs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  monday_item_id    text not null,
  supplier          text,
  invoice_no        text,
  invoice_date      date,
  due_date          date,
  net               numeric(14,2),
  vat               numeric(14,2),
  gross             numeric(14,2),
  status            text,
  description       text,                 -- "Za co?"
  cost_kind         text,                 -- koszt stały / koszt zmienny
  cost_type         text,                 -- Rodzaj kosztu
  subcategory       text,                 -- Podrodzaj kosztu (e.g. "631 Materials")
  department        text,                 -- Dział: Office / Sales / Production
  order_ref         text,                 -- Zlecenie
  konto             text,
  group_title       text,                 -- monday group, e.g. "Wrzesień 2026"
  period_year       int,
  period_month      int,
  company           text not null default 'acemark',   -- acemark | ace_group | off_balance
  cost_id           text,                 -- trusted id, set once
  orig_supplier     text,                 -- the values cost_id was built from
  orig_invoice_no   text,
  orig_net          numeric(14,2),
  changed           boolean not null default false,
  changed_at        timestamptz,
  monday_cost_id    text,                 -- what the board's "Cost ID" column held at last sync
  monday_updated_at timestamptz,
  removed           boolean not null default false,   -- no longer on the board
  first_synced_at   timestamptz not null default now(),
  last_synced_at    timestamptz not null default now(),
  unique (tenant_id, monday_item_id)
);
create index if not exists fin_costs_period_idx on fin_costs(tenant_id, period_year, period_month);
create index if not exists fin_costs_cost_id_idx on fin_costs(tenant_id, cost_id);
alter table fin_costs enable row level security;

create table if not exists fin_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  started_by    text,
  scanned       int, added int, updated int, changed int, removed int, ids_written int,
  error         text
);
create index if not exists fin_sync_runs_idx on fin_sync_runs(tenant_id, started_at desc);
alter table fin_sync_runs enable row level security;

-- Confined roles read/write no table directly (their screens run server-side). Re-applied to
-- every RLS table that exists now, for both confined roles. Re-run after adding new tables.
do $$
declare t record; r text;
begin
  foreach r in array array['logistics', 'acemark_finance'] loop
    for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
      execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
      execute format(
        'create policy %I on %I as restrictive for all to authenticated
           using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
        left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
    end loop;
  end loop;
end $$;
