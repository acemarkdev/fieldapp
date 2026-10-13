// Run: npx tsx apps/api/src/finExpenses.test.ts
import { expenseFields, expenseStep, paidByOrder, orderLabel, inExpenseWindow, expenseOrders, EXPENSE_KINDS, EXPENSE_KIND_LABEL, type ExpenseActor } from './finExpenses';
import { buildOrderViews, type OrderRow } from './finOrders';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// The form
const f = (b: any) => expenseFields(b);
ok('a normal report', JSON.stringify(f({ kind: 'allowance', amount: '180,50', note: ' 2 dni ' })) === JSON.stringify({ ok: true, fields: { kind: 'allowance', amount: 180.5, note: '2 dni' } }), f({ kind: 'allowance', amount: '180,50', note: ' 2 dni ' }));
ok('type is required and must be a known one', !f({ amount: 10 }).ok && !f({ kind: 'bribe', amount: 10 }).ok);
ok('amount must be a positive number of a sane size', !f({ kind: 'travel', amount: '' }).ok && !f({ kind: 'travel', amount: 0 }).ok && !f({ kind: 'travel', amount: -5 }).ok && !f({ kind: 'travel', amount: 'abc' }).ok && !f({ kind: 'travel', amount: 250000 }).ok);
ok('"Other" needs a note, the rest do not', !f({ kind: 'other', amount: 50 }).ok && f({ kind: 'other', amount: 50, note: 'parking' }).ok && f({ kind: 'fitting_bonus', amount: 50 }).ok);
ok('every type has a label', EXPENSE_KINDS.every((k) => !!EXPENSE_KIND_LABEL[k]));

// The workflow
const rep: ExpenseActor = { role: 'rep', userId: 'R1' }, otherRep: ExpenseActor = { role: 'rep', userId: 'R2' }, fin: ExpenseActor = { role: 'finance', userId: 'F' }, adm: ExpenseActor = { role: 'admin', userId: 'A' };
const st = (r: ReturnType<typeof expenseStep>) => (r.ok ? r.status : 'no:' + r.status);
ok('the order\'s rep approves a submitted report', st(expenseStep('submitted', 'approve', rep, 'R1')) === 'approved');
ok('another rep cannot', st(expenseStep('submitted', 'approve', otherRep, 'R1')) === 'no:403');
ok('the accountant does not approve where the order has a rep', st(expenseStep('submitted', 'approve', fin, 'R1')) === 'no:403');
ok('the accountant approves where the order has no rep; an admin always', st(expenseStep('submitted', 'approve', fin, null)) === 'approved' && st(expenseStep('submitted', 'approve', adm, 'R1')) === 'approved');
ok('a rep cannot approve an order with no rep', st(expenseStep('submitted', 'approve', rep, null)) === 'no:403');
ok('approve only from submitted', ['approved', 'rejected', 'paid'].every((s) => st(expenseStep(s as any, 'approve', adm, 'R1')) === 'no:409'));
ok('rejecting needs a reason', st(expenseStep('submitted', 'reject', rep, 'R1', ' ')) === 'no:400' && st(expenseStep('submitted', 'reject', rep, 'R1', 'za dużo')) === 'rejected');
ok('the accountant can send an approved report back, the rep cannot', st(expenseStep('approved', 'reject', fin, 'R1', 'brak podstawy')) === 'rejected' && st(expenseStep('approved', 'reject', rep, 'R1', 'x')) === 'no:403');
ok('a paid or rejected report cannot be rejected', st(expenseStep('paid', 'reject', adm, 'R1', 'x')) === 'no:409' && st(expenseStep('rejected', 'reject', adm, 'R1', 'x')) === 'no:409');
ok('only the accountant or admin marks paid, and only an approved report', st(expenseStep('approved', 'pay', fin, 'R1')) === 'paid' && st(expenseStep('approved', 'pay', adm, 'R1')) === 'paid' && st(expenseStep('approved', 'pay', rep, 'R1')) === 'no:403' && st(expenseStep('submitted', 'pay', fin, 'R1')) === 'no:409');
ok('a payment can be taken back by the accountant', st(expenseStep('paid', 'unpay', fin, 'R1')) === 'approved' && st(expenseStep('paid', 'unpay', rep, 'R1')) === 'no:403' && st(expenseStep('approved', 'unpay', fin, 'R1')) === 'no:409');

// Only paid reports reach the installation cost
const paid = paidByOrder([{ order_id: 'o1', amount: 100, status: 'paid' }, { order_id: 'o1', amount: 50.5, status: 'paid' }, { order_id: 'o1', amount: 999, status: 'approved' }, { order_id: 'o1', amount: 999, status: 'submitted' }, { order_id: 'o2', amount: 7, status: 'rejected' }]);
ok('paid reports add up per order; the rest are ignored', paid.get('o1') === 150.5 && !paid.has('o2'));
const order: OrderRow = { id: 'o1', rep_user_id: 'R1', rep_name: 'T', company: 'Acemark', supplier: null, material: null, customer: 'Krüger', order_ref: 'OK DE1', job_ref: null, status: 'accepted', offer_year: 2026, offer_month: 10, enquiry_month: 10, net: 10000, cost_purchase: 5000, cost_install: 1000, cost_delivery: 500, planned_year: null, planned_month: null, first_payment_date: null, invoice_refs: null, note: null, comment: null };
const ex = (id: string, amount: number, status: any) => ({ id, order_id: 'o1', user_id: 'u', user_name: 'Jan', kind: 'allowance' as const, amount, note: null, status, created_at: '2026-10-13T08:00:00Z', decided_by: null, decided_at: null, reject_reason: null, paid_by: null, paid_at: null });
const v = buildOrderViews([order, { ...order, id: 'o2' }], [], [], [ex('e1', 400, 'paid'), ex('e2', 300, 'approved'), ex('e3', 200, 'submitted')])[0];
ok('order: paid reports are added on top of the typed installation cost', v.cost_reports_paid === 400 && v.costs === 6900 && v.margin === 0.31, [v.cost_reports_paid, v.costs, v.margin]);
ok('order: carries its reports and what is still open', v.expenses.length === 3 && v.cost_reports_open === 500, [v.expenses.length, v.cost_reports_open]);
const v0 = buildOrderViews([order], [], [])[0];
ok('order without reports is unchanged', v0.costs === 6500 && v0.cost_reports_paid === 0 && v0.expenses.length === 0);

ok('order label: Z number, reference, customer once', orderLabel({ order_ref: 'OK DE203065 -Mülheim- Agnieszka', job_ref: 'Z.430', customer: 'Brecher' }) === 'Z.430 · OK DE203065 -Mülheim- Agnieszka · Brecher' && orderLabel({ order_ref: 'OK PL1 - PCW', customer: 'PCW' }) === 'OK PL1 - PCW');

// The fitter's order list: 3 months back to 2 months ahead, by the counts-from or planned month
const T = '2026-10-13';
ok('window: counted this month, 3 months back, and not 4', inExpenseWindow({ counted_date: '2026-10-01' }, T) && inExpenseWindow({ counted_date: '2026-07-01' }, T) && !inExpenseWindow({ counted_date: '2026-06-30' }, T));
ok('window: planned up to 2 months ahead, not 3; works across the year end', inExpenseWindow({ planned_year: 2026, planned_month: 12 }, T) && !inExpenseWindow({ planned_year: 2027, planned_month: 1 }, T) && inExpenseWindow({ planned_year: 2027, planned_month: 1 }, '2026-11-20'));
ok('window: either date is enough', inExpenseWindow({ counted_date: '2025-03-10', planned_year: 2026, planned_month: 11 }, T) && inExpenseWindow({ counted_date: '2026-09-10', planned_year: 2025, planned_month: 1 }, T) && !inExpenseWindow({ counted_date: '2025-03-10', planned_year: 2025, planned_month: 5 }, T));
ok('window: with no dates yet, a recent offer keeps the order', inExpenseWindow({ offer_year: 2026, offer_month: 9 }, T) && !inExpenseWindow({ offer_year: 2026, offer_month: 5 }, T) && !inExpenseWindow({}, T));
const lo = (id: string, status: string, counted: string | null, py: number | null = null, pm: number | null = null) => ({ id, status, order_ref: 'OK ' + id, job_ref: null, customer: null, counted_date: counted, planned_year: py, planned_month: pm, offer_year: 2025, offer_month: 1 });
ok('list: accepted and current only, newest first', expenseOrders([lo('old', 'accepted', '2025-01-05'), lo('a', 'accepted', '2026-08-05'), lo('offer', 'offer', '2026-10-01'), lo('b', 'accepted', null, 2026, 11), lo('lost', 'lost', '2026-10-01')], T).map((x) => x.id).join(',') === 'b,a');

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('finExpenses: all passed');
