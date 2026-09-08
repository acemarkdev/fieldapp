-- ============================================================
--  Usage billing: a per-item rate (pennies) charged to each tenant for items created in the app.
--  Set by the vendor (Acemark super-admin). Read for monthly invoicing figures.
-- ============================================================

alter table tenants add column if not exists item_rate_pennies integer not null default 0;
