# Changelog

App version lives in `packages/shared/src/version.ts` (`APP_VERSION` + `CHANGELOG`).
The office web app shows it as a chip in the header (click it for "What's new").
Bump the version and add an entry here **and** in `version.ts` on every change.
Versioning: MAJOR.MINOR.PATCH — MINOR for features, PATCH for fixes/tweaks.

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
