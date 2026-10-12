// Installation calendar PDF for a job — the wall-calendar layout the fitters' calendars have always
// had (one page per month, each planned day listing its flats), followed by a day-by-day list.
// Pure drawing: no database. Served at GET /api/job/:ref/install-calendar.pdf.
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanDay } from './installPlan';

const LOGO = join(dirname(fileURLToPath(import.meta.url)), '../assets/calendar/acemark-logo.png');

export interface CalendarPdfData {
  job: { code: string; name: string };
  days: PlanDay[];                 // one entry per date + team, flats listed
  totalFlats: number;              // flats (and communal groups) on the job
  scheduledFlats: number;
  scheduledItems: number;
  unscheduledItems: number;        // open items with no planned date
  generatedAt: Date;
  generatedBy?: string | null;
}

const NAVY = '#1b2a52', INK = '#2a3350', MUTED = '#5b667f', FAINT = '#9aa3b5';
const CELL = '#f6f7f9', CELL_WE = '#eff0f3', CELL_LINE = '#cfd6e2', PLAN = '#eaf0ff', PLAN_LINE = '#2f6bed', GREEN = '#1c8a4a', AMBER = '#b45309';
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortTeam = (name: string) => name.replace(/^team\s+/i, '').trim() || name;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const longDate = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${WD[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`; };

export function renderInstallCalendarPdf(data: CalendarPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 26, autoFirstPage: false,
    info: { Title: `${data.job.name || data.job.code} — Installation Calendar`, Author: 'ACE Office' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  let logo: Buffer | null = null; try { logo = readFileSync(LOGO); } catch { /* no watermark */ }
  // Footers sit below the bottom margin; without this pdfkit would start a new page for each of them.
  doc.on('pageAdded', () => { doc.page.margins.bottom = 0; });

  const byDate = new Map<string, PlanDay[]>();
  for (const d of data.days) (byDate.get(d.date) ?? byDate.set(d.date, []).get(d.date)!).push(d);
  const dates = [...byDate.keys()].sort();
  const teams = [...new Set(data.days.map((d) => d.team))];
  const manyTeams = teams.length > 1;
  const teamsLabel = teams.length ? `Team${teams.length === 1 ? '' : 's'} ${teams.map(shortTeam).join(teams.length === 2 ? ' & ' : ', ')}` : 'No team';
  const stamp = `Generated: ${data.generatedAt.toISOString().slice(0, 16).replace('T', '  ')} UTC${data.generatedBy ? '  ·  ' + data.generatedBy : ''}`;
  const title = `${data.job.name || data.job.code} — Installation Calendar`;

  const months: string[] = [];
  if (dates.length) {
    let [y, m] = dates[0].split('-').map(Number); const [ly, lm] = dates[dates.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } if (months.length > 24) break; }
  }

  const header = (sub: string) => {
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(19).text(title, L, 22, { width: W, align: 'center', lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(sub, L, 46, { width: W, align: 'center', lineBreak: false, ellipsis: true });
  };
  const footer = () => {
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right, y = doc.page.height - 60;
    const all = data.unscheduledItems === 0;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(all ? GREEN : AMBER)
      .text(all ? 'All open items have a planned date — fully scheduled.' : `${plural(data.unscheduledItems, 'open item')} still without a planned date.`, L, y, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`Flats on the job: ${data.totalFlats}   ·   Flats scheduled: ${data.scheduledFlats}   ·   Items scheduled: ${data.scheduledItems}   ·   Date range: ${dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '—'}`, L, y + 14, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(FAINT)
      .text(`Legend: blue cell = planned day  ·  labels are flat numbers${manyTeams ? ', grouped by team' : ''}.`, L, y + 28, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(FAINT).text(stamp, L, y + 28, { width: W, align: 'right', lineBreak: false });
  };
  const watermark = () => {
    if (!logo) return;
    const h = 330, w = h * (2218 / 2324);
    doc.save(); doc.opacity(0.1);
    try { doc.image(logo, (doc.page.width - w) / 2, (doc.page.height - h) / 2 + 6, { width: w, height: h }); } catch { /* unreadable logo: skip */ }
    doc.restore();
  };

  // ---------- one page per month ----------
  for (const ym of months.length ? months : [data.generatedAt.toISOString().slice(0, 7)]) {
    doc.addPage();
    const [y, m] = ym.split('-').map(Number);
    header(`Plan Install Date by Flat No.  ·  ${MONTHS[m - 1].slice(0, 3)} ${y}  ·  ${teamsLabel}  ·  ${data.job.code}`);
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(`${MONTHS[m - 1]} ${y}`, L, 62, { width: W, align: 'center', lineBreak: false });

    const first = new Date(Date.UTC(y, m - 1, 1)), lead = (first.getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const rows = Math.ceil((lead + dim) / 7);
    const gridTop = 98, gridBottom = doc.page.height - 70, gap = 5;
    const cw = (W - gap * 6) / 7, ch = (gridBottom - gridTop - gap * (rows - 1)) / rows;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED);
    WD.forEach((w, i) => doc.text(w, L + i * (cw + gap), 82, { width: cw, align: 'center', lineBreak: false }));

    for (let day = 1; day <= dim; day++) {
      const idx = lead + day - 1, col = idx % 7, row = Math.floor(idx / 7);
      const x = L + col * (cw + gap), yy = gridTop + row * (ch + gap);
      const iso = `${ym}-${String(day).padStart(2, '0')}`, list = byDate.get(iso) ?? [];
      const planned = list.length > 0;
      doc.roundedRect(x, yy, cw, ch, 5).fillAndStroke(planned ? PLAN : (col >= 5 ? CELL_WE : CELL), planned ? PLAN_LINE : CELL_LINE);
      doc.lineWidth(planned ? 1.4 : 0.7).roundedRect(x, yy, cw, ch, 5).stroke(planned ? PLAN_LINE : CELL_LINE).lineWidth(1);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(planned ? NAVY : FAINT).text(String(day), x + 6, yy + 5, { lineBreak: false });
      if (!planned) continue;

      const flats = new Set<string>(); let items = 0;
      for (const d of list) { d.flats.forEach((f) => flats.add(d.team_id + '|' + f)); items += d.items; }
      const lines = list.map((d) => (manyTeams ? shortTeam(d.team) + ': ' : '') + d.flats.join(', '));
      const text = lines.join('\n'), boxW = cw - 10, boxTop = yy + 17, boxH = ch - 17 - 20;
      let size = 11; doc.font('Helvetica-Bold');
      while (size > 5 && doc.fontSize(size).heightOfString(text, { width: boxW, align: 'center', lineGap: 0.5 }) > boxH) size -= 0.5;
      const th = Math.min(boxH, doc.fontSize(size).heightOfString(text, { width: boxW, align: 'center', lineGap: 0.5 }));
      doc.fillColor(NAVY).text(text, x + 5, boxTop + Math.max(0, (boxH - th) / 2), { width: boxW, height: boxH, align: 'center', lineGap: 0.5, ellipsis: true });
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(MUTED)
        .text(`${plural(flats.size, 'flat')}  ·  ${plural(items, 'item')}`, x + 4, yy + ch - 13, { width: cw - 8, align: 'center', lineBreak: false });
    }
    watermark();
    footer();
  }

  // ---------- day-by-day list ----------
  if (data.days.length) {
    const cols = [{ t: 'Date', w: 120 }, { t: 'Team', w: 110 }, { t: 'Flats', w: 0 }, { t: 'Flats', w: 50, n: true }, { t: 'Items', w: 50, n: true }];
    let y = 0;
    const startPage = () => {
      doc.addPage(); header(`Day-by-day schedule  ·  ${teamsLabel}  ·  ${data.job.code}`);
      const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
      cols[2].w = W - cols[0].w - cols[1].w - cols[3].w - cols[4].w;
      y = 72; doc.rect(L, y, W, 18).fill(NAVY);
      let x = L; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
      cols.forEach((c, i) => { doc.text(i === 3 ? 'Flats' : c.t, x + 6, y + 5, { width: c.w - 12, align: (c as any).n ? 'right' : 'left', lineBreak: false }); x += c.w; });
      y += 18;
    };
    startPage();
    let prev = '';
    for (const d of data.days) {
      const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
      const flatsText = d.flats.join(', ');
      const h = Math.max(16, doc.font('Helvetica').fontSize(8.5).heightOfString(flatsText, { width: cols[2].w - 12 }) + 7);
      if (y + h > doc.page.height - 44) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(FAINT).text(stamp, L, doc.page.height - 34, { width: W, align: 'right', lineBreak: false }); startPage(); prev = ''; }
      if (d.date !== prev && prev) doc.moveTo(L, y).lineTo(L + W, y).strokeColor(CELL_LINE).lineWidth(0.8).stroke();
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(d.date !== prev ? longDate(d.date) : '', x + 6, y + 4, { width: cols[0].w - 12, lineBreak: false }); x += cols[0].w;
      doc.font('Helvetica').fillColor(INK).text(d.team, x + 6, y + 4, { width: cols[1].w - 12, lineBreak: false, ellipsis: true }); x += cols[1].w;
      doc.text(flatsText, x + 6, y + 4, { width: cols[2].w - 12 }); x += cols[2].w;
      doc.text(String(d.flats.length), x + 6, y + 4, { width: cols[3].w - 12, align: 'right', lineBreak: false }); x += cols[3].w;
      doc.text(String(d.items), x + 6, y + 4, { width: cols[4].w - 12, align: 'right', lineBreak: false });
      y += h; prev = d.date;
    }
    const L = doc.page.margins.left, W = doc.page.width - L - doc.page.margins.right;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor(NAVY).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(`${plural(dates.length, 'working day')}  ·  ${plural(data.scheduledItems, 'item')}`, L + 6, y + 6, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(FAINT).text(stamp, L, doc.page.height - 34, { width: W, align: 'right', lineBreak: false });
  }

  doc.end();
  return done;
}
