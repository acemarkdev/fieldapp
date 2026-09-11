-- ============================================================
--  Job flag: whether flats span multiple elevations. Unchecked (default) = single-elevation flats;
--  checked = multi-elevation flats. Set on the New/Edit job card.
-- ============================================================

alter table jobs add column if not exists multi_elevation boolean not null default false;
