// ACE Scaffolding — phase 2: jobs and contracts. A job (ACESC####) holds scaffolds — each element that goes up,
// from the accepted quote's lines or added later as a variation / adaption — and each scaffold has its own life:
//   booked → erecting (up, not yet handed over) → on hire (handover certificate: the hire starts)
//          → dismantle requested (who, when — logged with the time it was entered) → dismantling → down.
// The job's status follows its scaffolds (it can still be set by hand). The planner holds the visits (erect, adapt,
// inspect, dismantle, deliver, collect) per day and crew; a done erect / dismantle visit moves its scaffolds on.
// The handover certificate (signed by the client) is a PDF (scafHandoverPdf.ts).
import { db } from './supabase';
import { clean } from './scaffolding';

export const CHECKS: [string, string][] = [
  ['rams', 'RAMS sent'], ['design', 'Design / TG20 compliance sheet'], ['licence', 'Pavement / highway licence'], ['alarm', 'Scaffold alarm'],
  ['hoist', 'Hoist / loading bay'], ['access', 'Site access and parking agreed'], ['neighbours', 'Neighbour / party wall access'], ['inspection', '7-day inspections booked'],
];
export const VISIT_KINDS = ['erect', 'adapt', 'inspect', 'dismantle', 'deliver', 'collect'] as const;
export const SCAFFOLD_STATUSES = ['booked', 'erecting', 'on_hire', 'dismantle_requested', 'dismantling', 'down'] as const;
export type ScaffoldStatus = typeof SCAFFOLD_STATUSES[number];

const txt = (v: unknown, max = 200) => { const t = clean(v).slice(0, max); return t || null; };
const long = (v: unknown, max = 4000) => { const t = String(v ?? '').replace(/\r/g, '').trim().slice(0, max); return t || null; };
const day = (v: unknown) => { const t = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const num = (v: unknown): number | null => { const t = clean(v).replace(/[£,\s]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };
const nowIso = () => new Date().toISOString();
const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---- pure rules ------------------------------------------------------------------------------------
/** The job's status from its scaffolds (null = leave the job as it is: no scaffolds, or nothing has started). */
export function jobStageFrom(statuses: string[]): string | null {
  if (!statuses.length) return null;
  const has = (s: string) => statuses.includes(s), all = (s: string) => statuses.every((x) => x === s);
  if (all('down')) return 'down';
  if (has('on_hire')) return has('down') ? 'part_dismantled' : 'still_up';
  if (has('dismantle_requested') || has('dismantling')) return has('down') ? 'part_dismantled' : 'ready_for_dismantle';
  if (has('down')) return 'part_dismantled';
  if (has('erecting')) return 'ongoing';
  return null;
}
/** When the included hire of a scaffold ends (its rent starts): the handover day + the included weeks. */
export const hireEnds = (handedOver: string | null, weeks: number | null) => (handedOver ? addDays(handedOver, Math.round((weeks ?? 0) * 7)) : null);
export function checklistValue(v: unknown): Record<string, { state: 'todo' | 'done' | 'na'; on: string | null; note: string | null }> {
  const out: Record<string, any> = {}, src: any = v && typeof v === 'object' ? v : {};
  for (const [k] of CHECKS) {
    const x = src[k]; if (!x) continue;
    const state = ['todo', 'done', 'na'].includes(x.state) ? x.state : 'todo';
    out[k] = { state, on: day(x.on), note: txt(x.note, 200) };
  }
  return out;
}
export function scaffoldFields(b: any, creating: boolean): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const f: Record<string, unknown> = {};
  for (const k of ['element', 'tag', 'confirmed_by'] as const) if (k in b) f[k] = txt(b[k], 120);
  if ('description' in b) f.description = long(b.description, 2000);
  if ('variation' in b) f.variation = !!b.variation;
  if ('confirmed_on' in b) f.confirmed_on = day(b.confirmed_on);
  if ('hire_stop_on' in b) f.hire_stop_on = day(b.hire_stop_on);   // the dismantle day the team confirms (hire stops)
  for (const k of ['price', 'labour', 'hire_weeks', 'rent_pct', 'rent_weekly'] as const) if (k in b) { const n = num(b[k]); if (Number.isNaN(n)) return { ok: false, error: `${k.replace(/_/g, ' ')} is not a number.` }; f[k] = k === 'price' ? n ?? 0 : n; }
  if (creating && !f.element && !f.description) return { ok: false, error: 'Say what the scaffold is (element or description).' };
  if (f.labour != null && f.price != null && (f.labour as number) > (f.price as number)) return { ok: false, error: 'The labour part is more than the price.' };
  if (f.variation && creating && !f.confirmed_by) return { ok: false, error: 'A variation needs who confirmed it in writing.' };
  return { ok: true, fields: f };
}

// ---- reads --------------------------------------------------------------------------------------------
export async function getJobFull(tenantId: string, id: string) {
  const { data: j, error } = await db().from('scaf_jobs').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!j) return null;
  const one = async (t: string, i: string | null, cols = '*') => { if (!i) return null; const { data } = await db().from(t).select(cols).eq('id', i).maybeSingle(); return data as any; };
  const list = async (t: string, cols: string, order: string) => { const r = await db().from(t).select(cols).eq('job_id', id).order(order); if (r.error) throw r.error; return (r.data ?? []) as any[]; };
  const [customer, site, enquiry, contact, scaffolds, visits, handovers, crews] = await Promise.all([
    one('scaf_customers', j.customer_id, 'id,name,phone,email'), one('scaf_sites', j.site_id), one('scaf_enquiries', j.enquiry_id, 'id,number,title,stage,price'), one('scaf_contacts', j.contact_id, 'id,name,phone,email'),
    list('scaf_scaffolds', '*', 'position'), list('scaf_visits', '*', 'day'), list('scaf_handovers', 'id,day,scaffold_ids,ace_person,client_name,max_load,notes,created_at', 'day'), listCrews(tenantId),
  ]);
  const contacts = j.customer_id ? ((await db().from('scaf_contacts').select('id,name,phone').eq('customer_id', j.customer_id).order('name')).data ?? []) : [];
  const crewName = new Map(crews.map((c: any) => [c.id, c.name]));
  return { ...j, customer, site, enquiry, contact, contacts, crews, checks: CHECKS,
    scaffolds: scaffolds.map((s) => ({ ...s, price: Number(s.price), hire_ends: hireEnds(s.handed_over_on, s.hire_weeks === null ? null : Number(s.hire_weeks)) })),
    visits: visits.map((v) => ({ ...v, crew: v.crew_id ? crewName.get(v.crew_id) ?? null : null })), handovers };
}
export async function listCrews(tenantId: string) {
  const r1 = await db().from('scaf_crews').select('id,name,kind,phone,notes,active,members').eq('tenant_id', tenantId).order('name');
  const { data, error } = r1.error && /members/.test(r1.error.message) ? await db().from('scaf_crews').select('id,name,kind,phone,notes,active').eq('tenant_id', tenantId).order('name') : r1;   // before 0102
  if (error) throw error; return data ?? [];
}
/** Planner: visits between two days (inclusive) with their job, site and crew. */
export async function listVisits(tenantId: string, from: string, to: string) {
  const { data, error } = await db().from('scaf_visits').select('*').eq('tenant_id', tenantId).lte('day', to).gte('day', addDays(from, -30)).order('day');
  if (error) throw error;
  const rows = (data ?? []).filter((v: any) => addDays(v.day, Math.max(1, v.days) - 1) >= from);   // a multi-day visit that started before `from`
  const jobIds = [...new Set(rows.map((v: any) => v.job_id))];
  const jobs = jobIds.length ? (await db().from('scaf_jobs').select('id,number,title,site_id,customer_id,stage').in('id', jobIds)).data ?? [] : [];
  const siteIds = [...new Set(jobs.map((j: any) => j.site_id).filter(Boolean))], custIds = [...new Set(jobs.map((j: any) => j.customer_id).filter(Boolean))];
  const sites = siteIds.length ? (await db().from('scaf_sites').select('id,address,postcode').in('id', siteIds)).data ?? [] : [];
  const custs = custIds.length ? (await db().from('scaf_customers').select('id,name').in('id', custIds)).data ?? [] : [];
  const jm = new Map(jobs.map((j: any) => [j.id, j])), sm = new Map(sites.map((s: any) => [s.id, s])), cm = new Map(custs.map((c: any) => [c.id, c.name]));
  return rows.map((v: any) => { const j: any = jm.get(v.job_id) ?? {}; return { ...v, job: { id: j.id, number: j.number, title: j.title, stage: j.stage, customer: cm.get(j.customer_id) ?? null, address: (sm.get(j.site_id) as any)?.address ?? null } }; });
}
/** Jobs to pick from in the planner: the active ones (not down), newest first. */
export async function activeJobs(tenantId: string) {
  const { data, error } = await db().from('scaf_jobs').select('id,number,title,stage').eq('tenant_id', tenantId).not('stage', 'in', '(down,na)').order('number', { ascending: false }).limit(800);
  if (error) throw error; return data ?? [];
}

// ---- writes -------------------------------------------------------------------------------------------
async function refreshStage(jobId: string) {
  const { data } = await db().from('scaf_scaffolds').select('status').eq('job_id', jobId);
  const st = jobStageFrom((data ?? []).map((s: any) => s.status));
  if (st) await db().from('scaf_jobs').update({ stage: st, edited_at: nowIso() }).eq('id', jobId);
}
export async function saveJob(tenantId: string, id: string, b: any) {
  const f: Record<string, unknown> = {};
  for (const k of ['title', 'erector', 'po_number'] as const) if (k in b) f[k] = txt(b[k], k === 'title' ? 200 : 120);
  if ('notes' in b) f.notes = long(b.notes);
  for (const k of ['contact_id', 'site_id'] as const) if (k in b) f[k] = b[k] || null;
  if ('checklist' in b) f.checklist = checklistValue(b.checklist);
  if ('stage' in b) f.stage = clean(b.stage) || 'upcoming';
  if ('billing' in b) f.billing = b.billing === 'weekly' ? 'weekly' : 'monthly';
  const r = await db().from('scaf_jobs').update({ ...f, edited_at: nowIso() }).eq('tenant_id', tenantId).eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
export async function addScaffold(tenantId: string, jobId: string, b: any) {
  const v = scaffoldFields(b ?? {}, true); if (!v.ok) return v;
  const { data: last } = await db().from('scaf_scaffolds').select('position').eq('job_id', jobId).order('position', { ascending: false }).limit(1);
  const r = await db().from('scaf_scaffolds').insert({ tenant_id: tenantId, job_id: jobId, position: ((last ?? [])[0] as any)?.position + 1 || 0, ...v.fields }).select('id').single();
  if (r.error) return { ok: false as const, error: r.error.message };
  if (v.fields.variation && v.fields.price) {   // a variation adds to the job's value
    const { data: j } = await db().from('scaf_jobs').select('price').eq('id', jobId).maybeSingle();
    await db().from('scaf_jobs').update({ price: Math.round(((Number((j as any)?.price) || 0) + Number(v.fields.price)) * 100) / 100 }).eq('id', jobId);
  }
  return { ok: true as const, id: (r.data as any).id };
}
export async function updateScaffold(tenantId: string, id: string, b: any) {
  const v = scaffoldFields(b ?? {}, false); if (!v.ok) return v;
  const r = await db().from('scaf_scaffolds').update({ ...v.fields, edited_at: nowIso() }).eq('tenant_id', tenantId).eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
export async function deleteScaffold(tenantId: string, id: string) {
  const { data: s } = await db().from('scaf_scaffolds').select('status,job_id').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!s) return { ok: false as const, error: 'Not found.' };
  if ((s as any).status !== 'booked') return { ok: false as const, error: 'Only a scaffold not yet started can be removed.' };
  await db().from('scaf_scaffolds').delete().eq('id', id);
  return { ok: true as const };
}
/** Moves scaffolds on: erecting (up), dismantle_requested (who / when), dismantling, down, or back to an earlier step. */
export async function setScaffoldStatus(tenantId: string, jobId: string, b: any) {
  const list = ids(b.ids), status = String(b.status ?? '') as ScaffoldStatus, d = day(b.day) ?? new Date().toISOString().slice(0, 10);
  if (!list.length) return { ok: false as const, error: 'Tick the scaffolds.' };
  if (!SCAFFOLD_STATUSES.includes(status)) return { ok: false as const, error: 'Unknown status.' };
  const f: Record<string, unknown> = { status, edited_at: nowIso() };
  if (status === 'erecting') f.erected_on = d;
  if (status === 'on_hire') f.handed_over_on = d;
  if (status === 'dismantle_requested') {
    const by = txt(b.by, 120); if (!by) return { ok: false as const, error: 'Who asked for the dismantle?' };
    Object.assign(f, { dismantle_requested_on: d, dismantle_requested_by: by, dismantle_request_logged_at: nowIso() });
  }
  if (status === 'down') f.down_on = d;   // hire_stop_on is set below where still empty
  const r = await db().from('scaf_scaffolds').update(f).eq('tenant_id', tenantId).eq('job_id', jobId).in('id', list);
  if (r.error) return { ok: false as const, error: r.error.message };
  if (status === 'dismantle_requested') await db().from('scaf_jobs').update({ dismantle_request: d }).eq('id', jobId);
  if (status === 'down') { await db().from('scaf_jobs').update({ down_date: d }).eq('id', jobId); await db().from('scaf_scaffolds').update({ hire_stop_on: d }).eq('job_id', jobId).in('id', list).is('hire_stop_on', null); }
  await refreshStage(jobId);
  return { ok: true as const };
}
export async function saveCrew(tenantId: string, id: string | null, b: any) {
  const name = txt(b?.name, 80); if (!name) return { ok: false as const, error: 'Give the crew a name.' };
  const f = { name, kind: b.kind === 'sub' ? 'sub' : 'own', phone: txt(b.phone, 60), notes: txt(b.notes, 300), active: b.active !== false };
  const r = id ? await db().from('scaf_crews').update(f).eq('tenant_id', tenantId).eq('id', id) : await db().from('scaf_crews').insert({ tenant_id: tenantId, ...f });
  return r.error ? { ok: false as const, error: /scaf_crews_name|duplicate/.test(r.error.message) ? 'There is a crew with this name.' : r.error.message } : { ok: true as const };
}
export function visitFields(b: any): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const kind = String(b?.kind ?? ''); if (!(VISIT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'Choose what the visit is for.' };
  const d = day(b.day); if (!d) return { ok: false, error: 'Choose the day.' };
  const days = Math.round(Number(b.days ?? 1)); if (!(days >= 1 && days <= 60)) return { ok: false, error: 'Days: 1–60.' };
  const status = ['planned', 'done', 'cancelled'].includes(b.status) ? b.status : 'planned';
  return { ok: true, fields: { kind, day: d, days, crew_id: b.crew_id || null, scaffold_ids: ids(b.scaffold_ids), status, notes: long(b.notes, 1000) } };
}
/** Saves a visit. Marking an erect visit done puts its scaffolds up (erecting); a dismantle visit done takes them down. */
export async function saveVisit(tenantId: string, id: string | null, b: any) {
  const v = visitFields(b ?? {}); if (!v.ok) return v;
  let jobId = b.job_id as string;
  if (id) {
    const { data: old } = await db().from('scaf_visits').select('job_id,status').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!old) return { ok: false as const, error: 'Not found.' };
    jobId = (old as any).job_id;
    const r = await db().from('scaf_visits').update({ ...v.fields, edited_at: nowIso() }).eq('id', id);
    if (r.error) return { ok: false as const, error: r.error.message };
  } else {
    if (!jobId) return { ok: false as const, error: 'Which job?' };
    const r = await db().from('scaf_visits').insert({ tenant_id: tenantId, job_id: jobId, ...v.fields }).select('id').single();
    if (r.error) return { ok: false as const, error: r.error.message };
    id = (r.data as any).id;
  }
  const sc = v.fields.scaffold_ids as string[];
  if (v.fields.status === 'done' && sc.length) {
    const last = addDays(v.fields.day as string, (v.fields.days as number) - 1);
    if (v.fields.kind === 'erect') await db().from('scaf_scaffolds').update({ status: 'erecting', erected_on: last, edited_at: nowIso() }).eq('job_id', jobId).in('id', sc).eq('status', 'booked');
    if (v.fields.kind === 'dismantle') await db().from('scaf_scaffolds').update({ status: 'down', down_on: last, edited_at: nowIso() }).eq('job_id', jobId).in('id', sc).neq('status', 'down');
    if (v.fields.kind === 'dismantle') { await db().from('scaf_jobs').update({ down_date: last }).eq('id', jobId); await db().from('scaf_scaffolds').update({ hire_stop_on: last }).eq('job_id', jobId).in('id', sc).is('hire_stop_on', null); }
    await refreshStage(jobId);
  } else if (v.fields.kind === 'dismantle' && v.fields.status === 'planned' && sc.length) {
    await db().from('scaf_scaffolds').update({ status: 'dismantling', edited_at: nowIso() }).eq('job_id', jobId).in('id', sc).eq('status', 'dismantle_requested');
    await db().from('scaf_jobs').update({ dismantle_start: v.fields.day }).eq('id', jobId);
    await refreshStage(jobId);
  }
  return { ok: true as const, id };
}
export async function deleteVisit(tenantId: string, id: string) {
  const r = await db().from('scaf_visits').delete().eq('tenant_id', tenantId).eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
/** The handover certificate: the ticked scaffolds go on hire from that day. */
export async function createHandover(tenantId: string, jobId: string, userId: string, b: any) {
  const d = day(b?.day); if (!d) return { ok: false as const, error: 'Choose the handover day.' };
  const list = ids(b.scaffold_ids); if (!list.length) return { ok: false as const, error: 'Tick the scaffolds handed over.' };
  const client = txt(b.client_name, 120); if (!client) return { ok: false as const, error: 'Who received it for the client?' };
  // the signature: a PNG from the office screen, or the strokes drawn on the phone ("svg:<w>x<h>:<path>")
  const sig = typeof b.signature === 'string' && b.signature.length < 400_000 && (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature) || /^svg:\d{2,4}x\d{2,4}:[ML0-9 .,-]{3,}$/.test(b.signature)) ? b.signature : null;
  const r = await db().from('scaf_handovers').insert({ tenant_id: tenantId, job_id: jobId, day: d, scaffold_ids: list, ace_person: txt(b.ace_person, 120), client_name: client, signature: sig, max_load: txt(b.max_load, 120), notes: long(b.notes, 2000), created_by: userId }).select('id').single();
  if (r.error) return { ok: false as const, error: r.error.message };
  await db().from('scaf_scaffolds').update({ status: 'on_hire', handed_over_on: d, edited_at: nowIso() }).eq('job_id', jobId).in('id', list).in('status', ['booked', 'erecting']);
  await db().from('scaf_jobs').update({ handover: 'YES', rent_start: d }).eq('id', jobId).is('rent_start', null);
  await refreshStage(jobId);
  return { ok: true as const, id: (r.data as any).id };
}
export async function handoverPdfData(tenantId: string, id: string) {
  const { data: h } = await db().from('scaf_handovers').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!h) return null;
  const job = await getJobFull(tenantId, (h as any).job_id);
  return { handover: h as any, job };
}

// ---- actual costs (scaf_job_costs, migration 0103) ----------------------------------------------------
export const COST_CATEGORIES: [string, string][] = [['crew', 'Crew (own)'], ['subcontractor', 'Subcontractor'], ['transport', 'Transport'], ['materials', 'Materials / hire-in'], ['licence', 'Licence / permits'], ['other', 'Other']];
export function costFields(b: any): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const d = day(b?.day); if (!d) return { ok: false, error: 'Choose the day.' };
  const amount = num(b.amount); if (amount === null || Number.isNaN(amount) || amount === 0) return { ok: false, error: 'Give the amount (£).' };
  const phase = ['up', 'down', 'other'].includes(b.phase) ? b.phase : 'up';
  const category = COST_CATEGORIES.some(([k]) => k === b.category) ? b.category : 'other';
  return { ok: true, fields: { day: d, phase, category, supplier: txt(b.supplier, 120), description: txt(b.description, 300), amount } };
}
/** The totals of a job's costs: the lines per phase, plus what monday had as actual cost up / down. */
export function costTotals(lines: { phase: string; amount: number }[], mondayUp: number | null, mondayDown: number | null) {
  const s = (p: string) => Math.round(lines.filter((l) => l.phase === p).reduce((a, l) => a + Number(l.amount), 0) * 100) / 100;
  const up = Math.round((s('up') + (mondayUp ?? 0)) * 100) / 100, down = Math.round((s('down') + (mondayDown ?? 0)) * 100) / 100, other = s('other');
  return { up, down, other, total: Math.round((up + down + other) * 100) / 100, any: lines.length > 0 || mondayUp !== null || mondayDown !== null };
}
export async function listCosts(tenantId: string, jobId: string) {
  const { data, error } = await db().from('scaf_job_costs').select('id,day,phase,category,supplier,description,amount').eq('tenant_id', tenantId).eq('job_id', jobId).order('day').order('created_at');
  if (error) throw error;
  const { data: j } = await db().from('scaf_jobs').select('actual_cost_up,actual_cost_down,price,enquiry_id').eq('id', jobId).maybeSingle();
  const jj: any = j ?? {};
  const lines = (data ?? []).map((l: any) => ({ ...l, amount: Number(l.amount) }));
  const mUp = jj.actual_cost_up === null || jj.actual_cost_up === undefined ? null : Number(jj.actual_cost_up), mDown = jj.actual_cost_down === null || jj.actual_cost_down === undefined ? null : Number(jj.actual_cost_down);
  let est: any = null;
  if (jj.enquiry_id) { const { data: e } = await db().from('scaf_enquiries').select('est_cost_up,est_cost_down').eq('id', jj.enquiry_id).maybeSingle(); if (e) est = { up: (e as any).est_cost_up === null ? null : Number((e as any).est_cost_up), down: (e as any).est_cost_down === null ? null : Number((e as any).est_cost_down) }; }
  return { lines, monday: { up: mUp, down: mDown }, totals: costTotals(lines, mUp, mDown), estimate: est, price: jj.price === null || jj.price === undefined ? null : Number(jj.price), categories: COST_CATEGORIES };
}
export async function saveCost(tenantId: string, userId: string, jobId: string | null, id: string | null, b: any) {
  const v = costFields(b); if (!v.ok) return v;
  const r = id ? await db().from('scaf_job_costs').update(v.fields).eq('tenant_id', tenantId).eq('id', id)
    : await db().from('scaf_job_costs').insert({ tenant_id: tenantId, job_id: jobId, created_by: userId, ...v.fields });
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
export async function deleteCost(tenantId: string, id: string) {
  const r = await db().from('scaf_job_costs').delete().eq('tenant_id', tenantId).eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
