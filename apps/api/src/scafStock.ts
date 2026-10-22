// ACE Scaffolding — phase 5: stock (tube & fitting). Places are the yard, the vans and the sites (jobs). Every
// movement is a numbered note (SN-0001): delivery (yard / van → site), collection (site → yard / van), transfer
// (yard ↔ van), purchase (new stock into the yard or a van), stocktake (the counted difference at the yard / a van),
// loss (written off from a site — and, if wanted, charged to the customer at replacement value). A place's stock is
// what came in minus what went out; it may go negative (sites are often counted only at the end).
// Each scaffold can carry its estimated materials (bom); with the planned erect / dismantle visits that gives the
// availability forecast by week.
import { db } from './supabase';
import { clean } from './scaffolding';
import { addDays } from './scafJobs';

export const NOTE_KINDS = ['delivery', 'collection', 'transfer', 'purchase', 'stocktake', 'loss'] as const;
export type NoteKind = typeof NOTE_KINDS[number];
const round2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown, max = 200) => { const t = clean(v).slice(0, max); return t || null; };
const day = (v: unknown) => { const t = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const isId = (v: unknown) => /^[0-9a-f-]{36}$/.test(String(v ?? ''));

// ---- pure rules ------------------------------------------------------------------------------------
export interface Note { kind: NoteKind; from_loc: string | null; to_loc: string | null; job_id: string | null }
export interface Line { item_id: string; qty: number }
/** Where a note takes stock from and to: 'L:<location>', 'J:<job>' (a site); null = outside (supplier, lost). */
export function noteEffects(n: Note, lines: Line[]): { place: string; item: string; qty: number }[] {
  const L = (x: string | null) => (x ? 'L:' + x : null), J = (x: string | null) => (x ? 'J:' + x : null);
  const [from, to] = n.kind === 'delivery' ? [L(n.from_loc), J(n.job_id)] : n.kind === 'collection' ? [J(n.job_id), L(n.to_loc)] : n.kind === 'transfer' ? [L(n.from_loc), L(n.to_loc)]
    : n.kind === 'purchase' ? [null, L(n.to_loc)] : n.kind === 'stocktake' ? [null, L(n.to_loc)] : [J(n.job_id) ?? L(n.from_loc), null];
  const out: { place: string; item: string; qty: number }[] = [];
  for (const l of lines) { if (from) out.push({ place: from, item: l.item_id, qty: -l.qty }); if (to) out.push({ place: to, item: l.item_id, qty: l.qty }); }
  return out;
}
export function balances(effects: { place: string; item: string; qty: number }[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const e of effects) { const p = m.get(e.place) ?? m.set(e.place, new Map()).get(e.place)!; p.set(e.item, round2((p.get(e.item) ?? 0) + e.qty)); }
  return m;
}
export function noteInput(b: any): { ok: true; note: Note & { day: string }; lines: Line[] } | { ok: false; error: string } {
  const kind = String(b?.kind ?? '') as NoteKind; if (!NOTE_KINDS.includes(kind)) return { ok: false, error: 'Unknown kind of note.' };
  const d = day(b.day); if (!d) return { ok: false, error: 'Choose the day.' };
  const n = { kind, day: d, from_loc: isId(b.from_loc) ? b.from_loc : null, to_loc: isId(b.to_loc) ? b.to_loc : null, job_id: isId(b.job_id) ? b.job_id : null };
  const need: Record<NoteKind, (keyof Note)[]> = { delivery: ['from_loc', 'job_id'], collection: ['job_id', 'to_loc'], transfer: ['from_loc', 'to_loc'], purchase: ['to_loc'], stocktake: ['to_loc'], loss: [] };
  const what: Record<string, string> = { from_loc: 'where it comes from (yard / van)', to_loc: 'where it goes (yard / van)', job_id: 'the job (site)' };
  for (const k of need[kind]) if (!n[k]) return { ok: false, error: 'Choose ' + what[k] + '.' };
  if (kind === 'loss' && !n.job_id && !n.from_loc) return { ok: false, error: 'Choose the site or the yard / van it was lost from.' };
  if (kind === 'transfer' && n.from_loc === n.to_loc) return { ok: false, error: 'From and to are the same.' };
  const lines: Line[] = [];
  for (const r of Array.isArray(b.lines) ? b.lines : []) {
    if (!isId(r?.item_id)) continue;
    const q = Number(String(r.qty ?? '').replace(',', '.')); if (!Number.isFinite(q) || q === 0) continue;
    if (kind !== 'stocktake' && q < 0) return { ok: false, error: 'Quantities are positive (a stocktake can be negative).' };
    lines.push({ item_id: r.item_id, qty: round2(q) });
  }
  if (!lines.length) return { ok: false, error: 'Enter at least one quantity.' };
  return { ok: true, note: n, lines };
}
export function bomValue(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}, src: any = v && typeof v === 'object' ? v : {};
  for (const [k, q] of Object.entries(src)) { const n = Number(q); if (isId(k) && Number.isFinite(n) && n > 0) out[k] = round2(n); }
  return out;
}
/** Availability by week: stock in the yard and vans now, minus what planned erections take that week, plus what
 *  planned dismantles bring back — counted from the week after (conservative). `weeks` are Mondays. */
export function forecast(available: Map<string, number>, weeks: string[], erects: { day: string; bom: Record<string, number> }[], dismantles: { day: string; bom: Record<string, number> }[]) {
  const idx = (d: string) => weeks.findIndex((w, i) => d >= w && (i === weeks.length - 1 || d < weeks[i + 1]));
  const items = new Set<string>([...erects, ...dismantles].flatMap((x) => Object.keys(x.bom)));
  const out: { item: string; now: number; need: number[]; back: number[]; after: number[]; short: boolean }[] = [];
  for (const it of items) {
    const need = weeks.map(() => 0), back = weeks.map(() => 0);
    for (const e of erects) { const i = e.day < weeks[0] ? 0 : idx(e.day); if (i >= 0) need[i] += e.bom[it] ?? 0; }
    for (const d of dismantles) { const i = idx(d.day); if (i >= 0 && i + 1 < weeks.length) back[i + 1] += d.bom[it] ?? 0; }
    let run = available.get(it) ?? 0; const after: number[] = [];
    for (let i = 0; i < weeks.length; i++) { run = round2(run + back[i] - need[i]); after.push(run); }
    out.push({ item: it, now: available.get(it) ?? 0, need, back, after, short: after.some((x) => x < 0) });
  }
  return out.sort((a, b) => Number(b.short) - Number(a.short));
}
export const monday = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)); };

// ---- reads ----------------------------------------------------------------------------------------
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; }
  return out;
}
export async function listItems(tenantId: string) {
  return (await all<any>(() => db().from('scaf_stock_items').select('*').eq('tenant_id', tenantId).order('position').order('id'))).map((i) => ({ ...i, weight_kg: i.weight_kg === null ? null : Number(i.weight_kg), value: i.value === null ? null : Number(i.value) }));
}
export async function listLocations(tenantId: string) {
  const { data, error } = await db().from('scaf_locations').select('*').eq('tenant_id', tenantId).order('position'); if (error) throw error; return data ?? [];
}
async function allEffects(tenantId: string) {
  const notes = await all<any>(() => db().from('scaf_stock_notes').select('id,kind,from_loc,to_loc,job_id').eq('tenant_id', tenantId).order('id'));
  const lines = await all<any>(() => db().from('scaf_stock_lines').select('note_id,item_id,qty').eq('tenant_id', tenantId).order('id'));
  const by = new Map<string, Line[]>(); for (const l of lines) (by.get(l.note_id) ?? by.set(l.note_id, []).get(l.note_id)!).push({ item_id: l.item_id, qty: Number(l.qty) });
  return notes.flatMap((n) => noteEffects(n, by.get(n.id) ?? []));
}
/** The Stock page: items × places, the sites holding stock, the recent notes and the 6-week forecast. */
export async function stockOverview(tenantId: string, today: string) {
  const [items, locs, effects] = await Promise.all([listItems(tenantId), listLocations(tenantId), allEffects(tenantId)]);
  const bal = balances(effects);
  const siteKeys = [...bal.keys()].filter((k) => k.startsWith('J:') && [...bal.get(k)!.values()].some((q) => q !== 0));
  const jobIds = siteKeys.map((k) => k.slice(2));
  const jobs = jobIds.length ? await all<any>(() => db().from('scaf_jobs').select('id,number,title,stage').in('id', jobIds).order('id')) : [];
  const valueOf = new Map(items.map((i) => [i.id, i.value ?? 0])), weightOf = new Map(items.map((i) => [i.id, i.weight_kg ?? 0]));
  const sites = jobs.map((j) => { const b = bal.get('J:' + j.id)!; return { ...j, pieces: round2([...b.values()].reduce((a, q) => a + q, 0)), value: round2([...b.entries()].reduce((a, [it, q]) => a + q * (valueOf.get(it) ?? 0), 0)), weight: round2([...b.entries()].reduce((a, [it, q]) => a + q * (weightOf.get(it) ?? 0), 0)), negative: [...b.values()].some((q) => q < 0) }; })
    .sort((a, b) => b.number - a.number);
  const byLoc: Record<string, Record<string, number>> = {};
  for (const l of locs) byLoc[l.id] = Object.fromEntries(bal.get('L:' + l.id) ?? []);
  const onSites: Record<string, number> = {};
  for (const k of siteKeys) for (const [it, q] of bal.get(k)!) onSites[it] = round2((onSites[it] ?? 0) + q);
  // forecast: yard + vans now, planned erect / dismantle visits in the next 6 weeks with their scaffolds' bom
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(monday(today), i * 7)), end = addDays(weeks[5], 6);
  const visits = await all<any>(() => db().from('scaf_visits').select('kind,day,scaffold_ids,status').eq('tenant_id', tenantId).eq('status', 'planned').in('kind', ['erect', 'dismantle']).lte('day', end).gte('day', addDays(weeks[0], -60)).order('id'));
  const scIds = [...new Set(visits.flatMap((v) => v.scaffold_ids ?? []))];
  const scs = scIds.length ? await all<any>(() => db().from('scaf_scaffolds').select('id,bom').in('id', scIds).order('id')) : [];
  const bomOf = new Map(scs.map((s) => [s.id, bomValue(s.bom)]));
  const sumBom = (ids: string[]) => { const o: Record<string, number> = {}; for (const id of ids) for (const [k, q] of Object.entries(bomOf.get(id) ?? {})) o[k] = round2((o[k] ?? 0) + q); return o; };
  const avail = new Map<string, number>(); for (const l of locs) for (const [it, q] of bal.get('L:' + l.id) ?? []) avail.set(it, round2((avail.get(it) ?? 0) + q));
  const fc = forecast(avail, weeks, visits.filter((v) => v.kind === 'erect').map((v) => ({ day: v.day, bom: sumBom(v.scaffold_ids ?? []) })), visits.filter((v) => v.kind === 'dismantle' && v.day >= weeks[0]).map((v) => ({ day: v.day, bom: sumBom(v.scaffold_ids ?? []) })));
  return { items, locations: locs, byLoc, onSites, sites, weeks, forecast: fc, notes: await listNotes(tenantId) };
}
export async function listNotes(tenantId: string, jobId?: string) {
  let q = db().from('scaf_stock_notes').select('id,number,kind,day,from_loc,to_loc,job_id,final,signed_by,driver,vehicle,notes').eq('tenant_id', tenantId).order('number', { ascending: false }).limit(300);
  if (jobId) q = q.eq('job_id', jobId);
  const { data, error } = await q; if (error) throw error;
  const notes = (data ?? []) as any[]; if (!notes.length) return [];
  const lines = await all<any>(() => db().from('scaf_stock_lines').select('note_id,qty').in('note_id', notes.map((n) => n.id)).order('id'));
  const jobIds = [...new Set(notes.map((n) => n.job_id).filter(Boolean))];
  const jobs = jobIds.length ? await all<any>(() => db().from('scaf_jobs').select('id,number,title').in('id', jobIds).order('id')) : [];
  const jm = new Map(jobs.map((j) => [j.id, j]));
  return notes.map((n) => ({ ...n, ref: 'SN-' + String(n.number).padStart(4, '0'), job: n.job_id ? jm.get(n.job_id) ?? null : null, lines: lines.filter((l) => l.note_id === n.id).length, pieces: round2(lines.filter((l) => l.note_id === n.id).reduce((a, l) => a + Number(l.qty), 0)) }));
}
export async function getNote(tenantId: string, id: string) {
  const { data: n } = await db().from('scaf_stock_notes').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!n) return null;
  const { data: lines } = await db().from('scaf_stock_lines').select('item_id,qty').eq('note_id', id);
  const items = new Map((await listItems(tenantId)).map((i) => [i.id, i]));
  const locs = new Map((await listLocations(tenantId)).map((l: any) => [l.id, l]));
  const nn: any = n;
  let job: any = null, site: any = null, customer: any = null;
  if (nn.job_id) {
    job = (await db().from('scaf_jobs').select('id,number,title,site_id,customer_id').eq('id', nn.job_id).maybeSingle()).data;
    if (job?.site_id) site = (await db().from('scaf_sites').select('address').eq('id', job.site_id).maybeSingle()).data;
    if (job?.customer_id) customer = (await db().from('scaf_customers').select('name').eq('id', job.customer_id).maybeSingle()).data;
  }
  return { ...nn, ref: 'SN-' + String(nn.number).padStart(4, '0'), from: nn.from_loc ? locs.get(nn.from_loc) ?? null : null, to: nn.to_loc ? locs.get(nn.to_loc) ?? null : null, job, site, customer,
    lines: (lines ?? []).map((l: any) => { const it: any = items.get(l.item_id) ?? {}; return { item_id: l.item_id, code: it.code, name: it.name, unit: it.unit, qty: Number(l.qty), weight: it.weight_kg == null ? null : round2(Number(l.qty) * it.weight_kg) }; }).sort((a: any, b: any) => (items.get(a.item_id)?.position ?? 0) - (items.get(b.item_id)?.position ?? 0)) };
}
/** A site's stock: what is there now per item, with its value — after the final collection, what is missing. */
export async function jobStock(tenantId: string, jobId: string) {
  const [items, notes] = await Promise.all([listItems(tenantId), listNotes(tenantId, jobId)]);
  const ids = notes.map((n: any) => n.id);
  const lines = ids.length ? await all<any>(() => db().from('scaf_stock_lines').select('note_id,item_id,qty').in('note_id', ids).order('id')) : [];
  const by = new Map<string, Line[]>(); for (const l of lines) (by.get(l.note_id) ?? by.set(l.note_id, []).get(l.note_id)!).push({ item_id: l.item_id, qty: Number(l.qty) });
  const b = balances(notes.flatMap((n: any) => noteEffects(n, by.get(n.id) ?? []))).get('J:' + jobId) ?? new Map();
  const im = new Map(items.map((i) => [i.id, i]));
  const onSite = [...b.entries()].filter(([, q]) => q !== 0).map(([it, q]) => { const i: any = im.get(it) ?? {}; return { item_id: it, code: i.code, name: i.name, unit: i.unit, qty: q, value: i.value == null ? null : round2(q * i.value) }; })
    .sort((a, c) => (im.get(a.item_id)?.position ?? 0) - (im.get(c.item_id)?.position ?? 0));
  return { onSite, notes, finalCollected: notes.some((n: any) => n.kind === 'collection' && n.final) };
}

// ---- writes ---------------------------------------------------------------------------------------
export async function saveItem(tenantId: string, id: string | null, b: any) {
  const code = txt(b?.code, 20), name = txt(b?.name, 120); if (!code || !name) return { ok: false as const, error: 'Give the code and the name.' };
  const num = (v: unknown) => { const t = clean(v).replace(/[£,]/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : NaN; };
  const kg = num(b.weight_kg), val = num(b.value); if (Number.isNaN(kg) || Number.isNaN(val)) return { ok: false as const, error: 'Weight and value are numbers.' };
  const f = { code, name, category: txt(b.category, 40) ?? 'Fittings', unit: txt(b.unit, 12) ?? 'pcs', weight_kg: kg, value: val, position: Number.isFinite(Number(b.position)) ? Math.round(Number(b.position)) : 0, active: b.active !== false };
  const r = id ? await db().from('scaf_stock_items').update(f).eq('tenant_id', tenantId).eq('id', id) : await db().from('scaf_stock_items').insert({ tenant_id: tenantId, ...f });
  return r.error ? { ok: false as const, error: /duplicate/.test(r.error.message) ? 'There is an item with this code.' : r.error.message } : { ok: true as const };
}
export async function saveLocation(tenantId: string, id: string | null, b: any) {
  const name = txt(b?.name, 60); if (!name) return { ok: false as const, error: 'Give the name.' };
  const f = { name, kind: b.kind === 'yard' ? 'yard' : 'van', reg: txt(b.reg, 20), active: b.active !== false, position: Number.isFinite(Number(b.position)) ? Math.round(Number(b.position)) : 0 };
  const r = id ? await db().from('scaf_locations').update(f).eq('tenant_id', tenantId).eq('id', id) : await db().from('scaf_locations').insert({ tenant_id: tenantId, ...f });
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
export async function createNote(tenantId: string, userId: string, b: any) {
  const v = noteInput(b); if (!v.ok) return v;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db().from('scaf_stock_notes').select('number').eq('tenant_id', tenantId).order('number', { ascending: false }).limit(1);
    const number = (((last ?? [])[0] as any)?.number ?? 0) + 1;
    const r = await db().from('scaf_stock_notes').insert({ tenant_id: tenantId, number, ...v.note, final: v.note.kind === 'collection' && !!b.final, vehicle: txt(b.vehicle, 60), driver: txt(b.driver, 80), signed_by: txt(b.signed_by, 80), notes: txt(b.notes, 1000), created_by: userId }).select('id').single();
    if (r.error) { if (/duplicate/.test(r.error.message)) continue; return { ok: false as const, error: r.error.message }; }
    const id = (r.data as any).id;
    const i = await db().from('scaf_stock_lines').insert(v.lines.map((l) => ({ tenant_id: tenantId, note_id: id, ...l })));
    if (i.error) { await db().from('scaf_stock_notes').delete().eq('id', id); return { ok: false as const, error: i.error.message }; }
    return { ok: true as const, id, number };
  }
  return { ok: false as const, error: 'Could not number the note — try again.' };
}
export async function deleteNote(tenantId: string, id: string) {
  const r = await db().from('scaf_stock_notes').delete().eq('tenant_id', tenantId).eq('id', id);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
export async function saveBom(tenantId: string, scaffoldId: string, bom: unknown) {
  const r = await db().from('scaf_scaffolds').update({ bom: bomValue(bom) }).eq('tenant_id', tenantId).eq('id', scaffoldId);
  return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
}
/** Missing after the final collection: write it off (a loss note) and, if wanted, charge it to the customer (a request
 *  for invoice at replacement value). */
export async function settleLosses(tenantId: string, userId: string, jobId: string, b: any, priceRequest: (lines: { description: string; amount: number }[]) => Promise<any>) {
  const { onSite } = await jobStock(tenantId, jobId);
  const missing = onSite.filter((x) => x.qty > 0);
  if (!missing.length) return { ok: false as const, error: 'Nothing is missing on this site.' };
  const note = await createNote(tenantId, userId, { kind: 'loss', day: day(b?.day) ?? new Date().toISOString().slice(0, 10), job_id: jobId, notes: 'Missing after the final collection', lines: missing.map((m) => ({ item_id: m.item_id, qty: m.qty })) });
  if (!note.ok) return note;
  let request: any = null;
  if (b?.charge) request = await priceRequest(missing.filter((m) => m.value).map((m) => ({ description: `Not returned: ${m.qty} × ${m.name} (${m.code})`, amount: m.value! })));
  return { ok: true as const, note: note.id, request: request?.id ?? null };
}
