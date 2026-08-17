# Roles & Access Control

**Source of truth:** `packages/shared/src/permissions.ts` (the capability matrix).
**Assign roles:** office app → **Users** tab (admin only).
**See the matrix:** office app → **Roles** tab (read-only).

## Roles

`admin` · `office` · `surveyor` · `scanner` · `fitter`

- **admin** — unlimited access to everything.
- **office** — back-office: dashboard, jobs, items, teams/rates, Monday sync. Not user management.
- **surveyor** — field: create & edit items, raise snags, add photos. Cannot add jobs.
- **scanner** — field: create items (scan) + photos only.
- **fitter** — field: fit items (set install status), raise snags, add photos. Sees **only items ready to fit**.

## Capability matrix

| Capability | admin | office | surveyor | scanner | fitter |
|---|:--:|:--:|:--:|:--:|:--:|
| View dashboard | ✓ | ✓ | – | – | – |
| Manage jobs (create/edit) | ✓ | ✓ | – | – | – |
| Create items (survey) | ✓ | ✓ | ✓ | ✓ | – |
| Edit items | ✓ | ✓ | ✓ | – | – |
| Fit items (install status) | ✓ | ✓ | – | – | ✓ |
| Raise snags | ✓ | ✓ | ✓ | – | ✓ |
| Add photos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage teams & rates | ✓ | ✓ | – | – | – |
| Sync to Monday | ✓ | ✓ | – | – | – |
| Manage users | ✓ | – | – | – | – |

**Data scope:** `fitter` sees only items with an install status (ready to fit); all other roles see every item in their tenant.

To change access, edit `ROLE_CAPS` in `permissions.ts` **and** mirror the change in the RLS migration (below). Keep them in step.

## Enforcement — three layers (defence in depth)

The mobile app talks to Supabase **directly** with the anon key, so **UI checks are not security** — the database is the real boundary.

1. **UI (office + mobile).** Hide/disable actions the role lacks (`can(role, cap)`). Good UX; not a security control.
2. **Server (office API).** Each mutating endpoint checks `ctx.role` against the matrix. Belt-and-braces for office traffic.
3. **Database (RLS) — the real boundary.** Role-based policies using `auth_role()`:
   - `jobs` insert/update → `office`/`admin` only.
   - `survey_items` insert → `surveyor`/`scanner`/`office`/`admin`; update → depends (fit vs edit).
   - `item_photos` insert → any active member.
   - `fitter_teams` write → `office`/`admin`.
   - `app_users` write → `admin` (already).
   - (Later) `survey_items` SELECT for `fitter` restricted to ready-to-fit rows.

## Action plan

- [x] **A. Capability matrix** in `@ace/shared` + this doc + a read-only **Roles** tab in the office app.
- [x] **D. RLS role policies** — `supabase/migrations/0007_role_access.sql`. Restrictive write policies (AND-ed with the existing tenant policies) so, on the **mobile / direct-Supabase path**: only admin/office create or edit jobs and teams; only admin/office/surveyor/scanner create items; snags may also be raised by fitters; items are edited by admin/office/surveyor/fitter; only admin/office delete items; and a **trigger** limits a fitter's item update to the install status only. The office server uses the service-role key (bypasses RLS) and is gated in the app layer (E).
- [x] **B. Office UI gating** — `applyRole()` hides Dashboard/Teams/Monday-sync tabs and the "+ New item" button by capability; item-row rate/status/team/sync controls render read-only unless the role can edit/fit/sync; a role that can't view the dashboard lands on Items. Client-side `canCap()` reads the injected matrix.
- [x] **C. Mobile UI gating** — `apps/mobile/src/lib/permissions.ts` mirrors the matrix; the app loads the signed-in user's role and hides "+ New job" (unless jobs.manage), hides the survey "+ New" for fitters, filters the item list to ready-to-fit for fitters, and shows the install-status editor only to fitters/office (read-only otherwise).
- [x] **E. Server endpoint checks** — every mutating office API endpoint calls a `can(ctx.role, cap)` guard (create→items.create, edit→items.edit, status→items.fit, snag→snags.raise, sync/board→monday.sync, teams→teams.manage, users→users.manage). Closes the service-role gap: a wrong-role API call is refused, not just hidden in the UI.
- [ ] **F. (Optional) fitter row-scope** — RLS SELECT policy limiting fitters to ready-to-fit items.

**D is the real boundary** — it's what actually stops a field user from, say, creating a job by calling Supabase directly. UI gating (B, C) makes it feel right; RLS makes it true.

### Applying migration 0007

Run it once against the Supabase project (SQL editor, or `supabase db push`). It's idempotent (drops each policy/trigger before recreating), so it's safe to re-run. To sanity-check afterwards, sign in on mobile as a `surveyor` and confirm you can add an item but not a job; as a `fitter`, that you can change install status but not the spec.
