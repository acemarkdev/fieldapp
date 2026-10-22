// Run: npx tsx apps/api/src/scafQuotes.test.ts
import { quoteLines, quoteTotals, weeklyRent, jobTerms, enquiryFields, addDays, type QuoteLine } from './scafQuotes';
import { hireText, renderQuotePdf } from './scafQuotePdf';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const v = quoteLines([
  { element: 'Independent scaffold', description: 'Front elevation, 3 lifts', price: '3,000', labour: '2000', est_cost_up: '900', est_cost_down: '500', hire_weeks: '8', rent_pct: '4' },
  { element: 'Monarflex sheeting', price: '£450.50', hire_weeks: '8', rent_weekly: '25' },
  { element: '', description: '', price: '' },
]);
ok('lines read, empty row dropped, money with £ and commas', v.ok && v.lines.length === 2 && v.lines[0].price === 3000 && v.lines[1].price === 450.5 && v.lines[1].rent_weekly === 25, v);
const lines = (v as any).lines as QuoteLine[];
ok('weekly rent: % of the price or a fixed £', weeklyRent(lines[0]) === 120 && weeklyRent(lines[1]) === 25);
const t = quoteTotals(lines);
ok('totals', t.price === 3450.5 && t.labour === 2000 && t.hire === 1450.5 && t.costUp === 900 && t.costDown === 500 && t.profit === 2050.5 && t.margin === 59.4 && t.weeklyRent === 145, t);
ok('no labour given → no split', quoteTotals([lines[1]]).labour === null && quoteTotals([]).price === 0 && quoteTotals([]).margin === null);
ok('bad input', !quoteLines([{ element: 'X', price: 'abc' }]).ok && !quoteLines([{ element: 'X', price: '100', labour: '200' }]).ok && !quoteLines([{ element: 'X', price: '-5' }]).ok && !quoteLines([{ element: 'X', price: '100', rent_pct: '150' }]).ok);
ok('job terms when every line agrees', JSON.stringify(jobTerms(lines)) === JSON.stringify({ hire_weeks: 8, rent_pct: 4 }) && jobTerms([lines[0], { ...lines[0], rent_pct: 5 }]).rent_pct === null);
ok('hire wording', hireText(lines[0]) === "Includes erection, dismantling and 8 weeks' hire; then £120.00 a week (4% of the price)." && hireText(lines[1]) === "Includes erection, dismantling and 8 weeks' hire; then £25.00 a week." && hireText({ ...lines[0], hire_weeks: null, rent_pct: null }) === 'Includes erection and dismantling.', [hireText(lines[0]), hireText(lines[1])]);
ok('enquiry: lost needs a reason, dates checked', !enquiryFields({ stage: 'lost' }).ok && (enquiryFields({ stage: 'lost', loss_reason: 'Too pricey' }) as any).fields.next_action === null && !enquiryFields({ received: '22/10/2026' }).ok && !enquiryFields({ stage: 'nope' }).ok
  && (enquiryFields({ stage: 'quote_sent', next_action: '2026-10-29' }) as any).fields.next_action === '2026-10-29' && (enquiryFields({ stage: 'won' }) as any).fields.loss_reason === null && (enquiryFields({ stage: 'lost', loss_reason: 'No answer', next_action: '2026-10-29' }) as any).fields.next_action === null);
ok('days', addDays('2026-10-22', 7) === '2026-10-29' && addDays('2026-12-30', 30) === '2027-01-29');

const pdf = await renderQuotePdf({ quote: { revision: 2, valid_days: 30, sent_at: '2026-10-22', intro: 'Thank you for your enquiry.', terms: 'Prices exclude VAT.\nHire starts at handover.', lines: Array.from({ length: 14 }, () => lines[0]).concat(lines[1]), totals: quoteTotals(Array.from({ length: 14 }, () => lines[0]).concat(lines[1])) },
  enquiry: { number: 4022, title: '4-8 Tilbury Way', description: 'Scaffold to the front and rear elevations.' }, customer: { name: 'Cardo Group', address: 'Unit 1, Brighton, BN1 1AA' }, contact: { name: 'Tom Morley' }, site: { address: '4-8 Tilbury Way, Brighton, BN2 9QU' },
  company: { name: 'ACE Scaffolding Ltd', address: '1 Yard Road, Brighton', phone: '01273 000000', email: 'office@acescaffolding.co.uk', company_no: '01234567', vat_no: 'GB123456789' } });
ok('PDF renders over several pages', pdf.subarray(0, 4).toString() === '%PDF' && (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2, pdf.length);
if (process.env.QUOTE_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.QUOTE_PDF_OUT, pdf);

if (fail) { console.error(fail + ' quote check(s) failed'); process.exit(1); }
console.log('scafQuotes: all checks passed');
