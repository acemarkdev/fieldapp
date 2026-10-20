// Warehouse ▸ Wydania: what the warehouse issued for a Z order — logged on the phone (role Warehouse:
// scan or type the Subiekt symbol and the location; database functions wh_save_issue / wh_delete_issue),
// reviewed here and exported to Excel for the RW in Subiekt. An exported row is stamped (date, who,
// export number) and leaves the phone; an admin can undo an export.
import { db } from './supabase';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** "z437", "Z 437", "Z_0437 panele" → "Z.437", "Z.437 panele"; anything else as typed. */
export const zRef = (v: unknown) => clean(v).replace(/^[Zz][\s._-]*0*(\d+)/, 'Z.$1');
export const jobKey = (v: unknown) => zRef(v).replace(/\s/g, '').toUpperCase();

export interface Issue {
  id: string; user_id: string | null; user_name: string | null; job_ref: string; job_key: string; symbol: string; name: string | null; unit: string | null;
  qty: number; location: string | null; box: string | null; note: string | null; created_at: string; updated_at: string;
  exported_at: string | null; export_no: number | null; exported_by: string | null;
}
export interface RwLine { symbol: string; name: string | null; unit: string | null; qty: number }
export interface RwSheet { job_ref: string; lines: RwLine[] }

/** The RW view of an export: one sheet per Z order, the same symbol added up (an RW has one line per item). */
export function rwSheets(rows: Pick<Issue, 'job_ref' | 'job_key' | 'symbol' | 'name' | 'unit' | 'qty'>[]): RwSheet[] {
  const jobs = new Map<string, { job_ref: string; lines: Map<string, RwLine> }>();
  for (const r of rows) {
    const k = jobKey(r.job_ref);
    const j = jobs.get(k) ?? jobs.set(k, { job_ref: zRef(r.job_ref), lines: new Map() }).get(k)!;
    const key = r.symbol.toUpperCase();
    const l = j.lines.get(key);
    if (l) { l.qty = round3(l.qty + Number(r.qty)); if (!l.name && r.name) l.name = r.name; if (!l.unit && r.unit) l.unit = r.unit; }
    else j.lines.set(key, { symbol: r.symbol, name: r.name, unit: r.unit, qty: round3(Number(r.qty)) });
  }
  return [...jobs.values()].sort((a, b) => a.job_ref.localeCompare(b.job_ref, 'pl', { numeric: true }))
    .map((j) => ({ job_ref: j.job_ref, lines: [...j.lines.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)) }));
}
/** An Excel sheet name from a Z reference: max 31 characters, none of []:*?/\ — unique within the book. */
export function sheetName(ref: string, used: Set<string>): string {
  const base = clean(ref).replace(/[\[\]:*?/\\]/g, '_').slice(0, 28) || 'Z';
  let n = base, i = 2;
  while (used.has(n.toUpperCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toUpperCase());
  return n;
}

/** Office correction of an issue: the same rules as on the phone. */
export function issueFields(b: any): Result<{ fields: Record<string, any> }> {
  const job = zRef(b?.job_ref), symbol = clean(b?.symbol).toUpperCase();
  const qty = Number(String(b?.qty ?? '').replace(',', '.'));
  if (!job) return fail(400, 'Enter the Z order.');
  if (!symbol) return fail(400, 'Enter the item symbol.');
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) return fail(400, 'Enter the quantity.');
  return { ok: true, fields: { job_ref: job.slice(0, 60), job_key: jobKey(job).slice(0, 60), symbol: symbol.slice(0, 80), qty: round3(qty),
    location: clean(b?.location).slice(0, 60) || null, box: clean(b?.box).slice(0, 60) || null, note: clean(b?.note).slice(0, 300) || null } };
}

// ---- storage -------------------------------------------------------------------------------------
const missing = (e: any) => /wh_issues/.test(String(e?.message ?? '')) && /(does not exist|schema cache|not find)/i.test(String(e?.message ?? ''));
const NEEDS = 'Warehouse issues need migrations 0090 and 0091.';
const out = (r: any): Issue => ({ ...r, qty: Number(r.qty) });
export async function listIssues(tenantId: string, status: 'open' | 'exported' | 'all', from: string | null, to: string | null): Promise<Issue[] | null> {
  const rows: Issue[] = [];
  for (let at = 0; ; at += 1000) {
    let q = db().from('wh_issues').select('*').eq('tenant_id', tenantId);
    if (status === 'open') q = q.is('exported_at', null);
    if (status === 'exported') q = q.not('exported_at', 'is', null);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lt('created_at', to);
    const { data, error } = await q.order('created_at', { ascending: false }).range(at, at + 999);
    if (error) { if (missing(error)) return null; throw error; }
    rows.push(...(data ?? []).map(out));
    if (!data || data.length < 1000 || rows.length >= 20000) break;
  }
  return rows;
}
async function byIds(tenantId: string, ids: string[]): Promise<Issue[]> {
  const uniq = [...new Set(ids.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 5000);
  const rows: Issue[] = [];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await db().from('wh_issues').select('*').eq('tenant_id', tenantId).in('id', uniq.slice(i, i + 200));
    if (error) throw error;
    rows.push(...(data ?? []).map(out));
  }
  return rows;
}
/** Export the chosen rows that are not exported yet: stamp them, return them and the RW sheets. */
export async function exportIssues(tenantId: string, by: string, ids: string[]): Promise<Result<{ exportNo: number; rows: Issue[]; sheets: RwSheet[]; skipped: number }>> {
  const chosen = await byIds(tenantId, ids);
  const open = chosen.filter((r) => !r.exported_at);
  if (!open.length) return fail(400, chosen.length ? 'These issues are already exported.' : 'Nothing selected.');
  const last = await db().from('wh_issues').select('export_no').eq('tenant_id', tenantId).not('export_no', 'is', null).order('export_no', { ascending: false }).limit(1);
  if (last.error) throw last.error;
  const exportNo = (last.data?.[0]?.export_no ?? 0) + 1, at = new Date().toISOString();
  const done: Issue[] = [];
  for (let i = 0; i < open.length; i += 200) {
    const { data, error } = await db().from('wh_issues').update({ exported_at: at, export_no: exportNo, exported_by: by })
      .eq('tenant_id', tenantId).in('id', open.slice(i, i + 200).map((r) => r.id)).is('exported_at', null).select('*');
    if (error) throw error;
    done.push(...(data ?? []).map(out));
  }
  done.sort((a, b) => a.job_ref.localeCompare(b.job_ref, 'pl', { numeric: true }) || a.created_at.localeCompare(b.created_at));
  return { ok: true, exportNo, rows: done, sheets: rwSheets(done), skipped: chosen.length - done.length };
}
/** Download again an export that was already made (same rows, nothing changes). */
export async function exportedAgain(tenantId: string, exportNo: number): Promise<Result<{ rows: Issue[]; sheets: RwSheet[] }>> {
  const { data, error } = await db().from('wh_issues').select('*').eq('tenant_id', tenantId).eq('export_no', exportNo);
  if (error) throw error;
  const rows = (data ?? []).map(out);
  if (!rows.length) return fail(404, 'Export not found.');
  return { ok: true, rows, sheets: rwSheets(rows) };
}
/** Admin: undo an export — the rows are open again (and back on the phone of whoever logged them). */
export async function unexportIssues(tenantId: string, ids: string[]): Promise<number> {
  const rows = await byIds(tenantId, ids);
  const back = rows.filter((r) => r.exported_at).map((r) => r.id);
  for (let i = 0; i < back.length; i += 200) {
    const { error } = await db().from('wh_issues').update({ exported_at: null, export_no: null, exported_by: null }).eq('tenant_id', tenantId).in('id', back.slice(i, i + 200));
    if (error) throw error;
  }
  return back.length;
}
async function itemInfo(tenantId: string, symbol: string): Promise<{ name: string | null; unit: string | null }> {
  const { data } = await db().from('subiekt_lots').select('name,unit').eq('tenant_id', tenantId).ilike('symbol', symbol).limit(1);
  return { name: data?.[0]?.name ?? null, unit: data?.[0]?.unit ?? null };
}
/** Office correction of an open issue (an exported one is the record of what went to Subiekt). */
export async function updateIssue(tenantId: string, id: string, b: any): Promise<Result<{ issue: Issue }>> {
  const f = issueFields(b); if (!f.ok) return f;
  const cur = (await byIds(tenantId, [id]))[0];
  if (!cur) return fail(404, 'Issue not found.');
  if (cur.exported_at) return fail(409, 'This issue is exported — undo the export first.');
  const info = f.fields.symbol === cur.symbol ? { name: cur.name, unit: cur.unit } : await itemInfo(tenantId, f.fields.symbol);
  const { data, error } = await db().from('wh_issues').update({ ...f.fields, ...info, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return { ok: true, issue: out(data) };
}
export async function deleteIssues(tenantId: string, ids: string[]): Promise<Result<{ deleted: number }>> {
  const rows = await byIds(tenantId, ids);
  if (rows.some((r) => r.exported_at)) return fail(409, 'Exported issues cannot be deleted — undo the export first.');
  let deleted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await db().from('wh_issues').delete().eq('tenant_id', tenantId).in('id', rows.slice(i, i + 200).map((r) => r.id)).select('id');
    if (error) throw error;
    deleted += data?.length ?? 0;
  }
  return { ok: true, deleted };
}
export { NEEDS as WAREHOUSE_NEEDS };
