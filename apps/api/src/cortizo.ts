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
// References that are in no imported catalogue (the standard Casement profiles 3820 / 3830 / 3850 — the
// catalogue lists only their HI versions 3821 / 3831 / 3851 —, MP, pivot, sliding profiles, hardware) are
// taken from Subiekt itself: the leading number of such a symbol becomes a reference of its own, described
// with the Subiekt name ("from Subiekt"). What is still left — other brands bought through Cortizo, paint —
// can be hidden from the list with a "Not Cortizo" pattern (cortizo_ignore, migration 0094).
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
  const hit = keys.exact.get(t) ?? (/^\d{3,6}$/.test(t) ? keys.exact.get('COR-' + t) ?? null : null);
  if (hit) return hit;
  const bare = /^COR[- ]?(\d{3,6})$/.exec(t);                 // "COR-15919" for the bare PVC reference 15919
  return bare ? keys.exact.get(bare[1]) ?? null : null;
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
/** A reference read from a Subiekt symbol (or the custom field) that no catalogue has: its leading 4–6 digit
 *  number, "COR-<n>" for 4–5 digits (aluminium profiles), the bare number for 6 digits (hardware, as the
 *  catalogues write accessories). "3830 RAL 7016 CM 4000 mm" → COR-3830, "COR-8619 Brązowy anoda" → COR-8619,
 *  "330304" → 330304, "301025 - 9007" → 301025. */
export function ownRef(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = /^(?:COR[- ]?)?(\d{4,6})(?=$|[-_/., ])/.exec(tight(t));
    if (m) return m[1].length === 6 ? m[1] : 'COR-' + m[1];
  }
  return null;
}
/** "Not Cortizo" patterns: a whole symbol ("A.7016 CM") or a beginning with * ("GN*"). */
export function ignored(symbol: string, patterns: string[]): boolean {
  const t = tight(symbol);
  return patterns.some((p) => { const q = tight(p); return q.endsWith('*') ? q.length > 1 && t.startsWith(q.slice(0, -1)) : t === q; });
}
export interface StockMatch { byRef: Map<string, StockRow[]>; own: Map<string, StockRow[]>; unmatched: StockRow[]; ignored: number }
export function matchStock(refs: string[], stock: StockRow[], ignore: string[] = []): StockMatch {
  const keys = refKeys(refs);
  const byRef = new Map<string, StockRow[]>(), own = new Map<string, StockRow[]>(), unmatched: StockRow[] = [];
  const add = (m: Map<string, StockRow[]>, k: string, s: StockRow) => (m.get(k) ?? m.set(k, []).get(k)!).push(s);
  let hidden = 0;
  for (const s of stock) {
    const ref = matchCustomField(s.cref, keys) ?? matchSymbol(s.symbol, keys);
    if (ref) { add(byRef, ref, s); continue; }
    if (!(s.cortizo || clean(s.cref) || looksCortizo(s.symbol))) continue;
    if (ignored(s.symbol, ignore)) { hidden++; continue; }
    const o = ownRef(s.symbol, tight(s.cref).split(' ')[0]);
    if (o) add(own, o, s); else unmatched.push(s);
  }
  return { byRef, own, unmatched, ignored: hidden };
}

/** The colour written in a Subiekt symbol, after the reference and before the bar length, tidied:
 *  "RAL 7016TD/9010 CM" → "RAL 7016 TD / 9010 CM", "RAL 7044 M" → "RAL 7044 M", "Brązowy anoda" as written;
 *  null when the symbol has none. */
export function colourOf(symbol: string): string | null {
  let rest = clean(symbol).replace(/^COR[- ]?/i, '').replace(/^\S+/, '');
  rest = rest.replace(/\s*\d{3,5}\s*mm\b.*$/i, '').replace(/^[\s\-_/.,]+|[\s\-_/.,]+$/g, '');
  if (!rest) return null;
  const parts = rest.replace(/^RAL\s*/i, '').split(/\s*\/\s*/);
  const tidy = parts.map((x) => { const m = /^(?:RAL\s*)?(\d{4})\s*([A-Z]{1,2})?$/i.exec(x.trim()); return m ? m[1] + (m[2] ? ' ' + m[2].toUpperCase() : '') : null; });
  return tidy.every(Boolean) ? 'RAL ' + tidy.join(' / ') : rest;
}
/** A Subiekt name without colour, bar length and bracket notes: "Poprzeczka 60mm RAL7016 CM (6,5m)" → "Poprzeczka 60mm". */
export function plainName(name: string | null): string {
  return clean(name).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\d[^)]*\)/g, ' ').replace(/\bRAL\s*\d{4}\s*(?:CM|TD|TC|M|B)?\b/gi, ' ')
    .replace(/\s\d+(?:[.,]\d+)?\s*m$/i, ' ').replace(/\s+/g, ' ').replace(/[\s.,(-]+$/, '').trim();
}
/** The most common plain name of a reference's Subiekt rows (the longest on a tie). */
export function ownDesc(rows: StockRow[]): string {
  const n = new Map<string, number>();
  for (const r of rows) { const x = plainName(r.name); if (x) n.set(x, (n.get(x) ?? 0) + 1); }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
}

/** The bar length a Subiekt symbol or name carries ("15919 RAL 7016 CM 4000 mm" → 4000), or null.
 *  Profiles are counted in pieces; this turns pieces into metres. */
export function barLengthMm(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = /(?:^|[^0-9.,])(\d{3,5})\s*mm\b/i.exec(clean(t).replace(/\(/g, ' '));
    if (m) { const n = Number(m[1]); if (n >= 300 && n <= 12000) return n; }
  }
  return null;
}
const isPieces = (unit: string | null) => !unit || /^(szt|pcs|pc|st)\.?$/i.test(unit.trim()) || /^sztang/i.test(unit.trim());
const isMetres = (unit: string | null) => !!unit && /^(m|mb|mtr)\.?$/i.test(unit.trim());
/** The bar length of one piece: the symbol first ("3830 RAL 7021 CM 4000 mm"), then the unit
 *  ("sztanga(6500mm)" — a full bar), then the name. Null for units that are not pieces. */
export function pieceMm(r: { symbol: string; name: string | null; unit: string | null }): number | null {
  if (!isPieces(r.unit)) return null;
  return barLengthMm(r.symbol) ?? barLengthMm(r.unit) ?? barLengthMm(r.name);
}
/** Metres of a stock row: pieces × bar length, or the quantity itself when Subiekt counts in metres. */
export function rowMetres(r: StockRow): number | null {
  if (isMetres(r.unit)) return r.qty;
  const mm = pieceMm(r); return mm ? (r.qty * mm) / 1000 : null;
}

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
  stockSyncedAt: string | null; importedAt: string | null; own: number; ignore: string[]; ignored: number;
}
export async function ignoreList(tenantId: string): Promise<string[]> {
  const { data, error } = await db().from('cortizo_ignore').select('pattern').eq('tenant_id', tenantId).order('pattern');
  if (error) return [];                                     // migration 0094 not run yet
  return (data ?? []).map((r: any) => r.pattern);
}
export function ignorePattern(v: unknown): string | null {
  const p = clean(v).toUpperCase().slice(0, 80);
  return p && p !== '*' && !/^\*/.test(p) && (p.match(/\*/g) ?? []).length <= (p.endsWith('*') ? 1 : 0) ? p : null;
}
export async function addIgnore(tenantId: string, userId: string, v: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const pattern = ignorePattern(v);
  if (!pattern) return { ok: false, error: 'Give a symbol, or its beginning followed by * (e.g. GN*).' };
  const { error } = await db().from('cortizo_ignore').upsert({ tenant_id: tenantId, pattern, created_by: userId }, { onConflict: 'tenant_id,pattern' });
  if (error) return { ok: false, error: /cortizo_ignore/.test(error.message) ? 'This needs migration 0094.' : error.message };
  return { ok: true };
}
export async function removeIgnore(tenantId: string, v: unknown): Promise<void> {
  const { error } = await db().from('cortizo_ignore').delete().eq('tenant_id', tenantId).eq('pattern', clean(v).toUpperCase());
  if (error) throw error;
}
export async function catalogueView(tenantId: string): Promise<CatalogueView> {
  const [items, stock] = await Promise.all([
    all<any>('cortizo_items', 'ref,kind,desc_en,desc_es,weight_g_m,surface_dm2_m,colour_en,colour_es,type_en,type_es,sketch,systems,imported_at', tenantId, 'ref'),
    all<any>('subiekt_stock', 'product_id,warehouse,symbol,name,unit,qty,reserved,cref,cortizo,synced_at', tenantId, 'product_id'),
  ]);
  const rows: StockRow[] = stock.map((s) => ({ ...s, product_id: Number(s.product_id), qty: Number(s.qty) || 0, reserved: s.reserved === null ? null : Number(s.reserved) }));
  const ignore = await ignoreList(tenantId);
  const m = matchStock(items.map((i) => i.ref), rows, ignore);
  const systems = [...new Set(items.flatMap((i) => i.systems ?? []))].sort();
  const sysIx = new Map(systems.map((s, i) => [s, i]));
  const stockOf = (st: StockRow[]) => {
    const mt = st.map(rowMetres);
    return {
      stock: st.map((r, k) => [r.symbol, r.name, r.warehouse, r.qty, r.unit, r.reserved, pieceMm(r), colourOf(r.symbol), mt[k] === null ? null : Math.round(mt[k]! * 100) / 100]),
      m: mt.some((x) => x !== null) ? Math.round(mt.reduce((a: number, x) => a + (x ?? 0), 0) * 100) / 100 : null,
      qty: st.length ? Math.round(st.reduce((a, r) => a + r.qty, 0) * 1000) / 1000 : null,
    };
  };
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const out: any[] = items.map((i) => {
    const st = m.byRef.get(i.ref) ?? [];
    return {
      ref: i.ref, kind: i.kind, en: i.desc_en, es: i.desc_es, w: i.weight_g_m === null ? null : Number(i.weight_g_m), s: i.surface_dm2_m === null ? null : Number(i.surface_dm2_m),
      col: i.colour_en || i.colour_es || null, typ: i.type_en || i.type_es || null, sk: i.sketch || null,
      sys: (i.systems ?? []).map((s: string) => sysIx.get(s)),
      ...stockOf(st),
    };
  });
  // references only Subiekt knows; a 4–5 digit profile shows the drawing and systems of its HI version (n + 1)
  for (const [ref, st] of m.own) {
    const n = /^COR-(\d{4,5})$/.exec(ref), hi = n ? byRef.get('COR-' + (Number(n[1]) + 1)) : undefined;
    const sib = hi && /\bHI\b/.test(String(hi.desc_en ?? '') + ' ' + String(hi.desc_es ?? '')) ? hi : undefined;
    const profile = !!n || st.some((r) => pieceMm(r) !== null && /sztang|mm/i.test(r.symbol + ' ' + (r.unit ?? '')));
    out.push({
      ref, kind: profile ? 'profile' : 'accessory', en: ownDesc(st) || null, es: null, w: null, s: null, col: null, typ: null,
      sk: sib?.sketch || null, sys: (sib?.systems ?? []).map((s: string) => sysIx.get(s)), own: true, sib: sib ? sib.ref : null,
      ...stockOf(st),
    });
  }
  out.sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  return {
    items: out, systems, unmatched: m.unmatched, own: m.own.size, ignore, ignored: m.ignored, warehouses: [...new Set(rows.map((r) => r.warehouse))].sort(),
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

// ---- one Subiekt symbol → its catalogue reference and drawing (the Stock value detail window) ----
/** The references a symbol could be, to fetch before matching: the symbol cut at each separator
 *  ("COR-3787 RAL 9005 CM" → … "COR-3787 RAL", "COR-3787"), each also as COR-<n> / <n>. */
export function symbolCandidates(symbol: string): string[] {
  const s = tight(symbol), out = new Set<string>();
  const add = (h: string) => { if (!h) return; out.add(h); const n = /^(?:COR[- ]?)?(\d{3,6})$/.exec(h); if (n) { out.add('COR-' + n[1]); out.add(n[1]); } };
  add(s);
  for (let i = s.length - 1; i > 0; i--) if (/[-_/., ]/.test(s[i])) add(s.slice(0, i).replace(/[-_/., ]+$/, ''));
  const k = /^COR[- ]?(\d{3,6})/.exec(s); if (k) add(k[1]);
  return [...out].slice(0, 40);
}
export interface SymbolCortizo { ref: string; en: string | null; es: string | null; kind: string | null; weight: number | null; systems: string[]; sketch: string | null; sib: string | null }
/** The catalogue reference of a Subiekt symbol, with a signed URL for its drawing; a 4–5 digit profile that is
 *  in no catalogue shows the drawing of its HI version (n + 1), as on Cortizo profiles. null = not Cortizo. */
export async function cortizoForSymbol(tenantId: string, symbol: string, cref?: string | null): Promise<SymbolCortizo | null> {
  const cands = [...new Set([...symbolCandidates(symbol), ...(cref ? symbolCandidates(tight(cref).split(' ')[0]) : [])])];
  if (!cands.length) return null;
  const cols = 'ref,kind,desc_en,desc_es,weight_g_m,sketch,systems';
  const { data, error } = await db().from('cortizo_items').select(cols).eq('tenant_id', tenantId).in('ref', cands);
  if (error) throw error;
  const rows = (data ?? []) as any[], keys = refKeys(rows.map((r) => r.ref));
  const ref = (cref ? matchCustomField(cref, keys) : null) ?? matchSymbol(symbol, keys);
  let it = ref ? rows.find((r) => r.ref === ref) : undefined, sib: string | null = null;
  if (!it) {
    const n = /^COR[- ]?(\d{4,5})(?!\d)/.exec(tight(symbol));
    if (!n) return null;
    const hiRef = 'COR-' + (Number(n[1]) + 1);
    const hi = await db().from('cortizo_items').select(cols).eq('tenant_id', tenantId).eq('ref', hiRef).maybeSingle();
    if (hi.error) throw hi.error;
    if (!hi.data || !/\bHI\b/.test(String(hi.data.desc_en ?? '') + ' ' + String(hi.data.desc_es ?? ''))) return null;
    it = { ...hi.data, ref: 'COR-' + n[1], desc_en: null, desc_es: null, weight_g_m: null }; sib = hiRef;
  }
  const url = it.sketch ? (await sketchUrls(tenantId, [it.sketch]))[it.sketch] ?? null : null;
  return { ref: it.ref, en: it.desc_en ?? null, es: it.desc_es ?? null, kind: it.kind ?? null, weight: it.weight_g_m == null ? null : Number(it.weight_g_m), systems: it.systems ?? [], sketch: url, sib };
}
