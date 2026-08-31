// Per-job PDF report — survey sheet or install report.
//
// Two entry points:
//   renderReportPdf(data)     — pure drawing (no DB); easy to unit-test.
//   buildJobReportPdf(...)    — fetches a job's items/teams/plans/photos, then renders.
//
// The office server streams this at GET /api/job/:code/report.pdf?type=survey|install.
import PDFDocument from 'pdfkit';
import {
  getJobByCode, listSurveyItems, listTeams, listJobPlans, downloadPlan,
  listItemPhotos, downloadPhoto,
} from './store';
import { effectiveRatePennies, formatPennies } from '@ace/shared';

export type ReportType = 'survey' | 'install' | 'customer_install';

export interface ReportPin { x: number; y: number; label: string; status: string | null; code?: string | null }
export interface ReportPlan { name: string; bytes: Buffer; pins: ReportPin[] }
export interface ReportPhotoGroup { label: string; images: Buffer[] }
export interface ReportData {
  type: ReportType;
  job: { client_code: string; job_code: string; name: string; site_address?: string | null; monday_board_id?: string | null };
  items: any[];            // survey_items rows (parents + snags)
  teams: any[];            // fitter_teams rows
  plans: ReportPlan[];
  photos: ReportPhotoGroup[];
  generatedAt: Date;
}

// ---- brand + status colours (mirror of the office UI) ----
const PRIMARY = '#3a2b72';
const MAGENTA = '#e6187e';
const INK = '#1e1b2e';
const MUTED = '#6b6880';
const LINE = '#d9d6e6';

function statusColor(s: string | null): string {
  if (s === 'installed_no_snag') return '#16a34a';
  if (s === 'snag' || s === 'installed_snag' || s === 'misfit') return MAGENTA;
  if (s) return '#d97706';
  return '#8b88a3';
}
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', installed_no_snag: 'Installed', installed_snag: 'Installed + snag',
  snag: 'Snag', misfit: 'MisFit', delayed: 'Delayed',
};
const dim = (it: any) => (it.width_mm || it.height_mm) ? `${it.width_mm ?? '—'} × ${it.height_mm ?? '—'}` : '—';
const s = (v: unknown) => (v == null || v === '') ? '—' : String(v);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'YYYY-MM-DD' -> '25 Aug' (or '—').
const shortDate = (iso: string | null | undefined) => {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : '—';
};

/** Draw a job report to a PDF and resolve the finished bytes. Pure — no I/O beyond pdfkit. */
export function renderReportPdf(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4', margin: 40,
    info: {
      Title: `${data.job.client_code}.${data.job.job_code} — ${data.type === 'survey' ? 'Survey' : 'Install'} report`,
      Author: 'ACE Field',
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - M;

  const parents = data.items.filter((i) => (i.kind ?? 'item') !== 'snag');
  const snags = data.items.filter((i) => (i.kind ?? 'item') === 'snag');

  // Pins get a running number across all plans; the same number appears in the "#"
  // column of the items table so the reader can match a pin to its row.
  let pinCounter = 0;
  const pinNoByCode = new Map<string, number[]>();

  // ---------- header band ----------
  doc.rect(0, 0, doc.page.width, 84).fill(PRIMARY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(`${data.job.client_code}.${data.job.job_code}`, M, 20);
  doc.font('Helvetica').fontSize(11).fillColor('#e8e5f5')
    .text(data.job.name || '', M, 46, { width: contentW - 170 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
    .text(data.type === 'survey' ? 'SURVEY REPORT' : 'INSTALL REPORT', right - 170, 24, { width: 170, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#e8e5f5')
    .text(data.generatedAt.toLocaleString('en-GB'), right - 170, 44, { width: 170, align: 'right' });
  doc.y = 100;
  doc.fillColor(INK);

  // ---------- summary ----------
  if (data.job.site_address) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(data.job.site_address, M, doc.y);
  }
  // 'customer_install' is the install report WITHOUT any rates/labour (safe to send a customer).
  const isInstall = data.type !== 'survey';
  const hideRates = data.type === 'customer_install';

  const counts: Record<string, number> = {};
  let labour = 0;
  for (const it of data.items) {
    const st = it.install_status || 'unset';
    counts[st] = (counts[st] ?? 0) + 1;
    const rate = effectiveRatePennies(it, data.teams as any);
    if (rate != null) labour += rate;
  }
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
    .text(`${parents.length} item${parents.length === 1 ? '' : 's'}`
      + (snags.length ? `  ·  ${snags.length} snag${snags.length === 1 ? '' : 's'}` : '')
      + (hideRates ? '' : `  ·  labour ${formatPennies(labour)}`), M, doc.y);
  if (isInstall) {
    const chips = Object.entries(counts)
      .filter(([k]) => k !== 'unset')
      .map(([k, v]) => `${v} ${STATUS_LABEL[k] ?? k}`).join('   ');
    if (chips) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(chips, { width: contentW });
    // planned-install date range across items (dates are pulled from Monday).
    const dates = parents.map((it: any) => it.planned_install_date).filter(Boolean).sort();
    const unscheduled = parents.filter((it: any) => !it.planned_install_date).length;
    if (dates.length) {
      const range = dates[0] === dates[dates.length - 1] ? shortDate(dates[0]) : `${shortDate(dates[0])} – ${shortDate(dates[dates.length - 1])}`;
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
        .text(`Scheduled ${range}${unscheduled ? `   ·   ${unscheduled} not scheduled` : ''}`, { width: contentW });
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('No install dates scheduled yet (pull them from Monday).', { width: contentW });
    }
  }
  doc.moveDown(0.6);
  hr(doc, M, right);

  // ---------- plans ----------
  for (const plan of data.plans) {
    ensureSpace(doc, 260);
    heading(doc, `Plan — ${plan.name}`, M);
    try {
      const img = (doc as any).openImage(plan.bytes);
      const maxW = contentW, maxH = 360;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale, h = img.height * scale;
      const x0 = M, y0 = doc.y;
      doc.image(img, x0, y0, { width: w, height: h });
      doc.rect(x0, y0, w, h).strokeColor(LINE).lineWidth(0.8).stroke();
      // pins — number them continuously across plans; remember the number for the table.
      plan.pins.forEach((pin) => {
        const n = ++pinCounter;
        if (pin.code) { const arr = pinNoByCode.get(pin.code) ?? []; arr.push(n); pinNoByCode.set(pin.code, arr); }
        const px = x0 + pin.x * w, py = y0 + pin.y * h;
        doc.circle(px, py, 9).fill(statusColor(pin.status));
        doc.circle(px, py, 9).lineWidth(1).strokeColor('#ffffff').stroke();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
          .text(String(n), px - 9, py - 4, { width: 18, align: 'center' });
        doc.fillColor(INK);
      });
      doc.y = y0 + h + 8;
      if (plan.pins.length) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
          .text('Numbered pins match the # column in the items table below.', M, doc.y, { width: contentW });
      }
    } catch {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED).text('(plan image could not be embedded)', M, doc.y);
    }
    doc.moveDown(0.6);
    doc.fillColor(INK);
  }

  // ---------- items table ----------
  ensureSpace(doc, 120);
  heading(doc, data.type === 'survey' ? 'Items & specification' : 'Items & install status', M);

  const cols = data.type === 'survey'
    ? [
        { k: 'pin', t: '#', w: 0.05 },
        { k: 'code', t: 'Code', w: 0.28 },
        { k: 'room', t: 'Room / Item', w: 0.12 },
        { k: 'type', t: 'Type', w: 0.14 },
        { k: 'size', t: 'W × H (mm)', w: 0.13 },
        { k: 'glass', t: 'Glass', w: 0.14 },
        { k: 'design', t: 'Design', w: 0.14 },
      ]
    : hideRates
      ? [ // customer install — no team/rate columns
          { k: 'pin', t: '#', w: 0.05 },
          { k: 'code', t: 'Code', w: 0.34 },
          { k: 'room', t: 'Room / Item', w: 0.15 },
          { k: 'type', t: 'Type', w: 0.16 },
          { k: 'sched', t: 'Scheduled', w: 0.13 },
          { k: 'status', t: 'Install', w: 0.17 },
        ]
      : [
          { k: 'pin', t: '#', w: 0.05 },
          { k: 'code', t: 'Code', w: 0.27 },
          { k: 'room', t: 'Room / Item', w: 0.11 },
          { k: 'type', t: 'Type', w: 0.11 },
          { k: 'sched', t: 'Scheduled', w: 0.11 },
          { k: 'team', t: 'Team', w: 0.10 },
          { k: 'rate', t: 'Rate', w: 0.08 },
          { k: 'status', t: 'Install', w: 0.17 },
        ];
  const teamName = (id: string | null) => data.teams.find((t) => t.id === id)?.name ?? '—';
  const rowsData = parents.map((it) => ({
    pin: (pinNoByCode.get(it.full_code) ?? []).join(', ') || '—',
    code: s(it.full_code), room: `${s(it.room_code)} / ${s(it.item_code)}`,
    type: s(it.item_type || it.material), size: dim(it), glass: s(it.glass), design: s(it.design_code),
    team: teamName(it.team_id), rate: formatPennies(effectiveRatePennies(it, data.teams as any)),
    sched: shortDate(it.planned_install_date),
    status: STATUS_LABEL[it.install_status] ?? s(it.install_status),
    _statusRaw: it.install_status ?? null,
  }));
  table(doc, M, contentW, cols, rowsData);

  // ---------- snags ----------
  if (snags.length) {
    ensureSpace(doc, 90);
    heading(doc, `Snags (${snags.length})`, M);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    for (const sn of snags) {
      ensureSpace(doc, 34);
      const dot = statusColor(sn.install_status ?? 'snag');
      doc.circle(M + 3, doc.y + 5, 3).fill(dot); doc.fillColor(INK);
      doc.font('Helvetica-Bold').fontSize(9.5).text(s(sn.full_code), M + 12, doc.y, { continued: true })
        .font('Helvetica').fillColor(MUTED).text('   ' + (STATUS_LABEL[sn.install_status] ?? s(sn.install_status)));
      doc.fillColor(INK).font('Helvetica').fontSize(9.5)
        .text(s(sn.snag_comment || sn.comments), M + 12, doc.y, { width: contentW - 12 });
      doc.moveDown(0.5);
    }
  }

  // ---------- photo appendix ----------
  if (data.photos.length) {
    doc.addPage();
    heading(doc, data.type === 'survey' ? 'Survey photos' : 'Install photos', M);
    for (const grp of data.photos) {
      if (!grp.images.length) continue;
      ensureSpace(doc, 150);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(grp.label, M, doc.y);
      doc.moveDown(0.2);
      const gap = 8, per = 4, cellW = (contentW - gap * (per - 1)) / per, cellH = cellW * 0.75;
      let x = M, y = doc.y, col = 0;
      for (const buf of grp.images) {
        if (col === per) { col = 0; x = M; y += cellH + gap; }
        if (y + cellH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.y; x = M; col = 0; }
        try {
          doc.image(buf, x, y, { fit: [cellW, cellH], align: 'center', valign: 'center' });
          doc.rect(x, y, cellW, cellH).strokeColor(LINE).lineWidth(0.6).stroke();
        } catch { /* skip unreadable image */ }
        x += cellW + gap; col++;
      }
      doc.y = y + cellH + 14;
    }
  }

  // ---------- footer on every page ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${data.job.client_code}.${data.job.job_code} · ${data.type === 'survey' ? 'Survey' : 'Install'} report · page ${i + 1} of ${range.count}`,
        M, doc.page.height - 28, { width: contentW, align: 'center' });
  }

  doc.end();
  return done;
}

// ---- small layout helpers ----
function hr(doc: any, x0: number, x1: number) {
  doc.moveTo(x0, doc.y).lineTo(x1, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.5);
}
function heading(doc: any, text: string, x: number) {
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(PRIMARY).text(text, x, doc.y);
  doc.moveDown(0.3);
  doc.fillColor(INK);
}
function ensureSpace(doc: any, need: number) {
  if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage();
}
function table(doc: any, x: number, width: number, cols: { k: string; t: string; w: number }[], rows: any[]) {
  const pad = 4, minRowH = 18;
  const widths = cols.map((c) => c.w * width);
  const xs: number[] = []; let cx = x; for (const w of widths) { xs.push(cx); cx += w; }
  const codeIdx = cols.findIndex((c) => c.k === 'code');
  const drawHeader = () => {
    const hy = doc.y;
    doc.rect(x, hy, width, minRowH).fill('#efeaf9');
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(8.5);
    cols.forEach((c, i) => doc.text(c.t, xs[i] + pad, hy + 5, { width: widths[i] - pad * 2, ellipsis: true, lineBreak: false }));
    doc.y = hy + minRowH;
    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  };
  drawHeader();
  rows.forEach((r, ri) => {
    // Row height grows so the full Code (which may wrap to 2 lines) always shows in full.
    doc.font('Helvetica').fontSize(8.5);
    let rowH = minRowH;
    if (codeIdx >= 0) {
      const ch = doc.heightOfString(String(r.code ?? ''), { width: widths[codeIdx] - pad * 2 });
      rowH = Math.max(minRowH, Math.ceil(ch) + 8);
    }
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    if (ri % 2 === 1) doc.rect(x, doc.y, width, rowH).fill('#faf9fd').fillColor(INK);
    const y = doc.y;
    cols.forEach((c, i) => {
      if (c.k === 'status' && r._statusRaw !== undefined) {
        doc.circle(xs[i] + pad + 3, y + 9, 3).fill(statusColor(r._statusRaw)); doc.fillColor(INK);
        doc.font('Helvetica').fontSize(8.5).text(String(r[c.k] ?? ''), xs[i] + pad + 10, y + 5, { width: widths[i] - pad * 2 - 10, ellipsis: true, lineBreak: false });
      } else if (c.k === 'code') {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(String(r[c.k] ?? ''), xs[i] + pad, y + 5, { width: widths[i] - pad * 2, lineBreak: true });
      } else {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(String(r[c.k] ?? ''), xs[i] + pad, y + 5, { width: widths[i] - pad * 2, ellipsis: true, lineBreak: false });
      }
    });
    doc.y = y + rowH;
    doc.moveTo(x, doc.y).lineTo(x + width, doc.y).strokeColor(LINE).lineWidth(0.4).stroke();
  });
  doc.moveDown(0.4);
}

// ---- fetch a job's data, then render ----
export async function buildJobReportPdf(clientCode: string, jobCode: string, tenantId: string, type: ReportType): Promise<{ buffer: Buffer; job: any }> {
  const job = await getJobByCode(clientCode, jobCode);
  if (job.tenant_id !== tenantId) throw new Error('forbidden');
  const items = await listSurveyItems(job.id);
  const teams = await listTeams(tenantId);

  // plans + their pins — only this job's plans (belt-and-braces: never another job's)
  const jobPlans = (await listJobPlans(job.id)).filter((pl: any) => pl.job_id === job.id);
  const plans: ReportPlan[] = [];
  for (const pl of jobPlans) {
    let bytes: Buffer;
    try { bytes = Buffer.from(await downloadPlan(pl.storage_path)); } catch { continue; }
    const pins: ReportPin[] = items
      .filter((it: any) => it.plan_id === pl.id && it.plan_x != null && it.plan_y != null)
      .map((it: any) => ({ x: it.plan_x, y: it.plan_y, label: it.item_code || it.full_code || '', code: it.full_code ?? null, status: it.install_status ?? null }));
    plans.push({ name: pl.name, bytes, pins });
  }

  // photos (capped): survey → reference/survey/sketch; install → install/sketch
  const wantKinds = type === 'survey' ? new Set(['reference', 'survey', 'sketch']) : new Set(['install', 'sketch']);
  const PER_ITEM = 4, MAX_ITEMS = 40;
  const photos: ReportPhotoGroup[] = [];
  let used = 0;
  for (const it of items) {
    if (used >= MAX_ITEMS) break;
    let rows;
    try { rows = await listItemPhotos(it.id); } catch { continue; }
    const pick = rows.filter((r: any) => wantKinds.has(r.kind)).slice(0, PER_ITEM);
    if (!pick.length) continue;
    const images: Buffer[] = [];
    for (const r of pick) {
      try { images.push(Buffer.from(await downloadPhoto((r as any).storage_path))); } catch { /* skip */ }
    }
    if (images.length) { photos.push({ label: it.full_code || it.item_code || 'item', images }); used++; }
  }

  const buffer = await renderReportPdf({
    type,
    job: { client_code: job.client_code, job_code: job.job_code, name: job.name, site_address: (job as any).site_address, monday_board_id: job.monday_board_id },
    items, teams, plans, photos, generatedAt: new Date(),
  });
  return { buffer, job };
}
