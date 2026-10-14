-- ============================================================
--  Production time. The production manager loads a task list per job (the "wejście" file:
--  Z_394_ciecie, Z_394_szklenie …); production workers start and stop a task in the phone app;
--  logged hours × the worker's rate are added to labour in Job costs.
--    prod_tasks      the tasks (written only by the office server)
--    time_entries    one row per start→stop; written only through prod_start / prod_stop (phone)
--                    or by the office server (manager corrections)
--    worker_rates    hourly rate per worker — server-only, never readable from a phone
-- ============================================================
create table if not exists prod_tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  export_name  text not null,          -- "Z_394_ciecie" (Eksport_Clockify)
  job_ref      text not null,          -- "Z.394"
  job_key      text not null,          -- matches fin_jobs.reference_key
  op_id        text,                   -- "A0002"
  operation    text not null,          -- "ciecie"
  alias        text,
  active       boolean not null default true,
  created_by   text,
  created_at   timestamptz not null default now(),
  unique (tenant_id, export_name)
);
create index if not exists prod_tasks_job_idx on prod_tasks(tenant_id, job_key);
alter table prod_tasks enable row level security;
drop policy if exists prod_tasks_read on prod_tasks;
create policy prod_tasks_read on prod_tasks for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_role() in ('production', 'production_manager', 'admin'));

create table if not exists time_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid references app_users(id) on delete set null,
  user_name   text,
  user_email  text,
  task_id     uuid references prod_tasks(id) on delete set null,
  task_name   text,                    -- export_name at the time of logging (survives a task's removal)
  job_key     text,
  started_at  timestamptz not null,
  ended_at    timestamptz,             -- null = still running
  note        text,
  source      text not null default 'app',   -- app / manual (added or corrected by the manager)
  edited_by   text,
  created_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists time_entries_user_idx on time_entries(tenant_id, user_id, started_at desc);
create index if not exists time_entries_job_idx on time_entries(tenant_id, job_key);
create unique index if not exists time_entries_one_running on time_entries(user_id) where ended_at is null;
alter table time_entries enable row level security;
drop policy if exists time_entries_own on time_entries;
create policy time_entries_own on time_entries for select to authenticated
  using (tenant_id = auth_tenant_id() and user_id = (select id from app_users where auth_user_id = auth.uid() and active limit 1));

create table if not exists worker_rates (
  user_id    uuid primary key references app_users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  rate       numeric(10,2) not null check (rate >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table worker_rates enable row level security;
drop policy if exists server_only on worker_rates;
create policy server_only on worker_rates for all to anon, authenticated using (false) with check (false);

-- Start a task: stops whatever the worker had running, then starts the new one.
create or replace function prod_start(p_task uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; t prod_tasks; new_id uuid;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from prod_tasks where id = p_task and tenant_id = me.tenant_id and active;
  if t.id is null then raise exception 'Task not found.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  insert into time_entries (tenant_id, user_id, user_name, user_email, task_id, task_name, job_key, started_at, source)
    values (me.tenant_id, me.id, me.name, me.email, t.id, t.export_name, t.job_key, now(), 'app') returning id into new_id;
  return new_id;
end $$;
-- Stop the running task (if any). Returns how many entries were stopped (0 or 1).
create or replace function prod_stop() returns int
  language plpgsql security definer set search_path = public as $$
declare me app_users; n int;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null then raise exception 'Not allowed.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function prod_start(uuid) from public;
revoke all on function prod_stop() from public;
grant execute on function prod_start(uuid) to authenticated;
grant execute on function prod_stop() to authenticated;

-- Menu-only roles read/write no table directly. A production worker may still read its own user
-- row (the phone app loads the role from it), the tasks and its own time entries; everything else is
-- blocked. Re-applied for every confined role on every RLS table that exists now; safe to re-run.
do $$
declare t record; r text;
begin
  foreach r in array array['logistics', 'acemark_finance', 'sales_rep', 'acemark_fitter', 'production_manager', 'production'] loop
    for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
      execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
      if r = 'production' and t.tablename in ('app_users', 'prod_tasks', 'time_entries') then continue; end if;
      execute format(
        'create policy %I on %I as restrictive for all to authenticated
           using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
        left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
    end loop;
  end loop;
end $$;
