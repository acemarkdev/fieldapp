// Maps a canonical survey item onto Monday column values, matching columns BY TITLE
// (never by hard-coded id) so it works across every board, however it was created.

import type { SurveyItem, InstallStatus } from '@ace/shared';
import type { MondayColumn } from './monday';

// Survey field -> Monday column TITLE. Titles are the stable contract.
export interface SyncInputs {
  item: SurveyItem;
  teamName?: string | null;   // e.g. "Team P01" (matched loosely against the board's dropdown)
  ratePounds?: number | null; // effective fitting rate, in pounds, for Labour Cost
}

export const INSTALL_STATUS_LABEL: Record<InstallStatus, string> = {
  scheduled: 'Scheduled',
  installed_no_snag: 'Installed no snag',
  installed_snag: 'Installed + snag',
  snag: 'Snag',
  misfit: 'MisFit',
  delayed: 'Delayed',
};

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// The columns the sync + photo push rely on, by TITLE and Monday column_type. When a board is
// linked to a job, any of these that are missing (by normalised title) are auto-created.
export const REQUIRED_MONDAY_COLUMNS: { title: string; type: string }[] = [
  { title: 'Block', type: 'text' }, { title: 'Elevation', type: 'text' }, { title: 'Flat / Plot No.', type: 'text' },
  { title: 'Room', type: 'text' }, { title: 'Item', type: 'text' }, { title: 'Floor', type: 'text' },
  { title: 'Item Type', type: 'text' }, { title: 'Window Type', type: 'text' }, { title: 'Design Code', type: 'text' },
  { title: 'Glass', type: 'text' }, { title: 'Safety Glass', type: 'text' }, { title: 'Glazing', type: 'text' },
  { title: 'Glazing Bars', type: 'text' },
  { title: 'Open In / Open Out', type: 'text' }, { title: 'Add-Ons Required', type: 'text' }, { title: 'Coupled', type: 'text' },
  { title: 'Comments', type: 'long_text' }, { title: 'Full Location Ref', type: 'long_text' },
  { title: 'Width', type: 'numbers' }, { title: 'Height (inc Cill)', type: 'numbers' }, { title: 'Cill Depth', type: 'text' },
  { title: 'Transom 1 (from top)', type: 'numbers' }, { title: 'Transom 2 (from top)', type: 'numbers' }, { title: 'Transom Equal', type: 'checkbox' },
  { title: 'Mullion 1 (from left)', type: 'numbers' }, { title: 'Mullion 2 (from left)', type: 'numbers' }, { title: 'Mullion Equal', type: 'checkbox' },
  { title: 'Labour Cost', type: 'numbers' },
  { title: 'Material', type: 'dropdown' }, { title: 'Fitters', type: 'dropdown' },
  { title: 'Install Status', type: 'status' },
  { title: 'Picture Before', type: 'file' }, { title: 'Picture After', type: 'file' }, { title: 'Design Sketch', type: 'file' },
];

// Column types we must never write to (read-only / not settable via column_values).
// Boards often have several columns sharing a title (e.g. a real "Install Status"
// plus mirror copies), so we must skip these and keep the writable one.
const NON_WRITABLE = new Set([
  'mirror', 'lookup', 'formula', 'button', 'subtasks', 'board_relation',
  'dependency', 'progress', 'auto_number', 'name', 'file', 'doc',
  'creation_log', 'last_updated', 'item_id', 'vote', 'time_tracking',
]);

// Build normalised-title -> WRITABLE column lookup (first writable match wins).
function byTitle(cols: MondayColumn[]): Map<string, MondayColumn> {
  const m = new Map<string, MondayColumn>();
  for (const c of cols) {
    if (NON_WRITABLE.has(c.type)) continue;
    const key = norm(c.title);
    if (!m.has(key)) m.set(key, c);
  }
  return m;
}

// The allowed labels of a status/dropdown column.
// Dropdown labels live under `name`, status labels under `label`, and some status
// columns store them as an object map { "0": "Scheduled", ... } — handle all shapes.
function labelList(col: MondayColumn): string[] {
  const s = col.settings?.labels;
  if (Array.isArray(s)) return s.map((x: any) => (typeof x === 'string' ? x : (x.name ?? x.label))).filter(Boolean);
  if (s && typeof s === 'object') return Object.values(s).filter((v) => typeof v === 'string') as string[];
  return [];
}

// Find the board's exact label matching `wanted`, ignoring case & extra whitespace
// (so "Team P01" maps to a board label of "Team  P01"). Falls back to `wanted`.
function matchLabel(col: MondayColumn, wanted: string): string {
  const hit = labelList(col).find((l) => norm(l) === norm(wanted));
  return hit ?? wanted;
}

export function buildColumnValues(
  cols: MondayColumn[],
  { item, teamName, ratePounds }: SyncInputs,
): Record<string, unknown> {
  const map = byTitle(cols);
  const out: Record<string, unknown> = {};

  const entries: { title: string; value: unknown }[] = [
    { title: 'Block', value: item.block },
    { title: 'Elevation', value: item.elevation },
    { title: 'Flat / Plot No.', value: item.flat },
    { title: 'Room', value: item.room_code },
    { title: 'Item', value: item.item_code },
    { title: 'Floor', value: item.floor },
    { title: 'Material', value: item.material },
    { title: 'Item Type', value: item.item_type },
    { title: 'Window Type', value: item.window_type },
    { title: 'Design Code', value: item.design_code },
    { title: 'Glass', value: item.glass },
    { title: 'Safety Glass', value: item.safety_glass },
    { title: 'Glazing', value: item.glazing },
    { title: 'Glazing Bars', value: (item as any).glazing_bars },
    { title: 'Width', value: item.width_mm },
    { title: 'Height (inc Cill)', value: item.height_mm },
    { title: 'Cill Depth', value: (item as any).cill_depth ?? item.cill_depth_mm },
    { title: 'Transom 1 (from top)', value: item.transom1_mm },
    { title: 'Transom 2 (from top)', value: item.transom2_mm },
    { title: 'Transom Equal', value: (item as any).transom_equal },
    { title: 'Mullion 1 (from left)', value: item.mullion1_mm },
    { title: 'Mullion 2 (from left)', value: item.mullion2_mm },
    { title: 'Mullion Equal', value: (item as any).mullion_equal },
    { title: 'Open In / Open Out', value: item.open_in_out },
    { title: 'Add-Ons Required', value: item.add_ons },
    { title: 'Coupled', value: item.coupled },
    { title: 'Comments', value: item.comments },
    { title: 'Full Location Ref', value: item.full_code },
    { title: 'Fitters', value: teamName ?? null },
    { title: 'Install Status', value: item.install_status ? INSTALL_STATUS_LABEL[item.install_status] : null },
    { title: 'Labour Cost', value: ratePounds ?? null },
  ];

  for (const { title, value } of entries) {
    if (value == null || value === '') continue;
    const col = map.get(norm(title));
    if (!col) continue; // title not on this board — skip, don't guess

    switch (col.type) {
      case 'dropdown':
        out[col.id] = { labels: [matchLabel(col, String(value))] };
        break;
      case 'status':
      case 'color':
        out[col.id] = { label: matchLabel(col, String(value)) };
        break;
      case 'numbers':
      case 'numeric':
        out[col.id] = String(value);
        break;
      case 'checkbox':
        out[col.id] = value ? { checked: 'true' } : { checked: 'false' };
        break;
      default: // text, long_text, etc.
        out[col.id] = String(value);
    }
  }
  return out;
}

// Pick the Monday date column that most likely holds the PLANNED install date.
// Ranks by title keyword (plan+install > install > fit > plan > schedule > due > date); dates that
// say when it happened ("Actual…", "…Done…") or belong to ordering/paying ("…Delivery…", "…Pay…") are
// never picked. If several date columns exist and none matches a keyword we return null rather than
// guess. `forWriting` is stricter: only a column that clearly is the plan (install / fit / plan /
// schedule in its title) — we never write a planned date into a column we merely guessed.
export function pickPlanDateColumn<T extends { id: string; title: string; type: string }>(cols: T[], forWriting = false): T | null {
  const dates = cols.filter((c) => c.type === 'date');
  if (!dates.length) return null;
  const rank = (t: string) => {
    const n = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n.includes('actual') || n.includes('done') || n.includes('delivery') || n.includes('pay') || n.includes('order')) return -2;   // never
    if (n.includes('install') && n.includes('plan')) return 6;
    if (n.includes('install')) return 5;
    if (n.includes('fit')) return 4;
    if (n.includes('plan')) return 3;
    if (n.includes('schedule')) return 2;
    if (n.includes('due')) return 1;
    if (n.includes('date')) return 0;
    return -1;
  };
  const ranked = dates.map((c) => ({ c, r: rank(c.title) })).filter((x) => x.r >= (forWriting ? 2 : 0)).sort((a, b) => b.r - a.r);
  if (ranked.length) return ranked[0].c;
  return !forWriting && dates.length === 1 && rank(dates[0].title) > -2 ? dates[0] : null;
}

/** Column values that put an item's schedule on its Monday row: the team (Fitters), the planned
 *  install date and, when asked, Install Status = Scheduled. `missing` lists what the board lacks. */
export function scheduleColumnValues(
  cols: MondayColumn[],
  s: { teamName: string; date: string; markScheduled: boolean },
): { values: Record<string, unknown>; missing: string[] } {
  const map = byTitle(cols); const values: Record<string, unknown> = {}; const missing: string[] = [];
  const fit = map.get('fitters');
  if (fit && fit.type === 'dropdown') values[fit.id] = { labels: [matchLabel(fit, s.teamName)] }; else missing.push('Fitters');
  const dc = pickPlanDateColumn(cols.filter((c) => !NON_WRITABLE.has(c.type)), true);
  if (dc) values[dc.id] = { date: s.date }; else missing.push('Plan Install Date');
  if (s.markScheduled) {
    const st = map.get('install status');
    if (st && (st.type === 'status' || st.type === 'color')) values[st.id] = { label: matchLabel(st, INSTALL_STATUS_LABEL.scheduled ?? 'Scheduled') };
  }
  return { values, missing };
}
