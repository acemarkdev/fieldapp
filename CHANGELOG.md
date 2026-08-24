# Changelog

App version lives in `packages/shared/src/version.ts` (`APP_VERSION` + `CHANGELOG`).
The office web app shows it as a chip in the header (click it for "What's new").
Bump the version and add an entry here **and** in `version.ts` on every change.
Versioning: MAJOR.MINOR.PATCH — MINOR for features, PATCH for fixes/tweaks.

## 0.27.0 — 2026-08-24
- **Fitter data scope (database-enforced).** A fitter now only **reads the items assigned to their own team** — plus those items’ photos, the jobs that hold their work, and their own team row (other teams’ fitting rates stay hidden). This is enforced by **Row-Level Security** (restrictive SELECT policies + a new `auth_team_id()` helper), so the boundary holds even outside the app, not just in the UI. **Snags inherit their parent item’s team** (new trigger + the mobile app sets `team_id` on the snag), so fitters keep seeing snags on their own items; existing snags are backfilled. Admin/office/surveyor/scanner are unchanged, and the office server (service-role key) bypasses RLS as before. **Requires migration `0013_fitter_row_scope.sql`.**

## 0.26.2 — 2026-08-24
- Plan **Unplaced** filter fix, follow-up (office + mobile): **Unplaced** now always means **not pinned on any plan for the site**, in both single- and multi-plan modes. It no longer lists items that are placed on another plan.

## 0.26.1 — 2026-08-24
- Plan **Unplaced** filter fix (office + mobile): it now shows only items **not pinned on any plan**, instead of also listing items placed on another plan. (In multi-plan mode it still means “not on this plan.”)

## 0.26.0 — 2026-08-24
- **One plan per item (configurable).** By default an item can be pinned to **only one plan**: on other plans it shows as **“on <plan name>”** and isn’t offered for placing (unpin it there first to move it). A new **Plans setting — “Item can be on multiple plans”** (admin/office toggle in the office Plans tab) relaxes this for cases like plan versions. Enforced in the office UI, the mobile app, and the server (`PUT /api/item/:id/pin` returns 409 on a cross-plan re-pin when multi-plan is off). **Requires migration `0012_pins_multi_plan.sql`** (adds `tenants.pins_multi_plan`).

## 0.25.2 — 2026-08-24
- Plan navigation (mobile): opening an item from a **plan pin** now returns to the **plan** when you tap Back (and Back again goes to Items), instead of dropping straight to the items list. Items opened from the list still go back to the list.

## 0.25.1 — 2026-08-17
- Plan screen (mobile): **pull-to-refresh**. Pins placed/moved in the office web app now update on the phone with a pull-down, instead of only after leaving and re-opening the screen.

## 0.25.0 — 2026-08-17
- **Plan view on the phone (plan feature complete).** A new **Plan** button on the mobile items screen opens the job's floor plan (from Supabase, signed URL) with the item **pins** overlaid, colour-coded by install status. **Tap a pin to open its item.** Surveyors/office can **drop or move a pin** (tap an item in the list, then tap the plan) and **unpin**; fitters/scanners see it read-only. Plan selector for jobs with several plans, and a **placed / unplaced** filter. So the office uploads the plan and pins from the desk, and the field sees/updates it on site.

## 0.24.1 — 2026-08-17
- Fix: `apps/mobile/package.json` now lists the native modules the app depends on — **react-native-safe-area-context**, **expo-web-browser**, **expo-auth-session**, **expo-crypto**. They'd been added via `expo install` in earlier sessions but never declared, so unzipping a fresh build reverted package.json and dropped them (Metro: *Unable to resolve "react-native-safe-area-context"*). After unzipping, run `npx expo install react-native-safe-area-context expo-web-browser expo-auth-session expo-crypto` from `apps/mobile` to install them at the SDK-54 versions.

## 0.24.0 — 2026-08-17
- **Raise a snag on the phone.** The item detail screen now has a **Raise a snag** button (for surveyors, fitters and office — not scanners). Enter a description + optional photos, and it creates a **snag item** in Supabase against the parent: `kind='snag'`, a `-S<n>` code, install status **Snag**, copying the parent's location/spec — exactly the model the office uses. The office can then schedule it and it flows to Monday on sync (photo → Design Sketch). Online action, with a clear offline message. No migration.

## 0.23.2 — 2026-08-17
- Plans polish: the items side-panel is wider and long full-codes now wrap cleanly, so the **place ›** / **unpin** action isn't cut off; removed the stray horizontal scrollbar.

## 0.23.1 — 2026-08-17
- Fix: placing an item pin returned **"invalid input syntax for type uuid"**. The existing `PUT /api/item/:id` route matched `/api/item/:id/pin` first and used `"pin"` as the id. It now excludes the `/pin` path, so the pin endpoint handles it. (No migration; office server restart only.)

## 0.23.0 — 2026-08-17
- **Plan view with item pins (office).** New **Plans** tab in the office web app. Upload a **floor plan / elevation image** per job (stored in a tenant-scoped `plans` bucket), then **pin each item to its location** — click an item in the side list, then click the spot on the plan. Pins are **colour-coded by install status**, and clicking a pin opens the item detail. Switch between multiple plans per job, filter the item list by **placed / unplaced**, and unpin. Manager-gated: upload/delete plans = admin/office; placing pins = items.edit. **Requires migration `0011_plans.sql`** (adds `job_plans`, `survey_items.plan_id/plan_x/plan_y`, and the `plans` storage bucket + RLS). Next: the phone plan viewer (tap a pin on site → open the item; drop a pin during survey).

## 0.22.0 — 2026-08-17
- **Style picker filters by size.** Imported the *Window Types (Clearview WD)* sheet — 505 styles with **Product Type / Wide / High / Opening / Fixed** — into `src/lib/styleMeta.ts`. The **Choose style** picker now has **Wide (1–6)** and **High (1–3)** selectors plus a **Type** toggle (All / Window / Door / Tilt & Turn), alongside the existing code search and **MOST USED HERE** ranking. Each tile shows its `wide×high` and opening count; picking a style also **auto-fills the item's window type** from the catalogue. (All 391 bundled sketches matched a metadata row.)

## 0.21.0 — 2026-08-17
- **Full Clearview sketch catalogue in the picker.** All **391 real style sketches** (keyed by design code, e.g. `27`, `129B`, `303`) are bundled into the app (`apps/mobile/assets/styles/`, mapped in `src/lib/styleAssets.ts`) and shown in the **Choose style** picker as image tiles — **fully offline**. **Search by code** and a **MOST USED HERE** ranking (from `pick_events`, weighted to the current room) surface the common styles. Selecting sets the item's **design code**; the chosen sketch appears on the survey form and in item detail. Replaces the earlier hand-drawn SVG set. (Adds ~2 MB to the bundle; `react-native-svg` is no longer required.)

## 0.20.0 — 2026-08-17
- **Visual style picker (mobile) — the config “pick screen” from the concept model.** The survey form's **Choose type…** button opens a full-screen picker with **sketched layouts** drawn as SVG (frame + mullions/transoms + opening indicators). Toggles for **Window / Door / Tilt & turn** and **1 / 2 / 3+ lights**, and a **“MOST USED HERE”** grid **auto-ranked by pick frequency** — learned from the `pick_events` table and weighted toward the current room. Selecting a style sets the item's **window type** and **design code** (Clearview style number, e.g. “Style 24”), records a pick event so the ranking improves, and remembers the last pick for a **“Same as last item”** shortcut. Catalogue lives in `src/lib/windowStyles.ts` (easy to extend). `design_code` now also maps to a Monday **Design Code** column if present.
- **Install once:** `npx expo install react-native-svg` (bundled in Expo Go).

## 0.19.0 — 2026-08-17
- **Fuller survey spec (mobile).** The survey form now captures the full demo field set: **Window type** (Casement / Tilt & Turn / Sliding Sash / … picker + custom), **Safety glass**, **Cill depth**, **Transoms ×1–3** (mm from top), **Mullions ×1–3** (mm from left), **Open in/out**, **Coupled**, and **Add-ons** — alongside material, glazing, glass, width/height. All shown in the mobile item detail too.
- **Scanner "one hands" mode.** The scan screen has an on-screen **Add full details now** toggle. Off = quick location-only scan (stage `scanned`, with Save & scan next). On = the full survey form, saved as `surveyed` — for when the same person scans and surveys in one pass. No admin setup; each user flips it per session.
- **New field:** `survey_items.window_type` (**migration 0010**), mapped to a Monday **Window Type** column if the board has one. Apply `0010_window_type.sql` in Supabase.

## 0.18.1 — 2026-08-17
- Mobile: replaced React Native's deprecated built-in `SafeAreaView` with `react-native-safe-area-context` (wrapped the app in `SafeAreaProvider`), clearing the deprecation warning and improving notch/home-indicator insets. **Install once:** `npx expo install react-native-safe-area-context`.

## 0.18.0 — 2026-08-17
- **Surveyor adds the spec on the phone (two-pass flow completed).** Opening an item now shows an **Add survey details** button for surveyors/office; it reopens the item in the full survey form pre-filled with its location, where you set material, glazing, glass, sizes and team. **Save details** updates the item (direct DB update, online) and moves it to stage **surveyed**. So: scanner creates the skeleton → surveyor fills the spec → office syncs to Monday.
- **Clearer item tags.** The mobile item list now shows **on Monday** (green) vs **saved · not on Monday** (grey), replacing the ambiguous "local"/"synced". "local" wrongly implied device-only — once an item is saved it's in the database and visible to anyone on any device; the grey tag only means it hasn't been pushed to Monday yet.

## 0.17.0 — 2026-08-17
- **Scanner mode (mobile).** When a **scanner** adds an item, the form is now a streamlined **Scan item**: location/identity only (block, elevation, flat, room, item, floor + optional photo), saved at stage `scanned` with the spec left blank for the surveyor. A **Save & scan next** button keeps the location and increments the item number so a scanner can rattle through many items quickly. Surveyors/office still see the full survey form (with material/glass/sizes/team). The items-list button reads **+ Scan** for scanners. Next step: surveyor adds the spec to an existing scanned item on the phone.

## 0.16.1 — 2026-08-17
- Fix: fitter couldn't mark an item **Installed** — the save failed with "fitters may only update the install status, not the item specification". Marking Installed also stamps `actual_install_date`, which the fitter-guard trigger from 0007 didn't allow. **Migration 0009** whitelists `actual_install_date` (and `after_photo_path`) so a fitter can complete an install. Apply `0009_fitter_guard_install_date.sql` in Supabase.

## 0.16.0 — 2026-08-17
- Fitter team view (mobile) + team pull-back from Monday.
  - Office **Users** tab has a new **Team** column — assign each fitter login to one team (migration 0008 adds `app_users.team_id`).
  - Office **Sync** tab has a new **Pull fitters** button per job: reads the Monday **Fitters** column for every synced item and sets that item's team in the app, matching by team name. Monday stays the master for scheduling; this is a one-way read-back that doesn't re-flag items for re-sync.
  - Mobile: a **fitter** now sees only their **team's** ready-to-fit items (was: all ready-to-fit). If they have no team yet, a clear notice tells them to ask the office.

## 0.15.0 — 2026-08-17
- Role checks in the office server (action E — defence in depth). Every mutating office endpoint now calls a role guard against the shared capability matrix: create item → items.create; edit rate/team → items.edit; set install status → items.fit (or items.edit); raise snag → snags.raise; sync/promote/link board → monday.sync; manage teams → teams.manage. Since the office server uses the service-role key (bypasses RLS), this is what actually stops a wrong-role API call, not just a hidden button. Roles are now enforced in all three layers: database RLS (0.13.0), office server (this), and both UIs (0.14.0). Also: teams management and Monday board link/sync are now permitted for `office` too (previously admin-only), matching the matrix.

## 0.14.3 — 2026-08-17
- Fix mobile SSO redirect. After the Microsoft login, Safari showed "can't open the page" because the app returned to a custom `acefield://` URL that Expo Go can't open. `ssoRedirectUri()` no longer forces a scheme — Expo now picks `exp://` in Expo Go and `acefield://` in a dev/standalone build — and the returned code/tokens are parsed with a scheme-agnostic helper. For Expo Go testing, add the `exp://` redirect (or `exp://*`) to Supabase → Authentication → Redirect URLs.

## 0.14.2 — 2026-08-17
- Mobile "Sign in with Microsoft". The phone login now offers Azure SSO (shown when `EXPO_PUBLIC_AZURE_SSO_ENABLED=true`), so field staff who only have Microsoft accounts can sign in — the mobile role gating then applies to them. Opens the Supabase Azure flow in a secure in-app browser and returns via the `acefield://auth-callback` scheme (PKCE, with an implicit-token fallback). Azure needs no change (Supabase's callback is already registered for the office SSO); only the mobile redirect must be added to Supabase's Redirect URLs. Install once: `npx expo install expo-web-browser expo-auth-session expo-crypto`. Setup: docs/mobile-sso-setup.md.

## 0.14.1 — 2026-08-17
- Fix: "Reset password" in the Users tab could report a new password that was never applied to the Supabase login (the old code looked the user up only on the first page of `listUsers()` and didn't check whether the update succeeded), so the person still couldn't sign in. It now targets the auth account directly by its linked `auth_user_id` (with a paged email fallback and create-and-link if no login exists yet) and throws if the password didn't take — the UI shows the real error instead of a phantom password.

## 0.14.0 — 2026-08-17
- Role-aware UI gating (office + mobile). Office: Dashboard/Teams/Monday-sync tabs, the "+ New item" button, and the inline rate/status/team/sync controls are hidden or read-only for roles without the capability; a role that can't see the dashboard lands on Items. Mobile: "+ New job" hidden unless jobs.manage; survey "+ New" hidden for fitters; fitters see only items with an install status (ready to fit); the install-status editor shows only for fitters/office (others see it read-only). Client-side gating uses the same capability matrix as the DB; the RLS from 0.13.0 remains the real boundary. Mobile app also bumped to 0.14.0.

## 0.13.1 — 2026-08-17
- Fix: Users table clipped its right-hand columns (Status / actions) on narrower screens. The panel is wider now and scrolls horizontally if needed so all six columns show.

## 0.13.0 — 2026-08-17
- Role enforcement in the database — `supabase/migrations/0007_role_access.sql`. Restrictive RLS write policies (AND-ed with tenant scoping) mirror the capability matrix on the mobile/direct-Supabase path: only admin/office create or edit jobs & teams; only admin/office/surveyor/scanner create items; snags may also be raised by fitters; item edits by admin/office/surveyor/fitter; deletes by admin/office; and a trigger limits a fitter's item update to install status only. The office server (service-role key) bypasses RLS and is gated in the app layer next. Apply 0007 in Supabase (idempotent).

## 0.12.0 — 2026-08-17
- Roles & access foundation: capability matrix (`role → capabilities`) as the single source of truth in `packages/shared/src/permissions.ts` (`can()`), documented in `docs/roles-and-access.md`, plus a new admin-only **Roles** tab in the office app showing what each role can do. Defaults: admin = all; office = all but user management; surveyor = items/snags/photos (no jobs); scanner = items + photos; fitter = fit/snags/photos + ready-to-fit view only. Enforcement (UI gating, API checks, role-based RLS) follows.
- Note: `0.11.1` (recognise-folder CLI) shipped between 0.11.0 and this release.

## 0.11.0 — 2026-08-14
- Phase A frame recognition: server-side vision service (POST /api/recognise/:itemId, CLI `npm run recognise`) analyses an item photo and returns the window layout + style. OpenAI-compatible endpoint (hosted or self-hosted Qwen-VL); off unless VISION_API_URL/MODEL set. Schema frozen in @ace/shared. See docs/frame-recognition-data-strategy.md.

## 0.10.3 — 2026-08-13
- Sync reports photos pushed to Monday and surfaces any photo-push error (no more silent failure)

## 0.10.2 — 2026-08-13
- Field photos (from the mobile app) push to the Monday Design Sketch column on sync, once each (no duplicates on re-sync). (Requires migration 0006.)

## 0.10.1 — 2026-08-12
- A page refresh returns you to the tab you were on (and same job/filter), instead of jumping to the Dashboard

## 0.10.0 — 2026-08-12
- "Needs re-sync" flag: a synced item that changes (phone status update, office edit) shows a "changed" tag + amber Re-sync button, a "Needs re-sync" filter chip, and a dashboard card. Cleared on re-sync. (Requires migration 0005.)

## 0.9.1 — 2026-08-12
- Re-sync button on already-synced items — push later changes (e.g. a phone status update) to Monday; updates the existing item in place, never duplicates

## 0.9.0 — 2026-08-10
- Live wallboard at `/live` — standalone auto-refreshing status page, pin it as a browser tab (set `LIVE_KEY` in .env, then open `/live?key=...`)

## 0.8.0 — 2026-08-09
- Dashboard cards clickable → filtered Items view (plus a new "All jobs" view)
- Items tab filter chips: synced / not synced / installed / snags / open snags
- Dashboard install-status breakdown (scheduled / installed / snag / misfit / delayed)

## 0.7.0 — 2026-08-09
- New Dashboard tab (default view): totals + per-job progress bars for synced, installed, snags, and rolled-up labour

## 0.6.2 — 2026-08-09
- Microsoft SSO now shows the account picker (prompt=select_account), so you can switch users after signing out

## 0.6.1 — 2026-08-09
- Microsoft SSO requests the email scope explicitly (fixes "Error getting user email from external provider"); see docs/sso-setup.md troubleshooting

## 0.6.0 — 2026-08-09
- Sign in with Microsoft (SSO) — optional, off by default; links to your account by email (see docs/sso-setup.md)

## 0.5.1 — 2026-08-09
- Monday links now resolve to the right account (account slug captured on sync)
- Fixed snag row layout — long code no longer overlaps the description

## 0.5.0 — 2026-08-09
- Snags are now first-class items with their own labour cost and fitter team
- Snag names on Monday now include the defect description
- Added in-app version chip + this changelog

## 0.4.0 — 2026-08-09
- Admin Users tab: create logins, set roles, activate/deactivate, reset passwords
- Name & email editable inline; email changes update the Supabase login

## 0.3.0 — 2026-08-09
- Create new items from the desk (auto-assembles the full code)
- Item detail drawer with all fields + photos
- Bulk select + multi-line processing: sync, assign team, set install status

## 0.2.0 — 2026-08-08
- Teams & rates management (admin)
- Monday sync tab: link a board, per-job counts, batch Sync-all
- Item links resolve to the correct Monday account

## 0.1.0 — 2026-08-08
- Office web app: Supabase-Auth login, edit rate/status/team, Sync to Monday
