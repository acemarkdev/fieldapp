-- ============================================================
--  Site code: a human/site-facing code shown on screen, separate from client_code.job_code
--  (which still builds the first two segments of every item code). Display-only.
--  Backfilled from client.job for existing jobs so nothing looks blank.
-- ============================================================

alter table jobs add column if not exists site_code text;

update jobs
   set site_code = client_code || '.' || job_code
 where site_code is null;
