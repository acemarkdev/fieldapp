-- ============================================================
--  ACE Scaffolding — phase 1: the enquiry pipeline and quotes.
--    scaf_enquiries   + follow-up (next action date and note), loss reason, description of the work
--    scaf_quotes      quote revisions of an enquiry (ACE4022 v1, v2…): draft → sent → accepted / declined;
--                     a newer sent revision supersedes the older one
--    scaf_quote_lines the priced elements: element type, description, price (erect + dismantle + the
--                     included hire weeks), the labour part of it (CIS / VAT reverse charge), estimated costs
--                     up / down, then the weekly rent (% of the price, or a fixed £ a week)
--    scaf_jobs        + the accepted quote it was made from
--  Server-only access, like the other scaf_ tables.
-- ============================================================
alter table scaf_enquiries add column if not exists next_action date;
alter table scaf_enquiries add column if not exists next_action_note text;
alter table scaf_enquiries add column if not exists loss_reason text;
alter table scaf_enquiries add column if not exists description text;
create index if not exists scaf_enquiries_next on scaf_enquiries(tenant_id, next_action) where next_action is not null;

create table if not exists scaf_quotes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  enquiry_id   uuid not null references scaf_enquiries(id) on delete cascade,
  revision     integer not null,
  status       text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'superseded')),
  intro        text,
  terms        text,
  valid_days   integer not null default 30,
  sent_at      date, decided_at date,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz not null default now(),
  unique (enquiry_id, revision)
);
create index if not exists scaf_quotes_enquiry on scaf_quotes(enquiry_id);

create table if not exists scaf_quote_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  quote_id       uuid not null references scaf_quotes(id) on delete cascade,
  position       integer not null default 0,
  element        text,
  description    text,
  price          numeric(12,2) not null default 0,
  labour         numeric(12,2),
  est_cost_up    numeric(12,2),
  est_cost_down  numeric(12,2),
  hire_weeks     numeric(6,2),
  rent_pct       numeric(6,2),
  rent_weekly    numeric(12,2)
);
create index if not exists scaf_quote_lines_quote on scaf_quote_lines(quote_id);

alter table scaf_jobs add column if not exists quote_id uuid references scaf_quotes(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['scaf_quotes', 'scaf_quote_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists server_only on %I', t);
    execute format('create policy server_only on %I for all to anon, authenticated using (false) with check (false)', t);
    execute format('drop policy if exists %I on %I', left(t, 40) || '_block_scaffolding', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', left(t, 40) || '_block_scaffolding', t, 'scaffolding', 'scaffolding');
  end loop;
end $$;
