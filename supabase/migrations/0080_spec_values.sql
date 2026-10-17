-- ============================================================
--  Specification parameters (Emplas order-form fields + Building Regulations checks).
--  One row = one field set at one level; items inherit from the levels above them and the most
--  specific level wins:  item > room type > flat > elevation > job > customer.
--
--   level      owner_id      scope_key
--   customer   customers.id  ''
--   job        jobs.id       ''
--   elevation  jobs.id       elevation code, block-qualified when the item has a block ("B1/E1")
--   flat       jobs.id       flat number, block-qualified the same way ("21", "B1/21")
--   room       jobs.id       room code ("KT") — a rule for every room of that type in the job
--   item       survey_items.id  ''
--
--  The catalogue of fields (and which levels each may be set at) lives in the app
--  (packages/shared/src/specCatalogue.ts), not in the database.
--  Server-only: read and written through the office server (service-role key), like time_edit_log.
-- ============================================================
create table if not exists spec_values (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  level       text not null check (level in ('customer', 'job', 'elevation', 'flat', 'room', 'item')),
  owner_id    uuid not null,
  job_id      uuid,                                    -- the job, for every level but customer (fast per-job reads)
  scope_key   text not null default '',
  param_key   text not null,
  value       text not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, level, owner_id, scope_key, param_key)
);
create index if not exists spec_values_owner_idx on spec_values(tenant_id, owner_id);
create index if not exists spec_values_job_idx on spec_values(tenant_id, job_id);

alter table spec_values enable row level security;
drop policy if exists server_only on spec_values;
create policy server_only on spec_values for all to anon, authenticated using (false) with check (false);

-- owner_id points at one of three tables, so there is no foreign key: clear the rows when the
-- customer, job or item goes.
create or replace function spec_values_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from spec_values where owner_id = old.id or job_id = old.id;
  return old;
end $$;
drop trigger if exists spec_values_cleanup on customers;
create trigger spec_values_cleanup after delete on customers for each row execute function spec_values_cleanup();
drop trigger if exists spec_values_cleanup on jobs;
create trigger spec_values_cleanup after delete on jobs for each row execute function spec_values_cleanup();
drop trigger if exists spec_values_cleanup on survey_items;
create trigger spec_values_cleanup after delete on survey_items for each row execute function spec_values_cleanup();
