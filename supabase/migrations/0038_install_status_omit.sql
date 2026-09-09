-- ============================================================
--  Add an 'Omit' install status. Items marked Omit can be excluded from the budget calculation
--  and the customer price PDF via a toggle on the Budget screen.
--  (ADD VALUE runs on its own so it isn't blocked by other DDL in a transaction.)
-- ============================================================

alter type install_status add value if not exists 'omit';
