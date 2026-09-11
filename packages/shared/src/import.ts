// ============================================================
//  Excel-import model (Operations ▸ Mapping ▸ Import from Excel).
//  Shared between the office server (which re-derives the "Unfinished" flag on commit)
//  and the Node unit test. The office page's client JS keeps its own inline copies of the
//  header aliases + room map (it can't import modules), but the completeness rules live here.
// ============================================================

export interface ImportRow { [k: string]: any }

// Every per-item field the grid carries, in column order. These map 1:1 onto survey_items.
export const IMPORT_FIELDS = [
  'block', 'elevation', 'flat', 'floor', 'room', 'item',
  'material', 'item_type', 'window_type', 'glass', 'safety_glass', 'glazing', 'glazing_bars',
  'width_mm', 'height_mm', 'cill_depth',
  'transom1_mm', 'transom2_mm', 'transom3_mm', 'mullion1_mm', 'mullion2_mm', 'mullion3_mm',
  'open_in_out', 'add_ons', 'coupled', 'design_code', 'comments',
] as const;

// Fields that MUST be filled for an item to count as COMPLETE. Missing any ⇒ 'Unfinished'.
// The level segment is satisfied by EITHER flat or floor (handled specially below).
// Genuinely-optional fields (transoms, mullions, add-ons, cill, coupled, safety glass,
// glazing bars, window type, design code, comments) are NOT required.
export const REQUIRED_FIELDS = [
  'block', 'elevation', 'item', 'room',
  'material', 'item_type', 'glass', 'glazing',
  'width_mm', 'height_mm', 'open_in_out', 'design_code',
] as const;

// Human labels for the required fields (used in the "why unfinished" tooltip).
export const FIELD_LABELS: Record<string, string> = {
  block: 'Block', elevation: 'Elevation', flat: 'Flat', floor: 'Floor', 'flat/floor': 'Flat or Floor',
  room: 'Room', item: 'Item', material: 'Material', item_type: 'Item type',
  glass: 'Glass', glazing: 'Glazing', width_mm: 'Width', height_mm: 'Height', open_in_out: 'Open in/out',
  design_code: 'Style (design code)',
};

export const NUMERIC_FIELDS = [
  'width_mm', 'height_mm', 'cill_depth',
  'transom1_mm', 'transom2_mm', 'transom3_mm', 'mullion1_mm', 'mullion2_mm', 'mullion3_mm',
];

const s = (v: any): string => (v == null ? '' : String(v).trim());

// Which required fields are missing from a row. flat/floor: at least one is needed (the level segment).
export function missingRequired(row: ImportRow): string[] {
  const miss: string[] = [];
  for (const f of REQUIRED_FIELDS) { if (!s(row[f])) miss.push(f); }
  if (!s(row.flat) && !s(row.floor)) miss.push('flat/floor');
  return miss;
}

export function isRowComplete(row: ImportRow): boolean {
  return missingRequired(row).length === 0;
}

// Parse a millimetre value that may arrive as "640", "640mm", 640, "" → integer or null.
export function toMm(v: any): number | null {
  const t = s(v).replace(/mm/i, '').replace(/[, ]/g, '');
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) ? n : null;
}
