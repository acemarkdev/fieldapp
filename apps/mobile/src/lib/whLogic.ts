// Warehouse issues on the phone (role Warehouse): the rules of the form. The database function
// wh_save_issue checks the same on the server.
export interface WhIssue { id: string; job_ref: string; symbol: string; name: string | null; unit: string | null; qty: number; location: string | null; box: string | null; note: string | null; created_at: string }
export interface WhItem { symbol: string; name: string | null; unit: string | null; stock: number | null }
export interface WhForm { job: string; symbol: string; qty: string; location: string; box: string; note: string }

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** "z437", "Z 437", "Z_0437 panele" → "Z.437", "Z.437 panele" (the office app does the same). */
export const zRef = (v: unknown) => clean(v).replace(/^[Zz][\s._-]*0*(\d+)/, 'Z.$1');
/** "2,5" / "2.5" / " 3 " → 2.5 / 3; anything else → null. */
export function parseQty(v: unknown): number | null {
  const s = clean(v).replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 1000) / 1000;
  return n > 0 && n <= 1000000 ? n : null;
}
/** What is still missing before the issue can be saved (Polish, for the worker), or null. */
export function formProblem(f: WhForm): string | null {
  if (!zRef(f.job)) return 'Podaj zlecenie (np. Z.437).';
  if (!clean(f.symbol)) return 'Zeskanuj lub wpisz symbol towaru.';
  if (parseQty(f.qty) === null) return 'Podaj ilość (większą od zera).';
  if (clean(f.note).length > 300) return 'Uwagi mogą mieć najwyżej 300 znaków.';
  return null;
}
/** A scanned code → the text for the field: trimmed; a symbol upper-cased. */
export const scanned = (raw: unknown, field: 'symbol' | 'location') => { const s = clean(raw).slice(0, 80); return field === 'symbol' ? s.toUpperCase() : s; };
/** Z orders for the quick-pick chips: the worker's own recent ones first, then the open jobs; filtered by what is typed. */
export function jobChoices(mine: WhIssue[], open: string[], typed: string, n = 8): string[] {
  const t = zRef(typed).toUpperCase().replace(/\s/g, ''), out: string[] = [];
  for (const j of [...mine.map((m) => m.job_ref), ...open]) {
    const k = j.toUpperCase().replace(/\s/g, '');
    if (out.some((x) => x.toUpperCase().replace(/\s/g, '') === k)) continue;
    if (t && !k.includes(t)) continue;
    out.push(j); if (out.length >= n) break;
  }
  return out;
}
/** "4 szt" / "2,5 m" — the quantity as the worker reads it. */
export const qtyLabel = (qty: number, unit: string | null) => `${String(Math.round(qty * 1000) / 1000).replace('.', ',')}${unit ? ' ' + unit : ''}`;
