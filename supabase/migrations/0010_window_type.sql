-- Window/opening style (e.g. Casement, Tilt & Turn, Sliding Sash) captured during survey.
-- Distinct from item_type (Window vs Door). Maps to a Monday "Window Type" column if present.
alter table survey_items add column if not exists window_type text;
