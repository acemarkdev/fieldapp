// Fin&Ops ▸ Sales orders: cost reports. A fitter reports an extra installation cost against an
// order; the order's sales rep approves it, the accountant marks it paid, and only a PAID report
// is added to the order's installation cost. The rules are pure functions (tested); storage below.
import { db } from './supabase';
import { parseMoney } from './finJobs';

export const EXPENSE_KINDS = ['allowance', 'fitting_bonus', 'accommodation', 'travel', 'other'] as const;
export type ExpenseKind = typeof EXPENSE_KINDS[number];
export const EXPENSE_KIND_LABEL: Record<ExpenseKind, string> = { allowance: 'Travel allowance (dieta)', fitting_bonus: 'Fitting bonus', accommodation: 'Accommodation', travel: 'Travel / fuel', other: 'Other' };
export type ExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'paid';
export interface ExpenseRow {
  id: string; order_id: string; user_id: string | null; user_name: string | null; kind: ExpenseKind; amount: number; note: string | null;
  status: ExpenseStatus; created_at: string; decided_by: string | null; decided_at: string | null; reject_reason: string | null; paid_by: string | null; paid_at: string | null;
}
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const clean = (v: unknown) => String(v ?? '').trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The form a fitter fills in → the stored fields. */
export function expenseFields(b: any): Result<{ fields: { kind: ExpenseKind; amount: number; note: string | null } }> {
  const kind = clean(b?.kind) as ExpenseKind;
  if (!EXPENSE_KINDS.includes(kind)) return fail(400, 'Choose the type of cost.');
  const amount = parseMoney(b?.amount);
  if (amount === null || amount <= 0) return fail(400, 'Enter the amount in PLN.');
  if (amount > 100000) return fail(400, 'The amount looks too high.');
  const note = clean(b?.note).slice(0, 500) || null;
  if (kind === 'other' && !note) return fail(400, 'For “Other” describe the cost in the note.');
  return { ok: true, fields: { kind, amount, note } };
}

export type ExpenseAction = 'approve' | 'reject' | 'pay' | 'unpay';
/** Who is acting: the order's own sales rep, another rep, the accountant, or an admin. */
export interface ExpenseActor { role: 'rep' | 'finance' | 'admin'; userId: string }
/** The step a report may take. The order's sales rep approves or rejects a submitted report (the
 *  accountant only where the order has no rep; an admin always). Only the accountant / admin marks
 *  it paid, can take the payment back, or can send an approved report back as rejected. */
export function expenseStep(status: ExpenseStatus, action: ExpenseAction, actor: ExpenseActor, orderRepId: string | null, reason?: unknown): Result<{ status: ExpenseStatus }> {
  const reviewer = actor.role === 'admin' || (actor.role === 'rep' && !!orderRepId && orderRepId === actor.userId) || (actor.role === 'finance' && !orderRepId);
  const payer = actor.role === 'admin' || actor.role === 'finance';
  if (action === 'approve') {
    if (status !== 'submitted') return fail(409, 'Only a report waiting for approval can be approved.');
    if (!reviewer) return fail(403, 'The sales rep of this order approves its cost reports.');
    return { ok: true, status: 'approved' };
  }
  if (action === 'reject') {
    if (status !== 'submitted' && status !== 'approved') return fail(409, 'This report can no longer be rejected.');
    if (status === 'submitted' ? !(reviewer || payer) : !payer) return fail(403, 'Not allowed.');
    if (!clean(reason)) return fail(400, 'Say why the report is rejected.');
    return { ok: true, status: 'rejected' };
  }
  if (action === 'pay') {
    if (!payer) return fail(403, 'Only the accountant marks a cost report as paid.');
    if (status !== 'approved') return fail(409, 'Only an approved report can be marked as paid.');
    return { ok: true, status: 'paid' };
  }
  if (action === 'unpay') {
    if (!payer) return fail(403, 'Not allowed.');
    if (status !== 'paid') return fail(409, 'This report is not marked as paid.');
    return { ok: true, status: 'approved' };
  }
  return fail(400, 'Unknown action.');
}

/** Paid reports per order — the part that is added to the installation cost. */
export function paidByOrder(expenses: Pick<ExpenseRow, 'order_id' | 'amount' | 'status'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of expenses) if (e.status === 'paid') m.set(e.order_id, round2((m.get(e.order_id) ?? 0) + (Number(e.amount) || 0)));
  return m;
}

// ---- storage -----------------------------------------------------------------------------------
const COLS = 'id,order_id,user_id,user_name,kind,amount,note,status,created_at,decided_by,decided_at,reject_reason,paid_by,paid_at';
const out = (r: any): ExpenseRow => ({ ...r, amount: Number(r.amount) || 0 });

/** Every report of the tenant. Returns [] while migration 0071 has not been run, so the orders page keeps working. */
export async function listExpenses(tenantId: string): Promise<ExpenseRow[]> {
  const rows: ExpenseRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_order_expenses').select(COLS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).range(from, from + 999);
    if (error) { if (/fin_order_expenses/.test(error.message) && /(does not exist|schema cache|not find)/i.test(error.message)) return []; throw error; }
    rows.push(...(data ?? []).map(out));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
export async function listMyExpenses(tenantId: string, userId: string): Promise<ExpenseRow[]> {
  const { data, error } = await db().from('fin_order_expenses').select(COLS).eq('tenant_id', tenantId).eq('user_id', userId).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []).map(out);
}
/** Is the order current enough for the fitter's list? Yes when the month it counts from (first
 *  payment) or its planned realisation month lies between 3 months back and 2 months ahead of
 *  today. An order with neither date yet is kept while its offer is that recent. */
export function inExpenseWindow(o: { counted_date?: string | null; planned_year?: number | null; planned_month?: number | null; offer_year?: number | null; offer_month?: number | null }, today: string): boolean {
  const now = +today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1);
  const near = (m: number | null) => m !== null && m >= now - 3 && m <= now + 2;
  const counted = o.counted_date ? +o.counted_date.slice(0, 4) * 12 + (+o.counted_date.slice(5, 7) - 1) : null;
  const planned = o.planned_year && o.planned_month ? o.planned_year * 12 + (o.planned_month - 1) : null;
  if (counted !== null || planned !== null) return near(counted) || near(planned);
  return near(o.offer_year && o.offer_month ? o.offer_year * 12 + (o.offer_month - 1) : null);
}
type OrderForList = { id: string; status: string; order_ref: string; job_ref: string | null; customer: string | null; counted_date: string | null; planned_year: number | null; planned_month: number | null; offer_year: number | null; offer_month: number | null };
/** The orders a fitter can report against: accepted and current (see inExpenseWindow), number and
 *  customer only — never values. Newest first. */
export function expenseOrders(orders: OrderForList[], today: string): { id: string; label: string }[] {
  const when = (o: OrderForList) => o.counted_date?.slice(0, 7) ?? (o.planned_year && o.planned_month ? `${o.planned_year}-${String(o.planned_month).padStart(2, '0')}` : `${o.offer_year ?? 0}-${String(o.offer_month ?? 0).padStart(2, '0')}`);
  return orders.filter((o) => o.status === 'accepted' && inExpenseWindow(o, today))
    .sort((a, b) => when(b).localeCompare(when(a)) || String(a.order_ref).localeCompare(String(b.order_ref)))
    .map((o) => ({ id: o.id, label: orderLabel(o) }));
}
export function orderLabel(o: { order_ref: string; job_ref?: string | null; customer?: string | null }): string {
  const ref = clean(o.order_ref), cust = clean(o.customer);
  return [clean(o.job_ref), ref, cust && !ref.toLowerCase().includes(cust.toLowerCase()) ? cust : ''].filter(Boolean).join(' · ').slice(0, 140);
}
export async function addExpense(tenantId: string, user: { id: string; name: string }, b: any): Promise<Result<{ id: string }>> {
  const f = expenseFields(b); if (!f.ok) return f;
  const o = await db().from('fin_orders').select('id,status').eq('tenant_id', tenantId).eq('id', clean(b?.order_id)).maybeSingle();
  if (o.error || !o.data) return fail(400, 'Choose the order.');
  if (o.data.status !== 'accepted') return fail(409, 'Costs can be reported only for accepted orders.');
  const { data, error } = await db().from('fin_order_expenses').insert({ tenant_id: tenantId, order_id: o.data.id, user_id: user.id, user_name: user.name, ...f.fields }).select('id').single();
  if (error) throw error;
  return { ok: true, id: data.id };
}
/** A fitter takes back their own report while nobody has decided on it. */
export async function withdrawExpense(tenantId: string, userId: string, id: string): Promise<Result> {
  const { data, error } = await db().from('fin_order_expenses').delete().eq('tenant_id', tenantId).eq('id', id).eq('user_id', userId).eq('status', 'submitted').select('id');
  if (error) throw error;
  return (data ?? []).length ? { ok: true } : fail(409, 'Only a report that is still waiting for approval can be withdrawn.');
}
export async function actOnExpense(tenantId: string, id: string, action: ExpenseAction, actor: ExpenseActor, by: string, reason?: unknown): Promise<Result<{ status: ExpenseStatus; order_id: string }>> {
  const cur = await db().from('fin_order_expenses').select('id,status,order_id').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (cur.error) throw cur.error;
  if (!cur.data) return fail(404, 'Cost report not found.');
  const ord = await db().from('fin_orders').select('rep_user_id').eq('tenant_id', tenantId).eq('id', cur.data.order_id).maybeSingle();
  if (ord.error) throw ord.error;
  const repId = ord.data?.rep_user_id ?? null;
  // another rep's order does not exist for a rep
  if (actor.role === 'rep' && repId !== actor.userId) return fail(404, 'Cost report not found.');
  const step = expenseStep(cur.data.status, action, actor, repId, reason); if (!step.ok) return step;
  const now = new Date().toISOString();
  const patch: Record<string, any> = { status: step.status };
  if (action === 'approve') Object.assign(patch, { decided_by: by, decided_at: now, reject_reason: null });
  if (action === 'reject') Object.assign(patch, { decided_by: by, decided_at: now, reject_reason: clean(reason).slice(0, 300) });
  if (action === 'pay') Object.assign(patch, { paid_by: by, paid_at: now });
  if (action === 'unpay') Object.assign(patch, { paid_by: null, paid_at: null });
  // the status in the filter makes two people clicking at once safe: the second update changes nothing
  const { data, error } = await db().from('fin_order_expenses').update(patch).eq('id', id).eq('status', cur.data.status).select('id');
  if (error) throw error;
  if (!(data ?? []).length) return fail(409, 'Someone else has just changed this report — reload the page.');
  return { ok: true, status: step.status, order_id: cur.data.order_id };
}
