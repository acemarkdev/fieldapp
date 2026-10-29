// Run: npx tsx apps/api/src/wemAnalysis.test.ts
import { analyse, whereOf, weekOf, wemExportRows, WEM_EXPORT_HEAD } from './wemAnalysis';
import { parseCatalog } from './wemTasks';
import { WEM_CATALOG_CSV } from './wemCatalogSeed';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

const cat = parseCatalog(WEM_CATALOG_CSV);
const tasks = [{ id: 't1', code: 'SAS-SKR-ST05', position: '1', job_ref: 'WEM-2026-001' }, { id: 't2', code: 'OGL-PRZ-01', position: '', job_ref: 'WEM-2026-001' }];
// Times in UTC; Warsaw is UTC+1 in late October 2026 (after the clock change on the 25th)
const E = (id: string, task: string | null, start: string, min: number, type: string | null, qty: number | null, user = 'u1', name: string | null = null) =>
  ({ id, user_id: user, user_name: user === 'u1' ? 'Jan' : 'Ola', task_id: task, task_name: name, started_at: start, ended_at: new Date(Date.parse(start) + min * 60000).toISOString(), time_type: type, qty_done: qty, note: null });
const entries = [
  E('a', 't1', '2026-10-26T06:00:00Z', 60, 'work', 6),            // Jan, 60 min work, 6 sashes
  E('b', 't1', '2026-10-26T07:00:00Z', 20, 'setup', 0),           // 20 min setup
  E('c', 't1', '2026-10-27T06:00:00Z', 20, 'rework', 2, 'u2'),    // Ola, rework 2 — not new pieces
  E('d', 't1', '2026-10-27T07:00:00Z', 40, 'work', 2, 'u2'),      // Ola, 40 min work, 2 sashes
  E('e', 't2', '2026-10-27T08:00:00Z', 30, null, null),           // downtime, no type → work, no quantity asked
  E('f', null, '2026-10-27T09:00:00Z', 15, 'work', null, 'u1', 'WEM-2026-001_2_SAS-KPL-SK13'),   // task deleted: code from the name
  E('g', null, '2026-10-27T10:00:00Z', 30, null, null, 'u1', 'Z_437_cnc'),                           // not a WEM code
  { ...E('h', 't1', '2026-10-27T11:00:00Z', 10, 'work', null), ended_at: null },                     // running: left out
];
const rates: Record<string, number> = { u1: 60, u2: 90 };
const A = analyse(entries, tasks, cat, (e) => rates[e.user_id!], true);
const st5 = A.codes.find((c) => c.code === 'SAS-SKR-ST05')!;
ok('minutes per type', st5.work === 100 && st5.setup === 20 && st5.rework === 20 && st5.total === 140, st5);
ok('pieces from work only', st5.pieces === 8, st5.pieces);
ok('per piece and % lost', st5.workPerPiece === 12.5 && st5.totalPerPiece === 17.5 && st5.lostPct === 28.6, st5);
// cost at each worker's rate: Jan 80 min × 60 = 80 zł; Ola 60 min × 90 = 90 zł → 170 zł / 8
ok('cost at each worker’s rate', st5.cost === 170 && st5.costPerPiece === 21.25, st5);
ok('catalogue names', st5.activity === 'czopowanie' && st5.station === 'Czopiarka' && st5.product === 'Sash' && st5.department === 'Stolarnia');
const sk13 = A.codes.find((c) => c.code === 'SAS-KPL-SK13')!;
ok('deleted task: code read from the name, missing quantity reported', !!sk13 && sk13.pieces === 0 && sk13.noQty === 1, sk13);
ok('downtime: untyped counted as work, no quantity gap', A.totals.downtime === 30 && A.codes.find((c) => c.code === 'OGL-PRZ-01')!.untyped === 1 && A.codes.find((c) => c.code === 'OGL-PRZ-01')!.noQty === 0);
ok('time without a code kept apart', A.totals.noCode === 30 && !A.codes.some((c) => c.code === ''), A.totals);
ok('totals', A.totals.total === 185 && A.totals.entries === 6 && A.totals.noQty === 1 && A.totals.untyped === 1, A.totals);
ok('total cost includes time without a code', A.totals.cost === 170 + 30 + 15 + 30, A.totals.cost);
ok('top lists leave out downtime', A.topLost[0] === 'SAS-SKR-ST05' && !A.topLost.includes('OGL-PRZ-01') && A.topSlow[0] === 'SAS-SKR-ST05', [A.topLost, A.topSlow]);
ok('weekly trend: Monday of the week', A.weeks.length === 1 && A.weeks[0].week === '2026-10-26' && A.codeWeeks['SAS-SKR-ST05'][0].pieces === 8, A.weeks);
ok('week in Polish time', weekOf('2026-11-01T23:30:00Z') === '2026-11-02' && weekOf('2026-11-01T22:30:00Z') === '2026-10-26');
ok('product path not complete', A.products.find((p) => p.product === 'Sash')!.complete === false && A.products.find((p) => p.product === 'Sash')!.missing.length === 22 && A.products.find((p) => p.product === 'Sash')!.minutesPerUnit === null, A.products.find((p) => p.product === 'Sash'));
ok('no costs without the rates right', analyse(entries, tasks, cat, () => 99, false).codes.every((c) => c.cost === null && c.costPerPiece === null) && analyse(entries, tasks, cat, () => 99, false).totals.cost === null);

// A whole Casement path measured: 1 minute per piece on each code, 1 zł per piece → one unit
const casPath = cat.filter((c) => c.product === 'Casement' && !c.timber_only);
const casTasks = casPath.map((c, i) => ({ id: 'c' + i, code: c.code, position: '1', job_ref: 'WEM-2' }));
const casEntries = casPath.map((c, i) => E('x' + i, 'c' + i, '2026-10-28T06:00:00Z', 2, 'work', 2));
const P = analyse(casEntries, casTasks, cat, () => 60, true).products.find((p) => p.product === 'Casement')!;
ok('product path complete: minutes and cost per unit', P.complete && P.codes === casPath.length && P.minutesPerUnit === casPath.length && P.costPerUnit === casPath.length, P);
// a Sash counts sash rows twice (2 sashes per unit)
const sasPath = cat.filter((c) => c.product === 'Sash' && !c.timber_only), sashRows = sasPath.filter((c) => c.qty_rule === 'sash').length;
const S = analyse(sasPath.map((c, i) => E('s' + i, 's' + i, '2026-10-28T06:00:00Z', 1, 'work', 1)), sasPath.map((c, i) => ({ id: 's' + i, code: c.code })), cat, () => 60, true).products.find((p) => p.product === 'Sash')!;
ok('Sash: sash rows × 2', S.complete && S.minutesPerUnit === sasPath.length + sashRows, S);

// where an entry belongs
ok('order and position from the task', JSON.stringify(whereOf({ task_id: 't1', task_name: 'x' }, new Map(tasks.map((t) => [t.id, t])))) === JSON.stringify({ code: 'SAS-SKR-ST05', order: 'WEM-2026-001', pos: '1' }));
ok('order and position from the name', JSON.stringify(whereOf({ task_id: null, task_name: 'WEM-2026-001_12_DOD-HRN-01' }, new Map())) === JSON.stringify({ code: 'DOD-HRN-01', order: 'WEM-2026-001', pos: '12' }));

// the export in the WEM layout
const X = wemExportRows(entries, tasks);
ok('export head', WEM_EXPORT_HEAD.join(';') === 'ID;Pracownik;Nr zlecenia;Poz.;Kod tasku;Rodzaj czasu;Start;Stop;Ilość wykonana;Uwagi');
ok('export: finished entries only, by start', X.length === 7 && X[0][0] === '1' && X[0][4] === 'SAS-SKR-ST05', X[0]);
ok('export: Polish time, type and quantity', X[0].join(';') === '1;Jan;WEM-2026-001;1;SAS-SKR-ST05;Praca;2026-10-26 07:00;2026-10-26 08:00;6;', X[0].join(';'));
ok('export: no type, no quantity', X[4].join(';') === '5;Jan;WEM-2026-001;;OGL-PRZ-01;;2026-10-27 09:00;2026-10-27 09:30;;', X[4].join(';'));

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('wemAnalysis: all passed');
