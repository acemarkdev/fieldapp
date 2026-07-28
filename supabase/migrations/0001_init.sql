-- ============================================================
--  ACE Field App — initial schema (Sprint 0)
--  Multi-tenant from line one: every business row carries a
--  tenant_id and is protected by Row-Level Security (RLS).
--  ACE is simply tenant #1; the same schema serves future SaaS
--  customers with zero structural change.
--  Money is stored as INTEGER pennies (never floats).
-- ============================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- ---------- enums ----------
create type user_role   as enum ('admin','office','surveyor','scanner','fitter');
create type item_stage  as enum ('scanned','in_survey','surveyed','synced');
create type install_status as enum ('scheduled','installed_no_snag','installed_snag','snag','misfit','delayed');
create type photo_kind  as enum ('reference','survey','sketch','install');
create type connector_type as enum ('monday','procore','fieldwire','csv','clearview','glass_supplier');

-- ---------- tenants ----------
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  -- per-tenant configuration (kept as JSON so new customers need no schema change)
  coding_scheme jsonb not null default '{"segments":["CLIENT","JOB","BLOCK","ELEVATION","FLAT","ROOM","ITEM","FLOOR"],"separator":"."}'::jsonb,
  branding     jsonb not null default '{"primary":"#3a2b72","accent":"#e6187e"}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- users (linked to Supabase auth.users) ----------
create table app_users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  email         text not null,
  role          user_role not null default 'surveyor',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, email)
);
create index on app_users(tenant_id);

-- Helper: the tenant of the currently-authenticated user.
create or replace function auth_tenant_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select tenant_id from app_users where auth_user_id = auth.uid() and active limit 1;
$$;

-- Helper: the role of the current user.
create or replace function auth_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select role from app_users where auth_user_id = auth.uid() and active limit 1;
$$;

-- ---------- jobs (CLIENT.JOB, e.g. AXS.LAB) ----------
create table jobs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  client_code    text not null,                 -- AXS
  job_code       text not null,                 -- LAB
  name           text not null,                 -- Laburnum Road, Waterlooville
  site_address   text,
  monday_board_id text,                          -- set in the Monday-sync screen (nullable = not linked)
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (tenant_id, client_code, job_code)
);
create index on jobs(tenant_id);

-- ---------- fitter teams + members ----------
create table fitter_teams (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null,             -- Team P01
  default_rate_pennies integer not null default 8000,  -- £80.00 default fitting rate
  created_at         timestamptz not null default now(),
  unique (tenant_id, name)
);
create index on fitter_teams(tenant_id);

create table team_members (
  team_id  uuid not null references fitter_teams(id) on delete cascade,
  user_id  uuid not null references app_users(id) on delete cascade,
  primary key (team_id, user_id)
);

-- ---------- style catalogue (Clearview WD etc.) ----------
create table style_catalogue (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references tenants(id) on delete cascade,  -- null = shared/global catalogue
  source       text not null default 'clearview',
  style_number text not null,                   -- Clearview style number, used as Design Code
  product_type text,                            -- Window / Tilt & Turn / Door / Patio / Stable Door
  wide         smallint,                        -- lights across
  high         smallint,                        -- lights high
  opening      smallint,
  fixed        smallint,
  drawing_path text,                            -- storage path to the style drawing
  notes        text,
  unique (source, style_number)
);
create index on style_catalogue(product_type, wide, high);

-- ---------- survey items (the golden record) ----------
create table survey_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  job_id         uuid not null references jobs(id) on delete cascade,

  -- location / identity (set during Initial Job Scan)
  block          text,
  elevation      text,
  flat           text,
  room_code      text,
  item_code      text,                          -- W01 / D01
  floor          text,
  full_code      text,                          -- AXS.LAB.B1.E1.F21.LR.W02.F1 (assembled)

  -- specification (Final Survey)
  material       text,
  item_type      text,
  glass          text,
  safety_glass   text,
  glazing        text,
  width_mm       integer,
  height_mm      integer,                        -- inc cill
  cill_depth_mm  integer,
  transom1_mm    integer, transom2_mm integer, transom3_mm integer,
  mullion1_mm    integer, mullion2_mm integer, mullion3_mm integer,
  open_in_out    text,
  add_ons        text,
  coupled        text,
  design_code    text,                           -- Clearview style number (from configurator)
  comments       text,

  -- workflow
  stage          item_stage not null default 'scanned',
  surveyed_by    uuid references app_users(id) on delete set null,
  scanned_by     uuid references app_users(id) on delete set null,

  -- install / labour
  team_id        uuid references fitter_teams(id) on delete set null,
  rate_override_pennies integer,                 -- null = inherit team default; set = per-item override
  install_status install_status,

  -- integration mirror
  monday_item_id text,                           -- populated on sync (idempotency key with full_code)

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, full_code)
);
create index on survey_items(tenant_id);
create index on survey_items(job_id);
create index on survey_items(stage);

-- Effective fitting rate = override if set, else the assigned team's default.
create or replace function item_effective_rate_pennies(it survey_items) returns integer
  language sql stable as $$
  select coalesce(it.rate_override_pennies, (select default_rate_pennies from fitter_teams t where t.id = it.team_id));
$$;

-- ---------- photos ----------
create table item_photos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  item_id      uuid not null references survey_items(id) on delete cascade,
  kind         photo_kind not null,
  storage_path text not null,                    -- Supabase Storage object path
  taken_at     timestamptz,
  gps_lat      double precision,
  gps_lng      double precision,
  created_at   timestamptz not null default now()
);
create index on item_photos(item_id);

-- ---------- snags ----------
create table snags (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  item_id      uuid not null references survey_items(id) on delete cascade,
  description  text not null,
  photo_path   text,
  status       text not null default 'open',
  monday_subitem_id text,
  created_at   timestamptz not null default now()
);
create index on snags(item_id);

-- ---------- pick events (fuel for the "most used" ranking) ----------
create table pick_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  item_id      uuid references survey_items(id) on delete set null,
  style_number text not null,
  job_id       uuid references jobs(id) on delete set null,
  room_code    text,
  surveyor_id  uuid references app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on pick_events(tenant_id, style_number);
create index on pick_events(job_id);

-- ---------- connectors (Monday now; supply-chain later) ----------
create table connectors (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  type         connector_type not null,
  config       jsonb not null default '{}'::jsonb,   -- tokens/config held server-side only
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on connectors(tenant_id);

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_items_updated before update on survey_items
  for each row execute function set_updated_at();

-- ============================================================
--  Row-Level Security: a user only ever sees their own tenant.
-- ============================================================
alter table tenants          enable row level security;
alter table app_users        enable row level security;
alter table jobs             enable row level security;
alter table fitter_teams     enable row level security;
alter table team_members     enable row level security;
alter table style_catalogue  enable row level security;
alter table survey_items     enable row level security;
alter table item_photos      enable row level security;
alter table snags            enable row level security;
alter table pick_events      enable row level security;
alter table connectors       enable row level security;

-- Own-tenant access on every tenant-scoped table.
create policy tenant_rw on jobs           using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy tenant_rw on fitter_teams   using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy tenant_rw on survey_items   using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy tenant_rw on item_photos    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy tenant_rw on snags          using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
create policy tenant_rw on pick_events    using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- Users: read your own tenant; only admins may write.
create policy users_read  on app_users using (tenant_id = auth_tenant_id());
create policy users_admin on app_users for all
  using (tenant_id = auth_tenant_id() and auth_role() = 'admin')
  with check (tenant_id = auth_tenant_id() and auth_role() = 'admin');

-- Tenant row: readable by its members.
create policy tenant_self on tenants using (id = auth_tenant_id());

-- Team members: scoped through their team's tenant.
create policy tm_rw on team_members using (
  exists (select 1 from fitter_teams t where t.id = team_id and t.tenant_id = auth_tenant_id())
) with check (
  exists (select 1 from fitter_teams t where t.id = team_id and t.tenant_id = auth_tenant_id())
);

-- Catalogue: global rows (tenant_id null) plus your own tenant's rows.
create policy catalogue_read on style_catalogue using (tenant_id is null or tenant_id = auth_tenant_id());

-- Connectors hold secrets: admins/office only.
create policy connectors_rw on connectors for all
  using (tenant_id = auth_tenant_id() and auth_role() in ('admin','office'))
  with check (tenant_id = auth_tenant_id() and auth_role() in ('admin','office'));
