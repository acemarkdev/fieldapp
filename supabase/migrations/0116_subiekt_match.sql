-- ============================================================
--  Subiekt ▸ match in the app: a document without a number in Subiekt can be placed from the office app.
--   • assigned_ref    — the Z job or order code chosen in the app (the Podtytuł in Subiekt still wins when it has a number).
--   • not_job_reason  — why a document belongs to no job: overhead (trials, scrap, warranty, shipment…) or other income.
--   • assigned_by     — who placed it.
--  not_job (0074) now also applies to material issues (RW): "overhead, not a job".
-- ============================================================
alter table fin_subiekt_docs add column if not exists assigned_ref text;
alter table fin_subiekt_docs add column if not exists not_job_reason text;
alter table fin_subiekt_docs add column if not exists assigned_by text;
