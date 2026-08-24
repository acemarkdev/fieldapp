-- New finance-only role for the budget / customer payment module.
-- Added in its OWN migration so the enum value is committed before any table or
-- policy references it — Postgres forbids using a freshly-added enum value in the
-- same transaction that adds it.
alter type user_role add value if not exists 'invoice_manager';
