// ACE Scaffolding — request for invoice (PDF) for the accounts team, who raise the invoice in Xero: who to invoice
// (name, billing address, VAT number), the job, site and PO, the lines (rent with its days), subtotal, retention,
// amount due, payment terms, and the VAT / CIS note. Served at GET /api/scaf/requests/:id/pdf.
import PDFDocument from 'pdfkit';

const PRIMARY = '#1f3a5f', INK = '#1e1b2e', MUTED = '#6b6880', LINE = '#d9d6e6';
const gbp = (n: number | null | undefined) => n == null ? '' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ukDay = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const t = (v: unknown) => String(v ?? '').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=');
const KIND: Record<string, string> = { rent: 'Hire (rent)', price: 'Scaffolding — part of the price', other: 'Other charge' };

export function renderInvoiceRequestPdf(r: any, company: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: `Request for invoice ${r.ref}`, Author: company.name || 'ACE Scaffolding' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (x: Buffer) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L, BOTTOM = doc.page.height - doc.page.margins.bottom - 24;
  const ensure = (h: number) => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; } };

  doc.font('Helvetica-Bold').fontSize(16).fillColor(PRIMARY).text(t(company.name || 'ACE Scaffolding'), L, 40, { width: W * 0.55 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('For the accounts team — please raise this invoice in Xero.', L, doc.y + 2, { width: W * 0.55 });
  const hb = doc.y;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('REQUEST FOR INVOICE', L + W * 0.45, 40, { width: W * 0.55, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`Ref: ${r.ref}\nRaised: ${ukDay(r.sent_on || r.created_at)}\nType: ${KIND[r.kind] || r.kind}${r.period_from || r.period_to ? `\nPeriod: ${ukDay(r.period_from)} – ${ukDay(r.period_to)}` : ''}`, L + W * 0.45, doc.y + 4, { width: W * 0.55, align: 'right' });
  doc.y = Math.max(doc.y, hb) + 12;
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(1).stroke(); doc.y += 10;

  const top = doc.y;
  const block = (title: string, body: string, x: number, w: number) => { doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x, top, { width: w }); doc.font('Helvetica').fontSize(10).fillColor(INK).text(t(body) || '—', x, doc.y + 2, { width: w }); return doc.y; };
  const c = r.customer ?? {};
  const y1 = block('INVOICE TO', [c.name, c.address, c.vat_number ? 'VAT no. ' + c.vat_number : null, c.email].filter(Boolean).join('\n'), L, W / 2 - 10);
  const y2 = block('JOB', [`ACESC${r.job?.number ?? ''}${r.job?.title ? ' · ' + r.job.title : ''}`, r.site?.address, r.po_number ? 'Customer PO: ' + r.po_number : 'Customer PO: —', r.contact?.name ? 'Contact: ' + r.contact.name : null].filter(Boolean).join('\n'), L + W / 2 + 10, W / 2 - 10);
  doc.y = Math.max(y1, y2) + 14;

  const cols = { d: L + 6, per: L + W * 0.46, days: L + W * 0.66, amt: R - 86 };
  const head = () => { ensure(26); doc.rect(L, doc.y, W, 18).fill(PRIMARY); const y = doc.y + 5; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
    doc.text('DESCRIPTION', cols.d, y).text('PERIOD', cols.per, y).text('DAYS AND RATE', cols.days, y).text('AMOUNT', cols.amt, y, { width: 80, align: 'right' }); doc.y = y + 17; };
  head();
  for (const l of r.lines ?? []) {
    const perTxt = l.period_from || l.period_to ? `${ukDay(l.period_from)} – ${ukDay(l.period_to)}` : '';
    const dayTxt = l.days != null && l.weekly != null ? `${Number(l.days)} days × ${gbp(l.weekly)}/wk ÷ 7` : '';
    doc.font('Helvetica').fontSize(9.5);
    const hDesc = doc.heightOfString(t(l.description || ''), { width: cols.per - cols.d - 8 });
    doc.fontSize(9);
    const h = Math.max(hDesc, doc.heightOfString(perTxt, { width: cols.days - cols.per - 6 }), doc.heightOfString(dayTxt, { width: cols.amt - cols.days - 6 })) + 12;
    doc.fontSize(9.5);
    if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; head(); }
    const y = doc.y;
    doc.fillColor(INK).text(t(l.description || ''), cols.d, y, { width: cols.per - cols.d - 8 });
    const yd = doc.y;
    doc.fontSize(9).fillColor(MUTED).text(perTxt, cols.per, y, { width: cols.days - cols.per - 6 });
    const yp = doc.y;
    doc.text(dayTxt, cols.days, y, { width: cols.amt - cols.days - 6 });
    const yq = doc.y;
    doc.fontSize(9.5).fillColor(INK).text(gbp(l.amount), cols.amt, y, { width: 80, align: 'right' });
    doc.y = Math.max(yd, yp, yq, doc.y) + 5;
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(0.6).stroke(); doc.y += 5;
  }
  const row = (label: string, value: string, bold = false) => { ensure(16); const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK).text(label, R - 300, y, { width: 200, align: 'right' }); doc.text(value, R - 96, y, { width: 92, align: 'right' }); doc.y = y + (bold ? 17 : 14); };
  doc.y += 4;
  row('Subtotal (excluding VAT)', gbp(r.subtotal));
  if (r.labour != null) row('of which erection / dismantling labour', gbp(r.labour));
  if (r.retention) row(`Retention ${Number(r.retention_pct)}%`, '-' + gbp(r.retention));
  row('Amount to invoice (excluding VAT)', gbp(r.due), true);
  doc.y += 8;
  const info = [
    r.payment_days != null ? `Payment terms: ${r.payment_days} days` : null,
    `VAT / CIS: ${r.vat_note || 'standard — to be confirmed by accounts'}`,
    r.notes ? 'Notes: ' + r.notes : null,
  ].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  for (const x of info) { ensure(14); doc.text(t(x), L, doc.y + 2, { width: W }); }

  const foot = [company.name, company.company_no ? 'Company no. ' + company.company_no : null, company.vat_no ? 'VAT no. ' + company.vat_no : null].filter(Boolean).join('  ·  ');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(foot) + `      ${r.ref} · page ${i - range.start + 1} of ${range.count}`, L, doc.page.height - mb + 14, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
  doc.end();
  return done;
}
