// App access: which office apps a role can open, and whether only to look or also to change things.
// Set per role on Admin ▸ Roles and stored on the server; when nothing is set, a role gets what its
// capabilities in permissions.ts give it (finops.view → every Fin&Ops tab, view + edit).
// Admin always has everything; Customer never gets an app (it has its own portal).
// Only apps whose data the server serves itself are here — the operational apps (jobs, items,
// plans…) depend on database rules tied to the role and stay fixed in the matrix.
import { can, type Role } from './permissions';

export type AppKey = 'fin.performance' | 'fin.costs' | 'fin.jobs' | 'fin.sales' | 'fin.payroll' | 'fin.stock' | 'wh.issues';
export type AppLevel = 'off' | 'view' | 'edit';
export const APP_LEVELS: AppLevel[] = ['off', 'view', 'edit'];
export const APPS: { key: AppKey; label: string; group: string; desc: string }[] = [
  { key: 'fin.performance', label: 'Performance', group: 'Fin&Ops', desc: 'Monthly result per department; edit = depreciation and financial costs' },
  { key: 'fin.costs', label: 'Costs', group: 'Fin&Ops', desc: 'Purchase invoices from monday; edit = run the sync' },
  { key: 'fin.jobs', label: 'Job costs', group: 'Fin&Ops', desc: 'Profit per Z job and its budget; edit = costs, budgets, new jobs' },
  { key: 'fin.sales', label: 'Sales', group: 'Fin&Ops', desc: 'Sales invoices per job, Subiekt to-check list; edit = invoices' },
  { key: 'fin.payroll', label: 'Payroll', group: 'Fin&Ops', desc: 'Salaries and taxes per department, people on the payroll list; edit = load files, lump sums' },
  { key: 'fin.stock', label: 'Stock value', group: 'Fin&Ops', desc: 'Stock value and ageing from Subiekt (view only)' },
  { key: 'wh.issues', label: 'Warehouse issues', group: 'Warehouse', desc: 'What the warehouse issued per Z order (logged on the phone); edit = correct, export to Excel for the RW' },
];
/** Roles whose app access can be set on the screen. */
export const isEditableRole = (role: string) => role !== 'admin' && role !== 'customer';
export type AppOverrides = Partial<Record<string, Partial<Record<AppKey, AppLevel>>>>;

/** What the role gets when nothing is set for it. */
export function defaultAppLevel(role: string | null | undefined, app: AppKey): AppLevel {
  if (role === 'admin') return 'edit';
  if (app === 'fin.stock') return can(role, 'finops.view') ? 'view' : 'off';
  return can(role, 'finops.view') ? 'edit' : 'off';
}
export function appLevel(role: string | null | undefined, app: AppKey, overrides?: AppOverrides | null): AppLevel {
  if (role === 'admin') return 'edit';
  if (!role || !isEditableRole(role)) return 'off';
  const o = overrides?.[role]?.[app];
  const lv = o && APP_LEVELS.includes(o) ? o : defaultAppLevel(role, app);
  return app === 'fin.stock' && lv === 'edit' ? 'view' : lv;   // nothing to change on Stock value
}
export function appLevels(role: string | null | undefined, overrides?: AppOverrides | null): Record<AppKey, AppLevel> {
  return Object.fromEntries(APPS.map((a) => [a.key, appLevel(role, a.key, overrides)])) as Record<AppKey, AppLevel>;
}
/** At least `need` on any of the apps (a request several tabs use, e.g. Performance reads payroll). */
export function hasApp(role: string | null | undefined, apps: AppKey[], need: 'view' | 'edit', overrides?: AppOverrides | null): boolean {
  return apps.some((a) => { const lv = appLevel(role, a, overrides); return need === 'view' ? lv !== 'off' : lv === 'edit'; });
}
/** Screen input → the stored overrides; a level equal to the default is not stored. */
export function setOverride(cur: AppOverrides, role: unknown, app: unknown, level: unknown): { ok: true; overrides: AppOverrides } | { ok: false; error: string } {
  const r = String(role ?? ''), a = String(app ?? '') as AppKey, l = String(level ?? '') as AppLevel;
  if (!isEditableRole(r) || !(['office', 'surveyor', 'scanner', 'fitter', 'invoice_manager', 'logistics', 'acemark_finance', 'sales_rep', 'acemark_fitter', 'production', 'production_manager', 'production_lead', 'warehouse'] as Role[]).includes(r as Role)) return { ok: false, error: 'This role’s access cannot be changed.' };
  if (!APPS.some((x) => x.key === a)) return { ok: false, error: 'Unknown app.' };
  if (!APP_LEVELS.includes(l)) return { ok: false, error: 'Choose off, view or edit.' };
  if (a === 'fin.stock' && l === 'edit') return { ok: false, error: 'Stock value can only be viewed.' };
  const next: AppOverrides = JSON.parse(JSON.stringify(cur ?? {}));
  const forRole = { ...(next[r] ?? {}) };
  if (l === defaultAppLevel(r, a)) delete forRole[a]; else forRole[a] = l;
  if (Object.keys(forRole).length) next[r] = forRole; else delete next[r];
  return { ok: true, overrides: next };
}
