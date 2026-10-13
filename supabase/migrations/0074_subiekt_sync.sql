-- ============================================================
--  Subiekt nexo → office app. A small agent on the Subiekt machine sends this year's sales
--  invoices (FS, FL and their corrections) and material issues (RW); they are kept here as
--  received, and the Sales tab and Job costs are filled from them.
--    fin_subiekt_docs  one row per Subiekt document (doc_id = its Id in Subiekt)
--    fin_sales / fin_job_items get "source" columns: a row that came from Subiekt is
--    recognised by them, is not edited by hand, and is updated on every sync.
--  Server-only access (service-role key): RLS is ON; the only policy says "nobody" for client keys.
-- ============================================================
create table if not exists fin_subiekt_docs (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  doc_id       bigint not null,
  symbol       text not null,                      -- FS, FL, KFS, KFL, RW
  number       text,                               -- "FL 26/ACE/07/2026"
  issued       date,
  sold         date,
  net          numeric(14,2) not null default 0,   -- in the document's currency
  gross        numeric(14,2),
  currency     text,
  rate         numeric(14,6),                      -- PLN per `units` of the currency (null for PLN)
  units        int,
  subtitle     text,                               -- Podtytuł: where the job number is written
  notes        text,                               -- Uwagi
  flag         int,                                -- advance invoice: 2 = advance, 3 = closing advance
  corrects     bigint,                             -- the document a correction refers to
  customer     text,
  country      text,
  not_job      boolean not null default false,     -- ticked in the app: "belongs to no job", stops the reminder
  not_job_by   text,
  synced_at    timestamptz not null default now(),
  primary key (tenant_id, doc_id)
);
alter table fin_subiekt_docs enable row level security;
drop policy if exists server_only on fin_subiekt_docs;
create policy server_only on fin_subiekt_docs for all to anon, authenticated using (false) with check (false);

alter table fin_sales     add column if not exists source text, add column if not exists source_id bigint, add column if not exists needs_check text;
alter table fin_job_items add column if not exists source text, add column if not exists source_id bigint;
create unique index if not exists fin_sales_source_idx     on fin_sales(tenant_id, source, source_id) where source is not null;
create unique index if not exists fin_job_items_source_idx on fin_job_items(tenant_id, source, source_id) where source is not null;
