// Fin&Ops ▸ Job costs — the Excel sheet "Koszty": profit & loss per job order.
// A job has cost lines of a kind; the job row shows the sum per kind (the sheet's columns), then
//   total cost = all kinds added up · profit = sales − total cost · profitability = profit ÷ sales.
// Labour is hours × rate. A locked job is read-only for everyone until an admin unlocks it.
import { db } from './supabase';
import { getConfig, setConfig } from './store';

export const JOB_KINDS = ['material', 'panels', 'glass', 'extras', 'painting', 'transport', 'customs', 'labour'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_KIND_LABEL: Record<JobKind, string> = {
  material: 'Material Cost (RW)', panels: 'Other cost — panels', glass: 'Glass', extras: 'Other extras',
  painting: 'Painting', transport: 'Transport', customs: 'Customs clearance', labour: 'Labour',
};
export const DEFAULT_LABOUR_RATE = 45;

// ---- pure rules --------------------------------------------------------------------------------
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
/** "Z.102 panele" → "Z.102PANELE": what makes a job unique. */
export const referenceKey = (ref: unknown) => clean(ref).replace(/\s/g, '').toUpperCase();
/** Numbers as typed or pasted from Excel: "16 839,40", "3,434.36", "1234.5", "" → null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  let s = String(v ?? '').replace(/[\s ]|zł|PLN/gi, '');
  if (!s || s === '-') return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}
const PL_MONTHS = ['stycz', 'lut', 'marz', 'kwie', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'paźdz', 'listop', 'grud'];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Wrzesień " / "September" / 9 → 9. */
export function parseMonth(v: unknown): number | null {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) { const n = +s; return n >= 1 && n <= 12 ? n : null; }
  const i = PL_MONTHS.findIndex((m) => s.startsWith(m)); if (i >= 0) return i + 1;
  const j = EN_MONTHS.findIndex((m) => s.startsWith(m)); return j >= 0 ? j + 1 : null;
}
/** A cost line's amount: labour with hours = hours × rate; everything else = the amount entered. */
export function itemAmount(kind: string, amount: unknown, hours: unknown, rate: unknown): number {
  const h = parseMoney(hours), r = parseMoney(rate);
  if (kind === 'labour' && h !== null && r !== null) return round2(h * r);
  return parseMoney(amount) ?? 0;
}
export interface JobSummary { sums: Record<JobKind, number>; hours: number; totalCost: number; profit: number | null; margin: number | null; materialPct: number | null; labourPct: number | null; items: number }
export function summarizeJob(sales: number | null, items: { kind: string; amount: number | string | null; hours?: number | string | null }[]): JobSummary {
  const sums = Object.fromEntries(JOB_KINDS.map((k) => [k, 0])) as Record<JobKind, number>;
  let hours = 0;
  for (const it of items) {
    if (!(JOB_KINDS as readonly string[]).includes(it.kind)) continue;
    sums[it.kind as JobKind] = round2(sums[it.kind as JobKind] + (Number(it.amount) || 0));
    if (it.kind === 'labour') hours = round2(hours + (Number(it.hours) || 0));
  }
  const totalCost = round2(JOB_KINDS.reduce((s, k) => s + sums[k], 0));
  const hasSales = sales !== null && sales !== undefined && Number(sales) !== 0;
  const profit = sales === null || sales === undefined ? null : round2(Number(sales) - totalCost);
  const pct = (n: number) => (hasSales ? Math.round((n / Number(sales)) * 10000) / 10000 : null);
  return { sums, hours, totalCost, profit, margin: hasSales && profit !== null ? pct(profit) : null, materialPct: pct(sums.material), labourPct: pct(sums.labour), items: items.length };
}

// ---- storage -----------------------------------------------------------------------------------
async function selectAll(table: string, cols: string, tenantId: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const num = (v: any) => (v === null || v === undefined ? null : Number(v));
const jobOut = (j: any) => ({ ...j, sales: num(j.sales) });
const itemOut = (i: any) => ({ ...i, amount: Number(i.amount) || 0, hours: num(i.hours), rate: num(i.rate) });

export async function getLabourRate(): Promise<number> {
  const v = parseMoney(await getConfig('fin_labour_rate'));
  return v !== null && v > 0 ? v : DEFAULT_LABOUR_RATE;
}
export async function setLabourRate(rate: number): Promise<void> { await setConfig('fin_labour_rate', String(rate)); }

/** Net invoiced per job on the Sales tab (fin_sales), by job key. */
async function invoicedByJob(tenantId: string): Promise<Map<string, { net: number; count: number }>> {
  const m = new Map<string, { net: number; count: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_sales').select('job_key,net').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) { if (!r.job_key) continue; const e = m.get(r.job_key) ?? { net: 0, count: 0 }; e.net = round2(e.net + (Number(r.net) || 0)); e.count++; m.set(r.job_key, e); }
    if (!data || data.length < 1000) break;
  }
  return m;
}
/** A job's sales: the sum of its sales invoices when it has any — unless the job is locked, in which
 *  case the stored figure stands (it was frozen when the job was locked). */
export function effectiveSales(job: { sales: any; locked: boolean }, inv: { net: number; count: number } | undefined): { sales: number | null; salesSource: 'invoices' | 'typed' | 'locked'; salesTyped: number | null; salesInvoiced: number | null; salesInvoices: number } {
  const typed = num(job.sales), invoiced = inv ? inv.net : null, n = inv ? inv.count : 0;
  if (job.locked) return { sales: typed, salesSource: 'locked', salesTyped: typed, salesInvoiced: invoiced, salesInvoices: n };
  if (inv && inv.count > 0) return { sales: inv.net, salesSource: 'invoices', salesTyped: typed, salesInvoiced: invoiced, salesInvoices: n };
  return { sales: typed, salesSource: 'typed', salesTyped: typed, salesInvoiced: null, salesInvoices: 0 };
}

export async function listJobs(tenantId: string): Promise<any[]> {
  const [jobs, items, inv] = await Promise.all([selectAll('fin_jobs', '*', tenantId), selectAll('fin_job_items', 'job_id,kind,amount,hours', tenantId), invoicedByJob(tenantId)]);
  const by = new Map<string, any[]>();
  for (const it of items) { const a = by.get(it.job_id); if (a) a.push(it); else by.set(it.job_id, [it]); }
  return jobs.map((j) => { const e = effectiveSales(j, inv.get(j.reference_key)); return { ...jobOut(j), ...e, ...summarizeJob(e.sales, by.get(j.id) ?? []) }; });
}
export async function getJob(tenantId: string, id: string): Promise<{ job: any; items: any[] } | null> {
  const { data: j, error } = await db().from('fin_jobs').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!j) return null;
  const it = await db().from('fin_job_items').select('*').eq('job_id', id).order('created_at');
  if (it.error) throw it.error;
  const items = (it.data ?? []).map(itemOut);
  const e = effectiveSales(j, (await invoicedByJob(tenantId)).get(j.reference_key));
  return { job: { ...jobOut(j), ...e, ...summarizeJob(e.sales, items) }, items };
}

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });

function jobFields(b: any): Result<{ fields: Record<string, any> }> {
  const reference = clean(b.reference);
  if (!reference) return fail(400, 'Enter the job reference (e.g. Z.373).');
  const year = b.period_year === '' || b.period_year == null ? null : Number(b.period_year);
  const month = b.period_month === '' || b.period_month == null ? null : parseMonth(b.period_month);
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) return fail(400, 'Year looks wrong.');
  return { ok: true, fields: { reference: reference.slice(0, 80), reference_key: referenceKey(reference).slice(0, 80), customer: clean(b.customer).slice(0, 120) || null, period_year: year, period_month: month, ...(b.sales === undefined ? {} : { sales: parseMoney(b.sales) }), note: clean(b.note).slice(0, 1000) || null } };
}
export async function createJob(tenantId: string, by: string, b: any): Promise<Result<{ id: string }>> {
  const f = jobFields(b); if (!f.ok) return f;
  const dup = await db().from('fin_jobs').select('id').eq('tenant_id', tenantId).eq('reference_key', f.fields.reference_key).maybeSingle();
  if (dup.data) return fail(409, `Job ${f.fields.reference} already exists.`);
  const { data, error } = await db().from('fin_jobs').insert({ tenant_id: tenantId, created_by: by, ...f.fields }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}
async function editableJob(tenantId: string, id: string): Promise<Result<{ job: any }>> {
  const { data: j, error } = await db().from('fin_jobs').select('id,reference,reference_key,locked').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!j) return fail(404, 'Job not found.');
  if (j.locked) return fail(409, `Job ${j.reference} is locked — an admin has to unlock it before it can be changed.`);
  return { ok: true, job: j };
}
export async function updateJob(tenantId: string, id: string, b: any): Promise<Result> {
  const e = await editableJob(tenantId, id); if (!e.ok) return e;
  const f = jobFields(b); if (!f.ok) return f;
  if (f.fields.reference_key !== e.job.reference_key) {
    const dup = await db().from('fin_jobs').select('id').eq('tenant_id', tenantId).eq('reference_key', f.fields.reference_key).maybeSingle();
    if (dup.data) return fail(409, `Job ${f.fields.reference} already exists.`);
  }
  const { error } = await db().from('fin_jobs').update({ ...f.fields, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
export async function deleteJob(tenantId: string, id: string): Promise<Result<{ reference: string }>> {
  const e = await editableJob(tenantId, id); if (!e.ok) return e;
  const { error } = await db().from('fin_jobs').delete().eq('id', id);
  if (error) throw error;
  return { ok: true, reference: e.job.reference };
}
export async function setJobLock(tenantId: string, id: string, locked: boolean, by: string): Promise<Result<{ reference: string }>> {
  // Locking freezes the job as it stands: if its sales come from invoices, that sum is stored now,
  // so invoices added later can't move a locked job's result.
  const freeze: Record<string, any> = {};
  if (locked) {
    const cur = await db().from('fin_jobs').select('reference_key,locked').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (cur.error) throw cur.error;
    const inv = cur.data && !cur.data.locked ? (await invoicedByJob(tenantId)).get(cur.data.reference_key) : undefined;
    if (inv && inv.count > 0) freeze.sales = inv.net;
  }
  const { data, error } = await db().from('fin_jobs').update({ ...freeze, locked, locked_by: locked ? by : null, locked_at: locked ? new Date().toISOString() : null }).eq('tenant_id', tenantId).eq('id', id).select('reference').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, 'Job not found.');
  return { ok: true, reference: data.reference };
}

function itemFields(b: any): Result<{ fields: Record<string, any> }> {
  const kind = String(b.kind ?? '');
  if (!(JOB_KINDS as readonly string[]).includes(kind)) return fail(400, 'Choose the type of cost.');
  const hours = kind === 'labour' ? parseMoney(b.hours) : null, rate = kind === 'labour' ? parseMoney(b.rate) : null;
  if (kind === 'labour' && (hours === null) !== (rate === null)) return fail(400, 'Labour needs both hours and a rate.');
  if (kind !== 'labour' && parseMoney(b.amount) === null) return fail(400, 'Enter the amount.');
  if (kind === 'labour' && hours === null && parseMoney(b.amount) === null) return fail(400, 'Enter the hours and the rate.');
  const date = clean(b.item_date);
  return { ok: true, fields: { kind, amount: itemAmount(kind, b.amount, hours, rate), hours, rate, invoice_no: clean(b.invoice_no).slice(0, 80) || null, supplier: clean(b.supplier).slice(0, 120) || null, item_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, note: clean(b.note).slice(0, 500) || null } };
}
export async function addJobItem(tenantId: string, jobId: string, by: string, b: any): Promise<Result<{ id: string; reference: string }>> {
  const e = await editableJob(tenantId, jobId); if (!e.ok) return e;
  const f = itemFields(b); if (!f.ok) return f;
  const { data, error } = await db().from('fin_job_items').insert({ tenant_id: tenantId, job_id: jobId, created_by: by, ...f.fields }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id, reference: e.job.reference };
}
async function itemJob(tenantId: string, itemId: string): Promise<Result<{ job: any }>> {
  const { data, error } = await db().from('fin_job_items').select('job_id').eq('tenant_id', tenantId).eq('id', itemId).maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, 'Cost line not found.');
  return editableJob(tenantId, data.job_id);
}
export async function updateJobItem(tenantId: string, itemId: string, b: any): Promise<Result<{ reference: string }>> {
  const e = await itemJob(tenantId, itemId); if (!e.ok) return e;
  const f = itemFields(b); if (!f.ok) return f;
  const { error } = await db().from('fin_job_items').update({ ...f.fields, updated_at: new Date().toISOString() }).eq('id', itemId);
  if (error) throw error;
  return { ok: true, reference: e.job.reference };
}
export async function deleteJobItem(tenantId: string, itemId: string): Promise<Result<{ reference: string }>> {
  const e = await itemJob(tenantId, itemId); if (!e.ok) return e;
  const { error } = await db().from('fin_job_items').delete().eq('id', itemId);
  if (error) throw error;
  return { ok: true, reference: e.job.reference };
}

// ---- one-off import of the Excel sheet (rows pasted in the app, already split into fields) -------
export interface ImportRow { reference: string; month?: unknown; year?: unknown; customer?: unknown; sales?: unknown; hours?: unknown; costs?: Partial<Record<JobKind, unknown>> }
/** One pasted row → the job and its cost lines. Labour with hours keeps the sheet's cost: rate = cost ÷ hours. */
export function importRowToJob(r: ImportRow): { job: Record<string, any>; items: Record<string, any>[] } | null {
  const reference = clean(r.reference);
  if (!reference) return null;
  const year = parseMoney(r.year);
  const items: Record<string, any>[] = [];
  for (const k of JOB_KINDS) {
    const amt = parseMoney(r.costs?.[k]);
    if (k === 'labour') {
      const h = parseMoney(r.hours);
      if (!amt && !h) continue;
      const rate = h && amt ? round2(amt / h) : null;
      items.push({ kind: k, amount: amt ?? 0, hours: h && amt ? h : (h ?? null), rate, note: 'Imported from Excel' });
    } else if (amt) items.push({ kind: k, amount: amt, hours: null, rate: null, note: 'Imported from Excel' });
  }
  return { job: { reference: reference.slice(0, 80), reference_key: referenceKey(reference).slice(0, 80), customer: clean(r.customer).slice(0, 120) || null, period_year: year && Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null, period_month: parseMonth(r.month), sales: parseMoney(r.sales) }, items };
}
export async function importJobs(tenantId: string, by: string, rows: ImportRow[]): Promise<{ added: number; skipped: string[]; items: number }> {
  const existing = new Set((await selectAll('fin_jobs', 'id,reference_key', tenantId)).map((j) => j.reference_key));
  let added = 0, itemCount = 0; const skipped: string[] = [];
  for (const r of rows) {
    const x = importRowToJob(r);
    if (!x) continue;
    if (existing.has(x.job.reference_key)) { skipped.push(x.job.reference); continue; }
    existing.add(x.job.reference_key);
    const ins = await db().from('fin_jobs').insert({ tenant_id: tenantId, created_by: by, ...x.job }).select('id').single();
    if (ins.error) throw ins.error;
    if (x.items.length) {
      const it = await db().from('fin_job_items').insert(x.items.map((i) => ({ tenant_id: tenantId, job_id: ins.data.id, created_by: by, ...i })));
      if (it.error) throw it.error;
      itemCount += x.items.length;
    }
    added++;
  }
  return { added, skipped, items: itemCount };
}
