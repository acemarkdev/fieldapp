-- ============================================================
--  Client invoicing — STRICTLY admin / invoice_manager only.
--
--  An invoice is a finance-only record raised against a job. It captures an
--  immutable SNAPSHOT of the customer price breakdown (the JobBreak from the
--  pricing engine) at the moment it is issued, so the invoice never changes
--  even if the job's items are later edited. VAT is added on top of the
--  snapshot's sale total. Paid/unpaid state is tracked here.
--
--  Like the rest of the budget module, this table is readable ONLY by
--  admin / invoice_manager (RLS), so office / field / mobile never see it.
--  Money is stored in INTEGER pennies.
-- ============================================================

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  job_id        uuid not null references jobs(id) on delete cascade,
  number        text not null,                              -- e.g. INV-0001 (unique per tenant)
  status        text not null default 'draft'
                  check (status in ('draft','sent','paid','void')),
  -- Snapshot of the priced breakdown + context at issue time (JobBreak + job/customer/rule).
  snapshot      jsonb not null default '{}'::jsonb,
  customer      text,                                       -- bill-to name (from the rule)
  bill_to       text,                                       -- free-text billing address block
  subtotal_pennies integer not null default 0,              -- sale total (ex-VAT)
  vat_rate      numeric(5,2) not null default 20,           -- % VAT applied
  vat_pennies   integer not null default 0,
  total_pennies integer not null default 0,                 -- subtotal + VAT
  issue_date    date not null default current_date,
  due_date      date,
  notes         text,
  paid_at       timestamptz,
  paid_ref      text,                                       -- payment reference / method
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, number)
);
create index on invoices(tenant_id);
create index on invoices(job_id);
create index on invoices(tenant_id, status);

-- ---------- RLS: only admin / invoice_manager, within their tenant ----------
alter table invoices enable row level security;

drop policy if exists invoices_fin on invoices;
create policy invoices_fin on invoices for all
  using (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'))
  with check (tenant_id = auth_tenant_id() and auth_role() in ('admin','invoice_manager'));
