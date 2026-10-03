// Fin&Ops cost rules. Run: npx tsx apps/api/src/finCosts.test.ts
import { buildCostId, parseAmount, periodOf, companyOf, toCostRow, flagsOf } from './finCosts';

let fail = 0;
const ok = (label: string, cond: boolean) => { if (!cond) { fail++; console.error('✗ ' + label); } else console.log('✓ ' + label); };
const item = (o: Partial<{ id: string; name: string; group: string; no: string; net: string; date: string; sub: string; konto: string; cid: string }>) => ({
  id: o.id ?? '1', name: o.name ?? 'Cortizo', group: o.group ?? 'Wrzesień 2026', updated_at: null,
  cols: { tekst1: o.no ?? '26/P14/000829', tekst0: o.net ?? '3095.81', data: o.date ?? '2026-09-30', tekst53: o.sub ?? '631 Materials', dropdown: o.konto ?? '631', cid: o.cid ?? null } as Record<string, string | null>,
});
const T = 't1', NOW = '2026-10-03T10:00:00Z';

// --- Cost ID ---
ok('id = SUPPLIER#INVOICE#NET', buildCostId('Cortizo', '26/P14/000829', 3095.81) === 'CORTIZO#26/P14/000829#3095.81');
ok('id normalises spaces / case', buildCostId('  eko-okna ', ' fs/k2/26/09/ 0995', 24831.73) === 'EKO-OKNA#FS/K2/26/09/0995#24831.73');
ok('id pads net to 2 decimals', buildCostId('Radiks', 'FK/264/2026', 350) === 'RADIKS#FK/264/2026#350.00');
ok('same invoice no, different supplier → different id', buildCostId('A', '2026/22', 100) !== buildCostId('B', '2026/22', 100));
ok('no id without invoice no', buildCostId('Cortizo', '', 10) === null);
ok('no id without net', buildCostId('Cortizo', 'X1', null) === null);
ok('amount "1 234,50" → 1234.5', parseAmount('1 234,50') === 1234.5);
ok('amount "" → null', parseAmount('') === null);
ok('amount 0 is a value', parseAmount('0') === 0);

// --- period / company ---
ok('period from date', JSON.stringify(periodOf('2026-09-30', 'x')) === '{"year":2026,"month":9}');
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
ok('incomplete invoice → no id, not changed', blank.cost_id === null && blank.changed === false);
const filled = toCostRow(T, item({}), 'cid', blank, NOW);
ok('completed later → id adopted, not flagged', filled.cost_id === first.cost_id && filled.changed === false);
ok('net amount removed later → changed', toCostRow(T, item({ net: '' }), 'cid', first, NOW).changed === true);

// --- flags ---
ok('flag duplicate', flagsOf(first, new Set([first.cost_id])).includes('duplicate'));
ok('flag incomplete', flagsOf(blank, new Set()).includes('incomplete'));
ok('flag konto mismatch', flagsOf(toCostRow(T, item({ konto: '473' }), 'cid', null, NOW), new Set()).includes('konto'));
ok('no konto flag when matching (.V)', !flagsOf(toCostRow(T, item({ sub: '499.V Handel', konto: '499.V' }), 'cid', null, NOW), new Set()).includes('konto'));
ok('clean row has no flags', flagsOf(first, new Set()).length === 0);

if (fail) { console.error(`\n${fail} FAIL`); process.exit(1); }
console.log('\nAll fin-cost rule tests passed.');
