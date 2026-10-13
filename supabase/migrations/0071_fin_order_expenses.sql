-- ============================================================
--  Fin&Ops ▸ Sales orders: cost reports. A fitter reports an extra installation cost against an
--  order (allowance, fitting bonus, accommodation, travel…); the order's sales rep approves it,
--  the accountant marks it paid, and only then it is added to the order's installation cost.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_order_expenses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_id      uuid not null references fin_orders(id) on delete cascade,
  user_id       uuid references app_users(id) on delete set null,   -- who reported it
  user_name     text,
  kind          text not null check (kind in ('allowance','fitting_bonus','accommodation','travel','other')),
  amount        numeric(14,2) not null check (amount > 0),          -- PLN
  note          text,
  status        text not null default 'submitted' check (status in ('submitted','approved','rejected','paid')),
  created_at    timestamptz not null default now(),                 -- the report date
  decided_by    text,                                               -- who approved / rejected
  decided_at    timestamptz,
  reject_reason text,
  paid_by       text,
  paid_at       timestamptz
);
create index if not exists fin_order_expenses_order_idx on fin_order_expenses(order_id);
create index if not exists fin_order_expenses_user_idx on fin_order_expenses(tenant_id, user_id);
create index if not exists fin_order_expenses_status_idx on fin_order_expenses(tenant_id, status);
alter table fin_order_expenses enable row level security;
drop policy if exists server_only on fin_order_expenses;
create policy server_only on fin_order_expenses for all to anon, authenticated using (false) with check (false);
