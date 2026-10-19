-- ============================================================
--  Fin&Ops ▸ Payroll ◂ the accountant's monthly files (payroll list, ZUS transfer, PIT-4 transfer).
--    fin_payroll_people  every person from a loaded payroll list and their group:
--                        Office / Sales / Production / Other (Other = cost recharged elsewhere, left out of Payroll)
--    fin_payroll_loads   one row per loaded month: the people (name, group, gross, net), the totals,
--                        ZUS and PIT-4, and the split per group — what the Payroll month was built from
--    fin_payroll         + lump / lump_note: a lump sum on top of a department's salaries (no tax on it)
--                        + source = 'files' when the month comes from the files (then it is not typed by hand)
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_payroll_people (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name_key    text not null,                 -- the name in capitals, single spaces
  name        text not null,
  grp         text not null check (grp in ('Office','Sales','Production','Other')),
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, name_key)
);
alter table fin_payroll_people enable row level security;
drop policy if exists server_only on fin_payroll_people;
create policy server_only on fin_payroll_people for all to anon, authenticated using (false) with check (false);

create table if not exists fin_payroll_loads (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  period_year  int not null,
  period_month int not null check (period_month between 1 and 12),
  pay_date     date,
  people       jsonb not null default '[]',   -- [{ name, key, group, gross, net }]
  gross        numeric(14,2),
  net          numeric(14,2),
  zus          numeric(14,2),
  pit          numeric(14,2),
  split        jsonb not null default '{}',   -- { Office: { people, gross, net, taxes }, … Other }
  files        jsonb not null default '[]',   -- [{ kind, name }]
  loaded_by    text,
  loaded_at    timestamptz not null default now(),
  primary key (tenant_id, period_year, period_month)
);
alter table fin_payroll_loads enable row level security;
drop policy if exists server_only on fin_payroll_loads;
create policy server_only on fin_payroll_loads for all to anon, authenticated using (false) with check (false);

alter table fin_payroll add column if not exists lump numeric(14,2),
                        add column if not exists lump_note text,
                        add column if not exists source text;
