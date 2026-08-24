// Pure day-bucketing for the fitter agenda — no React/RN imports, so it's unit-testable.
export interface SchedRow {
  id: string; full_code: string | null; room_code: string | null; item_code: string | null;
  flat: string | null; block: string | null; item_type: string | null; kind: string | null;
  install_status: string | null; planned_install_date: string | null; job_id: string;
  jobs?: { client_code: string | null; job_code: string | null; name: string | null } | null;
}
export interface SchedSection { title: string; accent?: string; data: SchedRow[] }

const ACCENT_TODAY = '#16a34a';   // green
const ACCENT_OVERDUE = '#e6187e'; // magenta
const INSTALLED = new Set(['installed_no_snag', 'installed_snag']);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isoDate = iso;

// 42 day cells (6 weeks) covering the month that `cursor` falls in, week starting Monday.
// Returns local YYYY-MM-DD strings; the caller decides which fall inside the month.
export function monthGrid(cursor: Date, weekStartsOn = 1): string[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const back = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(first); start.setDate(1 - back);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); out.push(iso(d)); }
  return out;
}

// Count of items per planned day (ignores unscheduled).
export function countByDay(rows: SchedRow[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) if (r.planned_install_date) m[r.planned_install_date] = (m[r.planned_install_date] ?? 0) + 1;
  return m;
}

// `now` is injectable so tests are deterministic; defaults to the current day.
export function buildSections(rows: SchedRow[], now: Date = new Date()): { sections: SchedSection[]; counts: { today: number; tomorrow: number; week: number } } {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayIso = iso(today);
  const dayIso = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return iso(d); };

  const overdue: SchedRow[] = [];
  const byDay: Record<string, SchedRow[]> = {};
  const later: SchedRow[] = [];
  const unscheduled: SchedRow[] = [];

  for (const r of rows) {
    const d = r.planned_install_date;
    if (!d) { unscheduled.push(r); continue; }
    if (d < todayIso) {
      if (INSTALLED.has(r.install_status ?? '')) continue; // done + in the past → not "overdue"
      overdue.push(r); continue;
    }
    let within = -1; for (let i = 0; i <= 13; i++) { if (d === dayIso(i)) { within = i; break; } }
    if (within >= 0) (byDay[d] ??= []).push(r);
    else later.push(r);
  }

  const dayTitle = (offset: number, isoStr: string) => {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    const [y, m, dd] = isoStr.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    return `${WD[dt.getDay()]} ${dd} ${MO[m - 1]}`;
  };

  const sections: SchedSection[] = [];
  if (overdue.length) sections.push({ title: `Overdue (${overdue.length})`, accent: ACCENT_OVERDUE, data: overdue });
  for (let i = 0; i <= 13; i++) {
    const key = dayIso(i);
    if (byDay[key]?.length) sections.push({ title: dayTitle(i, key), accent: i === 0 ? ACCENT_TODAY : undefined, data: byDay[key] });
  }
  if (later.length) sections.push({ title: 'Later', data: later });
  if (unscheduled.length) sections.push({ title: 'Not scheduled yet', data: unscheduled });

  const weekCount = rows.filter((r) => { const d = r.planned_install_date; if (!d) return false; for (let i = 0; i <= 6; i++) if (d === dayIso(i)) return true; return false; }).length;
  return { sections, counts: { today: byDay[dayIso(0)]?.length ?? 0, tomorrow: byDay[dayIso(1)]?.length ?? 0, week: weekCount } };
}
