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
- **Office web app — user management**: admin-only Users tab — invite (create app_users row + Supabase login), set role, activate/deactivate, reset password; self-lockout guards
- **Office web app — snags from the desk**: raise a snag from the item detail drawer (comment + optional labour cost + team + photo)
- **Live wallboard** (`/live`): standalone dark, auto-refreshing (30s) status page, key-gated via `LIVE_KEY`, pinnable as a browser tab; shares the dashboard figures. (A Monday-backed Cowork artifact version is still an option for remote/pin-in-Claude viewing.)
- **Microsoft SSO**: optional "Sign in with Microsoft" on the office login (Supabase Azure OAuth, implicit flow, no browser deps), gated by `AZURE_SSO_ENABLED`; server links the identity to `app_users` by email. Setup: `docs/sso-setup.md`.
- **Versioning**: `APP_VERSION` + `CHANGELOG` in `packages/shared/src/version.ts` and `CHANGELOG.md`; office header shows a version chip that opens a "What's new" list. Current: **v0.5.0**.
- **Snags are first-class items** (`survey_items.kind='snag'`, `parent_item_id`, `-S<n>` code): a snag carries its own labour cost + fitter team, appears in the items list with a SNAG badge, and syncs to Monday through the normal promote path (Install Status = Snag, its own Labour Cost/Fitters, photo → Design Sketch). The mobile app will use the same model.

## Next (near-term)
- **SSO login (Microsoft / Entra)** — Stage 2+. Foundation already in place (Supabase Auth). OAuth is free-tier; SAML is paid/enterprise. Microsoft is the natural fit (ACE/Axis are Microsoft 365). ~session-sized: provider config + a "Sign in with Microsoft" button; app_users linking by email is unchanged.
- **Mobile app (Expo)** — *v0.2.0, running on device (SDK 54)*: `apps/mobile` in Expo Go — sign in (Supabase Auth, session persists), jobs list, per-job items list, and an **item detail** screen where a fitter taps to set **install status** (writes back to Supabase, stamps the install date). Reads/writes Supabase directly with the anon key; RLS scopes to the user's tenant. Next: the **scan → survey → fit** capture flow (items originate on device), photos, offline queue.

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
- A snag is a first-class item (own labour cost + team + lifecycle), not a child record — matching how Monday already models it as a peer item. The legacy `snags` table + `syncSnagsForItem` (duplicate-item approach) are superseded by this and remain only for the old CLI demos.
