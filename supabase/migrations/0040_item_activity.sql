-- ============================================================
--  Per-item activity log (Monday-style timeline). Reuses the existing audit_log with a structured
--  before→after payload, and records who created each item and how (mapping / import / manual).
-- ============================================================

-- Structured field-level change payload on audit rows, e.g. [{"field":"width_mm","from":640,"to":660}].
alter table audit_log add column if not exists details jsonb;
create index if not exists audit_log_entity_idx on audit_log(tenant_id, entity, entity_id);

-- Per-item provenance so the timeline can show "loaded via mapping by X".
alter table survey_items add column if not exists created_by  uuid references app_users(id) on delete set null;
alter table survey_items add column if not exists created_via text;  -- mapping | import | manual | mobile
