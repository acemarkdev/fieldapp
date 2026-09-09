-- ============================================================
--  Mark items that were created from an Excel import, so the Mapping ▸ Import panel can
--  offer a one-click "Delete items imported to this job" (skipping any already synced to Monday).
-- ============================================================

alter table survey_items add column if not exists from_import boolean not null default false;
