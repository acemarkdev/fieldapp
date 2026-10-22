// Run: npx tsx apps/api/src/scafStock.test.ts
import { noteEffects, balances, noteInput, bomValue, forecast, monday } from './scafStock';
import { renderStockNotePdf } from './scafStockPdf';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const Y = '00000000-0000-0000-0000-00000000000a', V1 = '00000000-0000-0000-0000-00000000000b', J1 = '00000000-0000-0000-0000-00000000000c', T21 = '00000000-0000-0000-0000-000000000001', DBL = '00000000-0000-0000-0000-000000000002';
const N = (kind: any, x: any = {}) => ({ kind, from_loc: null, to_loc: null, job_id: null, ...x });
const eff = [
  ...noteEffects(N('purchase', { to_loc: Y }), [{ item_id: T21, qty: 100 }, { item_id: DBL, qty: 400 }]),
  ...noteEffects(N('transfer', { from_loc: Y, to_loc: V1 }), [{ item_id: T21, qty: 30 }]),
  ...noteEffects(N('delivery', { from_loc: V1, job_id: J1 }), [{ item_id: T21, qty: 40 }, { item_id: DBL, qty: 120 }]),
  ...noteEffects(N('collection', { job_id: J1, to_loc: Y }), [{ item_id: T21, qty: 38 }, { item_id: DBL, qty: 110 }]),
  ...noteEffects(N('stocktake', { to_loc: Y }), [{ item_id: DBL, qty: -5 }]),
];
const b = balances(eff);
ok('balances per place (a van may go negative)', b.get('L:' + Y)!.get(T21) === 108 && b.get('L:' + V1)!.get(T21) === -10 && b.get('J:' + J1)!.get(T21) === 2 && b.get('J:' + J1)!.get(DBL) === 10 && b.get('L:' + Y)!.get(DBL) === 505 && b.get('L:' + V1)!.get(DBL) === -120, [...b.entries()].map(([k, v]) => [k, [...v]]));
const lossEff = noteEffects(N('loss', { job_id: J1 }), [{ item_id: T21, qty: 2 }]);
ok('a loss only takes away', lossEff.length === 1 && lossEff[0].place === 'J:' + J1 && lossEff[0].qty === -2);
ok('note input', noteInput({ kind: 'delivery', day: '2026-10-22', from_loc: Y, job_id: J1, lines: [{ item_id: T21, qty: '40' }, { item_id: DBL, qty: '' }] }).ok
  && !noteInput({ kind: 'delivery', day: '2026-10-22', from_loc: Y, lines: [{ item_id: T21, qty: 1 }] }).ok && !noteInput({ kind: 'transfer', day: '2026-10-22', from_loc: Y, to_loc: Y, lines: [{ item_id: T21, qty: 1 }] }).ok
  && !noteInput({ kind: 'collection', day: '2026-10-22', job_id: J1, to_loc: Y, lines: [{ item_id: T21, qty: -1 }] }).ok && noteInput({ kind: 'stocktake', day: '2026-10-22', to_loc: Y, lines: [{ item_id: T21, qty: '-3' }] }).ok
  && !noteInput({ kind: 'purchase', day: '2026-10-22', to_loc: Y, lines: [] }).ok);
ok('bom kept to positive quantities of real ids', JSON.stringify(bomValue({ [T21]: '12', [DBL]: 0, x: 4 })) === JSON.stringify({ [T21]: 12 }));
ok('monday', monday('2026-10-22') === '2026-10-19' && monday('2026-10-19') === '2026-10-19' && monday('2026-10-25') === '2026-10-19');
const weeks = ['2026-10-19', '2026-10-26', '2026-11-02'];
const fc = forecast(new Map([[T21, 50], [DBL, 200]]), weeks, [{ day: '2026-10-21', bom: { [T21]: 40 } }, { day: '2026-10-27', bom: { [T21]: 30, [DBL]: 100 } }], [{ day: '2026-10-28', bom: { [T21]: 40 } }]);
const ft = fc.find((x) => x.item === T21)!;
ok('forecast: erections take, dismantles come back the week after, shortage shown', JSON.stringify(ft.after) === JSON.stringify([10, -20, 20]) && ft.short && fc[0].item === T21 && !fc.find((x) => x.item === DBL)!.short, fc);

const pdf = await renderStockNotePdf({ ref: 'SN-0012', kind: 'delivery', day: '2026-10-22', from: { name: 'Van 1', reg: 'AB12 CDE' }, job: { number: 2555, title: '4-8 Tilbury Way' }, site: { address: '4-8 Tilbury Way, Brighton' }, customer: { name: 'Cardo Group' }, driver: 'Matt', vehicle: 'Van 1',
  lines: [{ code: 'T21', name: 'Tube 21 ft (6.4 m)', unit: 'pcs', qty: 40, weight: 1120 }, { code: 'DBL', name: 'Double coupler', unit: 'pcs', qty: 120, weight: 132 }] }, { name: 'ACE Scaffolding Ltd' });
ok('note PDF', pdf.subarray(0, 4).toString() === '%PDF');
if (process.env.SN_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.SN_PDF_OUT, pdf);
if (fail) { console.error(fail + ' stock check(s) failed'); process.exit(1); }
console.log('scafStock: all checks passed');
