-- ============================================================
--  Job file attachments (drawings, PDFs, zips, images) uploaded on a job.
--  Stored in the private 'jobfiles' storage bucket; this table is the index.
-- ============================================================

create table if not exists job_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_id        uuid not null references jobs(id) on delete cascade,
  name          text not null,
  storage_path  text not null,
  content_type  text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);
create index if not exists job_files_job on job_files(job_id);

alter table job_files enable row level security;
-- Tenant members may read; writes happen via the service-role (office server).
drop policy if exists jobfiles_sel on job_files;
create policy jobfiles_sel on job_files for select using (tenant_id = auth_tenant_id());
