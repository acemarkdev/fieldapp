-- Per-user interface language for the office app. Empty = default (English). Currently only the
-- Fin&Ops screens are translated (Polish).
alter table app_users add column if not exists language text check (language in ('en','pl'));
