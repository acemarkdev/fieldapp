// Single source of truth for role-based access. The office app, the mobile app, and the
// database RLS policies all follow this matrix. Change a role's access HERE (and mirror the
// RLS migration) — don't scatter role checks through the code.
// See docs/roles-and-access.md.

export type Role = 'admin' | 'office' | 'surveyor' | 'scanner' | 'fitter' | 'invoice_manager' | 'customer' | 'logistics' | 'acemark_finance';
export const ROLES: Role[] = ['admin', 'office', 'surveyor', 'scanner', 'fitter', 'invoice_manager', 'customer', 'logistics', 'acemark_finance'];
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin', office: 'Office', surveyor: 'Surveyor', scanner: 'Scanner', fitter: 'Fitter',
  invoice_manager: 'Invoice manager', customer: 'Customer', logistics: 'Logistics', acemark_finance: 'Acemark Finance',
};

export type Capability =
  | 'dashboard.view'   // see the office dashboard / reports
  | 'calendar.view'    // see the install calendar + programme Gantt
  | 'jobs.manage'      // create / edit jobs
  | 'items.create'     // survey: create new items
  | 'items.edit'       // edit an item's spec / rate / team / room / code
  | 'items.fit'        // set install status (fitting), install date
  | 'snags.raise'      // raise a snag
  | 'qa.signoff'       // sign off a flat's install QA / handover (admin, office)
  | 'photos.add'       // attach photos to an item
  | 'plans.view'       // see the Plans tab (floor plans + item pins)
  | 'plans.manage'     // upload / replace / delete plan images
  | 'plans.pin'        // pin items onto a plan
  | 'teams.manage'     // manage fitter teams and rates
  | 'monday.sync'      // link a board / push items to Monday
  | 'users.manage'     // invite users, set roles, activate/deactivate
  | 'customers.manage' // manage customer cards + contractual requirements (admin)
  | 'purchasing.manage' // manage cost centres, suppliers, approve PO requests (admin)
  | 'purchasing.request' // raise / edit PO requests (internal staff)
  | 'finance.view'     // see the budget / customer pricing module (admin, invoice_manager only)
  | 'finance.manage'   // edit pricing rules, assign to jobs, set variations
  | 'labels.print'     // Logistics ▸ Labels: turn an Archimede PDF into a sheet of window/door labels
  | 'confirmations.manage' // share report-confirmation links, track approvals, download the signed PDF
  | 'finops.view'      // Fin&Ops: company costs synced from the monday invoices board
  | 'finops.manage';   // Fin&Ops: accept an edited invoice as the new trusted record (admin)

export const CAPABILITIES: { key: Capability; label: string; desc: string }[] = [
  { key: 'dashboard.view', label: 'View dashboard', desc: 'Office dashboard & reports' },
  { key: 'calendar.view', label: 'View calendar', desc: 'Install calendar & programme Gantt' },
  { key: 'jobs.manage', label: 'Manage jobs', desc: 'Create / edit jobs' },
  { key: 'items.create', label: 'Create items', desc: 'Survey new items on site' },
  { key: 'items.edit', label: 'Edit items', desc: 'Change spec / rate / team / code' },
  { key: 'items.fit', label: 'Fit items', desc: 'Set install status & date' },
  { key: 'snags.raise', label: 'Raise snags', desc: 'Log a snag against an item' },
  { key: 'qa.signoff', label: 'Sign off QA', desc: 'Sign off a flat’s install / handover' },
  { key: 'photos.add', label: 'Add photos', desc: 'Attach photos to an item' },
  { key: 'plans.view', label: 'View plans', desc: 'See floor plans & item pins' },
  { key: 'plans.manage', label: 'Manage plans', desc: 'Upload / delete plan images' },
  { key: 'plans.pin', label: 'Pin items', desc: 'Place item pins on a plan' },
  { key: 'teams.manage', label: 'Manage teams & rates', desc: 'Fitter teams and default rates' },
  { key: 'monday.sync', label: 'Sync to Monday', desc: 'Link boards & push items' },
  { key: 'users.manage', label: 'Manage users', desc: 'Invite, set roles, deactivate' },
  { key: 'customers.manage', label: 'Manage customers', desc: 'Customer cards & contractual requirements' },
  { key: 'purchasing.manage', label: 'Manage purchasing', desc: 'Cost centres, suppliers, PO approvals' },
  { key: 'purchasing.request', label: 'Raise PO requests', desc: 'Create & edit purchase-order requests' },
  { key: 'finance.view', label: 'View finance', desc: 'Budget & customer pricing (admin / invoice manager)' },
  { key: 'finance.manage', label: 'Manage finance', desc: 'Edit pricing rules, variations' },
  { key: 'labels.print', label: 'Print labels', desc: 'Window/door labels from an Archimede PDF' },
  { key: 'confirmations.manage', label: 'Report confirmations', desc: 'Share reports for sign-off, track approvals' },
  { key: 'finops.view', label: 'Fin&Ops costs', desc: 'Company costs from the monday invoices board; run the sync' },
  { key: 'finops.manage', label: 'Manage Fin&Ops', desc: 'Accept edited invoices as the new trusted record' },
];

// The matrix. `admin` implicitly has everything (see `can`). Edit the arrays to change access.
export const ROLE_CAPS: Record<Role, Capability[]> = {
  admin: CAPABILITIES.map((c) => c.key), // everything
  office: ['dashboard.view', 'calendar.view', 'jobs.manage', 'items.create', 'items.edit', 'items.fit', 'snags.raise', 'qa.signoff', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin', 'teams.manage', 'monday.sync', 'purchasing.request'],
  surveyor: ['calendar.view', 'items.create', 'items.edit', 'snags.raise', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin', 'purchasing.request'],
  scanner: ['calendar.view', 'items.create', 'photos.add', 'plans.view', 'plans.manage', 'plans.pin', 'purchasing.request'],
  fitter: ['calendar.view', 'items.fit', 'snags.raise', 'photos.add', 'purchasing.request'],
  // Finance-only role: sees the budget/pricing module, nothing operational.
  invoice_manager: ['calendar.view', 'finance.view', 'finance.manage'],
  // Customer self-service: no operational capabilities; handled via the customer portal + RLS.
  customer: [],
  // Logistics menu only (Labels, Confirmations) — no jobs, items, finance or anything else (see 0053_logistics_scope.sql).
  logistics: ['labels.print', 'confirmations.manage'],
  // Fin&Ops menu only (company cost control) — no jobs, items or anything else.
  acemark_finance: ['finops.view'],
};

// A role's data scope (which rows they see). Fitters only see items ready to fit; everyone
// else sees all items in their tenant. Enforced in the apps (and, later, in RLS SELECT policies).
export const FITTER_VISIBLE_STATUSES = ['scheduled', 'installed_no_snag', 'installed_snag', 'snag', 'misfit', 'delayed'];

export function can(role: string | null | undefined, cap: Capability): boolean {
  if (role === 'admin') return true;
  const caps = ROLE_CAPS[(role as Role)] ?? [];
  return caps.includes(cap);
}
