-- ============================================================
--  ACE Scaffolding — phase 0 (run 0095 first).
--    scaf_customers  who we work for: domestic, trade, commercial (principal contractors), ACE companies
--    scaf_contacts   people at a customer
--    scaf_sites      addresses where scaffolds go up (a customer's site; one address key per tenant)
--    scaf_enquiries  enquiries / estimates, numbered ACE#### (monday "Estimated Enquiries")
--    scaf_jobs       jobs / projects, numbered ACESC#### (monday "Project Sheet")
--  monday is imported once (and can be re-run until the switch-off): rows carry monday_id (unique; NULLs allowed
--  many times, so upserts can use the index); a row
--  changed in the office app (edited_at set) is never overwritten by a re-import.
--  Server-only access (service-role key), like the other office-only tables.
-- ============================================================
create table if not exists scaf_customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  name_key     text not null,                              -- lower-case letters and digits, for matching
  kind         text not null default 'commercial' check (kind in ('domestic', 'trade', 'commercial', 'ace')),
  email        text, phone text, address text, vat_number text, notes text,
  active       boolean not null default true,
  monday_id    bigint,
  imported_at  timestamptz, edited_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists scaf_customers_key on scaf_customers(tenant_id, name_key);
create index if not exists scaf_customers_monday on scaf_customers(tenant_id, monday_id);

create table if not exists scaf_contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid not null references scaf_customers(id) on delete cascade,
  name         text not null,
  role         text, email text, phone text, notes text,
  monday_id    bigint,
  import_key   text,                                       -- set on imported contacts (re-import finds them by it)
  imported_at  timestamptz, edited_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists scaf_contacts_customer on scaf_contacts(customer_id);
create unique index if not exists scaf_contacts_import on scaf_contacts(tenant_id, import_key);   -- 'm<monday id>' or 'c:<customer key>:<name key>'

create table if not exists scaf_sites (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid references scaf_customers(id) on delete set null,
  address      text not null,
  address_key  text not null,
  postcode     text,
  access_notes text,
  imported_at  timestamptz, edited_at timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists scaf_sites_key on scaf_sites(tenant_id, address_key);
create index if not exists scaf_sites_customer on scaf_sites(customer_id);

create table if not exists scaf_enquiries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  number        integer not null,                          -- ACE4018 → 4018
  title         text,
  customer_id   uuid references scaf_customers(id) on delete set null,
  contact_id    uuid references scaf_contacts(id) on delete set null,
  site_id       uuid references scaf_sites(id) on delete set null,
  stage         text not null default 'new',               -- new, waiting_access, awaiting_details, survey, quote_required, quote_draft,
                                                           -- quote_sent, pending, hot, won, declined, not_required, on_hold, missed, other
  status_label  text,                                      -- the monday label as it was
  follow_up     text,                                      -- monday "Follow up" (loss reasons: TOO PRICEY, WENT TO A DIFFERENT…)
  source        text, sector text, client_type text,       -- Domestic / Commercial; Private / Trade / Commercial
  received      date, deadline date, quote_sent date,
  price         numeric(12,2), est_cost_up numeric(12,2), est_cost_down numeric(12,2), size_m2 numeric(10,2),
  estimator     text, surveyor text, salesperson text,
  notes         text,
  monday_id     bigint, monday_group text,
  imported_at   timestamptz, edited_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists scaf_enquiries_number on scaf_enquiries(tenant_id, number);
create unique index if not exists scaf_enquiries_new_number on scaf_enquiries(tenant_id, number) where monday_id is null;
create unique index if not exists scaf_enquiries_monday on scaf_enquiries(tenant_id, monday_id);
create index if not exists scaf_enquiries_customer on scaf_enquiries(customer_id);

create table if not exists scaf_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  number            integer not null,                      -- ACESC2552 → 2552
  title             text,
  enquiry_id        uuid references scaf_enquiries(id) on delete set null,
  customer_id       uuid references scaf_customers(id) on delete set null,
  site_id           uuid references scaf_sites(id) on delete set null,
  stage             text not null default 'booked',        -- booked, to_be_rented, ongoing, still_up, being_rented, ready_for_dismantle,
                                                           -- part_dismantled, down, commercial, na
  status_label      text,
  erector           text,                                  -- ACE Scaff or the subcontractor (JMS, DW, LPD…)
  po_number         text, handover text, rams text, invoiced text,
  up_start date, up_end date,                              -- erection (monday "Timeline Up/Down")
  hire_weeks        numeric(6,2),                          -- included hire period
  rent_pct          numeric(6,2),                          -- % of the price per week after it
  rent_start date, rent_end date, dismantle_request date, dismantle_start date, down_date date,
  price             numeric(12,2), payment numeric(12,2), net_cost numeric(12,2),
  actual_cost_up    numeric(12,2), actual_cost_down numeric(12,2),
  monday_id         bigint, monday_group text,
  imported_at       timestamptz, edited_at timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists scaf_jobs_number on scaf_jobs(tenant_id, number);
create unique index if not exists scaf_jobs_new_number on scaf_jobs(tenant_id, number) where monday_id is null;
create unique index if not exists scaf_jobs_monday on scaf_jobs(tenant_id, monday_id);
create index if not exists scaf_jobs_enquiry on scaf_jobs(enquiry_id);

do $$
declare t text;
begin
  foreach t in array array['scaf_customers', 'scaf_contacts', 'scaf_sites', 'scaf_enquiries', 'scaf_jobs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists server_only on %I', t);
    execute format('create policy server_only on %I for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- The Scaffolding office role works through the office server only: every table is closed to it for
-- direct client access, except its own user row (sign-in).
do $$
declare t record; r text := 'scaffolding';
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists %I on %I', left(t.tablename, 40) || '_block_' || r, t.tablename);
    if t.tablename = 'app_users' then continue; end if;
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)',
      left(t.tablename, 40) || '_block_' || r, t.tablename, r, r);
  end loop;
end $$;
