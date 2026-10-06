-- ============================================================
--  Plans from the phone: a surveyor can now add a plan image in the field app (photo, gallery or
--  file) and pin the mapped items on it. Until now only admin/office could create job_plans rows.
--
--    insert / update  -> admin, office, surveyor
--    delete           -> admin, office (any plan);
--                        surveyor only while the plan has no pins on it (a mis-taken photo),
--                        so a surveyor can never wipe pins someone has already placed.
--
--  The 'plans' storage bucket already lets any signed-in member of the tenant upload (0011).
-- ============================================================
drop policy if exists plans_ins_role on job_plans;
drop policy if exists plans_upd_role on job_plans;
drop policy if exists plans_del_role on job_plans;

create policy plans_ins_role on job_plans as restrictive for insert
  with check (auth_role() in ('admin','office','surveyor'));

create policy plans_upd_role on job_plans as restrictive for update
  using (auth_role() in ('admin','office','surveyor'))
  with check (auth_role() in ('admin','office','surveyor'));

create policy plans_del_role on job_plans as restrictive for delete
  using (
    auth_role() in ('admin','office')
    or (auth_role() = 'surveyor'
        and not exists (select 1 from survey_items si where si.plan_id = job_plans.id))
  );
