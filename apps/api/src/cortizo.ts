// Production ▸ Cortizo profiles. The references of the Cortizo Center catalogues (profiles with
// their sketch, accessories) are loaded by tools/cortizo-catalogue into cortizo_items; the Subiekt
// agent sends the stock of every product per warehouse into subiekt_stock. Here the two meet.
// How Acemark PL writes Cortizo products in Subiekt (checked October 2026):
//   - the custom field L0 starts with the Cortizo reference: "2015 White Powder Coating 9010",
//     "240124 Czarny", "3735 Standard painting 7016CM";
//   - the symbol is the reference + colour + bar length: "2015 RAL 7016 CM 1000 mm", "15919 RAL
//     7016 CM 4000 mm", "10417 2000 mm"; accessories are the bare reference ("212007");
//   - aluminium profiles are written WITHOUT "COR-": 2015 is COR-2015. A number is read as itself
//     when the catalogue has it bare (PVC references such as 15919), otherwise as COR-<number>.
//   - the supplier is CORTIZO SPÓŁKA Z O.O. (role 2); its "supplier symbol" is left empty.
// The custom field decides; the symbol is the fallback (in practice the custom field is mostly
// empty, the symbol carries the reference). Nothing else is guessed: a Cortizo-supplied product, or
// one whose custom field is filled or whose symbol starts with COR-, that matches no reference is
// listed as unmatched.
import { db } from './supabase';

export const SKETCH_BUCKET = 'cortizo';
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numOrNull = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---- matching ----------------------------------------------------------------------------------
/** The comparison key of a reference or symbol: upper case, letters and digits only. */
export const refKey = (s: unknown) => clean(s).toUpperCase().replace(/[^0-9A-Z]/g, '');
/** Looks like a Cortizo reference that should have matched: COR-…. (Bare numbers are not listed:
 *  Subiekt has many other suppliers' numeric codes — Dorma, screws, vents.) */
export const looksCortizo = (symbol: unknown) => /^COR[\s-]?\d{3,}/i.test(clean(symbol));

export interface StockRow { product_id: number; warehouse: string; symbol: string; name: string | null; unit: string | null; qty: number; reserved: number | null; cref: string | null; cortizo: boolean }
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
/** A reference written as in Subiekt: as it is, or — a bare number — with "COR-" in front. */
function lookup(t: string, keys: RefKeys): string | null {
  return keys.exact.get(t) ?? (/^\d{3,6}$/.test(t) ? keys.exact.get('COR-' + t) ?? null : null);
}
/** Which reference a Subiekt symbol belongs to, or null:
 *  1. the symbol is the reference (case aside; a bare number may be COR-<number>);
 *  2. the reference followed by a separator and a suffix — the longest reference wins (a numeric
 *     reference under 6 digits only before a space or dash: "15919 RAL 7016 CM 4000 mm" is 15919, the lock
 *     cylinder "1405/005025/IK" is not 1405);
 *  3. the same letters and digits as exactly one reference ("COR3808" for "COR-3808"). */
export function matchSymbol(symbol: string, keys: RefKeys): string | null {
  const s = tight(symbol);
  const hit = lookup(s, keys);
  if (hit) return hit;
  for (let i = s.length - 1; i > 0; i--) {
    if (!/[-_/., ]/.test(s[i])) continue;
    const head = s.slice(0, i).replace(/[-_/., ]+$/, '');
    const ref = lookup(head, keys);
    if (ref && /^\d{1,5}$/.test(head) && !/[ -]/.test(s[head.length] ?? '')) continue;
    if (ref) return ref;
  }
  const k = refKey(s);
  return keys.loose.get(k) ?? (/^\d{3,6}$/.test(k) ? keys.loose.get('COR' + k) ?? null : null);
}
/** The reference named in the custom field: its first word ("2015 White Powder Coating 9010" → COR-2015). */
export function matchCustomField(cref: string | null, keys: RefKeys): string | null {
  const first = tight(cref).split(' ')[0];
  return first ? lookup(first, keys) ?? matchSymbol(first, keys) : null;
}
export interface StockMatch { byRef: Map<string, StockRow[]>; unmatched: StockRow[] }
export function matchStock(refs: string[], stock: StockRow[]): StockMatch {
  const keys = refKeys(refs);
  const byRef = new Map<string, StockRow[]>(), unmatched: StockRow[] = [];
  for (const s of stock) {
    const ref = matchCustomField(s.cref, keys) ?? matchSymbol(s.symbol, keys);
    if (ref) (byRef.get(ref) ?? byRef.set(ref, []).get(ref)!).push(s);
    else if (s.cortizo || clean(s.cref) || looksCortizo(s.symbol)) unmatched.push(s);
  }
  return { byRef, unmatched };
}

/** The bar length a Subiekt symbol or name carries ("15919 RAL 7016 CM 4000 mm" → 4000), or null.
 *  Profiles are counted in pieces; this turns pieces into metres. */
export function barLengthMm(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = /(?:^|[^0-9.,])(\d{3,5})\s*mm\b/i.exec(clean(t));
    if (m) { const n = Number(m[1]); if (n >= 300 && n <= 12000) return n; }
  }
  return null;
}
const isPieces = (unit: string | null) => !unit || /^(szt|pcs|pc|st)\.?$/i.test(unit.trim());

// ---- the agent's stock snapshot ----------------------------------------------------------------
export function stockFromAgent(r: any): StockRow | null {
  const product_id = Number(r?.id), symbol = clean(r?.symbol);
  if (!Number.isInteger(product_id) || product_id <= 0 || !symbol) return null;
  return {
    product_id, symbol: symbol.slice(0, 80), warehouse: clean(r.warehouse).slice(0, 60), name: clean(r.name).slice(0, 200) || null,
    unit: clean(r.unit).slice(0, 20) || null, qty: numOrNull(r.qty) ?? 0, reserved: numOrNull(r.reserved),
    cref: clean(r.cref).slice(0, 120) || null, cortizo: r.cortizo === true || r.cortizo === 1 || r.cortizo === '1',
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
    all<any>('cortizo_items', 'ref,kind,desc_en,desc_es,weight_g_m,surface_dm2_m,colour_en,colour_es,type_en,type_es,sketch,systems,imported_at', tenantId, 'ref'),
    all<any>('subiekt_stock', 'product_id,warehouse,symbol,name,unit,qty,reserved,cref,cortizo,synced_at', tenantId, 'product_id'),
  ]);
  const rows: StockRow[] = stock.map((s) => ({ ...s, product_id: Number(s.product_id), qty: Number(s.qty) || 0, reserved: s.reserved === null ? null : Number(s.reserved) }));
  const m = matchStock(items.map((i) => i.ref), rows);
  const systems = [...new Set(items.flatMap((i) => i.systems ?? []))].sort();
  const sysIx = new Map(systems.map((s, i) => [s, i]));
  const out = items.map((i) => {
    const st = m.byRef.get(i.ref) ?? [];
    const mm = st.map((r) => (isPieces(r.unit) ? barLengthMm(r.symbol, r.name) : null));
    const metres = mm.some((x) => x) ? Math.round(st.reduce((a, r, k) => a + (mm[k] ? (r.qty * mm[k]!) / 1000 : 0), 0) * 100) / 100 : null;
    return {
      ref: i.ref, kind: i.kind, en: i.desc_en, es: i.desc_es, w: i.weight_g_m === null ? null : Number(i.weight_g_m), s: i.surface_dm2_m === null ? null : Number(i.surface_dm2_m),
      col: i.colour_en || i.colour_es || null, typ: i.type_en || i.type_es || null, sk: i.sketch || null,
      sys: (i.systems ?? []).map((s: string) => sysIx.get(s)),
      stock: st.map((r, k) => [r.symbol, r.name, r.warehouse, r.qty, r.unit, r.reserved, mm[k]]),
      m: metres,
      qty: st.length ? Math.round(st.reduce((a, r) => a + r.qty, 0) * 1000) / 1000 : null,
    };
  });
  return {
    items: out, systems, unmatched: m.unmatched, warehouses: [...new Set(rows.map((r) => r.warehouse))].sort(),
    stockSyncedAt: stock.reduce((a: string | null, s: any) => (!a || s.synced_at > a ? s.synced_at : a), null),
    importedAt: items.reduce((a: string | null, s: any) => (!a || s.imported_at > a ? s.imported_at : a), null),
  };
}
/** Where a reference appears in the catalogues (the detail window). */
export async function itemSources(tenantId: string, ref: string): Promise<[string, number | null, string | null][]> {
  const { data, error } = await db().from('cortizo_items').select('sources').eq('tenant_id', tenantId).eq('ref', ref).maybeSingle();
  if (error) throw error;
  return ((data?.sources ?? []) as any[]).map((s) => [s.system, s.cat_page ?? null, s.version ?? null]);
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
