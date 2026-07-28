-- ============================================================
--  Seed data — ACE as tenant #1
--  Safe to re-run (ON CONFLICT DO NOTHING).
-- ============================================================

insert into tenants (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000ac','ACE Group','ace')
on conflict (id) do nothing;

-- Jobs (CLIENT.JOB). AXS.LAB is linked to the real Monday board.
insert into jobs (tenant_id, client_code, job_code, name, site_address, monday_board_id) values
  ('00000000-0000-0000-0000-0000000000ac','AXS','LAB','Laburnum Road, Waterlooville','73-103A Laburnum Road, Waterlooville, PO7 7EW','18410303410'),
  ('00000000-0000-0000-0000-0000000000ac','AXS','FUR','Furlong House', null, null),
  ('00000000-0000-0000-0000-0000000000ac','AXS','NOR','Norwood Rise',  null, null)
on conflict (tenant_id, client_code, job_code) do nothing;

-- Fitter teams with default fitting rates (pennies).
insert into fitter_teams (tenant_id, name, default_rate_pennies) values
  ('00000000-0000-0000-0000-0000000000ac','Team P01', 8000),   -- £80.00
  ('00000000-0000-0000-0000-0000000000ac','Team P02', 9000)    -- £90.00
on conflict (tenant_id, name) do nothing;

-- Users. auth_user_id is linked on first Supabase login (email match).
insert into app_users (tenant_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000ac','Milosz Dering','milosz@acegroup-uk.com','admin'),
  ('00000000-0000-0000-0000-0000000000ac','Anna Croft','acroft@acegroup-uk.com','surveyor'),
  ('00000000-0000-0000-0000-0000000000ac','Jakub Fitter','jfitter@acegroup-uk.com','fitter'),
  ('00000000-0000-0000-0000-0000000000ac','Kamil Nowak','knowak@acegroup-uk.com','scanner')
on conflict (tenant_id, email) do nothing;

-- Sample Clearview styles (global catalogue). Full ~500-style import lands in Sprint 2.
insert into style_catalogue (tenant_id, source, style_number, product_type, wide, high, opening, fixed) values
  (null,'clearview','1',  'Window',1,1,0,1),
  (null,'clearview','2',  'Window',1,1,1,0),
  (null,'clearview','3',  'Window',1,1,1,0),
  (null,'clearview','6',  'Window',1,2,1,1),
  (null,'clearview','23', 'Window',2,1,0,2),
  (null,'clearview','24', 'Window',2,2,2,1),
  (null,'clearview','25', 'Window',2,2,2,1),
  (null,'clearview','32', 'Window',1,3,2,1),
  (null,'clearview','201','Tilt & Turn',1,1,1,0)
on conflict (source, style_number) do nothing;

-- Register the Monday connector for ACE (token is set via env / server, not seeded here).
insert into connectors (tenant_id, type, config) values
  ('00000000-0000-0000-0000-0000000000ac','monday','{"note":"API token supplied via server env, never stored in the client"}')
on conflict do nothing;
