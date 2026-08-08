# ACE Field App — Roadmap / Pipeline

A running backlog. Append as we go.

## Done
- Multi-tenant Supabase schema + RLS (ACE = tenant #1)
- Shared domain logic (code assembly, ranking, fitting rate) with tests
- Sync API → Monday: match-by-title, idempotent create/update
- Supabase → Monday promote loop (canonical store is the source of truth)
- Fitter team → Monday Fitters column; fitting rate → Labour Cost (default + per-item override)
- Snags as duplicate Monday items (Install Status = Snag, no Labour Cost, name + comment)
- Snag / after-install photos → Supabase Storage → Monday file columns (Design Sketch, Picture After)
- Install / completion flow (Install Status, Actual Install Date, after-photo)
- Store report CLI; seed + batch-promote
- Live read-only web dashboard
- **Office web app — Stage 1**: Supabase-Auth login, view jobs/items, edit rate/status/team, Sync-to-Monday
- **Office web app — Stage 2**: teams & rates management (admin-gated CRUD); Monday-sync tab (link a job to its board from the UI, per-job synced/unsynced counts, batch Sync-all)
- **Office web app — Stage 3a**: create new survey items from the desk (assembles the full code, inserts as 'surveyed'); item detail drawer (all fields + photos via signed URLs)
- **Office web app — bulk select**: row checkboxes + select-all header; bulk bar to Sync selected, assign team, or set install status across many items (tenant-guarded)
- **Monday links**: store per-job account slug so item links resolve to the right account; robust board-id parsing from a pasted board URL

## Next (near-term)
- **Office web app — Stage 3b**: raise/log snags from the desk (reuse the duplicate-item snag flow); user management (invite/deactivate, set roles)
- **SSO login (Microsoft / Entra)** — Stage 2+. Foundation already in place (Supabase Auth). OAuth is free-tier; SAML is paid/enterprise. Microsoft is the natural fit (ACE/Axis are Microsoft 365). ~session-sized: provider config + a "Sign in with Microsoft" button; app_users linking by email is unchanged.
- **Mobile app (Expo)**: the field front door — scan → survey → fit — items originate on a device, testable via Expo Go.

## Later
- **Photo segment recognition** (Phase 3+) — auto-detect window segments to pre-fill the config picker. Spec: `docs/window-segment-recognition.md`. Its training data is the survey photos we're already capturing.
- **Monday → Supabase read-only pull** — only if field teams need to see office-owned data (PO status, dates, costs). Deliberately deferred; decision recorded: app owns field data one-way to Monday.
- **Axis Dynamics 365 integration** — bookings in, completions/SOR/payment out. Gated on Axis granting Dataverse API access. See the confidential strategy doc.
- **Supply-chain connectors** — push a surveyed item to Clearview (and others) to quote → order.
- **Commercialisation machinery** — billing (Stripe), self-serve onboarding, vendor admin, marketplace — when customer #2 is real.

## Decisions on record
- Supabase is the canonical store; Monday is a one-way output. Field data is created/edited only in the app.
- Field-level ownership: the app owns survey/install/snag fields; the office owns commercial fields in Monday.
- Monday column matching is by **title**, never hard-coded id (survives board duplication).
- Money stored as integer pennies. Secrets (service key, Monday token) are server-side only.
