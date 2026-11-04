-- ============================================================
--  Warehouse (phone): a symbol typed with different spacing is the same item.
--  "4342 RAL7044 CM 4500MM" and "4342 RAL 7044 CM 4500 MM" now match:
--   • wh_items   — the Subiekt stock lookup also matches the symbol with every space removed
--                  (an exact match without spaces comes first, so the phone recognises it);
--   • wh_balance — issued / already returned for a return counts the rows whatever their spacing.
-- ============================================================
create or replace function wh_items(p_query text) returns table (symbol text, name text, unit text, stock numeric)
  language plpgsql security definer set search_path = public as $$
declare me app_users; q text := btrim(coalesce(p_query, ''));
  qs text := upper(regexp_replace(btrim(coalesce(p_query, '')), '\s', '', 'g'));
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select l.symbol, max(l.name), max(l.unit), sum(l.qty)
    from subiekt_lots l
    where l.tenant_id = me.tenant_id and (l.symbol ilike q || '%' or l.name ilike '%' || q || '%'
      or upper(regexp_replace(l.symbol, '\s', '', 'g')) like qs || '%')
    group by l.symbol
    order by (upper(regexp_replace(l.symbol, '\s', '', 'g')) = qs) desc, (upper(l.symbol) = upper(q)) desc, (l.symbol ilike q || '%') desc, l.symbol
    limit 25;
end $$;

create or replace function wh_balance(p_job text, p_symbol text) returns table (issued numeric, returned numeric, unit text)
  language plpgsql security definer set search_path = public as $$
declare me app_users;
  v_key text := upper(regexp_replace(regexp_replace(btrim(coalesce(p_job, '')), '^[Zz][[:space:]._-]*0*([0-9]+)', 'Z.\1'), '\s', '', 'g'));
  v_sym text := upper(regexp_replace(coalesce(p_symbol, ''), '\s', '', 'g'));
begin
  select * into me from app_users where auth_user_id = auth.uid() and active limit 1;
  if me.id is null or me.role not in ('warehouse', 'admin') then raise exception 'Not allowed.'; end if;
  return query
    select coalesce(sum(w.qty) filter (where w.kind = 'issue'), 0), coalesce(sum(w.qty) filter (where w.kind = 'return'), 0), max(w.unit)
    from wh_issues w where w.tenant_id = me.tenant_id and w.job_key = v_key and upper(regexp_replace(w.symbol, '\s', '', 'g')) = v_sym;
end $$;

revoke all on function wh_items(text) from public;
revoke all on function wh_balance(text, text) from public;
grant execute on function wh_items(text) to authenticated;
grant execute on function wh_balance(text, text) to authenticated;
