// Customer price-breakdown PDF (for invoicing/quoting).
//
// IMPORTANT: this is a CUSTOMER-FACING document — it shows ONLY the sale side
// (what the customer pays). It never prints our cost or margin.
import PDFDocument from 'pdfkit';
import { getJobByCode, listSurveyItems, listItemPricing, getJobRuleId, getPricingRule } from './store';
import { priceJob, classifyCategory, formatPennies, type PriceItem, type JobBreak } from '@ace/shared';

const PRIMARY = '#3a2b72';
const INK = '#1e1b2e';
const MUTED = '#6b6880';
const LINE = '#d9d6e6';

export interface PriceData {
  job: { client_code: string; job_code: string; name: string; site_address?: string | null };
  customer: string | null;
  ruleName: string | null;
  breakdown: JobBreak;
  generatedAt: Date;
}

export function renderPricePdf(data: PriceData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${data.job.client_code}.${data.job.job_code} — price breakdown`, Author: 'ACE Group' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); });

  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;
  const b = data.breakdown;

  // header
  doc.rect(0, 0, doc.page.width, 84).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(`${data.job.client_code}.${data.job.job_code}`, M, 20);
  doc.font('Helvetica').fontSize(11).fillColor('#e8e5f5').text(data.job.name || '', M, 46, { width: contentW - 180 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#fff').text('PRICE BREAKDOWN', right - 180, 24, { width: 180, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#e8e5f5').text(data.generatedAt.toLocaleDateString('en-GB'), right - 180, 44, { width: 180, align: 'right' });
  doc.y = 100; doc.fillColor(INK);

  if (data.job.site_address) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(data.job.site_address, M, doc.y);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Customer: ${data.customer || '—'}     Pricing: ${data.ruleName || '—'}`, M, doc.y + (data.job.site_address ? 4 : 0));
  doc.moveDown(0.5);

  // grand total, prominent
  doc.font('Helvetica-Bold').fontSize(15).fillColor(PRIMARY).text(`Customer price: ${formatPennies(b.saleTotal)}`, M, doc.y);
  doc.moveDown(0.5);
  doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.5);

  // per-flat table
  const cols = [
    { t: 'Flat', w: 0.16, a: 'left' as const },
    { t: 'Windows', w: 0.14, a: 'right' as const },
    { t: 'Base', w: 0.18, a: 'right' as const },
    { t: 'Extra (biggest)', w: 0.18, a: 'right' as const },
    { t: 'Extra £', w: 0.16, a: 'right' as const },
    { t: 'Flat total', w: 0.18, a: 'right' as const },
  ];
  const xs: number[] = []; let cx = M; for (const c of cols) { xs.push(cx); cx += c.w * contentW; }
  const rowH = 18;
  const header = () => {
    const hy = doc.y;
    doc.rect(M, hy, contentW, rowH).fill('#efeaf9');
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + 4, hy + 5, { width: c.w * contentW - 8, align: c.a, lineBreak: false }));
    doc.y = hy + rowH; doc.font('Helvetica').fontSize(9).fillColor(INK);
  };
  const line = (cells: string[], bold = false, tint?: string) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); header(); }
    const y = doc.y;
    if (tint) { doc.rect(M, y, contentW, rowH).fill(tint); doc.fillColor(INK); }
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK);
    cols.forEach((c, i) => doc.text(cells[i] ?? '', xs[i] + 4, y + 5, { width: c.w * contentW - 8, align: c.a, lineBreak: false }));
    doc.y = y + rowH;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  };

  // A summary row whose label spans the first five columns (so long text stays on one line).
  const sumLine = (label: string, amount: string) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); header(); }
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(label, xs[0] + 4, y + 5, { width: xs[5] - xs[0] - 8, lineBreak: false, ellipsis: true });
    doc.text(amount, xs[5] + 4, y + 5, { width: cols[5].w * contentW - 8, align: 'right', lineBreak: false });
    doc.y = y + rowH;
    doc.moveTo(M, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  };

  header();
  b.flats.forEach((f, i) => line([
    f.flat, String(f.windows), formatPennies(f.base),
    f.extraWindows ? `${f.extraWindows} · ${f.extraM2} m²` : '—',
    f.extraAmount ? formatPennies(f.extraAmount) : '—',
    formatPennies(f.total),
  ], false, i % 2 ? '#faf9fd' : undefined));

  if (b.doors.count) sumLine(`Doors × ${b.doors.count}`, formatPennies(b.doors.amount));
  if (b.communal.windows) sumLine(`Communal windows × ${b.communal.windows}  (${b.communal.m2} m²)`, formatPennies(b.communal.amount));
  for (const v of b.variations) sumLine(`Variation ${v.code ?? ''}`.trim(), formatPennies(v.amount));

  // grand total row
  const gy = doc.y;
  doc.rect(M, gy, contentW, rowH + 2).fill(PRIMARY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
  doc.text('Customer price (total)', xs[0] + 4, gy + 5, { width: cols.slice(0, 5).reduce((s, c) => s + c.w, 0) * contentW - 8, lineBreak: false });
  doc.text(formatPennies(b.saleTotal), xs[5] + 4, gy + 5, { width: cols[5].w * contentW - 8, align: 'right', lineBreak: false });
  doc.y = gy + rowH + 2;
  doc.fillColor(INK);

  doc.moveDown(1);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
    .text('Prices exclude VAT unless stated. Snags are excluded from this breakdown; variations are billed at the agreed amounts shown.', M, doc.y, { width: contentW });

  // footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${data.job.client_code}.${data.job.job_code} · price breakdown · ${data.generatedAt.toLocaleDateString('en-GB')} · page ${i + 1} of ${range.count}`,
        M, doc.page.height - 28, { width: contentW, align: 'center' });
  }

  doc.end();
  return done;
}

export async function buildJobPricePdf(clientCode: string, jobCode: string, tenantId: string): Promise<{ buffer: Buffer; job: any } | null> {
  const job = await getJobByCode(clientCode, jobCode);
  if (job.tenant_id !== tenantId) throw new Error('forbidden');
  const ruleId = await getJobRuleId(job.id);
  const rule = ruleId ? await getPricingRule(ruleId, tenantId) : null;
  if (!rule || !(rule.params as any)?.sale) return null;  // no rule assigned -> nothing to export
  const items = await listSurveyItems(job.id);
  const ipMap = new Map((await listItemPricing(items.map((i) => i.id))).map((r) => [r.item_id, r]));
  const priceItems: PriceItem[] = items.map((it: any) => {
    const f = ipMap.get(it.id);
    return {
      id: it.id, full_code: it.full_code, kind: it.kind,
      category: classifyCategory({ item_type: it.item_type, item_code: it.item_code }),
      width_mm: it.width_mm, height_mm: it.height_mm, flat: it.flat,
      is_variation: !!f?.is_variation, variation_amount: f?.variation_amount_pennies ?? 0,
    };
  });
  const breakdown = priceJob(priceItems, rule as any);
  const buffer = await renderPricePdf({
    job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: (job as any).site_address },
    customer: (rule as any).customer ?? null, ruleName: rule.name, breakdown, generatedAt: new Date(),
  });
  return { buffer, job };
}
