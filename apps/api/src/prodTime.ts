// Production time. The production manager loads the task list of a job (the "wejście" sheet:
// Eksport_Clockify, Status, Zlecenie, ID_operacji, Operacja, Alias); workers start and stop tasks in
// the phone app (prod_start / prod_stop in the database); the manager corrects entries, sets each
// worker's hourly rate and exports the "wyjście" sheet. Logged hours × rate are added to labour in
// Job costs. Pure rules first, storage below.
import { db } from './supabase';
import { referenceKey, getLabourRate } from './finJobs';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });

/** "Z_394" / "Z 394" / "z.394" → "Z.394"; anything else as written. */
export function jobRefOf(v: unknown): string {
  const s = clean(v);
  const m = /^Z[\s._-]?(\d{1,5})(.*)$/i.exec(s);
  return m ? ('Z.' + m[1] + (clean(m[2].replace(/^[\s._-]+/, '')) ? ' ' + clean(m[2].replace(/^[\s._-]+/, '')) : '')) : s;
}
export interface TaskRow { export_name: string; job_ref: string; job_key: string; op_id: string | null; operation: string; alias: string | null }
/** One pasted row of the wejście sheet (columns A–F) → a task; null for the header or an unusable row. */
export function taskFromRow(cells: unknown[]): TaskRow | null {
  const [exp, , job, op, operation, alias] = cells.map(clean);
  if (!exp || /^eksport/i.test(exp) || !operation) return null;
  const job_ref = jobRefOf(job || exp.split('_').slice(0, 2).join('_'));
  if (!job_ref) return null;
  return { export_name: exp.slice(0, 160), job_ref: job_ref.slice(0, 80), job_key: referenceKey(job_ref).slice(0, 80), op_id: op.slice(0, 20) || null, operation: operation.slice(0, 120), alias: alias.slice(0, 120) || null };
}
export const hoursBetween = (start: string, end: string | null) => (end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 3600000) : 0);

export interface EntryLite { user_id: string | null; job_key: string | null; started_at: string; ended_at: string | null }
/** Logged hours and their cost per job. A worker with no rate is priced at the default labour rate
 *  (and reported). `cutoff` (job key → ISO time) leaves out entries started after a job was locked. */
export function labourByJob(entries: EntryLite[], rates: Map<string, number>, defaultRate: number, cutoff: Map<string, string> = new Map()): Map<string, { hours: number; cost: number; unrated: number }> {
  const out = new Map<string, { hours: number; cost: number; unrated: number }>();
  for (const e of entries) {
    if (!e.job_key || !e.ended_at) continue;                       // a running entry counts once it is stopped
    const c = cutoff.get(e.job_key); if (c && e.started_at > c) continue;
    const h = hoursBetween(e.started_at, e.ended_at);
    const rate = e.user_id ? rates.get(e.user_id) : undefined;
    const x = out.get(e.job_key) ?? out.set(e.job_key, { hours: 0, cost: 0, unrated: 0 }).get(e.job_key)!;
    x.hours += h; x.cost += h * (rate ?? defaultRate); if (rate === undefined) x.unrated += h;
  }
  for (const v of out.values()) { v.hours = round2(v.hours); v.cost = round2(v.cost); v.unrated = round2(v.unrated); }
  return out;
}

// ---- the wyjście export -------------------------------------------------------------------------
const TZ = 'Europe/Warsaw';
function local(iso: string): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export const hms = (h: number) => { const s = Math.round(h * 3600); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
export const EXPORT_HEAD = ['Project', 'Client', 'Description', 'Task', 'Kiosk', 'User', 'Group', 'Email', 'Tags', 'Billable', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (h)', 'Duration (decimal)', 'Rate (PLN)', 'Amount (PLN)', 'Date of creation'];
/** One finished entry → one row in the layout of the old Clockify export (rate and amount in PLN). */
export function exportRow(e: { task_name: string | null; user_name: string | null; user_email: string | null; note: string | null; started_at: string; ended_at: string; created_at: string }, rate: number | null): (string | number)[] {
  const s = local(e.started_at), en = local(e.ended_at), h = hoursBetween(e.started_at, e.ended_at);
  return ['Produkcja', '', e.note ?? '', e.task_name ?? '', '', e.user_name ?? '', '', e.user_email ?? '', '', 'Yes', s.date, s.time, en.date, en.time, hms(h), round2(h), rate ?? '', rate === null ? '' : round2(h * rate), local(e.created_at).date];
}

// ---- storage -------------------------------------------------------------------------------------
async function all(table: string, cols: string, tenantId: string, order = 'id'): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const missing = (e: any) => /prod_tasks|time_entries|worker_rates/.test(String(e?.message ?? '')) && /(does not exist|schema cache|not find)/i.test(String(e?.message ?? ''));
/** Labour from logged time, per job key — [] when migration 0077 has not been run yet. */
export async function loggedLabour(tenantId: string, cutoff: Map<string, string> = new Map()): Promise<Map<string, { hours: number; cost: number; unrated: number }>> {
  try {
    const [entries, rates, def] = await Promise.all([all('time_entries', 'user_id,job_key,started_at,ended_at', tenantId), all('worker_rates', 'user_id,rate', tenantId, 'user_id'), getLabourRate()]);
    return labourByJob(entries, new Map(rates.map((r) => [r.user_id, Number(r.rate)])), def, cutoff);
  } catch (e) { if (missing(e)) return new Map(); throw e; }
}

export async function listTasks(tenantId: string): Promise<any[]> { return all('prod_tasks', '*', tenantId, 'export_name'); }
export async function importTasks(tenantId: string, by: string, rows: unknown[][]): Promise<{ added: number; existing: number; invalid: number }> {
  const have = new Set((await all('prod_tasks', 'export_name', tenantId)).map((t) => t.export_name));
  const fresh: TaskRow[] = []; let existing = 0, invalid = 0;
  for (const r of rows) {
    const t = taskFromRow(Array.isArray(r) ? r : []);
    if (!t) { invalid++; continue; }
    if (have.has(t.export_name)) { existing++; continue; }
    have.add(t.export_name); fresh.push(t);
  }
  for (let i = 0; i < fresh.length; i += 200) { const { error } = await db().from('prod_tasks').insert(fresh.slice(i, i + 200).map((t) => ({ tenant_id: tenantId, created_by: by, ...t }))); if (error) throw error; }
  return { added: fresh.length, existing, invalid };
}
export async function addTask(tenantId: string, by: string, b: any): Promise<Result<{ id: string }>> {
  const job_ref = jobRefOf(b?.job_ref), operation = clean(b?.operation);
  if (!job_ref || !operation) return fail(400, 'Enter the job and the operation.');
  const export_name = (job_ref.replace('.', '_').replace(/\s+/g, '_') + '_' + operation.replace(/\s+/g, '_')).slice(0, 160);
  const { data, error } = await db().from('prod_tasks').insert({ tenant_id: tenantId, created_by: by, export_name, job_ref, job_key: referenceKey(job_ref).slice(0, 80), op_id: clean(b?.op_id) || null, operation, alias: operation }).select('id').single();
  if (error) return /duplicate/i.test(error.message) ? fail(409, 'This task already exists.') : (() => { throw error; })();
  return { ok: true, id: data.id };
}
export async function setTaskActive(tenantId: string, id: string, active: boolean): Promise<boolean> {
  const { data, error } = await db().from('prod_tasks').update({ active }).eq('tenant_id', tenantId).eq('id', id).select('id');
  if (error) throw error; return !!(data ?? []).length;
}

export async function listEntries(tenantId: string, from: string | null, to: string | null): Promise<any[]> {
  let q = db().from('time_entries').select('*').eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(5000);
  if (from) q = q.gte('started_at', from); if (to) q = q.lt('started_at', to);
  const { data, error } = await q; if (error) throw error; return data ?? [];
}
function entryFields(b: any): Result<{ fields: Record<string, any> }> {
  const s = Date.parse(String(b?.started_at ?? '')), e = b?.ended_at ? Date.parse(String(b.ended_at)) : NaN;
  if (!Number.isFinite(s)) return fail(400, 'Enter the start.');
  if (b?.ended_at && !Number.isFinite(e)) return fail(400, 'The end looks wrong.');
  if (Number.isFinite(e) && e < s) return fail(400, 'The end is before the start.');
  if (Number.isFinite(e) && e - s > 16 * 3600000) return fail(400, 'An entry longer than 16 hours looks wrong.');
  return { ok: true, fields: { started_at: new Date(s).toISOString(), ended_at: Number.isFinite(e) ? new Date(e).toISOString() : null, note: clean(b?.note).slice(0, 300) || null } };
}
/** The manager adds an entry for a worker (forgot to start) or corrects one. */
export async function saveEntry(tenantId: string, by: string, id: string | null, b: any): Promise<Result<{ id: string }>> {
  const f = entryFields(b); if (!f.ok) return f;
  const fields: Record<string, any> = { ...f.fields, source: 'manual', edited_by: by };
  if (b?.task_id) {
    const t = await db().from('prod_tasks').select('id,export_name,job_key').eq('tenant_id', tenantId).eq('id', String(b.task_id)).maybeSingle();
    if (t.error) throw t.error; if (!t.data) return fail(400, 'Choose the task.');
    Object.assign(fields, { task_id: t.data.id, task_name: t.data.export_name, job_key: t.data.job_key });
  } else if (!id) return fail(400, 'Choose the task.');
  if (!id) {
    const u = await db().from('app_users').select('id,name,email').eq('tenant_id', tenantId).eq('id', String(b?.user_id ?? '')).maybeSingle();
    if (u.error) throw u.error; if (!u.data) return fail(400, 'Choose the worker.');
    if (!fields.ended_at) return fail(400, 'Enter the end.');
    const { data, error } = await db().from('time_entries').insert({ tenant_id: tenantId, user_id: u.data.id, user_name: u.data.name, user_email: u.data.email, ...fields }).select('id').single();
    if (error) throw error; return { ok: true, id: data.id };
  }
  const { data, error } = await db().from('time_entries').update(fields).eq('tenant_id', tenantId).eq('id', id).select('id');
  if (error) { if (/one_running/.test(error.message)) return fail(409, 'This worker already has a running task.'); throw error; }
  return (data ?? []).length ? { ok: true, id } : fail(404, 'Entry not found.');
}
export async function deleteEntry(tenantId: string, id: string): Promise<boolean> {
  const { data, error } = await db().from('time_entries').delete().eq('tenant_id', tenantId).eq('id', id).select('id');
  if (error) throw error; return !!(data ?? []).length;
}
export async function listRates(tenantId: string): Promise<Map<string, number>> { return new Map((await all('worker_rates', 'user_id,rate', tenantId, 'user_id')).map((r) => [r.user_id, Number(r.rate)])); }
export async function setRate(tenantId: string, by: string, userId: string, rate: number | null): Promise<Result> {
  const u = await db().from('app_users').select('id').eq('tenant_id', tenantId).eq('id', userId).maybeSingle();
  if (u.error) throw u.error; if (!u.data) return fail(404, 'Worker not found.');
  if (rate === null) { const { error } = await db().from('worker_rates').delete().eq('user_id', userId); if (error) throw error; return { ok: true }; }
  if (!(rate >= 0 && rate <= 10000)) return fail(400, 'Enter a rate per hour.');
  const { error } = await db().from('worker_rates').upsert({ user_id: userId, tenant_id: tenantId, rate, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error; return { ok: true };
}
