-- ============================================================
--  Purchasing: native PO Request board + Approved Suppliers.
--  A PO request is raised by internal staff, tagged with a cost centre, and moves through
--  a status workflow. Requests of £2000+ need an approver (mirrors the monday rule).
--  Suppliers are an admin-managed approved list. Files (quote / PO / order ack / delivery)
--  live in the 'pofiles' storage bucket.
-- ============================================================

create table suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  contact    text,
  email      text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index on suppliers(tenant_id);

create table po_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  number             text not null,                         -- POR-0001
  title              text not null,
  status             text not null default 'in_review'
                       check (status in ('in_review','approved','rejected','po_sent','supplier_confirmed','part_delivered','delivered','cancelled')),
  requestor_id       uuid,
  requestor_name     text,
  cost_centre_id     uuid references cost_centres(id) on delete set null,
  supplier_id        uuid references suppliers(id) on delete set null,
  new_supplier       text,                                  -- free-text when not on the approved list yet
  amount_pennies     integer not null default 0,
  currency           text not null default 'GBP',
  delivery_date      date,
  delivery_location  text,
  site_contact       text,
  remake             boolean not null default false,
  special_instructions text,
  qty_items          integer,
  qty_snags          integer,
  approval_required  boolean not null default false,        -- amount >= £2000
  approved_by        uuid,
  approved_at        timestamptz,
  po_number          text,                                  -- from Xero (added when PO sent)
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, number)
);
create index on po_requests(tenant_id);
create index on po_requests(tenant_id, status);
create index on po_requests(cost_centre_id);

create table po_request_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  po_request_id uuid not null references po_requests(id) on delete cascade,
  kind          text not null default 'quote'
                  check (kind in ('quote','po','order_ack','delivery','budget','other')),
  name          text not null,
  storage_path  text not null,
  content_type  text,
  size_bytes    integer,
  created_at    timestamptz not null default now()
);
create index on po_request_files(po_request_id);

-- ---------- RLS ----------
alter table suppliers         enable row level security;
alter table po_requests       enable row level security;
alter table po_request_files  enable row level security;

drop policy if exists tenant_rw on suppliers;
create policy tenant_rw on suppliers using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists suppliers_w on suppliers;
create policy suppliers_w on suppliers as restrictive for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- Internal staff (not customer / invoice_manager) can raise & edit PO requests; reads tenant-wide.
drop policy if exists tenant_rw on po_requests;
create policy tenant_rw on po_requests using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists po_requests_w on po_requests;
create policy po_requests_w on po_requests as restrictive for all
  using (auth_role() in ('admin','office','surveyor','scanner','fitter'))
  with check (auth_role() in ('admin','office','surveyor','scanner','fitter'));

drop policy if exists tenant_rw on po_request_files;
create policy tenant_rw on po_request_files using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists po_files_w on po_request_files;
create policy po_files_w on po_request_files as restrictive for all
  using (auth_role() in ('admin','office','surveyor','scanner','fitter'))
  with check (auth_role() in ('admin','office','surveyor','scanner','fitter'));
