-- ============================================================
--  PO requests: record who approved/rejected, when, and why.
--  A rejection must carry a comment (enforced by the office API);
--  it is shown on the request and sent to the requestor.
-- ============================================================
alter table po_requests add column if not exists decision_comment text;
alter table po_requests add column if not exists decided_by_name  text;
alter table po_requests add column if not exists decided_at       timestamptz;
