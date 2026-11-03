// Run: npx tsx apps/api/src/perfStatutory.test.ts
import { writedownField, writedownByMonth, DEFAULT_WRITEDOWN, productionMonth, type PmSale } from './perfStatutory';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('default write-down: 1–2 y 50 %, over 2 y 100 %', JSON.stringify(DEFAULT_WRITEDOWN) === '[0,0,0,0.5,1]');
ok('typed % → shares', JSON.stringify(writedownField('0, 0, 10, 50, 100')) === '[0,0,0.1,0.5,1]' && JSON.stringify(writedownField([0, 0, 0, 0.5, 1])) === '[0,0,0,0.5,1]');
ok('wrong count or out of range → refused', writedownField('0,0,50,100') === null && writedownField('0,0,0,50,120') === null && writedownField('a,b,c,d,e') === null);

const E = (b3: number, b4: number) => ({ b: [1000, 1000, 1000, b3, b4] });
const w = writedownByMonth([E(2000, 1000), E(2000, 1500), null, E(1000, 1500)], E(1000, 1000), DEFAULT_WRITEDOWN);
// provisions: Dec 1500 → Jan 2000 → Feb 2500 → Mar no data → Apr 2000
ok('provision at each month end; none without history', JSON.stringify(w.provision) === '[2000,2500,null,2000]', w.provision);
ok('the month\'s cost is the change; a month without history costs 0 and the next compares with the last known', JSON.stringify(w.change) === '[500,500,0,-500]', w.change);
ok('no history before the first month → nothing booked in it', writedownByMonth([E(2000, 1000)], null, DEFAULT_WRITEDOWN).change[0] === 0);

// ---- production-month view ----
const S = (key: string, net: number, kind: string, ym: number, channel = 'production'): PmSale => ({ id: key + ym + net, key, net, kind, ym, channel });
const J = (key: string, ...costs: [number, number][]) => ({ key, reference: key, costs: costs.map(([ym, amount]) => ({ ym, amount })) });
const m = (a: number[], mo: number) => a[mo - 1];
{ // Z 437: 40k costs in March, 30k prepayment in March, 70k final in May → all 100k in March
  const p = productionMonth(2026, [S('Z 437', 30000, 'prepaid', 202603), S('Z.437', 70000, 'final', 202605)], [J('Z437', [202603, 40000])], []);
  ok('finally invoiced job: the whole sale in its cost month', m(p.sales, 3) === 100000 && m(p.sales, 5) === 0, p.sales);
  ok('… and it is not an estimate', !p.est.some(Boolean) && m(p.estimate, 3) === 0);
}
{ // costs in two months → the sale split by cost
  const p = productionMonth(2026, [S('Z1', 100000, 'final', 202605)], [J('Z1', [202603, 30000], [202604, 10000])], []);
  ok('costs in several months: the sale split by cost', m(p.sales, 3) === 75000 && m(p.sales, 4) === 25000 && m(p.sales, 5) === 0, p.sales);
}
{ // not finally invoiced: the order value, as an estimate
  const p = productionMonth(2026, [S('Z2', 30000, 'prepaid', 202603)], [J('Z2', [202603, 40000])], [{ keys: ['Z2'], net: 100000 }]);
  ok('open job: the order value in its cost month', m(p.sales, 3) === 100000, p.sales);
  ok('… the part not invoiced yet is an estimate', p.est[2] === true && m(p.estimate, 3) === 70000, p.estimate);
}
{ // open job with no order: what is invoiced so far; no invoice and no order → on the list to fix
  const p = productionMonth(2026, [S('Z3', 30000, 'prepaid', 202603)], [J('Z3', [202603, 40000]), J('Z4', [202604, 5000])], []);
  ok('open job without an order: invoiced so far', m(p.sales, 3) === 30000 && !p.est[2], p.sales);
  ok('job with costs but no invoice and no order is listed', p.unmatched.length === 1 && p.unmatched[0].reference === 'Z4' && p.unmatched[0].cost === 5000, p.unmatched);
}
{ // job with no costs: prepayment waits for the final invoice; final stays in its month
  const p = productionMonth(2026, [S('Z5', 20000, 'prepaid', 202602), S('Z5', 50000, 'final', 202606), S('Z6', 10000, 'prepaid', 202607)], [], []);
  ok('no costs: prepayment moves to the first final invoice', m(p.sales, 2) === 0 && m(p.sales, 6) === 70000, p.sales);
  ok('no costs, no final: prepayment is a memo, not a sale', m(p.sales, 7) === 0 && m(p.waiting, 7) === 10000, p.waiting);
}
{ // invoices with no job and Trade from Poland
  const p = productionMonth(2026, [S('', 5000, 'final', 202601), S('Z7', 9000, 'final', 202601, 'trade')], [J('Z7', [202601, 3000])], []);
  ok('an invoice with no job stays in its month', m(p.sales, 1) === 5000, p.sales);
  ok('trade invoices are not in Sales from Orpiszew here', p.sales.reduce((a, b) => a + b, 0) === 5000);
}
{ // year end: costs in December 2025, final in January 2026 → in 2025, not 2026
  const sales = [S('Z8', 80000, 'final', 202601)], jobs = [J('Z8', [202512, 20000])];
  ok('a job produced in December counts in that year', productionMonth(2025, sales, jobs, []).sales[11] === 80000 && productionMonth(2026, sales, jobs, []).sales[0] === 0);
}

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('perfStatutory ok');
