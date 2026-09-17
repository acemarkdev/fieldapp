// Customer invoice PDF (finance module). Rendered from the immutable SNAPSHOT captured on the
// invoice at issue time — never re-priced — so a downloaded invoice always matches what was sent.
//
// This is a CUSTOMER-FACING document: it shows only the sale side (what the customer pays),
// plus VAT and the total. It never prints our cost or margin.
import PDFDocument from 'pdfkit';
import { getInvoice, getJobByRef } from './store';
import { formatPennies, type JobBreak } from '@ace/shared';

const PRIMARY = '#3a2b72';
const INK = '#1e1b2e';
const MUTED = '#6b6880';
const LINE = '#d9d6e6';
const GREEN = '#16a34a';
const RED = '#c0392b';

// Everything the renderer needs — the invoice fields + the snapshotted breakdown/job.
export interface InvoicePdfData {
  number: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  issueDate: string;                 // ISO date
  dueDate: string | null;
  customer: string | null;
  billTo: string | null;
  notes: string | null;
  vatRate: number;
  subtotal: number;                  // pennies
  vat: number;                       // pennies
  total: number;                     // pennies
  paidRef: string | null;
  job: { client_code: string; job_code: string; name: string; site_address?: string | null };
  breakdown: JobBreak;
  seller?: { name?: string; address?: string; vatNo?: string | null };
}

const fmtDate = (d?: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${data.number}`, Author: data.seller?.name || 'ACE Group' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });

  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;
  const b = data.breakdown;
  const overdue = data.status !== 'paid' && data.dueDate ? new Date(data.dueDate) < new Date(new Date().toDateString()) : false;

  // ---- header band ----
  doc.rect(0, 0, doc.page.width, 92).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text('INVOICE', M, 22);
  doc.font('Helvetica').fontSize(11).fillColor('#e8e5f5').text(data.number, M, 52);
  // seller block, right-aligned
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#fff').text(data.seller?.name || 'ACE Group', right - 240, 22, { width: 240, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#e8e5f5')
    .text((data.seller?.address || '') + (data.seller?.vatNo ? `\nVAT No: ${data.seller.vatNo}` : ''), right - 240, 40, { width: 240, align: 'right' });
  doc.y = 108; doc.fillColor(INK);

  // ---- bill-to + meta ----
  const metaX = right - 220;
  const topY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('BILL TO', M, topY);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(data.customer || '—', M, topY + 12, { width: metaX - M - 20 });
  if (data.billTo) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(data.billTo, M, doc.y + 1, { width: metaX - M - 20 });

  // meta rows on the right
  const meta: [string, string][] = [
    ['Invoice no.', data.number],
    ['Issue date', fmtDate(data.issueDate)],
    ['Due date', fmtDate(data.dueDate) + (overdue ? '  (overdue)' : '')],
    ['Job', `${data.job.client_code}.${data.job.job_code}`],
  ];
  let my = topY;
  for (const [k, v] of meta) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, metaX, my, { width: 80 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(k === 'Due date' && overdue ? RED : INK).text(v, metaX + 82, my, { width: 138, align: 'right' });
    my += 15;
  }
  if (data.job.name) { doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(data.job.name, metaX, my, { width: 220, align: 'right' }); my += 12; }
  if (data.job.site_address) { doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(data.job.site_address, metaX, my, { width: 220, align: 'right' }); }

  doc.y = Math.max(doc.y, my) + 18;

  // status pill
  const pill = data.status === 'paid' ? { t: 'PAID', c: GREEN } : overdue ? { t: 'OVERDUE', c: RED } : data.status === 'sent' ? { t: 'AWAITING PAYMENT', c: PRIMARY } : data.status === 'void' ? { t: 'VOID', c: MUTED } : { t: 'DRAFT', c: MUTED };
  doc.roundedRect(M, doc.y, 150, 22, 5).fill(pill.c);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text(pill.t, M, doc.y + 6, { width: 150, align: 'center' });
  doc.y += 34; doc.fillColor(INK);

  // ---- line items ----
  const cols = [
    { t: 'Description', w: 0.58, a: 'left' as const },
    { t: 'Details', w: 0.24, a: 'left' as const },
    { t: 'Amount', w: 0.18, a: 'right' as const },
  ];
  const xs: number[] = []; let cx = M; for (const c of cols) { xs.push(cx); cx += c.w * contentW; }
  const rowH = 19;
  const header = () => {
    const hy = doc.y;
    doc.rect(M, hy, contentW, rowH).fill('#efeaf9');
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + 5, hy + 5.5, { width: c.w * contentW - 10, align: c.a, lineBreak: false }));
    doc.y = hy + rowH; doc.font('Helvetica').fontSize(9).fillColor(INK);
  };
  const line = (desc: string, detail: string, amount: string, tint?: string) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 120) { doc.addPage(); header(); }
    const y = doc.y;
    if (tint) doc.rect(M, y, contentW, rowH).fill(tint);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(desc, xs[0] + 5, y + 5.5, { width: cols[0].w * contentW - 10, lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).text(detail, xs[1] + 5, y + 5.5, { width: cols[1].w * contentW - 10, lineBreak: false, ellipsis: true });
    doc.fillColor(INK).text(amount, xs[2] + 5, y + 5.5, { width: cols[2].w * contentW - 10, align: 'right', lineBreak: false });
    doc.y = y + rowH;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  };

  header();
  b.flats.forEach((f, i) => line(
    `Flat ${f.flat}`,
    `${f.windows} window${f.windows === 1 ? '' : 's'}` + (f.extraWindows ? ` · ${f.extraWindows} extra (${f.extraM2} m²)` : ''),
    formatPennies(f.total),
    i % 2 ? '#faf9fd' : undefined,
  ));
  if (b.doors.count) line('Doors', `${b.doors.count} × unit rate`, formatPennies(b.doors.amount));
  if (b.communal.windows) line('Communal / COM windows', `${b.communal.windows} × m² (${b.communal.m2} m²)`, formatPennies(b.communal.amount));
  for (const v of b.variations) line(`Variation ${v.code ?? ''}`.trim(), 'Agreed amount', formatPennies(v.amount));

  // ---- totals block (right-aligned) ----
  doc.moveDown(0.4);
  const tX = right - 240;
  const totRow = (label: string, val: string, bold = false, big = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 12 : 9.5).fillColor(bold ? INK : MUTED)
      .text(label, tX, y + 3, { width: 130, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(big ? 12 : 9.5).fillColor(big ? PRIMARY : INK)
      .text(val, tX + 130, y + 3, { width: 110, align: 'right' });
    doc.y = y + (big ? 22 : 16);
  };
  totRow('Subtotal (ex VAT)', formatPennies(data.subtotal));
  totRow(`VAT @ ${Number(data.vatRate)}%`, formatPennies(data.vat));
  doc.moveTo(tX, doc.y + 1).lineTo(right, doc.y + 1).strokeColor(LINE).lineWidth(1).stroke();
  doc.y += 4;
  totRow('Total due', formatPennies(data.total), true, true);
  if (data.status === 'paid') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN)
      .text(`Paid${data.paidRef ? ' · ' + data.paidRef : ''}`, tX, doc.y + 2, { width: 240, align: 'right' });
    doc.y += 16;
  }

  // ---- notes / terms ----
  doc.fillColor(INK); doc.moveDown(1.4);
  if (data.notes) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('NOTES', M, doc.y);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(data.notes, M, doc.y + 2, { width: contentW });
    doc.moveDown(0.6);
  }
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
    .text('Payment due by the date shown above. Please quote the invoice number with your payment. This invoice covers the surveyed and installed scope for the referenced job; snags are not charged and variations are billed at the agreed amounts shown.', M, doc.y, { width: contentW });

  // ---- footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Invoice ${data.number} · ${fmtDate(data.issueDate)} · page ${i + 1} of ${range.count}`,
        M, doc.page.height - 28, { width: contentW, align: 'center' });
  }

  doc.end();
  return done;
}

// Load an invoice + its snapshot and render the PDF. Throws 'forbidden' on tenant mismatch,
// returns null if the invoice doesn't exist.
export async function buildInvoicePdf(invoiceId: string, tenantId: string): Promise<{ buffer: Buffer; number: string } | null> {
  const inv = await getInvoice(invoiceId, tenantId);
  if (!inv) return null;
  const snap = inv.snapshot || {};
  // Prefer the job details snapshotted at issue time; fall back to a live lookup if absent.
  let job = snap.job;
  if (!job) {
    try { const j = await getJobByRef(inv.job_id); job = { client_code: j.client_code, job_code: j.job_code, name: j.name, site_address: (j as any).site_address }; }
    catch { job = { client_code: '', job_code: '', name: '' }; }
  }
  const buffer = await renderInvoicePdf({
    number: inv.number, status: inv.status, issueDate: inv.issue_date, dueDate: inv.due_date,
    customer: inv.customer, billTo: inv.bill_to, notes: inv.notes, vatRate: Number(inv.vat_rate),
    subtotal: inv.subtotal_pennies, vat: inv.vat_pennies, total: inv.total_pennies, paidRef: inv.paid_ref,
    job, breakdown: snap.breakdown, seller: snap.seller,
  });
  return { buffer, number: inv.number };
}
