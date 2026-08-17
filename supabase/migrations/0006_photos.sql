-- Photos: the mobile app uploads/reads directly (anon key), so Supabase Storage needs
-- tenant-scoped Row-Level Security. Convention: object path starts with the tenant id,
-- e.g.  <tenant_id>/<item_id>/<timestamp>.jpg  — the office backend keeps using the
-- service-role key (bypasses RLS) so its existing paths are unaffected.

-- Private bucket (id must exist before policies reference it).
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- Track whether a photo has already been pushed to Monday, so re-syncs don't pile up duplicates.
alter table item_photos add column if not exists monday_pushed boolean not null default false;

-- Tenant-scoped access to objects in the photos bucket, keyed on the first path segment.
drop policy if exists photos_tenant_read   on storage.objects;
drop policy if exists photos_tenant_insert on storage.objects;
drop policy if exists photos_tenant_update on storage.objects;
drop policy if exists photos_tenant_delete on storage.objects;

create policy photos_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text);

create policy photos_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text);

create policy photos_tenant_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text);

create policy photos_tenant_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth_tenant_id()::text);
