// Fin&Ops: actual purchase cost per trade order. During the monday costs sync, the KSeF PDF of each
// trade purchase invoice (Podrodzaj kosztu "499.V Handel") is read and its lines split between the
// orders they name. An invoice whose lines can't all be placed is listed to check: write the order
// number in the board's "Zlecenie" column and the next sync puts the rest there. Advance invoices
// (Faktura zaliczkowa) are not a cost — the goods arrive on the settlement invoice.
import { getDocumentProxy, extractText } from 'unpdf';
import { db } from './supabase';
import { Monday, withMondayRetry } from './monday';
import { parseKsef, splitByOrder } from './ksefInvoice';
import { okCode, zNumbers } from './subiekt';
import { orderCode } from './finOrders';

export const TRADE_SUBCATEGORY = /^499\.V\b/i;
export const TRADE_FROM_YEAR = 2026;
const round2 = (n: number) => Math.round(n * 100) / 100;
const alnum = (s: unknown) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
/** The asset id in a monday file URL (".../resources/3315715118/…pdf"); the first PDF when there are several. */
export function assetIdOf(fileText: unknown): string | null {
  for (const part of String(fileText ?? '').split(/,\s*/)) { const m = /\/resources\/(\d+)\/[^,]*\.pdf/i.exec(part); if (m) return m[1]; }
  return null;
}
export const isTradeInvoice = (r: { subcategory?: string | null; period_year?: number | null; removed?: boolean | null }) => !r.removed && TRADE_SUBCATEGORY.test(String(r.subcategory ?? '')) && (r.period_year ?? 0) >= TRADE_FROM_YEAR;

// ---- reading PDFs during the costs sync ------------------------------------------------------------
async function pdfText(monday: Monday, assetId: string): Promise<string> {
  const d = await withMondayRetry(() => monday.gql<{ assets: { public_url: string }[] }>(`query ($ids: [ID!]!) { assets(ids: $ids) { public_url } }`, { ids: [assetId] }));
  const url = d.assets?.[0]?.public_url;
  if (!url) throw new Error('no download link for the PDF');
  const res = await fetch(url);
  if (!res.ok) throw new Error('PDF download failed: HTTP ' + res.status);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await res.arrayBuffer())), { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : String(text);
}
/** Read the PDFs of trade invoices that are new or whose file changed. `fileOf` gives each monday item's file-column text. */
export async function readTradePdfs(tenantId: string, fileOf: Map<string, string | null>, onProgress?: (done: number, total: number) => void, limit = 400): Promise<{ read: number; failed: number }> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_costs').select('id,monday_item_id,subcategory,period_year,removed,net,pdf_asset').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) { if (/pdf_asset/.test(error.message)) return { read: 0, failed: 0 }; throw error; }   // migration 0075 not run yet
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const todo = rows.filter((r) => isTradeInvoice(r) && fileOf.has(r.monday_item_id)).map((r) => ({ r, asset: assetIdOf(fileOf.get(r.monday_item_id)) }))
    .filter((x) => (x.asset ?? 'none') !== (x.r.pdf_asset ?? '')).slice(0, limit);
  const monday = new Monday();
  let read = 0, failed = 0;
  for (const { r, asset } of todo) {
    const now = new Date().toISOString();
    let patch: Record<string, any>; let lines: Record<string, any>[] = [];
    if (!asset) patch = { pdf_asset: 'none', pdf_type: null, pdf_status: 'no_pdf', pdf_total: null, pdf_checked_at: now };
    else {
      try {
        const inv = parseKsef(await pdfText(monday, asset));
        if (inv.type === 'unknown' || (!inv.lines.length && inv.type !== 'advance')) patch = { pdf_asset: asset, pdf_type: inv.type, pdf_status: 'not_ksef', pdf_total: null, pdf_checked_at: now };
        else {
          const split = splitByOrder(inv);
          const total = split.total, net = r.net === null ? null : Number(r.net);
          const ok = inv.type === 'advance' || (net !== null && Math.abs(total - net) < 0.05);
          patch = { pdf_asset: asset, pdf_type: inv.type, pdf_status: ok ? 'ok' : 'mismatch', pdf_total: inv.type === 'advance' ? null : total, pdf_checked_at: now };
          // the order of each line: its own reference, else the order of a line with the same WEB number
          const byWeb = new Map<string, string | null>();
          for (const l of inv.lines) if (l.web && l.order) byWeb.set(l.web, byWeb.has(l.web) && byWeb.get(l.web) !== l.order ? null : l.order);
          lines = inv.lines.map((l) => ({ tenant_id: tenantId, cost_id: r.id, lp: l.lp, name: l.name.slice(0, 200), ref: ((/Ref\.?:?\s*(.*)$/i.exec(l.text) ?? [])[1] ?? '').slice(0, 300) || null, web: l.web,
            net: l.before ? -l.net : l.net, advance: /^zaliczka\b/i.test(l.name), order_code: l.order ?? (l.web ? byWeb.get(l.web) ?? null : null) }));
        }
        read++;
      } catch (e: any) { failed++; patch = { pdf_asset: null, pdf_status: 'error', pdf_checked_at: now }; console.error('[trade pdf]', r.monday_item_id, e?.message ?? e); }
    }
    const del = await db().from('fin_cost_lines').delete().eq('cost_id', r.id); if (del.error) throw del.error;
    if (lines.length) { const ins = await db().from('fin_cost_lines').insert(lines); if (ins.error) throw ins.error; }
    const up = await db().from('fin_costs').update(patch).eq('id', r.id); if (up.error) throw up.error;
    onProgress?.(read + failed, todo.length);
  }
  return { read, failed };
}

// ---- turning invoices into cost per order ---------------------------------------------------------
export interface TradeInvoice { id: string; supplier: string | null; invoice_no: string | null; invoice_date: string | null; net: number | null; order_ref: string | null; pdf_type: string | null; pdf_status: string | null; pdf_total: number | null; monday_item_id: string }
export interface TradeLine { cost_id: string; net: number; advance: boolean; order_code: string | null; ref: string | null; name: string | null }
export interface OrderPurchase { order_key: string; order_code: string; invoice_no: string | null; supplier: string | null; invoice_date: string | null; net: number; from: 'lines' | 'zlecenie'; cost_id?: string }
export type TradeCheckReason = 'no_reference' | 'mismatch' | 'not_ksef' | 'no_pdf' | 'error' | 'unknown_order' | 'not_read';
/** The order written in the board's "Zlecenie": an OK number, a Z number (an order produced in Orpiszew), or the text itself. */
export function zlecenieCode(text: unknown): string | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return okCode(t) ?? zNumbers(t)[0] ?? (orderCode(t) || null);
}
export interface TradeCheck { invoice: TradeInvoice; reason: TradeCheckReason; unassigned: number; refs: string[] }
/** Each invoice's cost per order, and the invoices that need the order written in "Zlecenie".
 *  `orderExists(code)` says whether a code names an order in the register. */
export function allocatePurchases(invoices: TradeInvoice[], lines: TradeLine[], orderExists: (code: string) => boolean): { purchases: OrderPurchase[]; toCheck: TradeCheck[] } {
  const linesBy = new Map<string, TradeLine[]>();
  for (const l of lines) (linesBy.get(l.cost_id) ?? linesBy.set(l.cost_id, []).get(l.cost_id)!).push(l);
  const purchases: OrderPurchase[] = [], toCheck: TradeCheck[] = [];
  for (const inv of invoices) {
    if (inv.pdf_type === 'advance') continue;                       // an advance is not a cost
    const zl = zlecenieCode(inv.order_ref);                           // the order written on the board, if any
    const add = (code: string, net: number, from: OrderPurchase['from']) => purchases.push({ order_key: alnum(code), order_code: code, invoice_no: inv.invoice_no, supplier: inv.supplier, invoice_date: inv.invoice_date, net: round2(net), from, cost_id: inv.id });
    const own = linesBy.get(inv.id) ?? [];
    const readable = inv.pdf_status === 'ok' && own.length > 0;
    if (!readable) {
      // no usable lines: the whole invoice goes to the order in "Zlecenie", else it waits
      if (zl && orderExists(zl)) add(zl, inv.net ?? 0, 'zlecenie');
      // no pdf_status yet = this invoice's PDF has not been read (a sync covering its month reads it)
      else toCheck.push({ invoice: inv, reason: zl ? 'unknown_order' : ((inv.pdf_status as TradeCheckReason) || 'not_read'), unassigned: inv.net ?? 0, refs: [] });
      continue;
    }
    const per = new Map<string, number>(); let rest = 0; const restRefs = new Set<string>(); let unknown = false;
    for (const l of own) {
      if (l.advance) continue;
      const code = l.order_code && orderExists(l.order_code) ? l.order_code : (zl && orderExists(zl) ? zl : null);
      if (l.order_code && !orderExists(l.order_code) && !code) unknown = true;
      if (code) per.set(code, round2((per.get(code) ?? 0) + l.net));
      else { rest = round2(rest + l.net); if (l.ref) restRefs.add(l.ref.slice(0, 80)); }
    }
    for (const [code, net] of per) add(code, net, 'lines');
    if (Math.abs(rest) >= 0.005) toCheck.push({ invoice: inv, reason: unknown ? 'unknown_order' : 'no_reference', unassigned: rest, refs: [...restRefs].slice(0, 5) });
  }
  return { purchases, toCheck };
}

export async function loadTrade(tenantId: string): Promise<{ invoices: TradeInvoice[]; lines: TradeLine[] }> {
  const invoices: TradeInvoice[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_costs').select('id,monday_item_id,supplier,invoice_no,invoice_date,net,order_ref,subcategory,period_year,removed,pdf_type,pdf_status,pdf_total').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) { if (/pdf_/.test(error.message)) return { invoices: [], lines: [] }; throw error; }
    for (const r of data ?? []) if (isTradeInvoice(r)) invoices.push({ ...r, net: r.net === null ? null : Number(r.net), pdf_total: r.pdf_total === null ? null : Number(r.pdf_total) });
    if (!data || data.length < 1000) break;
  }
  const lines: TradeLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_cost_lines').select('cost_id,net,advance,order_code,ref,name').eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) { if (/fin_cost_lines/.test(error.message)) break; throw error; }
    lines.push(...(data ?? []).map((l: any) => ({ ...l, net: Number(l.net) || 0 })));
    if (!data || data.length < 1000) break;
  }
  return { invoices, lines };
}
