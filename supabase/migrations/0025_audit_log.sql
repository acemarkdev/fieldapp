-- ============================================================
--  Audit log — who did what. Small, append-only. Written by the office server
--  (service-role) which already knows the acting user (ctx). Read by admins.
-- ============================================================

create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  actor_user_id  uuid,
  actor_name     text,
  actor_role     text,
  action         text not null,        -- e.g. item.update, item.delete, item.sync, mapping.save, job.create
  entity         text,                 -- e.g. item, job, team, board
  entity_id      text,                 -- the affected id / code
  summary        text,                 -- short human-readable description
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_tenant_time on audit_log(tenant_id, created_at desc);

alter table audit_log enable row level security;
-- Only tenant admins may read directly (defence in depth; the office reads via service-role).
-- No insert/update/delete policy: writes happen only through the service-role key.
drop policy if exists audit_sel_admin on audit_log;
create policy audit_sel_admin on audit_log for select
  using (tenant_id = auth_tenant_id() and auth_role() = 'admin');
