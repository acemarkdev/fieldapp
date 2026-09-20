// Per-flat install sign-off / QA handover certificate. Rendered from the saved qa_signoffs
// record (the checklist snapshot) plus the flat's after-install photos.
import PDFDocument from 'pdfkit';
import { getJobByRef, getSignoff, listFlatAfterPhotos, downloadPhoto } from './store';

const PRIMARY = '#3a2b72';
const INK = '#1e1b2e';
const MUTED = '#6b6880';
const LINE = '#d9d6e6';
const GREEN = '#16a34a';
const RED = '#c0392b';

export interface SignoffPdfData {
  job: { client_code: string; job_code: string; name: string; site_address?: string | null; postcode?: string | null };
  flat: string;
  result: 'pass' | 'fail';
  checklist: { key?: string; label: string; ok: boolean; note?: string | null }[];
  notes: string | null;
  signedBy: string | null;
  signedAt: string;
  photos: { bytes: Uint8Array; label: string | null }[];
}

const stamp = (d: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export function renderSignoffPdf(data: SignoffPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${data.job.client_code}.${data.job.job_code} Flat ${data.flat} — install sign-off`, Author: 'ACE Group' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });

  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;

  // header
  doc.rect(0, 0, doc.page.width, 88).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('INSTALL SIGN-OFF', M, 22);
  doc.font('Helvetica').fontSize(11).fillColor('#e8e5f5').text(`${data.job.client_code}.${data.job.job_code}  ·  Flat ${data.flat}`, M, 50);
  const pass = data.result === 'pass';
  doc.roundedRect(right - 130, 26, 130, 34, 6).fill('#ffffff');
  doc.fillColor(pass ? GREEN : RED).font('Helvetica-Bold').fontSize(16).text(pass ? 'PASS' : 'FAIL', right - 130, 36, { width: 130, align: 'center' });
  doc.y = 104; doc.fillColor(INK);

  // job / meta line
  const sub = [data.job.name, data.job.site_address, data.job.postcode].filter(Boolean).join('  ·  ');
  if (sub) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(sub, M, doc.y, { width: contentW });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Signed off by ${data.signedBy || '—'}  ·  ${stamp(data.signedAt)}`, M, doc.y + 3);
  doc.moveDown(0.8);

  // checklist table
  doc.font('Helvetica-Bold').fontSize(11).fillColor(PRIMARY).text('QA checklist', M, doc.y);
  doc.moveDown(0.3);
  const cw = { mark: 26, note: 150 };
  const rowY0 = doc.y;
  const drawRow = (label: string, ok: boolean | null, note: string | null, tint?: string) => {
    const lblW = contentW - cw.mark - cw.note;
    const h = Math.max(18, doc.heightOfString(label, { width: lblW - 8 }) + 8);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    const y = doc.y;
    if (tint) doc.rect(M, y, contentW, h).fill(tint);
    if (ok === null) { doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(9); doc.text('', M + 5, y + 5); }
    else { doc.fillColor(ok ? GREEN : RED).font('Helvetica-Bold').fontSize(12).text(ok ? '✓' : '✗', M + 6, y + 4, { width: cw.mark - 8 }); }
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(label, M + cw.mark, y + 5, { width: lblW - 8 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(note || '', M + cw.mark + lblW, y + 5, { width: cw.note - 6 });
    doc.y = y + h;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  };
  // header row
  doc.rect(M, rowY0, contentW, 18).fill('#efeaf9');
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5);
  doc.text('OK', M + 5, rowY0 + 5, { width: cw.mark - 6 });
  doc.text('CHECK', M + cw.mark, rowY0 + 5, { width: contentW - cw.mark - cw.note - 8 });
  doc.text('NOTE', M + contentW - cw.note, rowY0 + 5, { width: cw.note - 6 });
  doc.y = rowY0 + 18;
  data.checklist.forEach((c, i) => drawRow(c.label, !!c.ok, c.note ?? null, i % 2 ? '#faf9fd' : undefined));

  // overall notes
  if (data.notes) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('NOTES', M, doc.y);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(data.notes, M, doc.y + 2, { width: contentW });
  }

  // photos grid
  if (data.photos.length) {
    doc.moveDown(1);
    if (doc.y > doc.page.height - 220) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PRIMARY).text('After-install photos', M, doc.y);
    doc.moveDown(0.4);
    const cols = 3, gap = 10, cellW = (contentW - gap * (cols - 1)) / cols, cellH = cellW * 0.75;
    let col = 0, rowTop = doc.y;
    for (const ph of data.photos.slice(0, 9)) {
      if (col === 0 && rowTop + cellH > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); rowTop = doc.y; }
      const x = M + col * (cellW + gap);
      try {
        doc.save();
        doc.rect(x, rowTop, cellW, cellH).clip();
        doc.image(Buffer.from(ph.bytes), x, rowTop, { cover: [cellW, cellH] });
        doc.restore();
      } catch {
        doc.rect(x, rowTop, cellW, cellH).fillAndStroke('#f2f0f8', LINE);
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('image unavailable', x, rowTop + cellH / 2 - 4, { width: cellW, align: 'center' });
      }
      doc.rect(x, rowTop, cellW, cellH).strokeColor(LINE).lineWidth(0.5).stroke();
      if (ph.label) doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(ph.label, x, rowTop + cellH + 2, { width: cellW, align: 'center', lineBreak: false });
      col++;
      if (col === cols) { col = 0; rowTop = rowTop + cellH + 16; doc.y = rowTop; }
    }
    if (col !== 0) doc.y = rowTop + cellH + 16;
  }

  // footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${data.job.client_code}.${data.job.job_code} · Flat ${data.flat} · install sign-off · ${stamp(data.signedAt)} · page ${i + 1} of ${range.count}`,
        M, doc.page.height - 28, { width: contentW, align: 'center' });
  }

  doc.end();
  return done;
}

export async function buildFlatSignoffPdf(jobRef: string, flat: string, tenantId: string): Promise<{ buffer: Buffer; job: any } | null> {
  const job = await getJobByRef(jobRef);
  if (job.tenant_id !== tenantId) throw new Error('forbidden');
  const so = await getSignoff(job.id, flat);
  if (!so) return null;                       // not signed off yet — nothing to certify
  const checklist = Array.isArray(so.checklist) ? so.checklist : [];
  // Fetch the flat's after-photos (best effort — a missing file just drops out).
  const metas = await listFlatAfterPhotos(job.id, flat);
  const photos: { bytes: Uint8Array; label: string | null }[] = [];
  for (const m of metas.slice(0, 9)) {
    try { photos.push({ bytes: await downloadPhoto(m.storage_path), label: m.full_code }); } catch { /* skip */ }
  }
  const buffer = await renderSignoffPdf({
    job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: (job as any).site_address, postcode: (job as any).postcode },
    flat, result: so.result, checklist, notes: so.notes, signedBy: so.signed_by, signedAt: so.signed_at, photos,
  });
  return { buffer, job };
}
