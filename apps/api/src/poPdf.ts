// Purchase-order PDF for one PO phase of a job. Lists every Surveyed item carrying that phase,
// with both the full item code and a short code ("Flat 12 Bathroom", or the item code like W1),
// full spec (type / material / style / size / glass / glazing / safety / open / cill / qty), and
// the item's Clearview style sketch where a design code is set.
//
// Served at GET /api/job/:ref/po.pdf?phase=N.
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJobByRef, listSurveyItems, userNames, requirementNamesForClientCode } from './store';

const __dir = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(__dir, '../../mobile/assets/styles');

const PRIMARY = '#3a2b72';
const INK = '#1e1b2e';
const MUTED = '#6b6880';
const LINE = '#d9d6e6';
const HEADBG = '#3a2b72';

// Room code → full name (mirror of the office ROOMS list) for the short code.
const ROOM_NAMES: Record<string, string> = {
  LR: 'Living room', KT: 'Kitchen', BA: 'Bathroom', BD: 'Bedroom', DR: 'Dining room', HW: 'Hallway',
  HO: 'Home office', LA: 'Laundry room', PA: 'Pantry', ST: 'Storage room', GA: 'Garage', AT: 'Attic',
  BS: 'Basement', GR: 'Guest room', NU: 'Nursery', MB: 'Master bedroom', BL: 'Balcony', TE: 'Terrace',
  GD: 'Garden', OF: 'Office', CR: 'Common Room', CW: 'Common Way', LG: 'Lounge', WC: 'WC',
};
const roomName = (code: any) => ROOM_NAMES[String(code ?? '').toUpperCase()] || String(code ?? '');

// Short code: "Flat {flat} {roomName}" when a flat is set, else the item code (W1 / D1).
function shortCode(it: any): string {
  const flat = String(it.flat ?? '').trim();
  if (flat) {
    const rn = roomName(it.room_code);
    return ('Flat ' + flat + (rn ? ' ' + rn : '')).trim();
  }
  return String(it.item_code ?? '').trim();
}

const s = (v: any) => (v == null || v === '') ? '—' : String(v);
const dim = (it: any) => (it.width_mm || it.height_mm) ? `${it.width_mm ?? '—'} × ${it.height_mm ?? '—'}` : '—';
const joinParts = (...xs: any[]) => xs.map((x) => (x == null || x === '') ? '' : String(x)).filter(Boolean).join(' · ') || '—';

export interface PoPdfData {
  job: { client_code: string; job_code: string; name: string; site_address?: string | null; postcode?: string | null; site_code?: string | null; delivery_address?: string | null; delivery_postcode?: string | null };
  phase: number;
  items: any[];
  generatedAt: Date;
  generatedBy?: string | null;
  readyBy?: string | null;
  readyAt?: string | null;
  requirements?: string[];   // customer's contractual requirements (Pass24, Building control, …)
}

const stamp = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Pure drawing (Option B: one card per item) — no DB. Resolves the finished PDF bytes. */
export function renderPoPdf(data: PoPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 34,
    info: { Title: `${data.job.client_code}.${data.job.job_code} — PO phase ${data.phase}`, Author: 'ACE Field' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });

  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
  const BOTTOM = doc.page.height - doc.page.margins.bottom;
  const code = `${data.job.client_code}.${data.job.job_code}`;

  // ---------- page header (first page) ----------
  doc.font('Helvetica-Bold').fontSize(19).fillColor(PRIMARY).text('Purchase Order', L, 30);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Item schedule for ordering · PO phase ${data.phase}`, L, 52);

  let y = 30;
  const infoX = L + W * 0.5, labW = 74, valW = W * 0.5 - labW - 4;
  const hrow = (label: string, val: string) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(label, infoX, y, { width: labW });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(val, infoX + labW, y, { width: valW });
    y += Math.max(12, doc.heightOfString(String(val || '—'), { width: valW }) + 2);
  };
  const addr = [data.job.site_address, data.job.postcode].filter(Boolean).join(', ');
  const deliv = [data.job.delivery_address, data.job.delivery_postcode].filter(Boolean).join(', ');
  hrow('Job', `${code}${data.job.site_code && data.job.site_code !== code ? '  (' + data.job.site_code + ')' : ''}`);
  hrow('Site', data.job.name || '—');
  if (addr) hrow('Site address', addr);
  hrow('Deliver to', deliv || addr || '—');
  hrow('Items', String(data.items.length));
  hrow('Generated', `${data.generatedBy ? data.generatedBy + ' · ' : ''}${stamp(data.generatedAt)}`);
  if (data.readyAt) hrow('Ready for PO', `${data.readyBy ? data.readyBy + ' · ' : ''}${stamp(data.readyAt)}`);

  // ---------- contractual requirements (customer-level, printed once) ----------
  let hy = 74;
  const reqs = data.requirements || [];
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PRIMARY).text('Contractual requirements', L, hy);
  hy += 14;
  if (reqs.length) {
    let cx = L; const chipH = 16, gap = 6;
    doc.font('Helvetica').fontSize(8.5);
    for (const rq of reqs) {
      const tw = doc.widthOfString(rq) + 16;
      if (cx + tw > L + W * 0.48) { cx = L; hy += chipH + 5; }
      doc.roundedRect(cx, hy, tw, chipH, 8).fill('#efeaf9');
      doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5).text(rq, cx + 8, hy + 4, { lineBreak: false });
      cx += tw + gap;
    }
    hy += chipH;
  } else {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('None set for this customer.', L, hy);
    hy += 10;
  }

  y = Math.max(y, hy) + 10;
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 10;

  if (!data.items.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`No Surveyed items with PO phase ${data.phase}.`, L, y + 6);
    doc.end();
    return done;
  }

  // ---------- item cards ----------
  const CARD_H = 194, GAP = 12;
  const specRow = (label: string, val: string, x: number, ry: number, w: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(label, x, ry, { width: 66, lineBreak: false });
    const vh = doc.font('Helvetica').fontSize(8.5).fillColor(INK).heightOfString(val || '—', { width: w - 68 });
    doc.text(val || '—', x + 68, ry, { width: w - 68 });
    return Math.max(12, vh + 2);
  };

  const drawFrame = (x: number, top: number, maxW: number, maxH: number, it: any) => {
    const wmm = Number(it.width_mm) || 0, hmm = Number(it.height_mm) || 0;
    if (!(wmm > 0 && hmm > 0)) return false;
    const ar = wmm / hmm;
    let rw = maxW, rh = rw / ar;
    if (rh > maxH) { rh = maxH; rw = rh * ar; }
    const rx = x + (maxW - rw) / 2, ry = top;
    doc.rect(rx, ry, rw, rh).lineWidth(1.2).strokeColor(PRIMARY).stroke();
    [it.mullion1_mm, it.mullion2_mm, it.mullion3_mm].forEach((m: any) => { const v = Number(m) || 0; if (v > 0 && v < wmm) { const mx = rx + (v / wmm) * rw; doc.moveTo(mx, ry).lineTo(mx, ry + rh).lineWidth(0.7).strokeColor(PRIMARY).stroke(); } });
    [it.transom1_mm, it.transom2_mm, it.transom3_mm].forEach((t: any) => { const v = Number(t) || 0; if (v > 0 && v < hmm) { const ty = ry + (v / hmm) * rh; doc.moveTo(rx, ty).lineTo(rx + rw, ty).lineWidth(0.7).strokeColor(PRIMARY).stroke(); } });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(`${wmm} × ${hmm} mm`, x, ry + rh + 3, { width: maxW, align: 'center' });
    return true;
  };

  data.items.forEach((it, idx) => {
    if (y + CARD_H > BOTTOM) { doc.addPage(); y = doc.page.margins.top; }
    // card border
    doc.roundedRect(L, y, W, CARD_H, 6).lineWidth(0.8).strokeColor(LINE).stroke();
    // header bar
    doc.save(); doc.roundedRect(L, y, W, 22, 6).fill(PRIMARY); doc.rect(L, y + 11, W, 11).fill(PRIMARY); doc.restore();
    const loc = [it.block, it.elevation, it.flat ? 'Flat ' + it.flat : '', it.floor ? 'Fl ' + it.floor : '', roomName(it.room_code), it.item_code].filter(Boolean).join(' · ');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fff').text(`${idx + 1}.  ${shortCode(it)}`, L + 8, y + 6, { width: W * 0.55, lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#e8e5f5').text(s(it.full_code), L + W * 0.5, y + 6, { width: W * 0.5 - 8, align: 'right', lineBreak: false });

    const bodyTop = y + 28, leftX = L + 8, leftW = W * 0.56, rightX = L + W * 0.58, rightW = W * 0.42 - 8;
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(loc, leftX, bodyTop, { width: leftW, lineBreak: false });
    let ry = bodyTop + 12;
    ry += specRow('Type', joinParts(it.item_type, it.window_type), leftX, ry, leftW);
    ry += specRow('Opening', joinParts(it.open_in_out), leftX, ry, leftW);
    ry += specRow('Material', s(it.material), leftX, ry, leftW);
    ry += specRow('Glass', joinParts(it.glass, it.safety_glass), leftX, ry, leftW);
    ry += specRow('Glazing', joinParts(it.glazing, it.glazing_bars && it.glazing_bars !== 'None' ? it.glazing_bars + ' bars' : ''), leftX, ry, leftW);
    ry += specRow('Cill', s(it.cill_depth), leftX, ry, leftW);
    if (it.add_ons) ry += specRow('Add-ons', String(it.add_ons), leftX, ry, leftW);
    if (it.coupled) ry += specRow('Coupled', String(it.coupled), leftX, ry, leftW);
    if (it.comments) ry += specRow('Comments', String(it.comments), leftX, ry, leftW);

    // right: dimensioned frame + style sketch thumbnail
    const drew = drawFrame(rightX, bodyTop + 2, rightW, 96, it);
    let sy = bodyTop + (drew ? 116 : 4);
    const dc = String(it.design_code ?? '').trim();
    if (dc) {
      try {
        const bytes = readFileSync(join(STYLES_DIR, `${dc}.png`));
        doc.image(bytes, rightX + rightW / 2 - 22, sy, { fit: [44, 40], align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('Style ' + dc, rightX, sy + 42, { width: rightW, align: 'center' });
      } catch { doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Style ' + dc, rightX, sy, { width: rightW, align: 'center' }); }
    }
    y += CARD_H + GAP;
  });

  // footer page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${code} · PO phase ${data.phase} · page ${i + 1} of ${range.count}`, L, doc.page.height - 24, { width: W, align: 'center' });
  }

  doc.end();
  return done;
}

// Natural, case-insensitive compare so "13" sorts after "3" and "F2" after "F10" correctly.
const nat = (a: any, b: any) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const chain = (...cmps: ((a: any, b: any) => number)[]) => (a: any, b: any) => { for (const c of cmps) { const r = c(a, b); if (r) return r; } return 0; };

export type PoSort = 'flat' | 'floor' | 'item' | 'code';
// Sort strategies for the PO schedule. Each keeps a sensible secondary order so items never
// interleave oddly (e.g. group by flat, then floor, then item code).
const PO_SORTERS: Record<PoSort, (a: any, b: any) => number> = {
  flat:  chain((a, b) => nat(a.flat, b.flat), (a, b) => nat(a.floor, b.floor), (a, b) => nat(a.item_code, b.item_code)),
  floor: chain((a, b) => nat(a.floor, b.floor), (a, b) => nat(a.flat, b.flat), (a, b) => nat(a.item_code, b.item_code)),
  item:  chain((a, b) => nat(a.item_code, b.item_code), (a, b) => nat(a.flat, b.flat), (a, b) => nat(a.floor, b.floor)),
  code:  (a, b) => nat(a.full_code, b.full_code),
};

/** Fetch a job's Surveyed items for the given phase and render the PO PDF. */
export async function buildJobPoPdf(jobRef: string, tenantId: string, phase: number, generatedBy?: string | null, sort: PoSort = 'flat'): Promise<{ buffer: Buffer; job: any }> {
  const job = await getJobByRef(jobRef);
  if (job.tenant_id !== tenantId) throw new Error('forbidden');
  const all = await listSurveyItems(job.id);
  const cmp = PO_SORTERS[sort] ?? PO_SORTERS.flat;
  const items = all
    .filter((it: any) => (it.kind ?? 'item') !== 'snag' && (it.stage === 'surveyed' || it.stage === 'synced') && Number(it.po_phase) === Number(phase))
    .sort(cmp);
  // If the phase has been marked "ready for PO", show who did it and when.
  const readyRow = items.find((it: any) => it.po_ready_at);
  let readyBy: string | null = null;
  const readyAt: string | null = readyRow ? readyRow.po_ready_at : null;
  if (readyRow?.po_ready_by) { const nm = await userNames([readyRow.po_ready_by]); readyBy = nm[readyRow.po_ready_by] ?? null; }
  const requirements = await requirementNamesForClientCode(tenantId, job.client_code);
  const buffer = await renderPoPdf({ job, phase, items, generatedAt: new Date(), generatedBy: generatedBy ?? null, readyBy, readyAt, requirements });
  return { buffer, job };
}
