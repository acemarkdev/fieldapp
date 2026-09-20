-- ============================================================
--  Install sign-off / QA — one handover record per (job, flat).
--
--  When a flat's installs are complete, a supervisor runs an internal QA checklist
--  and marks the flat Passed or Failed. We snapshot the answered checklist onto the
--  row (so it's a permanent record even if the tenant's template changes later),
--  along with who signed it and when. No customer signature (internal QA).
--
--  Operational data (not finance): readable tenant-wide like survey_items; writes are
--  restricted to admin / office (they hold the qa.signoff capability). See
--  packages/shared/src/permissions.ts and docs/roles-and-access.md.
-- ============================================================

create table qa_signoffs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  flat         text not null,
  result       text not null default 'pass' check (result in ('pass','fail')),
  checklist    jsonb not null default '[]'::jsonb,   -- [{key,label,ok,note}] snapshot
  notes        text,
  signed_by    text,
  signed_by_id uuid,
  signed_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (job_id, flat)
);
create index on qa_signoffs(tenant_id);
create index on qa_signoffs(job_id);

-- ---------- RLS: tenant-scoped read; write only admin / office ----------
alter table qa_signoffs enable row level security;

drop policy if exists tenant_rw on qa_signoffs;
create policy tenant_rw on qa_signoffs
  using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

drop policy if exists qa_ins_role on qa_signoffs;
drop policy if exists qa_upd_role on qa_signoffs;
drop policy if exists qa_del_role on qa_signoffs;
create policy qa_ins_role on qa_signoffs as restrictive for insert
  with check (auth_role() in ('admin','office'));
create policy qa_upd_role on qa_signoffs as restrictive for update
  using (auth_role() in ('admin','office'))
  with check (auth_role() in ('admin','office'));
create policy qa_del_role on qa_signoffs as restrictive for delete
  using (auth_role() in ('admin','office'));
