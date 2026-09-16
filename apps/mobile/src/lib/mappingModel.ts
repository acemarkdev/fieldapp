// Mapping model — a self-contained mirror of packages/shared/src/mapping.ts.
// (The mobile app deliberately doesn't import @ace/shared, so keep this in step with it.)
// Builds a job's items from an elevation × floor grid so iPad/iPhone produce codes and
// records identical to the office web app.
//
// Segment order for a full item code:  CLIENT.JOB.BLOCK.ELEV.LEVEL.ROOM.ITEM  (empty parts skipped).
// LEVEL is the Flat when set, otherwise the Floor; a plain number renders as F{n} (1 -> F1,
// 11 -> F11) and a label (e.g. GF) is kept as-is.

export type ItemKind = 'Window' | 'Door';

export function clampDim(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(60, Math.max(1, v));
}

export function floorLabel(oneBasedIndex: number): string {
  return oneBasedIndex === 1 ? 'GF' : `F${oneBasedIndex - 1}`;
}

export function buildFloors(nFloors: number): string[] {
  const n = clampDim(nFloors);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(floorLabel(i));
  return out;
}

export function levelSeg(v: unknown): string {
  const s = String(v ?? '').trim().replace(/^F(?=[0-9])/i, '');
  if (!s) return '';
  return /^[0-9]+$/.test(s) ? `F${s}` : s.toUpperCase();
}

export function levelOf(floor: unknown, flat: unknown): unknown {
  return flat != null && String(flat).trim() !== '' ? flat : floor;
}

export interface ItemCodeParts {
  client: string; job: string;
  block?: unknown; elevation?: unknown; flat?: unknown; floor?: unknown; room?: unknown; item: unknown;
}

export function buildItemCode(p: ItemCodeParts): string {
  const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const level = levelSeg(levelOf(p.floor, p.flat));
  return [p.client, p.job, up(p.block), up(p.elevation), level, up(p.room), up(p.item)]
    .filter(Boolean)
    .join('.');
}

export interface FloorCell { floor: string; windows: number; doors: number; }
export interface ElevationGrid { elevation: string; floors: FloorCell[]; }
export interface MappingGrid { block: string; elevations: ElevationGrid[]; }

export function buildGrid(opts: { block: string; nElevations: number; nFloors: number }): MappingGrid {
  const block = String(opts.block ?? '').trim().toUpperCase();
  const nE = clampDim(opts.nElevations);
  const floors = buildFloors(opts.nFloors);
  const elevations: ElevationGrid[] = [];
  for (let e = 1; e <= nE; e++) {
    elevations.push({ elevation: `E${e}`, floors: floors.map((floor) => ({ floor, windows: 0, doors: 0 })) });
  }
  return { block, elevations };
}

export function tallyGrid(grid: MappingGrid): { windows: number; doors: number; items: number } {
  let windows = 0, doors = 0;
  for (const el of grid.elevations) {
    for (const f of el.floors) {
      windows += Math.max(0, Math.floor(Number(f.windows) || 0));
      doors += Math.max(0, Math.floor(Number(f.doors) || 0));
    }
  }
  return { windows, doors, items: windows + doors };
}

export interface PreloadRow {
  block: string; elevation: string; floor: string; flat: string; item: string; item_type: ItemKind;
}

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

export function expandCouple(item: string, n: number): string[] {
  const base = String(item ?? '').trim().toUpperCase();
  const count = clampDim(n);
  if (!base) return [];
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${base}.${i}`);
  return out;
}

// Bucket jobs available to map by programme status (mirrors the office /api/mapping-jobs):
//   pending = no programme end · done = programme end is past · live = today or future.
export interface WithProgramme { programme_end?: string | null }
export function bucketByProgramme<T extends WithProgramme>(jobs: T[], todayISO: string): { live: T[]; pending: T[]; done: T[] } {
  const live: T[] = [], pending: T[] = [], done: T[] = [];
  for (const j of jobs) {
    const pe = j.programme_end || null;
    if (!pe) pending.push(j);
    else if (pe < todayISO) done.push(j);
    else live.push(j);
  }
  return { live, pending, done };
}

export interface MappingItemRecord {
  tenant_id?: string; job_id?: string; kind: 'item'; stage: string;
  block: string | null; elevation: string | null; floor: string | null; flat: string | null;
  item_code: string; item_type: ItemKind | null; full_code: string; created_via: 'mapping';
  created_by?: string; scanned_by?: string;
}

export interface MappingRecordOpts {
  client_code: string; job_code: string; tenant_id?: string; job_id?: string;
  createdBy?: string | null; stage?: string;
}

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
      kind: 'item', stage, block, elevation, floor: floor || null, flat: flat || null,
      item_code: item, item_type: r.item_type ?? null, full_code, created_via: 'mapping',
    };
    if (opts.tenant_id) rec.tenant_id = opts.tenant_id;
    if (opts.job_id) rec.job_id = opts.job_id;
    if (opts.createdBy) { rec.created_by = opts.createdBy; rec.scanned_by = opts.createdBy; }
    out.push(rec);
  }
  return out;
}
