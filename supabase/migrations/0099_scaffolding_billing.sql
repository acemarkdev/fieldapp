-- ============================================================
--  ACE Scaffolding — phase 3: hire and invoicing (requests for invoice to the accounts team, raised in Xero).
--  Rules agreed 2026-10-22:
--    · hire starts at the handover; the price covers the included weeks; after them rent runs per day
--      (weekly rate × days / 7) up to the day the hire stops — the dismantle day the team confirms
--      (scaf_scaffolds.hire_stop_on; it starts as the down date and can be changed);
--    · each job is billed weekly or monthly (scaf_jobs.billing);
--    · retention and payment terms are set on the customer and copied to each request (changeable there);
--    · stages of the price are raised by hand (amount or % of the price) — no fixed schedule yet;
--    · CIS / VAT reverse charge: a note on each request until the accountant confirms the rules.
--    scaf_invoice_requests  one request: rent for a period, a stage of the price, or anything else; draft → sent to
--                           accounts → invoiced (Xero number) → paid; or cancelled
--    scaf_invoice_lines     its lines; a rent line names its scaffold and the days it covers. Sending a request moves
--                           those scaffolds' billed_to on, so the same days are never billed twice.
-- ============================================================
alter table scaf_scaffolds add column if not exists hire_stop_on date;
alter table scaf_scaffolds add column if not exists billed_to date;
alter table scaf_jobs add column if not exists billing text not null default 'monthly';
alter table scaf_customers add column if not exists retention_pct numeric(5,2);
alter table scaf_customers add column if not exists payment_days integer;

create table if not exists scaf_invoice_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_id        uuid not null references scaf_jobs(id) on delete cascade,
  seq           integer not null,                        -- per job: ACESC2555-R3
  kind          text not null default 'rent' check (kind in ('rent', 'price', 'other')),
  period_from   date, period_to date,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'invoiced', 'paid', 'cancelled')),
  retention_pct numeric(5,2), payment_days integer,
  po_number     text, vat_note text, notes text,
  xero_number   text, invoiced_on date, paid_on date, sent_on date,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz not null default now(),
  unique (job_id, seq)
);
create index if not exists scaf_invoice_requests_status on scaf_invoice_requests(tenant_id, status);

create table if not exists scaf_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  request_id   uuid not null references scaf_invoice_requests(id) on delete cascade,
  position     integer not null default 0,
  scaffold_id  uuid references scaf_scaffolds(id) on delete set null,
  description  text,
  period_from  date, period_to date,
  days         numeric(8,2),
  weekly       numeric(12,2),
  amount       numeric(12,2) not null default 0,
  labour       numeric(12,2)
);
create index if not exists scaf_invoice_lines_request on scaf_invoice_lines(request_id);
create index if not exists scaf_invoice_lines_scaffold on scaf_invoice_lines(scaffold_id);

do $$
declare t text;
begin
  foreach t in array array['scaf_invoice_requests', 'scaf_invoice_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists server_only on %I', t);
    execute format('create policy server_only on %I for all to anon, authenticated using (false) with check (false)', t);
    execute format('drop policy if exists %I on %I', left(t, 40) || '_block_scaffolding', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using (auth_role() is distinct from %L) with check (auth_role() is distinct from %L)', left(t, 40) || '_block_scaffolding', t, 'scaffolding', 'scaffolding');
  end loop;
end $$;
