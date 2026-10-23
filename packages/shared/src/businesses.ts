// The businesses of ACE Group shown as tiles on the office home page. Each owns menu groups of the office app;
// a user sees the businesses set on their user (Admin ▸ Users), or — when nothing is set — the default for
// their role. Admin sees every business. Add a business here (e.g. a German one) and it gets a tile.
export type BusinessKey = 'framework' | 'acemark_pl' | 'scaffolding';
export interface Business { key: BusinessKey; name: string; country: 'UK' | 'PL' | 'DE'; desc: string; groups: string[] }
export const BUSINESSES: Business[] = [
  { key: 'framework', name: 'Framework', country: 'UK', desc: 'Window and door installation: jobs, survey and mapping, fitting, sign-off and purchasing.', groups: ['ops', 'sales', 'crm', 'finance', 'purchasing'] },
  { key: 'acemark_pl', name: 'Acemark PL', country: 'PL', desc: 'Production in Orpiszew, the warehouse, logistics (labels, confirmations) and Fin&Ops: costs, job costs, sales, payroll, performance.', groups: ['production', 'finops', 'logistics'] },
  { key: 'scaffolding', name: 'ACE Scaffolding', country: 'UK', desc: 'Scaffold enquiries and quotes, jobs and contracts, hire billing, inspections and stock.', groups: ['scaffolding'] },
];
export const BUSINESS_KEYS = BUSINESSES.map((b) => b.key);
const PL_ROLES = ['logistics', 'acemark_finance', 'sales_rep', 'acemark_fitter', 'production', 'production_manager', 'production_lead', 'warehouse'];
/** Without a setting on the user: admin → all; the Polish roles → Acemark PL; Scaffolding office → ACE Scaffolding;
 *  everyone else → Framework. */
export function defaultBusinesses(role: string | null | undefined): BusinessKey[] {
  if (role === 'admin') return [...BUSINESS_KEYS];
  if (role === 'scaffolding' || role === 'scaffolder') return ['scaffolding'];
  return PL_ROLES.includes(String(role)) ? ['acemark_pl'] : ['framework'];
}
/** The businesses a user sees: admin always all; otherwise the stored list (known keys only), else the default. */
export function userBusinesses(role: string | null | undefined, stored: unknown): BusinessKey[] {
  if (role === 'admin') return [...BUSINESS_KEYS];
  if (!Array.isArray(stored)) return defaultBusinesses(role);
  return BUSINESS_KEYS.filter((k) => stored.includes(k));
}
/** Admin ▸ Users input → what to store: known keys in a fixed order; null = back to the role default. */
export function businessesField(v: unknown): { ok: true; value: BusinessKey[] | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === 'default') return { ok: true, value: null };
  if (!Array.isArray(v)) return { ok: false, error: 'Choose the businesses.' };
  const bad = v.filter((x) => !BUSINESS_KEYS.includes(x as BusinessKey));
  if (bad.length) return { ok: false, error: 'Unknown business: ' + bad.join(', ') };
  return { ok: true, value: BUSINESS_KEYS.filter((k) => v.includes(k)) };
}
