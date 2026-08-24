-- Planned install date — the *scheduled* date an item is due to be fitted.
-- (Distinct from actual_install_date, which the fitter stamps on completion.)
-- Pulled from the job's Monday board (a date column). Powers the fitter's
-- "My schedule" agenda on the phone (Today / Tomorrow / this week / next week).
--
-- Fitters must NOT edit this (it comes from the office/Monday), so it is
-- deliberately left OUT of the fitter update guard's whitelist — a fitter
-- changing it would trip "fitters may only update the install status".
alter table survey_items add column if not exists planned_install_date date;

-- The fitter agenda queries their team's items by date, so index the pair.
create index if not exists survey_items_team_planned_idx
  on survey_items (team_id, planned_install_date);
