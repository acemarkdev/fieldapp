// Production time ▸ WEM: the task catalogue and orders that generate the tasks (the rules of generuj_taski.py).
//   • The catalogue: one row per fixed code (SAS-SKR-ST05 = Sash, skrzydło, czopowanie) with department, product,
//     element, activity, workstation, unit and how its planned quantity is counted. Codes never change.
//   • An order (WEM-2026-001) has positions: product (Sash / Casement / Drzwi), quantity, sashes per unit (Sash 2,
//     others 1), material (tarcica / kantówka), horns / vents / restrictors per unit. Saving it creates its tasks:
//       – every catalogue row of the product; pre-cut timber (kantówka) skips the rows for sawn timber only;
//       – sash rows: quantity × sashes; frame, box and set rows: quantity;
//       – add-ons: quantity × the add-on per unit, left out at 0;
//       – once per order: the rows not planned (downtime, other).
//     Saving again updates the planned quantities, adds new tasks and closes the ones no longer in the order —
//     never deletes a task (time is logged against it).
import { db } from './supabase';
import { referenceKey } from './finJobs';
import { colReady } from './schemaReady';
import { WEM_CATALOG_CSV } from './wemCatalogSeed';

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown): number | null => { const s = clean(v).replace(',', '.'); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

export type QtyRule = 'product' | 'sash' | 'horns' | 'vents' | 'restrictors' | 'none';
export interface CatalogRow { code: string; department: string | null; product: string | null; element: string | null; activity: string; station: string | null; unit: string | null; qty_rule: QtyRule; timber_only: boolean; sort: number; active?: boolean; id?: string }

// ---- the catalogue file -------------------------------------------------------------------------------
/** "× ilość × skrzydeł/szt." → sash; "× horny/szt. × ilość" → horns; "nie planowany" → none; else per product. */
export function qtyRuleOf(text: unknown): QtyRule {
  const s = clean(text).toLowerCase();
  if (/nie\s*planow/.test(s)) return 'none';
  if (/skrzyd/.test(s)) return 'sash';
  if (/horn/.test(s)) return 'horns';
  if (/nawiewn/.test(s)) return 'vents';
  if (/restrykt/.test(s)) return 'restrictors';
  return 'product';
}
const dash = (v: unknown) => { const s = clean(v); return !s || s === '—' || s === '-' ? null : s; };
/** The catalogue CSV (Kod tasku;Dział;Produkt;Element;Czynność;Stanowisko;Jednostka;Ilość planowana;Materiał). */
export function parseCatalog(text: string): CatalogRow[] {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length ? ';' : ',';
  const head = lines[0].split(sep).map((h) => clean(h).toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const ix = { code: col(/^kod/), dep: col(/^dzia/), prod: col(/^produkt/), el: col(/^element/), act: col(/^czynno/), st: col(/^stanowisk/), unit: col(/^jednost/), qty: col(/^ilo/), mat: col(/^materia/) };
  if (ix.code < 0 || ix.act < 0) return [];
  const out: CatalogRow[] = [];
  lines.slice(1).forEach((l, i) => {
    const c = l.split(sep), g = (k: number) => (k >= 0 ? clean(c[k]) : '');
    const code = g(ix.code).toUpperCase();
    if (!/^[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{0,3}\d{2}$/.test(code) || !g(ix.act)) return;
    out.push({ code, department: dash(g(ix.dep)), product: dash(g(ix.prod)), element: dash(g(ix.el)), activity: g(ix.act).slice(0, 160), station: dash(g(ix.st))?.slice(0, 120) ?? null,
      unit: dash(g(ix.unit))?.slice(0, 40) ?? null, qty_rule: qtyRuleOf(g(ix.qty)), timber_only: /tylko\s+tarcic/i.test(g(ix.mat)), sort: (i + 1) * 10 });
  });
  return out;
}

// ---- orders → tasks ------------------------------------------------------------------------------------
export interface Position { pos: string; product: string; qty: number; sashes: number; material: 'tarcica' | 'kantówka'; horns: number; vents: number; restrictors: number; size: string | null; note: string | null }
export interface TaskPlan { code: string; position: string; name: string; station: string | null; planned_qty: number | null; unit: string | null; export_name: string }
const PRODUCTS = ['Sash', 'Casement', 'Drzwi'];
/** The order form → clean positions. Missing values take the defaults: Sash 2 sashes, others 1; kantówka; add-ons 0. */
export function orderFields(b: any): Result<{ order_ref: string; client: string | null; note: string | null; positions: Position[] }> {
  const order_ref = clean(b?.order_ref).slice(0, 60);
  if (!order_ref) return fail(400, 'Enter the order number.');
  const positions: Position[] = [];
  for (const [i, p] of (Array.isArray(b?.positions) ? b.positions : []).slice(0, 100).entries()) {
    const product = PRODUCTS.find((x) => x.toLowerCase() === clean(p?.product).toLowerCase());
    const qty = num(p?.qty);
    if (!product && qty === null) continue;                                  // an empty row on the form
    const n = i + 1;
    if (!product) return fail(400, `Position ${n}: pick the product (Sash, Casement or Drzwi).`);
    if (qty === null || qty <= 0 || !Number.isInteger(qty)) return fail(400, `Position ${n}: enter the quantity (whole pieces).`);
    const int = (v: unknown, d: number, what: string): number | string => { const x = num(v); if (x === null) return d; return Number.isInteger(x) && x >= 0 && x <= 50 ? x : `Position ${n}: ${what} must be a whole number.`; };
    const sashes = int(p?.sashes, product === 'Sash' ? 2 : 1, 'sashes per unit'), horns = int(p?.horns, 0, 'horns per unit'), vents = int(p?.vents, 0, 'vents per unit'), restrictors = int(p?.restrictors, 0, 'restrictors per unit');
    for (const v of [sashes, horns, vents, restrictors]) if (typeof v === 'string') return fail(400, v);
    positions.push({ pos: clean(p?.pos).slice(0, 10) || String(positions.length + 1), product, qty, sashes: sashes as number, material: /^tarc/i.test(clean(p?.material)) ? 'tarcica' : 'kantówka',
      horns: horns as number, vents: vents as number, restrictors: restrictors as number, size: clean(p?.size).slice(0, 40) || null, note: clean(p?.note).slice(0, 200) || null });
  }
  if (!positions.length) return fail(400, 'Add at least one position.');
  const seen = new Set<string>(); for (const p of positions) { if (seen.has(p.pos)) return fail(400, `Position number ${p.pos} is used twice.`); seen.add(p.pos); }
  return { ok: true, order_ref, client: clean(b?.client).slice(0, 120) || null, note: clean(b?.note).slice(0, 500) || null, positions };
}
const ADDON: Record<string, keyof Position> = { horns: 'horns', vents: 'vents', restrictors: 'restrictors' };
/** The tasks of an order, in catalogue order: each position's product rows and add-ons, then the unplanned rows once. */
export function planTasks(orderRef: string, positions: Position[], catalog: CatalogRow[]): TaskPlan[] {
  const rows = catalog.filter((r) => r.active !== false).slice().sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  const out: TaskPlan[] = [];
  const add = (r: CatalogRow, p: Position | null, qty: number | null) => out.push({
    code: r.code, position: p?.pos ?? '', station: r.station, planned_qty: qty, unit: r.unit,
    name: [p ? `Poz. ${p.pos}` : null, r.code, [p?.product, r.element, r.activity].filter((x) => x && x !== '—').join(' | ')].filter(Boolean).join(' · ').slice(0, 160),
    export_name: [orderRef, p?.pos ?? '', r.code].filter((x) => x !== '').join('_').replace(/\s+/g, '_').slice(0, 160),
  });
  for (const p of positions) {
    for (const r of rows) {
      if ((r.product ?? '').toLowerCase() !== p.product.toLowerCase()) continue;
      if (r.timber_only && p.material === 'kantówka') continue;
      add(r, p, r.qty_rule === 'sash' ? p.qty * p.sashes : p.qty);
    }
    for (const r of rows) {
      const k = ADDON[r.qty_rule]; if (!k) continue;
      const per = p[k] as number; if (per > 0) add(r, p, p.qty * per);
    }
  }
  for (const r of rows) if (r.qty_rule === 'none') add(r, null, null);
  return out;
}

// ---- storage ---------------------------------------------------------------------------------------------
export const wemReady = () => colReady('prod_catalog', 'id');
async function all<T = any>(table: string, cols: string, tenantId: string, extra: (q: any) => any = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await extra(db().from(table).select(cols).eq('tenant_id', tenantId)).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** The WEM catalogue; filled from the catalogue file the first time. */
export async function listCatalog(tenantId: string): Promise<CatalogRow[]> {
  let rows = await all<CatalogRow>('prod_catalog', '*', tenantId, (q) => q.eq('company', 'wem'));
  if (!rows.length) { await importCatalog(tenantId, WEM_CATALOG_CSV); rows = await all<CatalogRow>('prod_catalog', '*', tenantId, (q) => q.eq('company', 'wem')); }
  return rows.sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
}
/** A catalogue file: new codes are added, known codes get the file's names, workstation, unit and rules. */
export async function importCatalog(tenantId: string, text: string): Promise<Result<{ added: number; updated: number }>> {
  const rows = parseCatalog(text);
  if (!rows.length) return fail(400, 'No task codes found — the file needs the columns Kod tasku and Czynność.');
  const have = new Set((await all<any>('prod_catalog', 'code', tenantId, (q) => q.eq('company', 'wem'))).map((r) => r.code));
  const { error } = await db().from('prod_catalog').upsert(rows.map((r) => ({ tenant_id: tenantId, company: 'wem', ...r, updated_at: new Date().toISOString() })), { onConflict: 'tenant_id,company,code' });
  if (error) throw error;
  const added = rows.filter((r) => !have.has(r.code)).length;
  return { ok: true, added, updated: rows.length - added };
}
/** Change a code's names, workstation or unit, or switch it off. The code itself stays. */
export async function updateCatalogRow(tenantId: string, id: string, b: any): Promise<Result> {
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [k, n] of [['department', 60], ['element', 80], ['station', 120], ['unit', 40]] as const) if (k in (b ?? {})) patch[k] = clean(b[k]).slice(0, n) || null;
  if ('activity' in (b ?? {})) { const a = clean(b.activity).slice(0, 160); if (!a) return fail(400, 'The activity needs a name.'); patch.activity = a; }
  if ('active' in (b ?? {})) patch.active = b.active !== false;
  const { data, error } = await db().from('prod_catalog').update(patch).eq('tenant_id', tenantId).eq('company', 'wem').eq('id', id).select('id');
  if (error) throw error;
  return data?.length ? { ok: true } : fail(404, 'Task code not found.');
}

export async function listOrders(tenantId: string): Promise<any[]> {
  const [orders, tasks] = await Promise.all([
    all<any>('prod_orders', '*', tenantId, (q) => q.eq('company', 'wem')),
    all<any>('prod_tasks', 'order_id,active', tenantId, (q) => q.eq('company', 'wem').not('order_id', 'is', null)),
  ]);
  const count = new Map<string, { open: number; closed: number }>();
  for (const t of tasks) { const c = count.get(t.order_id) ?? { open: 0, closed: 0 }; if (t.active) c.open++; else c.closed++; count.set(t.order_id, c); }
  return orders.map((o) => ({ ...o, tasks: count.get(o.id) ?? { open: 0, closed: 0 } })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
/** Save an order and bring its tasks in line: new ones added, planned quantities updated, ones no longer in the
 *  order closed (a closed one that comes back is reopened). */
export async function saveOrder(tenantId: string, by: string, id: string | null, b: any): Promise<Result<{ id: string; added: number; updated: number; closed: number }>> {
  if (!(await wemReady())) return fail(409, 'WEM orders need migration 0114 first.');
  const f = orderFields(b); if (!f.ok) return f;
  const dup = await all<any>('prod_orders', 'id', tenantId, (q) => q.eq('company', 'wem').eq('order_ref', f.order_ref));
  if (dup.some((d) => d.id !== id)) return fail(409, `Order ${f.order_ref} already exists — open it to change it.`);
  const row = { order_ref: f.order_ref, client: f.client, note: f.note, positions: f.positions, updated_at: new Date().toISOString() };
  let orderId = id;
  if (id) {
    const { data, error } = await db().from('prod_orders').update(row).eq('tenant_id', tenantId).eq('company', 'wem').eq('id', id).select('id');
    if (error) throw error; if (!data?.length) return fail(404, 'Order not found.');
  } else {
    const { data, error } = await db().from('prod_orders').insert({ tenant_id: tenantId, company: 'wem', created_by: by, ...row }).select('id').single();
    if (error) throw error; orderId = data.id;
  }
  const plan = planTasks(f.order_ref, f.positions, await listCatalog(tenantId));
  const have = await all<any>('prod_tasks', 'id,code,position,active,planned_qty,export_name', tenantId, (q) => q.eq('order_id', orderId));
  const key = (c: string, p: string) => c + '|' + p, byKey = new Map(have.map((t) => [key(t.code, t.position ?? ''), t]));
  const job_ref = f.order_ref, job_key = referenceKey(job_ref).slice(0, 80);
  let added = 0, updated = 0, closed = 0;
  const fresh: any[] = [];
  for (const t of plan) {
    const cur = byKey.get(key(t.code, t.position)); byKey.delete(key(t.code, t.position));
    const fields = { export_name: t.export_name, operation: t.name, alias: [t.code, t.station].filter(Boolean).join(' ').slice(0, 120), station: t.station, planned_qty: t.planned_qty, unit: t.unit, job_ref, job_key, op_id: t.code.slice(0, 20) };
    if (!cur) { fresh.push({ tenant_id: tenantId, company: 'wem', created_by: by, order_id: orderId, code: t.code, position: t.position, active: true, ...fields }); added++; continue; }
    const { error } = await db().from('prod_tasks').update({ ...fields, active: true }).eq('tenant_id', tenantId).eq('id', cur.id);
    if (error) throw error; updated++;
  }
  for (let i = 0; i < fresh.length; i += 200) { const { error } = await db().from('prod_tasks').insert(fresh.slice(i, i + 200)); if (error) throw error; }
  const gone = [...byKey.values()].filter((t) => t.active).map((t) => t.id);
  for (let i = 0; i < gone.length; i += 200) { const { error } = await db().from('prod_tasks').update({ active: false }).eq('tenant_id', tenantId).in('id', gone.slice(i, i + 200)); if (error) throw error; closed += Math.min(200, gone.length - i); }
  return { ok: true, id: orderId!, added, updated, closed };
}
/** Close (or reopen) all the order's tasks — the order is done. */
export async function setOrderTasksActive(tenantId: string, id: string, active: boolean): Promise<number> {
  const { data, error } = await db().from('prod_tasks').update({ active }).eq('tenant_id', tenantId).eq('company', 'wem').eq('order_id', id).select('id');
  if (error) throw error; return (data ?? []).length;
}
