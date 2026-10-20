-- ============================================================
--  Warehouse ▸ Wydania (role added in 0090 — run that one first).
--  wh_issues: what was issued from the warehouse for a Z order — logged on the phone by the
--  Warehouse role (scan or type the Subiekt symbol and the location), reviewed and exported to Excel
--  in the office app (for the RW in Subiekt). Once exported a row is stamped and leaves the phone.
--  The phone writes only through wh_save_issue / wh_delete_issue (own rows, not exported), reads its
--  own open rows, and looks items and Z orders up through wh_items / wh_jobs. The office runs on the
--  server (service key).
--  The Warehouse role is also a production worker on the phone (time log): the same exceptions as
--  production for app_users, prod_tasks and time_entries; every other table is blocked for it.
-- ============================================================
create table if not exists wh_issues (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid references app_users(id) on delete set null,
  user_name   text,
  job_ref     text not null,                     -- the Z order as entered, e.g. "Z.437"
  job_key     text not null,                     -- upper-case, no spaces
  symbol      text not null,                     -- Subiekt item symbol (scanned or typed)
  name        text,                              -- from the Subiekt stock list when the symbol is known
  unit        text,
  qty         numeric(14,3) not null check (qty > 0),
  location    text,
  box         text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  exported_at timestamptz,                       -- set when exported to Excel in the office app
  export_no   int,
  exported_by text
);
create index if not exists wh_issues_open_idx on wh_issues(tenant_id, user_id) where exported_at is null;
create index if not exists wh_issues_job_idx on wh_issues(tenant_id, job_key);
alter table wh_issues enable row level security;
drop policy if exists wh_issues_own on wh_issues;
create policy wh_issues_own on wh_issues for select to authenticated
  using (tenant_id = auth_tenant_id() and exported_at is null
         and user_id = (select id from app_users where auth_user_id = auth.uid() and active limit 1));

-- Block every other table for the role (same loop as the other confined roles).
do $$
declare t record; r text := 'warehouse';
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
    if t.tablename in ('app_users', 'prod_tasks', 'time_entries', 'wh_issues') then continue; end if;
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
  end loop;
end $$;
-- the other confined roles must not see wh_issues either (the table is new since their loops ran)
do $$
declare r text;
begin
  foreach r in array array['logistics', 'acemark_finance', 'sales_rep', 'acemark_fitter', 'production_manager', 'production', 'production_lead'] loop
    execute format('drop policy if exists %I on wh_issues', 'wh_issues_block_' || r);
    execute format('create policy %I on wh_issues as restrictive for all to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', 'wh_issues_block_' || r, r, r);
  end loop;
end $$;

drop policy if exists prod_tasks_read on prod_tasks;
create policy prod_tasks_read on prod_tasks for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_role() in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin'));

-- Save an issue (new when p_id is null): own row, not yet exported. Name and unit come from the
-- Subiekt stock list when the symbol is in it.
create or replace function wh_save_issue(p_id uuid, p_job text, p_symbol text, p_qty numeric, p_location text, p_box text, p_note text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e wh_issues; v_id uuid;
  -- "z437", "Z 437", "Z_0437" → "Z.437" (as the office app does)
  v_job text := nullif(regexp_replace(btrim(coalesce(p_job, '')), '^[Zz][[:space:]._-]*0*([0-9]+)', 'Z.\1'), '');
  v_sym text := upper(nullif(btrim(coalesce(p_symbol, '')), ''));
  v_name text; v_unit text;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  if v_job is null then raise exception 'Enter the Z order.'; end if;
  if v_sym is null then raise exception 'Enter or scan the item symbol.'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'Enter the quantity.'; end if;
  if char_length(v_job) > 60 or char_length(v_sym) > 80 or char_length(coalesce(p_location, '')) > 60 or char_length(coalesce(p_box, '')) > 60 or char_length(coalesce(p_note, '')) > 300 then raise exception 'A field is too long.'; end if;
  select max(l.name), max(l.unit) into v_name, v_unit from subiekt_lots l where l.tenant_id = me.tenant_id and upper(l.symbol) = v_sym;
  if p_id is null then
    insert into wh_issues (tenant_id, user_id, user_name, job_ref, job_key, symbol, name, unit, qty, location, box, note)
      values (me.tenant_id, me.id, me.name, v_job, upper(regexp_replace(v_job, '\s', '', 'g')), v_sym, v_name, v_unit, round(p_qty, 3),
              nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_box, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
      returning id into v_id;
    return v_id;
  end if;
  select * into e from wh_issues where id = p_id and user_id = me.id;
  if e.id is null then raise exception 'Issue not found.'; end if;
  if e.exported_at is not null then raise exception 'Already exported — ask the office to change it.'; end if;
  update wh_issues set job_ref = v_job, job_key = upper(regexp_replace(v_job, '\s', '', 'g')), symbol = v_sym, name = v_name, unit = v_unit, qty = round(p_qty, 3),
    location = nullif(btrim(coalesce(p_location, '')), ''), box = nullif(btrim(coalesce(p_box, '')), ''), note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
    where id = e.id;
  return e.id;
end $$;

create or replace function wh_delete_issue(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare me app_users; e wh_issues;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from wh_issues where id = p_id and user_id = me.id;
  if e.id is null then raise exception 'Issue not found.'; end if;
  if e.exported_at is not null then raise exception 'Already exported — ask the office to change it.'; end if;
  delete from wh_issues where id = e.id;
end $$;

-- Items from the Subiekt stock list for the phone: an exact symbol first (a scan), then symbols that
-- start with the text, then names that contain it. Stock = what Subiekt holds now (all warehouses).
create or replace function wh_items(p_query text) returns table (symbol text, name text, unit text, stock numeric)
  language plpgsql security definer set search_path = public as $$
declare me app_users; q text := btrim(coalesce(p_query, ''));
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select l.symbol, max(l.name), max(l.unit), sum(l.qty)
    from subiekt_lots l
    where l.tenant_id = me.tenant_id and (l.symbol ilike q || '%' or l.name ilike '%' || q || '%')
    group by l.symbol
    order by (upper(l.symbol) = upper(q)) desc, (l.symbol ilike q || '%') desc, l.symbol
    limit 25;
end $$;

-- Z orders the warehouse can pick: open jobs from Job costs (newest first) and the jobs of open production tasks.
create or replace function wh_jobs() returns table (job_ref text)
  language plpgsql security definer set search_path = public as $$
declare me app_users;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  return query
    select x.ref from (
      select j.reference as ref, j.created_at as at from fin_jobs j where j.tenant_id = me.tenant_id and not j.locked
      union all
      select t.job_ref, t.created_at from prod_tasks t where t.tenant_id = me.tenant_id and t.active
    ) x group by x.ref order by max(x.at) desc limit 300;
end $$;

revoke all on function wh_save_issue(uuid, text, text, numeric, text, text, text) from public;
revoke all on function wh_delete_issue(uuid) from public;
revoke all on function wh_items(text) from public;
revoke all on function wh_jobs() from public;
grant execute on function wh_save_issue(uuid, text, text, numeric, text, text, text) to authenticated;
grant execute on function wh_delete_issue(uuid) to authenticated;
grant execute on function wh_items(text) to authenticated;
grant execute on function wh_jobs() to authenticated;

-- The production time functions accept the Warehouse role (it logs its own time like production).
create or replace function prod_start(p_task uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; t prod_tasks; new_id uuid;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from prod_tasks where id = p_task and tenant_id = me.tenant_id and active;
  if t.id is null then raise exception 'Task not found.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  insert into time_entries (tenant_id, user_id, user_name, user_email, task_id, task_name, job_key, started_at, source)
    values (me.tenant_id, me.id, me.name, me.email, t.id, t.export_name, t.job_key, now(), 'app') returning id into new_id;
  return new_id;
end $$;

create or replace function prod_edit_entry(p_entry uuid, p_start timestamptz, p_end timestamptz, p_note text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e time_entries;
  day date; today date := (now() at time zone 'Europe/Warsaw')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');   -- not named "note": that is a column
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  day := (e.started_at at time zone 'Europe/Warsaw')::date;
  if day <> today then raise exception 'Only today''s entries can be changed here — ask the production manager.'; end if;
  if v_note is not null and char_length(v_note) > 100 then raise exception 'The comment can have at most 100 characters.'; end if;
  if p_start is null or (p_start at time zone 'Europe/Warsaw')::date <> day then raise exception 'The start must stay on the same day.'; end if;
  if p_start > now() then raise exception 'The start cannot be in the future.'; end if;
  if e.ended_at is null then
    if p_end is not null then raise exception 'Stop the task before changing its end.'; end if;
  else
    if p_end is null or (p_end at time zone 'Europe/Warsaw')::date <> day then raise exception 'The end must stay on the same day.'; end if;
    if p_end < p_start then raise exception 'The end is before the start.'; end if;
    if p_end > now() + interval '1 minute' then raise exception 'The end cannot be in the future.'; end if;
  end if;
  if p_start is distinct from e.started_at or p_end is distinct from e.ended_at then
    insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source)
      values (e.tenant_id, e.id, e.user_name, e.task_name, 'update', e.started_at, e.ended_at, p_start, p_end, me.id, me.name, me.role::text, 'phone');
  end if;
  update time_entries set started_at = p_start, ended_at = p_end, note = v_note where id = e.id;
end $$;

create or replace function prod_delete_entry(p_entry uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e time_entries;
  today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  if (e.started_at at time zone 'Europe/Warsaw')::date <> today then raise exception 'Only today''s entries can be changed here — ask the production manager.'; end if;
  insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source)
    values (e.tenant_id, e.id, e.user_name, e.task_name, 'delete', e.started_at, e.ended_at, null, null, me.id, me.name, me.role::text, 'phone');
  delete from time_entries where id = e.id;
end $$;
