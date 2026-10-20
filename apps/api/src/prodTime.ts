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
/** One pasted row of the wejście sheet (columns A–F) → a task; null for the header or an unusable row.
 *  The task's name is the Eksport_Clockify text ("Z_437_cnc_Poz_1_cor_70_ind_ho_012_w1"): it says which
 *  position it is. The short operation ("cnc cor 70 ind HO") is kept as the alias, so searching for it still works. */
export function taskFromRow(cells: unknown[]): TaskRow | null {
  const [exp, , job, op, operation, alias] = cells.map(clean);
  if (!exp || /^eksport/i.test(exp) || !operation) return null;
  const job_ref = jobRefOf(job || exp.split('_').slice(0, 2).join('_'));
  if (!job_ref) return null;
  return { export_name: exp.slice(0, 160), job_ref: job_ref.slice(0, 80), job_key: referenceKey(job_ref).slice(0, 80), op_id: op.slice(0, 20) || null, operation: exp.slice(0, 160), alias: (alias || operation).slice(0, 120) || null };
}
export const hoursBetween = (start: string, end: string | null) => (end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 3600000) : 0);

// ---- rates over time: each rate is valid from a date; an entry is priced at the rate valid on the
// day it was started (Polish time), so changing a rate never re-prices hours already logged.
export const SINCE_ALWAYS = '2000-01-01';
/** A worker's rate (user_id) or the default labour rate (user_id null) from a day on. rate null = from
 *  that day the worker has no own rate (the default is used). */
export interface RateRow { user_id: string | null; rate: number | null; valid_from: string; set_by?: string | null; set_at?: string | null }
export interface RateBook { workers: Map<string, RateRow[]>; def: RateRow[] }
export function rateBook(rows: RateRow[]): RateBook {
  const workers = new Map<string, RateRow[]>(), def: RateRow[] = [];
  for (const r of rows) { const row = { ...r, rate: r.rate === null || r.rate === undefined ? null : Number(r.rate) }; if (r.user_id) (workers.get(r.user_id) ?? workers.set(r.user_id, []).get(r.user_id)!).push(row); else def.push(row); }
  const by = (a: RateRow, b: RateRow) => a.valid_from.localeCompare(b.valid_from);
  for (const v of workers.values()) v.sort(by); def.sort(by);
  return { workers, def };
}
/** The row valid on `day` (YYYY-MM-DD): the last one starting on or before it; undefined if none yet. */
export function rowOn(rows: RateRow[] | undefined, day: string): RateRow | undefined {
  let hit: RateRow | undefined; for (const r of rows ?? []) { if (r.valid_from <= day) hit = r; else break; } return hit;
}
export const entryDay = (iso: string) => local(iso).date;
/** The rate an entry is priced at: the worker's own rate on that day, else the default rate on that day
 *  (else the current default). own = the worker's rate, or null when the default was used. */
export function rateFor(book: RateBook, defaultNow: number, userId: string | null, startedAt: string): { rate: number; own: number | null } {
  const day = entryDay(startedAt);
  const w = userId ? rowOn(book.workers.get(userId), day) : undefined;
  if (w && w.rate !== null) return { rate: w.rate, own: w.rate };
  const d = rowOn(book.def, day);
  return { rate: d && d.rate !== null ? d.rate : defaultNow, own: null };
}

export interface EntryLite { user_id: string | null; job_key: string | null; started_at: string; ended_at: string | null }
/** Logged hours and their cost per job. A worker with no rate is priced at the default labour rate
 *  (and reported). `cutoff` (job key → ISO time) leaves out entries started after a job was locked. */
export function labourByJob(entries: EntryLite[], rates: RateBook | Map<string, number>, defaultRate: number, cutoff: Map<string, string> = new Map()): Map<string, { hours: number; cost: number; unrated: number }> {
  const book = rates instanceof Map ? rateBook([...rates].map(([user_id, rate]) => ({ user_id, rate, valid_from: SINCE_ALWAYS }))) : rates;
  const out = new Map<string, { hours: number; cost: number; unrated: number }>();
  for (const e of entries) {
    if (!e.job_key || !e.ended_at) continue;                       // a running entry counts once it is stopped
    const c = cutoff.get(e.job_key); if (c && e.started_at > c) continue;
    const h = hoursBetween(e.started_at, e.ended_at);
    const r = rateFor(book, defaultRate, e.user_id, e.started_at);
    const x = out.get(e.job_key) ?? out.set(e.job_key, { hours: 0, cost: 0, unrated: 0 }).get(e.job_key)!;
    x.hours += h; x.cost += h * r.rate; if (r.own === null) x.unrated += h;
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
    const [entries, rows, def] = await Promise.all([all('time_entries', 'user_id,job_key,started_at,ended_at', tenantId), rateRows(tenantId), getLabourRate()]);
    return labourByJob(entries, rateBook(rows), def, cutoff);
  } catch (e) { if (missing(e)) return new Map(); throw e; }
}

export async function listTasks(tenantId: string): Promise<any[]> { return all('prod_tasks', '*', tenantId, 'export_name'); }
/** Every row becomes a task — the same set may be loaded again for an order (a new batch); the
 *  manager closes the old set. `existing` counts the new tasks whose name is already open, as a heads-up. */
export async function importTasks(tenantId: string, by: string, rows: unknown[][]): Promise<{ added: number; existing: number; invalid: number }> {
  const open = new Set((await all('prod_tasks', 'export_name,active', tenantId)).filter((t) => t.active).map((t) => t.export_name));
  const fresh: TaskRow[] = []; let existing = 0, invalid = 0;
  for (const r of rows) {
    const t = taskFromRow(Array.isArray(r) ? r : []);
    if (!t) { invalid++; continue; }
    if (open.has(t.export_name)) existing++;
    fresh.push(t);
  }
  for (let i = 0; i < fresh.length; i += 200) { const { error } = await db().from('prod_tasks').insert(fresh.slice(i, i + 200).map((t) => ({ tenant_id: tenantId, created_by: by, ...t }))); if (error) throw error; }
  return { added: fresh.length, existing, invalid };
}
export async function addTask(tenantId: string, by: string, b: any): Promise<Result<{ id: string }>> {
  const job_ref = jobRefOf(b?.job_ref), operation = clean(b?.operation);
  if (!job_ref || !operation) return fail(400, 'Enter the job and the operation.');
  const export_name = (job_ref.replace('.', '_').replace(/\s+/g, '_') + '_' + operation.replace(/\s+/g, '_')).slice(0, 160);
  const { data, error } = await db().from('prod_tasks').insert({ tenant_id: tenantId, created_by: by, export_name, job_ref, job_key: referenceKey(job_ref).slice(0, 80), op_id: clean(b?.op_id) || null, operation: export_name, alias: operation }).select('id').single();
  if (error) return /duplicate/i.test(error.message) ? fail(409, 'This task already exists.') : (() => { throw error; })();
  return { ok: true, id: data.id };
}
export async function setTaskActive(tenantId: string, id: string, active: boolean): Promise<boolean> {
  return (await setTasksActive(tenantId, [id], active)) > 0;
}
/** Close or reopen many tasks at once. */
export async function setTasksActive(tenantId: string, ids: string[], active: boolean): Promise<number> {
  const uniq = [...new Set(ids.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  let n = 0;
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await db().from('prod_tasks').update({ active }).eq('tenant_id', tenantId).in('id', uniq.slice(i, i + 200)).select('id');
    if (error) throw error; n += (data ?? []).length;
  }
  return n;
}

// ---- the admin's log of time changes (start / end only) ---------------------------------------------
export interface Actor { id: string; name: string; role: string }
/** True when the start or end differs — only those changes are logged (not comments, not task). */
export const timesChanged = (a: { started_at?: string | null; ended_at?: string | null } | null, b: { started_at?: string | null; ended_at?: string | null } | null) =>
  !a || !b || Date.parse(a.started_at ?? '') !== Date.parse(b.started_at ?? '') || (a.ended_at ? Date.parse(a.ended_at) : null) !== (b.ended_at ? Date.parse(b.ended_at) : null);
async function logEdit(tenantId: string, action: 'create' | 'update' | 'delete', before: any | null, after: any | null, actor: Actor): Promise<void> {
  const e = after ?? before;
  const { error } = await db().from('time_edit_log').insert({ tenant_id: tenantId, entry_id: e?.id ?? null, worker_name: e?.user_name ?? null, task_name: e?.task_name ?? null, action,
    old_start: before?.started_at ?? null, old_end: before?.ended_at ?? null, new_start: after?.started_at ?? null, new_end: after?.ended_at ?? null,
    actor_id: actor.id, actor_name: actor.name, actor_role: actor.role, source: 'office' });
  if (error && !/time_edit_log/.test(error.message)) throw error;   // before migration 0078 the log just isn't kept
}
export async function listEditLog(tenantId: string, limit = 1000): Promise<any[]> {
  const { data, error } = await db().from('time_edit_log').select('*').eq('tenant_id', tenantId).order('at', { ascending: false }).limit(limit);
  if (error) { if (/time_edit_log/.test(error.message)) return []; throw error; }
  return data ?? [];
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
export async function saveEntry(tenantId: string, actor: Actor, id: string | null, b: any): Promise<Result<{ id: string }>> {
  const by = actor.name;
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
    const { data, error } = await db().from('time_entries').insert({ tenant_id: tenantId, user_id: u.data.id, user_name: u.data.name, user_email: u.data.email, ...fields }).select('*').single();
    if (error) throw error;
    await logEdit(tenantId, 'create', null, data, actor);
    return { ok: true, id: data.id };
  }
  const cur = await db().from('time_entries').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (cur.error) throw cur.error; if (!cur.data) return fail(404, 'Entry not found.');
  const { data, error } = await db().from('time_entries').update(fields).eq('tenant_id', tenantId).eq('id', id).select('*');
  if (error) { if (/one_running/.test(error.message)) return fail(409, 'This worker already has a running task.'); throw error; }
  if (!(data ?? []).length) return fail(404, 'Entry not found.');
  if (timesChanged(cur.data, data![0])) await logEdit(tenantId, 'update', cur.data, data![0], actor);
  return { ok: true, id };
}
export async function deleteEntry(tenantId: string, id: string, actor: Actor): Promise<boolean> {
  const { data, error } = await db().from('time_entries').delete().eq('tenant_id', tenantId).eq('id', id).select('*');
  if (error) throw error;
  if (!(data ?? []).length) return false;
  await logEdit(tenantId, 'delete', data![0], null, actor);
  return true;
}
export async function listRates(tenantId: string): Promise<Map<string, number>> { return new Map((await all('worker_rates', 'user_id,rate', tenantId, 'user_id')).map((r) => [r.user_id, Number(r.rate)])); }
/** All rate rows (rate_history); before migration 0086 the current worker rates, valid since always. */
export async function rateRows(tenantId: string): Promise<RateRow[]> {
  try { return (await all('rate_history', 'user_id,rate,valid_from,set_by,set_at', tenantId, 'valid_from')).map((r) => ({ ...r, rate: r.rate === null ? null : Number(r.rate) })); }
  catch (e: any) {
    if (!/rate_history/.test(String(e?.message ?? ''))) throw e;
    return (await all('worker_rates', 'user_id,rate', tenantId, 'user_id')).map((r) => ({ user_id: r.user_id, rate: Number(r.rate), valid_from: SINCE_ALWAYS }));
  }
}
export const todayPL = () => local(new Date().toISOString()).date;
const NEEDS_0086 = 'Rates with a start date need migration 0086.';
async function putRateRow(tenantId: string, by: string, userId: string | null, rate: number | null, validFrom: string): Promise<void> {
  let del = db().from('rate_history').delete().eq('tenant_id', tenantId).eq('valid_from', validFrom);
  del = userId ? del.eq('user_id', userId) : del.is('user_id', null);
  const d = await del; if (d.error) throw d.error;
  const { error } = await db().from('rate_history').insert({ tenant_id: tenantId, user_id: userId, rate, valid_from: validFrom, set_by: by, set_at: new Date().toISOString() });
  if (error) throw error;
}
/** worker_rates keeps each worker's rate valid today (what the screens show as "current"). */
async function syncCurrent(tenantId: string, by: string, userId: string): Promise<void> {
  const cur = rowOn(rateBook(await rateRows(tenantId)).workers.get(userId), todayPL());
  const r = cur && cur.rate !== null
    ? await db().from('worker_rates').upsert({ user_id: userId, tenant_id: tenantId, rate: cur.rate, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    : await db().from('worker_rates').delete().eq('user_id', userId);
  if (r.error) throw r.error;
}
function validDay(v: unknown): string | null {
  const s = clean(v) || todayPL();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && s >= SINCE_ALWAYS && s <= '2100-12-31' ? s : null;
}
/** A worker's rate from a day on (default today). Empty rate = from that day no own rate. The first change
 *  keeps the rate set before it as valid since always, so hours already logged keep their price. */
export async function setRate(tenantId: string, by: string, userId: string, rate: number | null, validFrom?: unknown): Promise<Result<{ validFrom: string }>> {
  const u = await db().from('app_users').select('id').eq('tenant_id', tenantId).eq('id', userId).maybeSingle();
  if (u.error) throw u.error; if (!u.data) return fail(404, 'Worker not found.');
  if (rate !== null && !(rate >= 0 && rate <= 10000)) return fail(400, 'Enter a rate per hour.');
  const day = validDay(validFrom); if (!day) return fail(400, 'Enter the date the rate is valid from.');
  const probe = await db().from('rate_history').select('valid_from').eq('tenant_id', tenantId).eq('user_id', userId).limit(1);
  if (probe.error) { if (/rate_history/.test(probe.error.message)) return fail(503, NEEDS_0086); throw probe.error; }
  if (!probe.data?.length && day > SINCE_ALWAYS) {
    const cur = await db().from('worker_rates').select('rate').eq('user_id', userId).maybeSingle();
    if (cur.data) await putRateRow(tenantId, by, userId, Number(cur.data.rate), SINCE_ALWAYS);
  }
  await putRateRow(tenantId, by, userId, rate, day);
  await syncCurrent(tenantId, by, userId);
  return { ok: true, validFrom: day };
}
/** Remove one dated rate (a mistake); the rate before it applies again from that day. */
export async function removeRateRow(tenantId: string, by: string, userId: string, validFrom: unknown): Promise<Result> {
  const day = clean(validFrom);
  const { data, error } = await db().from('rate_history').delete().eq('tenant_id', tenantId).eq('user_id', userId).eq('valid_from', day).select('valid_from');
  if (error) { if (/rate_history/.test(error.message)) return fail(503, NEEDS_0086); throw error; }
  if (!data?.length) return fail(404, 'Rate not found.');
  await syncCurrent(tenantId, by, userId);
  return { ok: true };
}
/** The default labour rate changed (Job costs): keep the old one for hours before today. No-op before 0086. */
export async function recordDefaultRate(tenantId: string, by: string, oldRate: number, newRate: number): Promise<void> {
  const probe = await db().from('rate_history').select('valid_from').eq('tenant_id', tenantId).is('user_id', null).limit(1);
  if (probe.error) { if (/rate_history/.test(probe.error.message)) return; throw probe.error; }
  const day = todayPL();
  if (!probe.data?.length && day > SINCE_ALWAYS) await putRateRow(tenantId, by, null, oldRate, SINCE_ALWAYS);
  await putRateRow(tenantId, by, null, newRate, day);
}
