-- ============================================================
--  Cost Centre register — the single list that tags every purchase / PO request.
--  Three kinds:
--    framework  – manual framework phases (PCC LAB Phase 1, CHE LES Phase 1, …)
--    enquiry    – derived from the Enquiries board ("EQ - L2025 17525 - <desc>"):
--                 code = the L-number, label = the enquiry description, eq_item_id = monday id
--    general    – manual overheads (vehicles, tooling, office, …)
--  Admin-managed; readable tenant-wide so it can populate purchase pickers + reporting.
-- ============================================================

create table cost_centres (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  code        text not null,                        -- e.g. "L2025 17525" or "PCC LAB Phase 1"
  label       text,                                 -- human description (enquiry name / free text)
  type        text not null default 'general' check (type in ('framework','enquiry','general')),
  source      text not null default 'manual' check (source in ('manual','eq_import')),
  eq_item_id  text,                                 -- monday Enquiries board item id (enquiry-derived)
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index on cost_centres(tenant_id);
create index on cost_centres(tenant_id, type);

alter table cost_centres enable row level security;
drop policy if exists tenant_rw on cost_centres;
create policy tenant_rw on cost_centres using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists cost_centres_w on cost_centres;
create policy cost_centres_w on cost_centres as restrictive for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- Seed the existing "All Frame Work" framework phases for the ACE tenant (idempotent).
insert into cost_centres (tenant_id, code, label, type, source, sort)
select '00000000-0000-0000-0000-0000000000ac', x.code, x.code, 'framework', 'manual', x.sort
from (values
  ('PCC LAB Phase 1',10),('PCC LAB Phase 2',20),('PCC LAB Phase 3',30),('PCC LAB Phase 4',40),
  ('PCC BEL Phase 1',50),('PCC NOR Phase 1',60),
  ('PCC FUR Phase 1',70),('PCC FUR Phase 2',80),('PCC FUR Phase 3',90),('PCC FUR Phase 4',100),('PCC FUR Phase 5',110),
  ('PCC-COR-BO1',120),('PCC EMS Phase 1',130),('AXS PAD Phase 1',140),
  ('PCC EBH Phase 1',150),('PCC EBH Phase 2',160),('PCC EBH Phase 3',170),
  ('PCC CHA Phase 1',180),('CHE ARG Phase 1',190),('CHE ARG Phase 2',200),('CHE ARG Phase 3',210),
  ('PCC FOR Phase 1',220),('PCC EMS Phase 2',230),('PCC EMS Phase 3',240),('PCC CHA Phase 2',250),('CHE LES Phase 1',260)
) as x(code, sort)
where not exists (select 1 from cost_centres c where c.tenant_id='00000000-0000-0000-0000-0000000000ac' and c.code = x.code);
