// Run: npx tsx apps/api/src/scafReports.test.ts
import { pipelineReport, jobProfit, incomeReport, debtorsReport, type Enq, type Job, type Req } from './scafReports';
let fail = 0;
const ok = (n: string, c: boolean, g?: unknown) => { if (!c) { fail++; console.error('✗ ' + n, g === undefined ? '' : JSON.stringify(g)); } };
const E = (x: Partial<Enq>): Enq => ({ number: 1, received: '2026-03-10', quote_sent: null, stage: 'quote_sent', source: 'Regular Client', estimator: 'Arthur East', salesperson: null, price: null, ...x });
const p = pipelineReport([
  E({ stage: 'won', price: 5000, quote_sent: '2026-03-14' }), E({ stage: 'declined', price: 3000, quote_sent: '2026-03-12', source: 'Online' }), E({ stage: 'no_answer', price: 2000, received: '2026-04-01', quote_sent: '2026-04-11' }),
  E({ stage: 'hot', price: 1000, received: '2026-04-02', estimator: 'Matt, Arthur East' }), E({ stage: 'new', received: '2025-12-01' }),
], '2026-01-01', '2026-12-31');
ok('pipeline totals', p.total.received === 4 && p.total.quoted === 4 && p.total.value === 11000 && p.total.won === 1 && p.total.decided === 3 && p.total.conversion === 33.3 && p.total.avgQuote === 2750 && p.total.avgDaysToQuote === 5.3, p.total);
ok('status split', p.total.status.won === 1 && p.total.status.declined === 1 && p.total.status.no_answer === 1 && p.total.status.open === 1);
ok('per month and source', p.months.length === 2 && p.months[0].key === '2026-03' && p.months[0].received === 2 && p.sources.find((s) => s.key === 'Online')!.received === 1 && p.sources[0].key === 'Regular Client');
ok('per person (several names on one enquiry)', p.people.find((x) => x.key === 'Arthur East')!.received === 4 && p.people.find((x) => x.key === 'Matt')!.received === 1, p.people);
const J = (x: Partial<Job>): Job => ({ id: 'j1', number: 2555, title: 'x', customer: 'Cardo', stage: 'down', erector: 'ACE Scaff', price: 5000, actual_cost_up: 1200, actual_cost_down: 600, up_start: '2026-03-20', created_at: null, enquiry: { price: 5000, est_cost_up: 1500, est_cost_down: 800 }, ...x });
const jp = jobProfit([J({}), J({ id: 'j2', number: 2556, actual_cost_up: null, actual_cost_down: null, enquiry: null }), J({ id: 'j3', number: 1, up_start: '2025-01-01' })], new Map([['j1', 700]]), '2026-01-01', '2026-12-31');
const r1 = jp.rows.find((r) => r.id === 'j1')!;
ok('job profit: price + invoiced extra against actual costs', r1.revenue === 5700 && r1.estProfit === 2700 && r1.actualProfit === 3900 && r1.margin === 68.4 && jp.rows.length === 2, r1);
ok('jobs without actual costs stay out of the actual totals', jp.total.withActual === 1 && jp.total.actualProfit === 3900 && jp.total.revenue === 10700 && jp.rows.find((r) => r.id === 'j2')!.actualProfit === null, jp.total);
const R = (x: Partial<Req>): Req => ({ job_id: 'j1', customer: 'Cardo', kind: 'rent', status: 'invoiced', sent_on: '2026-03-01', invoiced_on: '2026-03-02', paid_on: null, payment_days: 30, due: 100, ...x });
const inc = incomeReport([R({}), R({ kind: 'price', due: 2500, invoiced_on: '2026-04-05' }), R({ status: 'draft', due: 999 }), R({ status: 'paid', kind: 'other', due: 50 }), R({ status: 'sent', invoiced_on: null, sent_on: '2026-04-20', due: 30 })], '2026-01-01', '2026-12-31');
ok('income per month and kind (not drafts)', inc.total.total === 2680 && inc.months[0].rent === 100 && inc.months[0].other === 50 && inc.months[1].price === 2500 && inc.months[1].rent === 30, inc);
const deb = debtorsReport([R({ invoiced_on: '2026-10-01', due: 100 }), R({ invoiced_on: '2026-08-01', due: 200 }), R({ invoiced_on: '2026-05-01', due: 300, customer: 'SBC' }), R({ status: 'paid', due: 999 })], '2026-10-22');
ok('debtors aged by days past due', deb.total.total === 600 && deb.total.notDue === 100 && deb.total.d60 === 200 && deb.total.d30 === 0 && deb.total.over90 === 300 && deb.rows[0].customer === 'Cardo' && deb.rows.find((r) => r.customer === 'SBC')!.oldest === 144, deb);
if (fail) { console.error(fail + ' report check(s) failed'); process.exit(1); }
console.log('scafReports: all checks passed');
