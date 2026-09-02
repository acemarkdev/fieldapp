-- ============================================================
--  Postcode on a job. Mandatory at create time in the app (server-enforced);
--  the column is nullable so existing rows are unaffected until edited.
-- ============================================================

alter table jobs add column if not exists postcode text;
