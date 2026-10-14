// Production time on the phone: pure helpers for the time screen (grouping, search, durations).
export interface ProdTask { id: string; job_ref: string; operation: string; alias: string | null; export_name: string }
export interface TimeEntry { id: string; task_id: string | null; task_name: string | null; started_at: string; ended_at: string | null }

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
