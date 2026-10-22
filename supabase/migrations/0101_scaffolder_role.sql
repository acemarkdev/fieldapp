-- ACE Scaffolding crews on the phone (run on its own, before 0102: a new enum value can only be used once committed).
--   scaffolder  a scaffolder or crew leader: the phone app's crew screen only (day list, handover on site,
--               7-day inspections, delivery / collection notes).
alter type user_role add value if not exists 'scaffolder';
