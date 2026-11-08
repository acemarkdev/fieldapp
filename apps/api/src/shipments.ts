// Logistics ▸ Shipments — replaces the monday board "DostawyUK/Deliveries from PL" and its Eledo documents.
// A shipment (to the UK) carries invoices and lines (qty, unit, description, net / gross kg, comment = Z / order
// number, photos). The office builds the packing list — Polish / English, with or without the line photos —
// and keeps the shipment's papers: invoices, the CMR scan, the signed packing list and CC599 (the export
// confirmation the accountant needs for 0% VAT). A shipment marked sent without its CC599 waits for documents.
import PDFDocument from 'pdfkit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './supabase';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const one = (v: unknown) => String(v ?? '').replace(/[ \t]+/g, ' ').trim();
/** Multi-line text (addresses): each line trimmed, empty lines dropped. */
const lines = (v: unknown, max = 600) => String(v ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const BUCKET = 'shipments';
const FONTS = join(dirname(fileURLToPath(import.meta.url)), '../assets/labels');

export const COMPANIES = {
  acemark: { label: 'Acemark', seller: 'Acemark sp. z o.o.\nOrpiszew, ul. Koźmińska 32\n63-714 Kobierno\nNIP: PL6211842704', ship_from: 'Polska, 63-714 Orpiszew, Ul. Koźmińska 32' },
  wem: { label: 'WEM', seller: 'WEM Sp. z o.o.\nul. Koźmińska 10, 63-440 Raszków\nNIP: PL6222839864\nEmail: biuro@wemokna.pl', ship_from: 'Polska, 63-714 Orpiszew, Ul. Koźmińska 32' },
} as const;
export type Company = keyof typeof COMPANIES;
export const STATUSES = ['new', 'in_progress', 'sent', 'sent_no_docs'] as const;
export type ShipStatus = (typeof STATUSES)[number];
export const FILE_KINDS = ['photo', 'invoice', 'cmr', 'packing_signed', 'cc599', 'packing_list', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const UNITS = ['Szt.', 'kpl.', 'm2', 'mb', 'm', 'L', 'Sztanga', 'paleta'];

export interface Shipment {
  id: string; company: Company; name: string; status: ShipStatus; ship_date: string | null; deliver_by: string | null;
  invoices: string | null; importer: string | null; customer_id: string | null; delivery_address: string | null;
  carrier: string | null; carrier_id: string | null; driver: string | null; plates: string | null;
  seller: string | null; ship_from: string | null; notes: string | null; monday_item_id: string | null;
  created_by_name: string | null; created_at: string; updated_at: string; sent_at: string | null;
}
export interface ShipLine { id: string; shipment_id: string; pos: number; qty: number | null; unit: string | null; description: string; net_kg: number | null; gross_kg: number | null; comment: string | null; loaded: boolean }
export interface ShipFile { id: string; shipment_id: string; line_id: string | null; kind: FileKind; storage_path: string; file_name: string | null; content_type: string | null; size: number | null; created_by_name: string | null; created_at: string }

// ---- dates and numbers ------------------------------------------------------------------------
/** dd.mm.yyyy, dd-mm-yy, yyyy-mm-dd → yyyy-mm-dd; '' → null; anything else → undefined (refused). */
export function shipDay(v: unknown): string | null | undefined {
  const s = one(v); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s); if (!m) return undefined; d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export const plDate = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
/** Kilograms and quantities as typed: "17,5", "1 200.5" → number; '' → null; negative or not a number → undefined. */
export function num(v: unknown): number | null | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? round2(v) : undefined;
  const s = String(v ?? '').replace(/[\s ]|kg/gi, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s); return Number.isFinite(n) && n >= 0 ? round2(n) : undefined;
}
/** The suggested name: "UK <customer short> dd.mm.yyyy", e.g. "UK PCW 06.11.2026". */
export function suggestName(short: string, day: string | null): string {
  return ['UK', one(short).toUpperCase().slice(0, 20), plDate(day)].filter(Boolean).join(' ');
}
/** The invoice line printed on the packing list: "FL 7/ACE/11/2026 z dnia 06.11.2026". */
export function invoiceText(no: string, day: string | null): string {
  return one(no) + (day ? ` z dnia ${plDate(day)}` : '');
}
export function totals(ls: { qty?: number | null; net_kg: number | null; gross_kg: number | null }[]) {
  return { net: round2(ls.reduce((s, l) => s + (Number(l.net_kg) || 0), 0)), gross: round2(ls.reduce((s, l) => s + (Number(l.gross_kg) || 0), 0)), lines: ls.length };
}
/** Papers still missing on a shipment: once it has left, the CC599 export confirmation and the CMR. */
export function missingDocs(s: { status: string }, kinds: string[]): string[] {
  if (s.status !== 'sent' && s.status !== 'sent_no_docs') return [];
  return [['cc599', 'CC599'], ['cmr', 'CMR']].filter(([k]) => !kinds.includes(k)).map(([, l]) => l);
}

// ---- form → fields ----------------------------------------------------------------------------
export function shipmentFields(b: any): Result<{ fields: Record<string, any> }> {
  const company: Company = b?.company === 'wem' ? 'wem' : 'acemark';
  const name = one(b?.name).slice(0, 120);
  if (!name) return fail(400, 'Enter the shipment name, e.g. “UK PCW 06.11.2026”.');
  const ship_date = shipDay(b?.ship_date), deliver_by = shipDay(b?.deliver_by);
  if (ship_date === undefined) return fail(400, 'The shipment date is not a date (dd.mm.yyyy).');
  if (deliver_by === undefined) return fail(400, 'The delivery date is not a date (dd.mm.yyyy).');
  const status: ShipStatus = (STATUSES as readonly string[]).includes(b?.status) ? b.status : 'new';
  const uuid = (v: unknown) => (/^[0-9a-f-]{36}$/i.test(one(v)) ? one(v) : null);
  return { ok: true, fields: {
    company, name, status, ship_date, deliver_by,
    invoices: lines(b?.invoices, 1000) || null, importer: lines(b?.importer) || null, customer_id: uuid(b?.customer_id),
    delivery_address: lines(b?.delivery_address) || null, carrier: lines(b?.carrier) || null, carrier_id: uuid(b?.carrier_id),
    driver: one(b?.driver).slice(0, 160) || null, plates: one(b?.plates).slice(0, 80) || null,
    seller: lines(b?.seller) || COMPANIES[company].seller, ship_from: lines(b?.ship_from, 300) || COMPANIES[company].ship_from,
    notes: lines(b?.notes, 1000) || null,
  } };
}
export function lineFields(b: any, pos: number): Result<{ fields: Record<string, any> }> {
  const description = lines(b?.description, 400).replace(/\n/g, ' ');
  const qty = num(b?.qty), net = num(b?.net_kg), gross = num(b?.gross_kg);
  if (!description && qty == null && net == null && gross == null) return fail(400, 'empty');
  if (!description) return fail(400, `Line ${pos + 1}: enter the description.`);
  if (qty === undefined) return fail(400, `Line ${pos + 1}: the quantity is not a number.`);
  if (net === undefined || gross === undefined) return fail(400, `Line ${pos + 1}: the weight is not a number (kg).`);
  if (net != null && gross != null && gross < net) return fail(400, `Line ${pos + 1}: the gross weight is lower than the net weight.`);
  return { ok: true, fields: { pos, description, qty: qty ?? 1, unit: one(b?.unit).slice(0, 20) || 'Szt.', net_kg: net, gross_kg: gross, comment: one(b?.comment).slice(0, 300) || null, loaded: b?.loaded === true } };
}

/** A production list read for labels (Archimede / CortizoCad) → shipment lines. */
export function linesFromSpec(spec: { order?: string; job?: string; client?: string; positions: { poz: number; qty: number; config: string; w: number | null; h: number | null; note?: string; refs?: string[] }[] }) {
  const comment = [spec.job, spec.order].map(one).filter(Boolean).join(' - ');
  return spec.positions.map((p) => ({
    qty: p.qty || 1, unit: 'Szt.', net_kg: null, gross_kg: null, comment: comment || null,
    description: (one(p.config) || 'Pozycja ' + p.poz) + (p.w && p.h ? ` (W${p.w} mm x H${p.h} mm)` : '') + ((p.refs ?? []).length ? ` ${(p.refs ?? []).join(', ')}` : ''),
  }));
}

// ---- database -------------------------------------------------------------------------------------
const SHIP_COLS = 'id,company,name,status,ship_date,deliver_by,invoices,importer,customer_id,delivery_address,carrier,carrier_id,driver,plates,seller,ship_from,notes,monday_item_id,created_by_name,created_at,updated_at,sent_at';
const LINE_COLS = 'id,shipment_id,pos,qty,unit,description,net_kg,gross_kg,comment,loaded';
const FILE_COLS = 'id,shipment_id,line_id,kind,storage_path,file_name,content_type,size,created_by_name,created_at';

let readyAt = 0, readyOk = false;
export async function shipmentsReady(): Promise<boolean> {
  if (Date.now() - readyAt < 60_000) return readyOk;
  const { error } = await db().from('shipments').select('id').limit(1);
  readyOk = !error; readyAt = Date.now(); return readyOk;
}

async function pageAll<T>(table: string, cols: string, tenantId: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from(table).select(cols).eq('tenant_id', tenantId).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q; if (error) throw error;
    out.push(...((data ?? []) as T[])); if (!data || data.length < 1000) return out;
  }
}

export async function listShipments(tenantId: string) {
  const [ships, ls, fs] = await Promise.all([
    pageAll<Shipment>('shipments', SHIP_COLS, tenantId),
    pageAll<ShipLine>('shipment_lines', 'shipment_id,net_kg,gross_kg,qty', tenantId),
    pageAll<ShipFile>('shipment_files', 'shipment_id,kind,line_id', tenantId),
  ]);
  const byShip = new Map<string, ShipLine[]>(); for (const l of ls) (byShip.get(l.shipment_id) ?? byShip.set(l.shipment_id, []).get(l.shipment_id)!).push(l);
  const kinds = new Map<string, string[]>(); const photos = new Map<string, number>();
  for (const f of fs) { (kinds.get(f.shipment_id) ?? kinds.set(f.shipment_id, []).get(f.shipment_id)!).push(f.kind); if (f.kind === 'photo') photos.set(f.shipment_id, (photos.get(f.shipment_id) ?? 0) + 1); }
  return ships.map((s) => {
    const k = kinds.get(s.id) ?? [];
    return { ...s, totals: totals(byShip.get(s.id) ?? []), photos: photos.get(s.id) ?? 0, docs: [...new Set(k.filter((x) => x !== 'photo'))], missing: missingDocs(s, k) };
  }).sort((a, b) => String(b.ship_date ?? '9999').localeCompare(String(a.ship_date ?? '9999')) || String(b.created_at).localeCompare(String(a.created_at)));
}

export async function getShipment(tenantId: string, id: string) {
  const { data, error } = await db().from('shipments').select(SHIP_COLS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; if (!data) return null;
  const [ls, fs] = await Promise.all([
    db().from('shipment_lines').select(LINE_COLS).eq('tenant_id', tenantId).eq('shipment_id', id).order('pos'),
    db().from('shipment_files').select(FILE_COLS).eq('tenant_id', tenantId).eq('shipment_id', id).order('created_at'),
  ]);
  if (ls.error) throw ls.error; if (fs.error) throw fs.error;
  const files = (fs.data ?? []) as ShipFile[];
  return { shipment: data as Shipment, lines: (ls.data ?? []) as ShipLine[], files, totals: totals((ls.data ?? []) as ShipLine[]), missing: missingDocs(data as Shipment, files.map((f) => f.kind)) };
}

export async function createShipment(tenantId: string, by: { id: string | null; name: string | null }, b: any): Promise<Result<{ id: string }>> {
  const f = shipmentFields(b); if (!f.ok) return f;
  const fields = f.fields;
  if (fields.status === 'sent' || fields.status === 'sent_no_docs') fields.sent_at = new Date().toISOString();
  const { data, error } = await db().from('shipments').insert({ tenant_id: tenantId, created_by: by.id, created_by_name: by.name, ...fields }).select('id').single();
  if (error) throw error;
  await rememberCarrier(tenantId, fields);
  // "copy from": the lines of an earlier shipment (without photos or weights ticked as loaded)
  if (/^[0-9a-f-]{36}$/i.test(String(b?.copy_lines_from ?? ''))) {
    const src = await db().from('shipment_lines').select(LINE_COLS).eq('tenant_id', tenantId).eq('shipment_id', b.copy_lines_from).order('pos');
    if (!src.error && src.data?.length) await db().from('shipment_lines').insert(src.data.map((l: any, i: number) => ({ tenant_id: tenantId, shipment_id: data.id, pos: i, qty: l.qty, unit: l.unit, description: l.description, net_kg: l.net_kg, gross_kg: l.gross_kg, comment: l.comment })));
  }
  return { ok: true, id: data.id };
}

export async function updateShipment(tenantId: string, id: string, b: any): Promise<Result> {
  const cur = await db().from('shipments').select('id,status,sent_at').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (cur.error) throw cur.error; if (!cur.data) return fail(404, 'Shipment not found.');
  const f = shipmentFields(b); if (!f.ok) return f;
  const fields: Record<string, any> = { ...f.fields, updated_at: new Date().toISOString() };
  const sent = fields.status === 'sent' || fields.status === 'sent_no_docs';
  if (sent && !cur.data.sent_at) fields.sent_at = new Date().toISOString();
  if (!sent) fields.sent_at = null;
  const { error } = await db().from('shipments').update(fields).eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
  await rememberCarrier(tenantId, fields);
  return { ok: true };
}

export async function deleteShipment(tenantId: string, id: string): Promise<Result> {
  const fs = await db().from('shipment_files').select('storage_path').eq('tenant_id', tenantId).eq('shipment_id', id);
  const { data, error } = await db().from('shipments').delete().eq('tenant_id', tenantId).eq('id', id).select('id');
  if (error) throw error; if (!data?.length) return fail(404, 'Shipment not found.');
  const paths = (fs.data ?? []).map((r: any) => r.storage_path).filter(Boolean);
  if (paths.length) await db().storage.from(BUCKET).remove(paths);
  return { ok: true };
}

/** Save the shipment's lines as the form has them: rows with an id are updated, new rows inserted, rows left
 *  out removed (with their photos). Lines are kept in the order sent. */
export async function saveLines(tenantId: string, shipmentId: string, rows: any[]): Promise<Result<{ saved: number }>> {
  if (!Array.isArray(rows)) return fail(400, 'No lines.');
  if (rows.length > 500) return fail(400, 'Too many lines (max 500).');
  const sh = await db().from('shipments').select('id').eq('tenant_id', tenantId).eq('id', shipmentId).maybeSingle();
  if (sh.error) throw sh.error; if (!sh.data) return fail(404, 'Shipment not found.');
  const cur = await db().from('shipment_lines').select('id').eq('tenant_id', tenantId).eq('shipment_id', shipmentId);
  if (cur.error) throw cur.error;
  const curIds = new Set((cur.data ?? []).map((r: any) => r.id));
  const keep = new Set<string>(); const ins: any[] = []; const upd: { id: string; fields: any }[] = [];
  let pos = 0;
  for (const r of rows) {
    const f = lineFields(r, pos);
    if (!f.ok) { if (f.error === 'empty') continue; return f; }
    const id = String(r?.id ?? '');
    if (curIds.has(id)) { keep.add(id); upd.push({ id, fields: { ...f.fields, updated_at: new Date().toISOString() } }); }
    else ins.push({ tenant_id: tenantId, shipment_id: shipmentId, ...f.fields });
    pos++;
  }
  const gone = [...curIds].filter((id) => !keep.has(id));
  if (gone.length) {
    const ph = await db().from('shipment_files').select('storage_path').eq('tenant_id', tenantId).in('line_id', gone);
    const paths = (ph.data ?? []).map((r: any) => r.storage_path).filter(Boolean);
    const del = await db().from('shipment_lines').delete().eq('tenant_id', tenantId).in('id', gone); if (del.error) throw del.error;
    if (paths.length) await db().storage.from(BUCKET).remove(paths);
  }
  for (const u of upd) { const { error } = await db().from('shipment_lines').update(u.fields).eq('tenant_id', tenantId).eq('id', u.id); if (error) throw error; }
  if (ins.length) { const { error } = await db().from('shipment_lines').insert(ins); if (error) throw error; }
  await db().from('shipments').update({ updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', shipmentId);
  return { ok: true, saved: pos };
}

/** The phone while loading: tick a line as loaded, or put in its weights / quantity — the rest of the line stays. */
export async function patchLine(tenantId: string, shipmentId: string, lineId: string, b: any): Promise<Result> {
  const cur = await db().from('shipment_lines').select('id,net_kg,gross_kg').eq('tenant_id', tenantId).eq('shipment_id', shipmentId).eq('id', lineId).maybeSingle();
  if (cur.error) throw cur.error; if (!cur.data) return fail(404, 'Line not found.');
  const f: Record<string, any> = { updated_at: new Date().toISOString() };
  if ('loaded' in (b ?? {})) f.loaded = b.loaded === true;
  for (const k of ['net_kg', 'gross_kg', 'qty'] as const) if (k in (b ?? {})) { const n = num(b[k]); if (n === undefined) return fail(400, 'The weight is not a number (kg).'); f[k] = n; }
  const net = 'net_kg' in f ? f.net_kg : cur.data.net_kg, gross = 'gross_kg' in f ? f.gross_kg : cur.data.gross_kg;
  if (net != null && gross != null && Number(gross) < Number(net)) return fail(400, 'The gross weight is lower than the net weight.');
  const { error } = await db().from('shipment_lines').update(f).eq('tenant_id', tenantId).eq('id', lineId);
  if (error) throw error;
  await db().from('shipments').update({ updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', shipmentId);
  return { ok: true };
}
/** Only the status (the phone: "W trakcie" when loading starts, "Wysłane" when the truck leaves). */
export async function setShipmentStatus(tenantId: string, shipmentId: string, status: unknown): Promise<Result> {
  if (!(STATUSES as readonly string[]).includes(String(status))) return fail(400, 'Unknown status.');
  const cur = await db().from('shipments').select('id,sent_at').eq('tenant_id', tenantId).eq('id', shipmentId).maybeSingle();
  if (cur.error) throw cur.error; if (!cur.data) return fail(404, 'Shipment not found.');
  const sent = status === 'sent' || status === 'sent_no_docs';
  const { error } = await db().from('shipments').update({ status, sent_at: sent ? (cur.data.sent_at ?? new Date().toISOString()) : null, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', shipmentId);
  if (error) throw error;
  return { ok: true };
}

async function rememberCarrier(tenantId: string, f: Record<string, any>) {
  const name = lines(f.carrier); if (!name) return;
  try { await db().from('shipment_carriers').upsert({ tenant_id: tenantId, name, driver: f.driver ?? null, plates: f.plates ?? null, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,name' }); } catch { /* the list is only a help */ }
}

// ---- files ---------------------------------------------------------------------------------------
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', heic: 'image/heic', webp: 'image/webp' };
export async function addFile(tenantId: string, shipmentId: string, by: string | null, b: any): Promise<Result<{ id: string }>> {
  const kind: FileKind = (FILE_KINDS as readonly string[]).includes(b?.kind) ? b.kind : 'other';
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(b?.data ?? ''));
  if (!m) return fail(400, 'No file received.');
  const bytes = Buffer.from(m[3], m[2] ? 'base64' : 'utf8');
  if (!bytes.length) return fail(400, 'The file is empty.');
  if (bytes.length > 20 * 1024 * 1024) return fail(400, 'The file is too large (max 20 MB).');
  const name = one(b?.name).replace(/[\\/]/g, '_').slice(0, 160) || (kind === 'photo' ? 'photo.jpg' : 'file.pdf');
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const type = (m[1] && m[1] !== 'application/octet-stream' ? m[1] : MIME[ext]) ?? 'application/octet-stream';
  if (kind === 'photo' && !/^image\//.test(type)) return fail(400, 'A photo must be an image (JPG or PNG).');
  const sh = await db().from('shipments').select('id').eq('tenant_id', tenantId).eq('id', shipmentId).maybeSingle();
  if (sh.error) throw sh.error; if (!sh.data) return fail(404, 'Shipment not found.');
  let lineId: string | null = null;
  if (b?.line_id) {
    const l = await db().from('shipment_lines').select('id').eq('tenant_id', tenantId).eq('shipment_id', shipmentId).eq('id', String(b.line_id)).maybeSingle();
    if (l.error) throw l.error; if (!l.data) return fail(404, 'Line not found — save the lines first.');
    lineId = l.data.id;
  }
  const path = `${tenantId}/${shipmentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name.replace(/[^\w.\-]+/g, '_')}`;
  const up = await db().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await db().from('shipment_files').insert({ tenant_id: tenantId, shipment_id: shipmentId, line_id: lineId, kind, storage_path: path, file_name: name, content_type: type, size: bytes.length, created_by_name: by }).select('id').single();
  if (error) { await db().storage.from(BUCKET).remove([path]); throw error; }
  return { ok: true, id: data.id };
}
export async function getFile(tenantId: string, shipmentId: string, fileId: string): Promise<{ row: ShipFile; bytes: Buffer } | null> {
  const { data, error } = await db().from('shipment_files').select(FILE_COLS).eq('tenant_id', tenantId).eq('shipment_id', shipmentId).eq('id', fileId).maybeSingle();
  if (error) throw error; if (!data) return null;
  const dl = await db().storage.from(BUCKET).download((data as ShipFile).storage_path);
  if (dl.error || !dl.data) return null;
  return { row: data as ShipFile, bytes: Buffer.from(await dl.data.arrayBuffer()) };
}
export async function deleteFile(tenantId: string, shipmentId: string, fileId: string): Promise<Result> {
  const { data, error } = await db().from('shipment_files').delete().eq('tenant_id', tenantId).eq('shipment_id', shipmentId).eq('id', fileId).select('storage_path');
  if (error) throw error; if (!data?.length) return fail(404, 'File not found.');
  await db().storage.from(BUCKET).remove(data.map((r: any) => r.storage_path));
  return { ok: true };
}

// ---- lookups for the form ------------------------------------------------------------------------
export async function shipmentLookups(tenantId: string) {
  const [carriers, ships, sales] = await Promise.all([
    db().from('shipment_carriers').select('id,name,driver,plates,updated_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(200),
    db().from('shipments').select('company,importer,delivery_address,updated_at').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(400),
    db().from('fin_sales').select('invoice_no,invoice_date,buyer,net,seller,source').eq('tenant_id', tenantId).gte('invoice_date', new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10)).order('invoice_date', { ascending: false }).limit(800),
  ]);
  const importers: { text: string; delivery: string | null }[] = []; const seen = new Set<string>();
  for (const s of (ships.data ?? []) as any[]) { const t = lines(s.importer); if (t && !seen.has(t)) { seen.add(t); importers.push({ text: t, delivery: s.delivery_address ?? null }); } }
  return {
    carriers: carriers.data ?? [], importers,
    invoices: ((sales.data ?? []) as any[]).filter((r) => r.invoice_no && (!r.seller || /^acemark/i.test(r.seller))).map((r) => ({ no: r.invoice_no, date: r.invoice_date, buyer: r.buyer, net: r.net, text: invoiceText(r.invoice_no, r.invoice_date) })),
    companies: COMPANIES, units: UNITS,
  };
}

// ---- the packing list PDF ---------------------------------------------------------------------------
export interface PackingInput { shipment: Shipment; lines: ShipLine[]; photos?: Map<string, Buffer>; withPhotos: boolean; createdAt?: Date }
const isImage = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);

/** Lista pakowa / Packing List — A4, Polish / English, the same boxes as the paper form Eledo printed. */
export function buildPackingListPdf(inp: PackingInput): Promise<Buffer> {
  const s = inp.shipment, L = inp.lines, withPhotos = inp.withPhotos && !!inp.photos;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 40, left: 36, right: 36 }, bufferPages: true, info: { Title: `Lista pakowa / Packing List — ${s.name}` } });
    const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('R', join(FONTS, 'LiberationSans-Regular.ttf')); doc.registerFont('B', join(FONTS, 'LiberationSans-Bold.ttf'));
    const X0 = 36, W = doc.page.width - 72, BOTTOM = doc.page.height - 48;
    const ink = '#111', mute = '#555', line = '#888';
    let y = 36;
    // a labelled box: the label (PL / EN) small on top, the value below
    const box = (x: number, yy: number, w: number, h: number, label: string, value: string, opt: { bold?: boolean; size?: number } = {}) => {
      doc.lineWidth(0.6).strokeColor(line).rect(x, yy, w, h).stroke();
      doc.font('R').fontSize(7).fillColor(mute).text(label, x + 4, yy + 3, { width: w - 8, lineBreak: false });
      doc.font(opt.bold ? 'B' : 'R').fontSize(opt.size ?? 9).fillColor(ink).text(value || '', x + 4, yy + 13, { width: w - 8, height: h - 15, ellipsis: true });
    };
    const boxH = (w: number, value: string, min: number, size = 9) => Math.max(min, doc.font('R').fontSize(size).heightOfString(value || ' ', { width: w - 8 }) + 18);
    // ---- title
    doc.font('B').fontSize(16).fillColor(ink).text('Lista pakowa / Packing List', X0, y, { width: W, align: 'center' });
    y += 22;
    doc.font('R').fontSize(9).fillColor(mute).text(`${s.name}${s.ship_date ? '  ·  ' + plDate(s.ship_date) : ''}`, X0, y, { width: W, align: 'center' });
    y += 18;
    // ---- the header boxes, two columns
    const cw = W / 2;
    const pairs: [string, string, string, string][] = [
      ['Faktura / Data — Invoice / Date', s.invoices ?? '', 'Sprzedawca / Seller', s.seller ?? ''],
      ['Importer i jego adres / Importer and address', s.importer ?? '', 'Przewoźnik / Carrier', s.carrier ?? ''],
      ['Miejsce nadania / Place of loading', s.ship_from ?? '', 'Imię i nazwisko kierowcy / Driver’s full name', s.driver ?? ''],
      ['Miejsce przeznaczenia / Place of delivery', s.delivery_address ?? '', 'Numer pojazdu / Vehicle registration', s.plates ?? ''],
    ];
    for (const [l1, v1, l2, v2] of pairs) {
      const h = Math.max(boxH(cw, v1, 34), boxH(cw, v2, 34));
      box(X0, y, cw, h, l1, v1); box(X0 + cw, y, cw, h, l2, v2); y += h;
    }
    y += 14;
    // ---- the lines
    const PH = withPhotos ? 92 : 0;
    const cols = [
      { k: 'no', t: 'Lp.\nNo.', w: 24, a: 'right' as const },
      { k: 'qty', t: 'Ilość\nQty', w: 34, a: 'right' as const },
      { k: 'unit', t: 'Jm\nUnit', w: 34, a: 'left' as const },
      { k: 'desc', t: 'Opis\nDescription', w: 0, a: 'left' as const },
      { k: 'net', t: 'Netto kg\nNet kg', w: 46, a: 'right' as const },
      { k: 'gross', t: 'Brutto kg\nGross kg', w: 50, a: 'right' as const },
      { k: 'comment', t: 'Komentarz\nComment', w: withPhotos ? 104 : 140, a: 'left' as const },
      ...(withPhotos ? [{ k: 'photo', t: 'Zdjęcie\nPhoto', w: PH, a: 'left' as const }] : []),
    ];
    cols[3].w = W - cols.reduce((sum, c) => sum + c.w, 0);
    const head = () => {
      let x = X0; const h = 24;
      doc.rect(X0, y, W, h).fillColor('#eeeeee').fill();
      for (const c of cols) { doc.lineWidth(0.6).strokeColor(line).rect(x, y, c.w, h).stroke(); doc.font('B').fontSize(7.5).fillColor(ink).text(c.t, x + 3, y + 3, { width: c.w - 6, align: c.a }); x += c.w; }
      y += h;
    };
    const fmt = (n: number | null) => (n == null ? '' : String(round2(Number(n))).replace('.', ','));
    head();
    L.forEach((l, i) => {
      const vals: Record<string, string> = { no: String(i + 1), qty: fmt(l.qty), unit: l.unit ?? '', desc: l.description, net: fmt(l.net_kg), gross: fmt(l.gross_kg), comment: l.comment ?? '' };
      doc.font('R').fontSize(8);
      const textH = Math.max(...cols.filter((c) => c.k !== 'photo').map((c) => doc.heightOfString(vals[c.k] || ' ', { width: c.w - 6 }))) + 8;
      const photo = withPhotos ? inp.photos!.get(l.id) : undefined;
      const h = Math.max(textH, photo ? PH * 0.75 : 16);
      if (y + h > BOTTOM) { doc.addPage(); y = 36; head(); }
      let x = X0;
      for (const c of cols) {
        doc.lineWidth(0.6).strokeColor(line).rect(x, y, c.w, h).stroke();
        if (c.k === 'photo') { if (photo) { try { doc.image(photo, x + 2, y + 2, { fit: [c.w - 4, h - 4], align: 'center', valign: 'center' }); } catch { /* an unreadable image is left out */ } } }
        else doc.font('R').fontSize(8).fillColor(ink).text(vals[c.k], x + 3, y + 4, { width: c.w - 6, align: c.a });
        x += c.w;
      }
      y += h;
    });
    if (!L.length) { doc.font('R').fontSize(9).fillColor(mute).text('Brak pozycji / No lines', X0 + 4, y + 4); y += 20; }
    // ---- totals
    const t = totals(L);
    const tw = cols[4].w + cols[5].w, tx = X0 + cols.slice(0, 4).reduce((sum, c) => sum + c.w, 0);
    if (y + 34 > BOTTOM) { doc.addPage(); y = 36; }
    doc.font('B').fontSize(8).fillColor(ink).text('Suma wag / Total weight (kg)', X0, y + 6, { width: tx - X0 - 6, align: 'right' });
    doc.lineWidth(0.6).strokeColor(line).rect(tx, y, cols[4].w, 20).stroke().rect(tx + cols[4].w, y, cols[5].w, 20).stroke();
    doc.font('B').fontSize(9).text(fmt(t.net), tx + 3, y + 6, { width: cols[4].w - 6, align: 'right' }).text(fmt(t.gross), tx + cols[4].w + 3, y + 6, { width: cols[5].w - 6, align: 'right' });
    doc.font('R').fontSize(7).fillColor(mute).text('netto / net', tx, y + 22, { width: cols[4].w, align: 'center' }).text('brutto / gross', tx + cols[4].w, y + 22, { width: cols[5].w, align: 'center' });
    void tw;
    y += 38;
    // ---- notes, delivery day, signatures, unloading — kept together on one page
    const notesH = boxH(W, s.notes ?? '', 30);
    const blockH = notesH + 24 + 70 + 26 + 46 + 66;
    if (y + blockH > BOTTOM) { doc.addPage(); y = 36; }
    box(X0, y, W, notesH, 'Uwagi / Notes', s.notes ?? ''); y += notesH;
    box(X0, y, W, 24, 'Przesyłkę należy dostarczyć dnia / Deliver by', plDate(s.deliver_by)); y += 24 + 6;
    const w3 = W / 3;
    box(X0, y, w3, 70, 'Eksporter (podpis / pieczątka) / Exporter (signature / stamp)', '');
    box(X0 + w3, y, w3, 70, 'Miejsce i data załadunku / Place and date of loading', [s.ship_from, plDate(s.ship_date)].filter(Boolean).join('\n'));
    box(X0 + 2 * w3, y, w3, 70, 'Kwituję odbiór przesyłki (podpis kierowcy) / Goods received by the driver (signature)', '');
    y += 70 + 8;
    doc.font('B').fontSize(11).fillColor(ink).text('Rozładunek / Unloading', X0, y, { width: W, align: 'center' }); y += 18;
    box(X0, y, cw, 46, 'Zastrzeżenia i uwagi odbiorcy / Consignee’s reservations and remarks', '');
    box(X0 + cw, y, cw, 46, 'Zastrzeżenia i uwagi przewoźnika / Carrier’s reservations and remarks', ''); y += 46;
    box(X0, y, W, 66, 'Przesyłkę otrzymano / Goods received — miejscowość, data / place, date · podpis / pieczątka odbiorcy / consignee’s signature / stamp', '');
    // ---- footer on every page: created + page n / m
    const made = inp.createdAt ?? new Date();
    const pp = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(made).map((x) => [x.type, x.value]));
    const stamp = `${pp.day}.${pp.month}.${pp.year} ${pp.hour}:${pp.minute}`;   // Polish time, as on the paper form
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;   // the footer sits in the bottom margin — never let it start a new page
      doc.font('R').fontSize(7).fillColor(mute).text(`Data utworzenia / Created: ${stamp}   ·   ${s.name}   ·   ${i + 1} / ${range.count}`, X0, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

/** Keep the packing list just generated on the shipment: the latest with photos and the latest without
 *  (the earlier one of the same kind is replaced). Before migration 0120 it is filed under "other". */
export async function savePackingList(tenantId: string, shipmentId: string, by: string | null, pdf: Buffer, withPhotos: boolean, shipName: string): Promise<void> {
  const tag = withPhotos ? 'foto' : 'bez foto';
  const pp = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const name = `Lista pakowa ${shipName} (${tag}) ${pp.day}.${pp.month}.${pp.year} ${pp.hour}-${pp.minute}.pdf`.replace(/[\\/]/g, '_');
  const prev = await db().from('shipment_files').select('id,storage_path,file_name').eq('tenant_id', tenantId).eq('shipment_id', shipmentId).in('kind', ['packing_list', 'other']).like('file_name', `Lista pakowa % (${tag}) %`);
  const path = `${tenantId}/${shipmentId}/${Date.now()}-packing-${withPhotos ? 'foto' : 'nofoto'}.pdf`;
  const up = await db().storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw up.error;
  const row = { tenant_id: tenantId, shipment_id: shipmentId, line_id: null, storage_path: path, file_name: name, content_type: 'application/pdf', size: pdf.length, created_by_name: by };
  let ins = await db().from('shipment_files').insert({ ...row, kind: 'packing_list' });
  if (ins.error) ins = await db().from('shipment_files').insert({ ...row, kind: 'other' });   // migration 0120 not run yet
  if (ins.error) { await db().storage.from(BUCKET).remove([path]); throw ins.error; }
  const old = (prev.data ?? []) as any[];
  if (old.length) { await db().from('shipment_files').delete().in('id', old.map((r) => r.id)); await db().storage.from(BUCKET).remove(old.map((r) => r.storage_path)); }
}

/** The first photo of each line (JPEG / PNG only), for the packing list with photos. */
export async function linePhotos(tenantId: string, shipmentId: string, files: ShipFile[]): Promise<Map<string, Buffer>> {
  const first = new Map<string, ShipFile>();
  for (const f of files) if (f.kind === 'photo' && f.line_id && !first.has(f.line_id)) first.set(f.line_id, f);
  const out = new Map<string, Buffer>();
  await Promise.all([...first.entries()].map(async ([lineId, f]) => {
    const dl = await db().storage.from(BUCKET).download(f.storage_path);
    if (dl.error || !dl.data) return;
    const b = Buffer.from(await dl.data.arrayBuffer());
    if (isImage(b)) out.set(lineId, b);
  }));
  void tenantId; void shipmentId;
  return out;
}
