-- Warehouse: a new role. Own migration so the enum value is committed before 0091 uses it (run this
-- one first, on its own — like 0076 and 0088).
--   warehouse  logs what is issued from the warehouse for a Z order (phone: Wydania) and logs own
--              production time like a production worker
alter type user_role add value if not exists 'warehouse';
