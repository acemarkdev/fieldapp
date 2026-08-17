-- A fitter login belongs to one team, so the mobile app can show that team's items.
-- (One team per user; the legacy team_members table stays for any future many-to-many need.)
alter table app_users add column if not exists team_id uuid references fitter_teams(id) on delete set null;
create index if not exists app_users_team_idx on app_users(team_id);
