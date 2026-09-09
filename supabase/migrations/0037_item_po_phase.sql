-- ============================================================
--  PO phase: a number (1, 2, 3…) grouping survey items into a purchase order. Assigned only to
--  Surveyed items (enforced in the API). Used to generate a per-phase purchase-order PDF.
-- ============================================================

alter table survey_items add column if not exists po_phase integer;
create index if not exists survey_items_po_phase_idx on survey_items(job_id, po_phase);
