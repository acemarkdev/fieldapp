-- Store the monday.com account slug (e.g. "ace189144") per job, so generated item
-- links resolve to the right account: https://<slug>.monday.com/boards/<board>/pulses/<item>.
alter table jobs add column if not exists monday_account_slug text;
