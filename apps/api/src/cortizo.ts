// Production ▸ Cortizo profiles. The references of the Cortizo Center catalogues (profiles with
// their sketch, accessories) are loaded by tools/cortizo-catalogue into cortizo_items; the Subiekt
// agent sends the stock of every product per warehouse into subiekt_stock. Here the two meet:
// a Subiekt symbol belongs to a Cortizo reference when it IS the reference, or when it is the reference followed by a suffix after a separator
// ("COR-3808-9016", "COR-3808 RAL7016", "770224/6,5"). The longest reference wins, so COR-381020
// is never taken for COR-3810. Nothing else is guessed: a Subiekt symbol that looks like a Cortizo
// reference but matches none is listed as such. ("COR-3810-20" is
// COR-3810 with a suffix, not COR-381020: the dashes the symbol has are respected.)
import { db } from './supabase';

export const SKETCH_BUCKET = 'cortizo';
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numOrNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---- matching ----------------------------------------------------------------------------------
/** The comparison key of a reference or symbol: upper case, letters and digits only. */
export const refKey = (s: unknown) => clean(s).toUpperCase().replace(/[^0-9A-Z]/g, '');
/** Looks like a Cortizo reference: COR-…, or a bare 6-digit Cortizo code. */
export const looksCortizo = (symbol: unknown) => /^(COR[\s-]?\d{3,}|\d{6})/i.test(clean(symbol));

export interface StockRow { product_id: number; warehouse: string; symbol: string; name: string | null; unit: string | null; qty: number; reserved: number | null }
const tight = (s: unknown) => clean(s).toUpperCase();
export interface RefKeys { exact: Map<string, string>; loose: Map<string, string | null> }
export function refKeys(refs: string[]): RefKeys {
  const exact = new Map<string, string>(), loose = new Map<string, string | null>();
  for (const r of refs) {
    exact.set(tight(r), r);
    const k = refKey(r); loose.set(k, loose.has(k) && loose.get(k) !== r ? null : r);   // null = two references share it
  }
  return { exact, loose };
}
/** Which reference a Subiekt symbol belongs to, or null:
 *  1. the symbol is the reference (case aside);
 *  2. the reference followed by a separator and a suffix — the longest reference wins;
 *  3. the same letters and digits as exactly one reference ("COR3808" for "COR-3808"). */
export function matchSymbol(symbol: string, keys: RefKeys): string | null {
  const s = tight(symbol);
  const hit = keys.exact.get(s);
  if (hit) return hit;
  for (let i = s.length - 1; i > 0; i--) {
    if (!/[-_/., ]/.test(s[i])) continue;
    const ref = keys.exact.get(s.slice(0, i).replace(/[-_/., ]+$/, ''));
    if (ref) return ref;
  }
  return keys.loose.get(refKey(s)) ?? null;
}
export interface StockMatch { byRef: Map<string, StockRow[]>; unmatched: StockRow[] }
export function matchStock(refs: string[], stock: StockRow[]): StockMatch {
  const keys = refKeys(refs);
  const byRef = new Map<string, StockRow[]>(), unmatched: StockRow[] = [];
  for (const s of stock) {
    const ref = matchSymbol(s.symbol, keys);
    if (ref) (byRef.get(ref) ?? byRef.set(ref, []).get(ref)!).push(s);
    else if (looksCortizo(s.symbol)) unmatched.push(s);
  }
  return { byRef, unmatched };
}

// ---- the agent's stock snapshot ----------------------------------------------------------------
export function stockFromAgent(r: any): StockRow | null {
  const product_id = Number(r?.id), symbol = clean(r?.symbol);
  if (!Number.isInteger(product_id) || product_id <= 0 || !symbol) return null;
  return {
    product_id, symbol: symbol.slice(0, 80), warehouse: clean(r.warehouse).slice(0, 60), name: clean(r.name).slice(0, 200) || null,
    unit: clean(r.unit).slice(0, 20) || null, qty: numOrNull(r.qty) ?? 0, reserved: numOrNull(r.reserved),
  };
}
async function all<T>(table: string, cols: string, tenantId: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order(order).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** A full snapshot: rows are replaced, products no longer sent are dropped. */
export async function receiveStock(tenantId: string, body: any): Promise<{ ok: true; rows: number; products: number } | { ok: false; status: number; error: string }> {
  const raw: any[] = Array.isArray(body?.stock) ? body.stock : [];
  const rows = raw.map(stockFromAgent).filter((r): r is StockRow => !!r);
  if (!raw.length || rows.length < raw.length * 0.9) return { ok: false, status: 400, error: 'The stock snapshot is empty or malformed; nothing was changed.' };
  // one row per product and warehouse (the last one wins if the query returned duplicates)
  const uniq = new Map(rows.map((r) => [r.product_id + '|' + r.warehouse, r]));
  const have = await all<any>('subiekt_stock', 'product_id,warehouse', tenantId, 'product_id');
  if (have.length > 200 && uniq.size < have.length * 0.5) return { ok: false, status: 409, error: 'The stock snapshot has far fewer rows than last time; nothing was changed.' };
  const now = new Date().toISOString(), list = [...uniq.values()];
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await db().from('subiekt_stock').upsert(list.slice(i, i + 500).map((r) => ({ tenant_id: tenantId, ...r, synced_at: now })), { onConflict: 'tenant_id,product_id,warehouse' });
    if (error) throw error;
  }
  const gone = have.filter((h) => !uniq.has(h.product_id + '|' + h.warehouse));
  for (let i = 0; i < gone.length; i += 100) {
    const g = gone.slice(i, i + 100);
    for (const w of new Set(g.map((x) => x.warehouse))) {
      const { error } = await db().from('subiekt_stock').delete().eq('tenant_id', tenantId).eq('warehouse', w).in('product_id', g.filter((x) => x.warehouse === w).map((x) => x.product_id));
      if (error) throw error;
    }
  }
  return { ok: true, rows: list.length, products: new Set(list.map((r) => r.product_id)).size };
}

// ---- what the page shows -----------------------------------------------------------------------
export interface CatalogueView {
  items: any[]; systems: string[]; unmatched: StockRow[]; warehouses: string[];
  stockSyncedAt: string | null; importedAt: string | null;
}
export async function catalogueView(tenantId: string): Promise<CatalogueView> {
  const [items, stock] = await Promise.all([
    all<any>('cortizo_items', 'ref,kind,desc_en,desc_es,weight_g_m,surface_dm2_m,colour_en,colour_es,type_en,type_es,sketch,systems,sources,imported_at', tenantId, 'ref'),
    all<any>('subiekt_stock', 'product_id,warehouse,symbol,name,unit,qty,reserved,synced_at', tenantId, 'product_id'),
  ]);
  const rows: StockRow[] = stock.map((s) => ({ ...s, product_id: Number(s.product_id), qty: Number(s.qty) || 0, reserved: s.reserved === null ? null : Number(s.reserved) }));
  const m = matchStock(items.map((i) => i.ref), rows);
  const systems = [...new Set(items.flatMap((i) => i.systems ?? []))].sort();
  const sysIx = new Map(systems.map((s, i) => [s, i]));
  const out = items.map((i) => {
    const st = m.byRef.get(i.ref) ?? [];
    return {
      ref: i.ref, kind: i.kind, en: i.desc_en, es: i.desc_es, w: i.weight_g_m === null ? null : Number(i.weight_g_m), s: i.surface_dm2_m === null ? null : Number(i.surface_dm2_m),
      col: i.colour_en || i.colour_es || null, typ: i.type_en || i.type_es || null, sk: i.sketch || null,
      sys: (i.systems ?? []).map((s: string) => sysIx.get(s)),
      src: (i.sources ?? []).slice(0, 12).map((s: any) => [s.system, s.cat_page ?? null, s.version ?? null]),
      stock: st.map((r) => [r.symbol, r.name, r.warehouse, r.qty, r.unit, r.reserved]),
      qty: st.length ? Math.round(st.reduce((a, r) => a + r.qty, 0) * 1000) / 1000 : null,
    };
  });
  return {
    items: out, systems, unmatched: m.unmatched, warehouses: [...new Set(rows.map((r) => r.warehouse))].sort(),
    stockSyncedAt: stock.reduce((a: string | null, s: any) => (!a || s.synced_at > a ? s.synced_at : a), null),
    importedAt: items.reduce((a: string | null, s: any) => (!a || s.imported_at > a ? s.imported_at : a), null),
  };
}
/** Signed URLs for sketch files (the page asks for the ones it is about to show). */
export async function sketchUrls(tenantId: string, files: string[]): Promise<Record<string, string>> {
  const ok = [...new Set(files)].filter((f) => /^[A-Za-z0-9._-]{1,90}\.png$/.test(f)).slice(0, 300);
  if (!ok.length) return {};
  const { data, error } = await db().storage.from(SKETCH_BUCKET).createSignedUrls(ok.map((f) => `${tenantId}/${f}`), 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.signedUrl && d.path) out[d.path.slice(tenantId.length + 1)] = d.signedUrl;
  return out;
}
