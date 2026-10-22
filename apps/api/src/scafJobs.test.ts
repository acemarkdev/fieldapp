// Run: npx tsx apps/api/src/scafJobs.test.ts
import { jobStageFrom, hireEnds, checklistValue, scaffoldFields, visitFields, addDays, costFields, costTotals } from './scafJobs';
import { renderHandoverPdf } from './scafHandoverPdf';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

ok('job status from its scaffolds', jobStageFrom([]) === null && jobStageFrom(['booked']) === null && jobStageFrom(['erecting', 'booked']) === 'ongoing' && jobStageFrom(['on_hire', 'erecting']) === 'still_up'
  && jobStageFrom(['dismantle_requested', 'dismantling']) === 'ready_for_dismantle' && jobStageFrom(['on_hire', 'down']) === 'part_dismantled' && jobStageFrom(['dismantle_requested', 'down']) === 'part_dismantled'
  && jobStageFrom(['down', 'down']) === 'down' && jobStageFrom(['on_hire', 'dismantle_requested']) === 'still_up');
ok('hire ends after the included weeks', hireEnds('2026-10-01', 8) === '2026-11-26' && hireEnds('2026-10-01', null) === '2026-10-01' && hireEnds(null, 8) === null);
ok('checklist kept to known items', JSON.stringify(checklistValue({ rams: { state: 'done', on: '2026-10-20' }, alarm: { state: 'na' }, bogus: { state: 'done' }, hoist: { state: 'odd', note: 'x' } })) === JSON.stringify({ rams: { state: 'done', on: '2026-10-20', note: null }, alarm: { state: 'na', on: null, note: null }, hoist: { state: 'todo', on: null, note: 'x' } }));
ok('scaffold input', (scaffoldFields({ element: 'Fan', price: '£1,200', rent_pct: '4' }, true) as any).fields.price === 1200 && !scaffoldFields({ price: '100' }, true).ok && !scaffoldFields({ element: 'X', price: '100', labour: '200' }, true).ok
  && !scaffoldFields({ element: 'Adaption', variation: true, price: '300' }, true).ok && scaffoldFields({ element: 'Adaption', variation: true, confirmed_by: 'Tom by email', price: '300' }, true).ok && !scaffoldFields({ element: 'X', price: 'abc' }, true).ok);
ok('visit input', (visitFields({ kind: 'erect', day: '2026-10-26', days: '2', crew_id: '' }) as any).fields.days === 2 && !visitFields({ kind: 'party', day: '2026-10-26' }).ok && !visitFields({ kind: 'erect', day: '' }).ok && !visitFields({ kind: 'erect', day: '2026-10-26', days: 0 }).ok);
ok('days', addDays('2026-10-31', 1) === '2026-11-01');
ok('cost input', (costFields({ day: '2026-10-22', phase: 'down', category: 'subcontractor', amount: '£1,250.50' }) as any).fields.amount === 1250.5 && !costFields({ day: '2026-10-22', amount: '' }).ok && !costFields({ amount: '10' }).ok && (costFields({ day: '2026-10-22', amount: '5', phase: 'x', category: 'y' }) as any).fields.phase === 'up');
ok('cost totals with what monday had', JSON.stringify(costTotals([{ phase: 'up', amount: 300 }, { phase: 'down', amount: 200 }, { phase: 'other', amount: 50 }], 1000, null)) === JSON.stringify({ up: 1300, down: 200, other: 50, total: 1550, any: true }) && costTotals([], null, null).any === false);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pdf = await renderHandoverPdf({ company: { name: 'ACE Scaffolding Ltd', address: '1 Yard Road', company_no: '0123' },
  handover: { day: '2026-10-26', scaffold_ids: ['a', 'b'], ace_person: 'Matt C', client_name: 'Tom Morley', signature: png, max_load: 'General purpose, 2.0 kN/m²', notes: 'Rear access via the lane.' },
  job: { number: 2555, title: '4-8 Tilbury Way', enquiry: { number: 4022 }, customer: { name: 'Cardo Group' }, contact: { name: 'Tom Morley' }, site: { address: '4-8 Tilbury Way, Brighton, BN2 9QU' },
    scaffolds: [{ id: 'a', element: 'Independent scaffold', description: 'Front elevation, 3 lifts', tag: 'T1' }, { id: 'b', element: 'Protection fan' }, { id: 'c', element: 'Not handed over' }] } });
ok('handover PDF', pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 2000, pdf.length);
if (process.env.HANDOVER_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.HANDOVER_PDF_OUT, pdf);

if (fail) { console.error(fail + ' job check(s) failed'); process.exit(1); }
console.log('scafJobs: all checks passed');
