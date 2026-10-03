-- Acemark Finance role: the office app's Fin&Ops menu (company cost control) and nothing else.
-- Own migration so the enum value is committed before 0056's policies reference it.
alter type user_role add value if not exists 'acemark_finance';
