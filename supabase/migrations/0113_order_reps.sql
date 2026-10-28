-- ============================================================
--  Fin&Ops ▸ Sales orders, step C of replacing the monday Enquiries board — more than one sales rep:
--   • fin_orders.rep_bonus — the main rep's commission applies (default). Unticked, the order does not count in that
--     rep's monthly commission bands.
--   • fin_order_reps — other reps paid a lump sum on the order: a fixed amount, or a % of the order's net value
--     (the approved quote). Paid like commission: in the month the order starts to count (first payment).
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
alter table fin_orders add column if not exists rep_bonus boolean not null default true;

create table if not exists fin_order_reps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  order_id    uuid not null references fin_orders(id) on delete cascade,
  user_id     uuid references app_users(id) on delete set null,   -- a sales rep in the app, or null for someone else
  name        text not null,
  kind        text not null check (kind in ('amount','pct')),
  value       numeric(14,2) not null check (value >= 0),
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists fin_order_reps_order_idx on fin_order_reps(tenant_id, order_id);
create index if not exists fin_order_reps_user_idx on fin_order_reps(tenant_id, user_id);
alter table fin_order_reps enable row level security;
drop policy if exists server_only on fin_order_reps;
create policy server_only on fin_order_reps for all to anon, authenticated using (false) with check (false);
