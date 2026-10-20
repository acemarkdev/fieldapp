-- ============================================================
--  Production time: a worker deletes an entry of their own in the phone app — the same rules as
--  correcting one (prod_edit_entry, 0078): own entry, today only (Polish time); older entries are
--  for the production manager in the office app. The deletion is written to time_edit_log
--  (source 'phone') with the times it had, so the change log shows it.
-- ============================================================
create or replace function prod_delete_entry(p_entry uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e time_entries;
  today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('production', 'production_manager', 'admin') then raise exception 'Not allowed.'; end if;
  select * into e from time_entries where id = p_entry and user_id = me.id;
  if e.id is null then raise exception 'Entry not found.'; end if;
  if (e.started_at at time zone 'Europe/Warsaw')::date <> today then raise exception 'Only today''s entries can be changed here — ask the production manager.'; end if;
  insert into time_edit_log (tenant_id, entry_id, worker_name, task_name, action, old_start, old_end, new_start, new_end, actor_id, actor_name, actor_role, source)
    values (e.tenant_id, e.id, e.user_name, e.task_name, 'delete', e.started_at, e.ended_at, null, null, me.id, me.name, me.role::text, 'phone');
  delete from time_entries where id = e.id;
end $$;
revoke all on function prod_delete_entry(uuid) from public;
grant execute on function prod_delete_entry(uuid) to authenticated;
