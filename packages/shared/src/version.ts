// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '0.10.1';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
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
