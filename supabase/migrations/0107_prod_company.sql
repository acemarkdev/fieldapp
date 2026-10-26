-- ============================================================
--  Production time for a second company: WEM, besides Acemark. Each production worker, lead and manager (and
--  warehouse worker) belongs to one company (app_users.prod_company; empty = Acemark). Tasks are loaded per
--  company; a worker sees and starts only the tasks of their company; an entry keeps the company of its task.
--  In the office a production manager sees only their company; admin sees both. WEM hours never count as
--  labour in Acemark's Job costs (the office server reads only Acemark entries there).
-- ============================================================
alter table app_users add column if not exists prod_company text;
alter table app_users drop constraint if exists app_users_prod_company_check;
alter table app_users add constraint app_users_prod_company_check check (prod_company is null or prod_company in ('acemark', 'wem'));

alter table prod_tasks add column if not exists company text not null default 'acemark';
alter table prod_tasks drop constraint if exists prod_tasks_company_check;
alter table prod_tasks add constraint prod_tasks_company_check check (company in ('acemark', 'wem'));
-- task names are not unique (0078: the same set may be loaded again for an order) — only an index per company
create index if not exists prod_tasks_company_name on prod_tasks(tenant_id, company, export_name);

alter table time_entries add column if not exists company text not null default 'acemark';
alter table time_entries drop constraint if exists time_entries_company_check;
alter table time_entries add constraint time_entries_company_check check (company in ('acemark', 'wem'));
create index if not exists time_entries_company_idx on time_entries(tenant_id, company, started_at desc);

alter table time_edit_log add column if not exists company text not null default 'acemark';

-- the signed-in user's company for production time; null for admin (sees both)
create or replace function auth_prod_company() returns text
  language sql stable security definer set search_path = public as $$
  select case when role = 'admin' then null else coalesce(prod_company, 'acemark') end from app_users where auth_user_id = auth.uid() and active limit 1;
$$;
revoke all on function auth_prod_company() from public;
grant execute on function auth_prod_company() to authenticated;

drop policy if exists prod_tasks_read on prod_tasks;
create policy prod_tasks_read on prod_tasks for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_role() in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin')
         and (auth_prod_company() is null or company = auth_prod_company()));

-- start a task: only one of the worker's own company; the entry takes the task's company
create or replace function prod_start(p_task uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; t prod_tasks; new_id uuid;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from prod_tasks where id = p_task and tenant_id = me.tenant_id and active
    and (me.role = 'admin' or company = coalesce(me.prod_company, 'acemark'));
  if t.id is null then raise exception 'Task not found.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  insert into time_entries (tenant_id, user_id, user_name, user_email, task_id, task_name, job_key, started_at, source, company)
    values (me.tenant_id, me.id, me.name, me.email, t.id, t.export_name, t.job_key, now(), 'app', t.company) returning id into new_id;
  return new_id;
end $$;

-- "Bez zadania": the entry takes the worker's company
create or replace function prod_start_free() returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; new_id uuid;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'admin', 'warehouse') then raise exception 'Not allowed.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  insert into time_entries (tenant_id, user_id, user_name, user_email, task_id, task_name, job_key, started_at, source, company)
    values (me.tenant_id, me.id, me.name, me.email, null, 'Bez zadania', null, now(), 'app', coalesce(me.prod_company, 'acemark')) returning id into new_id;
  return new_id;
end $$;
revoke all on function prod_start_free() from public;
grant execute on function prod_start_free() to authenticated;

-- correcting an entry: a new task must be of the entry's company
create or replace function prod_edit_entry(p_entry uuid, p_start timestamptz, p_end timestamptz, p_note text, p_task uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e time_entries; t prod_tasks;
  day date; today date := (now() at time zone 'Europe/Warsaw')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');   -- not named "note": that is a column
  moving boolean := false;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  day := (e.started_at at time zone 'Europe/Warsaw')::date;
  if day > today or day < today - 6 then raise exception 'Only entries of the last 7 days can be changed here — ask the production manager.'; end if;
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
  if p_task is not null and p_task is distinct from e.task_id then
    select * into t from prod_tasks where id = p_task and tenant_id = e.tenant_id and active and company = e.company;
    if t.id is null then raise exception 'Task not found.'; end if;
    if e.company = 'acemark' and exists (select 1 from fin_jobs where tenant_id = e.tenant_id and reference_key = e.job_key and locked) then
      raise exception 'This entry''s job is locked in Job costs — ask the production manager.'; end if;
    if e.company = 'acemark' and exists (select 1 from fin_jobs where tenant_id = e.tenant_id and reference_key = t.job_key and locked) then
      raise exception 'The chosen task''s job is locked in Job costs — ask the production manager.'; end if;
    moving := true;
  end if;
  if moving or p_start is distinct from e.started_at or p_end is distinct from e.ended_at then
    insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source, old_task, new_task, company)
      values (e.tenant_id, e.id, e.user_name, case when moving then t.export_name else e.task_name end, 'update', e.started_at, e.ended_at, p_start, p_end, me.id, me.name, me.role::text, 'phone',
              case when moving then e.task_name end, case when moving then t.export_name end, e.company);
  end if;
  if moving then
    update time_entries set started_at = p_start, ended_at = p_end, note = v_note, task_id = t.id, task_name = t.export_name, job_key = t.job_key where id = e.id;
  else
    update time_entries set started_at = p_start, ended_at = p_end, note = v_note where id = e.id;
  end if;
end $$;
revoke all on function prod_edit_entry(uuid, timestamptz, timestamptz, text, uuid) from public;
grant execute on function prod_edit_entry(uuid, timestamptz, timestamptz, text, uuid) to authenticated;
