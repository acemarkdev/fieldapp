// Job costs ◂ the monday invoice board (FAKTURY WSZYSTKIE): a purchase invoice whose "Zlecenie" names one Z job is
// booked as a cost line of that job, by what it is (step 3 of the order-to-actuals process):
//   • glass suppliers (Stan Szkło, Press Glass, A2 Projekt, Binnglass, N&C, Premier) → Glass, whatever the category;
//   • 631 Materials from the other suppliers (Cortizo, Aliplast, Aluprof, Schüco, VBH …) → not booked: the material
//     reaches the job as RW from Subiekt;
//   • 416 Materials Run → Extras, 425 Logistics → Transport, 500 Montaż → Extras;
//   • anything else (499.V Handel goes to the sales order; office, fuel …) → not booked.
// One line per invoice (source "monday", source_id = the monday item). It follows the board: a changed amount or Z
// moves it, an invoice that no longer qualifies loses its line. Locked jobs are never touched. A line typed by hand
// with the same invoice number and kind on that job is replaced, so nothing counts twice. Runs after each costs sync.
import { db } from './supabase';
import { referenceKey } from './finJobs';
import { zNumbersIn } from './mondayJobs';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const code = (sub: unknown) => /^(\d{3,4}(?:\.V)?)(?![\w.])/.exec(clean(sub).toUpperCase())?.[1] ?? null;
const noKey = (s: unknown) => clean(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const GLASS_SUPPLIERS = /stan[\s-]*szk|press[\s-]*glass|a2[\s-]*projekt|binn|n\s*&\s*c\b|premier/i;

export type InvoiceKind = 'glass' | 'extras' | 'transport';
/** The job cost kind of a purchase invoice, or null when it is not booked to the job. */
export function invoiceKind(r: { supplier: string | null; subcategory: string | null }): InvoiceKind | null {
  if (GLASS_SUPPLIERS.test(clean(r.supplier))) return 'glass';
  switch (code(r.subcategory)) {
    case '416': return 'extras';
    case '425': return 'transport';
    case '500': return 'extras';
    default: return null;   // 631 = RW from Subiekt; 499.V = the sales order; the rest is overhead
  }
}

export interface CostLite { id: string; monday_item_id: string; supplier: string | null; invoice_no: string | null; invoice_date: string | null; net: number | null; subcategory: string | null; order_ref: string | null; company: string | null; removed?: boolean }
export interface JobLite { id: string; reference_key: string; locked: boolean }
export interface ItemLite { id: string; job_id: string; kind: string; source: string | null; source_id: number | null; amount: number; invoice_no: string | null; item_date: string | null; supplier?: string | null }
export interface InvoicePlan {
  upsert: { jobId: string; id: string | null; fields: Record<string, any> }[];   // id = the line to update, null = new
  remove: string[]; typedReplaced: number;
  skipped: { noJob: string[]; severalZ: number; lockedSkipped: string[] };
}
export function planInvoiceLines(costs: CostLite[], jobs: JobLite[], items: ItemLite[]): InvoicePlan {
  const jobByKey = new Map(jobs.map((j) => [j.reference_key, j])), jobById = new Map(jobs.map((j) => [j.id, j]));
  const bySid = new Map<number, ItemLite>();
  for (const it of items) if (it.source === 'monday' && it.source_id != null) bySid.set(Number(it.source_id), it);
  const plan: InvoicePlan = { upsert: [], remove: [], typedReplaced: 0, skipped: { noJob: [], severalZ: 0, lockedSkipped: [] } };
  const keep = new Set<number>();
  for (const c of costs) {
    if (c.removed || c.company === 'off_balance' || c.net === null || !/^\d+$/.test(String(c.monday_item_id))) continue;
    const kind = invoiceKind(c); if (!kind) continue;
    const zs = zNumbersIn(c.order_ref); if (!zs.length) continue;
    if (zs.length > 1) { plan.skipped.severalZ++; continue; }
    const sid = Number(c.monday_item_id), key = referenceKey('Z.' + zs[0]), job = jobByKey.get(key);
    if (!job) { if (!plan.skipped.noJob.includes('Z.' + zs[0])) plan.skipped.noJob.push('Z.' + zs[0]); continue; }
    if (job.locked) { keep.add(sid); if (!plan.skipped.lockedSkipped.includes('Z.' + zs[0])) plan.skipped.lockedSkipped.push('Z.' + zs[0]); continue; }
    keep.add(sid);
    const fields = { kind, amount: Math.round(c.net * 100) / 100, hours: null, rate: null, invoice_no: c.invoice_no, supplier: clean(c.supplier).slice(0, 120) || null, item_date: c.invoice_date,
      note: `monday: ${clean(c.subcategory) || 'invoice'}`.slice(0, 300), source: 'monday', source_id: sid };
    const cur = bySid.get(sid);
    if (cur && cur.job_id === job.id) {
      if (cur.kind !== fields.kind || Math.abs(cur.amount - fields.amount) >= 0.005 || (cur.invoice_no ?? null) !== (fields.invoice_no ?? null) || (cur.item_date ?? null) !== (fields.item_date ?? null)) plan.upsert.push({ jobId: job.id, id: cur.id, fields });
    } else {
      if (cur && !jobById.get(cur.job_id)?.locked) plan.remove.push(cur.id);   // the Z was corrected on the board: move it
      plan.upsert.push({ jobId: job.id, id: null, fields });
      // the same invoice typed by hand on this job before → replaced by the booked line
      const inv = noKey(c.invoice_no);
      if (inv) for (const it of items) if (it.job_id === job.id && !it.source && it.kind === kind && noKey(it.invoice_no) === inv && !plan.remove.includes(it.id)) { plan.remove.push(it.id); plan.typedReplaced++; }
    }
  }
  // lines whose invoice is gone, lost its Z or no longer qualifies
  for (const [sid, it] of bySid) if (!keep.has(sid) && !jobById.get(it.job_id)?.locked && !plan.remove.includes(it.id)) plan.remove.push(it.id);
  return plan;
}

// ---- storage -------------------------------------------------------------------------------------
async function all<T>(table: string, cols: string, tenantId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export interface InvoiceBooking { booked: number; removed: number; typedReplaced: number; noJob: string[]; severalZ: number; lockedSkipped: string[] }
/** Book the production invoices onto their Z jobs (after a costs sync). */
export async function bookInvoiceLines(tenantId: string): Promise<InvoiceBooking> {
  const [costs, jobs, items] = await Promise.all([
    all<any>('fin_costs', 'id,monday_item_id,supplier,invoice_no,invoice_date,net,subcategory,order_ref,company,removed', tenantId),
    all<any>('fin_jobs', 'id,reference_key,locked', tenantId),
    all<any>('fin_job_items', 'id,job_id,kind,source,source_id,amount,invoice_no,item_date', tenantId),
  ]);
  const plan = planInvoiceLines(costs.map((c) => ({ ...c, net: c.net === null ? null : Number(c.net) })), jobs,
    items.map((i) => ({ ...i, amount: Number(i.amount) || 0, source_id: i.source_id === null ? null : Number(i.source_id) })));
  const now = new Date().toISOString();
  for (let i = 0; i < plan.remove.length; i += 100) { const { error } = await db().from('fin_job_items').delete().eq('tenant_id', tenantId).in('id', plan.remove.slice(i, i + 100)); if (error) throw error; }
  const fresh = plan.upsert.filter((u) => !u.id).map((u) => ({ tenant_id: tenantId, job_id: u.jobId, created_by: 'monday', ...u.fields }));
  for (let i = 0; i < fresh.length; i += 200) { const { error } = await db().from('fin_job_items').insert(fresh.slice(i, i + 200)); if (error) throw error; }
  for (const u of plan.upsert.filter((x) => x.id)) { const { error } = await db().from('fin_job_items').update({ ...u.fields, updated_at: now }).eq('tenant_id', tenantId).eq('id', u.id!); if (error) throw error; }
  return { booked: plan.upsert.length, removed: plan.remove.length - plan.typedReplaced, typedReplaced: plan.typedReplaced, noJob: plan.skipped.noJob, severalZ: plan.skipped.severalZ, lockedSkipped: plan.skipped.lockedSkipped };
}
