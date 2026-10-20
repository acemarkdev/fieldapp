-- Production team leader: a new role. Own migration so the enum value is committed before 0089 uses
-- it (run this one first, on its own — like 0076).
--   production_lead  a production worker who also runs the office Production time pages (tasks,
--                    time entries) without seeing rates or zł amounts
alter type user_role add value if not exists 'production_lead';
