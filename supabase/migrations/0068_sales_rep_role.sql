-- Sales rep role: the Fin&Ops ▸ Sales orders and Commission pages for the rep's own orders, nothing else.
-- Own migration so the enum value is committed before anything uses it (run this one first, on its own).
alter type user_role add value if not exists 'sales_rep';
