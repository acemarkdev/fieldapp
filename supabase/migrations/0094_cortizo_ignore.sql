-- Production ▸ Cortizo profiles: Subiekt symbols marked "Not Cortizo" (other brands bought through Cortizo,
-- paint, flat bars…). They no longer show in "Subiekt symbols with no reference". A pattern is a whole
-- symbol ("A.7016 CM") or its beginning followed by * ("GN*", "FAZE*"), stored upper case.
create table if not exists cortizo_ignore (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  pattern     text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, pattern)
);
alter table cortizo_ignore enable row level security;
drop policy if exists server_only on cortizo_ignore;
create policy server_only on cortizo_ignore for all to anon, authenticated using (false) with check (false);
