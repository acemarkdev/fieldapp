-- ============================================================
--  Job costs: the stage of each Z job on the monday board PRODUCTION ACEMARK PL — the group its item is in
--  ("1 Zamówienia", "4 Produkcja/ Production", "5 Zakończone/Complete" …) and that group's colour, shown on the
--  Job costs list. Refreshed by Job costs ▸ Load from monday and every night. Without this migration the list
--  just shows no stage.
-- ============================================================
alter table fin_jobs add column if not exists monday_group text;
alter table fin_jobs add column if not exists monday_group_color text;
alter table fin_jobs add column if not exists monday_group_at timestamptz;
