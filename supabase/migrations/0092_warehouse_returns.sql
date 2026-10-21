-- ============================================================
--  Warehouse ▸ returns (Zwroty): what comes back from production to the warehouse, the mirror of an
--  issue. Same table and rules as the issues (0091) with a kind: 'issue' (Wydanie → RW in Subiekt)
--  or 'return' (Zwrot → PW in Subiekt). The phone saves either through wh_save_issue (new argument
--  p_kind, default 'issue', so the 0.76.0 app keeps working) and asks wh_balance how much of a symbol
--  was issued to / returned from a Z order, to warn about returning more than was issued.
-- ============================================================
alter table wh_issues add column if not exists kind text not null default 'issue';
alter table wh_issues drop constraint if exists wh_issues_kind_check;
alter table wh_issues add constraint wh_issues_kind_check check (kind in ('issue', 'return'));

drop function if exists wh_save_issue(uuid, text, text, numeric, text, text, text);
create or replace function wh_save_issue(p_id uuid, p_job text, p_symbol text, p_qty numeric, p_location text, p_box text, p_note text, p_kind text default 'issue') returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  me app_users; e wh_issues; v_id uuid;
  -- "z437", "Z 437", "Z_0437" → "Z.437" (as the office app does)
  v_job text := nullif(regexp_replace(btrim(coalesce(p_job, '')), '^[Zz][[:space:]._-]*0*([0-9]+)', 'Z.\1'), '');
  v_sym text := upper(nullif(btrim(coalesce(p_symbol, '')), ''));
  v_name text; v_unit text;
  v_kind text := case when p_kind = 'return' then 'return' else 'issue' end;
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  if v_job is null then raise exception 'Enter the Z order.'; end if;
  if v_sym is null then raise exception 'Enter or scan the item symbol.'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'Enter the quantity.'; end if;
  if char_length(v_job) > 60 or char_length(v_sym) > 80 or char_length(coalesce(p_location, '')) > 60 or char_length(coalesce(p_box, '')) > 60 or char_length(coalesce(p_note, '')) > 300 then raise exception 'A field is too long.'; end if;
  select max(l.name), max(l.unit) into v_name, v_unit from subiekt_lots l where l.tenant_id = me.tenant_id and upper(l.symbol) = v_sym;
  if p_id is null then
    insert into wh_issues (tenant_id, kind, user_id, user_name, job_ref, job_key, symbol, name, unit, qty, location, box, note)
      values (me.tenant_id, v_kind, me.id, me.name, v_job, upper(regexp_replace(v_job, '\s', '', 'g')), v_sym, v_name, v_unit, round(p_qty, 3),
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

-- How much of a symbol the app recorded for a Z order: issued and returned (everyone's, exported or not).
create or replace function wh_balance(p_job text, p_symbol text) returns table (issued numeric, returned numeric, unit text)
  language plpgsql security definer set search_path = public as $$
declare me app_users;
  v_key text := upper(regexp_replace(regexp_replace(btrim(coalesce(p_job, '')), '^[Zz][[:space:]._-]*0*([0-9]+)', 'Z.\1'), '\s', '', 'g'));
  v_sym text := upper(btrim(coalesce(p_symbol, '')));
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  return query
    select coalesce(sum(w.qty) filter (where w.kind = 'issue'), 0), coalesce(sum(w.qty) filter (where w.kind = 'return'), 0), max(w.unit)
    from wh_issues w where w.tenant_id = me.tenant_id and w.job_key = v_key and upper(w.symbol) = v_sym;
end $$;

revoke all on function wh_save_issue(uuid, text, text, numeric, text, text, text, text) from public;
revoke all on function wh_balance(text, text) from public;
grant execute on function wh_save_issue(uuid, text, text, numeric, text, text, text, text) to authenticated;
grant execute on function wh_balance(text, text) to authenticated;
