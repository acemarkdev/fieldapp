// Fin&Ops ▸ Costs: sync the monday board "FAKTURY WSZYSTKIE" (all purchase invoices) into fin_costs
// and guard it with a Cost ID.
//
// Cost ID = SUPPLIER#INVOICE NO#NET (normalised). It is fixed the first time a complete invoice is
// synced, stored in the app (the trusted copy) and written to the board's "Cost ID" column. Every
// later sync rebuilds it from monday's current values: a difference means the supplier, invoice
// number or net amount was edited after registration → the row is flagged `changed`.
import { db } from './supabase';
import { Monday, withMondayRetry } from './monday';

export const FIN_BOARD_DEFAULT = '3609645458';
export const COST_ID_COLUMN_TITLE = 'Cost ID';

// monday column ids on the invoices board.
const C = {
  date: 'data', due: 'data3', invoiceNo: 'tekst1', net: 'tekst0', vat: 'liczby6', gross: 'liczby4', status: 'status9',
  description: 'tekst', costKind: 'tekst61', costType: 'status_1', subcategory: 'tekst53', department: 'color_mkz3ghnq',
  orderRef: 'tekst09', konto: 'dropdown',
} as const;

// ---- pure rules --------------------------------------------------------------------------------
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export function parseAmount(v: unknown): number | null {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
/** SUPPLIER#INVOICE NO#NET — null until all three are present. */
export function buildCostId(supplier: unknown, invoiceNo: unknown, net: number | null): string | null {
  const s = clean(supplier).toUpperCase(), i = clean(invoiceNo).replace(/\s/g, '').toUpperCase();
  if (!s || !i || net === null) return null;
  return `${s}#${i}#${net.toFixed(2)}`;
}

const PL_MONTHS = ['stycze', 'lut', 'marzec', 'kwiecie', 'maj', 'czerwiec', 'lipiec', 'sierpie', 'wrzesie', 'październik', 'listopad', 'grudzie'];
export function periodOf(date: string | null, groupTitle: string | null): { year: number | null; month: number | null } {
  const d = /^(\d{4})-(\d{2})-\d{2}$/.exec(date ?? '');
  if (d) return { year: +d[1], month: +d[2] };
  const g = (groupTitle ?? '').toLowerCase();
  const year = +(g.match(/(20\d{2})/)?.[1] ?? 0) || null;
  const hits = PL_MONTHS.map((m, i) => (g.includes(m) ? i + 1 : 0)).filter(Boolean);
  return { year, month: hits.length === 1 ? hits[0] : null };
}
export function companyOf(subcategory: string | null): 'acemark' | 'ace_group' | 'off_balance' {
  const s = clean(subcategory).toUpperCase();
  if (s === 'ACE_GROUP') return 'ace_group';
  if (s === 'POZA BILANS') return 'off_balance';
  return 'acemark';
}

export interface MondayCostItem { id: string; name: string; group: string | null; updated_at: string | null; cols: Record<string, string | null>; }

/** monday item (+ what we already hold for it) → the row to store. */
export function toCostRow(tenantId: string, it: MondayCostItem, costIdCol: string, ex: any | null, now: string): Record<string, any> {
  const supplier = clean(it.name) || null, invoiceNo = clean(it.cols[C.invoiceNo]) || null, net = parseAmount(it.cols[C.net]);
  const computed = buildCostId(supplier, invoiceNo, net);
  const date = clean(it.cols[C.date]) || null, due = clean(it.cols[C.due]) || null;
  const period = periodOf(date, it.group);
  const subcategory = clean(it.cols[C.subcategory]) || null;

  // Trusted id: keep what we hold; adopt the computed one only when we hold none yet.
  const costId: string | null = ex?.cost_id ?? computed;
  const adopted = !ex?.cost_id && !!computed;
  const changed = !!ex?.cost_id && computed !== ex.cost_id;

  return {
    tenant_id: tenantId, monday_item_id: it.id,
    supplier, invoice_no: invoiceNo, invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : null, due_date: /^\d{4}-\d{2}-\d{2}$/.test(due ?? '') ? due : null,
    net, vat: parseAmount(it.cols[C.vat]), gross: parseAmount(it.cols[C.gross]),
    status: clean(it.cols[C.status]) || null, description: clean(it.cols[C.description]) || null,
    cost_kind: clean(it.cols[C.costKind]) || null, cost_type: clean(it.cols[C.costType]) || null, subcategory,
    department: clean(it.cols[C.department]) || null, order_ref: clean(it.cols[C.orderRef]) || null, konto: clean(it.cols[C.konto]) || null,
    group_title: it.group, period_year: period.year, period_month: period.month, company: companyOf(subcategory),
    cost_id: costId,
    orig_supplier: adopted ? supplier : (ex?.orig_supplier ?? null),
    orig_invoice_no: adopted ? invoiceNo : (ex?.orig_invoice_no ?? null),
    orig_net: adopted ? net : (ex?.orig_net ?? null),
    changed, changed_at: changed ? (ex?.changed ? ex.changed_at : now) : null,
    monday_cost_id: clean(it.cols[costIdCol]) || null,
    monday_updated_at: it.updated_at, removed: false,
    first_synced_at: ex?.first_synced_at ?? now, last_synced_at: now,
  };
}

/** Per-row warnings shown in the app. `dupIds` = cost ids held by more than one live row. */
export function flagsOf(r: any, dupIds: Set<string>): string[] {
  const f: string[] = [];
  if (r.changed) f.push('changed');
  if (r.cost_id && dupIds.has(r.cost_id)) f.push('duplicate');
  if (!r.cost_id) f.push('incomplete');
  const code = /^(\d{3,4}(?:\.V)?)\b/i.exec(r.subcategory ?? '')?.[1]?.toUpperCase();
  if (code && r.konto && clean(r.konto).toUpperCase() !== code) f.push('konto');
  return f;
}

// ---- storage -----------------------------------------------------------------------------------
async function selectAll(table: string, cols: string, tenantId: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select(cols).eq('tenant_id', tenantId).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const LIST_COLS = 'id,monday_item_id,supplier,invoice_no,invoice_date,due_date,net,vat,gross,status,description,cost_kind,cost_type,subcategory,department,order_ref,konto,group_title,period_year,period_month,company,cost_id,orig_supplier,orig_invoice_no,orig_net,changed,changed_at,removed';

export async function listCosts(tenantId: string): Promise<any[]> {
  const rows = (await selectAll('fin_costs', LIST_COLS, tenantId)).filter((r) => !r.removed);
  const seen = new Map<string, number>();
  for (const r of rows) if (r.cost_id) seen.set(r.cost_id, (seen.get(r.cost_id) ?? 0) + 1);
  const dup = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  return rows.map((r) => ({ ...r, net: r.net === null ? null : Number(r.net), vat: r.vat === null ? null : Number(r.vat), gross: r.gross === null ? null : Number(r.gross), orig_net: r.orig_net === null ? null : Number(r.orig_net), flags: flagsOf(r, dup) }));
}
export async function lastSyncRun(tenantId: string): Promise<any | null> {
  const { data, error } = await db().from('fin_sync_runs').select('*').eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(1);
  if (error) throw error; return data?.[0] ?? null;
}

// ---- sync --------------------------------------------------------------------------------------
export interface SyncProgress { running: boolean; phase: string; done: number; total: number; startedAt: string; error?: string | null; result?: any }
const progress = new Map<string, SyncProgress>();
export const syncProgress = (tenantId: string): SyncProgress | null => progress.get(tenantId) ?? null;

async function ensureCostIdColumn(monday: Monday, boardId: string): Promise<string> {
  const cols = await withMondayRetry(() => monday.getColumns(boardId));
  const hit = cols.find((c) => c.title.trim().toLowerCase() === COST_ID_COLUMN_TITLE.toLowerCase());
  return hit ? hit.id : withMondayRetry(() => monday.createColumn(boardId, COST_ID_COLUMN_TITLE, 'text'));
}

/** Starts a sync in the background (one per tenant at a time). Poll syncProgress() for status. */
export function startCostSync(tenantId: string, boardId: string, startedBy: string): { started: boolean } {
  if (progress.get(tenantId)?.running) return { started: false };
  const p: SyncProgress = { running: true, phase: 'Reading invoices from monday…', done: 0, total: 0, startedAt: new Date().toISOString(), error: null };
  progress.set(tenantId, p);
  runCostSync(tenantId, boardId, startedBy, p)
    .catch((e: any) => { p.error = e?.message ?? String(e); console.error('[fin sync]', e); })
    .finally(() => { p.running = false; });
  return { started: true };
}

async function runCostSync(tenantId: string, boardId: string, startedBy: string, p: SyncProgress): Promise<void> {
  const now = new Date().toISOString();
  const run = await db().from('fin_sync_runs').insert({ tenant_id: tenantId, started_by: startedBy }).select('id').single();
  if (run.error) throw run.error;
  const finish = async (patch: Record<string, any>) => { await db().from('fin_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run.data.id); };
  try {
    const monday = new Monday();
    const costIdCol = await ensureCostIdColumn(monday, boardId);
    const items = await monday.listItemsDetailed(boardId, [...Object.values(C), costIdCol], (n) => { p.done = n; });

    p.phase = 'Saving to the app…'; p.done = 0; p.total = items.length;
    const existing = new Map<string, any>((await selectAll('fin_costs', 'id,monday_item_id,cost_id,orig_supplier,orig_invoice_no,orig_net,changed,changed_at,first_synced_at,removed', tenantId)).map((r) => [r.monday_item_id, r]));
    const rows = items.map((it) => toCostRow(tenantId, it, costIdCol, existing.get(it.id) ?? null, now));
    let added = 0, updated = 0;
    for (const r of rows) (existing.has(r.monday_item_id) ? updated++ : added++);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db().from('fin_costs').upsert(rows.slice(i, i + 500), { onConflict: 'tenant_id,monday_item_id' });
      if (error) throw error;
      p.done = Math.min(rows.length, i + 500);
    }
    // Items that disappeared from the board.
    const live = new Set(items.map((i) => i.id));
    const gone = [...existing.values()].filter((r) => !live.has(r.monday_item_id) && !r.removed).map((r) => r.id);
    for (let i = 0; i < gone.length; i += 200) {
      const { error } = await db().from('fin_costs').update({ removed: true, last_synced_at: now }).in('id', gone.slice(i, i + 200));
      if (error) throw error;
    }

    // Write the trusted Cost ID to the board wherever the board's column differs. Not recorded row by
    // row here: the next sync re-reads the column, so an interrupted run simply resumes.
    const toWrite = rows.filter((r) => r.cost_id && r.monday_cost_id !== r.cost_id).map((r) => ({ itemId: r.monday_item_id as string, value: r.cost_id as string }));
    p.phase = 'Writing Cost IDs to monday…'; p.done = 0; p.total = toWrite.length;
    let written = 0;
    for (let i = 0; i < toWrite.length; i += 20) {
      const batch = toWrite.slice(i, i + 20);
      await monday.setTextColumnBatch(boardId, costIdCol, batch);
      written += batch.length; p.done = written;
    }

    const result = { scanned: items.length, added, updated, changed: rows.filter((r) => r.changed).length, removed: gone.length, ids_written: written };
    p.result = result; p.phase = 'Done';
    await finish(result);
  } catch (e: any) {
    await finish({ error: (e?.message ?? String(e)).slice(0, 1000) });
    throw e;
  }
}

/** Admin accepts an edit: the current monday values become the trusted ones (new Cost ID, written to the board). */
export async function acceptCostChange(tenantId: string, id: string, boardId: string): Promise<{ ok: boolean; error?: string; costId?: string }> {
  const { data: r, error } = await db().from('fin_costs').select('id,monday_item_id,supplier,invoice_no,net,changed').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!r) return { ok: false, error: 'Not found.' };
  const net = r.net === null ? null : Number(r.net);
  const costId = buildCostId(r.supplier, r.invoice_no, net);
  if (!costId) return { ok: false, error: 'This invoice is missing its supplier, invoice number or net amount in monday.' };
  const monday = new Monday();
  const col = await ensureCostIdColumn(monday, boardId);
  await monday.setTextColumnBatch(boardId, col, [{ itemId: r.monday_item_id, value: costId }]);
  const upd = await db().from('fin_costs').update({ cost_id: costId, orig_supplier: r.supplier, orig_invoice_no: r.invoice_no, orig_net: net, changed: false, changed_at: null, monday_cost_id: costId }).eq('id', r.id);
  if (upd.error) throw upd.error;
  return { ok: true, costId };
}
