-- ============================================================
--  Customer portal scoping (the DB boundary for the 'customer' role).
--
--  A customer login belongs to ONE client (the CLIENT part of the job code,
--  e.g. AXS in AXS.LAB). They may only ever see that client's jobs and items,
--  and never teams, rates, photos or any finance data. The office web app
--  drives the portal through the service-role key, but these RLS policies make
--  the boundary real even if a customer queried Supabase directly with their
--  own token.
-- ============================================================

-- Which client a customer user represents (null for every non-customer role).
alter table app_users add column if not exists client_code text;

-- Helper: the client_code of the currently-authenticated user.
create or replace function auth_client_code() returns text
  language sql stable security definer set search_path = public as $$
  select client_code from app_users where auth_user_id = auth.uid() and active limit 1;
$$;

-- ---------- customer read-scope (restrictive, AND-ed with tenant_rw) ----------
-- jobs: a customer sees only their own client's jobs.
drop policy if exists jobs_sel_customer on jobs;
create policy jobs_sel_customer on jobs as restrictive for select
  using (auth_role() is distinct from 'customer' or client_code = auth_client_code());

-- survey_items: only items on their client's jobs.
drop policy if exists items_sel_customer on survey_items;
create policy items_sel_customer on survey_items as restrictive for select
  using (
    auth_role() is distinct from 'customer'
    or exists (select 1 from jobs j where j.id = survey_items.job_id and j.client_code = auth_client_code())
  );

-- A customer never reads teams/rates or photos directly (the customer PDF is built
-- server-side with the service-role key). Block both for the customer role.
drop policy if exists teams_block_customer on fitter_teams;
create policy teams_block_customer on fitter_teams as restrictive for select
  using (auth_role() is distinct from 'customer');

drop policy if exists photos_block_customer on item_photos;
create policy photos_block_customer on item_photos as restrictive for select
  using (auth_role() is distinct from 'customer');
