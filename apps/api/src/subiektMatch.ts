// Subiekt ▸ match: suggestions for the documents on the "to check" list, so they can be placed from the
// app instead of one by one in Subiekt. Nothing here is applied by itself — the user confirms every link.
//   • a sales invoice → the order whose reference (L2025 …, WEB/…, ZMAL/…, OK …, Z.…, PO-AG…) is written
//     on the document, else the customer's orders (an amount within 3 % first);
//   • a material issue (RW) → the Z job named on it, or "overhead" with a reason read from its Podtytuł;
//   • scrap sales and zero-value documents → "not a job: other income".
import { orderCode, orderKeys } from './finOrders';
import { zNumbers, all, listDocs, withLinks, notedInvoices, docsToCheck, applyDocs, setAssigned, classifyDoc, SALE_SYMBOLS, type SubDoc } from './subiekt';
import { db } from './supabase';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const alnum = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

export interface OrderLite { id: string; order_ref: string; job_ref: string | null; customer: string | null; net: number | null; status: string | null; invoice_refs: string | null; vendor_quote?: string | null; note?: string | null; comment?: string | null }
export interface DocLite { doc_id: number; symbol: string; number: string | null; subtitle: string | null; notes: string | null; customer: string | null; net_pln: number | null }

/** The reasons a document can belong to no job. RW: overhead of production; sales: other income. */
export const NOT_JOB_REASONS = ['trials', 'scrap', 'warranty', 'shipment', 'production', 'stock', 'sample', 'other_income', 'recharge', 'recharge_commission', 'other'] as const;
export type NotJobReason = (typeof NOT_JOB_REASONS)[number];
export const NOT_JOB_LABEL: Record<NotJobReason, string> = {
  trials: 'Trials / CNC tests', scrap: 'Scrap', warranty: 'Warranty / complaint', shipment: 'Shipment to the UK / abroad',
  production: 'Production consumables', stock: 'Stock correction (missing in the warehouse)', sample: 'Samples / showroom', other_income: 'Other income (not a job)', recharge: 'Recharge of costs (not sales)', recharge_commission: 'Recharge of commission (not sales)', other: 'Other',
};

/** Reference numbers written on a document, letters and digits only. */
export function docRefs(text: unknown): string[] {
  const s = clean(text), out = new Set<string>();
  const res = [/WEB\/\d{2}\/\d{5,}/gi, /OF\/\d{2}\/\d{5,}/gi, /ZMAL\/\d{2}\/\d{4,}/gi, /\bL20\d{2}\s?\d{3,5}\b/gi, /PO-AG\d{2}-\d{3,}/gi, /\bJ0\d{5}P?\b/gi];
  for (const r of res) for (const m of s.match(r) ?? []) out.add(alnum(m));
  const ok = /(?<![A-Za-z])OK[\s_\-–]*(?:[A-Za-z]{2,6}[\s_\-–]*)?\d{4,}/gi;
  for (const m of s.match(ok) ?? []) out.add(alnum(orderCode(m)));
  return [...out].filter((k) => k.length >= 5);
}

/** A reason read from an RW's Podtytuł ("Próby na CNC", "na złom", "Wysyłka do UK"…); null when it names nothing. */
export function overheadReason(text: unknown): NotJobReason | null {
  const s = clean(text).toLowerCase();
  if (!s) return null;
  if (/pr[oó]b|test/.test(s)) return 'trials';
  if (/z[lł]om|odpad/.test(s)) return 'scrap';
  if (/reklamac|pękni|peknie|uszkodz/.test(s)) return 'warranty';
  if (/wysy[lł]k|do uk\b|do anglii|\buk\b|niemcy|estimus/.test(s)) return 'shipment';
  if (/brak na magazynie|inwentar|korekt/.test(s)) return 'stock';
  if (/produkcj|drzwi na hal|na hal[eę]/.test(s)) return 'production';
  if (/pokazow|narożnik|naroznik|showroom|próbk|probk/.test(s)) return 'sample';
  if (/sprzeda/.test(s)) return 'other_income';
  return null;
}
/** A sales document that is plainly not a job: scrap sold, a car dismantler, a zero-value document. */
export function otherIncomeHint(d: DocLite): boolean {
  const s = (clean(d.subtitle) + ' ' + clean(d.notes) + ' ' + clean(d.customer)).toLowerCase();
  return d.net_pln === 0 || /z[lł]om|demonta[zż]u? pojazd|kasacj|prowizj/.test(s);
}

export interface Candidate { order_id: string; label: string; job_ref: string | null; net: number | null; why: 'reference' | 'customer_amount' | 'customer' }
export interface Suggestion { doc_id: number; candidates: Candidate[]; overhead: NotJobReason | null; job: string | null; income: boolean }

const label = (o: OrderLite) => [clean(o.customer), clean(o.order_ref)].filter(Boolean).join(' · ').slice(0, 140);
const sameCustomer = (a: string, b: string) => { const x = alnum(a).slice(0, 14), y = alnum(b).slice(0, 14); return x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x)); };

/** Suggestions for each document on the list. `saleJob` gives the job of an invoice by its number (for "SPRZEDAŻ FS 13/…" on an RW). */
export function suggest(docs: DocLite[], orders: OrderLite[], saleJob?: (invoiceNo: string) => string | null): Suggestion[] {
  const text = orders.map((o) => ({ o, t: alnum([o.order_ref, o.job_ref, o.vendor_quote, o.note, o.comment].map(clean).join(' ')) }));
  return docs.map((d) => {
    const words = clean(d.subtitle) + ' ' + clean(d.notes);
    const refs = docRefs(words);
    const zs = zNumbers(words);
    let cands: Candidate[] = [];
    if (refs.length || zs.length) cands = text.filter((x) => refs.some((r) => x.t.includes(r)) || (x.o.job_ref && zs.includes(orderCode(x.o.job_ref)))).map((x) => ({ order_id: x.o.id, label: label(x.o), job_ref: x.o.job_ref, net: x.o.net, why: 'reference' as const }));
    if (!cands.length && d.symbol !== 'RW' && d.customer) {
      const mine = orders.filter((o) => o.customer && sameCustomer(o.customer, d.customer!));
      const amt = d.net_pln ? mine.filter((o) => o.net && Math.abs(o.net - Math.abs(d.net_pln!)) / o.net <= 0.03) : [];
      const near = (o: OrderLite) => (o.net && d.net_pln ? Math.abs(o.net - Math.abs(d.net_pln)) : Infinity);
      cands = (amt.length ? amt : mine.filter((o) => o.status !== 'lost')).slice().sort((a, b) => near(a) - near(b)).slice(0, 8).map((o) => ({ order_id: o.id, label: label(o), job_ref: o.job_ref, net: o.net, why: amt.length ? 'customer_amount' as const : 'customer' as const }));
    }
    // an RW is placed on a Z job: the Z number of a suggested order, or of the invoice it names
    let job: string | null = null;
    if (d.symbol === 'RW') {
      const zj = [...new Set(cands.map((c) => c.job_ref).filter((j): j is string => !!j && /^Z\./.test(orderCode(j))).map((j) => orderCode(j)))];
      const inv = /\b(FS|FL)\s*\d+\/[A-Z]+\/\d{2}\/\d{4}\b/i.exec(words);
      const viaInv = inv && saleJob ? saleJob(inv[0]) : null;
      job = zs.length === 1 ? zs[0] : zj.length === 1 ? zj[0] : viaInv && /^Z\./.test(viaInv) ? viaInv : null;
    }
    return { doc_id: d.doc_id, candidates: cands.slice(0, 8), overhead: d.symbol === 'RW' && !cands.length ? overheadReason(d.subtitle) : null, job, income: d.symbol !== 'RW' && otherIncomeHint(d) };
  });
}

/** How a link to an order is stored. A Z job or an order code that only this order has → the document's
 *  own reference (the sale then sits under that job everywhere); anything else → the invoice number is
 *  noted on the order (its "Invoice numbers" field). */
export function linkFor(order: OrderLite, all: OrderLite[]): { ref: string } | { invoiceRefs: true } {
  const z = orderCode(order.job_ref);
  if (/^Z\.\d+$/.test(z)) return { ref: z };
  const code = orderCode(order.order_ref), k = alnum(code);
  if (k.length >= 4 && /\d/.test(k) && code.length <= 40 && all.filter((o) => orderKeys(o).includes(k)).length === 1) return { ref: code };
  return { invoiceRefs: true };
}

// ---- loading and applying --------------------------------------------------------------------
const ORDER_COLS = 'id,order_ref,job_ref,customer,net,status,invoice_refs,vendor_quote,note,comment';
export async function loadOrders(tenantId: string): Promise<OrderLite[]> {
  return (await all<any>('fin_orders', ORDER_COLS, tenantId)).map((o) => ({ ...o, net: o.net === null ? null : Number(o.net) }));
}
/** The to-check list as the app shows it: documents already noted on an order are left out. */
export async function checkList(tenantId: string, orders?: OrderLite[]) {
  const docs = await listDocs(tenantId);
  const os = orders ?? await loadOrders(tenantId);
  const linked = withLinks(docs, notedInvoices(os));
  return { docs: linked, toCheck: docsToCheck(linked) };
}
/** Everything the Match window needs: the suggestions, every order (for the search) and the Z jobs. */
export async function matchData(tenantId: string) {
  const orders = await loadOrders(tenantId);
  const { docs, toCheck } = await checkList(tenantId, orders);
  const byNo = new Map<string, SubDoc>(); for (const d of docs) if (d.number && (SALE_SYMBOLS as readonly string[]).includes(d.symbol)) byNo.set(invoiceKeyOf(d.number), d);
  const byId = new Map(docs.map((d) => [d.doc_id, d]));
  const saleJob = (no: string) => { const d = byNo.get(invoiceKeyOf(no)); return d ? classifyDoc(d, byId).job_ref : null; };
  const jobs = (await all<any>('fin_jobs', 'reference', tenantId)).map((j) => clean(j.reference)).filter((r) => /^Z\.\d+$/.test(r)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return {
    suggestions: suggest(toCheck.map((d) => ({ doc_id: d.doc_id, symbol: d.symbol, number: d.number, subtitle: d.subtitle, notes: d.notes, customer: d.customer, net_pln: d.net_pln })), orders, saleJob),
    orders: orders.map((o) => ({ id: o.id, label: label(o), job_ref: o.job_ref, net: o.net, status: o.status })),
    jobs,
  };
}
const invoiceKeyOf = (no: unknown) => alnum(clean(no));
/** Link a document to an order (see linkFor). An RW can only go on the order's Z job. */
export async function linkToOrder(tenantId: string, docId: number, orderId: string, by: string, rebuild = true, ordersIn?: OrderLite[]): Promise<{ ok: true; how: 'job' | 'invoice_refs'; ref: string } | { ok: false; status: number; error: string }> {
  const { data: d, error } = await db().from('fin_subiekt_docs').select('doc_id,symbol,number').eq('tenant_id', tenantId).eq('doc_id', docId).maybeSingle();
  if (error) throw error;
  if (!d) return { ok: false, status: 404, error: 'Document not found.' };
  const orders = ordersIn ?? await loadOrders(tenantId), o = orders.find((x) => x.id === orderId);
  if (!o) return { ok: false, status: 404, error: 'Order not found.' };
  const how = linkFor(o, orders);
  if (d.symbol === 'RW') {
    if (!('ref' in how) || !/^Z\./.test(how.ref)) return { ok: false, status: 400, error: 'This order has no Z number yet, so the material cannot go on a job. Give the order its Z number in Sales orders, or mark the RW as overhead.' };
  }
  if ('ref' in how) {
    const r = await setAssigned(tenantId, docId, how.ref, by, rebuild);
    if (r === 'not_ready') return { ok: false, status: 409, error: 'Run migration 0116 first.' };
    if (r === 'not_found') return { ok: false, status: 404, error: 'Document not found.' };
    return { ok: true, how: 'job', ref: how.ref };
  }
  if (!d.number) return { ok: false, status: 400, error: 'The document has no number to note on the order.' };
  const cur = clean(o.invoice_refs), have = cur.split(/[,;]+/).map(invoiceKeyOf);
  if (!have.includes(invoiceKeyOf(d.number))) {
    const next = (cur ? cur + '; ' : '') + clean(d.number);
    if (next.length > 300) return { ok: false, status: 400, error: 'The order’s Invoice numbers field is full (300 characters). Give the order a Z number or an OK code of its own, then link again.' };
    const { error: e2 } = await db().from('fin_orders').update({ invoice_refs: next, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', o.id);
    if (e2) throw e2;
    o.invoice_refs = next;
  }
  if (rebuild) await applyDocs(tenantId);
  return { ok: true, how: 'invoice_refs', ref: clean(o.order_ref).slice(0, 60) };
}
/** Several links at once ({doc_id, order_id} or {doc_id, ref} for a Z job), then one rebuild. */
export async function linkMany(tenantId: string, items: { doc_id: number; order_id?: string; ref?: string }[], by: string) {
  const orders = await loadOrders(tenantId);
  const done: { doc_id: number; ref: string }[] = [], failed: { doc_id: number; error: string }[] = [];
  for (const x of items) {
    if (x.ref) { const r = await setAssigned(tenantId, x.doc_id, x.ref, by, false); if (r === 'ok') done.push({ doc_id: x.doc_id, ref: x.ref }); else failed.push({ doc_id: x.doc_id, error: r === 'not_ready' ? 'Run migration 0116 first.' : 'Document not found.' }); continue; }
    const r = await linkToOrder(tenantId, x.doc_id, String(x.order_id ?? ''), by, false, orders);
    if (r.ok) done.push({ doc_id: x.doc_id, ref: r.ref }); else failed.push({ doc_id: x.doc_id, error: r.error });
  }
  if (done.length) await applyDocs(tenantId);
  return { done, failed };
}
