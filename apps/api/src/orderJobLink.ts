// Sales orders ⇄ Job costs: one order (OK number, the commercial record) and its Z job (the costing and the
// produce-or-buy decision) kept in step.
//   • link: when Job costs loads a Z from the monday board PRODUCTION ACEMARK PL ("Z.453 -OK PL203173 …"), and every
//     night, the safe Z numbers are written onto the orders (the rules of mondayOrders: only an empty Z is filled);
//   • decision → order: once the budget is decided, the order gets the supplier and the budget cost of the chosen
//     scenario (produce: Acemark PL, cost of producing without transport + transport as delivery; trade: the vendor,
//     purchase + other, transport as delivery). The installation cost stays the rep's;
//   • the order shows its Z job (decision, both scenarios); the job's budget offer defaults from the order's net.
import { db } from './supabase';
import { budgetCalc, listBudgets, getBudget, type Budget } from './jobBudget';
import { referenceKey } from './finJobs';
import { zNumber } from './mondayJobs';
import { previewZLinks, applyZLinks } from './mondayOrders';

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The Job costs key of an order's Z number ("Z.453", "z 453", "Z.0453 phase" → "Z.453"); null without one. */
export const jobKeyOf = (jobRef: unknown): string | null => { const n = zNumber(jobRef); return n === null ? null : referenceKey('Z.' + n); };

export interface OrderCosts { supplier: string | null; cost_purchase: number; cost_delivery: number; decision: 'produce' | 'trade' }
/** What a decided budget puts on its order; null while undecided or rejected. */
export function orderCostsFromBudget(b: Pick<Budget, 'decision' | 'offer_net' | 'produce' | 'labour_hours' | 'labour_rate' | 'trade_supplier' | 'trade_purchase' | 'trade_transport' | 'trade_other'>): OrderCosts | null {
  if (b.decision === 'produce') {
    const c = budgetCalc(b as Budget), transport = c.produce.lines.transport ?? 0;
    return { decision: 'produce', supplier: 'Acemark PL', cost_purchase: round2(c.produce.costs - transport), cost_delivery: round2(transport) };
  }
  if (b.decision === 'trade') {
    return { decision: 'trade', supplier: b.trade_supplier || null, cost_purchase: round2((b.trade_purchase ?? 0) + (b.trade_other ?? 0)), cost_delivery: round2(b.trade_transport ?? 0) };
  }
  return null;
}

/** The Z job summary shown on an order. */
export interface OrderJob { id: string; reference: string; locked: boolean; decision: string; offer: number | null;
  produce: { costs: number; margin: number | null } | null; trade: { costs: number; margin: number | null } | null; better: string | null; advantage: number | null }
export function orderJobView(job: { id: string; reference: string; locked: boolean }, b: Budget | undefined): OrderJob {
  if (!b) return { id: job.id, reference: job.reference, locked: !!job.locked, decision: 'none', offer: null, produce: null, trade: null, better: null, advantage: null };
  const c = budgetCalc(b);
  return { id: job.id, reference: job.reference, locked: !!job.locked, decision: b.decision, offer: c.offer,
    produce: c.produce.costs > 0 ? { costs: c.produce.costs, margin: c.produce.margin } : null,
    trade: c.trade.estimated ? { costs: c.trade.costs, margin: c.trade.margin } : null, better: c.better, advantage: c.advantage };
}

// ---- storage -------------------------------------------------------------------------------------
async function page<T>(table: string, cols: string, tenantId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** Attach each order's Z job (by its Z number) — for the Sales orders list and window. */
export async function attachJobs<T extends { job_ref: string | null }>(tenantId: string, orders: T[]): Promise<(T & { job: OrderJob | null })[]> {
  if (!orders.some((o) => jobKeyOf(o.job_ref))) return orders.map((o) => ({ ...o, job: null }));
  const [jobs, budgets] = await Promise.all([page<any>('fin_jobs', 'id,reference,reference_key,locked', tenantId), listBudgets(tenantId)]);
  const byKey = new Map<string, any>(); for (const j of jobs) if (!byKey.has(j.reference_key)) byKey.set(j.reference_key, j);
  return orders.map((o) => { const k = jobKeyOf(o.job_ref), j = k ? byKey.get(k) : undefined; return { ...o, job: j ? orderJobView(j, budgets.get(j.id)) : null }; });
}
/** The orders carrying this job's Z number. */
async function ordersOfJob(tenantId: string, reference: string): Promise<{ id: string; order_ref: string; net: number; customer: string | null; job_ref: string | null }[]> {
  const k = jobKeyOf(reference); if (!k) return [];
  const rows = await page<any>('fin_orders', 'id,order_ref,net,customer,job_ref', tenantId);
  return rows.filter((o) => jobKeyOf(o.job_ref) === k).map((o) => ({ ...o, net: Number(o.net) || 0 }));
}
/** The order(s) of a job — for the job window (the budget offer defaults from the order's net). */
export async function jobOrders(tenantId: string, reference: string) { return ordersOfJob(tenantId, reference); }

/** Copy a decided budget onto the job's orders. Returns the order numbers changed. */
export async function syncOrdersFromJob(tenantId: string, jobId: string): Promise<string[]> {
  const { data: job, error } = await db().from('fin_jobs').select('id,reference').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle();
  if (error) throw error; if (!job) return [];
  const b = await getBudget(tenantId, jobId); const c = b ? orderCostsFromBudget(b) : null;
  if (!c) return [];
  const orders = await ordersOfJob(tenantId, job.reference), changed: string[] = [];
  for (const o of orders) {
    const patch: Record<string, any> = { cost_purchase: c.cost_purchase, cost_delivery: c.cost_delivery, updated_at: new Date().toISOString() };
    if (c.supplier) patch.supplier = c.supplier.slice(0, 60);
    const u = await db().from('fin_orders').update(patch).eq('tenant_id', tenantId).eq('id', o.id);
    if (u.error) throw u.error;
    changed.push(o.order_ref);
  }
  return changed;
}
/** Fill every safe Z number from the board onto its order, then copy the decided budgets of the jobs just linked. */
export async function autoLinkZ(tenantId: string): Promise<{ filled: string[]; synced: string[] }> {
  const { rows } = await previewZLinks(tenantId);
  const ids = rows.filter((r) => r.status === 'fill').map((r) => r.id);
  if (!ids.length) return { filled: [], synced: [] };
  const r = await applyZLinks(tenantId, ids);
  return { filled: r.filled, synced: await syncAfterLinks(tenantId, r.links.map((l) => l.z)) };
}
/** After Z numbers were written onto orders: copy the decided budgets of those jobs. */
export async function syncAfterLinks(tenantId: string, zs: string[]): Promise<string[]> {
  const keys = [...new Set(zs.map(jobKeyOf).filter((k): k is string => !!k))];
  if (!keys.length) return [];
  const jobs = await page<any>('fin_jobs', 'id,reference_key', tenantId);
  const byKey = new Map(jobs.map((j) => [j.reference_key, j.id])), synced: string[] = [];
  for (const k of keys) { const id = byKey.get(k); if (id) synced.push(...(await syncOrdersFromJob(tenantId, id))); }
  return synced;
}
