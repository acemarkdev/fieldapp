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
import { getJobByRef, listSurveyItems, userNames } from './store';

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
}

const stamp = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Pure drawing — no DB. Resolves the finished PDF bytes. */
export function renderPoPdf(data: PoPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30,
    info: { Title: `${data.job.client_code}.${data.job.job_code} — PO phase ${data.phase}`, Author: 'ACE Field' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });

  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // ---- header ----
  doc.font('Helvetica-Bold').fontSize(20).fillColor(PRIMARY).text('Purchase Order', L, 30);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text('Item schedule for ordering — frame & glass', L, 54);

  const code = `${data.job.client_code}.${data.job.job_code}`;
  const addr = [data.job.site_address, data.job.postcode].filter(Boolean).join(', ');
  const infoY = 30;
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const infoX = L + W * 0.55;
  const line = (label: string, val: string, y: number) => {
    doc.font('Helvetica-Bold').fillColor(MUTED).text(label, infoX, y, { width: 90, continued: false });
    doc.font('Helvetica').fillColor(INK).text(val, infoX + 92, y, { width: W * 0.45 - 92 });
  };
  const deliv = [data.job.delivery_address, data.job.delivery_postcode].filter(Boolean).join(', ');
  let iy = infoY;
  const row = (label: string, val: string) => { line(label, val, iy); iy += 13; };
  row('Job', `${code}${data.job.site_code && data.job.site_code !== code ? '  (' + data.job.site_code + ')' : ''}`);
  row('Site', data.job.name || '—');
  if (addr) row('Site address', addr);
  row('Deliver to', deliv || addr || '—');
  row('PO phase', String(data.phase));
  row('Items', String(data.items.length));
  row('Generated', `${data.generatedBy ? data.generatedBy + ' · ' : ''}${stamp(data.generatedAt)}`);
  if (data.readyAt) row('Ready for PO', `${data.readyBy ? data.readyBy + ' · ' : ''}${stamp(data.readyAt)}`);

  let y = Math.max(118, iy + 6);
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 8;

  // ---- table columns ----
  const cols = [
    { key: 'n', label: '#', w: 24 },
    { key: 'short', label: 'Short code', w: 96 },
    { key: 'full', label: 'Full item code', w: 150 },
    { key: 'frame', label: 'Type / Material / Style', w: 120 },
    { key: 'size', label: 'W × H (mm)', w: 66 },
    { key: 'glass', label: 'Glass / Glazing / Safety', w: 120 },
    { key: 'open', label: 'Open · Cill', w: 64 },
    { key: 'qty', label: 'Qty', w: 26 },
    { key: 'sketch', label: 'Sketch', w: 0 }, // remainder
  ];
  const fixed = cols.reduce((a, c) => a + c.w, 0);
  cols[cols.length - 1].w = Math.max(96, W - fixed);
  const xOf = (i: number) => L + cols.slice(0, i).reduce((a, c) => a + c.w, 0);

  const drawHeadRow = (yy: number) => {
    doc.rect(L, yy, W, 20).fill(HEADBG);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    cols.forEach((c, i) => doc.text(c.label, xOf(i) + 4, yy + 6, { width: c.w - 8, ellipsis: true }));
    return yy + 20;
  };
  y = drawHeadRow(y);

  const ROWH = 62;
  doc.font('Helvetica').fontSize(8).fillColor(INK);

  data.items.forEach((it, idx) => {
    if (y + ROWH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage(); y = doc.page.margins.top; y = drawHeadRow(y); doc.font('Helvetica').fontSize(8).fillColor(INK);
    }
    // row border
    doc.rect(L, y, W, ROWH).strokeColor(LINE).lineWidth(0.7).stroke();
    cols.forEach((c, i) => { if (i > 0) doc.moveTo(xOf(i), y).lineTo(xOf(i), y + ROWH).strokeColor(LINE).lineWidth(0.5).stroke(); });

    const pad = 4, top = y + 5;
    const cell = (i: number, text: string, opts: any = {}) => doc.fillColor(opts.color || INK).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 8).text(text, xOf(i) + pad, top, { width: cols[i].w - pad * 2, ...opts });
    cell(0, String(idx + 1));
    cell(1, shortCode(it), { bold: true });
    doc.font('Courier').fontSize(7.5).fillColor(INK).text(s(it.full_code), xOf(2) + pad, top, { width: cols[2].w - pad * 2 });
    cell(3, joinParts(it.item_type, it.material, it.window_type));
    cell(4, dim(it), { bold: true, size: 9 });
    cell(5, joinParts(it.glass, it.glazing, it.safety_glass));
    cell(6, joinParts(it.open_in_out, it.cill_depth));
    cell(7, '1');

    // sketch
    const dc = String(it.design_code ?? '').trim();
    const sx = xOf(8) + pad, sw = cols[8].w - pad * 2;
    if (dc) {
      try {
        const bytes = readFileSync(join(STYLES_DIR, `${dc}.png`));
        doc.image(bytes, sx, y + 4, { fit: [sw, ROWH - 16], align: 'center', valign: 'center' });
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text('style ' + dc, sx, y + ROWH - 10, { width: sw, align: 'center' });
      } catch { doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('style ' + dc, sx, y + ROWH / 2 - 4, { width: sw, align: 'center' }); }
    } else {
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('—', sx, y + ROWH / 2 - 4, { width: sw, align: 'center' });
    }
    y += ROWH;
  });

  if (!data.items.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`No Surveyed items with PO phase ${data.phase}.`, L, y + 10);
  }

  doc.end();
  return done;
}

/** Fetch a job's Surveyed items for the given phase and render the PO PDF. */
export async function buildJobPoPdf(jobRef: string, tenantId: string, phase: number, generatedBy?: string | null): Promise<{ buffer: Buffer; job: any }> {
  const job = await getJobByRef(jobRef);
  if (job.tenant_id !== tenantId) throw new Error('forbidden');
  const all = await listSurveyItems(job.id);
  const items = all
    .filter((it: any) => (it.kind ?? 'item') !== 'snag' && it.stage === 'surveyed' && Number(it.po_phase) === Number(phase))
    .sort((a: any, b: any) => String(a.full_code).localeCompare(String(b.full_code)));
  // If the phase has been marked "ready for PO", show who did it and when.
  const readyRow = items.find((it: any) => it.po_ready_at);
  let readyBy: string | null = null;
  const readyAt: string | null = readyRow ? readyRow.po_ready_at : null;
  if (readyRow?.po_ready_by) { const nm = await userNames([readyRow.po_ready_by]); readyBy = nm[readyRow.po_ready_by] ?? null; }
  const buffer = await renderPoPdf({ job, phase, items, generatedAt: new Date(), generatedBy: generatedBy ?? null, readyBy, readyAt });
  return { buffer, job };
}
