// ACE Scaffolding — phase 3: hire and invoicing. The office raises requests for invoice; the accounts team raises
// the invoices in Xero (a Xero connection may come later). Rules agreed 2026-10-22:
//   · hire starts at the handover; the price covers the included weeks; after them the scaffold is rented per day —
//     weekly rate × days / 7 — up to and including the day the hire stops: the dismantle day the team confirms
//     (hire_stop_on; it starts as the down date and can be changed — a delay on our side keeps the planned day);
//   · each job is billed weekly or monthly; a rent run bills every scaffold's unbilled days up to a chosen day;
//   · retention and payment terms come from the customer and can be changed on the request;
//   · parts of the price (stages) are raised by hand — an amount or a % of the price;
//   · CIS / VAT reverse charge: a note on the request until the accountant confirms the treatment.
// A request goes draft → sent (to accounts: locked; its rent days count as billed) → invoiced (Xero number) → paid,
// or cancelled (its days are free to bill again).
import { db } from './supabase';
import { clean } from './scaffolding';
import { addDays } from './scafJobs';

const round2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown, max = 200) => { const t = clean(v).slice(0, max); return t || null; };
const long = (v: unknown, max = 4000) => { const t = String(v ?? '').replace(/\r/g, '').trim().slice(0, max); return t || null; };
const day = (v: unknown) => { const t = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const num = (v: unknown): number | null => { const t = clean(v).replace(/[£,\s%]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

// ---- the rent rules (pure) ------------------------------------------------------------------------
export interface HireScaffold { id: string; element: string | null; description?: string | null; price: number; hire_weeks: number | null; rent_pct: number | null; rent_weekly: number | null; handed_over_on: string | null; hire_stop_on: string | null; down_on: string | null; billed_to: string | null; status: string }
export const weeklyRate = (s: HireScaffold) => s.rent_weekly ?? (s.rent_pct !== null ? round2(s.price * s.rent_pct / 100) : null);
/** The first day rent is charged: the handover + the included weeks. */
export const rentFrom = (s: HireScaffold) => (s.handed_over_on ? addDays(s.handed_over_on, Math.round((s.hire_weeks ?? 0) * 7)) : null);
/** The last day of hire: the confirmed dismantle day (or the down date). */
export const hireStop = (s: HireScaffold) => s.hire_stop_on ?? s.down_on ?? null;
export interface RentLine { scaffold_id: string; description: string; period_from: string; period_to: string; days: number; weekly: number; amount: number }
/** The unbilled rent of a scaffold up to and including `upTo`, or null when nothing is due. */
export function rentLine(s: HireScaffold, upTo: string): RentLine | null {
  const from0 = rentFrom(s), w = weeklyRate(s);
  if (!from0 || w === null || w <= 0) return null;
  const from = s.billed_to && addDays(s.billed_to, 1) > from0 ? addDays(s.billed_to, 1) : from0;
  const stop = hireStop(s), to = stop && stop < upTo ? stop : upTo;
  if (to < from) return null;
  const days = daysBetween(from, to) + 1;
  return { scaffold_id: s.id, description: `Hire of ${s.element || 'scaffold'}${s.description ? ' — ' + s.description : ''}`, period_from: from, period_to: to, days, weekly: w, amount: round2(w * days / 7) };
}
export interface Totals { subtotal: number; retention: number; due: number; labour: number | null }
export function requestTotals(lines: { amount: number; labour?: number | null }[], retentionPct: number | null): Totals {
  const subtotal = round2(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const retention = retentionPct ? round2(subtotal * retentionPct / 100) : 0;
  const labour = lines.some((l) => l.labour != null) ? round2(lines.reduce((a, l) => a + (Number(l.labour) || 0), 0)) : null;
  return { subtotal, retention, due: round2(subtotal - retention), labour };
}
/** The scaffold's included hire ends within `days` from `on` (an alert: rent will start). */
export function includedEndsSoon(s: HireScaffold, on: string, days = 7) { const f = rentFrom(s); return !!f && s.status === 'on_hire' && f > on && daysBetween(on, f) <= days; }
export function lineFields(r: any, i: number): { ok: true; line: any } | { ok: false; error: string } {
  const amount = num(r.amount); if (amount === null || Number.isNaN(amount)) return { ok: false, error: `Line ${i + 1}: the amount is missing.` };
  const days = num(r.days), weekly = num(r.weekly), labour = num(r.labour);
  if ([days, weekly, labour].some((x) => Number.isNaN(x))) return { ok: false, error: `Line ${i + 1}: a number is wrong.` };
  return { ok: true, line: { scaffold_id: r.scaffold_id || null, description: long(r.description, 1000), period_from: day(r.period_from), period_to: day(r.period_to), days, weekly, labour, amount: round2(amount) } };
}

// ---- reads ----------------------------------------------------------------------------------------
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; }
  return out;
}
const asScaffold = (s: any): HireScaffold => ({ ...s, price: Number(s.price) || 0, hire_weeks: s.hire_weeks === null ? null : Number(s.hire_weeks), rent_pct: s.rent_pct === null ? null : Number(s.rent_pct), rent_weekly: s.rent_weekly === null ? null : Number(s.rent_weekly) });
const SC_COLS = 'id,job_id,element,description,price,hire_weeks,rent_pct,rent_weekly,handed_over_on,hire_stop_on,down_on,billed_to,status';
/** The Hire & invoicing page: what is due up to a day (per job), the hire alerts, and the requests. */
export async function hireOverview(tenantId: string, upTo: string, freq: string) {
  const scs = (await all<any>(() => db().from('scaf_scaffolds').select(SC_COLS).eq('tenant_id', tenantId).not('handed_over_on', 'is', null).order('id'))).map(asScaffold);
  const jobIds = [...new Set(scs.map((s: any) => s.job_id))];
  const jobs = jobIds.length ? await all<any>(() => db().from('scaf_jobs').select('id,number,title,customer_id,billing,stage').in('id', jobIds).order('id')) : [];
  const custIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const custs = custIds.length ? await all<any>(() => db().from('scaf_customers').select('id,name').in('id', custIds).order('id')) : [];
  const cm = new Map(custs.map((c) => [c.id, c.name])), jm = new Map(jobs.map((j) => [j.id, j]));
  const t = today();
  const due = new Map<string, { job: any; lines: RentLine[] }>();
  let onHire = 0, rentRunning = 0, endsSoon: any[] = [], unbilledToday = 0;
  for (const s of scs) {
    const j: any = jm.get((s as any).job_id); if (!j) continue;
    if (s.status === 'on_hire' || s.status === 'dismantle_requested' || s.status === 'dismantling') { onHire++; const f = rentFrom(s); if (f && f <= t) rentRunning++; }
    if (includedEndsSoon(s, t)) endsSoon.push({ job: j.number, job_id: j.id, element: s.element, rent_from: rentFrom(s), customer: cm.get(j.customer_id) ?? null });
    const now = rentLine(s, t); if (now) unbilledToday += now.amount;
    if (freq && freq !== 'all' && (j.billing || 'monthly') !== freq) continue;
    const l = rentLine(s, upTo); if (!l) continue;
    const e = due.get(j.id) ?? { job: { id: j.id, number: j.number, title: j.title, billing: j.billing || 'monthly', customer: cm.get(j.customer_id) ?? null }, lines: [] };
    e.lines.push(l); due.set(j.id, e);
  }
  const requests = await listRequests(tenantId);
  return {
    upTo, due: [...due.values()].map((e) => ({ ...e.job, lines: e.lines.length, days: e.lines.reduce((a, l) => a + l.days, 0), amount: round2(e.lines.reduce((a, l) => a + l.amount, 0)) })).sort((a, b) => b.number - a.number),
    stats: { onHire, rentRunning, unbilledToday: round2(unbilledToday), endsSoon: endsSoon.sort((a, b) => a.rent_from.localeCompare(b.rent_from)) },
    requests,
  };
}
export async function listRequests(tenantId: string, jobId?: string) {
  let q = db().from('scaf_invoice_requests').select('id,job_id,seq,kind,period_from,period_to,status,retention_pct,sent_on,invoiced_on,paid_on,payment_days,xero_number,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1000);
  if (jobId) q = q.eq('job_id', jobId);
  const { data, error } = await q; if (error) throw error;
  const reqs = (data ?? []) as any[]; if (!reqs.length) return [];
  const lines = await all<any>(() => db().from('scaf_invoice_lines').select('request_id,amount,labour').in('request_id', reqs.map((r) => r.id)).order('request_id'));
  const jobs = await all<any>(() => db().from('scaf_jobs').select('id,number,title,customer_id').in('id', [...new Set(reqs.map((r) => r.job_id))]).order('id'));
  const custIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const custs = custIds.length ? await all<any>(() => db().from('scaf_customers').select('id,name').in('id', custIds).order('id')) : [];
  const jm = new Map(jobs.map((j) => [j.id, j])), cm = new Map(custs.map((c) => [c.id, c.name]));
  const t = today();
  return reqs.map((r) => {
    const j: any = jm.get(r.job_id) ?? {}, tot = requestTotals(lines.filter((l) => l.request_id === r.id), r.retention_pct === null ? null : Number(r.retention_pct));
    const dueOn = r.invoiced_on && r.payment_days != null ? addDays(r.invoiced_on, r.payment_days) : null;
    return { ...r, ref: `ACESC${j.number}-R${r.seq}`, job: { id: j.id, number: j.number, title: j.title }, customer: cm.get(j.customer_id) ?? null, ...tot, due_on: dueOn, overdue: r.status === 'invoiced' && !!dueOn && dueOn < t };
  });
}
export async function getRequest(tenantId: string, id: string) {
  const { data: r, error } = await db().from('scaf_invoice_requests').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!r) return null;
  const { data: lines } = await db().from('scaf_invoice_lines').select('*').eq('request_id', id).order('position');
  const { data: j } = await db().from('scaf_jobs').select('id,number,title,customer_id,site_id,po_number,price,enquiry_id,contact_id').eq('id', (r as any).job_id).maybeSingle();
  const one = async (t: string, i: string | null) => { if (!i) return null; const { data } = await db().from(t).select('*').eq('id', i).maybeSingle(); return data as any; };
  const [customer, site, contact] = await Promise.all([one('scaf_customers', (j as any)?.customer_id), one('scaf_sites', (j as any)?.site_id), one('scaf_contacts', (j as any)?.contact_id)]);
  const ls = (lines ?? []).map((l: any) => ({ ...l, amount: Number(l.amount), days: l.days === null ? null : Number(l.days), weekly: l.weekly === null ? null : Number(l.weekly), labour: l.labour === null ? null : Number(l.labour) }));
  const rr: any = r;
  return { ...rr, ref: `ACESC${(j as any)?.number}-R${rr.seq}`, job: j, customer, site, contact, lines: ls, ...requestTotals(ls, rr.retention_pct === null ? null : Number(rr.retention_pct)) };
}

// ---- writes ---------------------------------------------------------------------------------------
async function newRequest(tenantId: string, jobId: string, userId: string, kind: string, lines: any[], period: [string | null, string | null]) {
  const { data: j } = await db().from('scaf_jobs').select('customer_id,po_number').eq('id', jobId).maybeSingle();
  const c = (j as any)?.customer_id ? (await db().from('scaf_customers').select('retention_pct,payment_days').eq('id', (j as any).customer_id).maybeSingle()).data as any : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db().from('scaf_invoice_requests').select('seq').eq('job_id', jobId).order('seq', { ascending: false }).limit(1);
    const seq = (((last ?? [])[0] as any)?.seq ?? 0) + 1;
    const r = await db().from('scaf_invoice_requests').insert({ tenant_id: tenantId, job_id: jobId, seq, kind, period_from: period[0], period_to: period[1], retention_pct: c?.retention_pct ?? null, payment_days: c?.payment_days ?? 30, po_number: (j as any)?.po_number ?? null, created_by: userId }).select('id').single();
    if (r.error) { if (/duplicate key/.test(r.error.message)) continue; return { ok: false as const, error: r.error.message }; }
    const id = (r.data as any).id;
    if (lines.length) { const i = await db().from('scaf_invoice_lines').insert(lines.map((l, k) => ({ ...l, tenant_id: tenantId, request_id: id, position: k }))); if (i.error) return { ok: false as const, error: i.error.message }; }
    return { ok: true as const, id };
  }
  return { ok: false as const, error: 'Could not number the request — try again.' };
}
/** Rent up to a day for a job (one draft request), unless there is nothing to bill or a draft already covers it. */
export async function rentRequest(tenantId: string, jobId: string, userId: string, upTo: string) {
  if (!day(upTo)) return { ok: false as const, error: 'Choose the day to bill up to.' };
  const { data: drafts } = await db().from('scaf_invoice_requests').select('id').eq('job_id', jobId).eq('kind', 'rent').eq('status', 'draft');
  if (drafts?.length) return { ok: false as const, error: 'This job has a rent request in draft — send or cancel it first.' };
  const { data } = await db().from('scaf_scaffolds').select(SC_COLS).eq('job_id', jobId).not('handed_over_on', 'is', null).order('position');
  const lines = (data ?? []).map(asScaffold).map((s) => rentLine(s, upTo)).filter((x): x is RentLine => !!x);
  if (!lines.length) return { ok: false as const, error: 'No rent to bill up to that day.' };
  return newRequest(tenantId, jobId, userId, 'rent', lines, [lines.reduce((a, l) => (l.period_from < a ? l.period_from : a), lines[0].period_from), upTo]);
}
export async function rentRun(tenantId: string, userId: string, upTo: string, jobIds: unknown) {
  const ids = (Array.isArray(jobIds) ? jobIds : []).map(String);
  const made: string[] = [], skipped: { job: string; why: string }[] = [];
  for (const id of ids) { const r = await rentRequest(tenantId, id, userId, upTo); if (r.ok) made.push(r.id); else skipped.push({ job: id, why: r.error }); }
  return { ok: true as const, made: made.length, skipped };
}
/** A part of the price (a stage) or another charge: { amount } or { pct } of the job price, with a description. */
export async function priceRequest(tenantId: string, jobId: string, userId: string, b: any) {
  const { data: j } = await db().from('scaf_jobs').select('price').eq('id', jobId).maybeSingle();
  const price = Number((j as any)?.price) || 0, pct = num(b?.pct), amount0 = num(b?.amount);
  if (Number.isNaN(pct) || Number.isNaN(amount0)) return { ok: false as const, error: 'The amount or % is not a number.' };
  const amount = amount0 ?? (pct !== null ? round2(price * pct / 100) : null);
  if (!amount) return { ok: false as const, error: 'Give an amount or a % of the price.' };
  const desc = txt(b?.description, 300) ?? (pct !== null ? `${pct}% of the price (£${price.toLocaleString('en-GB')})` : 'Scaffolding');
  const labour = num(b?.labour);
  return newRequest(tenantId, jobId, userId, b?.kind === 'other' ? 'other' : 'price', [{ description: desc, amount, labour: Number.isNaN(labour) ? null : labour }], [null, null]);
}
export async function saveRequest(tenantId: string, id: string, b: any) {
  const { data: r } = await db().from('scaf_invoice_requests').select('status').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!r) return { ok: false as const, error: 'Not found.' };
  if ((r as any).status !== 'draft') return { ok: false as const, error: 'A sent request cannot be changed — cancel it and raise a new one.' };
  const lines: any[] = [];
  for (const [i, x] of (Array.isArray(b?.lines) ? b.lines : []).entries()) { if (!clean(x?.description) && !clean(x?.amount)) continue; const v = lineFields(x, i); if (!v.ok) return v; lines.push(v.line); }
  if (!lines.length) return { ok: false as const, error: 'The request has no lines.' };
  const ret = num(b.retention_pct), pdays = num(b.payment_days);
  if (Number.isNaN(ret) || (ret !== null && (ret < 0 || ret > 50))) return { ok: false as const, error: 'Retention 0–50%.' };
  if (Number.isNaN(pdays) || (pdays !== null && (pdays < 0 || pdays > 365))) return { ok: false as const, error: 'Payment days 0–365.' };
  const u = await db().from('scaf_invoice_requests').update({ retention_pct: ret, payment_days: pdays === null ? null : Math.round(pdays), po_number: txt(b.po_number, 80), vat_note: long(b.vat_note, 600), notes: long(b.notes, 2000), edited_at: nowIso() }).eq('id', id);
  if (u.error) return { ok: false as const, error: u.error.message };
  await db().from('scaf_invoice_lines').delete().eq('request_id', id);
  const i = await db().from('scaf_invoice_lines').insert(lines.map((l, k) => ({ ...l, tenant_id: tenantId, request_id: id, position: k })));
  return i.error ? { ok: false as const, error: i.error.message } : { ok: true as const };
}
/** A scaffold's billed_to = the last rent day on a request that is not a draft or cancelled. */
async function refreshBilledTo(scaffoldIds: string[]) {
  for (const sid of [...new Set(scaffoldIds)]) {
    const { data: lines } = await db().from('scaf_invoice_lines').select('period_to,request_id').eq('scaffold_id', sid).not('period_to', 'is', null);
    const reqIds = [...new Set((lines ?? []).map((l: any) => l.request_id))];
    const { data: reqs } = reqIds.length ? await db().from('scaf_invoice_requests').select('id').in('id', reqIds).in('status', ['sent', 'invoiced', 'paid']) : { data: [] as any[] };
    const live = new Set((reqs ?? []).map((r: any) => r.id));
    const last = (lines ?? []).filter((l: any) => live.has(l.request_id)).map((l: any) => l.period_to).sort().pop() ?? null;
    await db().from('scaf_scaffolds').update({ billed_to: last }).eq('id', sid);
  }
}
export async function setRequestStatus(tenantId: string, id: string, b: any) {
  const { data: r } = await db().from('scaf_invoice_requests').select('status').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!r) return { ok: false as const, error: 'Not found.' };
  const from = (r as any).status, to = String(b?.status ?? ''), d = day(b?.day) ?? today();
  const allowed: Record<string, string[]> = { draft: ['sent', 'cancelled'], sent: ['invoiced', 'cancelled', 'draft'], invoiced: ['paid', 'sent'], paid: ['invoiced'], cancelled: [] };
  if (!allowed[from]?.includes(to)) return { ok: false as const, error: `A ${from} request cannot become ${to}.` };
  const f: Record<string, unknown> = { status: to, edited_at: nowIso() };
  if (to === 'sent' && from === 'draft') f.sent_on = d;
  if (to === 'draft') f.sent_on = null;
  if (to === 'invoiced' && from === 'sent') { const x = txt(b?.xero_number, 60); if (!x) return { ok: false as const, error: 'Give the Xero invoice number.' }; f.xero_number = x; f.invoiced_on = d; }
  if (to === 'sent' && from === 'invoiced') { f.xero_number = null; f.invoiced_on = null; }
  if (to === 'paid') f.paid_on = d;
  if (to === 'invoiced' && from === 'paid') f.paid_on = null;
  const u = await db().from('scaf_invoice_requests').update(f).eq('id', id);
  if (u.error) return { ok: false as const, error: u.error.message };
  const { data: ls } = await db().from('scaf_invoice_lines').select('scaffold_id').eq('request_id', id).not('scaffold_id', 'is', null);
  if (ls?.length) await refreshBilledTo((ls as any[]).map((l) => l.scaffold_id));
  return { ok: true as const };
}
export async function deleteRequest(tenantId: string, id: string) {
  const { data: r } = await db().from('scaf_invoice_requests').select('status').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!r) return { ok: false as const, error: 'Not found.' };
  if ((r as any).status !== 'draft') return { ok: false as const, error: 'Only a draft can be deleted (cancel a sent one).' };
  const d = await db().from('scaf_invoice_requests').delete().eq('id', id);
  return d.error ? { ok: false as const, error: d.error.message } : { ok: true as const };
}
