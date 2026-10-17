-- ============================================================
--  Fin&Ops ▸ Stock value: stock value (FIFO purchase cost) and ageing from Subiekt nexo.
--    subiekt_lots           the open delivery lots as the Subiekt agent last sent them (a full
--                           snapshot each run): what is left of each delivery, its unit purchase
--                           cost and the date of the ORIGINAL delivery (a transfer between
--                           warehouses keeps the original date).
--    subiekt_stock_history  one row per day × warehouse × product group × supplier with the value
--                           in each age bucket — the month-end history (written on every sync,
--                           the day's rows are replaced), plus one total row per day with
--                           warehouse '*'.
--  How the value is read from Subiekt (checked against "Remanent na dzień" product by product,
--  October 2026): Przychody (lot) → Partie → Przyjecia → the receipt's LATEST KosztyZakupu entry
--  (the original or its newest correction, which holds the new full value) ÷ its quantity;
--  remaining = lot − all Rozchody from it. See apps/api/src/stockValue.ts.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists subiekt_lots (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  lot_id       bigint not null,                      -- Przychody.Id
  product_id   bigint not null,
  symbol       text not null,
  name         text,
  grp          text,                                 -- product group (GrupyAsortymentu)
  supplier     text,                                 -- main supplier (role 2)
  unit         text,
  warehouse    text not null default '',
  qty          numeric(14,3) not null,               -- remaining in the lot
  unit_cost    numeric(14,4),                        -- PLN net per unit (null = no cost found)
  received     date,                                 -- date of the original delivery
  last_issue   date,                                 -- last issue of this product from this warehouse
  synced_at    timestamptz not null default now(),
  primary key (tenant_id, lot_id)
);
create index if not exists subiekt_lots_product_idx on subiekt_lots(tenant_id, product_id);
alter table subiekt_lots enable row level security;
drop policy if exists server_only on subiekt_lots;
create policy server_only on subiekt_lots for all to anon, authenticated using (false) with check (false);

create table if not exists subiekt_stock_history (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  day          date not null,
  warehouse    text not null default '',
  grp          text not null default '',
  supplier     text not null default '',
  products     int not null default 0,
  value        numeric(14,2) not null default 0,
  b0 numeric(14,2) not null default 0,               -- 0–90 days
  b1 numeric(14,2) not null default 0,               -- 91–180
  b2 numeric(14,2) not null default 0,               -- 181–365
  b3 numeric(14,2) not null default 0,               -- 1–2 years
  b4 numeric(14,2) not null default 0,               -- over 2 years
  primary key (tenant_id, day, warehouse, grp, supplier)
);
alter table subiekt_stock_history enable row level security;
drop policy if exists server_only on subiekt_stock_history;
create policy server_only on subiekt_stock_history for all to anon, authenticated using (false) with check (false);
