-- ============================================================
--  Retire (deactivate) a fitter team instead of deleting it.
--
--  A team with items assigned can't be deleted (it would orphan their rate/
--  history). Instead it can be RETIRED: active=false. Retired teams stay on
--  historical items and in reports, but are hidden from new assignment
--  dropdowns. They can be reactivated at any time.
-- ============================================================

alter table fitter_teams
  add column if not exists active boolean not null default true;
