-- ============================================================
--  Fix: "infinite recursion detected in policy for relation jobs" (42P17).
--
--  Two restrictive SELECT policies referenced each other's table, forming a cycle:
--    • jobs_sel_fitter (on jobs)          -> sub-selects survey_items
--    • items_sel_customer (on survey_items) -> sub-selects jobs
--  Reading jobs under RLS therefore looped jobs -> survey_items -> jobs -> …
--  The office app avoided it (service-role key bypasses RLS); the mobile app,
--  which reads with the signed-in user's token, hit the recursion and every
--  jobs read failed (the app showed "Offline — showing your last saved jobs").
--
--  Fix: move the jobs lookup inside survey_items' policy into a SECURITY DEFINER
--  helper. A function body is opaque to Postgres' RLS recursion check, so the
--  survey_items policy no longer references the jobs table and the cycle is broken.
--  Access rules are unchanged: a customer still sees only survey_items whose job
--  belongs to their client.
-- ============================================================

-- Returns a job's client_code, bypassing RLS (security definer). Used only inside
-- the survey_items customer policy so it doesn't re-enter the jobs policy.
create or replace function job_client_code(p_job_id uuid) returns text
  language sql stable security definer set search_path = public as $$
    select client_code from jobs where id = p_job_id;
$$;

drop policy if exists items_sel_customer on survey_items;
create policy items_sel_customer on survey_items as restrictive for select
  using (
    auth_role() is distinct from 'customer'
    or job_client_code(survey_items.job_id) = auth_client_code()
  );
