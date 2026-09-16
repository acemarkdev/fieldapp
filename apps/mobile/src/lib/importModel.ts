// Excel-import model — a self-contained mirror of packages/shared/src/import.ts plus the office
// page's inline header aliases / room map / AOA parser. (The mobile app deliberately doesn't
// import @ace/shared, so keep this in step with it and with office.ts's import code.)
//
// Flow: an .xlsx is read into an array-of-arrays (AOA) by SheetJS in the screen, then
// parseImportAoa() turns it into item rows; importItemRecords() turns reviewed rows into
// survey_items records (Unfinished flag derived here, exactly like the office commit).
import { ROOMS } from './rooms';
import { buildItemCode, levelSeg } from './mappingModel';

export interface ImportRow { [k: string]: any }

export const IMPORT_FIELDS = [
  'block', 'elevation', 'flat', 'floor', 'room', 'item',
  'material', 'item_type', 'window_type', 'glass', 'safety_glass', 'glazing', 'glazing_bars',
  'width_mm', 'height_mm', 'cill_depth',
  'transom1_mm', 'transom2_mm', 'transom3_mm', 'mullion1_mm', 'mullion2_mm', 'mullion3_mm',
  'open_in_out', 'add_ons', 'coupled', 'design_code', 'comments',
] as const;

export const REQUIRED_FIELDS = [
  'block', 'elevation', 'item', 'room',
  'material', 'item_type', 'glass', 'glazing',
  'width_mm', 'height_mm', 'open_in_out', 'design_code',
] as const;

export const FIELD_LABELS: Record<string, string> = {
  block: 'Block', elevation: 'Elevation', flat: 'Flat', floor: 'Floor', 'flat/floor': 'Flat or Floor',
  room: 'Room', item: 'Item', material: 'Material', item_type: 'Item type',
  glass: 'Glass', glazing: 'Glazing', width_mm: 'Width', height_mm: 'Height', open_in_out: 'Open in/out',
  design_code: 'Style (design code)',
};

// Grid columns, in order (label + whether required). Mirrors the office IMP_COLS.
export const IMP_COLS: { k: string; l: string; req?: boolean }[] = [
  { k: 'block', l: 'Block', req: true }, { k: 'elevation', l: 'Elev', req: true },
  { k: 'flat', l: 'Flat' }, { k: 'floor', l: 'Floor' },
  { k: 'room', l: 'Room', req: true }, { k: 'item', l: 'Item', req: true },
  { k: 'material', l: 'Material', req: true }, { k: 'item_type', l: 'Item type', req: true },
  { k: 'window_type', l: 'Window type' }, { k: 'glass', l: 'Glass', req: true },
  { k: 'safety_glass', l: 'Safety' }, { k: 'glazing', l: 'Glazing', req: true }, { k: 'glazing_bars', l: 'Glazing bars' },
  { k: 'width_mm', l: 'Width', req: true }, { k: 'height_mm', l: 'Height', req: true }, { k: 'cill_depth', l: 'Cill' },
  { k: 'open_in_out', l: 'Open', req: true }, { k: 'add_ons', l: 'Add-ons' }, { k: 'coupled', l: 'Coupled' },
  { k: 'design_code', l: 'Design', req: true }, { k: 'comments', l: 'Comments' },
];

// Excel header (normalised: lowercased, non-alphanumerics stripped) → canonical key. '' = ignore.
export const IMP_HDR: Record<string, string> = {
  areacouncil: '', area: '', council: '', site: '', designsketch: '', sketch: '',
  block: 'block', elevation: 'elevation', elev: 'elevation', item: 'item', floor: 'floor',
  flatplotno: 'flat', flatplot: 'flat', flat: 'flat', flatno: 'flat', plotno: 'flat', plot: 'flat',
  material: 'material', itemtype: 'item_type', type: 'item_type',
  glass: 'glass', safetyglass: 'safety_glass', safety: 'safety_glass',
  glazing: 'glazing', glazingbars: 'glazing_bars',
  width: 'width_mm', heightinccill: 'height_mm', height: 'height_mm',
  addonrequiredincassizeshown: 'add_ons', addonrequired: 'add_ons', addons: 'add_ons', addon: 'add_ons',
  cilldepth: 'cill_depth', cill: 'cill_depth', coupled: 'coupled', designcode: 'design_code',
  transom1fromtop: 'transom1_mm', transom1: 'transom1_mm', transom2fromtop: 'transom2_mm', transom2: 'transom2_mm',
  transom3fromtop: 'transom3_mm', transom3: 'transom3_mm',
  mullion1fromleft: 'mullion1_mm', mullion1: 'mullion1_mm', mullion2fromleft: 'mullion2_mm', mullion2: 'mullion2_mm',
  mullion3fromleft: 'mullion3_mm', mullion3: 'mullion3_mm',
  openinopenout: 'open_in_out', openinout: 'open_in_out', open: 'open_in_out',
  room: 'room', comments: 'comments',
};

const s = (v: any): string => (v == null ? '' : String(v).trim());

export function missingRequired(row: ImportRow): string[] {
  const miss: string[] = [];
  for (const f of REQUIRED_FIELDS) { if (!s(row[f])) miss.push(f); }
  if (!s(row.flat) && !s(row.floor)) miss.push('flat/floor');
  return miss;
}
export function isRowComplete(row: ImportRow): boolean { return missingRequired(row).length === 0; }

export function toMm(v: any): number | null {
  const t = s(v).replace(/mm/i, '').replace(/[, ]/g, '');
  if (!t) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) ? n : null;
}

export function normHdr(h: any): string { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

let ROOM2CODE: Record<string, string> | null = null;
function roomMap(): Record<string, string> {
  if (ROOM2CODE) return ROOM2CODE;
  ROOM2CODE = {};
  for (const r of ROOMS) {
    ROOM2CODE[r.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = r.code;
    ROOM2CODE[r.code.toLowerCase()] = r.code;
  }
  return ROOM2CODE;
}
export function roomToCode(v: any): string {
  if (v == null || v === '') return '';
  const t = String(v).replace(/ /g, ' ').trim();
  const n = t.toLowerCase().replace(/[^a-z0-9]/g, '');
  return roomMap()[n] || t.toUpperCase();
}
export function normSafety(v: any): string {
  if (v === false || v == null) return '';
  if (v === true) return 'Yes';
  const t = String(v).trim();
  if (!t || /^n\/?a$/i.test(t)) return '';
  if (/^y/i.test(t)) return 'Yes';
  return t;
}

export interface ParseResult { rows: ImportRow[]; mismatch: number; error?: string }

/** Turn a SheetJS array-of-arrays into item rows (mirrors the office parseImpAoa). */
export function parseImportAoa(aoa: any[][], job: { jobClient: string; jobCode: string }): ParseResult {
  let hi = -1;
  for (let i = 0; i < aoa.length && i < 15; i++) {
    const norm = (aoa[i] || []).map(normHdr);
    if (norm.indexOf('block') >= 0 && norm.indexOf('item') >= 0) { hi = i; break; }
  }
  if (hi < 0) return { rows: [], mismatch: 0, error: 'Could not find the header row — need the Main tab with Block & Item columns.' };
  const hdr = (aoa[hi] || []).map(normHdr);
  const colKey = hdr.map((nh: string) => IMP_HDR[nh] ?? null);
  let clientCol = -1, siteCol = -1;
  for (let c = 0; c < hdr.length; c++) {
    if (hdr[c] === 'areacouncil' || hdr[c] === 'area' || hdr[c] === 'council') clientCol = c;
    if (hdr[c] === 'site') siteCol = c;
  }
  let start = hi + 1;
  const exRow = aoa[start] || [];
  const looksExample = exRow.some((cv: any) => cv != null && /e\.g\.|yes \/ n\/a|count from/i.test(String(cv)));
  if (looksExample) start++;
  const jobClient = (job.jobClient || '').toUpperCase();
  const jobCode = (job.jobCode || '').toUpperCase();
  const rows: ImportRow[] = [];
  let mismatch = 0;
  for (let r = start; r < aoa.length; r++) {
    const arr = aoa[r] || [];
    const obj: ImportRow = {};
    for (let c = 0; c < arr.length; c++) {
      const key = colKey[c];
      if (!key) continue;
      let val = arr[c];
      if (val == null) continue;
      if (key === 'room') val = roomToCode(val);
      else if (key === 'safety_glass') val = normSafety(val);
      else val = String(val).replace(/ /g, ' ').trim();
      if (obj[key] == null || obj[key] === '') obj[key] = val;
    }
    if (!s(obj.item)) continue;
    if (clientCol >= 0 && arr[clientCol] != null && String(arr[clientCol]).trim().toUpperCase() !== jobClient) mismatch++;
    else if (siteCol >= 0 && arr[siteCol] != null && String(arr[siteCol]).trim().toUpperCase() !== jobCode) mismatch++;
    rows.push(obj);
  }
  return { rows, mismatch };
}

export interface ImportRecordOpts {
  client_code: string; job_code: string; tenant_id?: string; job_id?: string; createdBy?: string | null;
}
export interface ImportItemRecord { [k: string]: any; full_code: string; incomplete: boolean; }

/** Build deduped survey_items records from reviewed rows (mirrors the office import commit). */
export function importItemRecords(rows: ImportRow[], opts: ImportRecordOpts): ImportItemRecord[] {
  const up = (v: any) => String(v ?? '').trim().toUpperCase();
  const str = (v: any) => { const t = String(v ?? '').trim(); return t || null; };
  const seen = new Set<string>();
  const out: ImportItemRecord[] = [];
  for (const r of rows) {
    const item = up(r.item);
    if (!item) continue;
    const floor = levelSeg(String(r.floor ?? '').trim());
    const flat = String(r.flat ?? '').trim().replace(/^F(?=[0-9])/i, '');
    const room = up(r.room);
    const block = up(r.block) || null;
    const elevation = up(r.elevation) || null;
    const full_code = buildItemCode({ client: opts.client_code, job: opts.job_code, block, elevation, flat, floor, room, item });
    if (seen.has(full_code)) continue;
    seen.add(full_code);
    const rec: ImportItemRecord = {
      stage: 'scanned', incomplete: !isRowComplete(r), from_import: true, created_via: 'import',
      block, elevation, floor: floor || null, flat: flat || null, room_code: room || null, item_code: item,
      material: str(r.material), item_type: str(r.item_type), window_type: str(r.window_type),
      glass: str(r.glass), safety_glass: str(r.safety_glass), glazing: str(r.glazing), glazing_bars: str(r.glazing_bars),
      width_mm: toMm(r.width_mm), height_mm: toMm(r.height_mm), cill_depth: str(r.cill_depth),
      transom1_mm: toMm(r.transom1_mm), transom2_mm: toMm(r.transom2_mm), transom3_mm: toMm(r.transom3_mm),
      mullion1_mm: toMm(r.mullion1_mm), mullion2_mm: toMm(r.mullion2_mm), mullion3_mm: toMm(r.mullion3_mm),
      open_in_out: str(r.open_in_out), add_ons: str(r.add_ons), coupled: str(r.coupled),
      design_code: str(r.design_code), comments: str(r.comments), full_code,
    };
    if (opts.tenant_id) rec.tenant_id = opts.tenant_id;
    if (opts.job_id) rec.job_id = opts.job_id;
    if (opts.createdBy) rec.created_by = opts.createdBy;
    out.push(rec);
  }
  return out;
}
