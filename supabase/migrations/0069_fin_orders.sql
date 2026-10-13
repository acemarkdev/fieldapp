-- ============================================================
--  Fin&Ops ▸ Sales orders: the sales rep's register (the workbook "wszystkie zlecenia") — every offer,
--  whether it was accepted, its value and costs — and cash payments registered by the accountant.
--  Invoices stay on the Sales tab (fin_sales) and attach to an order by its job reference.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_orders (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  rep_user_id        uuid references app_users(id) on delete set null,   -- the sales rep who owns it
  rep_name           text,
  company            text,                              -- Acemark / WEM
  supplier           text,                              -- ACEMARK, EKO_OKNA, WEM, Matplast…
  material           text,                              -- Alu / PVC / Wood
  customer           text,
  order_ref          text not null,                     -- as typed: "OK DE203065 -Mülheim an der Ruhr- …"
  order_key          text not null,                     -- upper-case, no spaces
  job_ref            text,                              -- "Z.330" once it is produced in Orpiszew
  status             text not null default 'offer' check (status in ('offer','accepted','lost')),
  offer_year         int,
  offer_month        int check (offer_month between 1 and 12),
  enquiry_month      int check (enquiry_month between 1 and 12),
  net                numeric(14,2) not null default 0,
  cost_purchase      numeric(14,2),
  cost_install       numeric(14,2),
  cost_delivery      numeric(14,2),
  planned_year       int,
  planned_month      int check (planned_month between 1 and 12),
  first_payment_date date,                              -- set by hand (or the import): the day it starts to count
  invoice_refs       text,                              -- invoice numbers noted on the order, for matching
  note               text,
  comment            text,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists fin_orders_tenant_idx on fin_orders(tenant_id, offer_year, offer_month);
create index if not exists fin_orders_rep_idx on fin_orders(tenant_id, rep_user_id);
alter table fin_orders enable row level security;
drop policy if exists server_only on fin_orders;
create policy server_only on fin_orders for all to anon, authenticated using (false) with check (false);

create table if not exists fin_order_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  order_id    uuid not null references fin_orders(id) on delete cascade,
  paid_date   date not null,
  amount      numeric(14,2) not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists fin_order_payments_order_idx on fin_order_payments(order_id);
alter table fin_order_payments enable row level security;
drop policy if exists server_only on fin_order_payments;
create policy server_only on fin_order_payments for all to anon, authenticated using (false) with check (false);
