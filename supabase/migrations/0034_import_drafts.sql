-- ============================================================
--  Excel import staging (Operations ▸ Mapping ▸ Import from Excel).
--  One draft grid per job, held server-side (survives, visible to the team) until the
--  user commits it to the Items table. Rows are stored as jsonb exactly as edited in the grid.
-- ============================================================

create table if not exists import_drafts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  job_id      uuid not null references jobs(id) on delete cascade,
  filename    text,
  rows        jsonb not null default '[]'::jsonb,
  updated_by  uuid references app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, job_id)
);
create index if not exists import_drafts_job_idx on import_drafts(job_id);

alter table import_drafts enable row level security;
drop policy if exists tenant_rw on import_drafts;
create policy tenant_rw on import_drafts
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- Items committed from an import draft that are missing mandatory data are flagged incomplete.
-- Surfaced in the Items view as an "Unfinished" status + filter so they can be completed.
alter table survey_items add column if not exists incomplete boolean not null default false;
