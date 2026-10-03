// Fin&Ops cost rules. Run: npx tsx apps/api/src/finCosts.test.ts
import { inScope, parseScope, groupPeriod, isNumberFilledIn, buildCostId, parseAmount, periodOf, companyOf, toCostRow, flagsOf, autoSyncDue, localDayHour, categoryCode, costKindOf } from './finCosts';

let fail = 0;
const ok = (label: string, cond: boolean) => { if (!cond) { fail++; console.error('✗ ' + label); } else console.log('✓ ' + label); };
const item = (o: Partial<{ id: string; name: string; group: string; no: string; net: string; date: string; sub: string; konto: string; cid: string }>) => ({
  id: o.id ?? '1', name: o.name ?? 'Cortizo', group: o.group ?? 'Wrzesień 2026', updated_at: null,
  cols: { tekst1: o.no ?? '26/P14/000829', tekst0: o.net ?? '3095.81', data: o.date ?? '2026-09-30', tekst53: o.sub ?? '631 Materials', dropdown: o.konto ?? '631', color_mkz3ghnq: 'Production', cid: o.cid ?? null } as Record<string, string | null>,
});
const T = 't1', NOW = '2026-10-03T10:00:00Z';

// --- Cost ID ---
ok('id = SUPPLIER#INVOICE#NET', buildCostId('Cortizo', '26/P14/000829', 3095.81) === 'CORTIZO#26/P14/000829#3095.81');
ok('id normalises spaces / case', buildCostId('  eko-okna ', ' fs/k2/26/09/ 0995', 24831.73) === 'EKO-OKNA#FS/K2/26/09/0995#24831.73');
ok('id pads net to 2 decimals', buildCostId('Radiks', 'FK/264/2026', 350) === 'RADIKS#FK/264/2026#350.00');
ok('same invoice no, different supplier → different id', buildCostId('A', '2026/22', 100) !== buildCostId('B', '2026/22', 100));
ok('no invoice number → id from the date', buildCostId('HLS', '', 30.9, { date: '2026-09-01', itemId: '77' }) === 'HLS#BRAK-FV-2026-09-01#30.90');
ok('no invoice number, no date → id from the monday item', buildCostId('HLS', '', 30.9, { itemId: '77' }) === 'HLS#BRAK-FV-ITEM77#30.90');
ok('no invoice number and nothing to fall back on → no id', buildCostId('Cortizo', '', 10) === null);
ok('no supplier → no id', buildCostId('', 'X1', 10, { date: '2026-09-01' }) === null);
ok('no id without net', buildCostId('Cortizo', 'X1', null) === null);
ok('amount "1 234,50" → 1234.5', parseAmount('1 234,50') === 1234.5);
ok('amount "" → null', parseAmount('') === null);
ok('amount 0 is a value', parseAmount('0') === 0);

// --- period / company ---
ok('period from date when the group names no month', JSON.stringify(periodOf('2026-09-30', 'x')) === '{"year":2026,"month":9}');
ok('period follows the monday group, not the date (Mikstol: dated 15 Oct, filed in September)', JSON.stringify(periodOf('2026-10-15', 'Wrzesień 2026')) === '{"year":2026,"month":9}');
ok('two-month group → falls back to the invoice date', JSON.stringify(periodOf('2022-11-03', 'Październik - Listopad - 2022')) === '{"year":2022,"month":11}');
ok('group period', JSON.stringify(groupPeriod('Styczeń 2026')) === '{"year":2026,"month":1}');
ok('period from group when no date', JSON.stringify(periodOf(null, 'Wrzesień 2026')) === '{"year":2026,"month":9}');
ok('period: Październik ≠ Listopad mix-up', JSON.stringify(periodOf(null, 'Październik 2026')) === '{"year":2026,"month":10}');
ok('period: two-month group → year only', JSON.stringify(periodOf(null, 'Październik - Listopad - 2022')) === '{"year":2022,"month":null}');
ok('company ACE_GROUP', companyOf('ACE_GROUP') === 'ace_group');
ok('company Poza Bilans', companyOf('Poza Bilans') === 'off_balance');
ok('company default', companyOf('631 Materials') === 'acemark');

// --- first sync / unchanged / changed / completed later ---
const first = toCostRow(T, item({}), 'cid', null, NOW);
ok('first sync adopts id', first.cost_id === 'CORTIZO#26/P14/000829#3095.81' && first.changed === false && first.orig_net === 3095.81);
const again = toCostRow(T, item({ cid: first.cost_id }), 'cid', first, NOW);
ok('unchanged stays clean', again.changed === false && again.cost_id === first.cost_id);
const edited = toCostRow(T, item({ net: '3995.81' }), 'cid', first, NOW);
ok('edited net → changed, trusted id kept', edited.changed === true && edited.cost_id === first.cost_id && edited.net === 3995.81 && edited.orig_net === 3095.81 && edited.changed_at === NOW);
ok('edited invoice no → changed', toCostRow(T, item({ no: '26/P14/000830' }), 'cid', first, NOW).changed === true);
ok('edited supplier → changed', toCostRow(T, item({ name: 'Cortizo PL' }), 'cid', first, NOW).changed === true);
ok('edited back → clean again', toCostRow(T, item({}), 'cid', edited, NOW).changed === false);
ok('changed_at keeps first detection', toCostRow(T, item({ net: '1' }), 'cid', { ...edited, changed_at: '2026-10-01T00:00:00Z' }, NOW).changed_at === '2026-10-01T00:00:00Z');
const blank = toCostRow(T, item({ no: '' }), 'cid', null, NOW);
ok('no invoice number → still registered with a placeholder id', blank.cost_id === 'CORTIZO#BRAK-FV-2026-09-30#3095.81' && blank.changed === false);
ok('placeholder row flagged noinvoice (not incomplete)', flagsOf(blank, new Set()).includes('noinvoice') && !flagsOf(blank, new Set()).includes('incomplete'));
const filled = toCostRow(T, item({}), 'cid', blank, NOW);
ok('invoice number filled in later → real id adopted, not flagged', filled.cost_id === first.cost_id && filled.changed === false && filled.orig_invoice_no === '26/P14/000829');
ok('number filled in AND net edited → flagged', toCostRow(T, item({ net: '1.00' }), 'cid', blank, NOW).changed === true);
ok('isNumberFilledIn only for placeholder → real, same supplier + net', isNumberFilledIn('A#BRAK-FV-2026-09-01#5.00', 'A#X1#5.00') && !isNumberFilledIn('A#X0#5.00', 'A#X1#5.00') && !isNumberFilledIn('A#BRAK-FV-2026-09-01#5.00', 'B#X1#5.00'));
const noNet = toCostRow(T, item({ net: '' }), 'cid', null, NOW);
ok('no net amount → no id (incomplete)', noNet.cost_id === null && flagsOf(noNet, new Set()).includes('incomplete'));
ok('older row without id gets one on the next sync', toCostRow(T, item({ no: '' }), 'cid', { cost_id: null, first_synced_at: NOW }, NOW).cost_id === 'CORTIZO#BRAK-FV-2026-09-30#3095.81');
ok('net amount removed later → changed', toCostRow(T, item({ net: '' }), 'cid', first, NOW).changed === true);

// --- flags ---
ok('flag duplicate', flagsOf(first, new Set([first.cost_id])).includes('duplicate'));
ok('date outside its group month → period flag', flagsOf(toCostRow(T, item({ date: '2026-10-15' }), 'cid', null, NOW), new Set()).includes('period') && !flagsOf(first, new Set()).includes('period'));
ok('flag konto mismatch', flagsOf(toCostRow(T, item({ konto: '473' }), 'cid', null, NOW), new Set()).includes('konto'));
ok('no konto flag when matching (.V)', !flagsOf(toCostRow(T, item({ sub: '499.V Handel', konto: '499.V' }), 'cid', null, NOW), new Set()).includes('konto'));
ok('clean row has no flags', flagsOf(first, new Set()).length === 0);

// --- classification: code, fixed/variable by category, reclassify flags ---
ok('code of "631 Materials"', categoryCode('631 Materials') === '631');
ok('code of "499.V Handel"', categoryCode('499.V Handel') === '499.V');
ok('code of "Tax"', categoryCode('Tax') === 'TAX');
ok('code of empty', categoryCode('') === null);
ok('469 Rentings is fixed', costKindOf('469 Rentings') === 'fixed');
ok('469.V Rentings is variable', costKindOf('469.V Rentings') === 'variable');
ok('463 Software fixed, 463.V variable', costKindOf('463 Software') === 'fixed' && costKindOf('463.V Software') === 'variable');
ok('631 Materials / 429 Office / Tax are variable', costKindOf('631 Materials') === 'variable' && costKindOf('429 Office') === 'variable' && costKindOf('Tax') === 'variable');
const cls = (dept: string | null, sub: string | null, konto: string | null) => flagsOf({ cost_id: 'x', department: dept, subcategory: sub, konto }, new Set());
ok('clean classification → no flags', cls('Production', '631 Materials', '631').length === 0);
ok('KONTO with several values incl. the code → ok', !cls('Sales', '499.V Handel', '499.V, 499').includes('konto'));
ok('KONTO different from category → konto', cls('Sales', '499.V Handel', '449.V').includes('konto'));
ok('no KONTO → no konto flag', !cls('Office', '429 Office', null).includes('konto'));
ok('Tax has no account code → no konto flag', !cls('Sales', 'Tax', '100').includes('konto'));
ok('429 Office under Production → valid line (added on request)', !cls('Production', '429 Office', '429').includes('offsheet'));
ok('445 Utilities under Production → offsheet', cls('Production', '445 Utilities', '445').includes('offsheet'));
ok('463 Software under Production → offsheet (sheet has only 463.V there)', cls('Production', '463 Software', '463').includes('offsheet'));
ok('463.V Software under Production → on the sheet', !cls('Production', '463.V Software', '463.V').includes('offsheet'));
ok('473 Maintenance under Sales → offsheet', cls('Sales', '473 Maintenance', '473').includes('offsheet'));
ok('473 Investments under Production → on the sheet', !cls('Production', '473 Investments', '473').includes('offsheet'));
ok('no department → unclassified', cls(null, '631 Materials', '631').includes('unclassified'));
ok('no category → unclassified', cls('Office', null, null).includes('unclassified'));
ok('unknown department is not judged against the sheet', !cls('Warehouse', '429 Office', '429').includes('offsheet'));

// --- sync scope (last N months, by monday month group) ---
const NOWS = new Date('2026-10-03T10:00:00Z');
ok('scope: everything when no limit', inScope(2022, 11, null, NOWS) && inScope(null, null, null, NOWS));
ok('scope 3: Oct, Sep, Aug 2026 in', inScope(2026, 10, 3, NOWS) && inScope(2026, 9, 3, NOWS) && inScope(2026, 8, 3, NOWS));
ok('scope 3: Jul 2026 out', !inScope(2026, 7, 3, NOWS));
ok('scope 12: Nov 2025 in, Oct 2025 out', inScope(2025, 11, 12, NOWS) && !inScope(2025, 10, 12, NOWS));
ok('scope: a future month group is in', inScope(2026, 11, 3, NOWS));
ok('scope: a row with no month is not in a scoped sync', !inScope(2022, null, 12, NOWS));
ok('scope: month boundary uses Poland time', inScope(2026, 9, 1, new Date('2026-09-30T21:30:00Z')) && !inScope(2026, 9, 1, new Date('2026-09-30T22:30:00Z')));
ok('parseScope: 3 / 12 / anything else = all', parseScope('3') === 3 && parseScope(12) === 12 && parseScope('') === null && parseScope(null) === null && parseScope(7) === null);

// --- automatic daily sync (06:00 Poland time) ---
const S = { enabled: true, hour: 6, tz: 'Europe/Warsaw' };
ok('local day/hour in Warsaw (summer, UTC+2)', JSON.stringify(localDayHour(new Date('2026-07-01T04:30:00Z'), 'Europe/Warsaw')) === '{"day":"2026-07-01","hour":6}');
ok('local day/hour in Warsaw (winter, UTC+1)', JSON.stringify(localDayHour(new Date('2026-12-01T05:30:00Z'), 'Europe/Warsaw')) === '{"day":"2026-12-01","hour":6}');
ok('midnight is hour 0, not 24', localDayHour(new Date('2026-07-01T22:10:00Z'), 'Europe/Warsaw').hour === 0);
ok('not due before 06:00', autoSyncDue(new Date('2026-10-05T03:59:00Z'), S, null) === false);            // 05:59 Warsaw
ok('due at 06:00 when never run', autoSyncDue(new Date('2026-10-05T04:00:00Z'), S, null) === true);      // 06:00 Warsaw
ok('due at 06:00 when last run was yesterday', autoSyncDue(new Date('2026-10-05T04:02:00Z'), S, '2026-10-04T04:00:10Z') === true);
ok('not due again the same day', autoSyncDue(new Date('2026-10-05T09:00:00Z'), S, '2026-10-05T04:00:10Z') === false);
ok('catch-up later the same day after downtime', autoSyncDue(new Date('2026-10-05T13:00:00Z'), S, '2026-10-04T04:00:10Z') === true);
ok('a run just after local midnight counts for that new day', autoSyncDue(new Date('2026-10-05T04:00:00Z'), S, '2026-10-04T22:30:00Z') === false); // 00:30 Warsaw on the 5th
ok('off → never due', autoSyncDue(new Date('2026-10-05T10:00:00Z'), { ...S, enabled: false }, null) === false);
ok('other hour respected (22:00)', autoSyncDue(new Date('2026-10-05T19:59:00Z'), { ...S, hour: 22 }, null) === false && autoSyncDue(new Date('2026-10-05T20:00:00Z'), { ...S, hour: 22 }, null) === true);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll fin-cost rule tests passed.');
