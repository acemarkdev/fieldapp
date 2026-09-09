-- ============================================================
--  Two jobs may now share the same client.job code (e.g. two "AXS.PAD" sites). The free-text
--  Site code becomes each job's unique identifier instead, and item codes become unique per job
--  (so each AXS.PAD site can independently have B3…W2 without clashing).
-- ============================================================

-- Jobs: drop the old client_code+job_code uniqueness. Site code (per tenant) is the new key.
alter table jobs drop constraint if exists jobs_tenant_id_client_code_job_code_key;

-- Make sure every job has a site code.
update jobs set site_code = client_code || '.' || job_code
 where site_code is null or btrim(site_code) = '';

-- De-duplicate any existing site codes (site code is now the unique key). Within a tenant, the
-- earliest job keeps its site code; later duplicates get "-2", "-3", … appended so the unique
-- index below can be created without failing. Rename them properly afterwards in Edit job.
with d as (
  select id,
         row_number() over (partition by tenant_id, lower(btrim(site_code)) order by created_at, id) as rn
  from jobs
)
update jobs j
   set site_code = j.site_code || '-' || d.rn
  from d
 where d.id = j.id and d.rn > 1;

-- Enforce site code unique per tenant (case-insensitive).
create unique index if not exists jobs_tenant_site_code_key
  on jobs (tenant_id, lower(btrim(site_code)));

-- Survey items: scope code uniqueness to the job instead of the whole tenant, so two jobs
-- sharing a client.job prefix can each hold the same item code.
alter table survey_items drop constraint if exists survey_items_tenant_id_full_code_key;
create unique index if not exists survey_items_job_full_code_key
  on survey_items (job_id, full_code);
