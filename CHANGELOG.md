# Changelog

App version lives in `packages/shared/src/version.ts` (`APP_VERSION` + `CHANGELOG`).
The office web app shows it as a chip in the header (click it for "What's new").
Bump the version and add an entry here **and** in `version.ts` on every change.
Versioning: MAJOR.MINOR.PATCH — MINOR for features, PATCH for fixes/tweaks.

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
