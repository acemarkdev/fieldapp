-- ACE Scaffolding office role (run on its own, before 0096: a new enum value can only be used once committed).
--   scaffolding  the ACE Scaffolding office: sees only the Scaffolding business in the office app.
alter type user_role add value if not exists 'scaffolding';
