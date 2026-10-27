// Fin&Ops ▸ Sales orders — the sales rep's register (the workbook "wszystkie zlecenia"): every offer
// sent, whether it was accepted, its value and costs. The accountant then registers what was paid:
// invoices (they live on the Sales tab and attach to the order by its job reference) and cash payments.
//
// Commission (sheet "Zasady Prowizji"): an accepted order counts with its FULL net value in the month
// its first payment is booked; the month's total decides the rate, which applies to the whole month.
import { listExpenses, type ExpenseRow } from './finExpenses';
import { loadTrade, allocatePurchases, type OrderPurchase } from './tradeCosts';
import { db } from './supabase';
import { parseMoney, referenceKey } from './finJobs';
import { parseDate } from './finSales';
import { onlyReady } from './schemaReady';
import { deliveryFields } from './finCustomers';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const ORDER_STATUSES = ['offer', 'accepted', 'lost'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------------------------
//  Order reference → the short code invoices are matched on
// ---------------------------------------------------------------------------------------------
/** The code at the front of an order reference, without the descriptive tail:
 *   "OK DE203065 -Mülheim an der Ruhr- Agnieszka und Tiago" → "OK DE203065"
 *   "Ok-DEUK20250819- 66Nordfield Avenue" → "OK DEUK20250819",  "OK_1240 V1 R1 - ref. J034056P3" → "OK 1240"
 *   "Z.330" / "z 330" → "Z.330",  "J034283P - Timber" → "J034283P".  Anything else: the text before " - ". */
export function orderCode(ref: unknown): string {
  const s = clean(ref);
  if (!s) return '';
  let m = /^Z[.\s]*?(\d+)(?![\d.])/i.exec(s);
  if (m) return 'Z.' + m[1];
  m = /^OK[\s_\-–]*([A-Za-z]{2,6})?[\s_\-–]*(\d{3,}(?:[-/]\d{1,3}(?![\d]))*)/i.exec(s);
  if (m) return ('OK ' + (m[1] ?? '').toUpperCase() + m[2]).replace(/\s+/g, ' ').trim();
  const head = s.split(/\s+[-–]\s+|\s+-|-\s+/)[0].trim();
  return (head || s).slice(0, 60);
}
/** Keys an invoice's job reference can match: the order's own code, its full reference and — once the
 *  order is produced in Orpiszew — its Z number. Compared letters-and-digits only. */
export function orderKeys(o: { order_ref?: string | null; job_ref?: string | null }): string[] {
  const keys = new Set<string>();
  // A key must be specific enough to be an order number: it carries a digit and is not tiny — a
  // reference like "Drzwi" or "EQ" must never collect other orders' invoices.
  for (const v of [orderCode(o.order_ref), clean(o.order_ref), orderCode(o.job_ref), clean(o.job_ref)]) { const k = alnum(v); if (k.length >= 4 && /\d/.test(k)) keys.add(k); }
  return [...keys];
}

// ---------------------------------------------------------------------------------------------
//  Commission rules
// ---------------------------------------------------------------------------------------------
/** Monthly net sales → rate. 300 000 and 450 000 are in the 1% band, 600 000 in the 1.5% band. */
export const COMMISSION_BANDS = [
  { from: 300000, inclusive: true, rate: 0.01 },
  { from: 450000, inclusive: false, rate: 0.015 },
  { from: 600000, inclusive: false, rate: 0.02 },
] as const;
/** Company turnover in the calendar year → the ceiling of the yearly bonus (share of the rep's yearly gross pay). */
export const ANNUAL_BANDS = [
  { from: 3600000, inclusive: true, max: 0.05 },
  { from: 5000000, inclusive: false, max: 0.10 },
  { from: 10000000, inclusive: false, max: 0.15 },
] as const;

function band<T extends { from: number; inclusive: boolean }>(bands: readonly T[], value: number): { index: number; steps: { from: number; missing: number; reached: boolean }[] } {
  let index = -1;
  const steps = bands.map((b, i) => {
    const reached = b.inclusive ? value >= b.from : value > b.from;
    if (reached) index = i;
    // "above 450 000" is first reached at 450 000.01
    const need = b.inclusive ? b.from : round2(b.from + 0.01);
    return { from: b.from, reached, missing: reached ? 0 : round2(need - value) };
  });
  return { index, steps };
}
export interface MonthCommission { sales: number; rate: number; commission: number; band: number; steps: { from: number; rate: number; missing: number; reached: boolean }[] }
export function monthlyCommission(sales: number): MonthCommission {
  const v = round2(Math.max(0, sales)), b = band(COMMISSION_BANDS, v);
  const rate = b.index >= 0 ? COMMISSION_BANDS[b.index].rate : 0;
  return { sales: v, rate, commission: round2(v * rate), band: b.index, steps: b.steps.map((s, i) => ({ ...s, rate: COMMISSION_BANDS[i].rate })) };
}
export interface AnnualBonus { turnover: number; max: number; band: number; steps: { from: number; max: number; missing: number; reached: boolean }[] }
export function annualBonus(turnover: number): AnnualBonus {
  const v = round2(Math.max(0, turnover)), b = band(ANNUAL_BANDS, v);
  return { turnover: v, max: b.index >= 0 ? ANNUAL_BANDS[b.index].max : 0, band: b.index, steps: b.steps.map((s, i) => ({ ...s, max: ANNUAL_BANDS[i].max })) };
}

// ---------------------------------------------------------------------------------------------
//  Orders + what has been paid on them
// ---------------------------------------------------------------------------------------------
export interface OrderRow {
  id: string; rep_user_id: string | null; rep_name: string | null; company: string | null; supplier: string | null; material: string | null;
  customer: string | null; order_ref: string; job_ref: string | null; status: OrderStatus;
  offer_year: number | null; offer_month: number | null; enquiry_month: number | null;
  net: number; cost_purchase: number | null; cost_install: number | null; cost_delivery: number | null;
  planned_year: number | null; planned_month: number | null; first_payment_date: string | null; invoice_refs: string | null;
  note: string | null; comment: string | null;
  // migration 0111 — missing before it runs
  customer_id?: string | null; delivery_address?: Record<string, string | null> | null; enquiry_date?: string | null;
  requested_date?: string | null; requested_month_only?: boolean; confirmed_date?: string | null;
}
export interface SaleLite { id: string; invoice_no: string | null; invoice_date: string | null; job_key: string | null; net: number; kind: string; period_year: number | null; period_month: number | null }
export interface PaymentRow { id: string; order_id: string; paid_date: string; amount: number; note: string | null }
export interface OrderView extends OrderRow {
  code: string; costs: number; margin: number | null;
  invoices: SaleLite[]; payments: PaymentRow[]; invoiced: number; cash: number; paid: number;
  counted_date: string | null;         // the day the order starts counting for commission (null = not yet)
  counted_from: 'manual' | 'invoice' | 'cash' | null;
  expenses: ExpenseRow[];              // cost reports from the fitters, newest first
  cost_reports_paid: number;           // paid reports — added to the installation cost
  cost_reports_open: number;           // submitted + approved, not in the costs yet
  purchases: OrderPurchase[];          // the supplier's invoice lines for this order (monday, KSeF PDF)
  actual_purchase: number | null;      // their total — null while no purchase invoice is known
  actual_costs: number | null;         // actual purchase + installation + delivery
  actual_margin: number | null;
}

/** Attach invoices (by job reference or by an invoice number noted on the order) and cash payments,
 *  and work out when the order starts to count. */
export function buildOrderViews(orders: OrderRow[], sales: SaleLite[], payments: PaymentRow[], expenses: ExpenseRow[] = [], purchases: OrderPurchase[] = []): OrderView[] {
  const byKey = new Map<string, SaleLite[]>(), byNo = new Map<string, SaleLite[]>();
  for (const s of sales) {
    if (s.job_key) { const k = alnum(s.job_key); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s); }
    if (s.invoice_no) { const k = alnum(s.invoice_no); (byNo.get(k) ?? byNo.set(k, []).get(k)!).push(s); }
  }
  const payBy = new Map<string, PaymentRow[]>();
  for (const p of payments) (payBy.get(p.order_id) ?? payBy.set(p.order_id, []).get(p.order_id)!).push(p);
  const purBy = new Map<string, OrderPurchase[]>();
  for (const pu of purchases) (purBy.get(pu.order_key) ?? purBy.set(pu.order_key, []).get(pu.order_key)!).push(pu);
  const expBy = new Map<string, ExpenseRow[]>();
  for (const e of expenses) (expBy.get(e.order_id) ?? expBy.set(e.order_id, []).get(e.order_id)!).push(e);
  const views: OrderView[] = orders.map((o) => {
    const found = new Map<string, SaleLite>();
    for (const k of orderKeys(o)) for (const s of byKey.get(k) ?? []) found.set(s.id, s);
    for (const no of clean(o.invoice_refs).split(/[,;]+/)) { const k = alnum(no); if (k.length >= 3) for (const s of byNo.get(k) ?? []) found.set(s.id, s); }
    const invoices = [...found.values()].sort((a, b) => String(a.invoice_date ?? '9').localeCompare(String(b.invoice_date ?? '9')));
    const pays = (payBy.get(o.id) ?? []).slice().sort((a, b) => a.paid_date.localeCompare(b.paid_date));
    const invoiced = round2(invoices.reduce((s, r) => s + (Number(r.net) || 0), 0)), cash = round2(pays.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const firstInv = invoices.map((r) => r.invoice_date).filter((d): d is string => !!d).sort()[0] ?? null;
    const firstCash = pays[0]?.paid_date ?? null;
    let counted_date: string | null = null; let counted_from: OrderView['counted_from'] = null;
    if (o.first_payment_date) { counted_date = o.first_payment_date; counted_from = 'manual'; }
    else if (firstInv && (!firstCash || firstInv <= firstCash)) { counted_date = firstInv; counted_from = 'invoice'; }
    else if (firstCash) { counted_date = firstCash; counted_from = 'cash'; }
    // budget = the costs typed on the order; the fitters' paid cost reports are actuals and count only on the actual side
    const exps = (expBy.get(o.id) ?? []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const sumOf = (st: string[]) => round2(exps.filter((e) => st.includes(e.status)).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    const cost_reports_paid = sumOf(['paid']);
    const costs = round2((o.cost_purchase ?? 0) + (o.cost_install ?? 0) + (o.cost_delivery ?? 0));
    return { ...o, code: orderCode(o.job_ref) || orderCode(o.order_ref), costs, margin: o.net ? round2((o.net - costs) / o.net) : null,
      invoices, payments: pays, invoiced, cash, paid: round2(invoiced + cash), counted_date, counted_from,
      expenses: exps, cost_reports_paid, cost_reports_open: sumOf(['submitted', 'approved']), ...actual(o, cost_reports_paid) };
  });
  // the actual side: what the suppliers invoiced for this order (matched by the order's own codes)
  function actual(o: OrderRow, paidReports: number) {
    const seen = new Set<OrderPurchase>(); const mine: OrderPurchase[] = [];
    for (const k of orderKeys(o)) for (const pu of purBy.get(k) ?? []) if (!seen.has(pu)) { seen.add(pu); mine.push(pu); }
    if (!mine.length) return { purchases: [], actual_purchase: null, actual_costs: null, actual_margin: null };
    const actual_purchase = round2(mine.reduce((s, x) => s + x.net, 0));
    const actual_costs = round2(actual_purchase + (o.cost_install ?? 0) + paidReports + (o.cost_delivery ?? 0));
    return { purchases: mine.sort((a, b) => String(a.invoice_date ?? '').localeCompare(String(b.invoice_date ?? ''))), actual_purchase, actual_costs, actual_margin: o.net ? round2((o.net - actual_costs) / o.net) : null };
  }
  return views;
}

export interface CommissionMonth extends MonthCommission { month: number; orders: { id: string; code: string; customer: string | null; net: number; date: string }[] }
export interface CommissionYear {
  year: number; months: CommissionMonth[]; total: { sales: number; commission: number };
  waiting: { count: number; net: number };       // accepted, nothing paid yet — will count when the first payment is booked
  open: { count: number; net: number };          // offers still to be accepted
}
/** A rep's commission, month by month. An order counts only when it is accepted and has started to count. */
export function commissionYear(orders: OrderView[], year: number): CommissionYear {
  const buckets: CommissionMonth['orders'][] = Array.from({ length: 12 }, () => []);
  const waiting = { count: 0, net: 0 }, open = { count: 0, net: 0 };
  for (const o of orders) {
    if (o.status === 'offer') { if (o.offer_year === year) { open.count++; open.net = round2(open.net + o.net); } continue; }
    if (o.status !== 'accepted') continue;
    if (!o.counted_date) { waiting.count++; waiting.net = round2(waiting.net + o.net); continue; }
    if (+o.counted_date.slice(0, 4) !== year) continue;
    buckets[+o.counted_date.slice(5, 7) - 1].push({ id: o.id, code: o.code, customer: o.customer, net: o.net, date: o.counted_date });
  }
  const months = buckets.map((list, i) => ({ month: i + 1, orders: list.sort((a, b) => a.date.localeCompare(b.date) || b.net - a.net), ...monthlyCommission(list.reduce((s, x) => s + x.net, 0)) }));
  return { year, months, waiting, open, total: { sales: round2(months.reduce((s, m) => s + m.sales, 0)), commission: round2(months.reduce((s, m) => s + m.commission, 0)) } };
}

// ---------------------------------------------------------------------------------------------
//  Input → stored fields
// ---------------------------------------------------------------------------------------------
const MONTH_STEMS = ['stycz', 'lut', 'marz', 'kwie', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'pazdz', 'listop', 'grud'];
const EN_STEMS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Month from a number, a date or a (possibly misspelt) Polish/English name; "Lipiec/Sierpień" → the first. */
export function monthFromText(v: unknown): number | null {
  const s = clean(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').split('/')[0].trim();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) { const n = +s; return n >= 1 && n <= 12 ? n : null; }
  const d = parseDate(v); if (d) return +d.slice(5, 7);
  const i = MONTH_STEMS.findIndex((m) => s.startsWith(m)); if (i >= 0) return i + 1;
  const j = EN_STEMS.findIndex((m) => s.startsWith(m)); return j >= 0 ? j + 1 : null;
}
const statusFrom = (v: unknown): OrderStatus => { const s = clean(v).toLowerCase(); return /^(accepted|zaakcept)/.test(s) ? 'accepted' : /^(lost|odrzuc|przegr|anul|rezygn)/.test(s) ? 'lost' : 'offer'; };
/** A day typed as dd-mm-yy (the form), dd-mm-yyyy, dd.mm.yyyy or yyyy-mm-dd. */
export function parseDay(v: unknown): string | null {
  const s = clean(v);
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(s);
  return parseDate(m ? `${m[1]}-${m[2]}-20${m[3]}` : s);
}
/** The materials ticked on the form → one text, always in the same order: "PVC, Alu". Old "Wood" is Timber. */
export const MATERIALS = ['PVC', 'Alu', 'Timber'] as const;
export function materialText(v: unknown): string | null {
  const list = (Array.isArray(v) ? v : clean(v).split(/\s*[,+/;&]\s*|\s+i\s+|\s+and\s+/i)).map(clean).filter(Boolean);
  const known: string[] = [], other: string[] = [];
  for (const x of list) {
    const k = /^(wood|drewn|timber|drewno)/i.test(x) ? 'Timber' : MATERIALS.find((m) => m.toLowerCase() === x.toLowerCase());
    if (k) { if (!known.includes(k)) known.push(k); } else if (!other.includes(x)) other.push(x);
  }
  const out = [...MATERIALS.filter((m) => known.includes(m)), ...other].join(', ');
  return out.slice(0, 40) || null;
}
/** The columns added by migrations 0108 and 0111 — dropped from a write while their migration has not run. */
export const ORDER_NEW_COLS = ['vendor_quote', 'customer_id', 'delivery_address', 'enquiry_date', 'requested_date', 'requested_month_only', 'confirmed_date'];
const intIn = (v: unknown, lo: number, hi: number): number | null => { const n = parseMoney(v); return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

/** Form input → the stored fields. `finance` = may set what only the accountant/admin controls
 *  (the production job number and the "counts from" date). */
export function orderFields(b: any, finance: boolean): Result<{ fields: Record<string, any> }> {
  const ref = clean(b.order_ref).slice(0, 200);
  if (!ref) return fail(400, 'Enter the order number or name.');
  const net = parseMoney(b.net) ?? 0;
  if (net < 0) return fail(400, 'Amounts cannot be negative.');
  const money = (v: unknown) => { const n = parseMoney(v); return n === null ? null : n; };
  const costs = [money(b.cost_purchase), money(b.cost_install), money(b.cost_delivery)];
  if (costs.some((c) => c !== null && c < 0)) return fail(400, 'Amounts cannot be negative.');
  const oy = intIn(b.offer_year, 2000, 2100), py = intIn(b.planned_year, 2000, 2100);
  const fields: Record<string, any> = {
    order_ref: ref, order_key: referenceKey(ref).slice(0, 200),
    company: clean(b.company).slice(0, 60) || null, supplier: clean(b.supplier).slice(0, 60) || null, material: materialText(b.material),
    customer: clean(b.customer).slice(0, 160) || null,
    status: ORDER_STATUSES.includes(b.status) ? b.status : statusFrom(b.status),
    offer_year: oy, offer_month: monthFromText(b.offer_month), enquiry_month: monthFromText(b.enquiry_month),
    net, cost_purchase: costs[0], cost_install: costs[1], cost_delivery: costs[2],
    planned_year: py, planned_month: monthFromText(b.planned_month),
    note: clean(b.note).slice(0, 500) || null, comment: clean(b.comment).slice(0, 500) || null,
  };
  // the vendor's quote for the trade scenario (a link or a note) — only when the form sends it
  if ('vendor_quote' in (b ?? {})) fields.vendor_quote = clean(b.vendor_quote).slice(0, 500) || null;
  // the order form (migration 0111) — only when sent, so the imports never clear them
  if ('customer_id' in b) { const id = clean(b.customer_id); fields.customer_id = /^[0-9a-f-]{36}$/i.test(id) ? id : null; }
  if ('delivery' in b) { const d = deliveryFields(b.delivery); if (!d.ok) return d; fields.delivery_address = d.address; }
  if ('enquiry_date' in b) {
    const raw = clean(b.enquiry_date), d = raw ? parseDay(raw) : null;
    if (raw && !d) return fail(400, 'The enquiry date is not a date (dd-mm-yy).');
    fields.enquiry_date = d;
    if (d) fields.enquiry_month = +d.slice(5, 7);
  }
  if ('requested_date' in b || 'confirmed_date' in b) {
    const monthOnly = b.requested_month_only === true;
    const rq = clean(b.requested_date);
    // a month is sent as yyyy-mm and kept as its 1st
    const req = rq ? (monthOnly && /^\d{4}-\d{1,2}$/.test(rq) ? parseDate(rq + '-01') : parseDay(rq)) : null;
    if (rq && !req) return fail(400, monthOnly ? 'The requested realisation month is not a month.' : 'The requested realisation date is not a date (dd-mm-yy).');
    const cf = clean(b.confirmed_date), conf = cf ? parseDay(cf) : null;
    if (cf && !conf) return fail(400, 'The confirmed realisation date is not a date (dd-mm-yy).');
    fields.requested_date = req; fields.requested_month_only = !!req && monthOnly;
    // confirmed only once the order is accepted (step B: once a quote is approved)
    fields.confirmed_date = fields.status === 'accepted' ? conf : null;
    // planning (expense window, Performance) reads the month: confirmed first, else requested
    const when = fields.confirmed_date ?? req;
    fields.planned_year = when ? +when.slice(0, 4) : null; fields.planned_month = when ? +when.slice(5, 7) : null;
  }
  if (finance) {
    const job = clean(b.job_ref).slice(0, 80);
    fields.job_ref = job || null;
    fields.invoice_refs = clean(b.invoice_refs).slice(0, 300) || null;
    const raw = clean(b.first_payment_date);
    const d = raw ? parseDate(raw) : null;
    if (raw && !d) return fail(400, 'The “counts from” date is not a date.');
    fields.first_payment_date = d;
  }
  return { ok: true, fields };
}

/** One pasted row of the workbook sheet (columns A–W, see the header) → an order. `fallbackYear` is
 *  used for rows whose "Rok" is empty (the workbook only started filling the year in 2026).
 *  A paid prepayment given only as a month becomes the 1st of that month — in the offer's year, or
 *  the next one when the month is earlier than the offer's. */
export function importRowToOrder(cells: unknown[], fallbackYear: number): { fields: Record<string, any> } | null {
  const c = (i: number) => clean(cells[i]);
  const ref = c(7), customer = c(4);
  if (!ref && !customer) return null;                                   // spacer rows at the bottom of the sheet
  if (/^numer oferty$/i.test(ref) || /^lp$/i.test(c(0))) return null;   // the header row
  const year = intIn(c(22), 2000, 2100) ?? fallbackYear;
  const offerMonth = monthFromText(c(6)) ?? monthFromText(c(5));
  const paidYes = /^(tak|yes|y|t)$/i.test(c(17));
  let first: string | null = null;
  if (paidYes) {
    const exact = parseDate(c(18)), m = monthFromText(c(18)) ?? offerMonth;
    if (exact) first = exact;
    else if (m) first = `${offerMonth && m < offerMonth ? year + 1 : year}-${String(m).padStart(2, '0')}-01`;
  }
  const plannedMonth = monthFromText(c(21));
  const f = orderFields({
    order_ref: ref || customer, company: c(1), supplier: c(2), material: c(3), customer,
    enquiry_month: c(5), offer_month: offerMonth, offer_year: year, status: c(9), net: c(10),
    note: c(11), cost_purchase: c(12), cost_install: c(13), cost_delivery: c(14), comment: c(19),
    planned_month: plannedMonth, planned_year: plannedMonth ? (offerMonth && plannedMonth < offerMonth ? year + 1 : year) : null,
    invoice_refs: c(8), first_payment_date: first,
  }, true);
  return f.ok ? { fields: f.fields } : null;
}
/** What makes two rows "the same order" on import: the reference and the value (an offer re-sent with
 *  a new price is a new line in the workbook too). */
export const importKey = (f: { order_key: string; net: number; customer?: string | null }) => `${f.order_key}|${Number(f.net).toFixed(2)}|${alnum(clean(f.customer))}`;

// ---------------------------------------------------------------------------------------------
//  Database
// ---------------------------------------------------------------------------------------------
const num = (v: any) => (v === null || v === undefined ? null : Number(v));
const rowOut = (r: any): OrderRow => ({ ...r, net: Number(r.net) || 0, cost_purchase: num(r.cost_purchase), cost_install: num(r.cost_install), cost_delivery: num(r.cost_delivery) });

async function page<T>(table: string, cols: string, tenantId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** Every order with its invoices and payments. `repUserId` limits it to one rep (a rep sees only their own). */
export async function listOrderViews(tenantId: string, repUserId?: string | null): Promise<OrderView[]> {
  const [orders, sales, pays, exps, trade] = await Promise.all([
    page<any>('fin_orders', '*', tenantId),
    page<any>('fin_sales', 'id,invoice_no,invoice_date,job_key,net,kind,period_year,period_month', tenantId),
    page<any>('fin_order_payments', 'id,order_id,paid_date,amount,note', tenantId),
    listExpenses(tenantId),
    loadTrade(tenantId),
  ]);
  const mine = repUserId ? orders.filter((o) => o.rep_user_id === repUserId) : orders;
  return buildOrderViews(mine.map(rowOut), sales.map((s) => ({ ...s, net: Number(s.net) || 0 })), pays.map((p) => ({ ...p, amount: Number(p.amount) || 0 })), exps, tradeAllocation(orders.map(rowOut), trade).purchases);
}
/** Trade purchase invoices split by order, judged against the whole register (not one rep's part of it). */
export function tradeAllocation(orders: OrderRow[], trade: Awaited<ReturnType<typeof loadTrade>>) {
  const keys = new Set<string>(); for (const o of orders) for (const k of orderKeys(o)) keys.add(k);
  return allocatePurchases(trade.invoices, trade.lines, (code) => orderKeys({ order_ref: code }).some((k) => keys.has(k)));
}
/** The trade purchase invoices that need an order number written in monday's "Zlecenie" column. */
export async function tradeToCheck(tenantId: string) {
  const [orders, trade] = await Promise.all([page<any>('fin_orders', '*', tenantId), loadTrade(tenantId)]);
  const r = tradeAllocation(orders.map(rowOut), trade);
  return { toCheck: r.toCheck, invoices: trade.invoices.length, read: trade.invoices.filter((i) => i.pdf_status === 'ok').length };
}
/** Company turnover for the yearly bonus: net of all sales invoices counted in the year (Sales tab). */
export async function companyTurnover(tenantId: string, year: number): Promise<number> {
  const rows = await page<any>('fin_sales', 'net,period_year', tenantId);
  return round2(rows.filter((r) => r.period_year === year).reduce((s, r) => s + (Number(r.net) || 0), 0));
}

export async function getOrder(tenantId: string, id: string): Promise<any | null> {
  const { data, error } = await db().from('fin_orders').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
export async function createOrder(tenantId: string, by: string, b: any, o: { finance: boolean; repUserId: string | null; repName: string | null }): Promise<Result<{ id: string }>> {
  const f = orderFields(b, o.finance); if (!f.ok) return f;
  const fields = await onlyReady('fin_orders', f.fields, ORDER_NEW_COLS);   // before migration 0108 the vendor quote is not kept
  const { data, error } = await db().from('fin_orders').insert({ tenant_id: tenantId, created_by: by, rep_user_id: o.repUserId, rep_name: o.repName, ...fields }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}
export async function updateOrder(tenantId: string, id: string, b: any, o: { finance: boolean; ownerOnly?: string | null; rep?: { id: string | null; name: string | null } }): Promise<Result> {
  const cur = await getOrder(tenantId, id);
  if (!cur || (o.ownerOnly && cur.rep_user_id !== o.ownerOnly)) return fail(404, 'Order not found.');
  const f = orderFields(b, o.finance); if (!f.ok) return f;
  const patch: Record<string, any> = { ...(await onlyReady('fin_orders', f.fields, ORDER_NEW_COLS)), updated_at: new Date().toISOString() };
  if (o.rep) { patch.rep_user_id = o.rep.id; patch.rep_name = o.rep.name; }
  const { error } = await db().from('fin_orders').update(patch).eq('tenant_id', tenantId).eq('id', id);
  if (error) throw error;
  return { ok: true };
}
export async function deleteOrders(tenantId: string, ids: string[], ownerOnly?: string | null): Promise<{ deleted: number }> {
  const uniq = [...new Set(ids.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  let deleted = 0;
  for (let i = 0; i < uniq.length; i += 100) {
    let q = db().from('fin_orders').delete().eq('tenant_id', tenantId).in('id', uniq.slice(i, i + 100));
    if (ownerOnly) q = q.eq('rep_user_id', ownerOnly);
    const { data, error } = await q.select('id');
    if (error) throw error;
    deleted += (data ?? []).length;
  }
  return { deleted };
}
export async function addPayment(tenantId: string, by: string, orderId: string, b: any): Promise<Result<{ id: string }>> {
  if (!(await getOrder(tenantId, orderId))) return fail(404, 'Order not found.');
  const amount = parseMoney(b.amount), date = parseDate(b.paid_date);
  if (amount === null || amount <= 0) return fail(400, 'Enter the amount paid.');
  if (!date) return fail(400, 'Enter the date it was paid.');
  const { data, error } = await db().from('fin_order_payments').insert({ tenant_id: tenantId, order_id: orderId, paid_date: date, amount, note: clean(b.note).slice(0, 300) || null, created_by: by }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}
export async function deletePayment(tenantId: string, id: string): Promise<Result> {
  const { data, error } = await db().from('fin_order_payments').delete().eq('tenant_id', tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  return data ? { ok: true } : fail(404, 'Payment not found.');
}

export interface ImportReport { added: number; skipped: number; invalid: number; accepted: number; paid: number; withInvoices: number; invoiceRefsNotFound: string[] }
/** Parse pasted rows and say what an import would do — and, with `write`, do it. Rows already in the
 *  register (see importKey) are skipped, so pasting the sheet twice is safe. The report cross-checks
 *  against the Sales tab: how many orders already have invoices there, and which invoice numbers
 *  written in the sheet are not on the Sales tab. */
export async function importOrders(tenantId: string, by: string, rows: unknown[][], o: { fallbackYear: number; repUserId: string | null; repName: string | null; write: boolean }): Promise<ImportReport> {
  const existing = await page<any>('fin_orders', 'order_key,net,customer', tenantId);
  const have = new Set(existing.map((r) => importKey({ ...r, net: Number(r.net) || 0 })));
  const sales = (await page<any>('fin_sales', 'id,invoice_no,invoice_date,job_key,net,kind,period_year,period_month', tenantId)).map((s) => ({ ...s, net: Number(s.net) || 0 }));
  const saleNos = new Set(sales.map((s) => alnum(clean(s.invoice_no))).filter(Boolean));
  const fresh: Record<string, any>[] = []; let skipped = 0, invalid = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.every((x) => !clean(x))) continue;
    const p = importRowToOrder(r, o.fallbackYear);
    if (!p) { invalid++; continue; }
    const k = importKey(p.fields as any);
    if (have.has(k)) { skipped++; continue; }
    have.add(k); fresh.push(p.fields);
  }
  const views = buildOrderViews(fresh.map((f, i) => rowOut({ id: 'new' + i, rep_user_id: null, rep_name: null, job_ref: null, ...f })), sales, []);
  const notFound = new Set<string>();
  for (const f of fresh) for (const no of clean(f.invoice_refs).split(/[,;]+/)) { const k = alnum(no); if (k.length >= 3 && !saleNos.has(k)) notFound.add(clean(no)); }
  const report: ImportReport = {
    added: fresh.length, skipped, invalid,
    accepted: fresh.filter((f) => f.status === 'accepted').length, paid: fresh.filter((f) => !!f.first_payment_date).length,
    withInvoices: views.filter((v) => v.invoices.length > 0).length, invoiceRefsNotFound: [...notFound].slice(0, 60),
  };
  if (o.write) {
    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await db().from('fin_orders').insert(fresh.slice(i, i + 200).map((f) => ({ tenant_id: tenantId, created_by: by, rep_user_id: o.repUserId, rep_name: o.repName, ...f })));
      if (error) throw error;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
//  One catalogue of order numbers for Sales orders, the Sales tab and Job costs
// ---------------------------------------------------------------------------------------------
export interface OrderCatalogue {
  codes: { value: string; label: string }[];   // what to suggest when typing a Job: order codes and Z numbers
  keys: string[];                              // every key an invoice's Job can match (letters and digits only)
  invoiceKeys: string[];                       // invoice numbers noted on orders
  jobs: string[];                              // Job costs references (for the order's Z number)
}
export function buildCatalogue(orders: { order_ref: string; job_ref: string | null; customer: string | null; invoice_refs: string | null }[], jobRefs: string[]): OrderCatalogue {
  const codes = new Map<string, string>(), keys = new Set<string>(), invoiceKeys = new Set<string>();
  for (const o of orders) {
    for (const k of orderKeys(o)) keys.add(k);
    const label = [clean(o.customer), clean(o.order_ref)].filter(Boolean).join(' · ').slice(0, 120);
    for (const v of [orderCode(o.job_ref), orderCode(o.order_ref)]) if (v && alnum(v).length >= 4 && /\d/.test(v) && !codes.has(v)) codes.set(v, label);
    for (const no of clean(o.invoice_refs).split(/[,;]+/)) { const k = alnum(no); if (k.length >= 3) invoiceKeys.add(k); }
  }
  const jobs = [...new Set(jobRefs.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return {
    codes: [...codes].map(([value, label]) => ({ value, label })).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' })),
    keys: [...keys], invoiceKeys: [...invoiceKeys], jobs,
  };
}
export async function orderCatalogue(tenantId: string): Promise<OrderCatalogue> {
  const [orders, jobs] = await Promise.all([
    page<any>('fin_orders', 'order_ref,job_ref,customer,invoice_refs', tenantId),
    page<any>('fin_jobs', 'reference', tenantId),
  ]);
  return buildCatalogue(orders, jobs.map((j) => j.reference));
}
