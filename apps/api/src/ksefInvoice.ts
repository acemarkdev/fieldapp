// Reading a KSeF purchase invoice (the PDF the KSeF generator produces) into lines, and splitting
// its cost between trade orders by the "Ref.: OK …" written on each line. Pure functions; the text
// comes from the PDF via unpdf (extractText, pages merged).
import { okCode } from './subiekt';

export type KsefType = 'basic' | 'settlement' | 'advance' | 'correction' | 'unknown';
export interface KsefLine { lp: number; name: string; text: string; net: number; before: boolean; web: string | null; order: string | null }
export interface KsefInvoice { number: string | null; type: KsefType; currency: string | null; corrects: string | null; lines: KsefLine[] }

const AMT = String.raw`-?\d{1,3}(?: \d{3})*(?:,\d{1,2})?`;
// "558,58 1 szt 23% 558,58 128,47 26765408"  /  "864,52 0 szt 23% 0 0 26153063"  / "… 26153062 Tak" (correction: state before)
const NUMS_BODY = String.raw`(${AMT}) (-?\d+(?:,\d+)?) (\S+) (\d{1,2}%|zw|np|oo|\S+%) (${AMT}) (${AMT}) (\d{5,})( Tak| Nie)?`;
const NUMS = new RegExp(`^${NUMS_BODY}$`);
// a short line can sit on one row: "1 Zaliczka 9 166,56 -1 szt 23% -9 166,56 -2 108,31 26765336"
const ONE_ROW = new RegExp(`^(\\d{1,3}) (\\D.*?) ${NUMS_BODY}$`);
export const plMoney = (s: string) => Number(s.replace(/ /g, '').replace(',', '.'));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function ksefType(text: string): KsefType {
  const head = text.slice(0, 400);
  if (/Faktura korygująca/i.test(head)) return 'correction';
  if (/Faktura zaliczkowa/i.test(head)) return 'advance';
  if (/Faktura rozliczeniowa/i.test(head)) return 'settlement';
  if (/Faktura podstawowa/i.test(head)) return 'basic';
  return 'unknown';
}

/** The text of a KSeF invoice → its header facts and its lines (goods and "Zaliczka" deductions). */
export function parseKsef(text: string): KsefInvoice {
  const rows = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const number = (/Numer Faktury:\s*\n?\s*(\S+)/.exec(text) ?? [])[1] ?? null;
  const currency = (/Kod waluty:\s*([A-Z]{3})/.exec(text) ?? [])[1] ?? null;
  const corrects = (/Numer faktury korygowanej:\s*(\S+)/.exec(text) ?? [])[1] ?? null;
  const type = ksefType(text);
  const lines: KsefLine[] = [];
  const start = rows.findIndex((r) => r === 'Pozycje');
  if (start < 0 || type === 'advance') return { number, type, currency, corrects, lines };
  // page furniture repeated inside the table: the column header (it may wrap over several rows) and "1 z 3"
  const HEADER_WORDS = /^(Lp\. Nazwa towaru|netto$|brutto$|podatku$|vat$|UU_ID|przed$|Ilość Miara|Wartość sprzedaży|sprzedaży (netto|vat)$|Kwota$|Faktura wystawiona w walucie)/;
  let cur: { lp: number; name: string; text: string[]; nums: RegExpExecArray | null } | null = null;
  let lastLp = 0;
  const flush = () => {
    if (cur && cur.nums) {
      const text = cur.text.join(' ');
      lines.push({ lp: cur.lp, name: cur.name, text, net: plMoney(cur.nums[5]), before: cur.nums[8] === ' Tak', web: (/(?:WEB|ZMAL)\/\d{2}\/\d+/.exec(text) ?? [])[0] ?? null, order: okCode((/Ref\.?:?\s*(.*)$/i.exec(text) ?? [])[1] ?? '') });
    }
    cur = null;
  };
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (/^Lp\. CN\b|^Zamówienie$|^Kwota należności|^Podsumowanie stawek|^Dodatkowe informacje/.test(r)) break;
    if (/^\d+ z \d+$/.test(r) || HEADER_WORDS.test(r)) continue;
    const nums = NUMS.exec(r);
    if (nums && cur && !cur.nums) { cur.nums = nums; continue; }
    const one = ONE_ROW.exec(r);
    if (one && (+one[1] === lastLp + 1 || +one[1] === 1) && (!cur || cur.nums)) {
      flush(); lastLp = +one[1];
      const n = [one[0], ...one.slice(3)] as unknown as RegExpExecArray; // same groups as NUMS: [1..8]
      cur = { lp: lastLp, name: one[2], text: [one[2]], nums: n }; continue;
    }
    const m = /^(\d{1,3}) (\D.*)$/.exec(r);
    // a new line starts with the next Lp. number (corrections restart at 1 for the "after" state)
    if (m && (+m[1] === lastLp + 1 || +m[1] === 1) && (!cur || cur.nums)) { flush(); lastLp = +m[1]; cur = { lp: lastLp, name: m[2], text: [m[2]], nums: null }; continue; }
    if (cur) cur.text.push(r);
  }
  flush();
  return { number, type, currency, corrects, lines };
}

export interface Allocation { order: string; net: number; lines: number }
export interface Split { allocations: Allocation[]; unassigned: { net: number; lines: KsefLine[] }; total: number; advances: number }
/** Who carries the cost of each line. Goods lines count with their net value — the state "before" of a
 *  correction with a minus. "Zaliczka" lines (the advance taken off a settlement invoice) are not a cost:
 *  the goods on that invoice are. A line without its own OK reference takes the order of another line on
 *  the same invoice with the same supplier order number (WEB/…); otherwise it stays unassigned. */
export function splitByOrder(inv: KsefInvoice): Split {
  const webOrder = new Map<string, string | null>();
  for (const l of inv.lines) if (l.web && l.order) {
    const had = webOrder.get(l.web);
    webOrder.set(l.web, had === undefined || had === l.order ? l.order : null); // one WEB number, two orders → no shortcut
  }
  const by = new Map<string, Allocation>(); const unassigned: KsefLine[] = []; let total = 0, advances = 0, un = 0;
  for (const l of inv.lines) {
    const signed = l.before ? -l.net : l.net;
    total = round2(total + signed);
    if (/^zaliczka\b/i.test(l.name)) { advances = round2(advances + signed); continue; }
    const order = l.order ?? (l.web ? webOrder.get(l.web) ?? null : null);
    if (!order) { unassigned.push(l); un = round2(un + signed); continue; }
    const a = by.get(order) ?? by.set(order, { order, net: 0, lines: 0 }).get(order)!;
    a.net = round2(a.net + signed); a.lines++;
  }
  return { allocations: [...by.values()].filter((a) => Math.abs(a.net) >= 0.005 || a.lines), unassigned: { net: un, lines: unassigned }, total, advances };
}
