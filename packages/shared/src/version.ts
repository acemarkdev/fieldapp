// Single source of truth for the app version, shared by web (and later mobile).
// Bump APP_VERSION and add a CHANGELOG entry whenever we ship a change.
//   MAJOR.MINOR.PATCH — MINOR for new features, PATCH for fixes/tweaks.
export const APP_VERSION = '0.6.2';

export interface ChangelogEntry { version: string; date: string; changes: string[]; }

export const CHANGELOG: ChangelogEntry[] = [
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
