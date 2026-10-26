-- ============================================================
--  Production time on the phone: a worker may correct their own entries of the last 7 days (today
--  and the 6 days before, Warsaw time) — before only today's. Older entries stay with the production
--  manager. The rest is unchanged: the date of an entry never moves, the end not in the future,
--  every change is logged in time_edit_log. Deleting stays today-only (prod_delete_entry).
-- ============================================================
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
  if p_start is distinct from e.started_at or p_end is distinct from e.ended_at then
    insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source)
      values (e.tenant_id, e.id, e.user_name, e.task_name, 'update', e.started_at, e.ended_at, p_start, p_end, me.id, me.name, me.role::text, 'phone');
  end if;
  update time_entries set started_at = p_start, ended_at = p_end, note = v_note where id = e.id;
end $$;
revoke all on function prod_edit_entry(uuid, timestamptz, timestamptz, text) from public;
grant execute on function prod_edit_entry(uuid, timestamptz, timestamptz, text) to authenticated;
