-- ============================================================
--  Fin&Ops: actual purchase cost per trade order. Trade purchase invoices on the monday board
--  (Podrodzaj kosztu "499.V Handel") carry the supplier's KSeF PDF; its lines name the order
--  ("Ref.: OK DE203066 …"). The PDF is read during the monday costs sync and its lines kept here.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
alter table fin_costs
  add column if not exists pdf_asset      text,           -- monday asset id of the PDF that was read
  add column if not exists pdf_type       text,           -- basic / settlement / advance / correction / unknown
  add column if not exists pdf_status     text,           -- ok / mismatch / not_ksef / no_pdf / error
  add column if not exists pdf_total      numeric(14,2),  -- sum of the lines read (compared with the board's net)
  add column if not exists pdf_checked_at timestamptz;

create table if not exists fin_cost_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  cost_id     uuid not null references fin_costs(id) on delete cascade,
  lp          int,
  name        text,
  ref         text,            -- the line text after "Ref.:"
  web         text,            -- the supplier's order number (WEB/26/…)
  net         numeric(14,2) not null default 0,   -- signed: the "before" state of a correction is negative
  advance     boolean not null default false,     -- a "Zaliczka" deduction line (not a cost)
  order_code  text             -- "OK DE203066" read from the line, or from another line with the same WEB number
);
create index if not exists fin_cost_lines_cost_idx on fin_cost_lines(cost_id);
create index if not exists fin_cost_lines_order_idx on fin_cost_lines(tenant_id, order_code);
alter table fin_cost_lines enable row level security;
drop policy if exists server_only on fin_cost_lines;
create policy server_only on fin_cost_lines for all to anon, authenticated using (false) with check (false);
