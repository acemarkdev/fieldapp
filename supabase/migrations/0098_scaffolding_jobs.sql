-- ============================================================
--  ACE Scaffolding — phase 2: jobs and contracts.
--    scaf_crews      who puts scaffolds up and down: our own crews and the subcontractors (JMS, DW, LPD…)
--    scaf_scaffolds  each element that goes up on a job (from the accepted quote's lines, or added: a variation
--                    or adaption, or by hand on an imported job): its price and hire terms, and its own life —
--                    booked → erecting → on hire (handed over) → dismantle requested → dismantling → down
--    scaf_visits     the planner: erect / adapt / inspect / dismantle / deliver / collect, a date, a crew
--    scaf_handovers  the handover certificate: date, scaffolds handed over, who for ACE, the client's name and
--                    signature — it starts the hire of those scaffolds
--    scaf_jobs       + job checklist (RAMS, alarm, licence, hoist, design / TG20…), contact, notes
--  Server-only access, like the other scaf_ tables.
-- ============================================================
create table if not exists scaf_crews (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  kind       text not null default 'own' check (kind in ('own', 'sub')),
  phone      text, notes text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists scaf_crews_name on scaf_crews(tenant_id, lower(name));

create table if not exists scaf_scaffolds (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  job_id             uuid not null references scaf_jobs(id) on delete cascade,
  position           integer not null default 0,
  element            text, description text,
  tag                text,                                   -- scaffold tag / reference on site
  variation          boolean not null default false,         -- added after the quote (variation / adaption)
  confirmed_by       text, confirmed_on date,                -- a variation: who confirmed it in writing, when
  price              numeric(12,2) not null default 0,
  labour             numeric(12,2),
  hire_weeks         numeric(6,2), rent_pct numeric(6,2), rent_weekly numeric(12,2),
  status             text not null default 'booked' check (status in ('booked', 'erecting', 'on_hire', 'dismantle_requested', 'dismantling', 'down')),
  erected_on         date,
  handed_over_on     date,                                   -- the hire starts
  dismantle_requested_on date, dismantle_requested_by text, dismantle_request_logged_at timestamptz,
  down_on            date,
  created_at         timestamptz not null default now(),
  edited_at          timestamptz not null default now()
);
create index if not exists scaf_scaffolds_job on scaf_scaffolds(job_id);

create table if not exists scaf_visits (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_id       uuid not null references scaf_jobs(id) on delete cascade,
  kind         text not null check (kind in ('erect', 'adapt', 'inspect', 'dismantle', 'deliver', 'collect')),
  day          date not null,
  days         integer not null default 1,                 -- how many working days it takes
  crew_id      uuid references scaf_crews(id) on delete set null,
  scaffold_ids uuid[] not null default '{}',
  status       text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  notes        text,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz not null default now()
);
create index if not exists scaf_visits_day on scaf_visits(tenant_id, day);
create index if not exists scaf_visits_job on scaf_visits(job_id);

create table if not exists scaf_handovers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_id        uuid not null references scaf_jobs(id) on delete cascade,
  day           date not null,
  scaffold_ids  uuid[] not null default '{}',
  ace_person    text,
  client_name   text,
  signature     text,                                       -- the client's signature, a small PNG data URL
  max_load      text,                                       -- duty / load class stated on the certificate
  notes         text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists scaf_handovers_job on scaf_handovers(job_id);

alter table scaf_jobs add column if not exists checklist jsonb not null default '{}';
alter table scaf_jobs add column if not exists contact_id uuid references scaf_contacts(id) on delete set null;
alter table scaf_jobs add column if not exists notes text;

do $$
declare t text;
begin
  foreach t in array array['scaf_crews', 'scaf_scaffolds', 'scaf_visits', 'scaf_handovers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists server_only on %I', t);
    execute format('create policy server_only on %I for all to anon, authenticated using (false) with check (false)', t);
    execute format('drop policy if exists %I on %I', left(t, 40) || '_block_scaffolding', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', left(t, 40) || '_block_scaffolding', t, 'scaffolding', 'scaffolding');
  end loop;
end $$;

-- the crews named on the monday Project Sheet ("Company" column), as a start
insert into scaf_crews (tenant_id, name, kind)
select distinct j.tenant_id, j.erector, case when j.erector ilike 'ACE%' then 'own' else 'sub' end
from scaf_jobs j where coalesce(j.erector, '') <> ''
on conflict do nothing;
