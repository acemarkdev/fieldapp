-- ============================================================
--  Delivery address (with its own postcode) for a job — where materials are delivered, which may
--  differ from the site address. Both are now required in the app; shown on the purchase-order PDF.
-- ============================================================

alter table jobs add column if not exists delivery_address text;
alter table jobs add column if not exists delivery_postcode text;
