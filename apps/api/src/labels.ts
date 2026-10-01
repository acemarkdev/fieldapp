// Window/door labels (Logistics ▸ Labels): read an Archimede "WYDRUK PRODUKCYJNY" PDF and print
// an A4 sheet of 2 × 4 labels (105 × 74.25 mm) — one label per piece — in the WEM label format.
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
export interface LabelSpec { order: string; date: string; job: string; client: string; positions: LabelPosition[]; warnings: string[]; }

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
  return { order, date, job, client, positions: clean, warnings };
}

export async function parseLabelPdf(bytes: Uint8Array): Promise<LabelSpec> {
  return parseArchimede(await pdfLines(bytes));
}

// ---- labels → A4 PDF --------------------------------------------------------------------------
export interface LabelItem { w: number | string; h: number | string; ref: string; kind?: 'hardware'; }
// Each label is printed twice, side by side: the label in the left column and its copy in the right,
// so one sheet row = one piece. `skipRows` leaves already-used rows at the top of the sheet empty.
export interface LabelSheetOptions { title: string; labels: LabelItem[]; logo: boolean; company: boolean; skipRows?: number; }

const MM = 72 / 25.4;
const PAGE_W = 210 * MM, PAGE_H = 297 * MM;
const COLS = 2, ROWS = 4, CELL_W = PAGE_W / COLS, CELL_H = PAGE_H / ROWS;
const PAD = 4 * MM;
const COMPANY = ['Ul. Koźmińska 10', '63-440 Raszków', 'NIP: PL6222839864', 'Email: biuro@wemokna.pl', 'Tel. +48 690 126 185'];

export function buildLabelsPdf(opts: LabelSheetOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Etykiety — ' + (opts.title || '') } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('R', join(ASSETS, 'LiberationSerif-Regular.ttf'));
    doc.registerFont('B', join(ASSETS, 'LiberationSerif-Bold.ttf'));
    const logo = opts.logo ? readFileSync(join(ASSETS, 'wem-logo.jpg')) : null;

    const skipRows = Math.max(0, Math.min(ROWS - 1, Math.floor(opts.skipRows ?? 0)));
    const slots: (LabelItem | null)[] = [...Array(skipRows * COLS).fill(null), ...opts.labels.flatMap((l) => Array(COLS).fill(l))];
    slots.forEach((lab, i) => {
      const k = i % (COLS * ROWS);
      if (k === 0) doc.addPage();
      if (!lab) return;
      const x0 = (k % COLS) * CELL_W, y0 = Math.floor(k / COLS) * CELL_H;
      const header = !!logo || opts.company;

      if (logo) doc.image(logo, x0 + 5 * MM, y0 + 5 * MM, { fit: [16 * MM, 25 * MM] });
      if (opts.company) {
        const cx = x0 + (logo ? 24 * MM : PAD), lh = 4.7 * MM;
        doc.font('B').fontSize(11).fillColor('#000').text('WEM Sp. z o.o.', cx, y0 + 3 * MM, { lineBreak: false });
        COMPANY.forEach((t, j) => doc.font('R').fontSize(10.5).text(t, cx, y0 + 3 * MM + lh * (j + 1), { lineBreak: false }));
      }

      const w = CELL_W - 2 * PAD, x = x0 + PAD;
      let y = y0 + (header ? 33 : 23) * MM;
      if (lab.kind === 'hardware') {
        doc.font('B').fontSize(30).fillColor('#000').text('HARDWARE', x, y + 2 * MM, { width: w, align: 'center', lineBreak: false });
        jobLine(doc, (opts.title || '').trim(), '', x, y + 16.5 * MM, w, y0 + CELL_H - 2 * MM);
        return;
      }
      doc.font('R').fontSize(15).fillColor('#000').text('Wymiar Okna:', x, y, { width: w, align: 'center' });
      y += 7 * MM;
      doc.font('B').fontSize(20).text(`P/N W${lab.w} x H${lab.h}`, x, y, { width: w, align: 'center', lineBreak: false });
      y += 9.5 * MM;
      jobLine(doc, (opts.title || '').trim(), String(lab.ref || '').trim(), x, y, w, y0 + CELL_H - 2 * MM);
    });
    if (!slots.length) doc.addPage();
    doc.end();
  });
}

// "<title> – <REF>" centred and word-wrapped, with the reference in bold and never split.
// (pdfkit's own `continued` + center mis-positions mixed-font runs, so lay it out by hand.)
function jobLine(doc: PDFKit.PDFDocument, title: string, ref: string, x: number, y: number, w: number, maxY: number): void {
  const SIZE = 13.5, LH = 5.6 * MM;
  const toks = [
    ...title.split(/\s+/).filter(Boolean).map((t) => ({ t, f: 'R' })),
    ...(ref ? [{ t: '–', f: 'R' }, { t: ref, f: 'B' }] : []),
  ];
  doc.fontSize(SIZE);
  const width = (t: { t: string; f: string }) => doc.font(t.f).widthOfString(t.t);
  const space = doc.font('R').widthOfString(' ');
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
      doc.font(tk.f).fontSize(SIZE).text(tk.t, cx, y, { lineBreak: false });
      cx += width(tk);
    });
    y += LH;
  }
}
