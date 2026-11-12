// Production time ▸ Clockify import. The production manager exports the day from Clockify into the OneDrive folder
// "Clockify eksport" (Clockify YYYY-MM-DD.xlsx, sheet "Wpisy": Data, Osoba, Start, Koniec, Czas, Czas [h], Projekt,
// Zadanie, Opis). Each row becomes an Acemark time entry (source "clockify"): the worker matched to an app user by
// name (so their hourly rate applies; an unknown name is kept as written and priced at the default rate), the job
// from the Z number in the task ("Z_439_skladanie_…" → Z.439), the task from the task list when the name is on it.
// "Poza planem …" rows (outside the plan) are kept with no job. Re-importing a day replaces that day's Clockify
// entries, so a second run never doubles the hours. Times are Polish local time.
import { db } from './supabase';
import { referenceKey } from './finJobs';
import { jobRefOf, local, companyReady, type ProdCompany } from './prodTime';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Letters and digits only, lower case, no Polish marks: "Kamil Teodorczyk" → "kamilteodorczyk". */
export const nameKey = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');

export interface ClockifyRow { date: string; person: string; start: string; end: string; task: string; note: string | null; job_ref: string | null }

/** "12.11.2026" / "2026-11-12" / an Excel day number → "2026-11-12". */
export function dayOf(v: unknown): string | null {
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = clean(v);
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** "6:00" / "06:00:00" / an Excel fraction of a day → "06:00". */
export function timeOf(v: unknown): string | null {
  if (typeof v === 'number' && v >= 0 && v < 1) { const min = Math.round(v * 1440); return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(clean(v)); if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
/** A Polish local day and time → the UTC instant (summer or winter time, as on that day). */
export function polishInstant(day: string, hm: string): string {
  for (const off of ['+01:00', '+02:00']) { const iso = new Date(`${day}T${hm}:00${off}`).toISOString(); const l = local(iso); if (l.date === day && l.time.slice(0, 5) === hm) return iso; }
  return new Date(`${day}T${hm}:00+01:00`).toISOString();
}
/** The job of a Clockify task: "Z_439_skladanie_Poz_2…" → "Z.439"; "Poza planem …" (outside the plan) → null. */
export function jobOfTask(task: string): string | null {
  const m = /^Z[\s._-]?(\d{1,5})(?!\d)/i.exec(clean(task));
  return m ? 'Z.' + m[1] : null;
}

/** The "Wpisy" sheet (rows of cells, the header first or not) → the entries; rows it cannot read are counted. */
export function parseClockify(rows: unknown[][]): { rows: ClockifyRow[]; skipped: number; days: string[] } {
  const out: ClockifyRow[] = []; let skipped = 0;
  let col = { date: 0, person: 1, start: 2, end: 3, task: 7, note: 8 };
  for (const r of rows) {
    const cells = (r ?? []).map((c) => (typeof c === 'number' ? c : clean(c)));
    const head = cells.map((c) => String(c).toLowerCase());
    if (head.includes('osoba') && head.some((c) => c.startsWith('zadanie'))) {   // the header: take the columns from it
      const at = (re: RegExp, d: number) => { const i = head.findIndex((c) => re.test(c)); return i >= 0 ? i : d; };
      col = { date: at(/^data$/, 0), person: at(/^osoba$/, 1), start: at(/^start$/, 2), end: at(/^koniec$/, 3), task: at(/^zadanie/, 7), note: at(/^opis/, 8) };
      continue;
    }
    if (!cells.some((c) => String(c) !== '')) continue;
    const date = dayOf(cells[col.date]), start = timeOf(cells[col.start]), end = timeOf(cells[col.end]);
    const person = clean(cells[col.person]), task = clean(cells[col.task]);
    if (!date || !start || !end || !person || !task) { skipped++; continue; }
    out.push({ date, person: person.slice(0, 120), start, end, task: task.slice(0, 160), note: clean(cells[col.note]).slice(0, 300) || null, job_ref: jobOfTask(task) });
  }
  return { rows: out, skipped, days: [...new Set(out.map((x) => x.date))].sort() };
}

/** A Clockify name → the app user it is: the whole name ("Kamilteodorczyk" = "Kamil Teodorczyk"), the e-mail's
 *  first part, or initial + surname ("G.kozlowski" = "Grzegorz Kozłowski"). */
export function matchWorker(person: string, users: { id: string; name: string | null; email: string | null }[]): { id: string; name: string | null; email: string | null } | null {
  const k = nameKey(person); if (!k) return null;
  const full = users.filter((u) => nameKey(u.name) === k || nameKey(String(u.email ?? '').split('@')[0]) === k);
  if (full.length === 1) return full[0];
  const init = users.filter((u) => { const parts = String(u.name ?? '').trim().split(/\s+/); return parts.length >= 2 && nameKey(parts[0]).slice(0, 1) + nameKey(parts.slice(1).join('')) === k; });
  return init.length === 1 ? init[0] : null;
}

export interface ImportResult { days: string[]; added: number; replaced: number; skipped: number; withJob: number; outsidePlan: number; hours: number; unmatched: string[]; jobs: { job_ref: string; hours: number }[] }
/** Bring the rows into time entries (Acemark). The days in the file are replaced as a whole. */
export async function importClockify(tenantId: string, by: string, rows: unknown[][], fileName: string | null): Promise<Result<ImportResult>> {
  const p = parseClockify(rows);
  if (!p.rows.length) return fail(400, 'No Clockify entries found — use the “Wpisy” sheet (Data, Osoba, Start, Koniec, …, Zadanie, Opis).');
  if (p.days.length > 31) return fail(400, 'At most 31 days in one import.');
  const company: ProdCompany = 'acemark', co = await companyReady();
  const [usersR, tasksR] = await Promise.all([
    db().from('app_users').select('id,name,email').eq('tenant_id', tenantId),
    db().from('prod_tasks').select('id,export_name,job_key').eq('tenant_id', tenantId),
  ]);
  if (usersR.error) throw usersR.error; if (tasksR.error) throw tasksR.error;
  const users = (usersR.data ?? []) as any[], taskBy = new Map<string, any>();
  for (const t of (tasksR.data ?? []) as any[]) if (t.export_name && !taskBy.has(nameKey(t.export_name))) taskBy.set(nameKey(t.export_name), t);
  const unmatched = new Set<string>(); const jobs = new Map<string, number>(); let hours = 0, withJob = 0, outsidePlan = 0;
  const ins: Record<string, any>[] = [];
  for (const r of p.rows) {
    const s = polishInstant(r.date, r.start); let e = polishInstant(r.date, r.end);
    if (Date.parse(e) < Date.parse(s)) e = new Date(Date.parse(e) + 86400000).toISOString();   // past midnight
    const h = (Date.parse(e) - Date.parse(s)) / 3600000; if (h > 16) continue;
    const u = matchWorker(r.person, users); if (!u) unmatched.add(r.person);
    const t = taskBy.get(nameKey(r.task));
    const jobRef = r.job_ref ? jobRefOf(r.job_ref) : null, jobKey = t?.job_key ?? (jobRef ? referenceKey(jobRef) : null);
    if (jobKey) { withJob++; jobs.set(jobRef ?? jobKey, (jobs.get(jobRef ?? jobKey) ?? 0) + h); } else outsidePlan++;
    hours += h;
    ins.push({ tenant_id: tenantId, user_id: u?.id ?? null, user_name: u?.name ?? r.person, user_email: u?.email ?? null, task_id: t?.id ?? null, task_name: r.task, job_key: jobKey,
      started_at: s, ended_at: e, note: [r.note, u ? null : 'Clockify: ' + r.person].filter(Boolean).join(' · ').slice(0, 300) || null, source: 'clockify', edited_by: by, ...(co ? { company } : {}) });
  }
  // replace the days of the file: the Clockify entries that start on them (Polish days)
  let replaced = 0;
  for (const d of p.days) {
    const from = polishInstant(d, '00:00'), to = polishInstant(new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10), '00:00');
    let q = db().from('time_entries').delete().eq('tenant_id', tenantId).eq('source', 'clockify').gte('started_at', from).lt('started_at', to);
    if (co) q = q.eq('company', company);
    const { data, error } = await q.select('id'); if (error) throw error; replaced += (data ?? []).length;
  }
  for (let i = 0; i < ins.length; i += 500) { const { error } = await db().from('time_entries').insert(ins.slice(i, i + 500)); if (error) throw error; }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  void fileName;
  return { ok: true, days: p.days, added: ins.length, replaced, skipped: p.skipped, withJob, outsidePlan, hours: r2(hours), unmatched: [...unmatched].sort(), jobs: [...jobs].map(([job_ref, h]) => ({ job_ref, hours: r2(h) })).sort((a, b) => b.hours - a.hours) };
}
