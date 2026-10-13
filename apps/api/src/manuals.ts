// Fin&Ops ▸ Manuals: the user manuals shown inside the office app. Each manual is a Markdown
// file in apps/api/assets/manuals (screenshots in img/); it is converted to HTML here, on the
// server, with everything escaped — the page only ever receives finished HTML.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capability } from '@ace/shared';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../assets/manuals');

export interface ManualDef { key: string; file: string; title: string; cap: Capability }
// The capability decides who sees a manual: the same one that opens the tab it describes.
export const MANUALS: ManualDef[] = [
  { key: 'job-costs', file: 'koszty-zlecen.md', title: 'Koszty zleceń', cap: 'finops.view' },
  { key: 'sales', file: 'sprzedaz.md', title: 'Sprzedaż', cap: 'finops.view' },
  { key: 'orders', file: 'zamowienia-i-prowizja.md', title: 'Zamówienia i prowizja', cap: 'sales.orders' },
];

export function manualsFor(can: (cap: Capability) => boolean): ManualDef[] { return MANUALS.filter((m) => can(m.cap)); }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// **bold** and *italic* inside already-escaped text.
function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>');
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const IMG = /^!\[([^\]]*)\]\(([A-Za-z0-9_-]+\.png)\)$/;

// The small Markdown subset the manuals use: #/##/### headings, paragraphs, numbered and bullet
// lists, tables, and an image on a line of its own. Anything else comes out as plain text.
export function manualHtml(md: string, imgBase = '/api/manual-image/'): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (!l) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    const im = IMG.exec(l);
    if (im) { out.push(`<figure><img loading="lazy" alt="${esc(im[1])}" src="${imgBase}${im[2]}"></figure>`); i++; continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      const sep = rows.length > 1 && rows[1].every((c) => /^:?-+:?$/.test(c));
      const body = sep ? rows.slice(2) : rows;
      out.push('<div class="mtw"><table>' + (sep ? '<thead><tr>' + rows[0].map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>' : '')
        + '<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    const ol = /^\d+\.\s+/, ul = /^-\s+/;
    if (ol.test(l) || ul.test(l)) {
      const rx = ol.test(l) ? ol : ul, tag = rx === ol ? 'ol' : 'ul';
      const items: string[] = [];
      while (i < lines.length && rx.test(lines[i].trim())) { items.push(lines[i].trim().replace(rx, '')); i++; }
      out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || /^#{1,3}\s/.test(t) || t.startsWith('|') || ol.test(t) || ul.test(t) || IMG.test(t)) break;
      para.push(t); i++;
    }
    // a paragraph that is one italic line is a picture caption
    out.push(para.length === 1 && /^\*[^*]+\*$/.test(para[0]) ? `<p class="cap">${inline(para[0].slice(1, -1))}</p>` : `<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const cache = new Map<string, string>();
export function manualPage(m: ManualDef): string {
  let html = cache.get(m.key);
  if (html === undefined) { html = manualHtml(readFileSync(join(DIR, m.file), 'utf8')); cache.set(m.key, html); }
  return html;
}

// Screenshots are served by file name from a list read once at startup (no path from the request
// ever reaches the disk).
export const MANUAL_IMAGES: Set<string> = (() => { try { return new Set(readdirSync(join(DIR, 'img')).filter((f) => /^[A-Za-z0-9_-]+\.png$/.test(f))); } catch { return new Set<string>(); } })();
export function manualImage(name: string): Buffer | null {
  if (!MANUAL_IMAGES.has(name)) return null;
  try { return readFileSync(join(DIR, 'img', name)); } catch { return null; }
}
