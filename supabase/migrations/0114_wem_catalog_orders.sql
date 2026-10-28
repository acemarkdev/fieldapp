-- ============================================================
--  Production time ▸ WEM, step 1: the task catalogue and orders that generate tasks.
--   • prod_catalog — the fixed task codes (PRODUKT-ELEMENT-CZYNNOŚĆ, e.g. SAS-SKR-ST05) with department, product,
--     element, activity, workstation, unit and how the planned quantity is counted. The code never changes;
--     names and workstations may. Filled from the WEM catalogue file on first use.
--   • prod_orders — a WEM order (WEM-2026-001) and its positions (product, quantity, sashes per unit, material,
--     horns / vents / restrictors per unit). Saving it creates the order's tasks.
--   • prod_tasks gets the code, position, workstation and planned quantity of a generated task.
--  Server-only for the new tables (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists prod_catalog (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  company     text not null default 'wem' check (company in ('acemark', 'wem')),
  code        text not null,
  department  text,            -- Stolarnia / Składalnia / Ogólne
  product     text,            -- Sash / Casement / Drzwi / Dodatek / —
  element     text,            -- Sashbox, Skrzydło sash, Rama casement, komplet …
  activity    text not null,   -- czopowanie, szklenie …
  station     text,            -- the workstation (working names until confirmed)
  unit        text,            -- szt. skrzydła …
  qty_rule    text not null default 'product' check (qty_rule in ('product', 'sash', 'horns', 'vents', 'restrictors', 'none')),
  timber_only boolean not null default false,   -- only for sawn timber (tarcica): skipped for pre-cut (kantówka)
  sort        int not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, company, code)
);
alter table prod_catalog enable row level security;
drop policy if exists server_only on prod_catalog;
create policy server_only on prod_catalog for all to anon, authenticated using (false) with check (false);

create table if not exists prod_orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  company     text not null default 'wem' check (company in ('acemark', 'wem')),
  order_ref   text not null,   -- WEM-2026-001
  client      text,
  positions   jsonb not null default '[]',
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, company, order_ref)
);
alter table prod_orders enable row level security;
drop policy if exists server_only on prod_orders;
create policy server_only on prod_orders for all to anon, authenticated using (false) with check (false);

alter table prod_tasks add column if not exists code text;
alter table prod_tasks add column if not exists position text;
alter table prod_tasks add column if not exists station text;
alter table prod_tasks add column if not exists planned_qty numeric(12,2);
alter table prod_tasks add column if not exists unit text;
alter table prod_tasks add column if not exists order_id uuid references prod_orders(id) on delete set null;
create index if not exists prod_tasks_order_idx on prod_tasks(tenant_id, order_id);
