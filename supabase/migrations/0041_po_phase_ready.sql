-- ============================================================
--  PO phase "ready for PO" lock. When a phase is marked ready, its items record who marked it and
--  when; those items are then locked from PO-phase changes (except by an admin).
-- ============================================================

alter table survey_items add column if not exists po_ready_by uuid references app_users(id) on delete set null;
alter table survey_items add column if not exists po_ready_at timestamptz;
