// Run: npx tsx apps/api/src/scafCrew.test.ts
import { inspectionDue, inspectionInput, isSvgSignature, daysBetween } from './scafCrew';
import { renderHandoverPdf } from './scafHandoverPdf';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const S = (status: string, handed: string | null) => ({ status, handed_over_on: handed });
ok('first inspection due at the handover', inspectionDue(S('on_hire', '2026-10-21'), null) === '2026-10-21');
ok('then every 7 days', inspectionDue(S('on_hire', '2026-10-21'), '2026-10-21') === '2026-10-28' && inspectionDue(S('dismantle_requested', '2026-10-01'), '2026-10-20') === '2026-10-27');
ok('an inspection before the handover does not count', inspectionDue(S('on_hire', '2026-10-21'), '2026-10-15') === '2026-10-21');
ok('not in use → no inspection', inspectionDue(S('down', '2026-10-21'), null) === null && inspectionDue(S('booked', null), null) === null && inspectionDue(S('erecting', null), null) === null);
const id = '00000000-0000-0000-0000-000000000001';
ok('inspection input', inspectionInput({ scaffold_ids: [id], safe: true }).ok && !inspectionInput({ scaffold_ids: [], safe: true }).ok && !inspectionInput({ scaffold_ids: [id] }).ok
  && !inspectionInput({ scaffold_ids: [id], safe: false }).ok && inspectionInput({ scaffold_ids: [id, 'x'], safe: false, defects: 'Missing toe board, lift 2' }).ok && (inspectionInput({ scaffold_ids: [id], safe: true, reason: 'party' }) as any).rows[0].reason === 'weekly');
ok('phone signature format', isSvgSignature('svg:320x150:M10 10 L20 20 L30 25') && !isSvgSignature('svg:320x150:<script>') && !isSvgSignature('data:image/png;base64,AAA'));
ok('days', daysBetween('2026-10-21', '2026-10-28') === 7);
const pdf = await renderHandoverPdf({ company: { name: 'ACE Scaffolding Ltd' }, handover: { day: '2026-10-26', scaffold_ids: ['a'], ace_person: 'Matt', client_name: 'Tom Morley', signature: 'svg:320x150:M20 100 L60 40 L90 110 L140 30 L200 120 M220 80 L300 80' },
  job: { number: 2555, title: 'x', customer: { name: 'Cardo' }, site: { address: 'Brighton' }, scaffolds: [{ id: 'a', element: 'Independent scaffold' }] } });
ok('handover PDF with a phone signature', pdf.subarray(0, 4).toString() === '%PDF');
if (process.env.SIG_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.SIG_PDF_OUT, pdf);
if (fail) { console.error(fail + ' crew check(s) failed'); process.exit(1); }
console.log('scafCrew: all checks passed');
