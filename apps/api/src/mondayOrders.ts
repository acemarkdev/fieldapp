// Fin&Ops ▸ Sales orders ◂ monday board "PRODUCTION ACEMARK PL": an item named "Z.453 -OK PL203173 -PCW - J035030P"
// says sales order OK PL203173 is produced as Z.453. A button on Sales orders reads the board, shows what it would
// do (preview), and writes only the ticked rows:
//   • one sales order with that OK code and no Z number yet → its Z number is filled (Z.453);
//   • the order already has this Z → left alone; a different Z → listed, never overwritten;
//   • no order / several orders with that OK code, the OK code on several items (phases), the Z on the board more
//     than once (Z.102_FAZA_1 / _FAZA_2) or already on another order → listed for a person to decide.
import { db } from './supabase';
import { Monday } from './monday';
import { PRODUCTION_BOARD, zNumber } from './mondayJobs';
import { orderCode } from './finOrders';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The OK order code written after the Z on a board item: "Z.453 -OK PL203173 -PCW" → "OK PL203173",
 *  "Z.455 - OK_PL203078_-_Lumio_Glass" → "OK PL203078", "Z.374 - OK - DEPL20250805-1 - Dusseldorf" → "OK DEPL20250805-1".
 *  "Haywards Heath - Okna" or a name without an OK number → null. */
export function okCodeIn(name: unknown): string | null {
  const s = clean(name);
  const re = /(^|[^A-Za-z])OK/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const code = orderCode(s.slice(m.index + m[1].length));
    if (/^OK [A-Z]{0,6}\d{3,}/.test(code)) return code;
  }
  return null;
}

export interface ZBoardItem { id: string; name: string; created: string | null }
export interface ZOrder { id: string; order_ref: string; job_ref: string | null; customer: string | null; status: string; rep_name: string | null }
export type ZRowStatus = 'fill' | 'same' | 'conflict' | 'no_order' | 'several_orders' | 'several_items' | 'z_taken';
export interface ZRow extends ZBoardItem {
  z: string; ok: string; status: ZRowStatus;
  orderId: string | null; orderRef: string | null; customer: string | null; orderStatus: string | null; rep: string | null;
  current: string | null;   // the Z the order has now (conflict / same)
  why: string | null;       // why it is not filled, for the screen
}

/** The board items that carry an OK code against the sales orders. Pure: the same input always gives the same plan. */
export function planZLinks(items: ZBoardItem[], orders: ZOrder[]): ZRow[] {
  const zOnBoard = new Map<number, number>(), okOnBoard = new Map<string, number>();
  const parsed = items.map((it) => ({ it, n: zNumber(it.name), ok: okCodeIn(it.name) }));
  for (const p of parsed) {
    if (p.n !== null) zOnBoard.set(p.n, (zOnBoard.get(p.n) ?? 0) + 1);
    if (p.n !== null && p.ok) okOnBoard.set(alnum(p.ok), (okOnBoard.get(alnum(p.ok)) ?? 0) + 1);
  }
  const byCode = new Map<string, ZOrder[]>(), byZ = new Map<string, ZOrder[]>();
  for (const o of orders) {
    const c = alnum(orderCode(o.order_ref));
    if (c.startsWith('OK')) { const a = byCode.get(c); if (a) a.push(o); else byCode.set(c, [o]); }
    const z = zNumber(o.job_ref);
    if (z !== null) { const k = 'Z.' + z, a = byZ.get(k); if (a) a.push(o); else byZ.set(k, [o]); }
  }
  const out: ZRow[] = [];
  for (const { it, n, ok } of parsed) {
    if (n === null || !ok) continue;
    const z = 'Z.' + n, hits = byCode.get(alnum(ok)) ?? [];
    const base: ZRow = { ...it, z, ok, status: 'fill', orderId: null, orderRef: null, customer: null, orderStatus: null, rep: null, current: null, why: null };
    const o = hits.length === 1 ? hits[0] : null;
    const row = o ? { ...base, orderId: o.id, orderRef: o.order_ref, customer: o.customer, orderStatus: o.status, rep: o.rep_name, current: clean(o.job_ref) || null } : base;
    if (!hits.length) { out.push({ ...row, status: 'no_order', why: `No sales order ${ok}` }); continue; }
    if (!o) { out.push({ ...row, status: 'several_orders', why: `${hits.length} sales orders have ${ok}: ${hits.map((h) => h.order_ref).join(' · ').slice(0, 300)}` }); continue; }
    const cur = zNumber(o.job_ref);
    if (cur === n) { out.push({ ...row, status: 'same' }); continue; }
    if (row.current) { out.push({ ...row, status: 'conflict', why: `The order has ${row.current}` }); continue; }
    if ((zOnBoard.get(n) ?? 0) > 1) { out.push({ ...row, status: 'several_items', why: `${z} is on the board ${zOnBoard.get(n)} times` }); continue; }
    if ((okOnBoard.get(alnum(ok)) ?? 0) > 1) { out.push({ ...row, status: 'several_items', why: `${ok} is on ${okOnBoard.get(alnum(ok))} board items` }); continue; }
    const taken = (byZ.get(z) ?? []).filter((x) => x.id !== o.id);
    if (taken.length) { out.push({ ...row, status: 'z_taken', why: `${z} is already on ${taken.map((x) => x.order_ref).join(' · ').slice(0, 300)}` }); continue; }
    out.push(row);
  }
  return out;
}

// ---- storage -------------------------------------------------------------------------------------
async function zOrders(tenantId: string): Promise<ZOrder[]> {
  const out: ZOrder[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_orders').select('id,order_ref,job_ref,customer,status,rep_name').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ZOrder[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function previewZLinks(tenantId: string): Promise<{ rows: ZRow[]; items: number; board: string }> {
  const items = (await new Monday().listItemsDetailed(PRODUCTION_BOARD, [])).map((i) => ({ id: String(i.id), name: clean(i.name), created: i.created_at ? String(i.created_at).slice(0, 10) : null }));
  return { rows: planZLinks(items, await zOrders(tenantId)), items: items.length, board: PRODUCTION_BOARD };
}
/** Write the ticked rows. The plan is worked out again here and an order is written only while its Z number is
 *  still empty, so a row that changed meanwhile does nothing. */
export async function applyZLinks(tenantId: string, ids: string[]): Promise<{ filled: string[]; skipped: number }> {
  const { rows } = await previewZLinks(tenantId);
  const want = new Set(ids.map(String)), filled: string[] = [], done = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    if (!want.has(r.id)) continue;
    if (r.status !== 'fill' || !r.orderId || done.has(r.orderId)) { skipped++; continue; }
    const { data, error } = await db().from('fin_orders').update({ job_ref: r.z, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', r.orderId).or('job_ref.is.null,job_ref.eq.').select('id');
    if (error) throw error;
    if (!data?.length) { skipped++; continue; }
    done.add(r.orderId); filled.push(`${r.orderRef} → ${r.z}`);
  }
  return { filled, skipped };
}
