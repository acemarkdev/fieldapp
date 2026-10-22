-- ============================================================
--  Which ACE Group businesses a user sees on the office home page (tiles: Framework, Acemark PL,
--  ACE Scaffolding). null = the default for the user's role (admin: all; Polish roles: Acemark PL;
--  everyone else: Framework). Set in Admin ▸ Users. The list of businesses lives in the app
--  (packages/shared/src/businesses.ts).
-- ============================================================
alter table app_users add column if not exists businesses text[];
