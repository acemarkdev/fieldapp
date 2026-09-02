-- ============================================================
--  Richer item specification fields (office item edit screen).
--   glazing_bars  : bar/pattern (None/Astragal/Georgian/Leaded/Diamonds)
--   cill_depth    : text choice (Stub/155mm/85mm/180mm) - replaces the numeric cill in the form
--   transom_equal : tick = transoms equally spaced (transom sizes then optional)
--   mullion_equal : tick = mullions equally spaced (mullion sizes then optional)
--  Existing columns keep their roles: material, window_type, glass (texture),
--  glazing (Double/Triple panes), safety_glass (Toughened/Laminated).
-- ============================================================

alter table survey_items add column if not exists glazing_bars  text;
alter table survey_items add column if not exists cill_depth    text;
alter table survey_items add column if not exists transom_equal boolean not null default false;
alter table survey_items add column if not exists mullion_equal boolean not null default false;
