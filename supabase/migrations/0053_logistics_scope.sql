-- ============================================================
--  Logistics scope: the 'logistics' role reads/writes NO table directly.
--
--  Label printing is stateless and runs server-side (service-role key), so a logistics
--  login never needs table access. These restrictive policies (AND-ed with every existing
--  policy) make that true even if the user queried Supabase directly with their own token.
--  Applied to every RLS-enabled table in `public` that exists now; the office server's
--  allow-list is the other wall. Re-run this file after adding new tables.
-- ============================================================
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_logistics', t.tablename);
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      left(t.tablename, 40) || '_block_logistics', t.tablename, 'logistics', 'logistics');
  end loop;
end $$;
