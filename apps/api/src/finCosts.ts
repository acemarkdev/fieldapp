// Fin&Ops ▸ Costs: sync the monday board "FAKTURY WSZYSTKIE" (all purchase invoices) into fin_costs
// and guard it with a Cost ID.
//
// Cost ID = SUPPLIER#INVOICE NO#NET (normalised). It is fixed the first time a complete invoice is
// synced, stored in the app (the trusted copy) and written to the board's "Cost ID" column. Every
// later sync rebuilds it from monday's current values: a difference means the supplier, invoice
// number or net amount was edited after registration → the row is flagged `changed`.
import { db } from './supabase';
import { Monday, withMondayRetry } from './monday';
import { getConfig, setConfig } from './store';

// The invoices board per environment. Only PROD touches the real board "FAKTURY WSZYSTKIE"; test and
// local development use its copy "FAKTURY WSZYSTKIE _TEST" (same column ids), so test syncs can never
// write Cost IDs to — or fight with prod over — the live board. Override with env FIN_COSTS_BOARD_ID
// or app_config 'fin_costs_board_id'.
export const FIN_BOARD_PROD = '3609645458', FIN_BOARD_TEST = '18433834194';
export const FIN_BOARD_DEFAULT = process.env.FIN_COSTS_BOARD_ID || (process.env.APP_ENV === 'prod' ? FIN_BOARD_PROD : FIN_BOARD_TEST);
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
/** SUPPLIER#INVOICE NO#NET. An entry with no invoice number (a fee, a declaration…) is still
 *  registered: its middle part becomes BRAK-FV-<invoice date> (or the monday item id when there is
 *  no date either). Null only when the supplier or the net amount is missing. */
export const NO_INVOICE = 'BRAK-FV-';
export function buildCostId(supplier: unknown, invoiceNo: unknown, net: number | null, fallback: { date?: string | null; itemId?: string } = {}): string | null {
  const s = clean(supplier).toUpperCase();
  let i = clean(invoiceNo).replace(/\s/g, '').toUpperCase();
  if (!s || net === null) return null;
  if (!i) { const tail = clean(fallback.date) || (fallback.itemId ? 'ITEM' + fallback.itemId : ''); if (!tail) return null; i = NO_INVOICE + tail; }
  return `${s}#${i}#${net.toFixed(2)}`;
}
const idParts = (id: string) => { const a = id.lastIndexOf('#'), b = id.indexOf('#'); return { supplier: id.slice(0, b), inv: id.slice(b + 1, a), net: id.slice(a + 1) }; };
/** True when `next` is the same entry as placeholder id `prev`, now with its real invoice number filled in. */
export function isNumberFilledIn(prev: string, next: string | null): boolean {
  if (!next) return false;
  const p = idParts(prev), n = idParts(next);
  return p.inv.startsWith(NO_INVOICE) && !n.inv.startsWith(NO_INVOICE) && p.supplier === n.supplier && p.net === n.net;
}

const PL_MONTHS = ['stycze', 'lut', 'marzec', 'kwiecie', 'maj', 'czerwiec', 'lipiec', 'sierpie', 'wrzesie', 'październik', 'listopad', 'grudzie'];
/** Month named by a monday group title ("Wrzesień 2026"); month is null when the title names none or several. */
export function groupPeriod(groupTitle: string | null): { year: number | null; month: number | null } {
  const g = (groupTitle ?? '').toLowerCase();
  const year = +(g.match(/(20\d{2})/)?.[1] ?? 0) || null;
  const hits = PL_MONTHS.map((m, i) => (g.includes(m) ? i + 1 : 0)).filter(Boolean);
  return { year, month: hits.length === 1 ? hits[0] : null };
}
/** The accounting month of an invoice = the monday group it is filed in (that is what the board's own
 *  totals and the sheet's "Control sum – Monday" add up). The invoice date is only the fallback for a
 *  group that doesn't name a single month. */
export function periodOf(date: string | null, groupTitle: string | null): { year: number | null; month: number | null } {
  const g = groupPeriod(groupTitle);
  if (g.year && g.month) return g;
  const d = /^(\d{4})-(\d{2})-\d{2}$/.exec(date ?? '');
  if (d) return { year: +d[1], month: +d[2] };
  return g;
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
  const date = clean(it.cols[C.date]) || null, due = clean(it.cols[C.due]) || null;
  const computed = buildCostId(supplier, invoiceNo, net, { date, itemId: it.id });
  const period = periodOf(date, it.group);
  const subcategory = clean(it.cols[C.subcategory]) || null;

  // Trusted id: keep what we hold. Adopt the computed one when we hold none yet, or when the only
  // difference is that a missing invoice number has now been filled in (not an edit worth flagging).
  const upgrade = !!ex?.cost_id && isNumberFilledIn(ex.cost_id, computed);
  const adopted = (!ex?.cost_id && !!computed) || upgrade;
  const costId: string | null = adopted ? computed : (ex?.cost_id ?? null);
  const changed = !!ex?.cost_id && !upgrade && computed !== ex.cost_id;

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

/** Category code: "631 Materials" → 631, "499.V Handel" → 499.V, "Tax" → TAX. */
export function categoryCode(subcategory: unknown): string | null {
  const s = clean(subcategory).toUpperCase();
  if (!s) return null;
  return /^(\d{3,4}(?:\.V)?)(?![\w.])/.exec(s)?.[1] ?? s;
}
/** Fixed or variable — decided by the category, as in the sheet (the board's Koszt column is not used). */
export function costKindOf(subcategory: unknown): 'fixed' | 'variable' {
  return /^(469|401|412|457|489|463|464|467)$/.test(categoryCode(subcategory) ?? '') ? 'fixed' : 'variable';
}

/** Per-row warnings shown in the app. `dupIds` = cost ids held by more than one live row.
 *  konto / unclassified / period are the "to fix on the board" set. Which categories a department
 *  uses is NOT checked: the Performance Sheet is an open list (e.g. Sales may have Internet costs). */
export function flagsOf(r: any, dupIds: Set<string>): string[] {
  const f: string[] = [];
  if (r.changed) f.push('changed');
  if (r.cost_id && dupIds.has(r.cost_id)) f.push('duplicate');
  if (!r.cost_id) f.push('incomplete');
  else if (idParts(r.cost_id).inv.startsWith(NO_INVOICE)) f.push('noinvoice');
  // Filed in one month's group but dated in another month → the date (or the group) is wrong.
  const g = groupPeriod(r.group_title), d = /^(\d{4})-(\d{2})-/.exec(r.invoice_date ?? '');
  if (g.year && g.month && d && (+d[1] !== g.year || +d[2] !== g.month)) f.push('period');
  const code = categoryCode(r.subcategory);
  if (!r.department || !code) f.push('unclassified');
  // KONTO may hold several values ("499.V, 499"): fine if any of them is the category's code.
  const kontos = clean(r.konto).toUpperCase().split(',').map((k) => k.trim()).filter(Boolean);
  if (code && /^\d/.test(code) && kontos.length && !kontos.includes(code)) f.push('konto');
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

// Sync scope: the whole board, or only the month groups of the last N months (the board has one group
// per month). A month is in scope when it is the current month, one of the N-1 before it, or later.
export type SyncScope = number | null;   // months, or null = everything
export const AUTO_SYNC_MONTHS = 12;
export function parseScope(v: unknown): SyncScope { const n = Number(v); return n === 3 || n === 12 ? n : null; }
export const scopeLabel = (m: SyncScope) => (m ? `last ${m} months` : 'all history');
export function inScope(year: number | null, month: number | null, months: SyncScope, now: Date = new Date()): boolean {
  if (!months) return true;
  if (!year || !month) return false;
  const [cy, cm] = localDayHour(now, AUTO_SYNC_TZ).day.split('-').map(Number);
  return (cy - year) * 12 + (cm - month) < months;
}

/** Starts a sync in the background (one per tenant at a time). Poll syncProgress() for status. */
export function startCostSync(tenantId: string, boardId: string, startedBy: string, months: SyncScope = null): { started: boolean } {
  if (progress.get(tenantId)?.running) return { started: false };
  const p: SyncProgress = { running: true, phase: `Reading invoices from monday (${scopeLabel(months)})…`, done: 0, total: 0, startedAt: new Date().toISOString(), error: null };
  progress.set(tenantId, p);
  runCostSync(tenantId, boardId, startedBy, p, months)
    .catch((e: any) => { p.error = e?.message ?? String(e); console.error('[fin sync]', e); })
    .finally(() => { p.running = false; });
  return { started: true };
}

async function runCostSync(tenantId: string, boardId: string, startedBy: string, p: SyncProgress, months: SyncScope): Promise<void> {
  const now = new Date().toISOString();
  const run = await db().from('fin_sync_runs').insert({ tenant_id: tenantId, started_by: startedBy }).select('id').single();
  if (run.error) throw run.error;
  const finish = async (patch: Record<string, any>) => { await db().from('fin_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run.data.id); };
  try {
    const monday = new Monday();
    const costIdCol = await ensureCostIdColumn(monday, boardId);
    const colIds = [...Object.values(C), costIdCol];
    let items: MondayCostItem[];
    if (!months) items = await monday.listItemsDetailed(boardId, colIds, (n) => { p.done = n; });
    else {
      // Only the month groups in scope, one group at a time.
      const groups = (await monday.listGroups(boardId)).filter((g) => { const gp = groupPeriod(g.title); return inScope(gp.year, gp.month, months); });
      items = [];
      for (const g of groups) { items.push(...await monday.listGroupItemsDetailed(boardId, g.id, colIds)); p.done = items.length; }
    }

    p.phase = 'Saving to the app…'; p.done = 0; p.total = items.length;
    const existing = new Map<string, any>((await selectAll('fin_costs', 'id,monday_item_id,cost_id,orig_supplier,orig_invoice_no,orig_net,changed,changed_at,first_synced_at,removed,period_year,period_month', tenantId)).map((r) => [r.monday_item_id, r]));
    const rows = items.map((it) => toCostRow(tenantId, it, costIdCol, existing.get(it.id) ?? null, now));
    let added = 0, updated = 0;
    for (const r of rows) (existing.has(r.monday_item_id) ? updated++ : added++);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db().from('fin_costs').upsert(rows.slice(i, i + 500), { onConflict: 'tenant_id,monday_item_id' });
      if (error) throw error;
      p.done = Math.min(rows.length, i + 500);
    }
    // Items that disappeared from the board. In a scoped sync only months that were actually read can
    // be judged — older invoices were not looked at, so they are left alone.
    const live = new Set(items.map((i) => i.id));
    const gone = [...existing.values()].filter((r) => !live.has(r.monday_item_id) && !r.removed && inScope(r.period_year, r.period_month, months)).map((r) => r.id);
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
  const { data: r, error } = await db().from('fin_costs').select('id,monday_item_id,supplier,invoice_no,invoice_date,net,changed').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!r) return { ok: false, error: 'Not found.' };
  const net = r.net === null ? null : Number(r.net);
  const costId = buildCostId(r.supplier, r.invoice_no, net, { date: r.invoice_date, itemId: r.monday_item_id });
  if (!costId) return { ok: false, error: 'This invoice is missing its supplier or net amount in monday.' };
  const monday = new Monday();
  const col = await ensureCostIdColumn(monday, boardId);
  await monday.setTextColumnBatch(boardId, col, [{ itemId: r.monday_item_id, value: costId }]);
  const upd = await db().from('fin_costs').update({ cost_id: costId, orig_supplier: r.supplier, orig_invoice_no: r.invoice_no, orig_net: net, changed: false, changed_at: null, monday_cost_id: costId }).eq('id', r.id);
  if (upd.error) throw upd.error;
  return { ok: true, costId };
}

// ---- automatic daily sync ----------------------------------------------------------------------
// Settings live in app_config (not secret): on/off + the hour of day, in Poland time.
export const AUTO_SYNC_TZ = 'Europe/Warsaw';
export const AUTO_SYNC_BY = 'Automatic (daily)';
export interface AutoSyncSettings { enabled: boolean; hour: number; tz: string }

export async function getAutoSyncSettings(): Promise<AutoSyncSettings> {
  const [en, hr] = await Promise.all([getConfig('fin_sync_enabled'), getConfig('fin_sync_hour')]);
  const hour = Number(hr);
  return { enabled: en !== 'false', hour: hr !== null && hr !== '' && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 6, tz: AUTO_SYNC_TZ };
}
export async function setAutoSyncSettings(enabled: boolean, hour: number): Promise<void> {
  await setConfig('fin_sync_enabled', enabled ? 'true' : 'false');
  await setConfig('fin_sync_hour', String(hour));
}

/** Local calendar day ("2026-10-03") and hour (0–23) of an instant in the given time zone. */
export function localDayHour(at: Date, tz: string): { day: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
/** Due when it's on, the hour has been reached today, and no automatic run has started yet today
 *  (so a server restart after the hour still catches up, and it never runs twice in a day). */
export function autoSyncDue(now: Date, s: AutoSyncSettings, lastAutoStartedAt: string | null): boolean {
  if (!s.enabled) return false;
  const n = localDayHour(now, s.tz);
  if (n.hour < s.hour) return false;
  return !lastAutoStartedAt || localDayHour(new Date(lastAutoStartedAt), s.tz).day !== n.day;
}
async function lastAutoRunStart(tenantId: string): Promise<string | null> {
  const { data, error } = await db().from('fin_sync_runs').select('started_at').eq('tenant_id', tenantId).eq('started_by', AUTO_SYNC_BY).order('started_at', { ascending: false }).limit(1);
  if (error) throw error; return data?.[0]?.started_at ?? null;
}
/** Called on a timer by the office server. Starts the daily sync when it is due. */
export async function autoSyncTick(tenantId: string, boardId: string): Promise<boolean> {
  if (syncProgress(tenantId)?.running) return false;
  const s = await getAutoSyncSettings();
  if (!s.enabled || localDayHour(new Date(), s.tz).hour < s.hour) return false;   // cheap exit before touching the runs table
  if (!autoSyncDue(new Date(), s, await lastAutoRunStart(tenantId))) return false;
  return startCostSync(tenantId, boardId, AUTO_SYNC_BY, AUTO_SYNC_MONTHS).started;
}
