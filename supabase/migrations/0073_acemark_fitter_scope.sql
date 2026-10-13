-- ============================================================
--  Acemark Fitter scope: like the other menu-only roles, 'acemark_fitter' reads/writes NO table
--  directly — its form runs server-side. Re-applies the block for all four confined roles on
--  every RLS table that exists now. Safe to re-run. (Storage read policies already list the
--  roles that may read photos and plans, so nothing to change there.)
-- ============================================================
do $$
declare t record; r text;
begin
  foreach r in array array['logistics', 'acemark_finance', 'sales_rep', 'acemark_fitter'] loop
    for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
      execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
      execute format(
        'create policy %I on %I as restrictive for all to authenticated
           using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
        left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
    end loop;
  end loop;
end $$;
