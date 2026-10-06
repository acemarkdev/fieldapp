-- ============================================================
--  CRITICAL: close write access to app_users and tenants for ordinary signed-in users.
--
--  0001 created `users_read` and `tenant_self` without a FOR clause, which in Postgres means
--  FOR ALL — so they allowed INSERT / UPDATE / DELETE, not just reading. Through the public API
--  (the anon key is in every phone and browser) any signed-in member of the tenant — a fitter, or
--  a customer login — could change their own role to admin, edit or delete other users, or delete
--  the tenant row (which cascades to all of its data).
--
--  Nothing in the apps writes these tables with a user's own key: the office server manages users
--  and tenant settings with the service-role key (which bypasses RLS), and link_current_user()
--  runs with the owner's rights. So after this, users and the tenant are read-only from the phone.
--
--  Also: a customer login now only sees its own user row (not the staff list), and the tables
--  that had a tenant rule but no role rule get one.
-- ============================================================

-- ---------- app_users: read-only for clients; customers see only themselves ----------
drop policy if exists users_read  on app_users;
drop policy if exists users_admin on app_users;
create policy users_read on app_users for select
  using (
    tenant_id = auth_tenant_id()
    and (auth_role() is distinct from 'customer' or auth_user_id = auth.uid())
  );

-- ---------- tenants: members read their tenant; nobody changes it from a client ----------
drop policy if exists tenant_self on tenants;
create policy tenant_self on tenants for select using (id = auth_tenant_id());

-- ---------- tables that had only the tenant rule ----------
-- Not used by the phone at all (the office server reads/writes them): office + admin only.
drop policy if exists team_members_role_guard on team_members;
create policy team_members_role_guard on team_members as restrictive for all
  using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));

drop policy if exists snags_role_guard on snags;
create policy snags_role_guard on snags as restrictive for all
  using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));

drop policy if exists test_results_role_guard on test_results;
create policy test_results_role_guard on test_results as restrictive for all
  using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));

drop policy if exists import_drafts_role_guard on import_drafts;
create policy import_drafts_role_guard on import_drafts as restrictive for all
  using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));

-- Style picks: the phone's style picker reads and records them while surveying.
drop policy if exists pick_events_role_guard on pick_events;
create policy pick_events_role_guard on pick_events as restrictive for all
  using (auth_role() in ('admin','office','surveyor','scanner'))
  with check (auth_role() in ('admin','office','surveyor','scanner'));

-- Style catalogue: everyone may read it; only office + admin may change it.
drop policy if exists style_catalogue_ins_guard on style_catalogue;
drop policy if exists style_catalogue_upd_guard on style_catalogue;
drop policy if exists style_catalogue_del_guard on style_catalogue;
create policy style_catalogue_ins_guard on style_catalogue as restrictive for insert
  with check (auth_role() in ('admin','office'));
create policy style_catalogue_upd_guard on style_catalogue as restrictive for update
  using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));
create policy style_catalogue_del_guard on style_catalogue as restrictive for delete
  using (auth_role() in ('admin','office'));
