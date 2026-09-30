-- ============================================================
--  Report confirmations (office ▸ Operations ▸ Confirmations).
--  An interactive "raport do potwierdzenia" HTML is uploaded by office staff and shared as a
--  secret link (/c/<token>). The recipient's decisions + signature are saved in `state`;
--  "Approve" locks it. The HTML file itself lives in the private `confirmations` storage bucket.
--  Access is only via the office server (service-role key): RLS is ON with no policies, so
--  no client token can read or write this table directly.
-- ============================================================
create table if not exists confirmations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  token            text not null unique,              -- secret link id (unguessable)
  title            text not null,
  file_name        text,
  storage_path     text not null,
  filled_path      text,                              -- snapshot of the page as filled in, captured on Approve
  meta             jsonb not null default '{}',       -- items / titles / questions read from the report
  state            jsonb,                             -- recipient's decisions, answers, signature
  status           text not null default 'pending' check (status in ('pending','approved')),
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz,                       -- last save by the recipient
  approved_at      timestamptz,
  approved_by_name text,
  approved_by_role text
);
create index if not exists confirmations_tenant_idx on confirmations(tenant_id, created_at desc);
alter table confirmations enable row level security;
