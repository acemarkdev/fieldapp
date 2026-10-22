// ACE Scaffolding — phase 6: reports and the monday switch-off.
//   pipeline     enquiries received per month, quoted value, won / decided (declined, lost, no answer), average
//                quote, days from enquiry to quote; by source and by estimator / sales person
//   job profit   per job: the price + what was invoiced on top of it (rent, extras) against estimated costs
//                (from its enquiry / quote) and actual costs (cost up / down, entered on the job)
//   income       requests for invoice per month by kind (hire, price stage, other) — sent, invoiced or paid
//   debtors      invoiced and unpaid per customer, aged by days past the due date
//   now          scaffolds on hire, jobs up, unbilled rent, stock value out on sites
// After the switch-off (config scaf_monday_off) the monday import is refused: the office app is the only record.
import { db } from './supabase';
import { getConfig, setConfig } from './store';
import { OPEN_STAGES } from './scaffolding';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const month = (d: string | null) => (d ? d.slice(0, 7) : null);
const inRange = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;
const DECIDED = ['won', 'declined', 'lost', 'no_answer'];

// ---- pure aggregation --------------------------------------------------------------------------------
export interface Enq { number: number; received: string | null; quote_sent: string | null; stage: string; source: string | null; estimator: string | null; salesperson: string | null; price: number | null }
type Bucket = { received: number; quoted: number; value: number; won: number; wonValue: number; decided: number };
const bucket = (): Bucket => ({ received: 0, quoted: 0, value: 0, won: 0, wonValue: 0, decided: 0 });
const add = (b: Bucket, e: Enq) => { b.received++; if (e.price) { b.quoted++; b.value += e.price; } if (e.stage === 'won') { b.won++; b.wonValue += e.price ?? 0; } if (DECIDED.includes(e.stage)) b.decided++; };
const finish = (b: Bucket) => ({ ...b, value: round2(b.value), wonValue: round2(b.wonValue), conversion: b.decided ? Math.round((b.won / b.decided) * 1000) / 10 : null });
export function pipelineReport(enqs: Enq[], from: string, to: string) {
  const list = enqs.filter((e) => inRange(e.received, from, to));
  const total = bucket(), byMonth = new Map<string, Bucket>(), bySource = new Map<string, Bucket>(), byPerson = new Map<string, Bucket>();
  const days: number[] = [];
  for (const e of list) {
    add(total, e);
    const m = month(e.received)!; add(byMonth.get(m) ?? byMonth.set(m, bucket()).get(m)!, e);
    const s = e.source || '(not set)'; add(bySource.get(s) ?? bySource.set(s, bucket()).get(s)!, e);
    for (const p of new Set([e.estimator, e.salesperson].flatMap((x) => String(x ?? '').split(',').map((y) => y.trim())).filter(Boolean))) add(byPerson.get(p) ?? byPerson.set(p, bucket()).get(p)!, e);
    if (e.received && e.quote_sent && e.quote_sent >= e.received) days.push(daysBetween(e.received, e.quote_sent));
  }
  const status: Record<string, number> = {};
  for (const e of list) { const k = e.stage === 'won' ? 'won' : DECIDED.includes(e.stage) ? e.stage : OPEN_STAGES.includes(e.stage as any) ? 'open' : 'other'; status[k] = (status[k] ?? 0) + 1; }
  const sorted = (m: Map<string, Bucket>) => [...m.entries()].map(([k, b]) => ({ key: k, ...finish(b) })).sort((a, b) => b.received - a.received);
  return {
    total: { ...finish(total), avgQuote: total.quoted ? round2(total.value / total.quoted) : null, avgDaysToQuote: days.length ? Math.round((days.reduce((a, x) => a + x, 0) / days.length) * 10) / 10 : null, status },
    months: [...byMonth.entries()].map(([k, b]) => ({ key: k, ...finish(b) })).sort((a, b) => a.key.localeCompare(b.key)),
    sources: sorted(bySource), people: sorted(byPerson),
  };
}
export interface Job { id: string; number: number; title: string | null; customer: string | null; stage: string; erector: string | null; price: number | null; actual_cost_up: number | null; actual_cost_down: number | null; up_start: string | null; created_at: string | null; enquiry: { price: number | null; est_cost_up: number | null; est_cost_down: number | null } | null }
/** Per job: revenue = the price + invoiced on top (rent, extras, losses; price stages are part of the price). */
export function jobProfit(jobs: Job[], invoicedExtra: Map<string, number>, from: string, to: string, costLines: Map<string, number> = new Map()) {
  const rows = jobs.filter((j) => inRange(j.up_start ?? (j.created_at ? j.created_at.slice(0, 10) : null), from, to)).map((j) => {
    const price = j.price ?? 0, extra = invoicedExtra.get(j.id) ?? 0, revenue = round2(price + extra);
    const estCost = j.enquiry && (j.enquiry.est_cost_up !== null || j.enquiry.est_cost_down !== null) ? round2((j.enquiry.est_cost_up ?? 0) + (j.enquiry.est_cost_down ?? 0)) : null;
    const lines = costLines.get(j.id);   // actual costs entered on the job, on top of what monday had
    const actualCost = j.actual_cost_up !== null || j.actual_cost_down !== null || lines !== undefined ? round2((j.actual_cost_up ?? 0) + (j.actual_cost_down ?? 0) + (lines ?? 0)) : null;
    const estProfit = estCost !== null ? round2(price - estCost) : null, actualProfit = actualCost !== null ? round2(revenue - actualCost) : null;
    return { id: j.id, number: j.number, title: j.title, customer: j.customer, stage: j.stage, erector: j.erector, price, extra: round2(extra), revenue, estCost, actualCost, estProfit, actualProfit, margin: actualProfit !== null && revenue > 0 ? Math.round((actualProfit / revenue) * 1000) / 10 : null };
  }).sort((a, b) => b.number - a.number);
  const withActual = rows.filter((r) => r.actualCost !== null), s = (f: (r: any) => number | null, list = rows) => round2(list.reduce((a, r) => a + (f(r) ?? 0), 0));
  return { rows, total: { jobs: rows.length, price: s((r) => r.price), extra: s((r) => r.extra), revenue: s((r) => r.revenue), withActual: withActual.length, actualCost: s((r) => r.actualCost, withActual), actualProfit: s((r) => r.actualProfit, withActual), actualRevenue: s((r) => r.revenue, withActual),
    margin: s((r) => r.revenue, withActual) > 0 ? Math.round((s((r) => r.actualProfit, withActual) / s((r) => r.revenue, withActual)) * 1000) / 10 : null } };
}
export interface Req { job_id: string; customer: string | null; kind: string; status: string; sent_on: string | null; invoiced_on: string | null; paid_on: string | null; payment_days: number | null; due: number }
/** Requests sent to accounts (or further) per month of sending, by kind. */
export function incomeReport(reqs: Req[], from: string, to: string) {
  const m = new Map<string, { rent: number; price: number; other: number }>();
  for (const r of reqs) {
    if (!['sent', 'invoiced', 'paid'].includes(r.status)) continue;
    const d = r.invoiced_on ?? r.sent_on; if (!inRange(d, from, to)) continue;
    const k = month(d)!, b = m.get(k) ?? m.set(k, { rent: 0, price: 0, other: 0 }).get(k)!;
    (b as any)[r.kind in b ? r.kind : 'other'] += r.due;
  }
  const months = [...m.entries()].map(([key, b]) => ({ key, rent: round2(b.rent), price: round2(b.price), other: round2(b.other), total: round2(b.rent + b.price + b.other) })).sort((a, b) => a.key.localeCompare(b.key));
  return { months, total: { rent: round2(months.reduce((a, x) => a + x.rent, 0)), price: round2(months.reduce((a, x) => a + x.price, 0)), other: round2(months.reduce((a, x) => a + x.other, 0)), total: round2(months.reduce((a, x) => a + x.total, 0)) } };
}
/** Invoiced, unpaid, per customer — aged by days past the due date (invoice date + payment days). */
export function debtorsReport(reqs: Req[], today: string) {
  const m = new Map<string, { customer: string; total: number; notDue: number; d30: number; d60: number; d90: number; over90: number; oldest: number }>();
  for (const r of reqs) {
    if (r.status !== 'invoiced' || !r.invoiced_on) continue;
    const due = new Date(Date.parse(r.invoiced_on + 'T00:00:00Z') + (r.payment_days ?? 30) * 864e5).toISOString().slice(0, 10);
    const late = daysBetween(due, today), c = r.customer || '(no customer)';
    const b = m.get(c) ?? m.set(c, { customer: c, total: 0, notDue: 0, d30: 0, d60: 0, d90: 0, over90: 0, oldest: 0 }).get(c)!;
    b.total += r.due; b.oldest = Math.max(b.oldest, late);
    if (late <= 0) b.notDue += r.due; else if (late <= 30) b.d30 += r.due; else if (late <= 60) b.d60 += r.due; else if (late <= 90) b.d90 += r.due; else b.over90 += r.due;
  }
  const rows = [...m.values()].map((b) => ({ ...b, total: round2(b.total), notDue: round2(b.notDue), d30: round2(b.d30), d60: round2(b.d60), d90: round2(b.d90), over90: round2(b.over90) })).sort((a, b) => b.total - a.total);
  const sum = (k: 'total' | 'notDue' | 'd30' | 'd60' | 'd90' | 'over90') => round2(rows.reduce((a, r) => a + r[k], 0));
  return { rows, total: { total: sum('total'), notDue: sum('notDue'), d30: sum('d30'), d60: sum('d60'), d90: sum('d90'), over90: sum('over90') } };
}

// ---- reads ----------------------------------------------------------------------------------------
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; }
  return out;
}
export async function reports(tenantId: string, from: string, to: string, withMoney: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const [enqs, jobs, custs] = await Promise.all([
    all<any>(() => db().from('scaf_enquiries').select('id,number,received,quote_sent,stage,source,estimator,salesperson,price,est_cost_up,est_cost_down').eq('tenant_id', tenantId).order('id')),
    all<any>(() => db().from('scaf_jobs').select('id,number,title,customer_id,stage,erector,price,actual_cost_up,actual_cost_down,up_start,created_at,enquiry_id').eq('tenant_id', tenantId).order('id')),
    all<any>(() => db().from('scaf_customers').select('id,name').eq('tenant_id', tenantId).order('id')),
  ]);
  const cm = new Map(custs.map((c) => [c.id, c.name])), em = new Map(enqs.map((e) => [e.id, e]));
  const out: any = { from, to, pipeline: pipelineReport(enqs.map((e) => ({ ...e, price: num(e.price) })), from, to) };
  let reqs: Req[] = [];
  try {
    const rq = await all<any>(() => db().from('scaf_invoice_requests').select('id,job_id,kind,status,sent_on,invoiced_on,paid_on,payment_days,retention_pct').eq('tenant_id', tenantId).order('id'));
    const lines = rq.length ? await all<any>(() => db().from('scaf_invoice_lines').select('request_id,amount').eq('tenant_id', tenantId).order('id')) : [];
    const amt = new Map<string, number>(); for (const l of lines) amt.set(l.request_id, (amt.get(l.request_id) ?? 0) + Number(l.amount));
    const jc = new Map(jobs.map((j) => [j.id, cm.get(j.customer_id) ?? null]));
    reqs = rq.map((r) => { const sub = amt.get(r.id) ?? 0; return { ...r, customer: jc.get(r.job_id) ?? null, due: round2(sub - (r.retention_pct ? sub * Number(r.retention_pct) / 100 : 0)) }; });
  } catch { /* 0099 not run */ }
  const extra = new Map<string, number>();
  for (const r of reqs) if (r.kind !== 'price' && ['sent', 'invoiced', 'paid'].includes(r.status)) extra.set(r.job_id, (extra.get(r.job_id) ?? 0) + r.due);
  const costLines = new Map<string, number>();
  try { for (const c of await all<any>(() => db().from('scaf_job_costs').select('job_id,amount').eq('tenant_id', tenantId).order('id'))) costLines.set(c.job_id, (costLines.get(c.job_id) ?? 0) + Number(c.amount)); } catch { /* 0103 not run */ }
  out.jobs = jobProfit(jobs.map((j) => { const e: any = j.enquiry_id ? em.get(j.enquiry_id) : null; return { ...j, customer: cm.get(j.customer_id) ?? null, price: num(j.price), actual_cost_up: num(j.actual_cost_up), actual_cost_down: num(j.actual_cost_down), enquiry: e ? { price: num(e.price), est_cost_up: num(e.est_cost_up), est_cost_down: num(e.est_cost_down) } : null }; }), withMoney ? extra : new Map(), from, to, costLines);
  if (withMoney) { out.income = incomeReport(reqs, from, to); out.debtors = debtorsReport(reqs, today); }
  out.now = { jobsUp: jobs.filter((j) => ['still_up', 'being_rented', 'ready_for_dismantle', 'part_dismantled', 'ongoing', 'commercial'].includes(j.stage)).length };
  try { const { count } = await db().from('scaf_scaffolds').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['on_hire', 'dismantle_requested', 'dismantling']); out.now.onHire = count ?? 0; } catch { /* before 0098 */ }
  return out;
}

// ---- the monday switch-off ---------------------------------------------------------------------------
export async function mondayOff(): Promise<{ off: boolean; at: string | null; by: string | null }> {
  try { const raw = await getConfig('scaf_monday_off'); const v = raw ? JSON.parse(raw) : null; return { off: !!v?.off, at: v?.at ?? null, by: v?.by ?? null }; } catch { return { off: false, at: null, by: null }; }
}
export async function setMondayOff(off: boolean, by: string) { await setConfig('scaf_monday_off', JSON.stringify({ off, at: new Date().toISOString(), by })); }
