-- ============================================================
--  Production time ▸ rates over time. Each worker's hourly rate (and the default labour rate,
--  user_id null) is valid from a date; a time entry is priced at the rate valid on the day it was
--  started, so changing a rate never re-prices hours already logged.
--    rate        null = from that day the worker has no own rate (the default rate is used)
--  worker_rates stays as each worker's rate valid today. The current rates are copied in as valid
--  since 2000-01-01, so nothing changes until a rate is changed.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists rate_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid references app_users(id) on delete cascade,   -- null = the default labour rate
  rate        numeric(10,2) check (rate >= 0),
  valid_from  date not null,
  set_by      text,
  set_at      timestamptz not null default now()
);
create unique index if not exists rate_history_day on rate_history (tenant_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from);
alter table rate_history enable row level security;
drop policy if exists server_only on rate_history;
create policy server_only on rate_history for all to anon, authenticated using (false) with check (false);

insert into rate_history (tenant_id, user_id, rate, valid_from, set_by, set_at)
select w.tenant_id, w.user_id, w.rate, date '2000-01-01', coalesce(w.updated_by, 'migration 0086'), w.updated_at
from worker_rates w
where not exists (select 1 from rate_history h where h.user_id = w.user_id);
