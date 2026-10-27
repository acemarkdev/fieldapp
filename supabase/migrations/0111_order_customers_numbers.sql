-- ============================================================
--  Fin&Ops ▸ Sales orders, step A of replacing the monday Enquiries board:
--   • fin_customers — the customer list the order form picks from (+ New customer); the start of the lite CRM.
--   • the order's customer, its own delivery address (null = same as the customer's address),
--     the enquiry date, the requested and the confirmed realisation date.
--   • fin_order_numbers + fin_take_order_number() — the next OK number, taken atomically when an order is saved.
--  Without this migration the form still works: the new fields are not kept, the number comes from the highest
--  OK number already in Sales orders.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name1        text not null,
  name2        text,
  street       text,
  postal_code  text,
  city         text,
  country      text,                                   -- ISO code as used in the order number: DE, PL, UK…
  phone        text,
  email        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fin_customers_tenant_idx on fin_customers(tenant_id, name1);
alter table fin_customers enable row level security;
drop policy if exists server_only on fin_customers;
create policy server_only on fin_customers for all to anon, authenticated using (false) with check (false);

alter table fin_orders add column if not exists customer_id uuid references fin_customers(id) on delete set null;
alter table fin_orders add column if not exists delivery_address jsonb;          -- {name, street, postal_code, city, country, phone}
alter table fin_orders add column if not exists enquiry_date date;
alter table fin_orders add column if not exists requested_date date;             -- the customer's requested realisation
alter table fin_orders add column if not exists requested_month_only boolean not null default false;
alter table fin_orders add column if not exists confirmed_date date;             -- set once the quote is approved
create index if not exists fin_orders_customer_idx on fin_orders(tenant_id, customer_id);

create table if not exists fin_order_numbers (
  tenant_id    uuid primary key references tenants(id) on delete cascade,
  next_number  bigint not null,
  updated_at   timestamptz not null default now()
);
alter table fin_order_numbers enable row level security;
drop policy if exists server_only on fin_order_numbers;
create policy server_only on fin_order_numbers for all to anon, authenticated using (false) with check (false);

-- Take the next number: never below p_floor (one above the highest OK number already in Sales orders).
create or replace function fin_take_order_number(p_tenant uuid, p_floor bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  insert into fin_order_numbers(tenant_id, next_number) values (p_tenant, p_floor)
    on conflict (tenant_id) do nothing;
  update fin_order_numbers set next_number = greatest(next_number, p_floor) + 1, updated_at = now()
    where tenant_id = p_tenant
    returning next_number - 1 into n;
  return n;
end $$;
revoke all on function fin_take_order_number(uuid, bigint) from public, anon, authenticated;
