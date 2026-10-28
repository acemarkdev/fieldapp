-- ============================================================
--  Production time ▸ WEM, step 2: the time type and the quantity done on each entry.
--   • time_entries.time_type — chosen at START on a WEM task: work (Praca), setup (Przezbrojenie), rework (Poprawka).
--   • time_entries.qty_done  — typed at STOP (0 for setup). Pieces count only from work entries.
--   • prod_start_typed(task, type)  — start a task with its time type (stops the running one, like prod_start).
--   • prod_stop_qty(qty)            — stop the running task with the quantity done.
--   • prod_edit_wem(entry, type, qty) — the worker corrects the type or quantity of an entry of the last 7 days.
--   • prod_wem_done()               — done so far per open WEM task (work entries of everyone), for "done / planned".
-- ============================================================
alter table time_entries add column if not exists time_type text;
alter table time_entries drop constraint if exists time_entries_time_type_check;
alter table time_entries add constraint time_entries_time_type_check check (time_type is null or time_type in ('work', 'setup', 'rework'));
alter table time_entries add column if not exists qty_done numeric(12,2);
alter table time_entries drop constraint if exists time_entries_qty_done_check;
alter table time_entries add constraint time_entries_qty_done_check check (qty_done is null or qty_done >= 0);

create or replace function prod_start_typed(p_task uuid, p_type text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare me app_users; t prod_tasks; new_id uuid;
begin
  if p_type is null or p_type not in ('work', 'setup', 'rework') then raise exception 'Pick the time type.'; end if;
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into t from prod_tasks where id = p_task and tenant_id = me.tenant_id and active
    and (me.role = 'admin' or company = coalesce(me.prod_company, 'acemark'));
  if t.id is null then raise exception 'Task not found.'; end if;
  update time_entries set ended_at = now() where user_id = me.id and ended_at is null;
  insert into time_entries (tenant_id, user_id, user_name, user_email, task_id, task_name, job_key, started_at, source, company, time_type)
    values (me.tenant_id, me.id, me.name, me.email, t.id, t.export_name, t.job_key, now(), 'app', t.company, p_type) returning id into new_id;
  return new_id;
end $$;
revoke all on function prod_start_typed(uuid, text) from public;
grant execute on function prod_start_typed(uuid, text) to authenticated;

create or replace function prod_stop_qty(p_qty numeric) returns int
  language plpgsql security definer set search_path = public as $$
declare me app_users; n int;
begin
  if p_qty is null or p_qty < 0 or p_qty > 100000 then raise exception 'Enter the quantity done.'; end if;
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null then raise exception 'Not allowed.'; end if;
  update time_entries set ended_at = now(), qty_done = p_qty where user_id = me.id and ended_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function prod_stop_qty(numeric) from public;
grant execute on function prod_stop_qty(numeric) to authenticated;

create or replace function prod_edit_wem(p_entry uuid, p_type text, p_qty numeric) returns void
  language plpgsql security definer set search_path = public as $$
declare me app_users; e time_entries; day date; today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  if p_type is not null and p_type not in ('work', 'setup', 'rework') then raise exception 'Pick the time type.'; end if;
  if p_qty is not null and (p_qty < 0 or p_qty > 100000) then raise exception 'Enter the quantity done.'; end if;
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  day := (e.started_at at time zone 'Europe/Warsaw')::date;
  if day > today or day < today - 6 then raise exception 'Only entries of the last 7 days can be changed here — ask the production manager.'; end if;
  if e.ended_at is null and p_qty is not null then raise exception 'Stop the task before changing its end.'; end if;
  update time_entries set time_type = coalesce(p_type, time_type), qty_done = case when e.ended_at is null then qty_done else coalesce(p_qty, qty_done) end where id = e.id;
end $$;
revoke all on function prod_edit_wem(uuid, text, numeric) from public;
grant execute on function prod_edit_wem(uuid, text, numeric) to authenticated;

create or replace function prod_wem_done() returns table (task_id uuid, done numeric)
  language sql stable security definer set search_path = public as $$
  select e.task_id, coalesce(sum(e.qty_done), 0)
  from time_entries e
  join app_users me on me.auth_user_id = auth.uid() and me.active
  join prod_tasks t on t.id = e.task_id and t.active and t.tenant_id = me.tenant_id
  where e.tenant_id = me.tenant_id and e.company = 'wem' and e.time_type = 'work' and e.qty_done is not null
    and me.role in ('production', 'production_manager', 'production_lead', 'warehouse', 'admin')
  group by e.task_id
$$;
revoke all on function prod_wem_done() from public;
grant execute on function prod_wem_done() to authenticated;
