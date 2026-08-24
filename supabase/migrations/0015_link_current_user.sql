-- Self-linking for the mobile app.
--
-- The office web server (service-role key) links a login to its app_users row by
-- email on every request. The mobile app talks to Supabase directly under RLS and
-- had no way to do this: if app_users.auth_user_id wasn't already set for the
-- identity used on the phone (e.g. the account was set up for the web app, or the
-- user signs in with Microsoft SSO which is a different auth uid), then
-- auth_tenant_id()/auth_role() resolve to NULL, the user's own row is invisible
-- under RLS, role loads as null, and every role-gated control hides — including
-- "+ New job".
--
-- This SECURITY DEFINER function links the caller's auth uid to the app_users row
-- that matches their JWT email (bypassing RLS, but only ever touching the row that
-- matches the caller's own verified email). The app calls it once on login.
create or replace function link_current_user() returns void
  language plpgsql security definer set search_path = public as $$
declare em text;
begin
  em := lower(coalesce(auth.jwt() ->> 'email', ''));
  if em = '' then return; end if;
  update app_users
     set auth_user_id = auth.uid()
   where lower(email) = em
     and active
     and (auth_user_id is null or auth_user_id = auth.uid());
end $$;

grant execute on function link_current_user() to authenticated;
