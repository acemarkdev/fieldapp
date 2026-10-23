// Window/door labels (Logistics ▸ Labels): read a production printout and print an A4 sheet of 2 × 4
// labels (each 103 × 72 mm, the block centred on the page), each piece's label repeated `copies` times.
//   · WEM: an Archimede "WYDRUK PRODUKCYJNY" PDF, WEM company details (and logo);
//   · Acemark: a CortizoCad "PRODUCTION LIST" (LP 0004/10/2026) PDF, Acemark company details
//     (the layout of "WZÓR etykiet - druk Acemark").
// Either can be printed anonymous (no company details).
//
// The Archimede printout is a real text PDF, so this is a deterministic parse (no AI): text items
// are regrouped into lines by position, then read with the section markers the printout always has
// ("Poz.: N Szt.: M", "Konfiguracja ramy:", "Rama <w> X <h>", "NOTATKA:", "SZYBA / PANEL").
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocumentProxy } from 'unpdf';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '../assets/labels');

export interface LabelPosition {
  poz: number;
  qty: number;
  config: string;
  w: number | null;        // outer frame width (Rama, Zew.wymiar)
  h: number | null;        // outer frame height
  note: string;
  refs: string[];          // window/door references at the start of the note, e.g. W02.1, W03.1
}
export interface LabelSpec { format: 'archimede' | 'cortizo'; order: string; date: string; job: string; client: string; positions: LabelPosition[]; warnings: string[]; }

// ---- PDF → text lines -------------------------------------------------------------------------
export async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const out: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    const items = (tc.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; items: typeof items }[] = [];
    for (const it of items) {
      const r = rows.find((row) => Math.abs(row.y - it.y) < 3);
      if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = '', end: number | null = null;
      for (const it of r.items) {
        if (end !== null) { const gap = it.x - end; line += gap > 12 ? '   ' : gap > 1.5 ? ' ' : ''; }
        line += it.s; end = it.x + it.w;
      }
      out.push(line.trimEnd());
    }
  }
  return out;
}

// ---- text lines → positions -------------------------------------------------------------------
const REF = /^[A-Z]{1,3}\d+[A-Z]?(?:\.\d+)?$/i;

export function parseArchimede(lines: string[]): LabelSpec {
  const top = lines.slice(0, 8);
  const orderLine = top.find((t) => /Z\.\d+\.\d{4}/.test(t)) ?? '';
  const order = orderLine.match(/Z\.\d+\.\d{4}/)?.[0] ?? '';
  const job = orderLine.slice(orderLine.indexOf(order) + order.length).trim();
  const date = top.join(' ').match(/\d{2}\.\d{2}\.\d{4}/)?.[0] ?? '';
  const client = (top.find((t) => /KLIENT:/.test(t)) ?? '').replace(/.*KLIENT:\s*/, '').split(/\s{3,}/)[0].trim();

  const positions: (LabelPosition & { _config: string[]; _note: string[] })[] = [];
  let cur: (typeof positions)[number] | null = null;
  let mode: '' | 'config' | 'note' = '';
  for (const t of lines) {
    const m = t.match(/Poz\.:\s*(\d+)\s+Szt\.:\s*(\d+)/);
    if (m) { cur = { poz: +m[1], qty: +m[2], config: '', w: null, h: null, note: '', refs: [], _config: [], _note: [] }; positions.push(cur); mode = ''; continue; }
    if (!cur) continue;
    if (/Konfiguracja ramy:/.test(t)) { mode = 'config'; continue; }
    if (/^\s*MALOWANIE:/.test(t) || /SZYBA \/ PANEL/.test(t)) { mode = ''; continue; }
    if (/^\s*NOTATKA:/.test(t)) { mode = 'note'; continue; }
    const f = t.match(/^\s*Rama\s+(\d+)\s*X\s*(\d+)/);
    if (f && cur.w === null) { cur.w = +f[1]; cur.h = +f[2]; }
    if (mode === 'config') { const c = t.replace(/WIDOK OD ZEWN\S*/, '').trim(); if (c) cur._config.push(c); }
    if (mode === 'note') cur._note.push(t.trim());
  }

  const warnings: string[] = [];
  const clean: LabelPosition[] = positions.map(({ _config, _note, ...p }) => {
    p.config = _config.join(' ');
    p.note = _note.join(' ');
    for (const tok of p.note.split(/[,\s]+/)) { if (REF.test(tok)) p.refs.push(tok.toUpperCase()); else break; }
    if (p.w === null) warnings.push(`Poz. ${p.poz}: frame size (Rama) not found — enter it by hand.`);
    if (p.refs.length !== p.qty) warnings.push(`Poz. ${p.poz}: ${p.refs.length} reference(s) in the note for ${p.qty} piece(s) — check the references.`);
    return p;
  });
  if (!clean.length) warnings.push('No positions ("Poz.: … Szt.: …") found — is this an Archimede “WYDRUK PRODUKCYJNY” PDF (not a scan)?');
  return { format: 'archimede', order, date, job, client, positions: clean, warnings };
}

// ---- CortizoCad "PRODUCTION LIST" (Acemark) ----------------------------------------------------
// Header: "LP 0078/10/2026   OK PL203101 …", "Created: 19.10.2026 …", "Client: Perfect Crystal Windows Ltd   …".
// Each position: "Quantity:   1" then "Pos. 2 Cor Vision - szyna pojedyncza (B=1 980, H=1 925)" — the bracket
// may wrap to a following line ("(B=3 510," … "H=2 700)"). The order name is in every page footer:
// "OK PL203101 -PCW- J034964P update 28092026 TH AM (1)   1 (13)   19.10.2026".
export const isCortizoList = (lines: string[]) => lines.slice(0, 12).some((t) => /PRODUCTION LIST NO|^LP \d{4}\/\d{2}\/\d{4}/.test(t));
export function parseCortizoList(lines: string[]): LabelSpec {
  const lp = lines.join('\n').match(/LP \d{4}\/\d{2}\/\d{4}/)?.[0] ?? '';
  const footer = lines.map((t) => /^(.*?)\s+\(\d+\)\s+\d+\s*\(\d+\)\s+\d{2}\.\d{2}\.\d{4}\s*$/.exec(t)).find(Boolean);
  const job = (footer?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const date = (lines.find((t) => /Created:/.test(t)) ?? '').match(/\d{2}\.\d{2}\.\d{4}/)?.[0] ?? '';
  const client = (lines.find((t) => /^Client:/.test(t)) ?? '').replace(/^Client:\s*/, '').split(/\s{3,}/)[0].trim();
  const positions: LabelPosition[] = [], warnings: string[] = [];
  lines.forEach((t, i) => {
    const m = /^\s*Pos\.\s*(\d+)\s+(.*)$/.exec(t); if (!m) return;
    // the bracket with the sizes, joined over up to 4 lines (other columns' text in between is dropped)
    let txt = m[2].split(/\s{3,}/)[0];
    for (let k = 1; k <= 4 && !/H=\s*[\d ]+\)/.test(txt); k++) { const nx = lines[i + k] ?? ''; const part = /H=\s*[\d ]+\)/.exec(nx); if (part) txt += ' ' + part[0]; }
    const size = /\(B=\s*([\d ]+?)\s*,.*?H=\s*([\d ]+?)\s*\)/.exec(txt);
    const config = txt.replace(/\s*\(B=.*$/, '').trim();
    let qty = 1;
    for (let k = 1; k <= 4; k++) { const q = /Quantity:\s+(\d+)/.exec(lines[i - k] ?? '') ?? /Quantity:\s+(\d+)/.exec(lines[i + k] ?? ''); if (q) { qty = +q[1]; break; } }
    const w = size ? +size[1].replace(/\s/g, '') : null, h = size ? +size[2].replace(/\s/g, '') : null;
    if (w === null) warnings.push(`Pos. ${m[1]}: size (B=…, H=…) not found — enter it by hand.`);
    positions.push({ poz: +m[1], qty, config, w, h, note: '', refs: [] });
  });
  if (!positions.length) warnings.push('No positions ("Pos. N … (B=…, H=…)") found — is this a CortizoCad PRODUCTION LIST PDF (not a scan)?');
  return { format: 'cortizo', order: lp, date, job, client, positions, warnings };
}

export async function parseLabelPdf(bytes: Uint8Array): Promise<LabelSpec> {
  const lines = await pdfLines(bytes);
  return isCortizoList(lines) ? parseCortizoList(lines) : parseArchimede(lines);
}

// ---- labels → A4 PDF --------------------------------------------------------------------------
export interface LabelItem { w: number | string; h: number | string; ref: string; kind?: 'hardware'; }
// Each label is printed `copies` times in a row (default 2: the label and its copy side by side, one sheet row
// per piece). `skipRows` leaves already-used rows at the top of the sheet empty. `layout`: WEM or Acemark.
export type LabelLayout = 'wem' | 'acemark';
export interface LabelSheetOptions { title: string; labels: LabelItem[]; logo: boolean; company: boolean; skipRows?: number; phone?: string; copies?: number; layout?: LabelLayout; }
export const labelCopies = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 2; };

const MM = 72 / 25.4;
const PAGE_W = 210 * MM, PAGE_H = 297 * MM;
// The label stock: A4 cut into 2 × 4 labels of 103 × 72 mm. The 8 labels sit centred on the sheet
// (2 mm left/right, 4.5 mm top/bottom). Everything is drawn inside each label with a 5 mm safety
// margin and clipped to it, so a small feed offset in the printer cannot push print onto a neighbour.
export const LABEL_W_MM = 103, LABEL_H_MM = 72, SAFE_MM = 5;
const COLS = 2, ROWS = 4, CELL_W = LABEL_W_MM * MM, CELL_H = LABEL_H_MM * MM;
const OFF_X = (PAGE_W - COLS * CELL_W) / 2, OFF_Y = (PAGE_H - ROWS * CELL_H) / 2;
const PAD = SAFE_MM * MM;
const COMPANY = ['Ul. Koźmińska 10', '63-440 Raszków', 'NIP: PL6222839864', 'Email: biuro@wemokna.pl'];
const ACEMARK = ['Ul. Koźmińska 32', '63-714 Orpiszew', 'NIP: PL6211842704', 'Email: biuro@acemark.com.pl'];
/** The phone printed under the company details — a setting on the Labels page (config key label_phone). */
export const DEFAULT_LABEL_PHONE = '+48 510 744 727';
/** "510744727" / "+48510744727" / "0048 510 744 727" → "+48 510 744 727"; anything else is kept as typed. */
export function formatLabelPhone(v: unknown): string {
  const raw = String(v ?? '').trim(), d = raw.replace(/[^0-9+]/g, '').replace(/^00/, '+');
  const m = /^(?:\+?48)?(\d{9})$/.exec(d);
  return m ? `+48 ${m[1].slice(0, 3)} ${m[1].slice(3, 6)} ${m[1].slice(6)}` : raw.slice(0, 30);
}

export function buildLabelsPdf(opts: LabelSheetOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Etykiety — ' + (opts.title || '') } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(ASSETS, 'LiberationSerif-Regular.ttf'));
    doc.registerFont('B', join(ASSETS, 'LiberationSerif-Bold.ttf'));
    doc.registerFont('SR', join(ASSETS, 'LiberationSans-Regular.ttf'));
    doc.registerFont('SB', join(ASSETS, 'LiberationSans-Bold.ttf'));
    const acemark = opts.layout === 'acemark';
    const logo = opts.logo && !acemark ? readFileSync(join(ASSETS, 'wem-logo.jpg')) : null;
    const copies = labelCopies(opts.copies);

    const skipRows = Math.max(0, Math.min(ROWS - 1, Math.floor(opts.skipRows ?? 0)));
    const slots: (LabelItem | null)[] = [...Array(skipRows * COLS).fill(null), ...opts.labels.flatMap((l) => Array(copies).fill(l))];
    slots.forEach((lab, i) => {
      const k = i % (COLS * ROWS);
      if (k === 0) doc.addPage();
      if (!lab) return;
      const x0 = OFF_X + (k % COLS) * CELL_W, y0 = OFF_Y + Math.floor(k / COLS) * CELL_H;
      const header = !!logo || opts.company;
      const w = CELL_W - 2 * PAD, x = x0 + PAD, top = y0 + PAD, bottom = y0 + CELL_H - PAD;

      // Nothing may print outside this label's safe area.
      doc.save();
      doc.rect(x, top, w, bottom - top).clip();

      if (acemark) { drawAcemark(doc, lab, opts, x, top, w, bottom); doc.restore(); return; }
      if (logo) doc.image(logo, x, top, { fit: [15 * MM, 23 * MM] });
      if (opts.company) {
        const cx = x + (logo ? 19 * MM : 0), lh = 3.9 * MM;
        doc.font('B').fontSize(10).fillColor('#000').text('WEM Sp. z o.o.', cx, top, { lineBreak: false });
        const phone = formatLabelPhone(opts.phone ?? DEFAULT_LABEL_PHONE);
        [...COMPANY, ...(phone ? ['Tel. ' + phone] : [])].forEach((t, j) => doc.font('R').fontSize(9.5).text(t, cx, top + lh * (j + 1), { lineBreak: false }));
      }

      let y = y0 + (header ? 30 : 20) * MM;
      if (lab.kind === 'hardware') {
        doc.font('B').fontSize(28).fillColor('#000').text('HARDWARE', x, y + 2 * MM, { width: w, align: 'center', lineBreak: false });
        jobLine(doc, (opts.title || '').trim(), '', x, y + 15.5 * MM, w, bottom);
        doc.restore();
        return;
      }
      doc.font('R').fontSize(14).fillColor('#000').text('Wymiar Okna:', x, y, { width: w, align: 'center', lineBreak: false });
      y += 6.5 * MM;
      // the size line shrinks if a long dimension would not fit the label's width
      const sizeText = `P/N W${lab.w} x H${lab.h}`;
      let sizePt = 19; doc.font('B');
      while (sizePt > 10 && doc.fontSize(sizePt).widthOfString(sizeText) > w) sizePt -= 0.5;
      doc.fontSize(sizePt).text(sizeText, x, y, { width: w, align: 'center', lineBreak: false });
      y += 8.5 * MM;
      jobLine(doc, (opts.title || '').trim(), String(lab.ref || '').trim(), x, y, w, bottom);
      doc.restore();
    });
    if (!slots.length) doc.addPage();
    doc.end();
  });
}

// The Acemark label ("WZÓR etykiet - druk Acemark"): the company block (left of centre), "Wymiar okna:", the size
// in large bold (W655 x H392), then the order line centred and wrapped — all in a sans face.
function drawAcemark(doc: PDFKit.PDFDocument, lab: LabelItem, opts: LabelSheetOptions, x: number, top: number, w: number, bottom: number): void {
  let y = top;
  if (opts.company) {
    const cx = x + 12 * MM, lh = 3.7 * MM;
    doc.font('SB').fontSize(9.5).fillColor('#000').text('ACEMARK sp. z o.o.', cx, y, { lineBreak: false });
    ACEMARK.forEach((t, j) => doc.font('SR').fontSize(9).text(t, cx, y + lh * (j + 1), { lineBreak: false }));
    y += lh * 5 + 1.5 * MM;
  } else y += 17 * MM;   // anonymous: the size and order line in the middle of the label
  if (lab.kind === 'hardware') {
    doc.font('SB').fontSize(26).fillColor('#000').text('HARDWARE', x, y + 3 * MM, { width: w, align: 'center', lineBreak: false });
    jobLine(doc, (opts.title || '').trim(), '', x, y + 16 * MM, w, bottom, 'SR', 'SB');
    return;
  }
  doc.font('SR').fontSize(13).fillColor('#000').text('Wymiar okna:', x, y, { width: w, align: 'center', lineBreak: false });
  y += 6.5 * MM;
  const sizeText = `W${lab.w} x H${lab.h}`;
  let sizePt = 20; doc.font('SB');
  while (sizePt > 10 && doc.fontSize(sizePt).widthOfString(sizeText) > w) sizePt -= 0.5;
  doc.fontSize(sizePt).text(sizeText, x, y, { width: w, align: 'center', lineBreak: false });
  y += 9.5 * MM;
  jobLine(doc, (opts.title || '').trim(), String(lab.ref || '').trim(), x, y, w, bottom, 'SR', 'SB');
}

// "<title> – <REF>" centred and word-wrapped, with the reference in bold and never split.
// (pdfkit's own `continued` + center mis-positions mixed-font runs, so lay it out by hand.)
function jobLine(doc: PDFKit.PDFDocument, title: string, ref: string, x: number, y: number, w: number, maxY: number, R = 'R', B = 'B'): void {
  const SIZE = 12.5, LH = 5 * MM;
  const toks = [
    ...title.split(/\s+/).filter(Boolean).map((t) => ({ t, f: R })),
    ...(ref ? [{ t: '–', f: R }, { t: ref, f: B }] : []),
  ];
  doc.fontSize(SIZE);
  const width = (t: { t: string; f: string }) => doc.font(t.f).widthOfString(t.t);
  const space = doc.font(R).widthOfString(' ');
  const lines: { t: string; f: string }[][] = [];
  let line: { t: string; f: string }[] = [], lw = 0;
  for (const tk of toks) {
    const tw = width(tk);
    if (line.length && lw + space + tw > w) { lines.push(line); line = []; lw = 0; }
    lw += (line.length ? space : 0) + tw; line.push(tk);
  }
  if (line.length) lines.push(line);
  for (const ln of lines) {
    if (y + LH > maxY) break;
    const total = ln.reduce((s, tk, i) => s + width(tk) + (i ? space : 0), 0);
    let cx = x + Math.max(0, (w - total) / 2);
    ln.forEach((tk, i) => {
      if (i) cx += space;
      doc.font(tk.f).fontSize(SIZE).text(tk.t, cx, y, { lineBreak: false, width: Math.max(1, x + w - cx), ellipsis: true });
      cx += width(tk);
    });
    y += LH;
  }
}
