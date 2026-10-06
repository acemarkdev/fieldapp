-- ============================================================
--  Photo and plan files: access by role, not just by tenant.
--
--  Until now any signed-in member of the tenant — including a customer login — could read,
--  overwrite and delete every file in the 'photos' and 'plans' buckets through the public API.
--  Customers see their photos through the office portal, which hands out short-lived links from
--  the server, so they need no direct access at all.
--
--    photos  read    -> staff (everyone except customer)
--            add     -> admin, office, surveyor, scanner, fitter
--            change / delete -> admin, office
--    plans   read    -> staff (everyone except customer)
--            add     -> admin, office, surveyor
--            change  -> admin, office
--            delete  -> admin, office, surveyor (a surveyor removing a mis-taken plan photo)
--    job_plans rows: not readable by a customer login.
-- ============================================================
drop policy if exists photos_tenant_read   on storage.objects;
drop policy if exists photos_tenant_insert on storage.objects;
drop policy if exists photos_tenant_update on storage.objects;
drop policy if exists photos_tenant_delete on storage.objects;

create policy photos_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() is distinct from 'customer');
create policy photos_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text
              and auth_role() in ('admin','office','surveyor','scanner','fitter'));
create policy photos_tenant_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office'));
create policy photos_tenant_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office'));

drop policy if exists plans_tenant_read   on storage.objects;
drop policy if exists plans_tenant_insert on storage.objects;
drop policy if exists plans_tenant_update on storage.objects;
drop policy if exists plans_tenant_delete on storage.objects;

create policy plans_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() is distinct from 'customer');
create policy plans_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
              and auth_role() in ('admin','office','surveyor'));
create policy plans_tenant_update on storage.objects for update to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office'));
create policy plans_tenant_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office','surveyor'));

drop policy if exists plans_block_customer on job_plans;
create policy plans_block_customer on job_plans as restrictive for select
  using (auth_role() is distinct from 'customer');
