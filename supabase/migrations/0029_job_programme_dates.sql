-- ============================================================
--  Programme dates on a job: six start/end pairs for planning + the Gantt view.
--  All nullable / optional. Kept SEPARATE from jobs.mapping_start_date (the
--  operational trigger that flips a job to 'pending_mapping' for scanners).
-- ============================================================

alter table jobs add column if not exists programme_start          date;
alter table jobs add column if not exists programme_end            date;
alter table jobs add column if not exists mapping_start            date;
alter table jobs add column if not exists mapping_end              date;
alter table jobs add column if not exists survey_start             date;
alter table jobs add column if not exists survey_end               date;
alter table jobs add column if not exists scaffold_erect_start     date;
alter table jobs add column if not exists scaffold_erect_end       date;
alter table jobs add column if not exists scaffold_dismantle_start date;
alter table jobs add column if not exists scaffold_dismantle_end   date;
alter table jobs add column if not exists fitting_start            date;
alter table jobs add column if not exists fitting_end              date;
