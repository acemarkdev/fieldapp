-- ============================================================
--  Production team leader (role added in 0088 — run that one first).
--  In the database the team leader is a production worker: its own user row (the phone app loads
--  the role from it), the tasks, its own time entries; every other table is blocked for the role,
--  and starting / stopping / correcting / deleting its own time goes through the same functions.
--  The office Production time pages run on the server (service key), which leaves out rates and
--  zł amounts for this role.
-- ============================================================
do $$
declare t record; r text := 'production_lead';
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
    if t.tablename in ('app_users', 'prod_tasks', 'time_entries') then continue; end if;
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
  end loop;
end $$;

drop policy if exists prod_tasks_read on prod_tasks;
create policy prod_tasks_read on prod_tasks for select to authenticated
  using (tenant_id = auth_tenant_id() and auth_role() in ('production', 'production_manager', 'production_lead', 'admin'));

create or replace function prod_start(p_task uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; t prod_tasks; new_id uuid;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'admin') then raise exception 'Not allowed.'; end if;
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
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'admin') then raise exception 'Not allowed.'; end if;
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
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  if (e.started_at at time zone 'Europe/Warsaw')::date <> today then raise exception 'Only today''s entries can be changed here — ask the production manager.'; end if;
  insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source)
    values (e.tenant_id, e.id, e.user_name, e.task_name, 'delete', e.started_at, e.ended_at, null, null, me.id, me.name, me.role::text, 'phone');
  delete from time_entries where id = e.id;
end $$;
