// Production time on the phone: pure helpers for the time screen (grouping, search, durations).
// WEM tasks (generated from an order) also carry their catalogue code, position, workstation and planned quantity;
// their entries carry the time type (chosen at START) and the quantity done (typed at STOP).
export interface ProdTask { id: string; job_ref: string; operation: string; alias: string | null; export_name: string; code?: string | null; position?: string | null; station?: string | null; planned_qty?: number | null; unit?: string | null }
export type TimeType = 'work' | 'setup' | 'rework';
export interface TimeEntry { id: string; task_id: string | null; task_name: string | null; started_at: string; ended_at: string | null; note?: string | null; job_key?: string | null; time_type?: TimeType | null; qty_done?: number | null }
/** Started with "Bez zadania" and no task picked yet (no task and no job — not a removed task, which keeps its job). */
export const isFree = (e: Pick<TimeEntry, 'task_id' | 'job_key'>) => !e.task_id && !e.job_key;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[._\s]+/g, ' ').trim();
/** Tasks matching the search ("394", "z394 szkl", "szklenie"), grouped by job, newest job first. */
export function groupTasks(tasks: ProdTask[], query: string): { job: string; tasks: ProdTask[] }[] {
  const words = norm(query).split(' ').filter(Boolean);
  const hit = (t: ProdTask) => { const hay = norm(`${t.job_ref} ${t.job_ref.replace('.', '')} ${t.operation} ${t.alias ?? ''}`); return words.every((w) => hay.includes(w)); };
  const by = new Map<string, ProdTask[]>();
  for (const t of tasks) if (hit(t)) (by.get(t.job_ref) ?? by.set(t.job_ref, []).get(t.job_ref)!).push(t);
  const num = (j: string) => +(/(\d+)/.exec(j)?.[1] ?? 0);
  return [...by.entries()].sort((a, b) => num(b[0]) - num(a[0]) || a[0].localeCompare(b[0])).map(([job, list]) => ({ job, tasks: list.sort(taskOrder) }));
}
/** WEM tasks in the order of the work: by position, then joinery (box SB, then ST), assembly (SK), add-ons, and
 *  downtime / other last; other tasks by name. */
export function taskOrder(x: ProdTask, y: ProdTask): number {
  if (!x.code || !y.code) return x.operation.localeCompare(y.operation);
  const key = (t: ProdTask) => { const [head, , step = ''] = String(t.code).split('-'); const pos = parseInt(String(t.position ?? ''), 10);
    const rank = head === 'OGL' ? 5 : head === 'DOD' ? 4 : /^SB/.test(step) ? 1 : /^ST/.test(step) ? 2 : /^SK/.test(step) ? 3 : 4;
    return { pos: Number.isFinite(pos) ? pos : 99999, rank, step }; };
  const a = key(x), b = key(y);
  return a.pos - b.pos || a.rank - b.rank || a.step.localeCompare(b.step) || String(x.code).localeCompare(String(y.code));
}

// ---- WEM: the time type at START and the quantity at STOP -------------------------------------------
export const TIME_TYPES: [TimeType, string][] = [['work', 'Praca'], ['setup', 'Przezbrojenie'], ['rework', 'Poprawka']];
export const typeLabel = (t: TimeType | null | undefined) => TIME_TYPES.find((x) => x[0] === t)?.[1] ?? '';
/** A WEM task measured per piece: it has a code and a planned quantity (downtime and "other" have none). */
export const measured = (t: ProdTask | null | undefined) => !!t && !!t.code && t.planned_qty != null;
/** What the quantity field starts with: work — what is left of the plan; setup — 0; rework — empty (type it). */
export function qtyDefault(type: TimeType | null | undefined, planned: number | null | undefined, done: number): string {
  if (type === 'setup') return '0';
  if (type === 'rework' || planned == null) return '';
  return String(Math.max(0, Math.round((planned - done) * 100) / 100));
}
/** "8", "2,5" → a quantity; empty, negative or not a number → null. */
export function parseQty(text: string): number | null {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s); return n <= 100000 ? n : null;
}
/** "zrobione 3 / 8 szt. skrzydła" */
export const doneLine = (t: ProdTask, done: number) => `zrobione ${fmtQty(done)} / ${fmtQty(t.planned_qty ?? 0)}${t.unit ? ' ' + t.unit : ''}`;
export const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
/** "1:05:09" for a running timer. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Hours worked today (finished entries plus the running one up to `now`). */
export function hoursToday(entries: TimeEntry[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let ms = 0;
  for (const e of entries) {
    const a = Math.max(Date.parse(e.started_at), start), b = e.ended_at ? Date.parse(e.ended_at) : now.getTime();
    if (b > a) ms += b - a;
  }
  return Math.round((ms / 3600000) * 100) / 100;
}

// ---- "Moje zadania": the tasks the worker used last, for one-tap switching -------------------------
/** The last `n` different tasks the worker started (newest first), that are still open. */
export function recentTasks(entries: TimeEntry[], tasks: ProdTask[], n = 6): ProdTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: ProdTask[] = [];
  const sorted = entries.slice().sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  for (const e of sorted) {
    const t = e.task_id ? byId.get(e.task_id) : undefined;
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}
/** "Z.394 · szklenie" */
/** "Z.394 · szklenie" — or just the name when it already starts with the job ("Z_437_cnc_Poz_1_…"). */
export function taskLabel(t: Pick<ProdTask, 'job_ref' | 'operation'>): string {
  const m = /^([A-Za-z]+)[.\s_-]?(\d+)/.exec(t.job_ref.trim());
  const startsWithJob = !!m && new RegExp(`^${m[1]}[.\\s_-]?${m[2]}(?!\\d)`, 'i').test(t.operation.trim());
  return startsWithJob ? t.operation : `${t.job_ref} · ${t.operation}`;
}

// ---- correcting an entry on the phone: same day only, the time moves, the date never does ------------
/** Time logged today per task (ms), the running entry up to now — for the "dziś 1:30" note on each task. */
export function todayByTask(entries: TimeEntry[], now: Date): Map<string, number> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), out = new Map<string, number>();
  for (const e of entries) {
    if (!e.task_id) continue;
    const a = Math.max(Date.parse(e.started_at), start), b = e.ended_at ? Date.parse(e.ended_at) : now.getTime();
    if (b > a) out.set(e.task_id, (out.get(e.task_id) ?? 0) + (b - a));
  }
  return out;
}
/** Entries started today (the number on the "Moje wpisy" tab). */
export const countToday = (entries: TimeEntry[], now: Date) => entries.filter((e) => sameDay(new Date(e.started_at), now)).length;
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** An entry of today — only these can be deleted on the phone. */
export const editableToday = (e: TimeEntry, now: Date) => sameDay(new Date(e.started_at), now);
/** A worker may correct own entries of the last 7 days — today and the 6 days before (older: the production
 *  manager). prod_edit_entry checks the same on the server. */
export function editableRecent(e: TimeEntry, now: Date): boolean {
  const d = new Date(e.started_at), first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return d.getTime() >= first.getTime() && d.getTime() <= now.getTime() + 60000;
}
/** The task's name as this worker set it on the phone, otherwise "Z.394 · szklenie". */
export const taskName = (t: Pick<ProdTask, 'id' | 'job_ref' | 'operation'>, own: Record<string, string>) => (own[t.id]?.trim() || taskLabel(t));
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** Move a time by `minutes`, never leaving its day (stops at 00:00 and 23:59). */
export function shiftWithinDay(d: Date, minutes: number): Date {
  const x = new Date(d.getTime() + minutes * 60000);
  if (sameDay(x, d)) return x;
  const y = new Date(d); return minutes < 0 ? (y.setHours(0, 0, 0, 0), y) : (y.setHours(23, 59, 0, 0), y);
}
/** "07:45" typed on the day of `d` → that time on the same day; null when not a valid time. */
export function atTime(d: Date, text: string): Date | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(text);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const y = new Date(d); y.setHours(+m[1], +m[2], 0, 0); return y;
}
/** What is wrong with a corrected entry, in Polish — null when it can be saved. */
export function editProblem(start: Date, end: Date | null, running: boolean, now: Date, note: string): string | null {
  if (note.trim().length > 100) return 'Komentarz może mieć najwyżej 100 znaków.';
  if (start.getTime() > now.getTime()) return 'Początek nie może być w przyszłości.';
  if (running) return null;
  if (!end) return 'Wpisz koniec.';
  if (end.getTime() < start.getTime()) return 'Koniec jest przed początkiem.';
  if (end.getTime() > now.getTime() + 60000) return 'Koniec nie może być w przyszłości.';
  return null;
}
