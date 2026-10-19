// Fin&Ops ▸ Job costs: the budget of a Z job — the offered price, the expected cost of producing it
// (the same cost lines as the actual costs; labour = hours × rate) and of buying it in and trading it
// instead — then the decision (produce / trade / reject) and, once costs come in, budget vs actual.
import { db } from './supabase';
import { JOB_KINDS, parseMoney, type JobKind } from './finJobs';

export const BUDGET_KINDS = JOB_KINDS.filter((k) => k !== 'labour') as Exclude<JobKind, 'labour'>[];
export type Decision = 'undecided' | 'produce' | 'trade' | 'rejected';
export const DECISIONS: Decision[] = ['undecided', 'produce', 'trade', 'rejected'];
export interface Budget {
  job_id?: string; offer_net: number | null; produce: Partial<Record<Exclude<JobKind, 'labour'>, number>>;
  labour_hours: number | null; labour_rate: number | null;
  trade_supplier: string | null; trade_purchase: number | null; trade_transport: number | null; trade_other: number | null;
  note: string | null; decision: Decision; decided_by?: string | null; decided_at?: string | null; updated_by?: string | null; updated_at?: string | null;
}
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Form input → the stored budget. Empty = not estimated (counts as 0 in the totals). */
export function budgetFields(b: any): Result<{ fields: Omit<Budget, 'decision'> }> {
  const money = (v: unknown, what: string): number | null | string => {
    if (v === null || v === undefined || clean(v) === '') return null;
    const n = parseMoney(v); if (n === null) return `${what}: that is not a number.`;
    if (n < 0) return `${what} cannot be negative.`; return n;
  };
  const errs: string[] = [];
  const take = (v: unknown, what: string) => { const r = money(v, what); if (typeof r === 'string') { errs.push(r); return null; } return r; };
  const produce: Budget['produce'] = {};
  for (const k of BUDGET_KINDS) { const v = take(b?.produce?.[k], k); if (v !== null) produce[k] = v; }
  const f = {
    offer_net: take(b?.offer_net, 'Offered price'), produce,
    labour_hours: take(b?.labour_hours, 'Labour hours'), labour_rate: take(b?.labour_rate, 'Labour rate'),
    trade_supplier: clean(b?.trade_supplier).slice(0, 120) || null,
    trade_purchase: take(b?.trade_purchase, 'Purchase price'), trade_transport: take(b?.trade_transport, 'Trade transport'), trade_other: take(b?.trade_other, 'Trade other costs'),
    note: clean(b?.note).slice(0, 500) || null,
  };
  if (errs.length) return fail(400, errs[0]);
  if (f.labour_hours !== null && f.labour_hours > 100000) return fail(400, 'Labour hours look wrong.');
  return { ok: true, fields: f };
}

export interface Side { costs: number; profit: number | null; margin: number | null }
export interface BudgetCalc {
  offer: number | null;
  produce: Side & { lines: Record<Exclude<JobKind, 'labour'>, number>; labour: number };
  trade: Side & { estimated: boolean };
  better: 'produce' | 'trade' | null; advantage: number | null;   // how much more profit the better option makes
}
const side = (offer: number | null, costs: number): Side => ({ costs: round2(costs), profit: offer === null ? null : round2(offer - costs), margin: offer ? Math.round(((offer - costs) / offer) * 10000) / 10000 : null });
/** The two options side by side and which one earns more. */
export function budgetCalc(b: Budget): BudgetCalc {
  const lines = Object.fromEntries(BUDGET_KINDS.map((k) => [k, round2(b.produce?.[k] ?? 0)])) as Record<Exclude<JobKind, 'labour'>, number>;
  const labour = round2((b.labour_hours ?? 0) * (b.labour_rate ?? 0));
  const pCosts = BUDGET_KINDS.reduce((s, k) => s + lines[k], 0) + labour;
  const estimated = b.trade_purchase !== null && b.trade_purchase !== undefined;
  const tCosts = (b.trade_purchase ?? 0) + (b.trade_transport ?? 0) + (b.trade_other ?? 0);
  const produce = { ...side(b.offer_net, pCosts), lines, labour };
  const trade = { ...side(b.offer_net, tCosts), estimated };
  let better: BudgetCalc['better'] = null, advantage: number | null = null;
  if (b.offer_net !== null && pCosts > 0 && estimated) { better = pCosts <= tCosts ? 'produce' : 'trade'; advantage = round2(Math.abs(tCosts - pCosts)); }
  return { offer: b.offer_net, produce, trade, better, advantage };
}

export const OVERRUN = 0.10;   // actual costs more than 10 % over the budget are flagged
export interface VsActual {
  basis: 'produce' | 'trade';
  rows: { kind: JobKind | 'trade'; budget: number; actual: number; diff: number }[];
  budgetCost: number; actualCost: number; diff: number; overrun: boolean;
  budgetProfit: number | null; actualProfit: number | null;
}
/** Budget against what the job has actually cost so far. The produce budget is compared line by line;
 *  a trade budget as one total (the purchase is booked as cost lines of any kind). */
export function vsActual(b: Budget, actual: { sums: Record<string, number>; totalCost: number; sales: number | null }): VsActual {
  const c = budgetCalc(b);
  const basis: VsActual['basis'] = b.decision === 'trade' ? 'trade' : 'produce';
  const rows = basis === 'produce'
    ? [...BUDGET_KINDS.map((k) => ({ kind: k as JobKind, budget: c.produce.lines[k], actual: round2(actual.sums[k] ?? 0) })), { kind: 'labour' as JobKind, budget: c.produce.labour, actual: round2(actual.sums.labour ?? 0) }]
        .map((r) => ({ ...r, diff: round2(r.actual - r.budget) }))
    : [{ kind: 'trade' as const, budget: c.trade.costs, actual: round2(actual.totalCost), diff: round2(actual.totalCost - c.trade.costs) }];
  const budgetCost = basis === 'produce' ? c.produce.costs : c.trade.costs;
  const actualCost = round2(actual.totalCost);
  const sales = actual.sales ?? null;
  return { basis, rows, budgetCost, actualCost, diff: round2(actualCost - budgetCost), overrun: budgetCost > 0 && actualCost > budgetCost * (1 + OVERRUN),
    budgetProfit: basis === 'produce' ? c.produce.profit : c.trade.profit, actualProfit: sales === null ? null : round2(sales - actualCost) };
}

/** The decision step: only the decision-maker (admin) decides, reopens a decided budget, and a decided
 *  budget can't be edited. */
export function decisionStep(cur: Decision, next: unknown, isAdmin: boolean): Result<{ decision: Decision }> {
  if (!isAdmin) return fail(403, 'Only an admin decides whether a job is produced, traded or rejected.');
  const d = String(next) as Decision;
  if (!DECISIONS.includes(d)) return fail(400, 'Unknown decision.');
  if (d === cur) return fail(409, 'The budget already has this decision.');
  return { ok: true, decision: d };
}

// ---- storage -------------------------------------------------------------------------------------
const num = (v: any) => (v === null || v === undefined ? null : Number(v));
const out = (r: any): Budget => ({ ...r, offer_net: num(r.offer_net), labour_hours: num(r.labour_hours), labour_rate: num(r.labour_rate), trade_purchase: num(r.trade_purchase), trade_transport: num(r.trade_transport), trade_other: num(r.trade_other),
  produce: Object.fromEntries(Object.entries(r.produce ?? {}).map(([k, v]) => [k, Number(v) || 0])) });
const missing = (e: any) => /fin_job_budgets/.test(String(e?.message ?? '')) && /(does not exist|schema cache|not find)/i.test(String(e?.message ?? ''));
export async function getBudget(tenantId: string, jobId: string): Promise<Budget | null> {
  const { data, error } = await db().from('fin_job_budgets').select('*').eq('tenant_id', tenantId).eq('job_id', jobId).maybeSingle();
  if (error) { if (missing(error)) return null; throw error; }
  return data ? out(data) : null;
}
export async function listBudgets(tenantId: string): Promise<Map<string, Budget>> {
  const m = new Map<string, Budget>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('fin_job_budgets').select('*').eq('tenant_id', tenantId).order('job_id').range(from, from + 999);
    if (error) { if (missing(error)) return m; throw error; }
    for (const r of data ?? []) m.set(r.job_id, out(r));
    if (!data || data.length < 1000) break;
  }
  return m;
}
async function jobOf(tenantId: string, jobId: string): Promise<Result<{ job: any }>> {
  const { data, error } = await db().from('fin_jobs').select('id,reference,locked').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle();
  if (error) throw error; if (!data) return fail(404, 'Job not found.');
  return { ok: true, job: data };
}
export async function saveBudget(tenantId: string, jobId: string, by: string, b: any): Promise<Result<{ reference: string }>> {
  const j = await jobOf(tenantId, jobId); if (!j.ok) return j;
  if (j.job.locked) return fail(409, `Job ${j.job.reference} is locked — an admin has to unlock it first.`);
  const cur = await getBudget(tenantId, jobId);
  if (cur && cur.decision !== 'undecided') return fail(409, 'This budget is decided and frozen — an admin can reopen it.');
  const f = budgetFields(b); if (!f.ok) return f;
  const { error } = await db().from('fin_job_budgets').upsert({ job_id: jobId, tenant_id: tenantId, ...f.fields, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: 'job_id' });
  if (error) { if (missing(error)) return fail(503, 'Job budgets need migration 0083.'); throw error; }
  return { ok: true, reference: j.job.reference };
}
export async function decide(tenantId: string, jobId: string, by: string, isAdmin: boolean, next: unknown): Promise<Result<{ reference: string; decision: Decision }>> {
  const j = await jobOf(tenantId, jobId); if (!j.ok) return j;
  const cur = await getBudget(tenantId, jobId);
  if (!cur) return fail(409, 'Save the budget first.');
  const s = decisionStep(cur.decision, next, isAdmin); if (!s.ok) return s;
  const reopen = s.decision === 'undecided';
  const { error } = await db().from('fin_job_budgets').update({ decision: s.decision, decided_by: reopen ? null : by, decided_at: reopen ? null : new Date().toISOString() }).eq('tenant_id', tenantId).eq('job_id', jobId);
  if (error) throw error;
  return { ok: true, reference: j.job.reference, decision: s.decision };
}
