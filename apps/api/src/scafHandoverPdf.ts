// ACE Scaffolding handover certificate (PDF): the scaffolds handed over on a job, the duty / load, the safety
// statement, who handed over for ACE and the client's name and signature. The hire of those scaffolds starts on the
// handover day. Served at GET /api/scaf/handovers/:id/pdf.
import PDFDocument from 'pdfkit';

const PRIMARY = '#1f3a5f', INK = '#1e1b2e', MUTED = '#6b6880', LINE = '#d9d6e6';
const ukDay = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const t = (v: unknown) => String(v ?? '').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=');

export const HANDOVER_STATEMENT = [
  'The scaffolding listed above has been erected by competent scaffolders and is handed over complete and safe to use for the purpose and loading stated.',
  'It must be inspected before first use, at intervals not exceeding 7 days, and after any event likely to have affected its stability (Work at Height Regulations 2005). Inspections are carried out by ACE Scaffolding unless agreed otherwise.',
  'The scaffold must not be altered, loaded beyond the stated duty, or have ties, boards, guardrails or toe boards removed by anyone other than ACE Scaffolding. Report any damage or defect to us straight away.',
  'Hire of the scaffolding listed starts on the handover date.',
];

export interface HandoverPdfData { handover: any; job: any; company: any }
export function renderHandoverPdf(d: HandoverPdfData): Promise<Buffer> {
  const h = d.handover, j = d.job, c = d.company;
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Handover certificate ACESC${j.number}`, Author: c.name || 'ACE Scaffolding' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (x: Buffer) => chunks.push(x)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(PRIMARY).text(t(c.name || 'ACE Scaffolding'), L, 40, { width: W * 0.6 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(t([c.address, [c.phone, c.email].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n')), L, doc.y + 2, { width: W * 0.6 });
  const hb = doc.y;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('SCAFFOLD HANDOVER\nCERTIFICATE', L + W * 0.5, 40, { width: W * 0.5, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`Job: ACESC${j.number}${j.enquiry ? '  ·  Quote ACE' + j.enquiry.number : ''}\nHandover date: ${ukDay(h.day)}`, L + W * 0.5, doc.y + 4, { width: W * 0.5, align: 'right' });
  doc.y = Math.max(doc.y, hb) + 12;
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(1).stroke(); doc.y += 10;

  const top = doc.y;
  const block = (title: string, body: string, x: number, w: number) => { doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x, top, { width: w }); doc.font('Helvetica').fontSize(10).fillColor(INK).text(t(body) || '—', x, doc.y + 2, { width: w }); return doc.y; };
  const y1 = block('CLIENT', [j.customer?.name, j.contact?.name].filter(Boolean).join('\n'), L, W / 2 - 10);
  const y2 = block('SITE', [j.site?.address, j.title && j.title !== j.site?.address ? j.title : null].filter(Boolean).join('\n'), L + W / 2 + 10, W / 2 - 10);
  doc.y = Math.max(y1, y2) + 14;

  // the scaffolds
  doc.rect(L, doc.y, W, 18).fill(PRIMARY);
  let y = doc.y + 5;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff').text('SCAFFOLD', L + 6, y).text('TAG', R - 90, y, { width: 84 });
  doc.y = y + 17;
  const handed = new Set<string>(h.scaffold_ids ?? []);
  for (const s of (j.scaffolds ?? []).filter((x: any) => handed.has(x.id))) {
    y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(t(s.element || 'Scaffold'), L + 6, y, { width: W - 110 });
    if (s.description) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(t(s.description), L + 6, doc.y + 1, { width: W - 110 });
    const yEnd = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(t(s.tag || '—'), R - 90, y, { width: 84 });
    doc.y = Math.max(yEnd, doc.y) + 5;
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(LINE).lineWidth(0.6).stroke(); doc.y += 5;
  }
  doc.y += 4;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Duty / loading: ', L, doc.y, { continued: true }).font('Helvetica').text(t(h.max_load || 'As stated in the design / TG20 compliance sheet'));
  if (h.notes) { doc.y += 4; doc.font('Helvetica-Bold').text('Notes: ', L, doc.y, { continued: true }).font('Helvetica').text(t(h.notes), { width: W }); }
  doc.y += 10;
  doc.font('Helvetica').fontSize(8.8).fillColor(INK);
  for (const p of HANDOVER_STATEMENT) doc.text('•  ' + p, L, doc.y + 3, { width: W });
  doc.y += 22;

  // signatures
  const sy = doc.y, half = W / 2 - 12;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('HANDED OVER FOR ' + t((c.name || 'ACE Scaffolding').toUpperCase()), L, sy, { width: half });
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(t(h.ace_person || ''), L, sy + 14, { width: half });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('RECEIVED FOR THE CLIENT', L + W / 2 + 12, sy, { width: half });
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(t(h.client_name || ''), L + W / 2 + 12, sy + 14, { width: half });
  if (h.signature && /^data:image\/png;base64,/.test(h.signature)) {
    try { doc.image(Buffer.from(h.signature.split(',')[1], 'base64'), L + W / 2 + 12, sy + 32, { fit: [half, 70] }); } catch { /* a bad image is left out */ }
  } else if (h.signature && /^svg:\d+x\d+:/.test(h.signature)) {   // drawn on the phone: strokes, scaled into the box
    const [, size, path] = h.signature.split(':'), [w, ht] = size.split('x').map(Number), k = Math.min(half / w, 70 / ht);
    try { doc.save().translate(L + W / 2 + 12, sy + 32).scale(k).path(path).lineWidth(2.2 / k).strokeColor(INK).stroke().restore(); } catch { /* a bad path is left out */ }
  }
  doc.moveTo(L + W / 2 + 12, sy + 106).lineTo(R, sy + 106).strokeColor(LINE).stroke();
  doc.moveTo(L, sy + 106).lineTo(L + half, sy + 106).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Signature', L + W / 2 + 12, sy + 110).text('Date: ' + ukDay(h.day), L, sy + 110);

  const foot = [c.name, c.company_no ? 'Company no. ' + c.company_no : null, c.vat_no ? 'VAT no. ' + c.vat_no : null].filter(Boolean).join('  ·  ');
  const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(foot) + `      ACESC${j.number} handover ${ukDay(h.day)}`, L, doc.page.height - mb + 14, { width: W, align: 'center', lineBreak: false });
  doc.page.margins.bottom = mb;
  doc.end();
  return done;
}
