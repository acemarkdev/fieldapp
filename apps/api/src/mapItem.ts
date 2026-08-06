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

const INSTALL_STATUS_LABEL: Record<InstallStatus, string> = {
  scheduled: 'Scheduled',
  installed_no_snag: 'Installed no snag',
  installed_snag: 'Installed + snag',
  snag: 'Snag',
  misfit: 'MisFit',
  delayed: 'Delayed',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

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
    { title: 'Glass', value: item.glass },
    { title: 'Safety Glass', value: item.safety_glass },
    { title: 'Glazing', value: item.glazing },
    { title: 'Width', value: item.width_mm },
    { title: 'Height (inc Cill)', value: item.height_mm },
    { title: 'Cill Depth', value: item.cill_depth_mm },
    { title: 'Transom 1 (from top)', value: item.transom1_mm },
    { title: 'Transom 2 (from top)', value: item.transom2_mm },
    { title: 'Mullion 1 (from left)', value: item.mullion1_mm },
    { title: 'Mullion 2 (from left)', value: item.mullion2_mm },
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
      default: // text, long_text, etc.
        out[col.id] = String(value);
    }
  }
  return out;
}
