// Run: npx tsx apps/api/src/jobInvoices.test.ts
import { invoiceKind, planInvoiceLines, type CostLite, type ItemLite } from './jobInvoices';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// what an invoice is
ok('glass suppliers → Glass, whatever the category', invoiceKind({ supplier: 'Stan Szkło', subcategory: '631 Materials' }) === 'glass' && invoiceKind({ supplier: 'Stan-Szkło', subcategory: '631 Materials' }) === 'glass' && invoiceKind({ supplier: 'Press Glass', subcategory: '631 Materials' }) === 'glass' && invoiceKind({ supplier: 'A2Projekt', subcategory: '416 Materials Run' }) === 'glass');
ok('profiles and hardware (631) are not booked — RW from Subiekt', invoiceKind({ supplier: 'Cortizo', subcategory: '631 Materials' }) === null && invoiceKind({ supplier: 'Aliplast', subcategory: '631 Materials' }) === null);
ok('416 → Extras, 425 → Transport, 500 → Extras', invoiceKind({ supplier: 'Firma Handlowa', subcategory: '416 Materials Run' }) === 'extras' && invoiceKind({ supplier: 'UK-Transport', subcategory: '425 Logistics' }) === 'transport' && invoiceKind({ supplier: 'Thermozone', subcategory: '500 Montaż' }) === 'extras');
ok('trade (499.V) and overheads are not booked', invoiceKind({ supplier: 'Eko-okna', subcategory: '499.V Handel' }) === null && invoiceKind({ supplier: 'Orlen', subcategory: '449 Fuel' }) === null);

// the plan
const C = (id: string, o: Partial<CostLite>): CostLite => ({ id: 'c' + id, monday_item_id: id, supplier: 'UK-Transport', invoice_no: 'FV ' + id, invoice_date: '2026-10-01', net: 1000, subcategory: '425 Logistics', order_ref: 'Z.437', company: 'acemark', ...o });
const jobs = [{ id: 'j437', reference_key: 'Z.437', locked: false }, { id: 'j440', reference_key: 'Z.440', locked: false }, { id: 'j420', reference_key: 'Z.420', locked: true }];
const I = (id: string, o: Partial<ItemLite>): ItemLite => ({ id, job_id: 'j437', kind: 'transport', source: 'monday', source_id: null, amount: 0, invoice_no: null, item_date: null, ...o });
const plan = planInvoiceLines([
  C('1', {}),                                                                   // new line on Z.437
  C('2', { net: 1500 }),                                                        // already booked at 1200 → updated
  C('3', { order_ref: 'Z.440' }),                                               // booked under Z.437 before → moved to Z.440
  C('4', { supplier: 'Cortizo', subcategory: '631 Materials' }),                // not booked; its old line goes
  C('5', { order_ref: 'Z.999' }),                                               // no job
  C('6', { order_ref: 'Z.420' }),                                               // locked job: left as it is
  C('7', { order_ref: 'Z.437, Z.440' }),                                        // several Z
  C('8', { supplier: 'Press Glass', subcategory: '631 Materials', invoice_no: 'FS 77' }),   // glass; replaces the typed line
  C('9', { removed: true }),                                                    // removed from the board: its line goes
], jobs, [
  I('i2', { source_id: 2, amount: 1200, invoice_no: 'FV 2', item_date: '2026-10-01' }),
  I('i3', { source_id: 3, amount: 1000, invoice_no: 'FV 3', item_date: '2026-10-01' }),
  I('i4', { source_id: 4, kind: 'extras', amount: 50 }),
  I('i6', { source_id: 6, job_id: 'j420', amount: 1000 }),
  I('i9', { source_id: 9, amount: 1000 }),
  I('t8', { source: null, kind: 'glass', invoice_no: 'FS-77', amount: 990 }),
  I('t9', { source: null, kind: 'glass', invoice_no: 'FS 78', amount: 10 }),   // another typed line stays
]);
const added = plan.upsert.filter((u) => !u.id), changed = plan.upsert.filter((u) => u.id);
ok('new lines: invoice 1 on Z.437, invoice 3 on Z.440, glass invoice 8', added.length === 3 && added.some((u) => u.fields.source_id === 1 && u.jobId === 'j437') && added.some((u) => u.fields.source_id === 3 && u.jobId === 'j440') && added.some((u) => u.fields.source_id === 8 && u.fields.kind === 'glass'), added);
ok('a changed amount updates the line', changed.length === 1 && changed[0].id === 'i2' && changed[0].fields.amount === 1500, changed);
ok('removed: the moved line, the line no longer booked, the removed invoice, the typed duplicate', ['i3', 'i4', 'i9', 't8'].every((x) => plan.remove.includes(x)) && !plan.remove.includes('i6') && !plan.remove.includes('t9') && plan.typedReplaced === 1, plan.remove);
ok('listed: no job, several Z, locked', JSON.stringify(plan.skipped.noJob) === '["Z.999"]' && plan.skipped.severalZ === 1 && JSON.stringify(plan.skipped.lockedSkipped) === '["Z.420"]', plan.skipped);

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('jobInvoices ok');
