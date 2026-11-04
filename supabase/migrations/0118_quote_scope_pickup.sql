-- ============================================================
--  Sales orders ▸ quotes: a third scope, "Self pickup" (the customer collects) — no installation and no delivery cost.
-- ============================================================
alter table fin_order_quotes drop constraint if exists fin_order_quotes_scope_check;
alter table fin_order_quotes add constraint fin_order_quotes_scope_check check (scope in ('delivery', 'install', 'pickup'));
