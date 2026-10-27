-- ============================================================
--  Fin&Ops ▸ Sales orders, step B of replacing the monday Enquiries board:
--   • fin_order_docs — the customer's documents on an order, in versions: v1 = the first note + file, every later
--     file is the next version and needs a comment; the newest is current, older ones are outdated.
--   • fin_order_quotes — the quotes sent to the customer, one row per version: amount, scope (delivery only /
--     delivery + install), the file sent, the budget behind it, and its status (sent / approved / rejected / rework).
--     The approved version (else the newest) sets the order's net value, budget costs and status.
--  Files are kept in the private storage bucket "orderfiles" (created by the server on first upload).
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_order_docs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_id      uuid not null references fin_orders(id) on delete cascade,
  version       int not null,
  comment       text not null,
  file_name     text not null,
  storage_path  text not null,
  content_type  text,
  size_bytes    bigint,
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (order_id, version)
);
create index if not exists fin_order_docs_order_idx on fin_order_docs(tenant_id, order_id);
alter table fin_order_docs enable row level security;
drop policy if exists server_only on fin_order_docs;
create policy server_only on fin_order_docs for all to anon, authenticated using (false) with check (false);

create table if not exists fin_order_quotes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  order_id       uuid not null references fin_orders(id) on delete cascade,
  version        int not null,
  amount         numeric(14,2) not null,
  scope          text not null default 'install' check (scope in ('delivery','install')),
  cost_purchase  numeric(14,2),
  cost_install   numeric(14,2),
  cost_delivery  numeric(14,2),
  status         text not null default 'sent' check (status in ('sent','approved','rejected','rework')),
  comment        text,
  file_name      text,
  storage_path   text,
  content_type   text,
  size_bytes     bigint,
  status_at      timestamptz not null default now(),
  status_by      text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (order_id, version)
);
create index if not exists fin_order_quotes_order_idx on fin_order_quotes(tenant_id, order_id);
-- at most one approved version per order
create unique index if not exists fin_order_quotes_one_approved on fin_order_quotes(order_id) where status = 'approved';
alter table fin_order_quotes enable row level security;
drop policy if exists server_only on fin_order_quotes;
create policy server_only on fin_order_quotes for all to anon, authenticated using (false) with check (false);
