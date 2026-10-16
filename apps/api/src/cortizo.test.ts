// Run: npx tsx apps/api/src/cortizo.test.ts
import { matchSymbol, matchStock, refKeys, looksCortizo, stockFromAgent, type StockRow } from './cortizo';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };
const keys = refKeys(['COR-3808', 'COR-3810', 'COR-381020', '770224', '801515', '331817']);
const m = (s: string) => matchSymbol(s, keys);

ok('the symbol is the reference', m('COR-3808') === 'COR-3808' && m('cor-3808') === 'COR-3808' && m(' COR-3808 ') === 'COR-3808' && m('770224') === '770224');
ok('reference + suffix after a separator', m('COR-3808-9016') === 'COR-3808' && m('COR-3808 RAL7016') === 'COR-3808' && m('770224/6,5') === '770224' && m('801515.6500') === '801515' && m('COR-3808_ANOD') === 'COR-3808');
ok('the longest reference wins', m('COR-381020') === 'COR-381020' && m('COR-381020-9016') === 'COR-381020');
ok('the dashes a symbol has are respected', m('COR-3810-20') === 'COR-3810', m('COR-3810-20'));
ok('without the dash', m('COR3808') === 'COR-3808' && m('COR 3808') === 'COR-3808');
ok('no match without a separator', m('COR-38089') === null && m('7702245') === null && m('COR-380') === null, [m('COR-38089'), m('7702245')]);
ok('no match for other products', m('USZCZELKA') === null && m('') === null);
ok('looks like Cortizo', looksCortizo('COR-9999') && looksCortizo('123456') && looksCortizo('cor 1234') && !looksCortizo('ABC-1') && !looksCortizo('12345'));

const row = (symbol: string, qty: number, warehouse = 'MAG'): StockRow => ({ product_id: Math.floor(Math.random() * 1e9), warehouse, symbol, name: null, unit: 'm', qty, reserved: null });
const r = matchStock(['COR-3808', '770224'], [row('COR-3808', 12), row('COR-3808-9016', 6.5), row('COR-3808', 2, 'ORP'), row('COR-9999', 1), row('ŚRUBA', 100), row('770224', 0)]);
ok('stock grouped by reference', r.byRef.get('COR-3808')?.length === 3 && r.byRef.get('770224')?.length === 1);
ok('Cortizo-looking leftovers are listed, other products are not', r.unmatched.length === 1 && r.unmatched[0].symbol === 'COR-9999', r.unmatched);

ok('agent row', JSON.stringify(stockFromAgent({ id: 5, symbol: ' COR-3808 ', name: 'Junquillo', unit: 'mb', warehouse: 'MAG', qty: '12.5', reserved: null })) === JSON.stringify({ product_id: 5, symbol: 'COR-3808', warehouse: 'MAG', name: 'Junquillo', unit: 'mb', qty: 12.5, reserved: null }));
ok('agent row without id or symbol is dropped', stockFromAgent({ symbol: 'X' }) === null && stockFromAgent({ id: 3, symbol: '' }) === null);
ok('missing warehouse is an empty string', stockFromAgent({ id: 3, symbol: 'A', qty: 1 })?.warehouse === '');

if (fail) { console.error(`${fail} cortizo test(s) failed`); process.exit(1); }
console.log('All cortizo tests passed');
