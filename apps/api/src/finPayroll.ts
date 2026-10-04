// Fin&Ops ▸ Payroll: salaries + payroll tax per department per month, typed in by finance.
// Real figures arrive a month late, so a month is one of:
//   actual   — figures entered and the "Actuals" box ticked
//   manual   — a figure typed without the tick (the user's own estimate)
//   forecast — nothing typed: the average of the last 3 ACTUAL months before it
// Estimates are shown from the month after the first actual up to the current month; ticking a
// month's actuals moves the forecast on to the next one.
import { db } from './supabase';
import { parseMoney } from './finJobs';

export const PAYROLL_DEPTS = ['Office', 'Sales', 'Production'] as const;
export type PayrollDept = (typeof PAYROLL_DEPTS)[number];
export type PayrollStatus = 'actual' | 'manual' | 'forecast';
export interface PayrollRow { period_year: number; period_month: number; department: string; salaries: number | null; taxes: number | null; actual: boolean }
export interface PayrollCell { salaries: number | null; taxes: number | null; salariesStatus: PayrollStatus | null; taxesStatus: PayrollStatus | null }
export interface PayrollMonth { year: number; month: number; actual: boolean; depts: Record<PayrollDept, PayrollCell> }

const round2 = (n: number) => Math.round(n * 100) / 100;
const ym = (y: number, m: number) => y * 12 + (m - 1);

/** Every month from the first one with data to `now` (and any later month that has data), with the
 *  figure to show for each department and where it comes from. */
export function payrollView(rows: PayrollRow[], now: { year: number; month: number }): PayrollMonth[] {
  const by = new Map<string, PayrollRow>();
  for (const r of rows) by.set(`${ym(r.period_year, r.period_month)}|${r.department}`, r);
  if (!rows.length) return [];
  const first = Math.min(...rows.map((r) => ym(r.period_year, r.period_month)));
  const last = Math.max(ym(now.year, now.month), ...rows.map((r) => ym(r.period_year, r.period_month)));
  const out: PayrollMonth[] = [];
  for (let i = first; i <= last; i++) {
    const year = Math.floor(i / 12), month = (i % 12) + 1;
    const depts = {} as Record<PayrollDept, PayrollCell>;
    let anyActual = false;
    for (const d of PAYROLL_DEPTS) {
      const r = by.get(`${i}|${d}`);
      if (r?.actual) anyActual = true;
      const field = (k: 'salaries' | 'taxes'): [number | null, PayrollStatus | null] => {
        const v = r ? r[k] : null;
        if (r?.actual) return [v ?? 0, 'actual'];
        if (v !== null && v !== undefined) return [v, 'manual'];
        if (i > ym(now.year, now.month)) return [null, null];          // no forecasts into the future
        // average of the 3 most recent actual months before this one
        const prev: number[] = [];
        for (let j = i - 1; j >= first && prev.length < 3; j--) { const p = by.get(`${j}|${d}`); if (p?.actual) prev.push(Number(p[k]) || 0); }
        return prev.length ? [round2(prev.reduce((s, x) => s + x, 0) / prev.length), 'forecast'] : [null, null];
      };
      const [s, ss] = field('salaries'), [t, ts] = field('taxes');
      depts[d] = { salaries: s, taxes: t, salariesStatus: ss, taxesStatus: ts };
    }
    out.push({ year, month, actual: anyActual, depts });
  }
  return out;
}

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Result<any> => ({ ok: false, status, error });

/** One month's entry → the three rows to store. Ticking Actuals needs all six figures. */
export function payrollFields(b: any): Result<{ year: number; month: number; actual: boolean; rows: { department: PayrollDept; salaries: number | null; taxes: number | null }[] }> {
  const year = Number(b.year), month = Number(b.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return fail(400, 'Month or year looks wrong.');
  const actual = b.actual === true;
  const rows = PAYROLL_DEPTS.map((d) => ({ department: d, salaries: parseMoney(b.departments?.[d]?.salaries), taxes: parseMoney(b.departments?.[d]?.taxes) }));
  if (rows.some((r) => (r.salaries ?? 0) < 0 || (r.taxes ?? 0) < 0)) return fail(400, 'Amounts cannot be negative.');
  if (actual && rows.some((r) => r.salaries === null || r.taxes === null)) return fail(400, 'To tick Actuals, enter salaries and taxes for all three departments (0 is fine).');
  return { ok: true, year, month, actual, rows };
}

export async function listPayroll(tenantId: string): Promise<PayrollRow[]> {
  const { data, error } = await db().from('fin_payroll').select('period_year,period_month,department,salaries,taxes,actual').eq('tenant_id', tenantId).order('period_year').order('period_month');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, salaries: r.salaries === null ? null : Number(r.salaries), taxes: r.taxes === null ? null : Number(r.taxes) }));
}
export async function savePayrollMonth(tenantId: string, by: string, b: any): Promise<Result<{ year: number; month: number; actual: boolean }>> {
  const f = payrollFields(b); if (!f.ok) return f;
  const now = new Date().toISOString();
  const { error } = await db().from('fin_payroll').upsert(
    f.rows.map((r) => ({ tenant_id: tenantId, period_year: f.year, period_month: f.month, department: r.department, salaries: r.salaries, taxes: r.taxes, actual: f.actual, updated_by: by, updated_at: now })),
    { onConflict: 'tenant_id,period_year,period_month,department' });
  if (error) throw error;
  return { ok: true, year: f.year, month: f.month, actual: f.actual };
}
