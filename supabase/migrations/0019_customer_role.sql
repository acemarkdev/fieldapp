-- Customer self-service role. Added in its own migration so the enum value is committed
-- before any table/policy references it (Postgres forbids using a new enum value in the
-- same transaction that adds it).
alter type user_role add value if not exists 'customer';
