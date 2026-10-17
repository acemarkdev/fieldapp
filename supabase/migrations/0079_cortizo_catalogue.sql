-- ============================================================
--  Cortizo catalogue + Subiekt stock.
--    cortizo_items   one row per Cortizo reference (profile or accessory), read from the
--                    "Relación de perfiles / accesorios" tables of the Cortizo Center catalogues
--                    by tools/cortizo-catalogue (extract.py → build.py → upload.mts). Re-importing
--                    replaces the whole set.
--    subiekt_stock   the stock of every Subiekt nexo product, per warehouse, as the Subiekt agent
--                    last sent it (a full snapshot each time).
--  The office app matches the two on the custom field (its first word is the Cortizo reference),
--  else on the Subiekt symbol (see apps/api/src/cortizo.ts).
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
--  Sketches: private bucket 'cortizo', path = <tenant_id>/<file>.png, served as signed URLs.
-- ============================================================
create table if not exists cortizo_items (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  ref            text not null,                      -- "COR-3808", "801515", "331817"
  kind           text not null check (kind in ('profile', 'accessory')),
  desc_en        text,
  desc_es        text,
  weight_g_m     numeric(10,2),                      -- profiles: g/m
  surface_dm2_m  numeric(10,2),                      -- profiles: painted surface, dm²/m
  colour_en      text, colour_es text,               -- accessories
  type_en        text, type_es   text,               -- accessories: "Gaskets", "Clip", …
  sketch         text,                               -- file in the 'cortizo' bucket (profiles)
  systems        text[] not null default '{}',       -- the catalogues it appears in
  sources        jsonb not null default '[]',        -- [{system, file, version, pdf_page, cat_page}]
  imported_at    timestamptz not null default now(),
  primary key (tenant_id, ref)
);
create index if not exists cortizo_items_kind_idx on cortizo_items(tenant_id, kind);
alter table cortizo_items enable row level security;
drop policy if exists server_only on cortizo_items;
create policy server_only on cortizo_items for all to anon, authenticated using (false) with check (false);

create table if not exists subiekt_stock (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  product_id   bigint not null,                      -- the product's Id in Subiekt
  warehouse    text not null default '',
  symbol       text not null,
  name         text,
  unit         text,
  qty          numeric(14,3) not null default 0,
  reserved     numeric(14,3),
  cortizo      boolean not null default false,       -- the supplier in Subiekt is Cortizo
  cref         text,                                -- the custom field with the Cortizo reference ("2015 White Powder Coating 9010")
  synced_at    timestamptz not null default now(),
  primary key (tenant_id, product_id, warehouse)
);
create index if not exists subiekt_stock_symbol_idx on subiekt_stock(tenant_id, upper(symbol));
alter table subiekt_stock enable row level security;
drop policy if exists server_only on subiekt_stock;
create policy server_only on subiekt_stock for all to anon, authenticated using (false) with check (false);

insert into storage.buckets (id, name, public) values ('cortizo', 'cortizo', false)
on conflict (id) do nothing;
