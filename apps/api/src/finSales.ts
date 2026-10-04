// Fin&Ops ▸ Sales — the Excel sheet "Sprzedaż": sales invoices, typed in until Subiekt nexo is connected.
// Stored one row per invoice; shown per job (prepayments + final invoice together). The net sum of a
// job's invoices is that job's sales in Job costs. Channel: producer "Acemark PL" = made in Orpiszew
// (production); anything else (Eko-okna, no producer…) = Trade from Poland — as in the Performance Sheet.
import { db } from './supabase';
import { parseMoney, parseMonth, referenceKey } from './finJobs';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const saleChannel = (producer: unknown): 'production' | 'trade' => (/^acemark/i.test(clean(producer)) ? 'production' : 'trade');
/** Dates as typed or pasted from Excel: 2025-01-03, 03.01.2025, 3/1/2025 (day first), or with a time part. */
export function parseDate(v: unknown): string | null {
  const s = clean(v).split(/[ T]/)[0];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) { const d = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s); if (d) m = [s, d[3], d[2], d[1]] as any; }
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });

/** Input (form or pasted row) → the stored fields. Month/year default to the invoice date; a note
 *  mentioning "zaliczka" makes it a prepayment unless the type is given. */
export function saleFields(b: any): Result<{ fields: Record<string, any> }> {
  const net = parseMoney(b.net);
  if (net === null) return fail(400, 'Enter the net amount.');
  const date = parseDate(b.invoice_date ?? b.date);
  const year = parseMoney(b.period_year ?? b.year) ?? (date ? +date.slice(0, 4) : null);
  const month = parseMonth(b.period_month ?? b.month) ?? (date ? +date.slice(5, 7) : null);
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) return fail(400, 'Year looks wrong.');
  const job = clean(b.job_ref ?? b.job), note = clean(b.note);
  const kind = b.kind === 'prepaid' || b.kind === 'final' ? b.kind : (/zalicz|prepa|deposit/i.test(note) ? 'prepaid' : 'final');
  return { ok: true, fields: {
    invoice_no: clean(b.invoice_no).slice(0, 80) || null, invoice_date: date,
    job_ref: job.slice(0, 80) || null, job_key: job ? referenceKey(job).slice(0, 80) : null,
    period_year: year, period_month: month,
    producer: clean(b.producer).slice(0, 80) || null, buyer: clean(b.buyer).slice(0, 120) || null,
    net, gross: parseMoney(b.gross), country: clean(b.country).toUpperCase().slice(0, 3) || null,
    kind, note: note.slice(0, 500) || null, seller: clean(b.seller).slice(0, 80) || null,
  } };
}
/** What makes two entries "the same line" on import: invoice number + job + net (one invoice can cover
 *  two jobs, and the sheet has a number used twice), or job + month + net when there is no number yet. */
export function saleKey(f: { invoice_no: string | null; job_key: string | null; period_year: number | null; period_month: number | null; net: number }): string {
  const tail = `${f.job_key ?? ''}|${Number(f.net).toFixed(2)}`;
  return f.invoice_no ? `N:${f.invoice_no.replace(/\s/g, '').toUpperCase()}|${tail}` : `P:${f.period_year ?? ''}-${f.period_month ?? ''}|${tail}`;
}

async function selectAll(cols: string, tenantId: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_sales').select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const out = (r: any) => ({ ...r, net: Number(r.net) || 0, gross: r.gross === null || r.gross === undefined ? null : Number(r.gross), channel: saleChannel(r.producer) });

export async function listSales(tenantId: string): Promise<any[]> { return (await selectAll('*', tenantId)).map(out); }
export async function createSale(tenantId: string, by: string, b: any): Promise<Result<{ id: string }>> {
  const f = saleFields(b); if (!f.ok) return f;
  const { data, error } = await db().from('fin_sales').insert({ tenant_id: tenantId, created_by: by, ...f.fields }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}
export async function updateSale(tenantId: string, id: string, b: any): Promise<Result> {
  const f = saleFields(b); if (!f.ok) return f;
  const { data, error } = await db().from('fin_sales').update({ ...f.fields, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  return data ? { ok: true } : fail(404, 'Invoice not found.');
}
export async function deleteSale(tenantId: string, id: string): Promise<Result> {
  const { data, error } = await db().from('fin_sales').delete().eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  return data ? { ok: true } : fail(404, 'Invoice not found.');
}
/** Import pasted sheet rows; lines that are already there (see saleKey) are skipped, so pasting twice is safe. */
export async function importSales(tenantId: string, by: string, rows: any[]): Promise<{ added: number; skipped: number; invalid: number }> {
  const have = new Set((await selectAll('invoice_no,job_key,period_year,period_month,net', tenantId)).map((r) => saleKey({ ...r, net: Number(r.net) || 0 })));
  const fresh: Record<string, any>[] = []; let skipped = 0, invalid = 0;
  for (const r of rows) {
    const f = saleFields(r);
    if (!f.ok) { invalid++; continue; }
    const k = saleKey(f.fields as any);
    if (have.has(k)) { skipped++; continue; }
    have.add(k); fresh.push({ tenant_id: tenantId, created_by: by, ...f.fields });
  }
  for (let i = 0; i < fresh.length; i += 500) { const { error } = await db().from('fin_sales').insert(fresh.slice(i, i + 500)); if (error) throw error; }
  return { added: fresh.length, skipped, invalid };
}
