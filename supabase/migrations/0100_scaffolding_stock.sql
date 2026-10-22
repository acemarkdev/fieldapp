-- ============================================================
--  ACE Scaffolding — phase 5: stock (tube & fitting).
--    scaf_stock_items   the catalogue: tubes by length, boards, fittings, base plates, ladders, sheeting…;
--                       unit, weight, replacement value (what a loss is charged at)
--    scaf_locations     the yard and the vans (up to 5 to start); sites are the jobs themselves
--    scaf_stock_notes   a movement document: delivery (yard / van → job), collection (job → yard / van), transfer
--                       (yard ↔ van), purchase (new stock in), stocktake (count → adjustment), loss (written off)
--    scaf_stock_lines   its items and quantities. A place's stock = what came in − what went out; negative is
--                       allowed (reconciled later), as stock on site is often counted only at the end.
--    scaf_scaffolds     + bom: the estimated materials of a scaffold {item id: qty} → the availability forecast
--  Server-only access, like the other scaf_ tables.
-- ============================================================
create table if not exists scaf_stock_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  category   text not null default 'Fittings',
  unit       text not null default 'pcs',
  weight_kg  numeric(8,2),
  value      numeric(10,2),
  position   integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists scaf_stock_items_code on scaf_stock_items(tenant_id, lower(code));

create table if not exists scaf_locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  kind       text not null check (kind in ('yard', 'van')),
  name       text not null,
  reg        text,
  active     boolean not null default true,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists scaf_stock_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  number      integer not null,                         -- SN-0001
  kind        text not null check (kind in ('delivery', 'collection', 'transfer', 'purchase', 'stocktake', 'loss')),
  day         date not null,
  from_loc    uuid references scaf_locations(id) on delete set null,
  to_loc      uuid references scaf_locations(id) on delete set null,
  job_id      uuid references scaf_jobs(id) on delete set null,   -- the site of a delivery / collection / loss
  final       boolean not null default false,           -- a collection that clears the site
  vehicle     text, driver text, signed_by text, notes text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (tenant_id, number)
);
create index if not exists scaf_stock_notes_job on scaf_stock_notes(job_id);
create index if not exists scaf_stock_notes_day on scaf_stock_notes(tenant_id, day);

create table if not exists scaf_stock_lines (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  note_id   uuid not null references scaf_stock_notes(id) on delete cascade,
  item_id   uuid not null references scaf_stock_items(id) on delete restrict,
  qty       numeric(10,2) not null                      -- stocktake: the difference counted (+ / −)
);
create index if not exists scaf_stock_lines_note on scaf_stock_lines(note_id);
create index if not exists scaf_stock_lines_item on scaf_stock_lines(item_id);

alter table scaf_scaffolds add column if not exists bom jsonb not null default '{}';

do $$
declare t text;
begin
  foreach t in array array['scaf_stock_items', 'scaf_locations', 'scaf_stock_notes', 'scaf_stock_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists server_only on %I', t);
    execute format('create policy server_only on %I for all to anon, authenticated using (false) with check (false)', t);
    execute format('drop policy if exists %I on %I', left(t, 40) || '_block_scaffolding', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', left(t, 40) || '_block_scaffolding', t, 'scaffolding', 'scaffolding');
  end loop;
end $$;

-- a starting catalogue (tube & fitting) and the yard + 5 vans, for each tenant that has none yet — all can be changed in the app
insert into scaf_locations (tenant_id, kind, name, position)
select t.id, v.kind, v.name, v.pos from tenants t
cross join (values ('yard', 'Yard', 0), ('van', 'Van 1', 1), ('van', 'Van 2', 2), ('van', 'Van 3', 3), ('van', 'Van 4', 4), ('van', 'Van 5', 5)) as v(kind, name, pos)
where not exists (select 1 from scaf_locations l where l.tenant_id = t.id);

insert into scaf_stock_items (tenant_id, code, name, category, unit, weight_kg, value, position)
select t.id, i.code, i.name, i.cat, i.unit, i.kg, i.val, i.pos from tenants t
cross join (values
  ('T21', 'Tube 21 ft (6.4 m)', 'Tubes', 'pcs', 28.0, 30.00, 1), ('T18', 'Tube 18 ft (5.5 m)', 'Tubes', 'pcs', 24.0, 26.00, 2),
  ('T16', 'Tube 16 ft (4.9 m)', 'Tubes', 'pcs', 21.4, 23.00, 3), ('T13', 'Tube 13 ft (4.0 m)', 'Tubes', 'pcs', 17.5, 19.00, 4),
  ('T10', 'Tube 10 ft (3.0 m)', 'Tubes', 'pcs', 13.1, 15.00, 5), ('T8', 'Tube 8 ft (2.4 m)', 'Tubes', 'pcs', 10.5, 12.00, 6),
  ('T6', 'Tube 6 ft (1.8 m)', 'Tubes', 'pcs', 7.9, 9.00, 7), ('T5', 'Tube 5 ft (1.5 m)', 'Tubes', 'pcs', 6.6, 8.00, 8),
  ('T4', 'Tube 4 ft (1.2 m)', 'Tubes', 'pcs', 5.2, 6.50, 9), ('PUT5', 'Putlog 5 ft (1.5 m)', 'Tubes', 'pcs', 7.0, 10.00, 10),
  ('B13', 'Board 13 ft (3.9 m)', 'Boards', 'pcs', 20.0, 24.00, 20), ('B10', 'Board 10 ft (3.0 m)', 'Boards', 'pcs', 15.5, 19.00, 21),
  ('B8', 'Board 8 ft (2.4 m)', 'Boards', 'pcs', 12.5, 16.00, 22), ('B6', 'Board 6 ft (1.8 m)', 'Boards', 'pcs', 9.5, 12.00, 23),
  ('B5', 'Board 5 ft (1.5 m)', 'Boards', 'pcs', 8.0, 10.00, 24), ('B4', 'Board 4 ft (1.2 m)', 'Boards', 'pcs', 6.5, 9.00, 25),
  ('DBL', 'Double coupler', 'Fittings', 'pcs', 1.1, 3.50, 30), ('SWV', 'Swivel coupler', 'Fittings', 'pcs', 1.2, 4.00, 31),
  ('PLC', 'Putlog coupler', 'Fittings', 'pcs', 0.6, 2.50, 32), ('SLV', 'Sleeve coupler', 'Fittings', 'pcs', 1.0, 3.50, 33),
  ('JP', 'Joint pin', 'Fittings', 'pcs', 0.6, 2.50, 34), ('BRC', 'Board retaining coupler', 'Fittings', 'pcs', 0.6, 2.50, 35),
  ('TBC', 'Toe board clip', 'Fittings', 'pcs', 0.3, 1.50, 36), ('RP', 'Reveal pin', 'Fittings', 'pcs', 1.0, 4.00, 37),
  ('BP', 'Base plate', 'Base', 'pcs', 1.5, 2.00, 40), ('SB', 'Sole board', 'Base', 'pcs', 3.0, 3.00, 41),
  ('LAD3', 'Ladder 3 m', 'Access', 'pcs', 9.0, 110.00, 50), ('LAD4', 'Ladder 4 m', 'Access', 'pcs', 12.0, 140.00, 51),
  ('LAD6', 'Ladder 6 m', 'Access', 'pcs', 18.0, 190.00, 52), ('LB4', 'Ladder beam 4.2 m', 'Beams', 'pcs', 22.0, 95.00, 53),
  ('LB6', 'Ladder beam 6.3 m', 'Beams', 'pcs', 33.0, 140.00, 54), ('BG', 'Brick guard', 'Protection', 'pcs', 6.0, 22.00, 60),
  ('NET', 'Debris netting (50 m roll)', 'Protection', 'roll', 15.0, 60.00, 61), ('MON', 'Monarflex sheeting (roll)', 'Protection', 'roll', 45.0, 180.00, 62),
  ('GIN', 'Gin wheel', 'Lifting', 'pcs', 5.0, 45.00, 70), ('TAG', 'Scaffold tag (Scafftag)', 'Safety', 'pcs', 0.2, 6.00, 80)
) as i(code, name, cat, unit, kg, val, pos)
where not exists (select 1 from scaf_stock_items s where s.tenant_id = t.id);
