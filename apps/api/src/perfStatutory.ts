// Performance ▸ Result, UoR / IFRS views: what the browser needs besides costs, sales and payroll.
//   • job costs to match to the sale: per Z job its material (RW and typed) and the invoices booked to it from monday
//     (glass, transport, extras), and the monday items behind those invoices (so they are not counted again as
//     department invoices). The view counts a job's costs in the month of its first final invoice — before that they
//     are work in progress;
//   • the stock by age bucket at each month end (the daily history of Stock value) and the write-down % per bucket
//     → the write-down provision (net realisable value) and its change per month;
//   • the commission earned per month, all reps (each rep's monthly bands on their own sales).
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { listOrderViews, commissionYear } from './finOrders';

const round2 = (n: number) => Math.round(n * 100) / 100;
async function all<T>(table: string, cols: string, tenantId: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from(table).select(cols).eq('tenant_id', tenantId);
    if (filter) q = filter(q);
    const { data, error } = await q.order(cols.split(',')[0]).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---- write-down % per age bucket (0–90 d, 91–180 d, 181–365 d, 1–2 y, > 2 y) --------------------------------------
export const DEFAULT_WRITEDOWN = [0, 0, 0, 0.5, 1];
export function writedownField(v: unknown): number[] | null {
  const parts = Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/).filter(Boolean);
  if (parts.length !== 5) return null;
  const n = parts.map((x) => Number(String(x).replace('%', '').replace(',', '.')));
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return null;
  return n.map((x) => (x > 1 ? x / 100 : x)).map((x) => Math.round(x * 10000) / 10000);   // 50 or 0.5 → 0.5
}
export async function getWritedown(): Promise<number[]> {
  try { const v = JSON.parse((await getConfig('stock_writedown_pct')) || 'null'); if (Array.isArray(v) && v.length === 5) return v.map(Number); } catch { /* default */ }
  return DEFAULT_WRITEDOWN;
}
export async function setWritedown(pct: number[]): Promise<void> { await setConfig('stock_writedown_pct', JSON.stringify(pct)); }
/** The provision at each month end, and its change in the month (the cost; negative = released). */
export function writedownByMonth(ends: ({ b: number[] } | null)[], prevDec: { b: number[] } | null, pct: number[]): { provision: (number | null)[]; change: number[] } {
  const prov = (e: { b: number[] } | null) => (e ? round2(e.b.reduce((s, v, i) => s + v * (pct[i] ?? 0), 0)) : null);
  const provision = ends.map(prov), change: number[] = [];
  let last = prov(prevDec);
  for (const p of provision) { change.push(p === null || last === null ? 0 : round2(p - last)); if (p !== null) last = p; }
  return { provision, change };
}

export interface StatutoryData {
  jobs: { key: string; reference: string; material: number; booked: number }[];
  bookedItems: string[];
  stock: { ends: ({ day: string; b: number[] } | null)[]; prevDec: { day: string; b: number[] } | null; writedown: number[] };
  commission: number[];
}
export async function statutoryData(tenantId: string, year: number): Promise<StatutoryData> {
  const [jobs, items] = await Promise.all([all<any>('fin_jobs', 'id,reference,reference_key', tenantId), all<any>('fin_job_items', 'id,job_id,kind,amount,source,source_id', tenantId)]);
  const byJob = new Map<string, { material: number; booked: number }>(), bookedItems: string[] = [];
  for (const it of items) {
    const x = byJob.get(it.job_id) ?? byJob.set(it.job_id, { material: 0, booked: 0 }).get(it.job_id)!;
    if (it.source === 'monday') { x.booked += Number(it.amount) || 0; if (it.source_id != null) bookedItems.push(String(it.source_id)); }
    else if (it.kind === 'material') x.material += Number(it.amount) || 0;
  }
  const jobRows = jobs.map((j) => ({ key: String(j.reference_key), reference: String(j.reference), material: round2(byJob.get(j.id)?.material ?? 0), booked: round2(byJob.get(j.id)?.booked ?? 0) })).filter((j) => j.material || j.booked);

  // the stock at each month end: the last day with a history total in that month
  let hist: any[] = [];
  try { hist = await all<any>('subiekt_stock_history', 'day,b0,b1,b2,b3,b4', tenantId, (q) => q.eq('warehouse', '*').gte('day', `${year - 1}-12-01`).lte('day', `${year}-12-31`)); } catch { /* before 0081 */ }
  const lastOf = new Map<string, any>();
  for (const r of hist) { const d = String(r.day), k = d.slice(0, 7); if (!lastOf.has(k) || d > String(lastOf.get(k).day)) lastOf.set(k, r); }
  const pick = (k: string) => { const r = lastOf.get(k); return r ? { day: String(r.day), b: [r.b0, r.b1, r.b2, r.b3, r.b4].map((v: any) => Number(v) || 0) } : null; };
  const ends = Array.from({ length: 12 }, (_, i) => pick(`${year}-${String(i + 1).padStart(2, '0')}`));

  // commission earned per month: each rep's bands apply to their own month
  const views = await listOrderViews(tenantId, null), byRep = new Map<string, any[]>();
  for (const o of views) { const k = (o as any).rep_user_id || '~'; (byRep.get(k) ?? byRep.set(k, []).get(k)!).push(o); }
  const commission = Array(12).fill(0);
  for (const list of byRep.values()) commissionYear(list, year).months.forEach((m, i) => { commission[i] = round2(commission[i] + m.commission); });

  return { jobs: jobRows, bookedItems: [...new Set(bookedItems)], stock: { ends, prevDec: pick(`${year - 1}-12`), writedown: await getWritedown() }, commission };
}
