-- ============================================================
--  Production time on the phone: a worker may move one of their own entries (last 7 days, the running one
--  too) to another task — as in Clockify, where the task is picked or changed after the time. The entry
--  takes the new task's name and job, so Job costs labour follows. Refused when the old or the new job is
--  locked in Job costs (its labour is frozen). The edit log keeps the old and the new task.
--  prod_edit_entry gets a 5th parameter p_task (null = keep the task); the 4-parameter version stays for
--  phones without the update and does the same with p_task = null.
-- ============================================================
alter table time_edit_log add column if not exists old_task text;
alter table time_edit_log add column if not exists new_task text;

create or replace function prod_edit_entry(p_entry uuid, p_start timestamptz, p_end timestamptz, p_note text, p_task uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e time_entries; t prod_tasks;
  day date; today date := (now() at time zone 'Europe/Warsaw')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');   -- not named "note": that is a column
  moving boolean := false;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'production_lead', 'admin') then raise exception 'Not allowed.'; end if;
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
    select * into t from prod_tasks where id = p_task and tenant_id = e.tenant_id and active;
    if t.id is null then raise exception 'Task not found.'; end if;
    if exists (select 1 from fin_jobs where tenant_id = e.tenant_id and reference_key = e.job_key and locked) then
      raise exception 'This entry''s job is locked in Job costs — ask the production manager.'; end if;
    if exists (select 1 from fin_jobs where tenant_id = e.tenant_id and reference_key = t.job_key and locked) then
      raise exception 'The chosen task''s job is locked in Job costs — ask the production manager.'; end if;
    moving := true;
  end if;
  if moving or p_start is distinct from e.started_at or p_end is distinct from e.ended_at then
    insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source, old_task, new_task)
      values (e.tenant_id, e.id, e.user_name, case when moving then t.export_name else e.task_name end, 'update', e.started_at, e.ended_at, p_start, p_end, me.id, me.name, me.role::text, 'phone',
              case when moving then e.task_name end, case when moving then t.export_name end);
  end if;
  if moving then
    update time_entries set started_at = p_start, ended_at = p_end, note = v_note, task_id = t.id, task_name = t.export_name, job_key = t.job_key where id = e.id;
  else
    update time_entries set started_at = p_start, ended_at = p_end, note = v_note where id = e.id;
  end if;
end $$;
revoke all on function prod_edit_entry(uuid, timestamptz, timestamptz, text, uuid) from public;
grant execute on function prod_edit_entry(uuid, timestamptz, timestamptz, text, uuid) to authenticated;

-- phones without the update call the 4-parameter version: the same rules, the task stays
create or replace function prod_edit_entry(p_entry uuid, p_start timestamptz, p_end timestamptz, p_note text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform prod_edit_entry(p_entry, p_start, p_end, p_note, null::uuid);
end $$;
revoke all on function prod_edit_entry(uuid, timestamptz, timestamptz, text) from public;
grant execute on function prod_edit_entry(uuid, timestamptz, timestamptz, text) to authenticated;
