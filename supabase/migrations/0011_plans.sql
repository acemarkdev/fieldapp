-- Plan view with item pins: a job can have one or more plan images (floor plans /
-- elevations), and each survey item can be pinned to an (x,y) on one of them.
-- Coordinates are normalised 0..1 so they survive any display size.

create table if not exists job_plans (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  name         text not null,                 -- e.g. "Ground floor", "Elevation E1"
  storage_path text not null,                 -- object in the 'plans' bucket
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists job_plans_job_idx on job_plans(job_id);

alter table survey_items add column if not exists plan_id uuid references job_plans(id) on delete set null;
alter table survey_items add column if not exists plan_x real;   -- 0..1 across the plan
alter table survey_items add column if not exists plan_y real;   -- 0..1 down the plan
create index if not exists survey_items_plan_idx on survey_items(plan_id);

-- RLS: read within tenant; plan CRUD is a manager action (admin/office).
alter table job_plans enable row level security;
drop policy if exists tenant_rw on job_plans;
create policy tenant_rw on job_plans using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());
drop policy if exists plans_ins_role on job_plans;
drop policy if exists plans_upd_role on job_plans;
drop policy if exists plans_del_role on job_plans;
create policy plans_ins_role on job_plans as restrictive for insert with check (auth_role() in ('admin','office'));
create policy plans_upd_role on job_plans as restrictive for update using (auth_role() in ('admin','office')) with check (auth_role() in ('admin','office'));
create policy plans_del_role on job_plans as restrictive for delete using (auth_role() in ('admin','office'));

-- Storage bucket for plan images (private; tenant-scoped like photos, path = <tenant_id>/...).
insert into storage.buckets (id, name, public) values ('plans', 'plans', false)
on conflict (id) do nothing;

drop policy if exists plans_tenant_read   on storage.objects;
drop policy if exists plans_tenant_insert on storage.objects;
drop policy if exists plans_tenant_update on storage.objects;
drop policy if exists plans_tenant_delete on storage.objects;
create policy plans_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text);
create policy plans_tenant_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text);
create policy plans_tenant_update on storage.objects for update to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text);
create policy plans_tenant_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth_tenant_id()::text);
