// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '0.14.3';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
  { version: '0.14.3', date: '2026-08-17', changes: [
    'Fix mobile SSO redirect: after the Microsoft login, Safari showed \'can\'t open the page\' because the app was returning to a custom acefield:// URL that Expo Go can\'t open. It now lets Expo pick the right redirect per environment (exp:// in Expo Go, acefield:// in a dev/standalone build) and parses the returned tokens robustly. Add the exp:// redirect (or exp://*) to Supabase Redirect URLs for Expo Go testing.',
  ] },
  { version: '0.14.2', date: '2026-08-17', changes: [
    'Mobile app: "Sign in with Microsoft" on the phone login, so SSO-only field staff can sign in (matches the office web app). Uses the same Azure provider; only the mobile redirect needs adding to Supabase. Setup: docs/mobile-sso-setup.md.',
  ] },
  { version: '0.14.1', date: '2026-08-17', changes: [
    'Fix: "Reset password" could show a new password that was never actually applied to the login (so the user still couldn\'t sign in). It now updates the auth account directly by its linked ID (with a paged email fallback) and fails loudly if the update didn\'t take — no more phantom passwords.',
  ] },
  { version: '0.14.0', date: '2026-08-17', changes: [
    'Role-aware screens: people now only see what their role allows. Office — Dashboard/Teams/Monday-sync tabs, the "+ New item" button, and inline edit/sync controls are hidden for roles that lack the capability. Mobile — "+ New job" is hidden unless you can manage jobs, the survey "+ New" is hidden for fitters, fitters see only items that are ready to fit, and the install-status editor is shown only to fitters/office. The database (migration 0007) still enforces the rules underneath.',
  ] },
  { version: '0.13.1', date: '2026-08-17', changes: [
    'Fix: the Users table was clipping its right-hand columns (Status / actions) on narrower screens — the panel is now wider and scrolls sideways if needed so every column is visible.',
  ] },
  { version: '0.13.0', date: '2026-08-17', changes: [
    'Role enforcement in the database (migration 0007): on the mobile/direct path, surveyors can add items but not jobs, fitters can set install status but not edit the spec, and only admin/office manage jobs & teams. This is the real security boundary — apply 0007_role_access.sql in Supabase.',
  ] },
  { version: '0.12.0', date: '2026-08-17', changes: [
    'Roles & access: a capability matrix (role → what they can do) is now the single source of truth in @ace/shared, with a new admin-only Roles tab that shows exactly what each role can do. Foundation for enforcing access across the office app, mobile app, and database.',
  ] },
  { version: '0.11.1', date: '2026-08-14', changes: [
    'recognise CLI now accepts a folder — runs every photo and prints a summary table (fast way to eyeball model accuracy on many images)',
  ] },
  { version: '0.11.0', date: '2026-08-14', changes: [
    'Phase A frame recognition: a server-side vision service (POST /api/recognise/:itemId) analyses an item photo and returns the window layout + style. Off unless VISION_API_URL/MODEL are set.',
  ] },
  { version: '0.10.3', date: '2026-08-13', changes: [
    'Sync now reports how many photos were pushed to Monday (and surfaces any photo-push error instead of failing silently)',
  ] },
  { version: '0.10.2', date: '2026-08-13', changes: [
    'Field photos (from the mobile app) now push to the Monday Design Sketch column on sync, once each (no duplicates on re-sync)',
  ] },
  { version: '0.10.1', date: '2026-08-12', changes: [
    'A page refresh now returns you to the tab you were on (and the same job/filter), instead of jumping to the Dashboard',
  ] },
  { version: '0.10.0', date: '2026-08-12', changes: [
    '"Needs re-sync" flag: synced items that change (e.g. a phone status update) show a "changed" tag + amber Re-sync, a "Needs re-sync" filter, and a dashboard card',
  ] },
  { version: '0.9.1', date: '2026-08-12', changes: [
    'Re-sync button on already-synced items — push later changes (e.g. a status update from the phone) to Monday; updates the existing item in place, never duplicates',
  ] },
  { version: '0.9.0', date: '2026-08-10', changes: [
    'Live wallboard at /live — a standalone auto-refreshing status page you can pin as a browser tab',
  ] },
  { version: '0.8.0', date: '2026-08-09', changes: [
    'Dashboard cards are clickable — jump to a filtered Items view (incl. a new "All jobs" view)',
    'Items tab now has filter chips: synced, not synced, installed, snags, open snags',
    'Dashboard shows an install-status breakdown (scheduled / installed / snag / misfit / delayed)',
  ] },
  { version: '0.7.0', date: '2026-08-09', changes: [
    'New Dashboard tab (default view): totals + per-job progress for synced, installed, snags, and labour',
  ] },
  { version: '0.6.2', date: '2026-08-09', changes: [
    'Microsoft SSO now shows the account picker, so you can switch users after signing out',
  ] },
  { version: '0.6.1', date: '2026-08-09', changes: [
    'Microsoft SSO now requests the email scope explicitly (fixes "error getting user email")',
  ] },
  { version: '0.6.0', date: '2026-08-09', changes: [
    'Sign in with Microsoft (SSO) — optional, links to your account by email',
  ] },
  { version: '0.5.1', date: '2026-08-09', changes: [
    'Monday links now resolve to the right account (account slug captured on sync)',
    'Fixed snag row layout — long code no longer overlaps the description',
  ] },
  { version: '0.5.0', date: '2026-08-09', changes: [
    'Snags are now first-class items with their own labour cost and fitter team',
    'Snag names on Monday now include the defect description',
    'Added in-app version chip + this changelog',
  ] },
  { version: '0.4.0', date: '2026-08-09', changes: [
    'Admin Users tab: create logins, set roles, activate/deactivate, reset passwords',
    'Name & email are editable inline; email changes update the Supabase login',
  ] },
  { version: '0.3.0', date: '2026-08-09', changes: [
    'Create new items from the desk (auto-assembles the full code)',
    'Item detail drawer with all fields + photos',
    'Bulk select + multi-line processing: sync, assign team, set install status',
  ] },
  { version: '0.2.0', date: '2026-08-08', changes: [
    'Teams & rates management (admin)',
    'Monday sync tab: link a board, per-job counts, batch Sync-all',
    'Item links resolve to the correct Monday account',
  ] },
  { version: '0.1.0', date: '2026-08-08', changes: [
    'Office web app: Supabase-Auth login, edit rate/status/team, Sync to Monday',
  ] },
];
