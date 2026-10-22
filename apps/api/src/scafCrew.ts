// ACE Scaffolding — phase 4: the phone app for crews. The phone calls the office server (/api/scaf/crew/…) with the
// user's sign-in; every rule (handover starts the hire, notes move stock, a done dismantle stops the hire) is the one
// the office uses (scafJobs.ts, scafStock.ts). Here: the crew's day, inspections and their photos.
//   · a scaffolder sees the visits of the crews they are a member of (Planner ▸ Crews); the office and admin see all;
//   · 7-day inspections (Work at Height Regulations 2005): a scaffold in use is due when it has had no inspection
//     since its handover, or the last one is 7 days old or more.
import { randomUUID } from 'node:crypto';
import { db } from './supabase';
import { clean } from './scaffolding';
import { addDays, saveVisit } from './scafJobs';

export const BUCKET = 'scaffolding';
export const IN_USE = ['on_hire', 'dismantle_requested', 'dismantling'];
const txt = (v: unknown, max = 300) => { const t = clean(v).slice(0, max); return t || null; };
const long = (v: unknown, max = 2000) => { const t = String(v ?? '').replace(/\r/g, '').trim().slice(0, max); return t || null; };
const day = (v: unknown) => { const t = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const isId = (v: unknown) => /^[0-9a-f-]{36}$/.test(String(v ?? ''));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

// ---- pure rules ------------------------------------------------------------------------------------
/** When a scaffold in use next needs its inspection: 7 days after the last one (or after the handover, if none). */
export function inspectionDue(s: { status: string; handed_over_on: string | null }, lastInspection: string | null): string | null {
  if (!IN_USE.includes(s.status)) return null;
  const from = lastInspection && (!s.handed_over_on || lastInspection >= s.handed_over_on) ? lastInspection : null;
  return from ? addDays(from, 7) : (s.handed_over_on ?? null);
}
export function inspectionInput(b: any): { ok: true; rows: any[] } | { ok: false; error: string } {
  const ids = (Array.isArray(b?.scaffold_ids) ? b.scaffold_ids : []).filter(isId);
  if (!ids.length) return { ok: false, error: 'Tick the scaffolds inspected.' };
  if (typeof b.safe !== 'boolean') return { ok: false, error: 'Is it safe to use?' };
  const reason = ['first_use', 'weekly', 'weather', 'alteration', 'other'].includes(b.reason) ? b.reason : 'weekly';
  const defects = long(b.defects);
  if (!b.safe && !defects) return { ok: false, error: 'Say what is wrong.' };
  const d = day(b.day) ?? new Date().toISOString().slice(0, 10);
  return { ok: true, rows: ids.map((id: string) => ({ scaffold_id: id, day: d, reason, safe: b.safe, defects, actions: long(b.actions), inspector: txt(b.inspector, 120) })) };
}
/** A signature drawn on the phone: "svg:<w>x<h>:<path>" (moves and lines only). */
export const isSvgSignature = (v: unknown) => typeof v === 'string' && /^svg:\d{2,4}x\d{2,4}:[ML0-9 .,-]{3,200000}$/.test(v);

// ---- reads ----------------------------------------------------------------------------------------
async function myCrews(tenantId: string, userId: string) {
  const { data } = await db().from('scaf_crews').select('id,name,members').eq('tenant_id', tenantId);
  return (data ?? []).filter((c: any) => (c.members ?? []).includes(userId)) as any[];
}
/** The crew's day: the visits on that day (a multi-day visit shows on each of its days), with the job, site,
 *  contact and scaffolds — the user's crews, or every crew for the office / admin (all=true). */
export async function crewDay(tenantId: string, userId: string, d: string, all: boolean) {
  const crews = await myCrews(tenantId, userId);
  let q = db().from('scaf_visits').select('*').eq('tenant_id', tenantId).lte('day', d).gte('day', addDays(d, -60)).neq('status', 'cancelled').order('day');
  if (!all) { if (!crews.length) return { crews, visits: [] }; q = q.in('crew_id', crews.map((c) => c.id)); }
  const { data, error } = await q; if (error) throw error;
  const visits = (data ?? []).filter((v: any) => addDays(v.day, Math.max(1, v.days) - 1) >= d) as any[];
  const jobIds = [...new Set(visits.map((v) => v.job_id))];
  if (!jobIds.length) return { crews, visits: [] };
  const [jobs, scs, allCrews] = await Promise.all([
    db().from('scaf_jobs').select('id,number,title,site_id,customer_id,contact_id,notes,checklist').in('id', jobIds).then((r: any) => r.data ?? []),
    db().from('scaf_scaffolds').select('id,job_id,element,description,tag,status,handed_over_on,down_on,hire_stop_on').in('job_id', jobIds).order('position').then((r: any) => r.data ?? []),
    db().from('scaf_crews').select('id,name').eq('tenant_id', tenantId).then((r: any) => r.data ?? []),
  ]);
  const ids = (k: string) => [...new Set(jobs.map((j: any) => j[k]).filter(Boolean))];
  const [sites, custs, contacts] = await Promise.all([
    ids('site_id').length ? db().from('scaf_sites').select('id,address,postcode,access_notes').in('id', ids('site_id')).then((r: any) => r.data ?? []) : [],
    ids('customer_id').length ? db().from('scaf_customers').select('id,name,phone').in('id', ids('customer_id')).then((r: any) => r.data ?? []) : [],
    ids('contact_id').length ? db().from('scaf_contacts').select('id,name,phone').in('id', ids('contact_id')).then((r: any) => r.data ?? []) : [],
  ]);
  const by = (rows: any[]) => new Map(rows.map((r) => [r.id, r]));
  const jm = by(jobs), sm = by(sites as any[]), cm = by(custs as any[]), km = by(contacts as any[]), crm = by(allCrews);
  return { crews, visits: visits.map((v) => { const j: any = jm.get(v.job_id) ?? {}; return { ...v, crew: (crm.get(v.crew_id) as any)?.name ?? null,
    job: { id: j.id, number: j.number, title: j.title, notes: j.notes, site: sm.get(j.site_id) ?? null, customer: cm.get(j.customer_id) ?? null, contact: km.get(j.contact_id) ?? null, scaffolds: scs.filter((s: any) => s.job_id === j.id) } }; }) };
}
/** Scaffolds in use that need their 7-day inspection by `upTo` (overdue first). */
export async function inspectionsDue(tenantId: string, today: string, upTo: string) {
  const { data: scs, error } = await db().from('scaf_scaffolds').select('id,job_id,element,tag,status,handed_over_on').eq('tenant_id', tenantId).in('status', IN_USE);
  if (error) throw error;
  const ids = (scs ?? []).map((s: any) => s.id); if (!ids.length) return [];
  const { data: ins } = await db().from('scaf_inspections').select('scaffold_id,day').in('scaffold_id', ids);
  const last = new Map<string, string>(); for (const i of (ins ?? []) as any[]) if ((last.get(i.scaffold_id) ?? '') < i.day) last.set(i.scaffold_id, i.day);
  const due = (scs as any[]).map((s) => ({ ...s, last: last.get(s.id) ?? null, due: inspectionDue(s, last.get(s.id) ?? null) })).filter((s) => s.due && s.due <= upTo);
  const jobIds = [...new Set(due.map((s) => s.job_id))];
  const jobs = jobIds.length ? ((await db().from('scaf_jobs').select('id,number,title,site_id').in('id', jobIds)).data ?? []) as any[] : [];
  const siteIds = [...new Set(jobs.map((j) => j.site_id).filter(Boolean))];
  const sites = siteIds.length ? ((await db().from('scaf_sites').select('id,address,postcode').in('id', siteIds)).data ?? []) as any[] : [];
  const jm = new Map(jobs.map((j) => [j.id, j])), sm = new Map(sites.map((s) => [s.id, s]));
  return due.map((s) => { const j: any = jm.get(s.job_id) ?? {}; return { ...s, overdue: daysBetween(s.due!, today), job: { id: j.id, number: j.number, title: j.title, site: sm.get(j.site_id) ?? null } }; })
    .sort((a, b) => a.due!.localeCompare(b.due!));
}
export async function listInspections(tenantId: string, jobId: string) {
  const { data, error } = await db().from('scaf_inspections').select('*').eq('tenant_id', tenantId).eq('job_id', jobId).order('day', { ascending: false });
  if (error) throw error; return data ?? [];
}
export async function photoUrls(tenantId: string, paths: string[]) {
  const ok = paths.filter((p) => p.startsWith(tenantId + '/')).slice(0, 20); if (!ok.length) return [];
  const { data } = await db().storage.from(BUCKET).createSignedUrls(ok, 3600);
  return (data ?? []).map((d: any) => d.signedUrl).filter(Boolean);
}

// ---- writes ---------------------------------------------------------------------------------------
/** Inspections of one or more scaffolds of a job, with up to 4 photos (JPEG base64). */
export async function saveInspection(tenantId: string, userId: string, jobId: string, b: any) {
  const v = inspectionInput(b); if (!v.ok) return v;
  const { data: scs } = await db().from('scaf_scaffolds').select('id').eq('job_id', jobId).in('id', v.rows.map((r) => r.scaffold_id));
  if ((scs ?? []).length !== v.rows.length) return { ok: false as const, error: 'A scaffold is not on this job.' };
  const photos: string[] = [];
  for (const p of (Array.isArray(b.photos) ? b.photos : []).slice(0, 4)) {
    const b64 = String(p ?? '').replace(/^data:image\/jpeg;base64,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > 3_000_000) continue;
    const path = `${tenantId}/inspections/${jobId}/${randomUUID()}.jpg`;
    const up = await db().storage.from(BUCKET).upload(path, Buffer.from(b64, 'base64'), { contentType: 'image/jpeg' });
    if (!up.error) photos.push(path);
  }
  const r = await db().from('scaf_inspections').insert(v.rows.map((x) => ({ ...x, tenant_id: tenantId, job_id: jobId, photos, created_by: userId })));
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const, photos: photos.length };
}
/** A visit done on site. A dismantle reports the day the hire stops (the team's confirmed dismantle day). */
export async function visitDone(tenantId: string, id: string, b: any) {
  const { data: v } = await db().from('scaf_visits').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!v) return { ok: false as const, error: 'Not found.' };
  const vv: any = v;
  const note = long(b?.notes, 1000);
  const r = await saveVisit(tenantId, id, { kind: vv.kind, day: vv.day, days: vv.days, crew_id: vv.crew_id, scaffold_ids: vv.scaffold_ids, status: 'done', notes: [vv.notes, note].filter(Boolean).join(' · ') || null });
  if (!r.ok) return r;
  const stop = day(b?.hire_stop_on);
  if (vv.kind === 'dismantle' && stop && (vv.scaffold_ids ?? []).length) await db().from('scaf_scaffolds').update({ hire_stop_on: stop }).eq('job_id', vv.job_id).in('id', vv.scaffold_ids);
  return { ok: true as const };
}
export async function crewUsers(tenantId: string) {
  const { data } = await db().from('app_users').select('id,name,role,active').eq('tenant_id', tenantId).in('role', ['scaffolder', 'scaffolding']).order('name');
  return (data ?? []).filter((u: any) => u.active !== false).map((u: any) => ({ id: u.id, name: u.name, role: u.role }));
}
export async function setCrewMembers(tenantId: string, crewId: string, members: unknown) {
  const ids = (Array.isArray(members) ? members : []).filter(isId);
  const r = await db().from('scaf_crews').update({ members: ids }).eq('tenant_id', tenantId).eq('id', crewId);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
