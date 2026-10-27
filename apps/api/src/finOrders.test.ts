// Run: npx tsx apps/api/src/finOrders.test.ts
import { buildCatalogue, orderCode, orderKeys, monthlyCommission, annualBonus, buildOrderViews, commissionYear, orderFields, importRowToOrder, importKey, monthFromText, parseDay, materialText, type OrderRow, type SaleLite, type PaymentRow } from './finOrders';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// Order reference → code
ok('OK order with a descriptive tail', orderCode('OK DE203065 -Mülheim an der Ruhr- Agnieszka und Tiago') === 'OK DE203065');
ok('OK order written with dashes / underscores', orderCode('Ok-DEUK20250819- 66Nordfield Avenue') === 'OK DEUK20250819' && orderCode('OK_1240 V1 R1 - ref. J034056P3 - PCW') === 'OK 1240' && orderCode('OK  DEES202741-SSE-Los Lagos') === 'OK DEES202741');
ok('OK order with a split country code and a suffix', orderCode('OK DEPL 20250721 UNIMA BASF DRZWI') === 'OK DEPL20250721' && orderCode('OK DE08012026-2-MJ-Ebay') === 'OK DE08012026-2');
ok('production job', orderCode('Z.330') === 'Z.330' && orderCode('z 330') === 'Z.330' && orderCode('Z330 Padnell') === 'Z.330');
ok('other references keep the part before the dash', orderCode('J034283P - Timber') === 'J034283P' && orderCode('Price Request 22883 - 60 Great Tower Street') === 'Price Request 22883' && orderCode('') === '');
ok('keys: the code, the full text, and the Z number once set', (() => { const k = orderKeys({ order_ref: 'OK DE203065 -Mülheim- A', job_ref: 'Z.330' }); return k.includes('OKDE203065') && k.includes('Z330') && k.includes('OKDE203065MLHEIMA'); })(), orderKeys({ order_ref: 'OK DE203065 -Mülheim- A', job_ref: 'Z.330' }));
ok('a vague reference never becomes a matching key', orderKeys({ order_ref: 'Drzwi' }).length === 0 && orderKeys({ order_ref: 'EQ - okna' }).length === 0);

// Commission bands (sheet "Zasady Prowizji")
const r = (v: number) => monthlyCommission(v);
ok('below 300 000 → 0%', r(299999.99).rate === 0 && r(299999.99).commission === 0 && r(0).band === -1);
ok('300 000 exactly → 1% of the whole month (3 000)', r(300000).rate === 0.01 && r(300000).commission === 3000);
ok('450 000 is still 1%; 450 000.01 is 1.5%', r(450000).rate === 0.01 && r(450000.01).rate === 0.015);
ok('600 000 is 1.5% (9 000); above it 2%', r(600000).rate === 0.015 && r(600000).commission === 9000 && r(600000.01).rate === 0.02 && r(1000000).commission === 20000);
ok('the accountant\'s own months agree', r(728429.95).commission === 14568.6 && r(523851.92).commission === 7857.78 && r(428966.53).commission === 4289.67 && r(256692.8).commission === 0);
ok('missing to each threshold', (() => { const m = r(256692.8).steps; return m[0].missing === 43307.2 && m[1].missing === 193307.21 && m[2].missing === 343307.21 && !m[0].reached; })(), r(256692.8).steps);
ok('reached thresholds show nothing missing', (() => { const m = r(500000).steps; return m[0].reached && m[1].reached && m[0].missing === 0 && m[2].missing === 100000.01; })());
const a = (v: number) => annualBonus(v);
ok('yearly bonus tiers', a(3599999).max === 0 && a(3600000).max === 0.05 && a(5000000).max === 0.05 && a(5000000.01).max === 0.10 && a(10000000).max === 0.10 && a(10000001).max === 0.15);
ok('missing to the yearly tiers', a(4300000).steps[0].reached && a(4300000).steps[1].missing === 700000.01 && a(4300000).steps[2].missing === 5700000.01);

// Orders, invoices, cash, and when an order starts to count
const O = (over: Partial<OrderRow>): OrderRow => ({ id: 'o', rep_user_id: 'u1', rep_name: 'Tomasz', company: 'Acemark', supplier: null, material: null, customer: 'PCW', order_ref: 'OK DE203065 -Mülheim', job_ref: null,
  status: 'accepted', offer_year: 2026, offer_month: 9, enquiry_month: 9, net: 100000, cost_purchase: 40000, cost_install: null, cost_delivery: 10000, planned_year: null, planned_month: null, first_payment_date: null, invoice_refs: null, note: null, comment: null, ...over });
const S = (id: string, job: string | null, date: string | null, net: number, no: string | null = null): SaleLite => ({ id, invoice_no: no, invoice_date: date, job_key: job, net, kind: 'final', period_year: 2026, period_month: 10 });
const P = (id: string, order: string, date: string, amount: number): PaymentRow => ({ id, order_id: order, paid_date: date, amount, note: null });
{
  const v = buildOrderViews([O({})], [S('s1', 'OKDE203065', '2026-10-05', 30000), S('s2', 'OKDE999', '2026-09-01', 5), S('s3', 'OK DE203065', '2026-11-20', 70000)], [])[0];
  ok('invoices attach by the order code, however the accountant spaced it', v.invoices.map((x) => x.id).join(',') === 's1,s3' && v.invoiced === 100000 && v.paid === 100000);
  ok('it counts from the first invoice', v.counted_date === '2026-10-05' && v.counted_from === 'invoice');
  ok('costs and margin', v.costs === 50000 && v.margin === 0.5 && v.code === 'OK DE203065');
}
{
  const v = buildOrderViews([O({ job_ref: 'Z.330' })], [S('s1', 'Z.330', '2026-12-01', 60000), S('s2', 'OKDE203065', '2026-10-05', 30000)], [P('p1', 'o', '2026-09-28', 10000)])[0];
  ok('after the Z number is set, invoices under either reference still belong to it', v.invoices.length === 2 && v.code === 'Z.330');
  ok('a cash payment earlier than the invoices sets the month', v.counted_date === '2026-09-28' && v.counted_from === 'cash' && v.cash === 10000 && v.paid === 100000);
}
ok('a manual "counts from" date wins', buildOrderViews([O({ first_payment_date: '2026-08-15' })], [S('s1', 'OKDE203065', '2026-10-05', 1)], [])[0].counted_date === '2026-08-15');
ok('nothing paid → not counted yet', buildOrderViews([O({})], [], [])[0].counted_date === null);
ok('an invoice number noted on the order attaches that invoice', buildOrderViews([O({ order_ref: 'Drzwi wejściowe', invoice_refs: 'FP 3/ACE/09/2025; FL 198' })], [S('s1', 'ZZZ', '2026-09-30', 12699, 'FP 3/ACE/09/2025'), S('s2', null, '2026-10-02', 1, 'fl198')], [])[0].invoices.length === 2);
ok('another order\'s cash payment is not mixed in', buildOrderViews([O({ id: 'a' }), O({ id: 'b', order_ref: 'OK DE203066' })], [], [P('p', 'b', '2026-09-01', 5)]).map((v) => v.cash).join(',') === '0,5');

// The year: full value in the month of the first payment; the month total picks the rate
{
  const views = buildOrderViews([
    O({ id: '1', net: 200000, first_payment_date: '2026-09-03' }), O({ id: '2', net: 150000, order_ref: 'OK DE2', first_payment_date: '2026-09-28' }),
    O({ id: '3', net: 500000, order_ref: 'OK DE3', first_payment_date: '2026-10-01' }),
    O({ id: '4', net: 90000, order_ref: 'OK DE4' }),                                         // accepted, nothing paid
    O({ id: '5', net: 70000, order_ref: 'OK DE5', status: 'offer', first_payment_date: '2026-09-09' }), // an offer never counts
    O({ id: '6', net: 60000, order_ref: 'OK DE6', status: 'lost' }),
    O({ id: '7', net: 400000, order_ref: 'OK DE7', first_payment_date: '2025-12-30' }),      // last year
  ], [], []);
  const y = commissionYear(views, 2026);
  ok('September = 350 000 → 1% → 3 500', y.months[8].sales === 350000 && y.months[8].rate === 0.01 && y.months[8].commission === 3500 && y.months[8].orders.length === 2);
  ok('October = 500 000 → 1.5% → 7 500', y.months[9].commission === 7500);
  ok('year totals', y.total.sales === 850000 && y.total.commission === 11000);
  ok('accepted but unpaid waits; offers are listed apart; lost and other years are out', y.waiting.count === 1 && y.waiting.net === 90000 && y.open.count === 1 && y.open.net === 70000 && commissionYear(views, 2025).months[11].sales === 400000);
}

// Form input
ok('order needs a number or name', orderFields({ net: 1 }, false).ok === false);
ok('negative amounts refused', orderFields({ order_ref: 'x', net: -1 }, false).ok === false && orderFields({ order_ref: 'x', net: 1, cost_install: -5 }, false).ok === false);
ok('a rep cannot set the Z number or the "counts from" date', (() => { const f: any = orderFields({ order_ref: 'OK DE1', net: '1 000,50', job_ref: 'Z.1', first_payment_date: '2026-01-01', status: 'accepted' }, false); return f.ok && f.fields.net === 1000.5 && !('job_ref' in f.fields) && !('first_payment_date' in f.fields) && f.fields.status === 'accepted'; })());
ok('finance can', (() => { const f: any = orderFields({ order_ref: 'OK DE1', net: 5, job_ref: ' z.330 ', first_payment_date: '15.09.2026' }, true); return f.ok && f.fields.job_ref === 'z.330' && f.fields.first_payment_date === '2026-09-15'; })());
ok('a bad "counts from" date is refused, not silently dropped', orderFields({ order_ref: 'x', net: 1, first_payment_date: 'soon' }, true).ok === false);
ok('months', monthFromText('Pażdziernik') === 10 && monthFromText('październik') === 10 && monthFromText('Wrzesień/Październik') === 9 && monthFromText('lipiec') === 7 && monthFromText('3') === 3 && monthFromText('oszust') === null && monthFromText('2026-11-05') === 11);

// Import of the workbook sheet (columns A–W)
const row = (o: Record<number, string>) => { const c: string[] = Array(23).fill(''); for (const k of Object.keys(o)) c[+k] = o[+k]; return c; };
{
  const x: any = importRowToOrder(row({ 0: '615', 1: 'Acemark', 2: 'ACEMARK', 3: 'Alu', 4: 'PCW', 5: 'Październik', 6: 'Październik', 7: 'OK PL203158 - PCW - J035023P', 9: 'Zaakceptowane', 10: ' 1,136.00 zł ', 17: ' tak ', 18: 'Pażdziernik', 21: 'Listopad', 22: '2026' }), 2025);
  ok('accepted and paid row', x && x.fields.status === 'accepted' && x.fields.net === 1136 && x.fields.offer_year === 2026 && x.fields.offer_month === 10 && x.fields.first_payment_date === '2026-10-01' && x.fields.planned_month === 11 && x.fields.planned_year === 2026 && x.fields.company === 'Acemark', x?.fields);
  const y: any = importRowToOrder(row({ 0: '3', 1: 'Acemark', 4: 'Bautec', 5: 'Lipiec', 6: 'Lipiec', 7: 'OK DE202501-2', 9: 'Zaakceptowane', 10: '226,800.00 zł', 17: 'Tak', 18: 'Listopad', 19: 'Wpłata 26.11.2025' }), 2025);
  ok('no year in the row → the fallback year; paid month later in the same year', y.fields.offer_year === 2025 && y.fields.first_payment_date === '2025-11-01' && y.fields.comment === 'Wpłata 26.11.2025');
  const z: any = importRowToOrder(row({ 0: '9', 4: 'X', 6: 'Grudzień', 7: 'OK DE1', 9: 'Zaakceptowane', 10: '5', 17: 'tak', 18: 'Styczeń' }), 2025);
  ok('paid in a month before the offer month → the next year', z.fields.first_payment_date === '2026-01-01');
  const w: any = importRowToOrder(row({ 0: '1', 1: 'Acemark', 4: 'Alt GmbH', 5: 'Maj', 6: 'Maj', 7: 'OK DE202502', 9: 'Do akceptacji', 10: '74,829.19 zł', 17: ' nie ' }), 2025);
  ok('open offer, not paid', w.fields.status === 'offer' && w.fields.first_payment_date === null);
  ok('paid "tak" with no month → the offer month', (importRowToOrder(row({ 0: '2', 4: 'U', 6: 'Czerwiec', 7: 'OK DE9', 9: 'Zaakceptowane', 10: '1', 17: 'tak' }), 2025) as any).fields.first_payment_date === '2025-06-01');
  ok('spacer rows and the header are skipped', importRowToOrder(row({ 0: '616', 10: ' -   zł ', 22: '2026' }), 2025) === null && importRowToOrder(row({ 0: 'Lp', 7: 'Numer Oferty' }), 2025) === null);
  ok('an invoice number in the FV column is kept for matching', (importRowToOrder(row({ 0: '5', 4: 'Herne', 7: 'OK-DE20250903- Bielefeldstr', 8: 'FP 3/ACE/09/2025', 10: '20,867.50' }), 2025) as any).fields.invoice_refs === 'FP 3/ACE/09/2025');
  ok('same reference + value + customer = the same order on re-import', importKey(x.fields) === importKey({ ...x.fields, comment: 'changed' }) && importKey(x.fields) !== importKey({ ...x.fields, net: 1137 }));
}

// One catalogue shared by Sales orders, the Sales tab and Job costs
{
  const c = buildCatalogue([
    { order_ref: 'OK DE203065 -Mülheim an der Ruhr- Agnieszka und Tiago', job_ref: null, customer: 'Agnieszka & Tiago', invoice_refs: null },
    { order_ref: 'OK DE203102 -Brecher Immobilien- Baumblute', job_ref: 'Z.431', customer: 'Brecher', invoice_refs: 'FP 3/ACE/09/2025; FL 198' },
    { order_ref: 'Drzwi', job_ref: null, customer: 'X', invoice_refs: null },
  ], ['Z.431', 'Z.164', ' Z.9 ', 'Z.164']);
  ok('suggestions: order codes and Z numbers, each with the customer, vague names left out', c.codes.map((x) => x.value).join('|') === 'OK DE203065|OK DE203102|Z.431' && c.codes[0].label.startsWith('Agnieszka & Tiago · OK DE203065'), c.codes);
  ok('an invoice typed any which way finds its order', ['OKDE203065', 'Z431', 'OKDE203102'].every((k) => c.keys.includes(k)) && !c.keys.includes('DRZWI'));
  ok('invoice numbers noted on orders are known', c.invoiceKeys.includes('FP3ACE092025') && c.invoiceKeys.includes('FL198'));
  ok('Job costs references, de-duplicated and in natural order', c.jobs.join('|') === 'Z.9|Z.164|Z.431');
}

// The order form, step A: dates as dd-mm-yy, several materials, requested and confirmed realisation
ok('day: dd-mm-yy and the other forms', parseDay('05-11-26') === '2026-11-05' && parseDay('5.11.2026') === '2026-11-05' && parseDay('2026-11-05') === '2026-11-05' && parseDay('31-13-26') === null && parseDay('') === null);
ok('materials: ticked list in a fixed order; old text kept', materialText(['Timber', 'PVC']) === 'PVC, Timber' && materialText('Wood') === 'Timber' && materialText('alu + pvc') === 'PVC, Alu' && materialText([]) === null && materialText('Drzwi') === 'Drzwi');
{
  const base = { order_ref: 'OK DE203066 - X', status: 'offer', net: 100 };
  const a = orderFields({ ...base, enquiry_date: '03-10-26', requested_date: '2027-02', requested_month_only: true, confirmed_date: '15-03-27' }, false);
  ok('requested month → its 1st, planning month follows; confirmed ignored while an offer', a.ok && a.fields.enquiry_date === '2026-10-03' && a.fields.enquiry_month === 10 && a.fields.requested_date === '2027-02-01' && a.fields.requested_month_only === true && a.fields.confirmed_date === null && a.fields.planned_year === 2027 && a.fields.planned_month === 2, a);
  const b = orderFields({ ...base, status: 'accepted', requested_date: '10-02-27', confirmed_date: '15-03-27' }, false);
  ok('accepted: the confirmed date wins for planning', b.ok && b.fields.requested_month_only === false && b.fields.confirmed_date === '2027-03-15' && b.fields.planned_month === 3, b);
  ok('a bad date is refused', !orderFields({ ...base, enquiry_date: '99-99-99' }, false).ok && !orderFields({ ...base, requested_date: 'soon' }, false).ok);
  const c = orderFields({ ...base, planned_year: 2026, planned_month: 12 }, false);
  ok('the imports (no new fields sent) keep the planned month and touch nothing new', c.ok && c.fields.planned_month === 12 && !('requested_date' in c.fields) && !('customer_id' in c.fields) && !('delivery_address' in c.fields), c);
  const d = orderFields({ ...base, customer_id: 'nonsense', delivery: { same: false, street: 'A 1', city: 'B' } }, false);
  ok('customer id checked; own delivery address kept', d.ok && d.fields.customer_id === null && d.fields.delivery_address?.city === 'B', d);
}

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('All sales-order tests passed.');
