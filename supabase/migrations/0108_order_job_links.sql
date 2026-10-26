-- ============================================================
--  Sales orders ⇄ Job costs, step 2 of the order-to-actuals process.
--    fin_orders.vendor_quote     the vendor's quote for the trade scenario: a link (OneDrive, monday file) or a note
--    fin_orders.monday_item_id   the order's item on the monday board Acemark PL Enquiries (an "Open in monday" link)
--    fin_jobs.monday_item_id     the Z job's item on the monday board PRODUCTION ACEMARK PL
--  Both monday ids are filled by the existing Load from monday buttons (and for the items already loaded, the next
--  time they run). The app works without this migration — it just shows no links and keeps no vendor quote.
-- ============================================================
alter table fin_orders add column if not exists vendor_quote text;
alter table fin_orders add column if not exists monday_item_id text;
alter table fin_jobs add column if not exists monday_item_id text;
create index if not exists fin_orders_monday_item on fin_orders(tenant_id, monday_item_id);
create index if not exists fin_jobs_monday_item on fin_jobs(tenant_id, monday_item_id);
