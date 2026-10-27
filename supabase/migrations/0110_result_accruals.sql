-- ============================================================
--  Performance ▸ Result (UoR / IFRS views): holiday and bonus accruals, typed per month like depreciation and
--  financial cost (✎) — the accountant's figure; negative = a reversal. Without this migration the line shows
--  "–" and cannot be typed.
-- ============================================================
alter table fin_result_items add column if not exists accruals numeric(14,2);
