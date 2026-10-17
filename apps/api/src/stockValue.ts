// Fin&Ops ▸ Stock value: what the stock in Subiekt nexo is worth and how old it is. The Subiekt
// agent sends the open delivery lots (what is left of each delivery, its unit purchase cost and
// the date of the original delivery); they are kept as the latest snapshot (subiekt_lots) and
// summed into one history row per day × warehouse × group × supplier (subiekt_stock_history), so
// month-ends can be looked at later.
// The value is FIFO purchase cost, as Subiekt's "Remanent na dzień" (reconciled product by product
// in October 2026). A purchase cost correction in Subiekt holds the new full value of the receipt:
// the agent takes the latest entry, it does not add corrections up.
// Age = days between the original delivery and the snapshot day; a transfer between warehouses
// keeps the original delivery date (the agent resolves it).
import { db } from './supabase';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numOrNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const dateOrNull = (v: unknown) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')); return m ? m[1] : null; };
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Lot {
  lot_id: number; product_id: number; symbol: string; name: string | null; grp: string | null; supplier: string | null;
  unit: string | null; warehouse: string; qty: number; unit_cost: number | null; received: string | null; last_issue: string | null;
}
export function lotFromAgent(r: any): Lot | null {
  const lot_id = Number(r?.lot), product_id = Number(r?.product_id), symbol = clean(r?.symbol), qty = numOrNull(r?.qty);
  if (!Number.isInteger(lot_id) || lot_id <= 0 || !Number.isInteger(product_id) || product_id <= 0 || !symbol || qty === null || qty <= 0) return null;
  return {
    lot_id, product_id, symbol: symbol.slice(0, 80), name: clean(r.name).slice(0, 200) || null, grp: clean(r.grp).slice(0, 80) || null,
    supplier: clean(r.supplier).slice(0, 120) || null, unit: clean(r.unit).slice(0, 30) || null, warehouse: clean(r.warehouse).slice(0, 60),
    qty, unit_cost: numOrNull(r.unit_cost), received: dateOrNull(r.received), last_issue: dateOrNull(r.last_issue),
  };
}

// ---- ageing ------------------------------------------------------------------------------------
/** The age buckets: 0–90 days, 91–180, 181–365, 1–2 years, over 2 years. */
export const BUCKETS = ['0–90 d', '91–180 d', '181–365 d', '1–2 y', '> 2 y'] as const;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
/** The bucket of a lot received on `received`, seen on `day` (no date → the oldest bucket: unknown age is not new). */
export function bucketOf(received: string | null, day: string): number {
  if (!received) return 4;
  const d = daysBetween(received, day);
  return d <= 90 ? 0 : d <= 180 ? 1 : d <= 365 ? 2 : d <= 730 ? 3 : 4;
}
export const lotValue = (l: Pick<Lot, 'qty' | 'unit_cost'>) => (l.unit_cost === null ? 0 : l.qty * l.unit_cost);

export interface HistoryRow { day: string; warehouse: string; grp: string; supplier: string; products: number; value: number; b0: number; b1: number; b2: number; b3: number; b4: number }
/** One history row per warehouse × group × supplier for `day`. */
export function summarise(lots: Lot[], day: string): HistoryRow[] {
  const by = new Map<string, HistoryRow & { _p: Set<number> }>();
  for (const l of lots) {
    const k = [l.warehouse, l.grp ?? '', l.supplier ?? ''].join('\u0001');
    let r = by.get(k);
    if (!r) by.set(k, (r = { day, warehouse: l.warehouse, grp: l.grp ?? '', supplier: l.supplier ?? '', products: 0, value: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, _p: new Set() }));
    const v = lotValue(l), b = bucketOf(l.received, day);
    r.value += v; (r as any)['b' + b] += v; r._p.add(l.product_id);
  }
  return [...by.values()].map(({ _p, ...r }) => ({ ...r, products: _p.size, value: round2(r.value), b0: round2(r.b0), b1: round2(r.b1), b2: round2(r.b2), b3: round2(r.b3), b4: round2(r.b4) }));
}
/** The warehouse value of the one total row written per day (lists the days cheaply). */
export const TOTAL = '*';
/** Today in Poland (the history day). */
export const polishDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d);

// ---- storage -----------------------------------------------------------------------------------
async function all<T>(table: string, cols: string, tenantId: string, order: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from(table).select(cols).eq('tenant_id', tenantId);
    if (filter) q = filter(q);
    const { data, error } = await q.order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** A full snapshot of the open lots: stored (lots no longer open are dropped) and today's history replaced. */
export async function receiveLots(tenantId: string, body: any): Promise<{ ok: true; lots: number; value: number } | { ok: false; status: number; error: string }> {
  const raw: any[] = Array.isArray(body?.lots) ? body.lots : [];
  const lots = raw.map(lotFromAgent).filter((l): l is Lot => !!l);
  if (!raw.length || lots.length < raw.length * 0.9) return { ok: false, status: 400, error: 'The lots snapshot is empty or malformed; nothing was changed.' };
  const have = await all<any>('subiekt_lots', 'lot_id', tenantId, 'lot_id');
  if (have.length > 500 && lots.length < have.length * 0.5) return { ok: false, status: 409, error: 'The lots snapshot has far fewer lots than last time; nothing was changed.' };
  const now = new Date().toISOString(), uniq = [...new Map(lots.map((l) => [l.lot_id, l])).values()];
  for (let i = 0; i < uniq.length; i += 500) {
    const { error } = await db().from('subiekt_lots').upsert(uniq.slice(i, i + 500).map((l) => ({ tenant_id: tenantId, ...l, synced_at: now })), { onConflict: 'tenant_id,lot_id' });
    if (error) throw error;
  }
  const keep = new Set(uniq.map((l) => l.lot_id)), gone = have.map((h) => Number(h.lot_id)).filter((id) => !keep.has(id));
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await db().from('subiekt_lots').delete().eq('tenant_id', tenantId).in('lot_id', gone.slice(i, i + 200));
    if (error) throw error;
  }
  const day = polishDay(), hist = summarise(uniq, day);
  const t = summarise(uniq.map((l) => ({ ...l, warehouse: TOTAL, grp: null, supplier: null })), day);
  hist.push(...t);
  { const { error } = await db().from('subiekt_stock_history').delete().eq('tenant_id', tenantId).eq('day', day); if (error) throw error; }
  for (let i = 0; i < hist.length; i += 500) {
    const { error } = await db().from('subiekt_stock_history').insert(hist.slice(i, i + 500).map((h) => ({ tenant_id: tenantId, ...h })));
    if (error) throw error;
  }
  return { ok: true, lots: uniq.length, value: round2(uniq.reduce((a, l) => a + lotValue(l), 0)) };
}

// ---- what the page shows -----------------------------------------------------------------------
/** The latest lots (compact) and the days that have history. Products are listed once; a lot is
 *  [product index, warehouse, qty, unit cost, received, last issue]. */
export async function stockView(tenantId: string) {
  const lots = await all<any>('subiekt_lots', 'lot_id,product_id,symbol,name,grp,supplier,unit,warehouse,qty,unit_cost,received,last_issue,synced_at', tenantId, 'lot_id');
  const products: any[] = [], pix = new Map<number, number>();
  const rows = lots.map((l) => {
    const pid = Number(l.product_id);
    let i = pix.get(pid);
    if (i === undefined) { i = products.length; pix.set(pid, i); products.push([pid, l.symbol, l.name, l.grp, l.supplier, l.unit]); }
    return [i, l.warehouse, Number(l.qty), l.unit_cost === null ? null : Number(l.unit_cost), l.received, l.last_issue];
  });
  const synced = lots.reduce((a: string | null, l: any) => (!a || l.synced_at > a ? l.synced_at : a), null);
  return { products, lots: rows, syncedAt: synced, day: synced ? polishDay(new Date(synced)) : null, historyDays: await historyDays(tenantId) };
}
/** The days with history (one total row each, warehouse '*'): the last 40 days and every month-end, newest first. */
export async function historyDays(tenantId: string): Promise<string[]> {
  const days = (await all<any>('subiekt_stock_history', 'day', tenantId, 'day', (q) => q.eq('warehouse', TOTAL))).map((r) => String(r.day)).sort().reverse();
  const lastOfMonth = new Map<string, string>();
  for (const d of days) if (!lastOfMonth.has(d.slice(0, 7))) lastOfMonth.set(d.slice(0, 7), d);
  const keep = new Set([...days.slice(0, 40), ...lastOfMonth.values()]);
  return days.filter((d) => keep.has(d));
}
export async function historyFor(tenantId: string, day: string): Promise<HistoryRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const rows = await all<any>('subiekt_stock_history', 'day,warehouse,grp,supplier,products,value,b0,b1,b2,b3,b4', tenantId, 'warehouse', (q) => q.eq('day', day).neq('warehouse', TOTAL));
  return rows.map((r) => ({ ...r, day: String(r.day), products: Number(r.products), value: Number(r.value), b0: Number(r.b0), b1: Number(r.b1), b2: Number(r.b2), b3: Number(r.b3), b4: Number(r.b4) }));
}
