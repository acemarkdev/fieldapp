-- ============================================================
--  Sales orders ▸ quotes: the price to the customer in parts — products, installation and transport.
--  `amount` stays the total quoted to the customer (products + installation + transport); the two
--  parts are kept so the quote can be edited and shown the way it was priced.
-- ============================================================
alter table fin_order_quotes add column if not exists price_install numeric;
alter table fin_order_quotes add column if not exists price_delivery numeric;
