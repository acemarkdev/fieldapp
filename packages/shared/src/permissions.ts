// Single source of truth for role-based access. The office app, the mobile app, and the
// database RLS policies all follow this matrix. Change a role's access HERE (and mirror the
// RLS migration) — don't scatter role checks through the code.
// See docs/roles-and-access.md.

export type Role = 'admin' | 'office' | 'surveyor' | 'scanner' | 'fitter' | 'invoice_manager' | 'customer';
export const ROLES: Role[] = ['admin', 'office', 'surveyor', 'scanner', 'fitter', 'invoice_manager', 'customer'];
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', office: 'Office', surveyor: 'Surveyor', scanner: 'Scanner', fitter: 'Fitter',
  invoice_manager: 'Invoice manager', customer: 'Customer',
};

export type Capability =
  | 'dashboard.view'   // see the office dashboard / reports
  | 'jobs.manage'      // create / edit jobs
  | 'items.create'     // survey: create new items
  | 'items.edit'       // edit an item's spec / rate / team / room / code
  | 'items.fit'        // set install status (fitting), install date
  | 'snags.raise'      // raise a snag
  | 'photos.add'       // attach photos to an item
  | 'plans.view'       // see the Plans tab (floor plans + item pins)
  | 'plans.manage'     // upload / replace / delete plan images
  | 'plans.pin'        // pin items onto a plan
  | 'teams.manage'     // manage fitter teams and rates
  | 'monday.sync'      // link a board / push items to Monday
  | 'users.manage'     // invite users, set roles, activate/deactivate
  | 'finance.view'     // see the budget / customer pricing module (admin, invoice_manager only)
  | 'finance.manage';  // edit pricing rules, assign to jobs, set variations

export const CAPABILITIES: { key: Capability; label: string; desc: string }[] = [
  { key: 'dashboard.view', label: 'View dashboard', desc: 'Office dashboard & reports' },
  { key: 'jobs.manage', label: 'Manage jobs', desc: 'Create / edit jobs' },
  { key: 'items.create', label: 'Create items', desc: 'Survey new items on site' },
  { key: 'items.edit', label: 'Edit items', desc: 'Change spec / rate / team / code' },
  { key: 'items.fit', label: 'Fit items', desc: 'Set install status & date' },
  { key: 'snags.raise', label: 'Raise snags', desc: 'Log a snag against an item' },
  { key: 'photos.add', label: 'Add photos', desc: 'Attach photos to an item' },
  { key: 'plans.view', label: 'View plans', desc: 'See floor plans & item pins' },
  { key: 'plans.manage', label: 'Manage plans', desc: 'Upload / delete plan images' },
  { key: 'plans.pin', label: 'Pin items', desc: 'Place item pins on a plan' },
  { key: 'teams.manage', label: 'Manage teams & rates', desc: 'Fitter teams and default rates' },
  { key: 'monday.sync', label: 'Sync to Monday', desc: 'Link boards & push items' },
  { key: 'users.manage', label: 'Manage users', desc: 'Invite, set roles, deactivate' },
  { key: 'finance.view', label: 'View finance', desc: 'Budget & customer pricing (admin / invoice manager)' },
  { key: 'finance.manage', label: 'Manage finance', desc: 'Edit pricing rules, variations' },
];

// The matrix. `admin` implicitly has everything (see `can`). Edit the arrays to change access.
export const ROLE_CAPS: Record<Role, Capability[]> = {
  admin: CAPABILITIES.map((c) => c.key), // everything
  office: ['dashboard.view', 'jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin', 'teams.manage', 'monday.sync'],
  surveyor: ['items.create', 'items.edit', 'snags.raise', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin'],
  scanner: ['items.create', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin'],
  fitter: ['items.fit', 'snags.raise', 'photos.add'],
  // Finance-only role: sees the budget/pricing module, nothing operational.
  invoice_manager: ['finance.view', 'finance.manage'],
  // Customer self-service: no operational capabilities; handled via the customer portal + RLS.
  customer: [],
};

// A role's data scope (which rows they see). Fitters only see items ready to fit; everyone
// else sees all items in their tenant. Enforced in the apps (and, later, in RLS SELECT policies).
export const FITTER_VISIBLE_STATUSES = ['scheduled', 'installed_no_snag', 'installed_snag', 'snag', 'misfit', 'delayed'];

export function can(role: string | null | undefined, cap: Capability): boolean {
  if (role === 'admin') return true;
  const caps = ROLE_CAPS[(role as Role)] ?? [];
  return caps.includes(cap);
}
