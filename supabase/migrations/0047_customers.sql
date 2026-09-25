-- ============================================================
--  Customer master ("customer card"): the contractual record for a client.
--  A 3-char code (e.g. AXS) + full name + contact people + the contractual
--  requirements that apply (Pass24, Building control, Trickle vent, …).
--  New jobs must reference an existing customer by code (enforced in the app).
--
--  Read: any signed-in user in the tenant (job creation + item display need it).
--  Write: admins only (contract setup) — mirrors the app's customers.manage cap.
-- ============================================================

create table customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,                       -- 3-char client code, e.g. AXS
  name       text not null,                       -- full customer name
  active     boolean not null default true,
  contacts   jsonb not null default '[]'::jsonb,  -- [{role,name,email,phone}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create index on customers(tenant_id);

-- Master list of contractual requirement types (per tenant, admin-maintained).
create table requirement_types (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index on requirement_types(tenant_id);

-- Which requirement types are ticked for a given customer.
create table customer_requirements (
  customer_id         uuid not null references customers(id) on delete cascade,
  requirement_type_id uuid not null references requirement_types(id) on delete cascade,
  tenant_id           uuid not null references tenants(id) on delete cascade,
  primary key (customer_id, requirement_type_id)
);
create index on customer_requirements(tenant_id);
create index on customer_requirements(requirement_type_id);

-- ---------- RLS: tenant read; admin-only write ----------
alter table customers             enable row level security;
alter table requirement_types     enable row level security;
alter table customer_requirements enable row level security;

drop policy if exists tenant_rw on customers;
create policy tenant_rw on customers using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists tenant_rw on requirement_types;
create policy tenant_rw on requirement_types using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists tenant_rw on customer_requirements;
create policy tenant_rw on customer_requirements using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

drop policy if exists customers_w on customers;
create policy customers_w on customers as restrictive for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
drop policy if exists reqtypes_w on requirement_types;
create policy reqtypes_w on requirement_types as restrictive for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
drop policy if exists custreq_w on customer_requirements;
create policy custreq_w on customer_requirements as restrictive for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- seed a starter requirements list for the ACE tenant ----------
insert into requirement_types (tenant_id, name, sort)
select '00000000-0000-0000-0000-0000000000ac', x.name, x.sort
from (values
  ('Pass24', 10), ('Building control', 20), ('Trickle vents', 30),
  ('Key-locked windows', 40), ('Fire escape hinges', 50), ('Restrictors', 60),
  ('FENSA registration', 70), ('Toughened glass throughout', 80)
) as x(name, sort)
where not exists (
  select 1 from requirement_types r
  where r.tenant_id = '00000000-0000-0000-0000-0000000000ac' and r.name = x.name
);
