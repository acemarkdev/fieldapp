// Production time on the phone: pure helpers for the time screen (grouping, search, durations).
export interface ProdTask { id: string; job_ref: string; operation: string; alias: string | null; export_name: string }
export interface TimeEntry { id: string; task_id: string | null; task_name: string | null; started_at: string; ended_at: string | null; note?: string | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[._\s]+/g, ' ').trim();
/** Tasks matching the search ("394", "z394 szkl", "szklenie"), grouped by job, newest job first. */
export function groupTasks(tasks: ProdTask[], query: string): { job: string; tasks: ProdTask[] }[] {
  const words = norm(query).split(' ').filter(Boolean);
  const hit = (t: ProdTask) => { const hay = norm(`${t.job_ref} ${t.job_ref.replace('.', '')} ${t.operation} ${t.alias ?? ''}`); return words.every((w) => hay.includes(w)); };
  const by = new Map<string, ProdTask[]>();
  for (const t of tasks) if (hit(t)) (by.get(t.job_ref) ?? by.set(t.job_ref, []).get(t.job_ref)!).push(t);
  const num = (j: string) => +(/(\d+)/.exec(j)?.[1] ?? 0);
  return [...by.entries()].sort((a, b) => num(b[0]) - num(a[0]) || a[0].localeCompare(b[0])).map(([job, list]) => ({ job, tasks: list.sort((x, y) => x.operation.localeCompare(y.operation)) }));
}
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
export const taskLabel = (t: Pick<ProdTask, 'job_ref' | 'operation'>) => `${t.job_ref} · ${t.operation}`;

// ---- correcting an entry on the phone: same day only, the time moves, the date never does ------------
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** A worker may correct an entry only on the day it was made (older ones: the production manager). */
export const editableToday = (e: TimeEntry, now: Date) => sameDay(new Date(e.started_at), now);
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
