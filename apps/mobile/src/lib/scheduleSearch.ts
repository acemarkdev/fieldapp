// Flat search on the fitter's schedule: when a tenant isn't in, the fitter types another flat number
// and sees everything still to fit there — across every job their team has, grouped by job.
// Pure (no React Native imports) so it is unit-testable.
import type { SchedRow } from './scheduleGrouping';

export interface FlatGroup { key: string; customer: string; title: string; flat: string; data: SchedRow[] }

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^flat\s*/, '').replace(/\s+/g, '');

/** Scheduled (not yet fitted) items whose flat matches the query. "26" finds 26, then 26A, 26B…
 *  — an exact flat first, then flats that start with what was typed. Empty query → nothing. */
export function searchByFlat(rows: SchedRow[], query: string): SchedRow[] {
  const q = norm(query);
  if (!q) return [];
  const hits = rows.filter((r) => r.install_status === 'scheduled' && !!norm(r.flat) && norm(r.flat).startsWith(q));
  const rank = (r: SchedRow) => (norm(r.flat) === q ? 0 : 1);
  return hits.sort((a, b) =>
    rank(a) - rank(b)
    || norm(a.flat).localeCompare(norm(b.flat), undefined, { numeric: true })
    || String(a.planned_install_date ?? '9999').localeCompare(String(b.planned_install_date ?? '9999'))
    || String(a.full_code ?? '').localeCompare(String(b.full_code ?? '')));
}

/** One group per job + flat, in the order the search returned them. */
export function groupByJobFlat(rows: SchedRow[]): FlatGroup[] {
  const out: FlatGroup[] = [];
  const by = new Map<string, FlatGroup>();
  for (const r of rows) {
    const flat = String(r.flat ?? '').trim().replace(/^flat\s*/i, '');   // stored as "26" or "Flat 26"
    const key = r.job_id + '|' + norm(flat);
    let g = by.get(key);
    if (!g) {
      const customer = String(r.jobs?.client_code ?? '').trim();
      const code = r.jobs ? [r.jobs.client_code, r.jobs.job_code].filter(Boolean).join('.') : '';
      g = { key, customer, flat, title: [r.jobs?.name || code, 'Flat ' + flat].filter(Boolean).join(' · '), data: [] };
      by.set(key, g); out.push(g);
    }
    g.data.push(r);
  }
  return out;
}

/** Customers (client codes) present in a result set, for the narrowing chips. */
export function customersIn(rows: SchedRow[]): string[] {
  return [...new Set(rows.map((r) => String(r.jobs?.client_code ?? '').trim()).filter(Boolean))].sort();
}
