// Sales orders ⇄ Job costs: one order (OK number, the commercial record) and its Z job (the costing and the
// produce-or-buy decision) kept in step.
//   • link: when Job costs loads a Z from the monday board PRODUCTION ACEMARK PL ("Z.453 -OK PL203173 …"), and every
//     night, the safe Z numbers are written onto the orders (the rules of mondayOrders: only an empty Z is filled);
//   • decision → order: once the budget is decided, the order gets the supplier and the budget cost of the chosen
//     scenario (produce: Acemark PL, cost of producing without transport + transport as delivery; trade: the vendor,
//     purchase + other, transport as delivery). The installation cost stays the rep's;
//   • the order shows its Z job (decision, both scenarios); the job's budget offer defaults from the order's net;
//   • order → job (step 2): the rep's vendor quote on the order (supplier other than Acemark PL, purchase cost, delivery
//     cost as transport) becomes the job's trade scenario when the Z is linked — only while that side is empty and the
//     budget undecided;
//   • monday links: the order's item on Acemark PL Enquiries and the job's item on PRODUCTION ACEMARK PL.
import { db } from './supabase';
import { budgetCalc, listBudgets, getBudget, type Budget } from './jobBudget';
import { referenceKey } from './finJobs';
import { zNumber } from './mondayJobs';
import { previewZLinks, applyZLinks } from './mondayOrders';
import { colReady } from './schemaReady';

export const MONDAY_WS = 'https://ace189144.monday.com';
export const ENQUIRY_BOARD_ID = '5555728429', PRODUCTION_BOARD_ID = '3576361679';
/** The link to a monday item, or null without an id. */
export const mondayItemUrl = (boardId: string, itemId: unknown) => (itemId && /^\d+$/.test(String(itemId)) ? `${MONDAY_WS}/boards/${boardId}/pulses/${itemId}` : null);

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
export interface OrderJob { id: string; reference: string; locked: boolean; decision: string; offer: number | null; monday?: string | null;
  produce: { costs: number; margin: number | null } | null; trade: { costs: number; margin: number | null } | null; better: string | null; advantage: number | null }
export function orderJobView(job: { id: string; reference: string; locked: boolean; monday_item_id?: string | null }, b: Budget | undefined): OrderJob {
  const monday = mondayItemUrl(PRODUCTION_BOARD_ID, job.monday_item_id);
  if (!b) return { id: job.id, reference: job.reference, locked: !!job.locked, decision: 'none', offer: null, monday, produce: null, trade: null, better: null, advantage: null };
  const c = budgetCalc(b);
  return { id: job.id, reference: job.reference, locked: !!job.locked, decision: b.decision, offer: c.offer, monday,
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
  const [jobs, budgets] = await Promise.all([page<any>('fin_jobs', 'id,reference,reference_key,locked' + ((await colReady('fin_jobs', 'monday_item_id')) ? ',monday_item_id' : ''), tenantId), listBudgets(tenantId)]);
  const byKey = new Map<string, any>(); for (const j of jobs) if (!byKey.has(j.reference_key)) byKey.set(j.reference_key, j);
  return orders.map((o: any) => { const k = jobKeyOf(o.job_ref), j = k ? byKey.get(k) : undefined; return { ...o, monday: mondayItemUrl(ENQUIRY_BOARD_ID, o.monday_item_id), job: j ? orderJobView(j, budgets.get(j.id)) : null }; });
}
/** The orders carrying this job's Z number. */
async function ordersOfJob(tenantId: string, reference: string): Promise<{ id: string; order_ref: string; net: number; customer: string | null; job_ref: string | null; supplier: string | null; cost_purchase: number | null; cost_delivery: number | null; vendor_quote?: string | null; monday?: string | null }[]> {
  const k = jobKeyOf(reference); if (!k) return [];
  const extra = (await colReady('fin_orders', 'monday_item_id')) ? ',vendor_quote,monday_item_id' : '';
  const rows = await page<any>('fin_orders', 'id,order_ref,net,customer,job_ref,supplier,cost_purchase,cost_delivery' + extra, tenantId);
  const num = (v: any) => (v === null || v === undefined ? null : Number(v));
  return rows.filter((o) => jobKeyOf(o.job_ref) === k).map((o) => ({ ...o, net: Number(o.net) || 0, cost_purchase: num(o.cost_purchase), cost_delivery: num(o.cost_delivery), monday: mondayItemUrl(ENQUIRY_BOARD_ID, o.monday_item_id) }));
}
/** The trade scenario an order brings to its job's budget: its vendor and quote; null without one. */
export function tradeFromOrder(o: { supplier: string | null; cost_purchase: number | null; cost_delivery: number | null }): { trade_supplier: string; trade_purchase: number; trade_transport: number | null } | null {
  const sup = String(o.supplier ?? '').trim();
  if (!sup || /^acemark/i.test(sup) || !(o.cost_purchase && o.cost_purchase > 0)) return null;
  return { trade_supplier: sup.slice(0, 120), trade_purchase: round2(o.cost_purchase), trade_transport: o.cost_delivery && o.cost_delivery > 0 ? round2(o.cost_delivery) : null };
}
/** Put an order's vendor quote into its job's budget as the trade scenario — only while that side is empty and the
 *  budget undecided; also the offer from the order's net when the budget has none. Returns whether it wrote. */
export async function seedTradeFromOrders(tenantId: string, jobId: string, reference: string, by = 'Sales order'): Promise<boolean> {
  const orders = await ordersOfJob(tenantId, reference);
  const o = orders.find((x) => tradeFromOrder(x)); if (!o) return false;
  const t = tradeFromOrder(o)!;
  const cur = await getBudget(tenantId, jobId);
  if (cur && (cur.decision !== 'undecided' || cur.trade_purchase !== null)) return false;
  const now = new Date().toISOString();
  const fields: Record<string, any> = { ...t, updated_by: by, updated_at: now };
  if (!cur || cur.offer_net === null) { if (o.net > 0) fields.offer_net = o.net; }
  const w = cur
    ? await db().from('fin_job_budgets').update(fields).eq('tenant_id', tenantId).eq('job_id', jobId).eq('decision', 'undecided').is('trade_purchase', null)
    : await db().from('fin_job_budgets').insert({ job_id: jobId, tenant_id: tenantId, note: `Trade quote from ${o.order_ref}`.slice(0, 500), ...fields });
  if (w.error) throw w.error;
  return true;
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
  const jobs = await page<any>('fin_jobs', 'id,reference,reference_key', tenantId);
  const byKey = new Map(jobs.map((j) => [j.reference_key, j])), synced: string[] = [];
  for (const k of keys) {
    const j = byKey.get(k); if (!j) continue;
    await seedTradeFromOrders(tenantId, j.id, j.reference);          // undecided: the order's vendor quote → the trade side
    synced.push(...(await syncOrdersFromJob(tenantId, j.id)));        // decided: the budget → the order
  }
  return synced;
}

// ---- one budget against actual for an order and its Z job (step 3): the same table in Sales orders and Job costs ----
export interface CostingRow { key: string; label: string; budget: number; actual: number; diff: number; source: string }
export interface Costing {
  basis: 'produce' | 'trade' | 'order'; decision: string | null;
  revenue: { budget: number | null; actual: number | null };
  rows: CostingRow[]; budgetCost: number; actualCost: number; diff: number; overrun: boolean;
  budgetProfit: number | null; actualProfit: number | null; budgetMargin: number | null; actualMargin: number | null;
}
const KIND_LABEL: Record<string, string> = { material: 'Material (RW)', panels: 'Panels', glass: 'Glass', extras: 'Extras', painting: 'Painting', transport: 'Transport', customs: 'Customs', labour: 'Labour' };
const KIND_SOURCE: Record<string, string> = { material: 'RW from Subiekt', glass: 'glass invoices (monday)', transport: 'transport invoices (monday)', extras: 'invoices (monday) and typed', labour: 'phone time × rate' };
/** The decided (or, undecided, the produce) scenario against everything booked: the job's cost lines (RW, invoices,
 *  labour), the order's supplier invoices and its installation (typed + cost reports paid out). */
export function costing(b: Budget | null, job: { sums: Record<string, number>; totalCost: number; sales: number | null } | null,
  order: { net: number; cost_purchase: number | null; cost_install: number | null; cost_delivery: number | null; cost_reports_paid?: number | null; actual_purchase?: number | null; invoiced?: number | null } | null): Costing {
  const rows: CostingRow[] = [];
  const add = (key: string, label: string, budget: number, actual: number, source: string) => { if (Math.abs(budget) >= 0.005 || Math.abs(actual) >= 0.005) rows.push({ key, label, budget: round2(budget), actual: round2(actual), diff: round2(actual - budget), source }); };
  const sums = job?.sums ?? {};
  const basis: Costing['basis'] = b ? (b.decision === 'trade' ? 'trade' : 'produce') : job ? 'produce' : 'order';
  const bought = order?.actual_purchase ?? 0;
  if (basis === 'produce') {
    const c = b ? budgetCalc(b) : null;
    for (const k of ['material', 'panels', 'glass', 'extras', 'painting', 'transport', 'customs']) add(k, KIND_LABEL[k], c ? c.produce.lines[k as keyof typeof c.produce.lines] ?? 0 : 0, sums[k] ?? 0, KIND_SOURCE[k] ?? 'typed in Job costs');
    add('labour', KIND_LABEL.labour, c ? c.produce.labour : 0, sums.labour ?? 0, KIND_SOURCE.labour);
    add('bought', 'Bought in (supplier invoices)', 0, bought, 'trade invoices on the order');
  } else if (basis === 'trade') {
    add('bought', 'Purchase from the vendor', (b!.trade_purchase ?? 0) + (b!.trade_other ?? 0), bought, 'trade invoices on the order (KSeF)');
    add('transport', KIND_LABEL.transport, b!.trade_transport ?? 0, sums.transport ?? 0, KIND_SOURCE.transport);
    const otherJob = (job?.totalCost ?? 0) - (sums.transport ?? 0);
    add('job_other', 'Other costs on the Z job', 0, otherJob, 'RW, invoices, labour on the job');
  } else {   // an order without a Z job: the rep's estimate against the supplier invoices
    add('bought', 'Purchase', order?.cost_purchase ?? 0, bought, 'trade invoices on the order (KSeF)');
    add('transport', 'Delivery', order?.cost_delivery ?? 0, order?.cost_delivery ?? 0, 'as typed on the order');
  }
  if (order) add('install', 'Installation', order.cost_install ?? 0, (order.cost_install ?? 0) + (order.cost_reports_paid ?? 0), 'typed + cost reports paid out');
  const budgetCost = round2(rows.reduce((s, r) => s + r.budget, 0)), actualCost = round2(rows.reduce((s, r) => s + r.actual, 0));
  const revB = b?.offer_net ?? (order && order.net > 0 ? order.net : null);
  const revA = order ? (order.invoiced ?? null) : (job?.sales ?? null);
  const revActual = revA && revA !== 0 ? revA : (job?.sales ?? null);
  const bp = revB === null ? null : round2(revB - budgetCost), ap = revActual === null ? null : round2(revActual - actualCost);
  return { basis, decision: b?.decision ?? null, revenue: { budget: revB, actual: revActual }, rows, budgetCost, actualCost, diff: round2(actualCost - budgetCost),
    overrun: budgetCost > 0 && actualCost > budgetCost * 1.1, budgetProfit: bp, actualProfit: ap,
    budgetMargin: revB ? Math.round((bp! / revB) * 10000) / 10000 : null, actualMargin: revActual ? Math.round((ap! / revActual) * 10000) / 10000 : null };
}
/** The Z job carrying this Job costs key, or null. */
export async function jobIdByKey(tenantId: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  const { data, error } = await db().from('fin_jobs').select('id').eq('tenant_id', tenantId).eq('reference_key', key).limit(1);
  if (error) throw error; return data?.[0]?.id ?? null;
}
