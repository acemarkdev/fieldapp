-- PO requests: start/end of service dates + the assigned fitters team.
alter table po_requests add column if not exists service_start date;
alter table po_requests add column if not exists service_end   date;
alter table po_requests add column if not exists team_id uuid references fitter_teams(id) on delete set null;
create index if not exists po_requests_team_idx on po_requests(team_id);
