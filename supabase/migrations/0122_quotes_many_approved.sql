-- ============================================================
--  Sales orders ▸ quotes: an order may have several approved quotes (separate parts — e.g. windows and roller
--  blinds); their amounts add up to the order's value (app 1.87.1+). Drops the "one approved quote per order"
--  index from 0112.
-- ============================================================
drop index if exists fin_order_quotes_one_approved;
