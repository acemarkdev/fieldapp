-- ============================================================
--  Fitter row-scope (enforcement layer: the database).
--
--  Until now every signed-in user could SELECT every row in their
--  tenant (the permissive `tenant_rw` policy). Roles only gated WRITES.
--  This migration adds RESTRICTIVE *read* policies so a FITTER sees
--  only the rows for their own team:
--
--    survey_items   -> only items whose team_id = the fitter's team
--    item_photos    -> only photos of those items
--    jobs           -> only jobs that have at least one item for the team
--    fitter_teams   -> only the fitter's own team (hides other teams' rates)
--
--  Every other role (admin/office/surveyor/scanner) is unaffected, and
--  the office SERVICE-ROLE key bypasses RLS entirely. A snag is a
--  survey_items row (kind='snag'); it now inherits its parent's team so
--  a fitter keeps seeing snags on their own items (see trigger + the
--  mobile app, which also sets team_id on insert).
--
--  Restrictive policies are AND-ed with `tenant_rw`, so a read must
--  satisfy BOTH: right tenant AND (not a fitter OR own-team row).
-- ============================================================

-- Helper: the team of the currently-authenticated user (null for non-fitters).
create or replace function auth_team_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select team_id from app_users where auth_user_id = auth.uid() and active limit 1;
$$;

-- ---------- snags inherit their parent item's team ----------
-- Belt-and-braces to the mobile app: any snag row (kind='snag') gets the
-- parent's team_id if the caller didn't set one, so the read policy below
-- keeps it visible to the right fitter. No-op for normal items.
create or replace function snag_inherit_team() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.kind,'item') = 'snag' and new.team_id is null and new.parent_item_id is not null then
    select team_id into new.team_id from survey_items where id = new.parent_item_id;
  end if;
  return new;
end $$;

drop trigger if exists survey_items_snag_team on survey_items;
create trigger survey_items_snag_team before insert on survey_items
  for each row execute function snag_inherit_team();

-- Backfill existing snags that predate the trigger.
update survey_items s
   set team_id = p.team_id
  from survey_items p
 where s.kind = 'snag'
   and s.team_id is null
   and s.parent_item_id = p.id
   and p.team_id is not null;

-- ---------- survey_items: fitters read only their team's items ----------
drop policy if exists items_sel_fitter on survey_items;
create policy items_sel_fitter on survey_items as restrictive for select
  using (auth_role() is distinct from 'fitter' or team_id = auth_team_id());

-- ---------- item_photos: fitters read only photos of their team's items ----
drop policy if exists photos_sel_fitter on item_photos;
create policy photos_sel_fitter on item_photos as restrictive for select
  using (
    auth_role() is distinct from 'fitter'
    or exists (
      select 1 from survey_items si
       where si.id = item_photos.item_id and si.team_id = auth_team_id()
    )
  );

-- ---------- jobs: fitters read only jobs that hold work for their team -----
drop policy if exists jobs_sel_fitter on jobs;
create policy jobs_sel_fitter on jobs as restrictive for select
  using (
    auth_role() is distinct from 'fitter'
    or exists (
      select 1 from survey_items si
       where si.job_id = jobs.id and si.team_id = auth_team_id()
    )
  );

-- ---------- fitter_teams: a fitter sees only their own team ----------------
drop policy if exists teams_sel_fitter on fitter_teams;
create policy teams_sel_fitter on fitter_teams as restrictive for select
  using (auth_role() is distinct from 'fitter' or id = auth_team_id());
