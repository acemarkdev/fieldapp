-- Acemark Fitter role: the office app's cost reports form (extra installation costs on a sales
-- order) and nothing else. Own migration so the enum value is committed before 0073 uses it
-- (run this one first, on its own).
alter type user_role add value if not exists 'acemark_fitter';
