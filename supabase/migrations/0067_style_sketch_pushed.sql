-- ============================================================
--  Sync to Monday now also uploads the item's style drawing (from the sketch catalogue) into the
--  board's "Design Sketch" file column. This column remembers which style's drawing was last sent
--  for the item, so a re-sync does not add the same picture again; a changed style sends the new one.
--  Until this has run, the server does not upload drawings at all.
-- ============================================================
alter table survey_items add column if not exists style_sketch_pushed text;
