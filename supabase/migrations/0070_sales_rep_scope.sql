-- ============================================================
--  Sales rep scope: the 'sales_rep' role reads/writes NO table directly, like 'logistics'
--  and 'acemark_finance'. Its screens (Sales orders, Commission, Manuals) run server-side.
--  Until now only the office server confined it; signed in to the phone app (or with the
--  public key) a sales rep could read the tenant's jobs, items, teams and customers.
--  Re-applies the block for all three confined roles on every RLS table that exists now,
--  so tables added since 0056 are covered too. Safe to re-run.
--  Also: photos and plan images in storage are not readable by the confined roles.
-- ============================================================
do $$
declare t record; r text;
begin
  foreach r in array array['logistics', 'acemark_finance', 'sales_rep'] loop
    for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
      execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
      execute format(
        'create policy %I on %I as restrictive for all to authenticated
           using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
        left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
    end loop;
  end loop;
end $$;

drop policy if exists photos_tenant_read on storage.objects;
create policy photos_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office','surveyor','scanner','fitter','invoice_manager'));

drop policy if exists plans_tenant_read on storage.objects;
create policy plans_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office','surveyor','scanner','fitter','invoice_manager'));
