-- ============================================================
--  Budget & customer payment module — STRICTLY admin / invoice_manager only.
--
--  Design note on separation: RLS is row-level, not column-level, so a money
--  column added to survey_items or jobs (both broadly readable) would leak to
--  office/surveyor/scanner/fitter and the mobile app. Therefore ALL financial
--  data lives in its own tables here, each readable only by admin/invoice_manager.
--  Operational fields the pricing engine needs (dimensions, item_type, flat,
--  kind) already live on survey_items and stay there; the server joins them in.
--
--  Money is stored in INTEGER pennies, matching the rest of the schema.
-- ============================================================

-- Per-customer pricing rule: a named formula (model) + editable parameters.
create table pricing_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,                            -- e.g. "Axis — standard"
  customer    text,                                     -- customer / client name
  model       text not null default 'axs_flat_v1',      -- which formula the engine runs
  params      jsonb not null default '{}'::jsonb,        -- all rates (pennies) + counts
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index on pricing_rules(tenant_id);

-- Which rule prices a given job (kept out of the jobs table so the association
-- itself stays finance-only).
create table job_pricing (
  job_id          uuid primary key references jobs(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  pricing_rule_id uuid references pricing_rules(id) on delete set null,
  updated_at      timestamptz not null default now()
);
create index on job_pricing(tenant_id);
create index on job_pricing(pricing_rule_id);

-- Per-item finance flags: mark an item a variation with a manually-agreed amount.
create table item_pricing (
  item_id                  uuid primary key references survey_items(id) on delete cascade,
  tenant_id                uuid not null references tenants(id) on delete cascade,
  is_variation             boolean not null default false,
  variation_amount_pennies integer,
  updated_at               timestamptz not null default now()
);
create index on item_pricing(tenant_id);

-- ---------- RLS: only admin / invoice_manager, within their tenant ----------
alter table pricing_rules enable row level security;
alter table job_pricing   enable row level security;
alter table item_pricing  enable row level security;

drop policy if exists pricing_rules_fin on pricing_rules;
create policy pricing_rules_fin on pricing_rules for all
  using (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'))
  with check (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'));

drop policy if exists job_pricing_fin on job_pricing;
create policy job_pricing_fin on job_pricing for all
  using (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'))
  with check (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'));

drop policy if exists item_pricing_fin on item_pricing;
create policy item_pricing_fin on item_pricing for all
  using (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'))
  with check (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'));

-- Seed the AXS.LAB example rule (idempotent) so there's a worked example to price against.
insert into pricing_rules (tenant_id, name, customer, model, params)
select '00000000-0000-0000-0000-0000000000ac', 'Axis — standard', 'Axis', 'axs_flat_v1', '{
  "material": { "window_frame_per_m2": 13000, "window_glass_per_m2": 3000, "door_frame_per_unit": 34000, "door_glass_per_unit": 3000 },
  "labour":   { "window_per_unit": 8000, "door_per_unit": 12000 },
  "sale":     { "rate_per_flat": 315900, "rate_per_door": 135000, "rate_per_m2_extra": 32400, "windows_included_per_flat": 5 }
}'::jsonb
where not exists (select 1 from pricing_rules where tenant_id = '00000000-0000-0000-0000-0000000000ac' and name = 'Axis — standard');
