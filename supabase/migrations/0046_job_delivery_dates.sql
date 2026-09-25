-- ============================================================
--  Delivery date on a job's programme — a start/end pair like the other phases
--  (Programme, Mapping, Survey, Scaffold, Fitting). Sits before Fitting: materials
--  are delivered before the fitters start. Optional/nullable, feeds the Gantt.
-- ============================================================

alter table jobs add column if not exists delivery_start date;
alter table jobs add column if not exists delivery_end   date;
