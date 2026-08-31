-- ============================================================
--  Separate fitter rate for Doors.
--
--  A team's existing default_rate_pennies is the WINDOWS rate. Doors are
--  fitted at their own rate (default £120.00 = 12000). Per-item rate
--  overrides still win over both. See effectiveRatePennies() in @ace/shared.
-- ============================================================

alter table fitter_teams
  add column if not exists door_rate_pennies integer not null default 12000;

-- Existing teams: seed the doors rate at £120 (the agreed default).
update fitter_teams set door_rate_pennies = 12000 where door_rate_pennies is null;
