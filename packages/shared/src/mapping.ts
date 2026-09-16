// Shared mapping model — the single source of truth for building a job's items from an
// elevation × floor grid. Used by the office web app and (soon) the iPad/iPhone apps so all
// three produce identical item codes and preload rows.
//
// Segment order for a full item code:  CLIENT.JOB.BLOCK.ELEV.LEVEL.ROOM.ITEM  (empty parts skipped).
// LEVEL is the Flat when set, otherwise the mapping Floor; a plain number renders as F{n}
// (e.g. 1 -> F1, 11 -> F11) and a label (e.g. GF) is kept as-is.

export type ItemKind = 'Window' | 'Door';

/** Clamp a grid dimension to a sane 1..60 range (matches the office inputs). */
export function clampDim(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(60, Math.max(1, v));
}

/** Floor label for a 1-based row index: 1 -> "GF" (ground floor), then F1, F2, … */
export function floorLabel(oneBasedIndex: number): string {
  return oneBasedIndex === 1 ? 'GF' : `F${oneBasedIndex - 1}`;
}

/** The ordered floor labels for a grid of `nFloors` floors (GF first). */
export function buildFloors(nFloors: number): string[] {
  const n = clampDim(nFloors);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(floorLabel(i));
  return out;
}

/**
 * Normalise a level (flat or floor) into its code segment.
 * Strips a leading F before a digit, then re-adds F for plain numbers; labels are upper-cased.
 * "1" -> "F1", "F1" -> "F1", "11" -> "F11", "GF" -> "GF", "" -> "".
 */
export function levelSeg(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^F(?=[0-9])/i, '');
  if (!s) return '';
  return /^[0-9]+$/.test(s) ? `F${s}` : s.toUpperCase();
}

/** The level used in the code: the Flat if provided, otherwise the Floor. */
export function levelOf(floor: unknown, flat: unknown): unknown {
  return flat != null && String(flat).trim() !== '' ? flat : floor;
}

export interface ItemCodeParts {
  client: string;
  job: string;
  block?: unknown;
  elevation?: unknown;
  flat?: unknown;
  floor?: unknown;
  room?: unknown;
  item: unknown;
}

/** Build a full item code from its parts (empty parts skipped). */
export function buildItemCode(p: ItemCodeParts): string {
  const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const level = levelSeg(levelOf(p.floor, p.flat));
  return [p.client, p.job, up(p.block), up(p.elevation), level, up(p.room), up(p.item)]
    .filter(Boolean)
    .join('.');
}

// ---- Grid model ----

export interface FloorCell {
  floor: string;
  windows: number;
  doors: number;
}
export interface ElevationGrid {
  elevation: string; // E1, E2, …
  floors: FloorCell[];
}
export interface MappingGrid {
  block: string;
  elevations: ElevationGrid[];
}

/** Build an empty elevation × floor grid: `nElevations` cards (E1…), each with GF-first floors. */
export function buildGrid(opts: { block: string; nElevations: number; nFloors: number }): MappingGrid {
  const block = String(opts.block ?? '').trim().toUpperCase();
  const nE = clampDim(opts.nElevations);
  const floors = buildFloors(opts.nFloors);
  const elevations: ElevationGrid[] = [];
  for (let e = 1; e <= nE; e++) {
    elevations.push({
      elevation: `E${e}`,
      floors: floors.map((floor) => ({ floor, windows: 0, doors: 0 })),
    });
  }
  return { block, elevations };
}

/** Live totals across the whole grid. */
export function tallyGrid(grid: MappingGrid): { windows: number; doors: number; items: number } {
  let windows = 0;
  let doors = 0;
  for (const el of grid.elevations) {
    for (const f of el.floors) {
      windows += Math.max(0, Math.floor(Number(f.windows) || 0));
      doors += Math.max(0, Math.floor(Number(f.doors) || 0));
    }
  }
  return { windows, doors, items: windows + doors };
}

export interface PreloadRow {
  block: string;
  elevation: string;
  floor: string;
  flat: string;
  item: string; // W1, W2, … / D1, D2, …
  item_type: ItemKind;
}

/**
 * Expand the grid into preload rows — one per window/door on every floor.
 * Windows become W1..Wn, doors D1..Dn, each carrying its elevation and floor.
 * This is exactly what the office "Preload" produces and what /api/job/:id/mapping-items expects.
 */
export function preloadRows(grid: MappingGrid): PreloadRow[] {
  const block = String(grid.block ?? '').trim().toUpperCase();
  const rows: PreloadRow[] = [];
  for (const el of grid.elevations) {
    const elevation = String(el.elevation ?? '').trim().toUpperCase();
    for (const f of el.floors) {
      const floor = String(f.floor ?? '').trim();
      const w = Math.max(0, Math.floor(Number(f.windows) || 0));
      const d = Math.max(0, Math.floor(Number(f.doors) || 0));
      for (let k = 1; k <= w; k++) rows.push({ block, elevation, floor, flat: '', item: `W${k}`, item_type: 'Window' });
      for (let k = 1; k <= d; k++) rows.push({ block, elevation, floor, flat: '', item: `D${k}`, item_type: 'Door' });
    }
  }
  return rows;
}

/**
 * A ready-to-insert survey_items record built from a preload row — mirrors exactly what the
 * office server's /api/job/:id/mapping-items endpoint creates, so office / iPad / iPhone all
 * write identical rows. Floor keeps its F (1 -> F1, GF stays GF); Flat is a bare number.
 */
export interface MappingItemRecord {
  tenant_id?: string;
  job_id?: string;
  kind: 'item';
  stage: string;
  block: string | null;
  elevation: string | null;
  floor: string | null;
  flat: string | null;
  item_code: string;
  item_type: ItemKind | null;
  full_code: string;
  created_via: 'mapping';
  created_by?: string;
  scanned_by?: string;
}

export interface MappingRecordOpts {
  client_code: string;
  job_code: string;
  tenant_id?: string;
  job_id?: string;
  createdBy?: string | null; // app_users.id — sets created_by + scanned_by when provided
  stage?: string; // defaults to 'scanned'
}

/**
 * Turn a grid into deduped, ready-to-insert survey_items records. Same normalisation and code
 * building as the office endpoint. Duplicate full codes within the batch are dropped.
 */
export function mappingItemRecords(grid: MappingGrid, opts: MappingRecordOpts): MappingItemRecord[] {
  const stage = opts.stage ?? 'scanned';
  const seen = new Set<string>();
  const out: MappingItemRecord[] = [];
  for (const r of preloadRows(grid)) {
    const floor = levelSeg(String(r.floor ?? '').trim());
    const flat = String(r.flat ?? '').trim().replace(/^F(?=[0-9])/i, '');
    const item = String(r.item ?? '').trim().toUpperCase();
    if (!item) continue;
    const block = String(r.block ?? '').trim().toUpperCase() || null;
    const elevation = String(r.elevation ?? '').trim().toUpperCase() || null;
    const full_code = buildItemCode({ client: opts.client_code, job: opts.job_code, block, elevation, flat, floor, item });
    if (seen.has(full_code)) continue;
    seen.add(full_code);
    const rec: MappingItemRecord = {
      kind: 'item', stage,
      block, elevation, floor: floor || null, flat: flat || null,
      item_code: item, item_type: r.item_type ?? null, full_code,
      created_via: 'mapping',
    };
    if (opts.tenant_id) rec.tenant_id = opts.tenant_id;
    if (opts.job_id) rec.job_id = opts.job_id;
    if (opts.createdBy) { rec.created_by = opts.createdBy; rec.scanned_by = opts.createdBy; }
    out.push(rec);
  }
  return out;
}

/** Split a coupled item into `n` numbered lines: expandCouple("W3", 2) -> ["W3.1","W3.2"]. */
export function expandCouple(item: string, n: number): string[] {
  const base = String(item ?? '').trim().toUpperCase();
  const count = clampDim(n);
  if (!base) return [];
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${base}.${i}`);
  return out;
}
