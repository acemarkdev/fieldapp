-- ============================================================
--  Sales orders ▸ purchase invoices: finance links a trade purchase invoice (monday invoices board,
--  499.V Handel) to the sales order(s) it belongs to, in the app — no need to write the order in
--  monday's "Zlecenie". One invoice may be split over several orders (net per order). A manual link
--  replaces the automatic match (Zlecenie / PDF lines) for that invoice.
-- ============================================================
create table if not exists fin_cost_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  cost_id     uuid not null references fin_costs(id) on delete cascade,
  order_id    uuid not null references fin_orders(id) on delete cascade,
  net         numeric not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (cost_id, order_id)
);
create index if not exists fin_cost_links_order_idx on fin_cost_links(tenant_id, order_id);
alter table fin_cost_links enable row level security;
