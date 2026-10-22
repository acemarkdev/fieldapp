// ACE Scaffolding stock note (PDF): delivery, collection, transfer, purchase, stocktake or loss — the items and
// quantities, total weight, the job and site, vehicle / driver, and signatures. Served at GET /api/scaf/stock/notes/:id/pdf.
import PDFDocument from 'pdfkit';

const PRIMARY = '#1f3a5f', INK = '#1e1b2e', MUTED = '#6b6880', LINE = '#d9d6e6';
const ukDay = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const t = (v: unknown) => String(v ?? '');
export const NOTE_TITLE: Record<string, string> = { delivery: 'DELIVERY NOTE', collection: 'COLLECTION NOTE', transfer: 'TRANSFER NOTE', purchase: 'GOODS IN', stocktake: 'STOCKTAKE', loss: 'WRITE-OFF' };

export function renderStockNotePdf(n: any, company: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `${NOTE_TITLE[n.kind] || 'Stock note'} ${n.ref}`, Author: company.name || 'ACE Scaffolding' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (x: Buffer) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L, BOTTOM = doc.page.height - doc.page.margins.bottom - 130;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(PRIMARY).text(t(company.name || 'ACE Scaffolding'), L, 40, { width: W * 0.55 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(t([company.address, company.phone].filter(Boolean).join('  ·  ')), L, doc.y + 2, { width: W * 0.55 });
  const hb = doc.y;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(NOTE_TITLE[n.kind] || 'STOCK NOTE', L + W * 0.45, 40, { width: W * 0.55, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`${n.ref}\nDate: ${ukDay(n.day)}${n.final ? '\nFinal collection' : ''}`, L + W * 0.45, doc.y + 4, { width: W * 0.55, align: 'right' });
  doc.y = Math.max(doc.y, hb) + 12;
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(1).stroke(); doc.y += 10;

  const place = (loc: any) => (loc ? loc.name + (loc.reg ? ' (' + loc.reg + ')' : '') : '');
  const site = n.job ? [`ACESC${n.job.number}${n.job.title ? ' · ' + n.job.title : ''}`, n.site?.address, n.customer?.name].filter(Boolean).join('\n') : '';
  const from = n.kind === 'collection' || (n.kind === 'loss' && n.job) ? site : n.kind === 'purchase' || n.kind === 'stocktake' ? '' : place(n.from);
  const to = n.kind === 'delivery' ? site : n.kind === 'loss' ? 'Written off' : place(n.to);
  const top = doc.y;
  const block = (title: string, body: string, x: number, w: number) => { doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x, top, { width: w }); doc.font('Helvetica').fontSize(10).fillColor(INK).text(t(body) || '—', x, doc.y + 2, { width: w }); return doc.y; };
  const y1 = block(n.kind === 'stocktake' ? 'COUNTED AT' : 'FROM', n.kind === 'stocktake' ? place(n.to) : from, L, W / 3 - 10);
  const y2 = block('TO', n.kind === 'stocktake' ? '' : to, L + W / 3, W / 3 - 10);
  const y3 = block('VEHICLE / DRIVER', [n.vehicle, n.driver].filter(Boolean).join('\n'), L + (2 * W) / 3, W / 3);
  doc.y = Math.max(y1, y2, y3) + 14;

  const head = () => { doc.rect(L, doc.y, W, 18).fill(PRIMARY); const y = doc.y + 5; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
    doc.text('CODE', L + 6, y).text('ITEM', L + 70, y).text(n.kind === 'stocktake' ? 'DIFFERENCE' : 'QTY', R - 170, y, { width: 70, align: 'right' }).text('WEIGHT kg', R - 90, y, { width: 84, align: 'right' }); doc.y = y + 17; };
  head();
  let kg = 0;
  for (const l of n.lines ?? []) {
    if (doc.y + 18 > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; head(); }
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(t(l.code), L + 6, y).text(t(l.name), L + 70, y, { width: R - 180 - (L + 70) })
      .text(`${l.qty} ${l.unit || ''}`.trim(), R - 170, y, { width: 70, align: 'right' }).text(l.weight == null ? '' : String(l.weight), R - 90, y, { width: 84, align: 'right' });
    kg += l.weight ?? 0;
    doc.y = y + 15; doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(0.5).stroke(); doc.y += 3;
  }
  doc.font('Helvetica-Bold').fontSize(9.5).text(`Total weight: ${Math.round(kg)} kg`, L, doc.y + 6, { width: W, align: 'right' });
  if (n.notes) doc.font('Helvetica').fontSize(9.5).text('Notes: ' + t(n.notes), L, doc.y + 8, { width: W });

  const sy = Math.max(doc.y + 30, doc.page.height - doc.page.margins.bottom - 110), half = W / 2 - 12;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(n.kind === 'delivery' ? 'DELIVERED BY' : n.kind === 'collection' ? 'COLLECTED BY' : 'BY', L, sy, { width: half })
    .text(n.kind === 'delivery' ? 'RECEIVED ON SITE BY' : n.kind === 'collection' ? 'CHECKED IN AT THE YARD BY' : 'CHECKED BY', L + W / 2 + 12, sy, { width: half });
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(t(n.driver || ''), L, sy + 14, { width: half }).text(t(n.signed_by || ''), L + W / 2 + 12, sy + 14, { width: half });
  doc.moveTo(L, sy + 70).lineTo(L + half, sy + 70).strokeColor(LINE).stroke(); doc.moveTo(L + W / 2 + 12, sy + 70).lineTo(R, sy + 70).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Signature', L, sy + 74).text('Signature', L + W / 2 + 12, sy + 74);
  doc.end();
  return done;
}
