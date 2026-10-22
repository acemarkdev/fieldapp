-- ============================================================
--  ACE Scaffolding — phase 4: the phone app for crews (run 0101 first).
--    scaf_crews.members  the users in a crew: a scaffolder sees the visits of their crews on the phone
--    scaf_inspections    the 7-day inspection register (Work at Height Regulations 2005): a scaffold inspected
--                        before first use, at most every 7 days, after bad weather or alterations — safe or not,
--                        defects, what was done, photos (bucket 'scaffolding'); overdue when 7 days have passed
--  The phone talks to the office server (/api/scaf/crew/…); the tables stay server-only.
-- ============================================================
alter table scaf_crews add column if not exists members uuid[] not null default '{}';

create table if not exists scaf_inspections (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_id       uuid not null references scaf_jobs(id) on delete cascade,
  scaffold_id  uuid not null references scaf_scaffolds(id) on delete cascade,
  day          date not null,
  reason       text not null default 'weekly' check (reason in ('first_use', 'weekly', 'weather', 'alteration', 'other')),
  safe         boolean not null,
  defects      text, actions text,
  photos       text[] not null default '{}',            -- storage paths in the 'scaffolding' bucket
  inspector    text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists scaf_inspections_scaffold on scaf_inspections(scaffold_id, day);
create index if not exists scaf_inspections_job on scaf_inspections(job_id);

alter table scaf_inspections enable row level security;
drop policy if exists server_only on scaf_inspections;
create policy server_only on scaf_inspections for all to anon, authenticated using (false) with check (false);

-- the scaffolder role, like the office one, works through the server only
do $$
declare t record; r text;
begin
  foreach r in array array['scaffolder', 'scaffolding'] loop
    for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
      execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
      if t.tablename = 'app_users' then continue; end if;
      execute format(
        'create policy %I on %I as restrictive for all to authenticated
           using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
        left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
    end loop;
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('scaffolding', 'scaffolding', false)
on conflict (id) do nothing;
