-- ============================================================
--  Job mapping lifecycle (scanner pre-load workflow).
--
--  A new job starts at status 'new' and is invisible to the scanner role.
--  When an admin assigns a mapping_start_date the status flips to
--  'pending_mapping' and the job appears in the scanner's list, where they can
--  pre-load its items (block/elevation → floors → windows/doors) in bulk.
--  The job stays 'pending_mapping' after a save so more can be pre-loaded.
-- ============================================================

alter table jobs add column if not exists status text not null default 'new';
alter table jobs add column if not exists mapping_start_date date;

-- Existing jobs predate this workflow — treat them as already released so they
-- keep behaving normally (they're not gated to scanners retroactively).
update jobs set status = 'pending_mapping' where status = 'new' and created_at < now();
