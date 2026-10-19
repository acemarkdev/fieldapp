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
- **acemark_finance** ("Acemark Finance") — office app **Fin&Ops** menu only: company costs synced from the monday invoices board (capability `finops.view`: view + run the sync). Accepting an edited invoice as the new trusted record is `finops.manage` (admin only). **Payroll**: `finops.view` enters the monthly figures and ticks / unticks Actuals. **Sales**: `finops.view` adds, edits and deletes sales invoices; the Excel import is `finops.manage`. **Job costs**: `finops.view` creates and edits jobs and cost lines; locking / unlocking a job, deleting a job, the Excel import and the default labour rate are `finops.manage` (admin only) — a locked job is read-only for everyone. Confined like logistics: the server refuses every non-`/api/finops/` endpoint and `0056_fin_costs.sql` blocks all tables for the role; `fin_costs` / `fin_sync_runs` have RLS on with no policies (server-only).
- **Report confirmations** (Logistics ▸ Confirmations, capability `confirmations.manage`) — logistics and admin. The shared link `/c/<token>` needs no login: the token is the key, the report runs in a sandboxed frame, and `confirmations` has RLS on with no policies (server-only access).
- **sales_rep** ("Sales rep") — office app **Fin&Ops ▸ Sales orders, Commission, Manuals** only, for the rep's own orders (capability `sales.orders`). Confined like logistics: the server refuses every endpoint outside `/api/me`, `/api/finops/orders*`, `/api/finops/commission`, `/api/finops/manuals*`, and `0070_sales_rep_scope.sql` blocks all tables and storage for the role. No access in the mobile app.

- **Cost reports** (`expenses.report`: fitter, surveyor, office, admin) — report an extra installation cost against an accepted sales order (`/api/expenses`); the reporter sees order number + customer and their own reports only. The order's sales rep approves / rejects, finance (or admin) marks paid — `/api/finops/orders/expenses/:id/<approve|reject|pay|unpay>`, rules in `finExpenses.ts` (`expenseStep`). Table `fin_order_expenses` is server-only (0071).

- **acemark_fitter** ("Acemark Fitter") — the office app's **Cost reports** form only (`expenses.report`). Confined like logistics: the server refuses every endpoint outside `/api/me` and `/api/expenses*`, and `0073_acemark_fitter_scope.sql` blocks all tables for the role. No access in the mobile app.

- **Subiekt agent** (no user) — `POST /api/agent/subiekt` with the `x-agent-key` header; the key is created by an admin in Fin&Ops ▸ Sales ▸ Subiekt and only its hash is kept in `server_config`. The agent can do nothing but post a snapshot of Subiekt documents. `fin_subiekt_docs` is server-only (0074). Viewing the to-check list and ticking "not a job" needs `finops.view`; a new key needs `finops.manage`.

- **production** ("Production") — phone app time screen only (`time.log`): reads active `prod_tasks` and its own `time_entries` (RLS), starts/stops through `prod_start` / `prod_stop` (security definer). The office server refuses everything but `/api/me`; `0077_production_time.sql` blocks every other table.
- **production_manager** ("Production manager") — office app Production ▸ Production time (`time.manage`): tasks, entries, worker rates (`worker_rates`, server-only), export; and Production ▸ Cortizo profiles (`stock.view`, read-only). Server allow-list `/api/me`, `/api/production*`, `/api/cortizo/*`; blocked from all tables in the database. Also logs **own time in the phone app** like `production` (`time.log`): `0084_production_manager_phone.sql` lifts the role's block on `app_users`, `prod_tasks` and `time_entries` only.

- **logistics** — office app **Logistics** menu only: **Labels** (Archimede production PDF → A4 sheet of window/door labels) and **Confirmations** (shareable report sign-off links); plus Production ▸ **Cortizo profiles** (`stock.view`, read-only: catalogue references with their Subiekt stock, `/api/cortizo/*`). No jobs, items, finance or anything else — the office server refuses every other endpoint for this role, and `0053_logistics_scope.sql` blocks all tables for it in the database (re-run that file after adding new tables). Admins also have both.

## Language

Each user has an interface language (**Admin ▸ Users ▸ Language**): Default (EN), English or Polski, stored in `app_users.language` (migration `0060_user_language.sql`). Polish currently covers the **Fin&Ops** screens only; everything else is English. Texts are written in English in the office page and swapped for a Polish user as they reach the screen (dictionary `I18N_PL`, patterns `I18N_RX`, marked-up blocks `I18N_HTML` in `apps/api/src/office.ts`) — when adding Fin&Ops text, add its Polish there too. The language is read fault-tolerantly, so a missing column just means English for everyone.

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

**Data scope:** a `fitter` reads only the items assigned to **their own team** (and those items' photos, the jobs holding their work, and their own team row — other teams' rates stay hidden). This is enforced by RLS (`0013`), not just the UI. All other roles see every item in their tenant. The mobile UI additionally shows fitters only the ready-to-fit subset.

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
   - `survey_items`/`item_photos`/`jobs`/`fitter_teams` SELECT for `fitter` restricted to their own team (`0013`, helper `auth_team_id()`; snags inherit the parent's team).

## Action plan

- [x] **A. Capability matrix** in `@ace/shared` + this doc + a read-only **Roles** tab in the office app.
- [x] **D. RLS role policies** — `supabase/migrations/0007_role_access.sql`. Restrictive write policies (AND-ed with the existing tenant policies) so, on the **mobile / direct-Supabase path**: only admin/office create or edit jobs and teams; only admin/office/surveyor/scanner create items; snags may also be raised by fitters; items are edited by admin/office/surveyor/fitter; only admin/office delete items; and a **trigger** limits a fitter's item update to the install status only. The office server uses the service-role key (bypasses RLS) and is gated in the app layer (E).
- [x] **B. Office UI gating** — `applyRole()` hides Dashboard/Teams/Monday-sync tabs and the "+ New item" button by capability; item-row rate/status/team/sync controls render read-only unless the role can edit/fit/sync; a role that can't view the dashboard lands on Items. Client-side `canCap()` reads the injected matrix.
- [x] **C. Mobile UI gating** — `apps/mobile/src/lib/permissions.ts` mirrors the matrix; the app loads the signed-in user's role and hides "+ New job" (unless jobs.manage), hides the survey "+ New" for fitters, filters the item list to ready-to-fit for fitters, and shows the install-status editor only to fitters/office (read-only otherwise).
- [x] **E. Server endpoint checks** — every mutating office API endpoint calls a `can(ctx.role, cap)` guard (create→items.create, edit→items.edit, status→items.fit, snag→snags.raise, sync/board→monday.sync, teams→teams.manage, users→users.manage). Closes the service-role gap: a wrong-role API call is refused, not just hidden in the UI.
- [x] **F. Fitter row-scope** — `supabase/migrations/0013_fitter_row_scope.sql`. Restrictive SELECT policies (AND-ed with the tenant policy) limit a fitter to their own team's items, those items' photos, the jobs holding their work, and their own team row. New `auth_team_id()` helper; snags inherit the parent's team (trigger + mobile sets `team_id`), with a backfill for existing snags.

**D is the real boundary** — it's what actually stops a field user from, say, creating a job by calling Supabase directly. UI gating (B, C) makes it feel right; RLS makes it true.

### Applying migration 0007

Run it once against the Supabase project (SQL editor, or `supabase db push`). It's idempotent (drops each policy/trigger before recreating), so it's safe to re-run. To sanity-check afterwards, sign in on mobile as a `surveyor` and confirm you can add an item but not a job; as a `fitter`, that you can change install status but not the spec.

## Finance / budget module — a separate wall

The budget & customer-pricing module is deliberately isolated so **only `admin` and the `invoice_manager` role** can ever see costs, sale prices or pricing rules — office, surveyor, scanner, fitter and the **entire mobile app** are blind to it.

- **Capabilities.** `finance.view` / `finance.manage` are held only by `admin` and `invoice_manager` (see `permissions.ts`). No other role has them.
- **Data lives in its own tables.** RLS is row-level, not column-level, so a money column on the broadly-readable `survey_items`/`jobs` would leak. All financial data therefore sits in `pricing_rules`, `job_pricing` and `item_pricing` (migration `0017`), each with an RLS policy of `auth_role() in ('admin','invoice_manager')`. The operational tables carry **no** price/cost columns.
- **Three enforcement layers, same as everything else.**
  - *Database (RLS)* — the real boundary; the mobile anon+JWT client and every non-finance role get zero rows.
  - *Server* — every finance endpoint in `office.ts` is guarded by `allow('finance.view' | 'finance.manage')` (the office server uses the service-role key, which bypasses RLS, so this guard is what protects that path).
  - *UI* — the **Budget** tab only renders for `finance.view`; on the New-job form the rule picker only shows for `finance.manage`.

### Verifying the walls hold

- **Automated (run any time):**
  - `npx tsx packages/shared/src/permissions.test.ts` — asserts the finance caps belong to admin/invoice_manager only, and that `invoice_manager` has no operational caps.
  - `npx tsx apps/api/src/financeGuards.test.ts` — static audit: every finance route in `office.ts` has a finance guard, and the mobile app never queries a finance table. (A future refactor that drops a guard fails this.)
- **Database:** run `supabase/tests/finance_rls_check.sql` in the SQL editor — it raises if RLS is off or a policy is missing on any finance table, and prints the policies.
- **Manual:** sign into the office as an `office` user → the **Budget** tab is absent; their token calling `GET /api/pricing-rules` returns `403`.
