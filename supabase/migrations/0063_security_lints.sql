-- ============================================================
--  Clears the Supabase security-advisor warnings that can be cleared without changing behaviour.
--
--  1. Pin search_path on the three functions that had none.
--  2. Functions that run with the owner's rights (SECURITY DEFINER) are no longer callable by
--     visitors who are not signed in. Signed-in users keep the ones row-level security needs.
--  3. Trigger-only functions are not callable through the API at all (a trigger still fires:
--     the right to run a trigger function is checked when the trigger is created, not when it fires).
--  4. demo_leads: the insert-only policy for prospects now checks what is inserted instead of
--     accepting anything.
--  5. The server-only Fin&Ops tables get an explicit "nobody" policy (no change in access).
--
--  Left as they are, on purpose: signed-in users can still execute auth_role(), auth_tenant_id(),
--  auth_team_id(), auth_client_code() and job_client_code() — every RLS policy calls them as the
--  signed-in user, so revoking that would lock everyone out. Each only returns the caller's own
--  role / tenant / team, or the client code of a job.
-- ============================================================

-- 1. search_path
alter function public.item_effective_rate_pennies(survey_items) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.flag_resync()    set search_path = public;

-- 2. RLS helpers + link_current_user: signed-in users and the server only
revoke execute on function public.auth_tenant_id()      from public, anon;
revoke execute on function public.auth_role()           from public, anon;
revoke execute on function public.auth_team_id()        from public, anon;
revoke execute on function public.auth_client_code()    from public, anon;
revoke execute on function public.job_client_code(uuid) from public, anon;
revoke execute on function public.link_current_user()   from public, anon;
grant  execute on function public.auth_tenant_id()      to authenticated, service_role;
grant  execute on function public.auth_role()           to authenticated, service_role;
grant  execute on function public.auth_team_id()        to authenticated, service_role;
grant  execute on function public.auth_client_code()    to authenticated, service_role;
grant  execute on function public.job_client_code(uuid) to authenticated, service_role;
grant  execute on function public.link_current_user()   to authenticated, service_role;

-- 3. trigger-only functions: nobody calls these directly
revoke execute on function public.guard_fitter_item_update() from public, anon, authenticated;
revoke execute on function public.snag_inherit_team()        from public, anon, authenticated;
do $$ begin
  -- created by the Supabase dashboard (not by these migrations), so it may not exist everywhere
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- 4. demo_leads: still insert-only for prospects, but only a lead-shaped row
drop policy if exists demo_leads_ins on demo_leads;
create policy demo_leads_ins on demo_leads for insert to anon, authenticated
  with check (
    kind in ('demo_started', 'quote')
    and coalesce(char_length(email), 0)       <= 254
    and coalesce(char_length(name), 0)        <= 200
    and coalesce(char_length(company), 0)     <= 200
    and coalesce(char_length(phone), 0)       <= 50
    and coalesce(char_length(message), 0)     <= 4000
    and coalesce(char_length(app_version), 0) <= 40
  );

-- 5. Fin&Ops tables are server-only: RLS is on with no policy, which already blocks the phone and
--    browser keys completely (the office server uses the service-role key, which bypasses RLS).
--    An explicit "nobody" policy says so in the database and clears the "RLS enabled, no policy" notes.
do $$
declare t text;
begin
  foreach t in array array['fin_jobs', 'fin_job_items', 'fin_sales', 'fin_payroll', 'fin_result_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists server_only on public.%I', t);
      execute format('create policy server_only on public.%I for all to anon, authenticated using (false) with check (false)', t);
    end if;
  end loop;
end $$;
