-- ============================================================
--  Role-based access (enforcement layer: the database).
--  Mirrors the capability matrix in packages/shared/src/permissions.ts.
--
--  These RESTRICTIVE policies are AND-ed with the existing permissive
--  `tenant_rw` policies, so a write must satisfy BOTH: right tenant AND
--  right role. SELECT is left wide-open within the tenant (all roles read).
--
--  Scope: this governs clients that go through RLS — i.e. the MOBILE app
--  (anon key + the signed-in user's JWT). The office server uses the
--  SERVICE-ROLE key, which BYPASSES RLS; office traffic is gated in the
--  app layer instead (see office API role checks). Triggers below DO run
--  for the service role, but they no-op when auth.uid() is null (no role),
--  so office/admin server writes are unaffected.
--
--  Matrix (writes):
--    jobs           insert/update/delete  -> admin, office
--    survey_items   insert (kind=item)    -> admin, office, surveyor, scanner
--                   insert (kind=snag)    -> admin, office, surveyor, fitter
--                   update                -> admin, office, surveyor, fitter
--                                            (fitter limited to install status by trigger)
--                   delete                -> admin, office
--    fitter_teams   insert/update/delete  -> admin, office
--    item_photos    insert                -> any tenant member (photos.add = all)
--                   update/delete         -> admin, office
-- ============================================================

-- ---------- jobs: only managers create/edit jobs ----------
drop policy if exists jobs_ins_role on jobs;
drop policy if exists jobs_upd_role on jobs;
drop policy if exists jobs_del_role on jobs;
create policy jobs_ins_role on jobs as restrictive for insert
  with check (auth_role() in ('admin','office'));
create policy jobs_upd_role on jobs as restrictive for update
  using (auth_role() in ('admin','office'))
  with check (auth_role() in ('admin','office'));
create policy jobs_del_role on jobs as restrictive for delete
  using (auth_role() in ('admin','office'));

-- ---------- survey_items: create/edit/fit/delete by role ----------
drop policy if exists items_ins_role on survey_items;
drop policy if exists items_upd_role on survey_items;
drop policy if exists items_del_role on survey_items;
-- Insert: a real item vs a snag have different allowed roles (see matrix).
create policy items_ins_role on survey_items as restrictive for insert
  with check (
    case coalesce(kind, 'item')
      when 'snag' then auth_role() in ('admin','office','surveyor','fitter')
      else            auth_role() in ('admin','office','surveyor','scanner')
    end
  );
-- Update: scanners can't edit after scanning; fitters can (but only install
-- status — enforced by the trigger below).
create policy items_upd_role on survey_items as restrictive for update
  using (auth_role() in ('admin','office','surveyor','fitter'))
  with check (auth_role() in ('admin','office','surveyor','fitter'));
-- Delete: golden record — managers only.
create policy items_del_role on survey_items as restrictive for delete
  using (auth_role() in ('admin','office'));

-- ---------- fitter_teams & rates: managers only ----------
drop policy if exists teams_ins_role on fitter_teams;
drop policy if exists teams_upd_role on fitter_teams;
drop policy if exists teams_del_role on fitter_teams;
create policy teams_ins_role on fitter_teams as restrictive for insert
  with check (auth_role() in ('admin','office'));
create policy teams_upd_role on fitter_teams as restrictive for update
  using (auth_role() in ('admin','office'))
  with check (auth_role() in ('admin','office'));
create policy teams_del_role on fitter_teams as restrictive for delete
  using (auth_role() in ('admin','office'));

-- ---------- item_photos: anyone adds, managers edit/remove ----------
drop policy if exists photos_upd_role on item_photos;
drop policy if exists photos_del_role on item_photos;
create policy photos_upd_role on item_photos as restrictive for update
  using (auth_role() in ('admin','office'))
  with check (auth_role() in ('admin','office'));
create policy photos_del_role on item_photos as restrictive for delete
  using (auth_role() in ('admin','office'));

-- ---------- fitter column guard ----------
-- A fitter may UPDATE an item, but only its install status (fitting) — not the
-- specification or identity. We whitelist the columns a fitter is allowed to move;
-- if anything else differs, block. Excluded columns are those the other BEFORE
-- triggers touch (updated_at, needs_resync) plus install fields a fitter owns.
-- No-ops for every non-fitter role and for the service role (auth_role() null).
create or replace function guard_fitter_item_update() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth_role() = 'fitter' then
    if (to_jsonb(new)
          - 'install_status' - 'updated_at' - 'needs_resync' - 'monday_item_id')
       is distinct from
       (to_jsonb(old)
          - 'install_status' - 'updated_at' - 'needs_resync' - 'monday_item_id')
    then
      raise exception 'Fitters may only update the install status, not the item specification';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists survey_items_guard_fitter on survey_items;
create trigger survey_items_guard_fitter before update on survey_items
  for each row execute function guard_fitter_item_update();
