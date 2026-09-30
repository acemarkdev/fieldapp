-- Logistics role: prints window/door labels (office ▸ Logistics ▸ Labels) and nothing else.
-- Added in its own migration so the enum value is committed before 0053's policies reference
-- it (Postgres forbids using a new enum value in the same transaction that adds it).
alter type user_role add value if not exists 'logistics';
