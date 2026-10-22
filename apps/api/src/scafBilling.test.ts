// Run: npx tsx apps/api/src/scafBilling.test.ts
import { rentLine, rentFrom, hireStop, weeklyRate, requestTotals, includedEndsSoon, daysBetween, lineFields, type HireScaffold } from './scafBilling';
import { renderInvoiceRequestPdf } from './scafInvoicePdf';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const S = (x: Partial<HireScaffold>): HireScaffold => ({ id: 's1', element: 'Independent scaffold', price: 3000, hire_weeks: 8, rent_pct: 4, rent_weekly: null, handed_over_on: '2026-09-01', hire_stop_on: null, down_on: null, billed_to: null, status: 'on_hire', ...x });

ok('rent starts after the included weeks', rentFrom(S({})) === '2026-10-27' && rentFrom(S({ hire_weeks: null })) === '2026-09-01' && rentFrom(S({ handed_over_on: null })) === null);
ok('weekly rate: % of the price or fixed', weeklyRate(S({})) === 120 && weeklyRate(S({ rent_weekly: 25 })) === 25 && weeklyRate(S({ rent_pct: null })) === null);
// rent from 27 Oct; billed up to 31 Oct = 5 days = 5/7 of £120
let l = rentLine(S({}), '2026-10-31')!;
ok('pro rata days (both ends counted)', l.period_from === '2026-10-27' && l.period_to === '2026-10-31' && l.days === 5 && l.amount === 85.71, l);
ok('nothing due inside the included weeks', rentLine(S({}), '2026-10-26') === null);
l = rentLine(S({ billed_to: '2026-10-31' }), '2026-11-30')!;
ok('a month after the billed day', l.period_from === '2026-11-01' && l.period_to === '2026-11-30' && l.days === 30 && l.amount === 514.29, l);
l = rentLine(S({ billed_to: '2026-10-31', down_on: '2026-11-15', hire_stop_on: '2026-11-10' }), '2026-11-30')!;
ok('hire stops on the confirmed dismantle day (not the down date)', l.period_to === '2026-11-10' && l.days === 10 && hireStop(S({ down_on: '2026-11-15' })) === '2026-11-15', l);
ok('stopped before the rent started → nothing', rentLine(S({ hire_stop_on: '2026-10-20' }), '2026-11-30') === null);
ok('billed past the stop → nothing', rentLine(S({ hire_stop_on: '2026-11-10', billed_to: '2026-11-10' }), '2026-11-30') === null);
ok('not handed over → nothing', rentLine(S({ handed_over_on: null }), '2026-11-30') === null);
ok('totals with retention', JSON.stringify(requestTotals([{ amount: 1000, labour: 600 }, { amount: 514.29 }], 5)) === JSON.stringify({ subtotal: 1514.29, retention: 75.71, due: 1438.58, labour: 600 }) && requestTotals([{ amount: 10 }], null).retention === 0 && requestTotals([{ amount: 10 }], null).labour === null);
ok('included hire ending soon', includedEndsSoon(S({}), '2026-10-22') && !includedEndsSoon(S({}), '2026-10-10') && !includedEndsSoon(S({}), '2026-10-28') && !includedEndsSoon(S({ status: 'down' }), '2026-10-22'));
ok('days between', daysBetween('2026-10-27', '2026-10-31') === 4 && daysBetween('2026-03-28', '2026-03-30') === 2);
ok('line input', (lineFields({ description: 'Adaption', amount: '£250' }, 0) as any).line.amount === 250 && !lineFields({ description: 'X' }, 0).ok && !lineFields({ amount: '1', days: 'x' }, 0).ok);

const pdf = await renderInvoiceRequestPdf({ ref: 'ACESC2555-R2', kind: 'rent', period_from: '2026-10-27', period_to: '2026-11-30', created_at: '2026-11-30', retention_pct: 5, payment_days: 30, po_number: 'PO-778', vat_note: 'Domestic reverse charge — customer to account for VAT', notes: null,
  customer: { name: 'Cardo Group', address: 'Unit 1, Brighton, BN1 1AA', vat_number: 'GB111' }, job: { number: 2555, title: '4-8 Tilbury Way' }, site: { address: '4-8 Tilbury Way, Brighton, BN2 9QU' }, contact: { name: 'Tom Morley' },
  lines: [{ description: 'Hire of Independent scaffold — Front, 3 lifts', period_from: '2026-10-27', period_to: '2026-11-30', days: 35, weekly: 120, amount: 600 }, { description: 'Hire of Protection fan', period_from: '2026-10-27', period_to: '2026-11-30', days: 35, weekly: 25, amount: 125 }],
  subtotal: 725, retention: 36.25, due: 688.75, labour: null }, { name: 'ACE Scaffolding Ltd', company_no: '0123' });
ok('request PDF', pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 2000);
if (process.env.RFI_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.RFI_PDF_OUT, pdf);

if (fail) { console.error(fail + ' billing check(s) failed'); process.exit(1); }
console.log('scafBilling: all checks passed');
