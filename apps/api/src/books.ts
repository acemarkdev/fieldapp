// Performance ▸ Books (RZiS): the accountant's profit and loss statement (rachunek zysków i strat, comparative variant,
// as printed by IPS), uploaded as a PDF and kept per period, so Performance can show the books next to the UoR view.
// From each statement the monthly Depreciation (B.I) and Financial cost (H − G) can be filled in: the statements are
// cumulative from 1 January, so a month gets the difference to the previous statement of the same year, spread evenly.
import { randomBytes } from 'node:crypto';
import { getConfig, setConfig } from './store';
import { pdfLines } from './labels';

export const RZIS_LINES: { code: string; label: string }[] = [
  { code: 'A', label: 'Przychody netto ze sprzedaży i zrównane z nimi' }, { code: 'A.I', label: 'Przychody netto ze sprzedaży produktów' },
  { code: 'A.II', label: 'Zmiana stanu produktów' }, { code: 'A.III', label: 'Koszt wytworzenia produktów na własne potrzeby jednostki' }, { code: 'A.IV', label: 'Przychody netto ze sprzedaży towarów' },
  { code: 'B', label: 'Koszty działalności operacyjnej' }, { code: 'B.I', label: 'Amortyzacja' }, { code: 'B.II', label: 'Zużycie materiałów i energii' },
  { code: 'B.III', label: 'Usługi obce' }, { code: 'B.IV', label: 'Podatki i opłaty' }, { code: 'B.V', label: 'Wynagrodzenia' },
  { code: 'B.VI', label: 'Ubezpieczenia społeczne i inne świadczenia' }, { code: 'B.VII', label: 'Pozostałe koszty rodzajowe' }, { code: 'B.VIII', label: 'Wartość sprzedanych towarów' },
  { code: 'C', label: 'Zysk (strata) ze sprzedaży' }, { code: 'D', label: 'Pozostałe przychody operacyjne' }, { code: 'E', label: 'Pozostałe koszty operacyjne' },
  { code: 'F', label: 'Zysk (strata) z działalności operacyjnej' }, { code: 'G', label: 'Przychody finansowe' }, { code: 'H', label: 'Koszty finansowe' },
  { code: 'H.I', label: 'Odsetki' }, { code: 'H.IV', label: 'Inne koszty finansowe' },
  { code: 'I', label: 'Zysk (strata) brutto' }, { code: 'J', label: 'Podatek dochodowy' }, { code: 'K', label: 'Pozostałe obowiązkowe zmniejszenia zysku' }, { code: 'L', label: 'Zysk (strata) netto' },
];
const LETTERS = 'ABCDEFGHIJKL';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const AMOUNT = /(-?\d{1,3}(?:[  ]\d{3})*,\d{2})\s*$/;
const amount = (s: string) => Number(s.replace(/[  ]/g, '').replace(',', '.'));

export interface Statement { from: string; to: string; company: string | null; nip: string | null; values: Record<string, number> }
/** The text lines of an IPS "RACHUNEK ZYSKÓW I STRAT" → its period and amounts (an empty line counts as 0). */
export function parseRzis(lines: string[]): { ok: true; st: Statement } | { ok: false; error: string } {
  const all = lines.join('\n');
  if (!/RACHUNEK\s+ZYSK[ÓO]W\s+I\s+STRAT/i.test(all)) return { ok: false, error: /BILANS/i.test(all) ? 'This is a balance sheet (bilans) — upload the profit and loss statement (rachunek zysków i strat).' : 'This does not look like a profit and loss statement (rachunek zysków i strat).' };
  const per = /za okres od\s+(\d{2})-(\d{2})-(\d{4})\s+do\s+(\d{2})-(\d{2})-(\d{4})/i.exec(all);
  if (!per) return { ok: false, error: 'The period ("za okres od … do …") was not found in the statement.' };
  const from = `${per[3]}-${per[2]}-${per[1]}`, to = `${per[6]}-${per[5]}-${per[4]}`;
  const values: Record<string, number> = {};
  let letter = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const m = /^([A-Z]{1,4})\.\s+(.*)$/.exec(line);
    if (!m) continue;
    const head = m[1], rest = m[2];
    const next = letter ? LETTERS[LETTERS.indexOf(letter) + 1] : 'A';
    // "I." is both the 9th letter (Zysk brutto) and the Roman one: the letter only when it is next in order and says so
    const isLetter = head.length === 1 && head === next && (head !== 'I' || /brutto/i.test(rest));
    const code = isLetter ? head : ROMAN.includes(head) && letter ? letter + '.' + head : null;
    if (isLetter) letter = head;
    if (!code) continue;
    const a = AMOUNT.exec(rest);
    values[code] = a ? amount(a[1]) : 0;
  }
  for (const k of ['A', 'B', 'C', 'F', 'I', 'L']) if (!(k in values)) return { ok: false, error: `Line ${k} was not found — is this the comparative variant (wariant porównawczy) from IPS?` };
  const close = (x: number, y: number) => Math.abs(x - y) < 0.05;
  const v = (k: string) => values[k] ?? 0;
  if (!close(v('C'), v('A') - v('B')) || !close(v('F'), v('C') + v('D') - v('E')) || !close(v('I'), v('F') + v('G') - v('H'))) return { ok: false, error: 'The statement does not add up (C = A − B, F = C + D − E, I = F + G − H) — the PDF may have been read wrongly.' };
  const company = /Dane przedsiębiorstwa\s+(.*?)\s{2,}RACHUNEK/i.exec(lines.join('  '))?.[1] ?? null;
  const nip = /NIP:?\s*([\d-]{10,13})/i.exec(all)?.[1]?.replace(/-/g, '') ?? null;
  return { ok: true, st: { from, to, company: company ? company.replace(/\s+/g, ' ').trim() : null, nip, values } };
}

export interface BookRecord extends Statement { id: string; tenant_id: string; file_name: string; uploaded_by: string; uploaded_at: string }
const CFG = 'books_rzis';
async function readAll(): Promise<BookRecord[]> { try { const v = JSON.parse((await getConfig(CFG)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export async function listBooks(tenantId: string): Promise<BookRecord[]> {
  return (await readAll()).filter((b) => b.tenant_id === tenantId).sort((a, b) => b.to.localeCompare(a.to));
}
/** Store a statement; one per period — a new upload for the same dates replaces the old one. */
export async function addBook(tenantId: string, by: string, fileName: string, bytes: Uint8Array): Promise<{ ok: true; book: BookRecord; replaced: boolean } | { ok: false; error: string }> {
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') return { ok: false, error: 'Not a PDF.' };
  let lines: string[]; try { lines = await pdfLines(bytes); } catch { return { ok: false, error: 'The PDF could not be read.' }; }
  const p = parseRzis(lines); if (!p.ok) return p;
  if (p.st.from.slice(5) !== '01-01' || p.st.from.slice(0, 4) !== p.st.to.slice(0, 4)) return { ok: false, error: 'Upload the statement from 1 January (cumulative for the year), e.g. 01-01-2026 to 30-09-2026.' };
  const all = await readAll();
  const replaced = all.some((b) => b.tenant_id === tenantId && b.from === p.st.from && b.to === p.st.to);
  const book: BookRecord = { id: randomBytes(6).toString('hex'), tenant_id: tenantId, file_name: fileName.slice(0, 160), uploaded_by: by, uploaded_at: new Date().toISOString(), ...p.st };
  await setConfig(CFG, JSON.stringify([...all.filter((b) => !(b.tenant_id === tenantId && b.from === p.st.from && b.to === p.st.to)), book]));
  return { ok: true, book, replaced };
}
export async function deleteBook(tenantId: string, id: string): Promise<boolean> {
  const all = await readAll(), next = all.filter((b) => !(b.tenant_id === tenantId && b.id === id));
  if (next.length === all.length) return false;
  await setConfig(CFG, JSON.stringify(next)); return true;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The monthly Depreciation (B.I) and Financial cost (H − G) a statement gives: the difference to the latest earlier
 *  statement of the same year (or the whole amount when there is none), spread evenly over the months in between;
 *  cents left over go to the last month. */
export function monthlyFromBooks(book: Pick<Statement, 'to' | 'values'>, earlier: Pick<Statement, 'to' | 'values'>[]): { year: number; months: number[]; depreciation: number[]; financial_cost: number[] } {
  const year = +book.to.slice(0, 4), end = +book.to.slice(5, 7);
  const prev = earlier.filter((b) => b.to.slice(0, 4) === book.to.slice(0, 4) && +b.to.slice(5, 7) < end).sort((a, b) => b.to.localeCompare(a.to))[0];
  const start = prev ? +prev.to.slice(5, 7) + 1 : 1;
  const months: number[] = []; for (let m = start; m <= end; m++) months.push(m);
  const fin = (v: Record<string, number>) => (v.H ?? 0) - (v.G ?? 0);
  const spread = (total: number) => { const each = r2(total / months.length); const out = months.map(() => each); out[out.length - 1] = r2(total - each * (months.length - 1)); return out; };
  return { year, months, depreciation: spread((book.values['B.I'] ?? 0) - (prev?.values['B.I'] ?? 0)), financial_cost: spread(fin(book.values) - (prev ? fin(prev.values) : 0)) };
}
