// Performance ▸ Result, UoR / IFRS views: what the browser needs besides costs, sales and payroll.
//   • job costs to match to the sale: per Z job its material (RW and typed) and the invoices booked to it from monday
//     (glass, transport, extras), and the monday items behind those invoices (so they are not counted again as
//     department invoices). The view counts a job's costs in the month of its first final invoice — before that they
//     are work in progress;
//   • the stock by age bucket at each month end (the daily history of Stock value) and the write-down % per bucket
//     → the write-down provision (net realisable value) and its change per month;
//   • the commission earned per month, all reps (each rep's monthly bands on their own sales, plus other reps' lump sums);
//   • the trade purchases split by order (the supplier invoices' KSeF lines, as in Sales orders), each with the keys of its
//     order (OK number, Z number) — the view counts each piece in the month of the order's first final sales invoice.
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { listOrderViews, commissionYear, extraBonuses, orderKeys, tradeAllocation } from './finOrders';
import { loadTrade } from './tradeCosts';
import { listSales } from './finSales';

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

// ---- Result, production-month view: a Z job's sales in the month(s) its costs land in -------------------------------
// The management sheet counts a sale in its invoice month and the job's costs in their own months, so a job whose
// materials are bought in March with only a prepayment invoiced then looks like a loss in March and a windfall at the
// final invoice. This view moves the job's Orpiszew sales to its production months:
//   • production months = the months of the job's costs: material (RW) in the job's month, each invoice booked to it
//     from the monday cost board in that invoice's month; with costs in several months the sale is split by cost;
//   • the sale = the job's invoices (prepayments + final) once a final invoice exists; before that the accepted order's
//     value from Sales orders (an estimate) — or what is invoiced so far when there is no order;
//   • a job with no costs: its prepayments wait for the first final invoice (as in UoR) and are shown as a memo until
//     then; its final invoices stay in their own months;
//   • invoices with no job, and Trade from Poland, stay as on the sheet.
export interface PmSale { id: string; key: string; net: number; kind: string; ym: number | null; channel: string }
export interface PmJob { key: string; reference: string; costs: { ym: number; amount: number }[] }
export interface PmOrder { keys: string[]; net: number }
export interface ProductionMonth {
  sales: number[];        // Sales from Orpiszew in this view
  est: boolean[];         // the month holds an estimate (order value of a job not finally invoiced yet)
  estimate: number[];     // the part of sales that is not invoiced yet (order value − invoiced so far)
  waiting: number[];      // prepayments of jobs with no costs and no final invoice yet, by invoice month — not in sales
  unmatched: { reference: string; cost: number }[];   // jobs with costs this year but no invoice and no order
}
const alnumKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function productionMonth(year: number, sales: PmSale[], jobs: PmJob[], orders: PmOrder[]): ProductionMonth {
  const z = () => Array(12).fill(0) as number[];
  const out: ProductionMonth = { sales: z(), est: Array(12).fill(false), estimate: z(), waiting: z(), unmatched: [] };
  const inYear = (ym: number) => Math.floor(ym / 100) === year;
  const put = (arr: number[], ym: number, v: number) => { if (inYear(ym)) arr[(ym % 100) - 1] += v; };

  const orderNet = new Map<string, number>();
  for (const o of orders) for (const k of new Set(o.keys.map(alnumKey))) if (k) orderNet.set(k, (orderNet.get(k) ?? 0) + (Number(o.net) || 0));
  const byKey = new Map<string, PmSale[]>();
  for (const s of sales) {
    if (s.channel !== 'production' || !s.ym) continue;
    const k = alnumKey(s.key);
    if (!k) { put(out.sales, s.ym, s.net); continue; }
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s);
  }
  const done = new Set<string>();
  for (const j of jobs) {
    const k = alnumKey(j.key); if (!k || done.has(k)) continue;
    const cost = new Map<number, number>();
    for (const c of j.costs) if (c.ym && c.amount) cost.set(c.ym, (cost.get(c.ym) ?? 0) + c.amount);
    const months = [...cost].filter(([, v]) => v > 0), total = months.reduce((s, [, v]) => s + v, 0);
    if (total <= 0) continue;                       // no costs: handled with the jobs that have none, below
    done.add(k);
    const inv = byKey.get(k) ?? [], invoiced = inv.reduce((s, x) => s + x.net, 0), final = inv.some((x) => x.kind !== 'prepaid');
    const order = orderNet.get(k);
    const value = final ? invoiced : order != null ? Math.max(order, invoiced) : invoiced;
    const open = final ? 0 : Math.max(0, value - invoiced);
    if (!inv.length && order == null && months.some(([ym]) => inYear(ym))) out.unmatched.push({ reference: j.reference, cost: round2(total) });
    for (const [ym, v] of months) {
      const share = v / total;
      put(out.sales, ym, value * share);
      if (open > 0.004) { put(out.estimate, ym, open * share); if (inYear(ym)) out.est[(ym % 100) - 1] = true; }
    }
  }
  for (const [k, inv] of byKey) {
    if (done.has(k)) continue;
    const finals = inv.filter((x) => x.kind !== 'prepaid').map((x) => x.ym!).sort((a, b) => a - b);
    for (const s of inv) {
      if (s.kind !== 'prepaid') put(out.sales, s.ym!, s.net);
      else if (finals.length) put(out.sales, finals[0], s.net);
      else put(out.waiting, s.ym!, s.net);
    }
  }
  out.sales = out.sales.map(round2); out.estimate = out.estimate.map(round2); out.waiting = out.waiting.map(round2);
  out.unmatched.sort((a, b) => b.cost - a.cost);
  return out;
}

export interface StatutoryData {
  jobs: { key: string; reference: string; material: number; booked: number }[];
  bookedItems: string[];
  stock: { ends: ({ day: string; b: number[] } | null)[]; prevDec: { day: string; b: number[] } | null; writedown: number[] };
  commission: number[];
  trade: { cost_id: string; net: number; keys: string[] }[];
  production?: ProductionMonth;
}
export async function statutoryData(tenantId: string, year: number): Promise<StatutoryData> {
  const [jobs, items] = await Promise.all([all<any>('fin_jobs', 'id,reference,reference_key,period_year,period_month', tenantId), all<any>('fin_job_items', 'id,job_id,kind,amount,source,source_id,item_date', tenantId)]);
  const byJob = new Map<string, { material: number; booked: number }>(), bookedItems: string[] = [], itemsBy = new Map<string, any[]>();
  for (const it of items) {
    (itemsBy.get(it.job_id) ?? itemsBy.set(it.job_id, []).get(it.job_id)!).push(it);
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
  // plus the lump sums to other reps on an order, in the month it starts to count
  for (const x of extraBonuses(views, year, null)) commission[x.month - 1] = round2(commission[x.month - 1] + x.amount);

  // trade purchases by order: the keys of the order each piece belongs to
  let trade: StatutoryData['trade'] = [];
  try {
    const allocated = tradeAllocation(views as any, await loadTrade(tenantId)).purchases;
    const byKey = new Map<string, string[]>(); for (const o of views) { const ks = orderKeys(o as any); for (const k of ks) if (!byKey.has(k)) byKey.set(k, ks); }
    trade = allocated.filter((x) => x.cost_id).map((x) => ({ cost_id: String(x.cost_id), net: x.net, keys: byKey.get(x.order_key) ?? [x.order_key] }));
  } catch (e: any) { console.warn('[performance] trade purchases by order:', e?.message ?? e); }
  // the production-month view: each job's costs by month, its Orpiszew invoices, the accepted orders' values
  let production: ProductionMonth | undefined;
  try {
    const costYm = new Map<string, number>();
    for (const c of await all<any>('fin_costs', 'monday_item_id,period_year,period_month', tenantId)) if (c.period_year && c.period_month) costYm.set(String(c.monday_item_id), c.period_year * 100 + c.period_month);
    const ymOfDate = (d: unknown) => (/^\d{4}-\d{2}/.test(String(d ?? '')) ? +String(d).slice(0, 4) * 100 + +String(d).slice(5, 7) : null);
    const pmJobs: PmJob[] = jobs.map((j) => {
      const jm = j.period_year && j.period_month ? j.period_year * 100 + j.period_month : null, costs: PmJob['costs'] = [];
      for (const it of itemsBy.get(j.id) ?? []) {
        const amount = Number(it.amount) || 0; if (!amount) continue;
        if (it.source === 'monday') { const ym = costYm.get(String(it.source_id)) ?? ymOfDate(it.item_date) ?? jm; if (ym) costs.push({ ym, amount }); }
        else if (it.kind === 'material' && jm) costs.push({ ym: jm, amount });
      }
      return { key: String(j.reference_key ?? j.reference ?? ''), reference: String(j.reference ?? ''), costs };
    });
    const pmSales: PmSale[] = (await listSales(tenantId)).map((r: any) => ({ id: String(r.id), key: String(r.job_key || r.job_ref || ''), net: Number(r.net) || 0, kind: String(r.kind || 'final'),
      ym: r.period_year && r.period_month ? r.period_year * 100 + r.period_month : null, channel: r.channel }));
    const pmOrders: PmOrder[] = views.filter((o: any) => o.status === 'accepted').map((o: any) => ({ keys: orderKeys(o), net: Number(o.net) || 0 }));
    production = productionMonth(year, pmSales, pmJobs, pmOrders);
  } catch (e: any) { console.warn('[performance] production-month view:', e?.message ?? e); }
  return { production, jobs: jobRows, bookedItems: [...new Set(bookedItems)], stock: { ends, prevDec: pick(`${year - 1}-12`), writedown: await getWritedown() }, commission, trade };
}
