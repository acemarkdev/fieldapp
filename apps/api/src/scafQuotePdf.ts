// ACE Scaffolding quote PDF: company header, the customer and site, the priced elements with their hire terms,
// totals (with the labour / hire split when given) and the terms. Company details and default terms come from
// Scaffolding ▸ Overview ▸ Quote settings. Served at GET /api/scaf/quotes/:id/pdf.
import PDFDocument from 'pdfkit';
import { weeklyRent, addDays, type QuoteLine } from './scafQuotes';

const PRIMARY = '#1f3a5f', INK = '#1e1b2e', MUTED = '#6b6880', LINE = '#d9d6e6';
const gbp = (n: number | null | undefined) => n == null ? '' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ukDay = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
// The built-in fonts are WinAnsi: no "≤", "✓", fancy dashes are fine, £ is fine.
const pdfText = (v: unknown) => String(v ?? '').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=').replace(/[✓✔]/g, 'Yes').split(String.fromCharCode(0x2028)).join('\n');
const weeks = (n: number) => `${Number(n) % 1 ? n : Math.round(n)} week${Number(n) === 1 ? '' : 's'}`;

/** The hire wording under a line: "Includes erection, dismantling and 8 weeks' hire; then £120.00 a week (4%)." */
export function hireText(l: QuoteLine): string {
  const inc = l.hire_weeks ? `Includes erection, dismantling and ${weeks(l.hire_weeks)}' hire` : 'Includes erection and dismantling';
  const w = weeklyRent(l);
  if (w === null) return inc + '.';
  return `${inc}; then ${gbp(w)} a week${l.rent_weekly === null && l.rent_pct !== null ? ` (${Number(l.rent_pct)}% of the price)` : ''}.`;
}

export interface QuotePdfData { quote: any; enquiry: any; customer: any; contact: any; site: any; company: any }
export function renderQuotePdf(d: QuotePdfData): Promise<Buffer> {
  const ref = `ACE${d.enquiry?.number ?? ''}`, rev = d.quote.revision;
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: `Quotation ${ref} v${rev}`, Author: d.company.name || 'ACE Scaffolding' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L, BOTTOM = doc.page.height - doc.page.margins.bottom - 24;
  const ensure = (h: number) => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; } };

  // header: company left, QUOTATION right
  const c = d.company;
  doc.font('Helvetica-Bold').fontSize(18).fillColor(PRIMARY).text(pdfText(c.name || 'ACE Scaffolding'), L, 40, { width: W * 0.6 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(pdfText([c.address, [c.phone, c.email].filter(Boolean).join('  ·  '), c.web].filter(Boolean).join('\n')), L, doc.y + 2, { width: W * 0.6 });
  const headBottom = doc.y;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('QUOTATION', L + W * 0.55, 40, { width: W * 0.45, align: 'right' });
  const sent = d.quote.sent_at || new Date().toISOString().slice(0, 10);
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`Ref: ${ref} v${rev}\nDate: ${ukDay(sent)}\nValid until: ${ukDay(addDays(sent, d.quote.valid_days || 30))}`, L + W * 0.55, doc.y + 4, { width: W * 0.45, align: 'right' });
  doc.y = Math.max(doc.y, headBottom) + 14;
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.y += 10;

  // to / site
  const top = doc.y;
  const block = (title: string, body: string, x: number, w: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x, top, { width: w });
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(pdfText(body) || '—', x, doc.y + 2, { width: w });
    return doc.y;
  };
  const to = [d.customer?.name, d.contact?.name ? 'FAO ' + d.contact.name : null, d.customer?.address].filter(Boolean).join('\n');
  const y1 = block('QUOTATION FOR', to, L, W / 2 - 10);
  const y2 = block('SITE', [d.site?.address, d.enquiry?.title && d.enquiry.title !== d.site?.address ? d.enquiry.title : null].filter(Boolean).join('\n'), L + W / 2 + 10, W / 2 - 10);
  doc.y = Math.max(y1, y2) + 14;

  if (d.quote.intro) { doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(pdfText(d.quote.intro), L, doc.y, { width: W }); doc.y += 8; }
  if (d.enquiry?.description) { doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Scope', L, doc.y); doc.font('Helvetica').fontSize(9.5).text(pdfText(d.enquiry.description), L, doc.y + 1, { width: W }); doc.y += 8; }

  // lines
  const cols = { no: L, el: L + 22, price: R - 90 };
  const head = () => {
    ensure(30);
    doc.rect(L, doc.y, W, 18).fill(PRIMARY);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
    const y = doc.y + 5;
    doc.text('#', cols.no + 4, y); doc.text('ELEMENT AND DESCRIPTION', cols.el, y); doc.text('PRICE', cols.price, y, { width: 86, align: 'right' });
    doc.y = y + 17;
  };
  head();
  const lines: QuoteLine[] = d.quote.lines;
  lines.forEach((l, i) => {
    const desc = [l.description, hireText(l)].filter(Boolean).map(pdfText).join('\n');
    doc.font('Helvetica').fontSize(9);
    const h = doc.heightOfString(desc, { width: cols.price - cols.el - 10 }) + 18;
    if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; head(); }
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(String(i + 1), cols.no + 4, y);
    doc.text(pdfText(l.element || 'Item'), cols.el, y, { width: cols.price - cols.el - 10 });
    doc.text(gbp(l.price), cols.price, y, { width: 86, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(desc, cols.el, doc.y + 1, { width: cols.price - cols.el - 10 });
    doc.y += 6;
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(0.6).stroke();
    doc.y += 5;
  });

  // totals
  const t = d.quote.totals;
  const row = (label: string, value: string, bold = false) => {
    ensure(16);
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK).text(label, R - 280, y, { width: 180, align: 'right' });
    doc.text(value, R - 96, y, { width: 92, align: 'right' });
    doc.y = y + (bold ? 17 : 14);
  };
  doc.y += 4;
  if (t.labour !== null) { row('of which erection and dismantling (labour)', gbp(t.labour)); row('of which hire', gbp(t.hire)); }
  row('Total (excluding VAT)', gbp(t.price), true);
  doc.y += 10;

  if (d.quote.terms) {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Terms', L, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    for (const p of String(d.quote.terms).split('\n').map((x) => x.trim()).filter(Boolean)) { ensure(14); doc.text('•  ' + pdfText(p), L, doc.y + 2, { width: W }); }
  }
  ensure(40); doc.y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(INK).text('To accept this quotation please reply in writing quoting ' + ref + '.', L, doc.y, { width: W });

  // footer on every page
  const foot = [c.name, c.company_no ? 'Company no. ' + c.company_no : null, c.vat_no ? 'VAT no. ' + c.vat_no : null].filter(Boolean).join('  ·  ');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;   // writing in the margin must not open a new page
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(pdfText(foot) + `      ${ref} v${rev} · page ${i - range.start + 1} of ${range.count}`, L, doc.page.height - mb + 14, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
  doc.end();
  return done;
}
