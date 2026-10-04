// Fin&Ops payroll rules. Run: npx tsx apps/api/src/finPayroll.test.ts
import { payrollView, payrollFields, type PayrollRow } from './finPayroll';

let fail = 0;
const ok = (label: string, cond: boolean, extra: any = '') => { if (!cond) { fail++; console.error('✗ ' + label, JSON.stringify(extra)); } else console.log('✓ ' + label); };
const row = (y: number, m: number, d: string, s: number | null, t: number | null, actual = true): PayrollRow => ({ period_year: y, period_month: m, department: d, salaries: s, taxes: t, actual });
const month = (rows: PayrollRow[], y: number, m: number, s: [number, number, number], t: [number, number, number], actual = true) => { ['Office', 'Sales', 'Production'].forEach((d, i) => rows.push(row(y, m, d, s[i], t[i], actual))); };
const at = (v: any[], y: number, m: number) => v.find((x) => x.year === y && x.month === m);

// Actuals for May–Aug 2026; today is October → September and October are estimates.
const R: PayrollRow[] = [];
month(R, 2026, 5, [16000, 26000, 43000], [8000, 9600, 26000]);
month(R, 2026, 6, [16100, 30000, 37000], [8100, 9700, 26300]);
month(R, 2026, 7, [16200, 36000, 31000], [8200, 9800, 26600]);
month(R, 2026, 8, [16300, 33000, 34000], [8300, 9900, 26900]);
const NOW = { year: 2026, month: 10 };
let v = payrollView(R, NOW);
ok('view covers first data month … current month', v.length === 6 && v[0].month === 5 && v[5].month === 10);
ok('actual months show what was entered', at(v, 2026, 8).actual === true && at(v, 2026, 8).depts.Office.salaries === 16300 && at(v, 2026, 8).depts.Office.salariesStatus === 'actual');
ok('September = average of Jun, Jul, Aug (per department)', at(v, 2026, 9).depts.Office.salaries === 16200 && at(v, 2026, 9).depts.Sales.salaries === 33000 && at(v, 2026, 9).depts.Production.salaries === 34000 && at(v, 2026, 9).depts.Office.salariesStatus === 'forecast', at(v, 2026, 9).depts);
ok('taxes are estimated the same way', at(v, 2026, 9).depts.Production.taxes === 26600 && at(v, 2026, 9).depts.Production.taxesStatus === 'forecast');
ok('October (also no actuals yet) uses the same last 3 actual months', at(v, 2026, 10).depts.Office.salaries === 16200 && at(v, 2026, 10).actual === false);

// The user enters September actuals and ticks the box → the forecast moves on.
month(R, 2026, 9, [17000, 34000, 35000], [8400, 10000, 27000]);
v = payrollView(R, NOW);
ok('September is now actual', at(v, 2026, 9).actual === true && at(v, 2026, 9).depts.Office.salaries === 17000 && at(v, 2026, 9).depts.Office.salariesStatus === 'actual');
ok('October forecast moved on: average of Jul, Aug, Sep', at(v, 2026, 10).depts.Office.salaries === 16500 && at(v, 2026, 10).depts.Sales.salaries === 34333.33 && at(v, 2026, 10).depts.Office.salariesStatus === 'forecast', at(v, 2026, 10).depts);
ok('no forecast into the future', payrollView(R, { year: 2026, month: 10 }).every((x) => x.month <= 10));

// A figure typed without the tick = the user's own estimate, and it is not used in averages.
const M = R.filter((r) => !(r.period_month === 9));
M.push(row(2026, 9, 'Office', 20000, null, false), row(2026, 9, 'Sales', null, null, false), row(2026, 9, 'Production', null, null, false));
v = payrollView(M, NOW);
ok('typed, not ticked → manual estimate for that field only', at(v, 2026, 9).depts.Office.salaries === 20000 && at(v, 2026, 9).depts.Office.salariesStatus === 'manual' && at(v, 2026, 9).depts.Office.taxes === 8200 && at(v, 2026, 9).depts.Office.taxesStatus === 'forecast' && at(v, 2026, 9).actual === false);
ok('other departments still forecast', at(v, 2026, 9).depts.Sales.salariesStatus === 'forecast');
ok('a manual estimate does not feed the next forecast', at(v, 2026, 10).depts.Office.salaries === 16200);

// Edges
ok('fewer than 3 actual months → average of what there is', payrollView([row(2026, 8, 'Office', 100, 10), row(2026, 7, 'Office', 200, 30)], { year: 2026, month: 9 }).at(-1)!.depts.Office.salaries === 150);
ok('no actuals before a month → no estimate', payrollView([row(2026, 8, 'Office', null, null, false)], { year: 2026, month: 8 })[0].depts.Office.salaries === null);
ok('year boundary: January uses Oct–Dec of the year before', (() => { const X: PayrollRow[] = []; month(X, 2025, 10, [10, 0, 0], [1, 0, 0]); month(X, 2025, 11, [20, 0, 0], [2, 0, 0]); month(X, 2025, 12, [30, 0, 0], [3, 0, 0]); const j = at(payrollView(X, { year: 2026, month: 1 }), 2026, 1); return j.depts.Office.salaries === 20 && j.depts.Office.taxes === 2; })());
ok('a gap in actuals: takes the 3 most recent actual months, skipping unticked ones', (() => { const X: PayrollRow[] = [row(2026, 1, 'Office', 100, 0), row(2026, 2, 'Office', 200, 0), row(2026, 3, 'Office', null, null, false), row(2026, 4, 'Office', 600, 0)]; return at(payrollView(X, { year: 2026, month: 5 }), 2026, 5).depts.Office.salaries === 300; })());
ok('actual 0 counts as a real 0', payrollView([row(2026, 8, 'Sales', 0, 0)], { year: 2026, month: 9 }).at(-1)!.depts.Sales.salaries === 0);
ok('empty → nothing', payrollView([], NOW).length === 0);

// Entry validation
const D = (o: any) => ({ Office: o, Sales: o, Production: o });
ok('entry ok', payrollFields({ year: 2026, month: 9, actual: true, departments: D({ salaries: '17 000,50', taxes: 8400 }) }).ok === true);
ok('amounts parsed', (payrollFields({ year: 2026, month: 9, actual: false, departments: D({ salaries: '17 000,50', taxes: '' }) }) as any).rows[0].salaries === 17000.5 && (payrollFields({ year: 2026, month: 9, actual: false, departments: D({ salaries: '1', taxes: '' }) }) as any).rows[0].taxes === null);
ok('ticking Actuals with a figure missing is refused', payrollFields({ year: 2026, month: 9, actual: true, departments: { Office: { salaries: 1, taxes: 1 }, Sales: { salaries: 1, taxes: 1 }, Production: { salaries: 1 } } }).ok === false);
ok('Actuals with zeros is fine', payrollFields({ year: 2026, month: 9, actual: true, departments: D({ salaries: 0, taxes: 0 }) }).ok === true);
ok('bad month refused', payrollFields({ year: 2026, month: 13, departments: {} }).ok === false);
ok('negative refused', payrollFields({ year: 2026, month: 9, departments: D({ salaries: -5, taxes: 0 }) }).ok === false);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll payroll rule tests passed.');
