-- ============================================================
--  Plans from the phone for scanners too (phone app 0.75.0): a scanner may add a plan image and
--  replace it, like a surveyor, and remove a plan only while nothing is pinned on it. Admin and
--  office keep full rights. Same rules for the plan images in the 'plans' storage bucket.
-- ============================================================
drop policy if exists plans_ins_role on job_plans;
drop policy if exists plans_upd_role on job_plans;
drop policy if exists plans_del_role on job_plans;

create policy plans_ins_role on job_plans as restrictive for insert
  with check (auth_role() in ('admin','office','surveyor','scanner'));
create policy plans_upd_role on job_plans as restrictive for update
  using (auth_role() in ('admin','office','surveyor','scanner'))
  with check (auth_role() in ('admin','office','surveyor','scanner'));
create policy plans_del_role on job_plans as restrictive for delete
  using (
    auth_role() in ('admin','office')
    or (auth_role() in ('surveyor','scanner')
        and not exists (select 1 from survey_items si where si.plan_id = job_plans.id))
  );

drop policy if exists plans_tenant_insert on storage.objects;
drop policy if exists plans_tenant_delete on storage.objects;
create policy plans_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
              and auth_role() in ('admin','office','surveyor','scanner'));
create policy plans_tenant_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text
         and auth_role() in ('admin','office','surveyor','scanner'));
